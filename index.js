import { TYPE_RULES_SOURCE } from "./generated/type-rules.js";

const HEX_RE = /^[0-9A-Fa-f]{2}$/;
const TYPE_RE = /^[A-Za-z][A-Za-z0-9.-]*$/;
const QUALIFIER_KEY_RE = /^[A-Za-z][A-Za-z0-9._-]*$/;
const CANONICAL_TYPE_RE = /^[a-z][a-z0-9.-]*$/;
const CANONICAL_QUALIFIER_KEY_RE = /^[a-z][a-z0-9._-]*$/;

const LITERAL_SET = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:");

// Strict qualifier policy: keys must be known by type or global spec qualifiers.
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
// Compatibility exceptions kept outside type definitions; merged into QUALIFIER_POLICY_BY_TYPE.
const COMPAT_QUALIFIER_OVERRIDES_BY_TYPE = Object.freeze({
  conan: ["arch", "build_type", "compiler", "compiler.runtime", "compiler.version", "os", "shared"],
  deb: ["distro"],
  rpm: ["distro"]
});

function createError(code, message, input) {
  const error = new Error(message);
  error.name = "PurlError";
  error.code = code;
  if (typeof input === "string") {
    error.input = input;
  }
  return error;
}

function isHexPair(value, index) {
  return index + 2 < value.length && HEX_RE.test(value.slice(index + 1, index + 3));
}

function isGeneralPermEscapedByte(byte) {
  return (
    byte <= 0x1f ||
    (byte >= 0x20 && byte <= 0x2c) ||
    byte === 0x2f ||
    (byte >= 0x3b && byte <= 0x40) ||
    (byte >= 0x5b && byte <= 0x5e) ||
    byte === 0x60 ||
    (byte >= 0x7b && byte <= 0x7d) ||
    byte === 0x7f ||
    byte >= 0x80
  );
}

function isNamespacePermEscapedByte(byte) {
  return byte <= 0x1f || (byte >= 0x20 && byte <= 0x2c) || (byte >= 0x30 && byte <= 0xff);
}

function isSubpathPermEscapedByte(byte) {
  return byte <= 0x1f || (byte >= 0x20 && byte <= 0x2c) || (byte >= 0x30 && byte <= 0xff);
}

function validateRawComponent(raw, allowEscapeByte, label, input) {
  if (!raw || typeof raw !== "string") {
    throw createError("E_EMPTY_COMPONENT", `${label} is required`, input);
  }

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "%") {
      if (!isHexPair(raw, i)) {
        throw createError("E_BAD_PERCENT_ENCODING", `Invalid percent encoding in ${label}`, input);
      }
      const byte = Number.parseInt(raw.slice(i + 1, i + 3), 16);
      if (!allowEscapeByte(byte)) {
        throw createError("E_DISALLOWED_PERCENT_ENCODING", `Disallowed escaped byte in ${label}`, input);
      }
      i += 2;
      continue;
    }

    if (!LITERAL_SET.has(ch)) {
      throw createError("E_INVALID_CHARACTER", `Invalid character in ${label}`, input);
    }
  }
}

function decodeRawComponent(raw, label, input) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw createError("E_BAD_PERCENT_ENCODING", `Invalid percent encoding in ${label}`, input);
  }
}

function encodeComponent(value) {
  const bytes = new TextEncoder().encode(value);
  let out = "";
  for (const byte of bytes) {
    const ch = String.fromCharCode(byte);
    if (LITERAL_SET.has(ch)) {
      out += ch;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function parseQualifiers(rawQualifiers, input) {
  if (rawQualifiers == null) {
    return null;
  }
  if (rawQualifiers.length === 0) {
    throw createError("E_INVALID_QUALIFIERS", "Qualifiers must not be empty", input);
  }

  const out = {};
  for (const entry of rawQualifiers.split("&")) {
    if (!entry) {
      throw createError("E_INVALID_QUALIFIERS", "Invalid empty qualifier", input);
    }

    const eq = entry.indexOf("=");
    if (eq <= 0) {
      throw createError("E_INVALID_QUALIFIER", "Qualifier must use key=value form", input);
    }

    const rawKey = entry.slice(0, eq);
    const rawValue = entry.slice(eq + 1);

    if (!QUALIFIER_KEY_RE.test(rawKey)) {
      throw createError("E_INVALID_QUALIFIER_KEY", `Invalid qualifier key: ${rawKey}`, input);
    }
    if (!rawValue) {
      throw createError("E_INVALID_QUALIFIER_VALUE", `Invalid qualifier value for ${rawKey}`, input);
    }

    validateRawComponent(rawValue, isGeneralPermEscapedByte, `qualifier ${rawKey}`, input);

    const key = rawKey.toLowerCase();
    if (Object.hasOwn(out, key)) {
      throw createError("E_DUPLICATE_QUALIFIER", `Duplicate qualifier key: ${key}`, input);
    }

    out[key] = decodeRawComponent(rawValue, `qualifier ${rawKey}`, input);
  }

  return Object.keys(out).length ? out : null;
}

function parseSubpath(rawSubpath, input) {
  if (rawSubpath == null) {
    return null;
  }

  const stripped = rawSubpath.replace(/^\/+|\/+$/g, "");
  if (!stripped) {
    return null;
  }

  const normalized = [];
  for (const rawSegment of stripped.split(/\/+/).filter(Boolean)) {
    validateRawComponent(rawSegment, isSubpathPermEscapedByte, "subpath", input);
    const decoded = decodeRawComponent(rawSegment, "subpath", input);

    // Canonical subpaths do not keep standalone dot-segments.
    if (decoded === "." || decoded === "..") {
      continue;
    }
    normalized.push(decoded);
  }

  return normalized.length ? normalized.join("/") : null;
}

function parsePath(rawPath, input) {
  const withoutLeading = rawPath.replace(/^\/+/, "");
  if (!withoutLeading) {
    throw createError("E_MISSING_TYPE", "PURL type is required", input);
  }

  const withoutTrailing = withoutLeading.replace(/\/+$/, "");
  const slash = withoutTrailing.indexOf("/");
  if (slash <= 0) {
    throw createError("E_MISSING_NAME", "PURL name is required", input);
  }

  const rawType = withoutTrailing.slice(0, slash);
  const rawRemainder = withoutTrailing.slice(slash + 1);

  if (!TYPE_RE.test(rawType)) {
    throw createError("E_INVALID_TYPE", `Invalid PURL type: ${rawType}`, input);
  }

  const pieces = rawRemainder.split(/\/+/).filter(Boolean);
  if (!pieces.length) {
    throw createError("E_MISSING_NAME", "PURL name is required", input);
  }

  const rawName = pieces[pieces.length - 1];
  const rawNamespaceSegments = pieces.slice(0, -1);

  validateRawComponent(rawName, isGeneralPermEscapedByte, "name", input);
  const name = decodeRawComponent(rawName, "name", input);

  let namespace = null;
  if (rawNamespaceSegments.length) {
    namespace = rawNamespaceSegments
      .map((segment) => {
        validateRawComponent(segment, isNamespacePermEscapedByte, "namespace", input);
        return decodeRawComponent(segment, "namespace", input);
      })
      .join("/");
  }

  return {
    type: rawType.toLowerCase(),
    namespace,
    name
  };
}

function compileComponentRule(definition) {
  if (!definition) {
    return {
      requirement: "optional",
      caseSensitive: true,
      permittedPattern: null,
      normalizationOps: []
    };
  }

  const caseSensitive =
    typeof definition.caseSensitive === "boolean" ? definition.caseSensitive : definition.case_sensitive !== false;
  const permittedCharacters = definition.permittedCharacters ?? definition.permitted_characters ?? null;
  const normalizationOps = Array.isArray(definition.normalizationOps) ? definition.normalizationOps : [];

  return {
    requirement: definition.requirement ?? "optional",
    caseSensitive,
    permittedPattern: permittedCharacters ? new RegExp(permittedCharacters) : null,
    normalizationOps
  };
}

function loadTypeRulesFromSource(source) {
  const rules = new Map();

  for (const [type, definition] of Object.entries(source)) {
    const qualifiers = new Map();
    for (const qualifier of definition.qualifiers ?? []) {
      const key = String(qualifier.key || "").toLowerCase();
      if (!key) {
        continue;
      }
      qualifiers.set(key, {
        requirement: qualifier.requirement ?? "optional",
        defaultValue: qualifier.defaultValue ?? null
      });
    }

    rules.set(type, {
      namespace: compileComponentRule(definition.namespace),
      name: compileComponentRule(definition.name),
      version: compileComponentRule(definition.version),
      subpath: compileComponentRule(definition.subpath),
      qualifiers
    });
  }

  return rules;
}

const TYPE_RULES = loadTypeRulesFromSource(TYPE_RULES_SOURCE);

function buildQualifierPolicyByType(typeRules) {
  const map = {};

  for (const [type, rules] of typeRules.entries()) {
    const keys = new Set(rules.qualifiers.keys());
    for (const globalKey of GLOBAL_QUALIFIER_KEYS) {
      keys.add(globalKey);
    }
    map[type] = keys;
  }

  for (const [type, keys] of Object.entries(COMPAT_QUALIFIER_OVERRIDES_BY_TYPE)) {
    if (!map[type]) {
      map[type] = new Set();
      for (const globalKey of GLOBAL_QUALIFIER_KEYS) {
        map[type].add(globalKey);
      }
    }
    for (const key of keys) {
      map[type].add(String(key).toLowerCase());
    }
  }

  return Object.freeze(map);
}

const QUALIFIER_POLICY_BY_TYPE = buildQualifierPolicyByType(TYPE_RULES);

/**
 * Apply generated normalization opcodes to a string value in declared order.
 *
 * Opcode order is precomputed in `generated/type-rules.js` by the generator,
 * including precedence handling for conflicting rules such as PyPI dot/underscore
 * normalization. Runtime applies ops exactly as listed and fails closed on
 * unknown opcodes.
 *
 * Supported ops:
 * - `to_lowercase`
 * - `apply_kebab_case`
 * - `replace_underscore_with_dash`
 * - `replace_dot_with_underscore`
 * - `replace_non_alnum_with_underscore`
 *
 * @param {string} value
 * @param {string[]} normalizationOps
 * @returns {string}
 * @throws {Error} PurlError with code `E_UNKNOWN_NORMALIZATION_OP` for unknown ops.
 */
function applyNormalizationRules(value, normalizationOps) {
  let normalized = value;
  for (const op of normalizationOps) {
    if (op === "to_lowercase") {
      normalized = normalized.toLowerCase();
    } else if (op === "apply_kebab_case") {
      normalized = normalized.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    } else if (op === "replace_underscore_with_dash") {
      normalized = normalized.replace(/_/g, "-");
    } else if (op === "replace_dot_with_underscore") {
      normalized = normalized.replace(/\./g, "_");
    } else if (op === "replace_non_alnum_with_underscore") {
      normalized = normalized.toLowerCase().replace(/[^a-z0-9]/g, "_");
    } else {
      throw createError("E_UNKNOWN_NORMALIZATION_OP", `Unknown normalization operation: ${op}`);
    }
  }
  return normalized;
}

function normalizeByRule(value, rule) {
  if (value == null) {
    return null;
  }

  let normalized = String(value);
  if (!rule.caseSensitive) {
    normalized = normalized.toLowerCase();
  }
  if (rule.normalizationOps.length) {
    normalized = applyNormalizationRules(normalized, rule.normalizationOps);
  }

  return normalized;
}

function validateRequirement(label, requirement, value) {
  if (requirement === "required" && (value == null || value === "")) {
    throw createError("E_REQUIRED_COMPONENT", `${label} is required by type rules`);
  }
  if (requirement === "prohibited" && value != null) {
    throw createError("E_PROHIBITED_COMPONENT", `${label} is prohibited by type rules`);
  }
}

function validatePermittedCharacters(label, rule, value) {
  if (value == null || !rule.permittedPattern) {
    return;
  }
  if (!rule.permittedPattern.test(value)) {
    throw createError("E_PERMITTED_CHARACTERS", `${label} violates permitted_characters`);
  }
}

function applyCpanRules(parts) {
  if (parts.type !== "cpan") {
    return;
  }

  if (!parts.namespace || !/^[A-Z0-9]+$/.test(parts.namespace)) {
    throw createError("E_CPAN_NAMESPACE", "cpan namespace must use uppercase author ID");
  }
  if (parts.name.includes("::")) {
    throw createError("E_CPAN_NAME", "cpan distribution name must not contain ::");
  }
}

function applySwiftRules(parts) {
  if (parts.type !== "swift") {
    return;
  }

  // Swift namespace is host/user (at least one slash) and name is repository name.
  if (!parts.namespace || !parts.namespace.includes("/")) {
    throw createError("E_SWIFT_NAMESPACE", "swift namespace must include host and owner segments");
  }
}

function isQualifierAllowed(type, key, qualifierRules) {
  if (qualifierRules.has(key)) {
    return true;
  }
  const allowed = QUALIFIER_POLICY_BY_TYPE[type];
  return allowed ? allowed.has(key) : false;
}

function validateChecksumQualifierValue(value, input) {
  const entries = String(value).split(",");

  for (const entry of entries) {
    const token = entry.trim();
    const colon = token.indexOf(":");
    if (colon <= 0) {
      throw createError(
        "E_CHECKSUM_MISSING_ALGORITHM",
        "Checksum entries must use algorithm:digest format",
        input
      );
    }

    const algorithm = token.slice(0, colon).toLowerCase();
    const digest = token.slice(colon + 1);
    const expectedLength = CHECKSUM_DIGEST_LENGTH_BY_ALGORITHM[algorithm];

    if (!expectedLength || digest.length !== expectedLength || !HEX_DIGEST_RE.test(digest)) {
      throw createError(
        "E_CHECKSUM_INVALID_DIGEST_FOR_ALGORITHM",
        `Invalid checksum digest for algorithm ${algorithm}`,
        input
      );
    }
  }
}

function applyTypeRules(parts, input) {
  const rules = TYPE_RULES.get(parts.type);
  if (!rules) {
    return parts;
  }

  const out = {
    type: parts.type,
    namespace: normalizeByRule(parts.namespace, rules.namespace),
    name: normalizeByRule(parts.name, rules.name),
    version: normalizeByRule(parts.version, rules.version),
    qualifiers: parts.qualifiers ? { ...parts.qualifiers } : null,
    subpath: normalizeByRule(parts.subpath, rules.subpath)
  };

  validateRequirement("namespace", rules.namespace.requirement, out.namespace);
  validateRequirement("name", rules.name.requirement, out.name);
  validateRequirement("version", rules.version.requirement, out.version);
  validateRequirement("subpath", rules.subpath.requirement, out.subpath);

  validatePermittedCharacters("namespace", rules.namespace, out.namespace);
  validatePermittedCharacters("name", rules.name, out.name);
  validatePermittedCharacters("version", rules.version, out.version);

  for (const [key, qualifierRule] of rules.qualifiers.entries()) {
    if (qualifierRule.requirement === "required" && (!out.qualifiers || !Object.hasOwn(out.qualifiers, key))) {
      throw createError("E_REQUIRED_QUALIFIER", `Missing required qualifier: ${key}`, input);
    }
  }

  if (out.qualifiers) {
    for (const [key, value] of Object.entries(out.qualifiers)) {
      if (!isQualifierAllowed(out.type, key, rules.qualifiers)) {
        throw createError("E_UNKNOWN_QUALIFIER", `Unknown qualifier key for ${out.type}: ${key}`, input);
      }
      out.qualifiers[key] = String(value);
      if (!out.qualifiers[key]) {
        throw createError("E_INVALID_QUALIFIER_VALUE", `Invalid qualifier value for ${key}`, input);
      }
      if (out.qualifiers[key].includes(",") && !MULTI_VALUE_QUALIFIER_KEYS.has(key)) {
        throw createError("E_MULTIVALUE_QUALIFIER", `Multiple values are not allowed for qualifier ${key}`, input);
      }
      if (key === "checksum") {
        validateChecksumQualifierValue(out.qualifiers[key], input);
      }
    }
  }

  applyCpanRules(out);
  applySwiftRules(out);
  return out;
}

function normalizeNamespace(namespace) {
  if (namespace == null) {
    return null;
  }
  if (typeof namespace !== "string" || !namespace.trim()) {
    throw createError("E_INVALID_NAMESPACE", "Invalid namespace value");
  }

  const segments = namespace.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }
  return segments.join("/");
}

function normalizeQualifiers(qualifiers) {
  if (qualifiers == null) {
    return null;
  }
  if (typeof qualifiers !== "object" || Array.isArray(qualifiers)) {
    throw createError("E_INVALID_QUALIFIERS", "Qualifiers must be an object");
  }

  const out = {};
  for (const key of Object.keys(qualifiers).sort()) {
    if (!QUALIFIER_KEY_RE.test(key)) {
      throw createError("E_INVALID_QUALIFIER_KEY", `Invalid qualifier key: ${key}`);
    }
    const canonicalKey = key.toLowerCase();
    if (!CANONICAL_QUALIFIER_KEY_RE.test(canonicalKey)) {
      throw createError("E_INVALID_QUALIFIER_KEY", `Invalid qualifier key: ${key}`);
    }

    const value = qualifiers[key];
    if (typeof value !== "string" || !value.length) {
      throw createError("E_INVALID_QUALIFIER_VALUE", `Invalid qualifier value for ${key}`);
    }

    out[canonicalKey] = value;
  }

  return Object.keys(out).length ? out : null;
}

function normalizeSubpath(subpath) {
  if (subpath == null) {
    return null;
  }
  if (typeof subpath !== "string") {
    throw createError("E_INVALID_SUBPATH", "Subpath must be a string");
  }
  if (subpath.startsWith("/")) {
    throw createError(
      "E_INVALID_SUBPATH",
      'Absolute subpaths are not allowed; use a relative subpath like "a/b" instead of "/a/b"'
    );
  }
  if (subpath.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(subpath)) {
    throw createError(
      "E_INVALID_SUBPATH",
      'Absolute subpaths are not allowed; use a relative subpath like "a/b" instead of "/a/b"'
    );
  }

  const segments = subpath.split("/").filter(Boolean);
  const normalized = segments.filter((segment) => segment !== "." && segment !== "..");
  return normalized.length ? normalized.join("/") : null;
}

function canonicalizeParts(parts, input) {
  const canonicalType = String(parts.type || "").toLowerCase();
  if (!CANONICAL_TYPE_RE.test(canonicalType)) {
    throw createError("E_INVALID_TYPE", `Invalid PURL type: ${parts.type}`, input);
  }

  const name = parts.name;
  if (typeof name !== "string" || !name) {
    throw createError("E_MISSING_NAME", "PURL name is required", input);
  }

  const normalized = {
    type: canonicalType,
    namespace: normalizeNamespace(parts.namespace),
    name,
    version: parts.version == null ? null : String(parts.version),
    qualifiers: normalizeQualifiers(parts.qualifiers),
    subpath: normalizeSubpath(parts.subpath)
  };

  if (normalized.version != null && normalized.version.length === 0) {
    throw createError("E_MISSING_VERSION", "Version is empty", input);
  }

  return applyTypeRules(normalized, input);
}

/**
 * Parse a package-url string using strict ABNF and type policy validation.
 *
 * @param {string} input - Raw purl string, for example `pkg:npm/%40scope/name@1.2.3`.
 * @returns {{type: string, namespace: string | null, name: string, version: string | null, qualifiers: Record<string, string> | null, subpath: string | null}}
 * Canonical purl parts with normalized casing and ordering.
 * @throws {Error} Throws `PurlError` with a stable `code` when parsing or validation fails.
 */
export function parse(input) {
  if (typeof input !== "string") {
    throw createError("E_INVALID_INPUT", "PURL input must be a string");
  }
  if (!input.startsWith("pkg:")) {
    throw createError("E_INVALID_SCHEME", "PURL scheme must be pkg", input);
  }

  let rest = input.slice(4);

  let rawSubpath = null;
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    rawSubpath = rest.slice(hashIndex + 1);
    rest = rest.slice(0, hashIndex);
    if (rawSubpath.includes("#")) {
      throw createError("E_INVALID_SUBPATH", "PURL must contain at most one subpath separator", input);
    }
  }

  let rawQualifiers = null;
  const qIndex = rest.indexOf("?");
  if (qIndex >= 0) {
    rawQualifiers = rest.slice(qIndex + 1);
    rest = rest.slice(0, qIndex);
    if (rawQualifiers.includes("?")) {
      throw createError("E_INVALID_QUALIFIERS", "PURL must contain at most one qualifier separator", input);
    }
  }

  let rawVersion = null;
  const atIndex = rest.indexOf("@");
  if (atIndex >= 0) {
    rawVersion = rest.slice(atIndex + 1);
    rest = rest.slice(0, atIndex);
    if (!rawVersion) {
      throw createError("E_MISSING_VERSION", "Version is empty", input);
    }
    validateRawComponent(rawVersion, isGeneralPermEscapedByte, "version", input);
  }

  const pathParts = parsePath(rest, input);
  const parsed = {
    type: pathParts.type,
    namespace: pathParts.namespace,
    name: pathParts.name,
    version: rawVersion == null ? null : decodeRawComponent(rawVersion, "version", input),
    qualifiers: parseQualifiers(rawQualifiers, input),
    subpath: parseSubpath(rawSubpath, input)
  };

  return canonicalizeParts(parsed, input);
}

/**
 * Build a canonical package-url string from purl parts.
 *
 * @param {{type: string, namespace?: string | null, name: string, version?: string | null, qualifiers?: Record<string, string> | null, subpath?: string | null}} parts
 * Purl parts to canonicalize and encode.
 * @returns {string} Canonical `pkg:` string with sorted qualifiers and uppercase percent triplets.
 * @throws {Error} Throws `PurlError` with a stable `code` when parts are invalid.
 */
export function build(parts) {
  if (!parts || typeof parts !== "object") {
    throw createError("E_INVALID_PARTS", "PURL parts must be an object");
  }

  const canonical = canonicalizeParts(parts);
  const encodedNamespace = canonical.namespace
    ? canonical.namespace
        .split("/")
        .map((segment) => encodeComponent(segment))
        .join("/")
    : null;

  let out = `pkg:${canonical.type}/`;
  if (encodedNamespace) {
    out += `${encodedNamespace}/`;
  }
  out += encodeComponent(canonical.name);

  if (canonical.version != null) {
    out += `@${encodeComponent(canonical.version)}`;
  }

  if (canonical.qualifiers) {
    const qualifierString = Object.keys(canonical.qualifiers)
      .sort()
      .map((key) => `${key}=${encodeComponent(canonical.qualifiers[key])}`)
      .join("&");
    if (qualifierString) {
      out += `?${qualifierString}`;
    }
  }

  if (canonical.subpath) {
    const subpath = canonical.subpath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeComponent(segment))
      .join("/");
    if (subpath) {
      out += `#${subpath}`;
    }
  }

  return out;
}

/**
 * Parse and rebuild a purl string to its canonical strict form.
 *
 * @param {string} input - Raw purl string.
 * @returns {string} Canonical `pkg:` string.
 */
export function roundTrip(input) {
  return build(parse(input));
}

// Backward-compatible strict-suffixed aliases.
export const parsePurlStrict = parse;
export const buildPurlStrict = build;
export const roundTripPurlStrict = roundTrip;

/**
 * Immutable purl value object backed by strict canonicalization.
 */
export class Purl {
  /**
   * Create a new purl instance from parts.
   *
   * @param {{type: string, namespace?: string | null, name: string, version?: string | null, qualifiers?: Record<string, string> | null, subpath?: string | null}} parts
   */
  constructor(parts) {
    const canonical = canonicalizeParts(parts);
    this.type = canonical.type;
    this.namespace = canonical.namespace;
    this.name = canonical.name;
    this.version = canonical.version;
    this.qualifiers = canonical.qualifiers;
    this.subpath = canonical.subpath;
  }

  /**
   * Parse a raw purl string into a `Purl` instance.
   *
   * @param {string} input
   * @returns {Purl}
   */
  static parse(input) {
    return new Purl(parse(input));
  }

  /**
   * Build a `Purl` instance from parts.
   *
   * @param {{type: string, namespace?: string | null, name: string, version?: string | null, qualifiers?: Record<string, string> | null, subpath?: string | null}} parts
   * @returns {Purl}
   */
  static from(parts) {
    return new Purl(parts);
  }

  /**
   * Convert this purl to canonical parts.
   *
   * @returns {{type: string, namespace: string | null, name: string, version: string | null, qualifiers: Record<string, string> | null, subpath: string | null}}
   */
  toJSON() {
    return {
      type: this.type,
      namespace: this.namespace,
      name: this.name,
      version: this.version,
      qualifiers: this.qualifiers,
      subpath: this.subpath
    };
  }

  /**
   * Serialize this purl as a canonical string.
   *
   * @returns {string}
   */
  toString() {
    return build(this.toJSON());
  }
}

/**
 * Mutable fluent builder for strict purl creation.
 */
export class PurlBuilder {
  /**
   * @param {string | null} [type=null] - Optional fixed purl type for typed builders.
   */
  constructor(type = null) {
    this.parts = {
      type,
      namespace: null,
      name: null,
      version: null,
      qualifiers: null,
      subpath: null
    };
  }

  /**
   * Set the purl type.
   *
   * @param {string} type
   * @returns {this}
   */
  setType(type) {
    this.parts.type = type;
    return this;
  }

  /**
   * Set namespace, usually slash-delimited for multi-segment namespaces.
   *
   * @param {string | null} namespace
   * @returns {this}
   */
  setNamespace(namespace) {
    this.parts.namespace = namespace;
    return this;
  }

  /**
   * Set package name.
   *
   * @param {string} name
   * @returns {this}
   */
  setName(name) {
    this.parts.name = name;
    return this;
  }

  /**
   * Set version string.
   *
   * @param {string | null} version
   * @returns {this}
   */
  setVersion(version) {
    this.parts.version = version;
    return this;
  }

  /**
   * Set a single qualifier key/value pair.
   *
   * @param {string} key
   * @param {string} value
   * @returns {this}
   */
  setQualifier(key, value) {
    if (!this.parts.qualifiers) {
      this.parts.qualifiers = {};
    }
    this.parts.qualifiers[key] = value;
    return this;
  }

  /**
   * Replace the qualifier map.
   *
   * @param {Record<string, string> | null} qualifiers
   * @returns {this}
   */
  setQualifiers(qualifiers) {
    this.parts.qualifiers = qualifiers;
    return this;
  }

  /**
   * Set the purl subpath.
   *
   * @param {string | null} subpath
   * @returns {this}
   */
  setSubpath(subpath) {
    this.parts.subpath = subpath;
    return this;
  }

  /**
   * Build a `Purl` instance from current parts.
   *
   * @returns {Purl}
   */
  build() {
    return Purl.from(this.parts);
  }

  /**
   * Build a canonical purl string from current parts.
   *
   * @returns {string}
   */
  buildString() {
    return build(this.parts);
  }
}

function createTypeBuilderClass(type) {
  if (type === "npm") {
    return class extends PurlBuilder {
      constructor() {
        super(type);
      }

      /**
       * Set npm scope (namespace).
       *
       * @param {string | null} scope
       * @returns {this}
       */
      setScope(scope) {
        this.parts.namespace = scope;
        return this;
      }
    };
  }

  if (type === "maven") {
    return class extends PurlBuilder {
      constructor() {
        super(type);
      }

      /**
       * Set Maven groupId (namespace).
       *
       * @param {string | null} groupId
       * @returns {this}
       */
      setGroupId(groupId) {
        this.parts.namespace = groupId;
        return this;
      }

      /**
       * Set Maven artifactId (name).
       *
       * @param {string} artifactId
       * @returns {this}
       */
      setArtifactId(artifactId) {
        this.parts.name = artifactId;
        return this;
      }
    };
  }

  if (type === "docker") {
    return class extends PurlBuilder {
      constructor() {
        super(type);
      }

      /**
       * Set Docker image name.
       *
       * @param {string} image
       * @returns {this}
       */
      setImage(image) {
        this.parts.name = image;
        return this;
      }
    };
  }

  return class extends PurlBuilder {
    constructor() {
      super(type);
    }
  };
}

function createTypePurlClass(type, BuilderClass) {
  return class extends Purl {
    static builder() {
      return new BuilderClass();
    }

    static parse(input) {
      const parsed = parse(input);
      if (parsed.type !== type) {
        throw createError("E_TYPE_MISMATCH", `Expected purl type ${type} but got ${parsed.type}`, input);
      }
      return new this(parsed);
    }
  };
}

function buildTypedRegistries() {
  const builderRegistry = {};
  const purlRegistry = {};

  for (const type of [...TYPE_RULES.keys()].sort()) {
    const BuilderClass = createTypeBuilderClass(type);
    const PurlClass = createTypePurlClass(type, BuilderClass);
    builderRegistry[type] = BuilderClass;
    purlRegistry[type] = PurlClass;
  }

  return {
    builders: Object.freeze(builderRegistry),
    purls: Object.freeze(purlRegistry)
  };
}

const TYPED_REGISTRIES = buildTypedRegistries();

/**
 * Generated builder-class registry keyed by purl type.
 *
 * Example: `TypedPurlBuilders.npm`, `TypedPurlBuilders["vscode-extension"]`.
 */
export const TypedPurlBuilders = TYPED_REGISTRIES.builders;
/**
 * Generated typed-purl class registry keyed by purl type.
 *
 * Example: `TypedPurls.maven`, `TypedPurls.swift`.
 */
export const TypedPurls = TYPED_REGISTRIES.purls;

/**
 * Resolve a registered typed builder class by purl type.
 *
 * @param {string} type - Canonical lower-case purl type.
 * @returns {(new () => PurlBuilder) | null}
 */
export function getTypedPurlBuilder(type) {
  return TypedPurlBuilders[type] ?? null;
}

/**
 * Resolve a registered typed purl class by purl type.
 *
 * @param {string} type - Canonical lower-case purl type.
 * @returns {(typeof Purl) | null}
 */
export function getTypedPurlClass(type) {
  return TypedPurls[type] ?? null;
}

/**
 * Resolve the strict qualifier allow-list for a registered purl type.
 *
 * @param {string} type - Canonical lower-case purl type.
 * @returns {Set<string> | null}
 */
export function getAllowedQualifierKeysForType(type) {
  const allowed = QUALIFIER_POLICY_BY_TYPE[type];
  return allowed ? new Set(allowed) : null;
}

/**
 * Backward-compatible named exports for generated builder classes.
 *
 * These aliases are full classes produced from `specification/types/*-definition.json`.
 * They are not stubs. Each one inherits strict parse/build/type-rule validation.
 */
export const AlpmPurlBuilder = TypedPurlBuilders.alpm;
export const ApkPurlBuilder = TypedPurlBuilders.apk;
export const BazelPurlBuilder = TypedPurlBuilders.bazel;
export const BitbucketPurlBuilder = TypedPurlBuilders.bitbucket;
export const BitnamiPurlBuilder = TypedPurlBuilders.bitnami;
export const CargoPurlBuilder = TypedPurlBuilders.cargo;
export const ChromeExtensionPurlBuilder = TypedPurlBuilders["chrome-extension"];
export const CocoapodsPurlBuilder = TypedPurlBuilders.cocoapods;
export const ComposerPurlBuilder = TypedPurlBuilders.composer;
export const ConanPurlBuilder = TypedPurlBuilders.conan;
export const CondaPurlBuilder = TypedPurlBuilders.conda;
export const CpanPurlBuilder = TypedPurlBuilders.cpan;
export const CranPurlBuilder = TypedPurlBuilders.cran;
export const DebPurlBuilder = TypedPurlBuilders.deb;
export const DockerPurlBuilder = TypedPurlBuilders.docker;
export const GemPurlBuilder = TypedPurlBuilders.gem;
export const GenericPurlBuilder = TypedPurlBuilders.generic;
export const GithubPurlBuilder = TypedPurlBuilders.github;
export const GolangPurlBuilder = TypedPurlBuilders.golang;
export const HackagePurlBuilder = TypedPurlBuilders.hackage;
export const HexPurlBuilder = TypedPurlBuilders.hex;
export const HuggingfacePurlBuilder = TypedPurlBuilders.huggingface;
export const JuliaPurlBuilder = TypedPurlBuilders.julia;
export const LuarocksPurlBuilder = TypedPurlBuilders.luarocks;
export const MavenPurlBuilder = TypedPurlBuilders.maven;
export const MlflowPurlBuilder = TypedPurlBuilders.mlflow;
export const NpmPurlBuilder = TypedPurlBuilders.npm;
export const NugetPurlBuilder = TypedPurlBuilders.nuget;
export const OciPurlBuilder = TypedPurlBuilders.oci;
export const OpamPurlBuilder = TypedPurlBuilders.opam;
export const OtpPurlBuilder = TypedPurlBuilders.otp;
export const PubPurlBuilder = TypedPurlBuilders.pub;
export const PypiPurlBuilder = TypedPurlBuilders.pypi;
export const QpkgPurlBuilder = TypedPurlBuilders.qpkg;
export const RpmPurlBuilder = TypedPurlBuilders.rpm;
export const SwidPurlBuilder = TypedPurlBuilders.swid;
export const SwiftPurlBuilder = TypedPurlBuilders.swift;
export const VscodeExtensionPurlBuilder = TypedPurlBuilders["vscode-extension"];
export const YoctoPurlBuilder = TypedPurlBuilders.yocto;

/**
 * Backward-compatible named exports for generated typed purl classes.
 *
 * Each class is type-locked and enforces strict rules when parsing and building.
 */
export const AlpmPurl = TypedPurls.alpm;
export const ApkPurl = TypedPurls.apk;
export const BazelPurl = TypedPurls.bazel;
export const BitbucketPurl = TypedPurls.bitbucket;
export const BitnamiPurl = TypedPurls.bitnami;
export const CargoPurl = TypedPurls.cargo;
export const ChromeExtensionPurl = TypedPurls["chrome-extension"];
export const CocoapodsPurl = TypedPurls.cocoapods;
export const ComposerPurl = TypedPurls.composer;
export const ConanPurl = TypedPurls.conan;
export const CondaPurl = TypedPurls.conda;
export const CpanPurl = TypedPurls.cpan;
export const CranPurl = TypedPurls.cran;
export const DebPurl = TypedPurls.deb;
export const DockerPurl = TypedPurls.docker;
export const GemPurl = TypedPurls.gem;
export const GenericPurl = TypedPurls.generic;
export const GithubPurl = TypedPurls.github;
export const GolangPurl = TypedPurls.golang;
export const HackagePurl = TypedPurls.hackage;
export const HexPurl = TypedPurls.hex;
export const HuggingfacePurl = TypedPurls.huggingface;
export const JuliaPurl = TypedPurls.julia;
export const LuarocksPurl = TypedPurls.luarocks;
export const MavenPurl = TypedPurls.maven;
export const MlflowPurl = TypedPurls.mlflow;
export const NpmPurl = TypedPurls.npm;
export const NugetPurl = TypedPurls.nuget;
export const OciPurl = TypedPurls.oci;
export const OpamPurl = TypedPurls.opam;
export const OtpPurl = TypedPurls.otp;
export const PubPurl = TypedPurls.pub;
export const PypiPurl = TypedPurls.pypi;
export const QpkgPurl = TypedPurls.qpkg;
export const RpmPurl = TypedPurls.rpm;
export const SwidPurl = TypedPurls.swid;
export const SwiftPurl = TypedPurls.swift;
export const VscodeExtensionPurl = TypedPurls["vscode-extension"];
export const YoctoPurl = TypedPurls.yocto;

