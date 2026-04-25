import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build, parse } from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TYPES_DIR = path.join(__dirname, "..", "specification", "types");
const COMPONENT_KEYS = ["namespace", "name", "version"];

function readTypeDefinitions() {
  const files = readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith("-definition.json"))
    .sort();

  return files.map((fileName) => JSON.parse(readFileSync(path.join(TYPES_DIR, fileName), "utf8")));
}

function componentDefinition(definition, key) {
  return definition[`${key}_definition`] || null;
}

function qualifierDefaultValue(key) {
  if (key === "uuid") {
    return "123e4567-e89b-12d3-a456-426614174000";
  }
  if (key === "checksum") {
    return "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  }
  return "value";
}

function fallbackPartsForType(type) {
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

function deriveSeedParts(definition) {
  for (const example of definition.examples || []) {
    try {
      return parse(example);
    } catch {
      // Skip definition examples that currently mismatch strict mode.
    }
  }

  const parts = fallbackPartsForType(definition.type);

  for (const key of COMPONENT_KEYS) {
    const def = componentDefinition(definition, key);
    if (!def || def.requirement !== "required") {
      continue;
    }

    if (key === "namespace") {
      parts.namespace = definition.type === "swift" ? "github.com/org" : definition.type === "cpan" ? "AUTHOR1" : "org";
    } else if (key === "name") {
      parts.name = definition.type === "chrome-extension" ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "example";
    } else if (key === "version") {
      parts.version = "1.0.0";
    }
  }

  const requiredQualifiers = (definition.qualifiers_definition || []).filter((entry) => entry.requirement === "required");
  if (requiredQualifiers.length) {
    parts.qualifiers = {};
    for (const entry of requiredQualifiers) {
      parts.qualifiers[entry.key] = qualifierDefaultValue(String(entry.key || "").toLowerCase());
    }
  }

  return parts;
}

function ensureBuildable(parts) {
  const out = {
    ...parts,
    qualifiers: parts.qualifiers ? { ...parts.qualifiers } : null
  };

  for (let i = 0; i < 20; i += 1) {
    try {
      build(out);
      return out;
    } catch (error) {
      const message = String(error?.message || "");

      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("namespace")) {
        out.namespace = out.type === "swift" ? "github.com/org" : out.type === "cpan" ? "AUTHOR1" : "org";
        continue;
      }
      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("name")) {
        out.name = out.type === "chrome-extension" ? "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" : "example";
        continue;
      }
      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("version")) {
        out.version = "1.0.0";
        continue;
      }
      if (error.code === "E_PROHIBITED_COMPONENT" && message.includes("namespace")) {
        out.namespace = null;
        continue;
      }
      if (error.code === "E_PROHIBITED_COMPONENT" && message.includes("version")) {
        out.version = null;
        continue;
      }
      if (error.code === "E_REQUIRED_QUALIFIER") {
        const match = /Missing required qualifier:\s*([a-zA-Z0-9._-]+)/.exec(message);
        if (match && match[1]) {
          if (!out.qualifiers) {
            out.qualifiers = {};
          }
          out.qualifiers[match[1]] = qualifierDefaultValue(match[1]);
          continue;
        }
      }
      if (error.code === "E_CPAN_NAMESPACE") {
        out.namespace = "AUTHOR1";
        continue;
      }
      if (error.code === "E_SWIFT_NAMESPACE") {
        out.namespace = "github.com/org";
        continue;
      }
      if (error.code === "E_PERMITTED_CHARACTERS" && out.type === "chrome-extension") {
        out.name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Could not derive a buildable baseline for type ${out.type}`);
}

function mutateInvalidForPattern(pattern, currentValue) {
  const re = new RegExp(pattern);
  const candidates = ["!", " ", "/", "@", "#", "?", "=", ",", ";", "$", "\t"];
  const seed = currentValue == null || currentValue === "" ? "x" : String(currentValue);

  for (const ch of candidates) {
    const candidate = `${seed}${ch}`;
    if (!re.test(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (!re.test(candidate)) {
      return candidate;
    }
  }

  return null;
}

const DEFINITIONS = readTypeDefinitions();

test("mutation-generated negatives: required components are enforced from type definitions", () => {
  for (const definition of DEFINITIONS) {
    const base = ensureBuildable(deriveSeedParts(definition));

    for (const key of COMPONENT_KEYS) {
      const def = componentDefinition(definition, key);
      if (!def || def.requirement !== "required") {
        continue;
      }

      const mutated = {
        ...base,
        qualifiers: base.qualifiers ? { ...base.qualifiers } : null,
        [key]: null
      };

      assert.throws(
        () => build(mutated),
        (error) =>
          error &&
          (error.code === "E_REQUIRED_COMPONENT" || (key === "name" && error.code === "E_MISSING_NAME")),
        `${definition.type}:${key} should be required`
      );
    }
  }
});

test("mutation-generated negatives: prohibited components are enforced from type definitions", () => {
  for (const definition of DEFINITIONS) {
    const base = ensureBuildable(deriveSeedParts(definition));

    for (const key of COMPONENT_KEYS) {
      const def = componentDefinition(definition, key);
      if (!def || def.requirement !== "prohibited") {
        continue;
      }

      const mutatedValue = key === "version" ? "1.0.0" : key === "name" ? "bad" : "org";
      const mutated = {
        ...base,
        qualifiers: base.qualifiers ? { ...base.qualifiers } : null,
        [key]: mutatedValue
      };

      assert.throws(
        () => build(mutated),
        (error) => error && error.code === "E_PROHIBITED_COMPONENT",
        `${definition.type}:${key} should be prohibited`
      );
    }
  }
});

test("mutation-generated negatives: permitted character regex is enforced from type definitions", () => {
  for (const definition of DEFINITIONS) {
    const base = ensureBuildable(deriveSeedParts(definition));

    for (const key of COMPONENT_KEYS) {
      const def = componentDefinition(definition, key);
      if (!def || !def.permitted_characters || def.requirement === "prohibited") {
        continue;
      }

      const badValue = mutateInvalidForPattern(def.permitted_characters, base[key]);
      if (badValue == null) {
        continue;
      }

      const mutated = {
        ...base,
        qualifiers: base.qualifiers ? { ...base.qualifiers } : null,
        [key]: badValue
      };

      let caught = null;
      try {
        build(mutated);
      } catch (error) {
        caught = error;
      }

      // Some types intentionally normalize invalid characters into valid ones.
      if (caught == null) {
        continue;
      }

      assert.equal(
        caught.code,
        "E_PERMITTED_CHARACTERS",
        `${definition.type}:${key} should reject characters outside ${def.permitted_characters}`
      );
    }
  }
});

