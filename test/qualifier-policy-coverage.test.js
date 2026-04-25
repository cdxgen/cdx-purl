import assert from "node:assert/strict";
import test from "node:test";

import { build, getAllowedQualifierKeysForType, parse } from "../index.js";
import { deriveSeedParts, ensureBuildable, loadTypeDefinitions, qualifierDefaultValue } from "./support/type-test-utils.js";

const COMPAT_QUALIFIER_OVERRIDES_BY_TYPE = Object.freeze({
  conan: ["arch", "build_type", "compiler", "compiler.runtime", "compiler.version", "os", "shared"],
  deb: ["distro"],
  rpm: ["distro"]
});

const TYPE_DEFINITIONS = loadTypeDefinitions();
const DEFINITION_QUALIFIER_KEYS_BY_TYPE = new Map(
  TYPE_DEFINITIONS.map((definition) => [
    definition.type,
    new Set((definition.qualifiers_definition || []).map((entry) => String(entry.key || "").toLowerCase()).filter(Boolean))
  ])
);

const BUILDABLE_BASELINES = new Map(
  TYPE_DEFINITIONS.map((definition) => [definition.type, ensureBuildable(deriveSeedParts(definition))])
);

const GLOBAL_QUALIFIER_KEYS = new Set(["repository_url", "download_url", "vcs_url", "checksum"]);

function withQualifier(parts, key, value) {
  return {
    ...parts,
    qualifiers: {
      ...(parts.qualifiers || {}),
      [key]: value
    }
  };
}

test("qualifier policy: every definition qualifier is accepted by build and parse", () => {
  for (const definition of TYPE_DEFINITIONS) {
    const base = BUILDABLE_BASELINES.get(definition.type);

    for (const entry of definition.qualifiers_definition || []) {
      const key = String(entry.key || "").toLowerCase();
      if (!key) {
        continue;
      }

      const built = build(withQualifier(base, key, qualifierDefaultValue(key)));
      const parsed = parse(built);
      assert.equal(parsed.qualifiers?.[key], qualifierDefaultValue(key), `expected qualifier ${key} for ${definition.type}`);
    }
  }
});

test("qualifier policy map: includes all definition keys for every registered type", () => {
  for (const definition of TYPE_DEFINITIONS) {
    const allowed = getAllowedQualifierKeysForType(definition.type);
    assert.ok(allowed instanceof Set, `expected allow-list for ${definition.type}`);

    for (const globalKey of GLOBAL_QUALIFIER_KEYS) {
      assert.ok(allowed.has(globalKey), `missing global qualifier ${globalKey} for ${definition.type}`);
    }

    for (const entry of definition.qualifiers_definition || []) {
      const key = String(entry.key || "").toLowerCase();
      if (!key) {
        continue;
      }
      assert.ok(allowed.has(key), `missing definition qualifier ${key} for ${definition.type}`);
    }
  }

  assert.ok(
    getAllowedQualifierKeysForType("vscode-extension")?.has("platform"),
    "vscode-extension policy must include platform"
  );
  assert.ok(getAllowedQualifierKeysForType("alpm")?.has("arch"), "alpm policy must include arch");
});

test("qualifier policy: compatibility extras are accepted only for their intended types", () => {
  const compatKeys = new Set(Object.values(COMPAT_QUALIFIER_OVERRIDES_BY_TYPE).flat());

  for (const [type, keys] of Object.entries(COMPAT_QUALIFIER_OVERRIDES_BY_TYPE)) {
    const base = BUILDABLE_BASELINES.get(type);
    for (const key of keys) {
      const built = build(withQualifier(base, key, qualifierDefaultValue(key)));
      const parsed = parse(built);
      assert.equal(parsed.qualifiers?.[key], qualifierDefaultValue(key), `expected compatibility qualifier ${key} for ${type}`);
    }
  }

  for (const definition of TYPE_DEFINITIONS) {
    const type = definition.type;
    const base = BUILDABLE_BASELINES.get(type);
    const definitionKeys = DEFINITION_QUALIFIER_KEYS_BY_TYPE.get(type) || new Set();
    const compatKeysForType = new Set(COMPAT_QUALIFIER_OVERRIDES_BY_TYPE[type] || []);

    for (const key of compatKeys) {
      if (definitionKeys.has(key) || compatKeysForType.has(key)) {
        continue;
      }

      assert.throws(
        () => build(withQualifier(base, key, qualifierDefaultValue(key))),
        (error) => error && error.code === "E_UNKNOWN_QUALIFIER",
        `expected ${key} to be rejected for ${type}`
      );
    }
  }
});

test("qualifier policy: changing type does not bypass qualifier validation", () => {
  const canonicalAlpm = build({
    type: "alpm",
    namespace: "arch",
    name: "pacman",
    version: "6.0.1-1",
    qualifiers: { arch: "x86_64" }
  });

  const mutated = canonicalAlpm.replace("pkg:alpm/", "pkg:maven/");
  assert.throws(
    () => parse(mutated),
    (error) => error && error.code === "E_UNKNOWN_QUALIFIER",
    "expected maven parse rejection for alpm-only arch qualifier"
  );
});

