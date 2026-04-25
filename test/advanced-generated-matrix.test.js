import assert from "node:assert/strict";
import test from "node:test";

import {
  TypedPurlBuilders,
  TypedPurls,
  build,
  parse,
  roundTrip
} from "../index.js";
import {
  chooseAllowedNonChecksumQualifier,
  componentDefinition,
  deriveSeedParts,
  ensureBuildable,
  insertQualifier,
  loadTypeDefinitions,
  mutateInvalidForPattern,
  qualifierDefaultValue
} from "./support/type-test-utils.js";

const DEFINITIONS = loadTypeDefinitions();
const BASELINES = new Map();

function cloneParts(parts) {
  return {
    ...parts,
    qualifiers: parts.qualifiers ? { ...parts.qualifiers } : null
  };
}

function getBaseline(definition) {
  const cached = BASELINES.get(definition.type);
  if (cached) {
    return cloneParts(cached);
  }

  const baseline = ensureBuildable(deriveSeedParts(definition));
  BASELINES.set(definition.type, baseline);
  return cloneParts(baseline);
}

function requiredQualifierKeys(definition) {
  return (definition.qualifiers_definition || [])
    .filter((entry) => entry.requirement === "required")
    .map((entry) => String(entry.key || "").toLowerCase())
    .filter(Boolean);
}

function withRawName(definition, rawName) {
  const canonical = build(getBaseline(definition));
  const body = canonical.slice(4);
  const at = body.indexOf("@");
  const q = body.indexOf("?");
  const h = body.indexOf("#");
  const indexes = [at, q, h].filter((value) => value >= 0);
  const cut = indexes.length ? Math.min(...indexes) : body.length;

  const pathPart = body.slice(0, cut);
  const suffix = body.slice(cut);
  const lastSlash = pathPart.lastIndexOf("/");
  const mutatedPath = `${pathPart.slice(0, lastSlash + 1)}${rawName}`;
  return `pkg:${mutatedPath}${suffix}`;
}

function withRawVersion(definition, rawVersion) {
  const canonical = build(getBaseline(definition));
  const body = canonical.slice(4);
  const q = body.indexOf("?");
  const h = body.indexOf("#");
  const indexes = [q, h].filter((value) => value >= 0);
  const cut = indexes.length ? Math.min(...indexes) : body.length;

  const main = body.slice(0, cut);
  const suffix = body.slice(cut);
  const pathOnly = main.includes("@") ? main.slice(0, main.indexOf("@")) : main;
  return `pkg:${pathOnly}@${rawVersion}${suffix}`;
}

test("advanced generated matrix loads all type definitions", () => {
  assert.equal(DEFINITIONS.length, 39);
});

for (const definition of DEFINITIONS) {
  const type = definition.type;
  const qualifierKey = chooseAllowedNonChecksumQualifier(definition);

  test(`${type}: baseline build and parse are strict-canonical`, () => {
    const baseline = getBaseline(definition);
    const built = build(baseline);
    const parsed = parse(built);

    assert.deepEqual(parsed, baseline);
    assert.equal(parsed.type, type);
  });

  test(`${type}: roundTrip is idempotent on canonical input`, () => {
    const baseline = getBaseline(definition);
    const canonical = build(baseline);

    assert.equal(roundTrip(canonical), canonical);
  });

  test(`${type}: type is canonicalized to lowercase on build`, () => {
    const baseline = getBaseline(definition);
    const built = build({ ...baseline, type: type.toUpperCase() });

    assert.ok(built.startsWith(`pkg:${type}/`));
  });

  test(`${type}: qualifier keys are lowercased and sorted`, () => {
    const baseline = getBaseline(definition);
    const built = build({
      ...baseline,
      qualifiers: {
        ...(baseline.qualifiers || {}),
        VCS_URL: "https://example.com/vcs",
        [qualifierKey.toUpperCase()]: qualifierDefaultValue(qualifierKey)
      }
    });

    const query = built.split("?")[1]?.split("#")[0] || "";
    const keys = query
      .split("&")
      .filter(Boolean)
      .map((entry) => entry.split("=")[0]);

    assert.deepEqual(keys, [...keys].sort());
    assert.ok(keys.every((key) => key === key.toLowerCase()));
  });

  test(`${type}: parse rejects duplicate qualifier keys`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(insertQualifier(canonical, `${qualifierKey}=one`), `${qualifierKey}=two`);

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_DUPLICATE_QUALIFIER"
    );
  });

  test(`${type}: build rejects unknown qualifier`, () => {
    const baseline = getBaseline(definition);

    assert.throws(
      () =>
        build({
          ...baseline,
          qualifiers: {
            ...(baseline.qualifiers || {}),
            definitely_not_allowed: "x"
          }
        }),
      (error) => error?.code === "E_UNKNOWN_QUALIFIER"
    );
  });

  test(`${type}: parse rejects unknown qualifier`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(canonical, "definitely_not_allowed=x");

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_UNKNOWN_QUALIFIER"
    );
  });

  test(`${type}: non-checksum qualifiers reject multi-value payloads`, () => {
    const baseline = getBaseline(definition);

    assert.throws(
      () =>
        build({
          ...baseline,
          qualifiers: {
            ...(baseline.qualifiers || {}),
            [qualifierKey]: "left,right"
          }
        }),
      (error) => error?.code === "E_MULTIVALUE_QUALIFIER"
    );
  });

  test(`${type}: checksum accepts multi-value payloads`, () => {
    const baseline = getBaseline(definition);
    const built = build({
      ...baseline,
      qualifiers: {
        ...(baseline.qualifiers || {}),
        checksum:
          "sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
      }
    });

    assert.equal(
      parse(built).qualifiers?.checksum,
      "sha1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
    );
  });

  test(`${type}: checksum missing algorithm is rejected`, () => {
    const baseline = getBaseline(definition);

    assert.throws(
      () =>
        build({
          ...baseline,
          qualifiers: {
            ...(baseline.qualifiers || {}),
            checksum: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          }
        }),
      (error) => error?.code === "E_CHECKSUM_MISSING_ALGORITHM"
    );
  });

  test(`${type}: checksum digest must match algorithm length and charset`, () => {
    const baseline = getBaseline(definition);

    assert.throws(
      () =>
        build({
          ...baseline,
          qualifiers: {
            ...(baseline.qualifiers || {}),
            checksum: "sha256:xyz123"
          }
        }),
      (error) => error?.code === "E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM"
    );
  });

  test(`${type}: parse rejects malformed qualifier key`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(canonical, "1bad=x");

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_INVALID_QUALIFIER_KEY"
    );
  });

  test(`${type}: parse rejects empty qualifier value`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(canonical, `${qualifierKey}=`);

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_INVALID_QUALIFIER_VALUE"
    );
  });

  test(`${type}: parse rejects bad percent encoding in version`, () => {
    const input = withRawVersion(definition, "1.0%GG");

    assert.throws(
      () => parse(input),
      (error) => error?.code === "E_BAD_PERCENT_ENCODING"
    );
  });

  test(`${type}: parse rejects bad percent encoding in name`, () => {
    const input = withRawName(definition, "bad%GGname");
    assert.throws(
      () => parse(input),
      (error) => error?.code === "E_BAD_PERCENT_ENCODING"
    );
  });

  test(`${type}: escaped slash in name has explicit behavior`, () => {
    const input = withRawName(definition, "bad%2Fname");
    try {
      const parsed = parse(input);
      assert.equal(parsed.type, type);
    } catch (error) {
      assert.ok(["E_PERMITTED_CHARACTERS", "E_CPAN_NAME"].includes(error?.code));
    }
  });

  test(`${type}: parse rejects raw whitespace in name`, () => {
    const input = withRawName(definition, "bad name");
    assert.throws(
      () => parse(input),
      (error) => error?.code === "E_INVALID_CHARACTER"
    );
  });

  test(`${type}: percent-encoded whitespace in name has explicit behavior`, () => {
    const input = withRawName(definition, "good%20name");
    try {
      const parsed = parse(input);
      assert.equal(parsed.type, type);
    } catch (error) {
      assert.ok(["E_PERMITTED_CHARACTERS", "E_CPAN_NAME"].includes(error?.code));
    }
  });

  test(`${type}: parse rejects second subpath separator`, () => {
    const canonical = build(getBaseline(definition));
    assert.throws(
      () => parse(`${canonical}#a#b`),
      (error) => error?.code === "E_INVALID_SUBPATH"
    );
  });

  test(`${type}: parse rejects second qualifier separator`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = canonical.includes("?") ? `${canonical}?again=true` : `${canonical}?a=1?b=2`;

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_INVALID_QUALIFIERS"
    );
  });

  test(`${type}: subpath dot-segments are removed canonically`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = `${canonical}#a/./b/../c`;
    const parsed = parse(mutated);

    assert.equal(parsed.subpath, "a/b/c");
    assert.ok(build(parsed).endsWith("#a/b/c"));
  });

  test(`${type}: subpath slash runs are normalized`, () => {
    const canonical = build(getBaseline(definition));
    const parsed = parse(`${canonical}#//a///b//`);
    assert.equal(parsed.subpath, "a/b");
  });

  test(`${type}: typed builder emits the same canonical purl as strict build`, () => {
    const baseline = getBaseline(definition);
    const BuilderClass = TypedPurlBuilders[type];
    const typedBuilt = new BuilderClass()
      .setName(baseline.name)
      .setNamespace(baseline.namespace)
      .setVersion(baseline.version)
      .setQualifiers(baseline.qualifiers)
      .setSubpath(baseline.subpath)
      .buildString();

    assert.equal(typedBuilt, build(baseline));
  });

  test(`${type}: typed class parses its own type`, () => {
    const canonical = build(getBaseline(definition));
    const TypedClass = TypedPurls[type];
    const parsed = TypedClass.parse(canonical);

    assert.equal(parsed.type, type);
  });

  if (type !== "generic") {
    test(`${type}: typed class rejects a mismatched purl type`, () => {
      const TypedClass = TypedPurls[type];
      assert.throws(
        () => TypedClass.parse("pkg:generic/example"),
        (error) => error?.code === "E_TYPE_MISMATCH"
      );
    });
  }

  const namespaceRule = componentDefinition(definition, "namespace");
  if (namespaceRule?.requirement === "required") {
    test(`${type}: required namespace is enforced`, () => {
      const baseline = getBaseline(definition);
      const mutated = { ...baseline, namespace: null };
      assert.throws(
        () => build(mutated),
        (error) => error?.code === "E_REQUIRED_COMPONENT"
      );
    });
  }

  if (namespaceRule?.requirement === "prohibited") {
    test(`${type}: prohibited namespace is enforced`, () => {
      const baseline = getBaseline(definition);
      const mutated = { ...baseline, namespace: "org" };
      assert.throws(
        () => build(mutated),
        (error) => error?.code === "E_PROHIBITED_COMPONENT"
      );
    });
  }

  const versionRule = componentDefinition(definition, "version");
  if (versionRule?.requirement === "required") {
    test(`${type}: required version is enforced`, () => {
      const baseline = getBaseline(definition);
      const mutated = { ...baseline, version: null };
      assert.throws(
        () => build(mutated),
        (error) => error?.code === "E_REQUIRED_COMPONENT"
      );
    });
  }

  if (versionRule?.requirement === "prohibited") {
    test(`${type}: prohibited version is enforced`, () => {
      const baseline = getBaseline(definition);
      const mutated = { ...baseline, version: "1.0.0" };
      assert.throws(
        () => build(mutated),
        (error) => error?.code === "E_PROHIBITED_COMPONENT"
      );
    });
  }

  const requiredKeys = requiredQualifierKeys(definition);
  for (const key of requiredKeys) {
    test(`${type}: required qualifier ${key} is enforced`, () => {
      const baseline = getBaseline(definition);
      const qualifiers = { ...(baseline.qualifiers || {}) };
      delete qualifiers[key];

      assert.throws(
        () =>
          build({
            ...baseline,
            qualifiers: Object.keys(qualifiers).length ? qualifiers : null
          }),
        (error) => error?.code === "E_REQUIRED_QUALIFIER"
      );
    });
  }

  for (const componentKey of ["namespace", "name", "version"]) {
    const rule = componentDefinition(definition, componentKey);
    if (!rule?.permitted_characters || rule.requirement === "prohibited") {
      continue;
    }

    test(`${type}: permitted_characters are enforced for ${componentKey}`, () => {
      const baseline = getBaseline(definition);
      const badValue = mutateInvalidForPattern(rule.permitted_characters, baseline[componentKey]);
      if (badValue == null) {
        return;
      }

      const mutated = {
        ...baseline,
        [componentKey]: badValue
      };

      try {
        build(mutated);
      } catch (error) {
        assert.equal(error?.code, "E_PERMITTED_CHARACTERS");
      }
    });
  }
}
