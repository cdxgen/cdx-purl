import assert from "node:assert/strict";
import test from "node:test";

import { TypedPurlBuilders, build, parse, roundTrip } from "../index.js";

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

const SEED = readEnvInt("PURL_TYPED_FUZZ_SEED", 4242, 1, 0x7fffffff);
const CASES = readEnvInt("PURL_TYPED_FUZZ_CASES", 240, 20, 5000);
const HOPS = readEnvInt("PURL_TYPED_FUZZ_HOPS", 8, 2, 100);
const TYPES = Object.keys(TypedPurlBuilders).sort();

const SAFE_TOKENS = ["alpha", "beta", "gamma", "delta", "tool", "lib", "pkg", "org", "core", "util"];

function token(rng) {
  return rng.pick(SAFE_TOKENS);
}

function randomHex(rng, length) {
  const chars = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[rng.int(chars.length)];
  }
  return out;
}

function randomChecksumValue(rng) {
  return rng.bool(0.5)
    ? `sha256:${randomHex(rng, 64)}`
    : `sha1:${randomHex(rng, 40)},sha256:${randomHex(rng, 64)}`;
}

function minimalParts(type) {
  const parts = {
    type,
    namespace: null,
    name: "example",
    version: null,
    qualifiers: null,
    subpath: null
  };

  if ([
    "alpm",
    "apk",
    "bitbucket",
    "bitnami",
    "cargo",
    "cocoapods",
    "composer",
    "conan",
    "cpan",
    "deb",
    "gem",
    "github",
    "golang",
    "maven",
    "rpm",
    "swift",
    "vscode-extension"
  ].includes(type)) {
    parts.namespace = "org";
  }

  if (type === "swift") {
    parts.namespace = "github.com/org";
  }

  if (type === "cpan") {
    parts.namespace = "AUTHOR1";
    parts.name = "Dist-Name";
  }

  if (type === "chrome-extension") {
    parts.name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  }

  return parts;
}

function fillRequiredParts(type) {
  const parts = minimalParts(type);

  for (let i = 0; i < 12; i += 1) {
    try {
      build(parts);
      return parts;
    } catch (error) {
      const message = String(error?.message || "");

      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("namespace")) {
        parts.namespace = type === "swift" ? "github.com/org" : type === "cpan" ? "AUTHOR1" : "org";
        continue;
      }
      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("version")) {
        parts.version = "1.0.0";
        continue;
      }
      if (error.code === "E_PROHIBITED_COMPONENT" && message.includes("namespace")) {
        parts.namespace = null;
        continue;
      }
      if (error.code === "E_PROHIBITED_COMPONENT" && message.includes("version")) {
        parts.version = null;
        continue;
      }
      if (error.code === "E_REQUIRED_QUALIFIER") {
        const match = /Missing required qualifier:\s*([a-zA-Z0-9._-]+)/.exec(message);
        const key = match ? match[1] : null;
        if (key) {
          if (!parts.qualifiers) {
            parts.qualifiers = {};
          }
          parts.qualifiers[key] = key === "uuid" ? "123e4567-e89b-12d3-a456-426614174000" : "value";
          continue;
        }
      }
      if (error.code === "E_CPAN_NAMESPACE") {
        parts.namespace = "AUTHOR1";
        continue;
      }
      if (error.code === "E_SWIFT_NAMESPACE") {
        parts.namespace = "github.com/org";
        continue;
      }

      throw error;
    }
  }

  throw new Error(`could not build baseline for ${type}`);
}

function mutateAsciiCase(input, rng) {
  let out = "";
  for (const ch of input) {
    if (/[A-Za-z]/.test(ch) && rng.bool(0.5)) {
      out += rng.bool(0.5) ? ch.toLowerCase() : ch.toUpperCase();
    } else {
      out += ch;
    }
  }
  return out;
}

function mutatePathSeparators(input, rng) {
  return input.replace(/\//g, (ch) => (rng.bool(0.2) ? `${ch}${ch}` : ch));
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

  let mutated = `pkg:${"/".repeat(1 + rng.int(2))}${mutateAsciiCase(type, rng)}/${mutatePathSeparators(afterType, rng)}`;

  if (rawVersion != null) {
    mutated += `@${rawVersion}`;
  }
  if (rawQuery != null) {
    const query = rawQuery
      .split("&")
      .map((entry) => {
        const eq = entry.indexOf("=");
        if (eq <= 0) {
          return entry;
        }
        return `${mutateAsciiCase(entry.slice(0, eq), rng)}=${entry.slice(eq + 1)}`;
      })
      .join("&");
    mutated += `?${query}`;
  }
  if (rawSubpath != null) {
    mutated += `#${mutatePathSeparators(rawSubpath, rng)}`;
  }

  return mutated;
}

function mutateChecksumQualifier(canonical, rawChecksum) {
  const hashIndex = canonical.indexOf("#");
  const main = hashIndex >= 0 ? canonical.slice(0, hashIndex) : canonical;
  const hash = hashIndex >= 0 ? canonical.slice(hashIndex) : "";

  if (!main.includes("?")) {
    return `${main}?checksum=${rawChecksum}${hash}`;
  }

  const [prefix, query] = main.split("?");
  const filtered = query
    .split("&")
    .filter(Boolean)
    .filter((entry) => !entry.toLowerCase().startsWith("checksum="));
  filtered.push(`checksum=${rawChecksum}`);
  return `${prefix}?${filtered.join("&")}${hash}`;
}

function randomizeBuildableParts(base, rng) {
  const parts = {
    ...base,
    qualifiers: base.qualifiers ? { ...base.qualifiers } : null
  };

  if (parts.namespace && parts.type !== "cpan" && parts.type !== "swift" && rng.bool(0.5)) {
    parts.namespace = `${parts.namespace}/${token(rng)}`;
  }

  if (
    parts.name &&
    parts.type !== "chrome-extension" &&
    /^[a-zA-Z0-9._-]+$/.test(parts.name) &&
    rng.bool(0.6)
  ) {
    parts.name = `${parts.name}-${token(rng)}`;
  }

  if (rng.bool(0.5)) {
    parts.qualifiers = {
      ...(parts.qualifiers || {}),
      checksum: randomChecksumValue(rng)
    };
  }

  return parts;
}

test(`deterministic typed fuzz convergence (seed=${SEED}, cases=${CASES}, hops=${HOPS})`, () => {
  const rng = createRng(SEED);
  const baselines = new Map();

  for (const type of TYPES) {
    baselines.set(type, fillRequiredParts(type));
  }

  for (let i = 0; i < CASES; i += 1) {
    const type = rng.pick(TYPES);
    const baseline = baselines.get(type);
    const parts = randomizeBuildableParts(baseline, rng);
    const canonical = build(parts);

    const mutated = mutateCanonicalParseable(canonical, rng);
    let current = mutated;

    for (let hop = 0; hop < HOPS; hop += 1) {
      current = roundTrip(current);
      assert.equal(current, canonical, `type=${type} seed=${SEED} case=${i} hop=${hop} drifted from canonical`);
    }
  }
});

test(`deterministic typed fuzz rejects invalid checksum payloads (seed=${SEED + 99}, cases=${CASES})`, () => {
  const rng = createRng(SEED + 99);
  const baselines = new Map();

  for (const type of TYPES) {
    baselines.set(type, fillRequiredParts(type));
  }

  for (let i = 0; i < CASES; i += 1) {
    const type = rng.pick(TYPES);
    const baseline = baselines.get(type);
    const canonical = build(randomizeBuildableParts(baseline, rng));

    const missingAlgorithm = mutateChecksumQualifier(canonical, randomHex(rng, 40));
    assert.throws(
      () => parse(missingAlgorithm),
      (error) => error?.code === "E_CHECKSUM_MISSING_ALGORITHM",
      `type=${type} seed=${SEED + 99} case=${i} expected missing algorithm rejection`
    );

    const invalidDigest = mutateChecksumQualifier(canonical, `sha256:${randomHex(rng, 12)}`);
    assert.throws(
      () => parse(invalidDigest),
      (error) => error?.code === "E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM",
      `type=${type} seed=${SEED + 99} case=${i} expected invalid digest rejection`
    );
  }
});

