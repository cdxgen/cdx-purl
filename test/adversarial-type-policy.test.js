import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, parse } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TYPES_DIR = path.join(__dirname, "..", "specification", "types");

function readTypeDefinitions() {
  const files = readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith("-definition.json"))
    .sort();

  return files.map((fileName) => {
    const definition = JSON.parse(readFileSync(path.join(TYPES_DIR, fileName), "utf8"));
    return {
      type: definition.type,
      qualifiers: Array.isArray(definition.qualifiers_definition)
        ? definition.qualifiers_definition.map((entry) => String(entry.key || "").toLowerCase()).filter(Boolean)
        : []
    };
  });
}

const TYPE_DEFINITIONS = readTypeDefinitions();

function qualifierValueForKey(key) {
  if (key === "uuid") {
    return "123e4567-e89b-12d3-a456-426614174000";
  }
  if (key === "checksum") {
    return "sha256:abc123";
  }
  return "value";
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

function makeBuildableParts(type) {
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

      if (error.code === "E_PERMITTED_CHARACTERS" && message.includes("name") && type === "chrome-extension") {
        parts.name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        continue;
      }

      if (error.code === "E_REQUIRED_QUALIFIER") {
        const match = /Missing required qualifier:\s*([a-zA-Z0-9._-]+)/.exec(message);
        if (match && match[1]) {
          if (!parts.qualifiers) {
            parts.qualifiers = {};
          }
          parts.qualifiers[match[1]] = qualifierValueForKey(match[1]);
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

  throw new Error(`Could not derive buildable parts for type ${type}`);
}

function insertQualifier(input, entry) {
  const hashIndex = input.indexOf("#");
  const main = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const hash = hashIndex >= 0 ? input.slice(hashIndex) : "";
  const joiner = main.includes("?") ? "&" : "?";
  return `${main}${joiner}${entry}${hash}`;
}

test("adversarial: unknown qualifiers are rejected for all registered types", () => {
  for (const { type } of TYPE_DEFINITIONS) {
    const buildable = makeBuildableParts(type);

    assert.throws(
      () =>
        build({
          ...buildable,
          qualifiers: {
            ...(buildable.qualifiers || {}),
            not_allowed_for_type: "x"
          }
        }),
      (error) => error && error.code === "E_UNKNOWN_QUALIFIER",
      `expected unknown qualifier rejection for ${type}`
    );

    const canonical = build({
      ...buildable
    });
    const mutated = insertQualifier(canonical, "not_allowed_for_type=x");
    assert.throws(
      () => parse(mutated),
      (error) => error && error.code === "E_UNKNOWN_QUALIFIER",
      `expected parse-time unknown qualifier rejection for ${type}`
    );
  }
});

test("adversarial: comma-delimited qualifiers are rejected unless key is checksum", () => {
  for (const { type, qualifiers } of TYPE_DEFINITIONS) {
    const buildable = makeBuildableParts(type);
    const candidateKey = qualifiers.find((key) => key !== "checksum") || "repository_url";

    assert.throws(
      () =>
        build({
          ...buildable,
          qualifiers: {
            ...(buildable.qualifiers || {}),
            [candidateKey]: "left,right"
          }
        }),
      (error) => error && error.code === "E_MULTIVALUE_QUALIFIER",
      `expected multi-value qualifier rejection for ${type} (${candidateKey})`
    );
  }
});

test("adversarial: checksum multi-value remains accepted across all registered types", () => {
  for (const { type } of TYPE_DEFINITIONS) {
    const buildable = makeBuildableParts(type);
    const built = build({
      ...buildable,
      qualifiers: {
        ...(buildable.qualifiers || {}),
        checksum: "sha1:aaa,sha256:bbb"
      }
    });

    const parsed = parse(built);
    assert.equal(parsed.qualifiers?.checksum, "sha1:aaa,sha256:bbb", `expected checksum qualifier for ${type}`);
  }
});
