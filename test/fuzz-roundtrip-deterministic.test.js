import assert from "node:assert/strict";
import test from "node:test";

import { build, parse, roundTrip } from "../index.js";

function readEnvInt(name, fallback, min, max) {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, parsed));
}

function createRng(seedInput) {
  let seed = seedInput >>> 0;
  return {
    next() {
      // xorshift32 PRNG for deterministic, dependency-free fuzzing.
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 0x100000000;
    },
    int(maxExclusive) {
      return Math.floor(this.next() * maxExclusive);
    },
    bool(probability = 0.5) {
      return this.next() < probability;
    },
    pick(values) {
      return values[this.int(values.length)];
    }
  };
}

const SEED = readEnvInt("PURL_FUZZ_SEED", 1337, 1, 0x7fffffff);
const CASES = readEnvInt("PURL_FUZZ_CASES", 300, 20, 5000);
const HOPS = readEnvInt("PURL_FUZZ_HOPS", 10, 2, 100);
const MUTATION_CASES = readEnvInt("PURL_FUZZ_MUTATION_CASES", 200, 20, 5000);

const TOKEN_POOL = [
  "alpha",
  "beta",
  "gamma",
  "delta",
  "omega",
  "naive",
  "cafe",
  "jalapeno",
  "東京",
  "例",
  "ßeta",
  "Δelta",
  "مرحبا",
  "😀",
  "🍣",
  "line break",
  "v1.2.3",
  "sha256:abcd1234",
  "A_B-C.D~x"
];

const PLATFORM_POOL = [
  "universal",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64"
];

function randomToken(rng) {
  return rng.pick(TOKEN_POOL);
}

function randomQualifierValue(rng) {
  const left = randomToken(rng);
  const right = randomToken(rng);
  const joiner = rng.pick(["/", ":", "?", "&", " @ ", "::"]);
  return `${left}${joiner}${right}`;
}

function randomSubpath(rng) {
  const count = 1 + rng.int(3);
  const segments = [];
  for (let i = 0; i < count; i += 1) {
    segments.push(randomToken(rng));
  }
  return segments.join("/");
}

function maybeVersion(rng) {
  return rng.bool(0.7) ? randomQualifierValue(rng) : null;
}

function makeGenericCase(rng) {
  const qualifiers = rng.bool(0.65)
    ? {
        repository_url: randomQualifierValue(rng),
        checksum: randomQualifierValue(rng)
      }
    : null;

  return {
    type: "generic",
    namespace: rng.bool(0.6) ? `${randomToken(rng)}/${randomToken(rng)}` : null,
    name: randomToken(rng),
    version: maybeVersion(rng),
    qualifiers,
    subpath: rng.bool(0.45) ? randomSubpath(rng) : null
  };
}

function makeNpmCase(rng) {
  const scope = rng.bool(0.6) ? `@${randomToken(rng).replace(/\s+/g, "-")}` : null;
  return {
    type: rng.bool(0.4) ? "NPM" : "npm",
    namespace: scope,
    name: randomToken(rng),
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.4) ? { vcs_url: randomQualifierValue(rng) } : null,
    subpath: rng.bool(0.2) ? randomSubpath(rng) : null
  };
}

function makeMavenCase(rng) {
  const left = randomToken(rng).replace(/\s+/g, "").replace(/[/:?&#@]/g, "");
  const right = randomToken(rng).replace(/\s+/g, "").replace(/[/:?&#@]/g, "");
  return {
    type: rng.bool(0.5) ? "MAVEN" : "maven",
    namespace: `${left}.${right}`,
    name: randomToken(rng).replace(/\s+/g, "-").replace(/[/:?&#@]/g, ""),
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.5)
      ? {
          classifier: randomToken(rng).replace(/\s+/g, "-"),
          repository_url: randomQualifierValue(rng)
        }
      : null,
    subpath: null
  };
}

function makeDockerCase(rng) {
  return {
    type: "docker",
    namespace: rng.bool(0.5) ? randomToken(rng).replace(/\s+/g, "-") : null,
    name: randomToken(rng).replace(/\s+/g, "-").replace(/[/:?&#@]/g, ""),
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.5) ? { repository_url: randomQualifierValue(rng) } : null,
    subpath: null
  };
}

function makePypiCase(rng) {
  return {
    type: rng.bool(0.5) ? "PYPI" : "pypi",
    namespace: null,
    name: randomToken(rng),
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.4) ? { file_name: `${randomToken(rng)}.tar.gz` } : null,
    subpath: null
  };
}

function makeSwiftCase(rng) {
  const owner = randomToken(rng).replace(/\s+/g, "").replace(/[/:?&#@]/g, "");
  const repo = randomToken(rng).replace(/\s+/g, "-").replace(/[/:?&#@]/g, "");

  return {
    type: "swift",
    namespace: `github.com/${owner}`,
    name: repo,
    version: maybeVersion(rng),
    qualifiers: null,
    subpath: null
  };
}

function makeCpanCase(rng) {
  const namespace = `AUTH${100 + rng.int(900)}`;
  const name = `Dist-${1 + rng.int(200)}-${rng.pick(["Core", "Util", "Pkg"])}`;
  return {
    type: "cpan",
    namespace,
    name,
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.4) ? { repository_url: randomQualifierValue(rng) } : null,
    subpath: null
  };
}

function makeVscodeCase(rng) {
  const publisher = randomToken(rng).replace(/\s+/g, "-");
  const name = randomToken(rng).replace(/\s+/g, "-");

  return {
    type: "vscode-extension",
    namespace: publisher,
    name,
    version: maybeVersion(rng),
    qualifiers: rng.bool(0.55) ? { platform: rng.pick(PLATFORM_POOL) } : null,
    subpath: null
  };
}

const PROFILE_FACTORIES = [
  makeGenericCase,
  makeNpmCase,
  makeMavenCase,
  makeDockerCase,
  makePypiCase,
  makeSwiftCase,
  makeCpanCase,
  makeVscodeCase
];

function makeCase(rng) {
  return rng.pick(PROFILE_FACTORIES)(rng);
}

function mutateAsciiCase(input, rng) {
  let out = "";
  for (const ch of input) {
    if (/[A-Za-z]/.test(ch) && rng.bool(0.6)) {
      out += rng.bool(0.5) ? ch.toLowerCase() : ch.toUpperCase();
    } else {
      out += ch;
    }
  }
  return out;
}

function mutatePathSeparators(input, rng) {
  return input.replace(/\//g, (match) => (rng.bool(0.35) ? "//" : match));
}

function mutateQuery(rawQuery, rng) {
  if (!rawQuery) {
    return rawQuery;
  }

  const entries = rawQuery.split("&").map((entry) => {
    const eq = entry.indexOf("=");
    if (eq <= 0) {
      return entry;
    }
    const key = entry.slice(0, eq);
    const value = entry.slice(eq + 1);
    return `${mutateAsciiCase(key, rng)}=${value}`;
  });

  if (entries.length > 1 && rng.bool(0.5)) {
    entries.reverse();
  }

  return entries.join("&");
}

function lowercasePercentTriplets(input, rng) {
  return input.replace(/%[0-9A-F]{2}/g, (triplet) => (rng.bool(0.7) ? triplet.toLowerCase() : triplet));
}

function mutateCanonicalParseable(canonical, rng) {
  let rest = canonical.slice(4);

  let rawSubpath = null;
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    rawSubpath = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
  }

  let rawQuery = null;
  const queryIndex = rest.indexOf("?");
  if (queryIndex >= 0) {
    rawQuery = rest.slice(queryIndex + 1);
    rest = rest.slice(0, queryIndex);
  }

  let rawVersion = null;
  const versionIndex = rest.indexOf("@");
  if (versionIndex >= 0) {
    rawVersion = rest.slice(versionIndex + 1);
    rest = rest.slice(0, versionIndex);
  }

  const slashIndex = rest.indexOf("/");
  const type = rest.slice(0, slashIndex);
  const afterType = rest.slice(slashIndex + 1);

  const mutatedType = mutateAsciiCase(type, rng);
  const separatorAfterType = "/".repeat(1 + rng.int(3));
  const mutatedAfterType = mutatePathSeparators(afterType, rng);
  const schemeSlashes = "/".repeat(1 + rng.int(3));

  let mutated = `pkg:${schemeSlashes}${mutatedType}${separatorAfterType}${mutatedAfterType}`;

  if (rawVersion != null) {
    mutated += `@${lowercasePercentTriplets(rawVersion, rng)}`;
  }
  if (rawQuery != null) {
    mutated += `?${mutateQuery(lowercasePercentTriplets(rawQuery, rng), rng)}`;
  }
  if (rawSubpath != null) {
    const mutatedSubpath = mutatePathSeparators(lowercasePercentTriplets(rawSubpath, rng), rng);
    mutated += `#${mutatedSubpath}`;
  }

  return mutated;
}

test(`deterministic fuzz roundtrip stability (seed=${SEED}, cases=${CASES}, hops=${HOPS})`, () => {
  const rng = createRng(SEED);

  for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
    const parts = makeCase(rng);
    const canonical = build(parts);

    // First parse/build must not alter canonical value.
    const firstRebuild = build(parse(canonical));
    assert.equal(
      firstRebuild,
      canonical,
      `seed=${SEED} case=${caseIndex} failed initial parse/build stability on ${canonical}`
    );

    // N-hop roundtrip stability check.
    let current = canonical;
    for (let hop = 0; hop < HOPS; hop += 1) {
      current = roundTrip(current);
      assert.equal(
        current,
        canonical,
        `seed=${SEED} case=${caseIndex} hop=${hop} drifted; expected ${canonical}, got ${current}`
      );
    }

    // Additional object->string cycles for determinism.
    for (let hop = 0; hop < Math.max(3, Math.floor(HOPS / 2)); hop += 1) {
      const rebuilt = build(parse(current));
      assert.equal(
        rebuilt,
        canonical,
        `seed=${SEED} case=${caseIndex} parse/build hop=${hop} drifted; expected ${canonical}, got ${rebuilt}`
      );
      current = rebuilt;
    }
  }
});

test(
  `deterministic mutation fuzz canonical convergence (seed=${SEED + 17}, cases=${MUTATION_CASES}, hops=${HOPS})`,
  () => {
    const rng = createRng(SEED + 17);

    for (let caseIndex = 0; caseIndex < MUTATION_CASES; caseIndex += 1) {
      const canonical = build(makeCase(rng));
      const mutatedInput = mutateCanonicalParseable(canonical, rng);

      const converged = roundTrip(mutatedInput);
      assert.equal(
        converged,
        canonical,
        `seed=${SEED + 17} case=${caseIndex} did not converge from mutated input ${mutatedInput}`
      );

      let current = mutatedInput;
      for (let hop = 0; hop < HOPS; hop += 1) {
        current = roundTrip(current);
        assert.equal(
          current,
          canonical,
          `seed=${SEED + 17} case=${caseIndex} hop=${hop} failed canonical convergence`
        );
      }

      const parsed = parse(mutatedInput);
      const rebuilt = build(parsed);
      assert.equal(
        rebuilt,
        canonical,
        `seed=${SEED + 17} case=${caseIndex} parse/build from mutated input was not canonical`
      );
    }
  }
);

