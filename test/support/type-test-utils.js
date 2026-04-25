import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build, parse } from "../../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TYPES_DIR = path.join(__dirname, "..", "..", "specification", "types");

export function loadTypeDefinitions() {
  const files = readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith("-definition.json"))
    .sort();

  return files.map((fileName) => JSON.parse(readFileSync(path.join(TYPES_DIR, fileName), "utf8")));
}

export function componentDefinition(definition, key) {
  return definition[`${key}_definition`] || null;
}

export function qualifierDefaultValue(key) {
  if (key === "uuid") {
    return "123e4567-e89b-12d3-a456-426614174000";
  }
  if (key === "checksum") {
    return "sha256:abc123";
  }
  if (key === "repository_url" || key === "download_url" || key === "vcs_url") {
    return "https://example.com/repo";
  }
  if (key === "tag_id") {
    return "tag-0001";
  }
  return "value";
}

export function fallbackPartsForType(type) {
  const parts = {
    type,
    namespace: null,
    name: "example",
    version: null,
    qualifiers: null,
    subpath: null
  };

  if (
    [
      "alpm",
      "apk",
      "bitbucket",
      "composer",
      "cpan",
      "deb",
      "github",
      "golang",
      "maven",
      "qpkg",
      "rpm",
      "swift",
      "vscode-extension",
      "huggingface"
    ].includes(type)
  ) {
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

export function deriveSeedParts(definition) {
  for (const example of definition.examples || []) {
    try {
      return parse(example);
    } catch {
      // Ignore examples that intentionally do not match strict mode.
    }
  }

  const parts = fallbackPartsForType(definition.type);
  for (const key of ["namespace", "name", "version"]) {
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
      const key = String(entry.key || "").toLowerCase();
      parts.qualifiers[key] = qualifierDefaultValue(key);
    }
  }

  return parts;
}

export function ensureBuildable(parts) {
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

export function chooseAllowedNonChecksumQualifier(definition) {
  for (const entry of definition.qualifiers_definition || []) {
    const key = String(entry.key || "").toLowerCase();
    if (key && key !== "checksum") {
      return key;
    }
  }
  return "repository_url";
}

export function insertQualifier(input, entry) {
  const hashIndex = input.indexOf("#");
  const main = hashIndex >= 0 ? input.slice(0, hashIndex) : input;
  const hash = hashIndex >= 0 ? input.slice(hashIndex) : "";
  const joiner = main.includes("?") ? "&" : "?";
  return `${main}${joiner}${entry}${hash}`;
}

export function mutateInvalidForPattern(pattern, currentValue) {
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
