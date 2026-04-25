import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { build, parse, roundTrip } from "../index.js";

const ROOT = process.cwd();
const FIXTURES_ROOT = path.join(ROOT, "specification", "tests");

const GLOBAL_QUALIFIER_KEYS = new Set(["repository_url", "download_url", "vcs_url", "checksum"]);
const MULTI_VALUE_QUALIFIER_KEYS = new Set(["checksum"]);
const CHECKSUM_DIGEST_LENGTH_BY_ALGORITHM = Object.freeze({
  md5: 32,
  sha1: 40,
  sha224: 56,
  sha256: 64,
  sha384: 96,
  sha512: 128,
  "sha512-224": 56,
  "sha512-256": 64,
  "sha3-224": 56,
  "sha3-256": 64,
  "sha3-384": 96,
  "sha3-512": 128,
  "blake2s-256": 64,
  "blake2b-256": 64,
  "blake2b-384": 96,
  "blake2b-512": 128
});
const HEX_DIGEST_RE = /^[0-9A-Fa-f]+$/;
const EXTRA_COMPAT_QUALIFIER_KEYS_BY_TYPE = Object.freeze({
  conan: ["arch", "build_type", "compiler", "compiler.runtime", "compiler.version", "os", "shared"],
  deb: ["distro"],
  rpm: ["distro"]
});

let ALLOWED_QUALIFIERS_BY_TYPE = null;
let EXTRA_QUALIFIER_KEYS_BY_TYPE = null;

function buildExtraQualifierMap(allowedQualifierMap) {
  const map = new Map();

  for (const type of allowedQualifierMap.keys()) {
    map.set(type, new Set());
  }

  for (const [type, keys] of Object.entries(EXTRA_COMPAT_QUALIFIER_KEYS_BY_TYPE)) {
    map.set(type, new Set(keys));
  }

  return map;
}

function normalizeParts(parts) {
  return {
    type: parts.type,
    namespace: parts.namespace ?? null,
    name: parts.name,
    version: parts.version ?? null,
    qualifiers: parts.qualifiers ?? null,
    subpath: parts.subpath ?? null
  };
}

function hasStrictQualifierViolation(input) {
  if (typeof input !== "string") {
    return false;
  }

  const queryStart = input.indexOf("?");
  if (queryStart < 0) {
    return false;
  }

  const hashStart = input.indexOf("#", queryStart);
  const query = hashStart >= 0 ? input.slice(queryStart + 1, hashStart) : input.slice(queryStart + 1);
  if (!query) {
    return false;
  }

  const entries = query.split("&");
  for (const entry of entries) {
    const eq = entry.indexOf("=");
    if (eq < 0) {
      continue;
    }

    const rawValue = entry.slice(eq + 1);
    for (let i = 0; i < rawValue.length; i += 1) {
      const ch = rawValue[i];
      if (ch === "%") {
        i += 2;
        continue;
      }
      if (ch === "/" || ch === "+" || ch === "\\") {
        return true;
      }
    }
  }

  return false;
}

function hasStrictSubpathViolation(input) {
  if (typeof input !== "string") {
    return false;
  }

  const hashIndex = input.indexOf("#");
  if (hashIndex < 0) {
    return false;
  }

  const rawSubpath = input.slice(hashIndex + 1);
  for (let i = 0; i < rawSubpath.length; i += 1) {
    const ch = rawSubpath[i];
    if (ch === "%") {
      i += 2;
      continue;
    }
    if (ch === "+" || ch === "\\") {
      return true;
    }
  }

  return false;
}

function detectTypeFromEntry(entry) {
  if (entry.test_type === "build" && entry.input && typeof entry.input === "object") {
    return String(entry.input.type || "").toLowerCase() || null;
  }

  if (typeof entry.input !== "string" || !entry.input.startsWith("pkg:")) {
    return null;
  }

  const rest = entry.input.slice(4).replace(/^\/+/, "");
  const slash = rest.indexOf("/");
  return slash > 0 ? rest.slice(0, slash).toLowerCase() : null;
}

function qualifiersFromEntry(entry) {
  if (entry.test_type === "build" && entry.input && typeof entry.input === "object") {
    return entry.input.qualifiers || null;
  }
  if (entry.test_type === "parse" && entry.expected_output) {
    return entry.expected_output.qualifiers || null;
  }

  if (entry.test_type === "roundtrip" && typeof entry.input === "string") {
    const qIndex = entry.input.indexOf("?");
    if (qIndex < 0) {
      return null;
    }
    const hashIndex = entry.input.indexOf("#", qIndex);
    const query = hashIndex >= 0 ? entry.input.slice(qIndex + 1, hashIndex) : entry.input.slice(qIndex + 1);
    if (!query) {
      return null;
    }

    const out = {};
    for (const pair of query.split("&")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) {
        continue;
      }
      const key = pair.slice(0, eq).toLowerCase();
      const rawValue = pair.slice(eq + 1);
      try {
        out[key] = decodeURIComponent(rawValue);
      } catch {
        out[key] = rawValue;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  return null;
}

function hasUnknownQualifierViolation(entry) {
  const type = detectTypeFromEntry(entry);
  if (!type) {
    return false;
  }

  const qualifiers = qualifiersFromEntry(entry);
  if (!qualifiers) {
    return false;
  }

  const allowed = ALLOWED_QUALIFIERS_BY_TYPE.get(type) || new Set();
  const extras = EXTRA_QUALIFIER_KEYS_BY_TYPE?.get(type) || new Set();

  for (const key of Object.keys(qualifiers)) {
    const normalized = key.toLowerCase();
    if (allowed.has(normalized) || GLOBAL_QUALIFIER_KEYS.has(normalized) || extras.has(normalized)) {
      continue;
    }
    return true;
  }

  return false;
}

function hasDisallowedMultivalueQualifier(entry) {
  const qualifiers = qualifiersFromEntry(entry);
  if (!qualifiers) {
    return false;
  }

  for (const [key, value] of Object.entries(qualifiers)) {
    if (typeof value !== "string") {
      continue;
    }
    if (value.includes(",") && !MULTI_VALUE_QUALIFIER_KEYS.has(key.toLowerCase())) {
      return true;
    }
  }

  return false;
}

function hasInvalidChecksumQualifier(entry) {
  const qualifiers = qualifiersFromEntry(entry);
  if (!qualifiers || typeof qualifiers.checksum !== "string") {
    return false;
  }

  const entries = qualifiers.checksum.split(",");
  for (const entryValue of entries) {
    const token = entryValue.trim();
    const colon = token.indexOf(":");
    if (colon <= 0) {
      return true;
    }

    const algorithm = token.slice(0, colon).toLowerCase();
    const digest = token.slice(colon + 1);
    const expectedLength = CHECKSUM_DIGEST_LENGTH_BY_ALGORITHM[algorithm];
    if (!expectedLength || digest.length !== expectedLength || !HEX_DIGEST_RE.test(digest)) {
      return true;
    }
  }

  return false;
}

function strictExpectedFailure(entry) {
  if (entry.expected_failure) {
    return true;
  }

  // User-confirmed strict ABNF policy: reserved separators in qualifier values must be percent-encoded.
  if (hasStrictQualifierViolation(entry.input)) {
    return true;
  }

  if (hasStrictSubpathViolation(entry.input)) {
    return true;
  }

  if (hasUnknownQualifierViolation(entry)) {
    return true;
  }

  if (hasDisallowedMultivalueQualifier(entry)) {
    return true;
  }

  if (hasInvalidChecksumQualifier(entry)) {
    return true;
  }

  return false;
}

async function fixtureFiles() {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith("-test.json")) {
        files.push(fullPath);
      }
    }
  }

  await walk(FIXTURES_ROOT);
  return files.sort();
}

async function loadBaseTests() {
  const files = await fixtureFiles();
  const all = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);

    for (const entry of parsed.tests ?? []) {
      if (entry.test_group !== "base") {
        continue;
      }
      all.push({ filePath, entry });
    }
  }

  return all;
}

async function loadAllowedQualifierMap() {
  const map = new Map();
  const typesDir = path.join(ROOT, "specification", "types");
  const files = await readdir(typesDir, { withFileTypes: true });

  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith("-definition.json")) {
      continue;
    }

    const filePath = path.join(typesDir, entry.name);
    const raw = await readFile(filePath, "utf8");
    const definition = JSON.parse(raw);
    const keys = new Set((definition.qualifiers_definition || []).map((q) => String(q.key || "").toLowerCase()));
    map.set(definition.type, keys);
  }

  return map;
}

ALLOWED_QUALIFIERS_BY_TYPE = await loadAllowedQualifierMap();
EXTRA_QUALIFIER_KEYS_BY_TYPE = buildExtraQualifierMap(ALLOWED_QUALIFIERS_BY_TYPE);
const baseTests = await loadBaseTests();

for (const { filePath, entry } of baseTests) {
  const label = `${path.relative(ROOT, filePath)} :: ${entry.test_type} :: ${entry.description}`;

  test(label, () => {
    const expectFailure = strictExpectedFailure(entry);

    if (entry.test_type === "parse") {
      if (expectFailure) {
        assert.throws(() => parse(entry.input));
        return;
      }

      const actual = normalizeParts(parse(entry.input));
      assert.deepEqual(actual, entry.expected_output);
      return;
    }

    if (entry.test_type === "build") {
      if (expectFailure) {
        assert.throws(() => build(entry.input));
        return;
      }

      const actual = build(entry.input);
      assert.equal(actual, entry.expected_output);
      return;
    }

    if (entry.test_type === "roundtrip") {
      if (expectFailure) {
        assert.throws(() => roundTrip(entry.input));
        return;
      }

      const actual = roundTrip(entry.input);
      assert.equal(actual, entry.expected_output);

      // Repeated canonicalization must be stable and lossless.
      let current = actual;
      for (let i = 0; i < 5; i += 1) {
        current = roundTrip(current);
        assert.equal(current, entry.expected_output);
      }

      // Explicit string -> object -> string cycles should also stay stable.
      for (let i = 0; i < 3; i += 1) {
        const rebuilt = build(parse(current));
        assert.equal(rebuilt, entry.expected_output);
        current = rebuilt;
      }
      return;
    }

    throw new Error(`Unsupported test_type: ${entry.test_type}`);
  });
}
