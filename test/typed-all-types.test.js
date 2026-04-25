import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as purlModule from "../index.js";
import {
  TypedPurlBuilders,
  TypedPurls,
  build,
  getTypedPurlBuilder,
  getTypedPurlClass
} from "../index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TYPES_DIR = path.join(__dirname, "..", "specification", "types");

function loadDefinitionTypes() {
  return readdirSync(TYPES_DIR)
    .filter((name) => name.endsWith("-definition.json"))
    .map((name) => JSON.parse(readFileSync(path.join(TYPES_DIR, name), "utf8")).type)
    .sort();
}

const ALL_TYPES = loadDefinitionTypes();

function typeToExportStem(type) {
  return type
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function minimalParts(type) {
  const defaults = {
    type,
    namespace: null,
    name: "example",
    version: null,
    qualifiers: null,
    subpath: null
  };

  switch (type) {
    case "alpm":
    case "apk":
    case "bitbucket":
    case "bitnami":
    case "cargo":
    case "cocoapods":
    case "composer":
    case "conan":
    case "cpan":
    case "deb":
    case "gem":
    case "github":
    case "golang":
    case "maven":
    case "rpm":
    case "swift":
    case "vscode-extension":
      defaults.namespace = "org";
      break;
    default:
      break;
  }

  if (type === "swift") {
    defaults.namespace = "github.com/org";
  }
  if (type === "cpan") {
    defaults.namespace = "AUTHOR1";
    defaults.name = "Dist-Name";
  }
  if (type === "chrome-extension") {
    defaults.name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  }

  return defaults;
}

function makeBuildableParts(type) {
  const parts = minimalParts(type);

  for (let i = 0; i < 8; i += 1) {
    try {
      build(parts);
      return parts;
    } catch (error) {
      const message = String(error.message || "");

      if (error.code === "E_REQUIRED_COMPONENT" && message.includes("namespace")) {
        if (type === "swift") {
          parts.namespace = "github.com/org";
        } else if (type === "cpan") {
          parts.namespace = "AUTHOR1";
        } else {
          parts.namespace = "org";
        }
        continue;
      }

      if (error.code === "E_PROHIBITED_COMPONENT" && message.includes("namespace")) {
        parts.namespace = null;
        continue;
      }

      if (error.code === "E_PERMITTED_CHARACTERS" && message.includes("name") && type === "chrome-extension") {
        parts.name = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
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

      throw error;
    }
  }

  return parts;
}

test("typed registries include all known types", () => {
  for (const type of ALL_TYPES) {
    assert.ok(TypedPurlBuilders[type], `missing builder for ${type}`);
    assert.ok(TypedPurls[type], `missing class for ${type}`);
    assert.equal(getTypedPurlBuilder(type), TypedPurlBuilders[type]);
    assert.equal(getTypedPurlClass(type), TypedPurls[type]);
  }
});

test("named typed exports exist and map to registries for all known types", () => {
  for (const type of ALL_TYPES) {
    const stem = typeToExportStem(type);
    const builderExportName = `${stem}PurlBuilder`;
    const purlExportName = `${stem}Purl`;

    const namedBuilder = purlModule[builderExportName];
    const namedPurl = purlModule[purlExportName];

    assert.ok(namedBuilder, `missing named builder export for ${type}`);
    assert.ok(namedPurl, `missing named purl export for ${type}`);

    // npm/maven/docker expose convenience subclasses while all other types are direct aliases.
    assert.ok(
      namedBuilder === TypedPurlBuilders[type] || namedBuilder.prototype instanceof TypedPurlBuilders[type],
      `named builder export mismatch for ${type}`
    );
    assert.ok(
      namedPurl === TypedPurls[type] || namedPurl.prototype instanceof TypedPurls[type],
      `named purl export mismatch for ${type}`
    );
  }
});

test("all typed builders can build canonical purls for minimal valid parts", () => {
  for (const type of ALL_TYPES) {
    const BuilderClass = TypedPurlBuilders[type];
    const builder = new BuilderClass();
    const parts = makeBuildableParts(type);

    builder
      .setName(parts.name)
      .setNamespace(parts.namespace)
      .setVersion(parts.version)
      .setQualifiers(parts.qualifiers)
      .setSubpath(parts.subpath);

    const built = builder.buildString();
    const expected = build(parts);
    assert.equal(built, expected, `builder mismatch for ${type}`);
  }
});

test("all typed classes parse their own type and reject mismatched types", () => {
  for (const type of ALL_TYPES) {
    const TypedClass = TypedPurls[type];
    const canonical = build(makeBuildableParts(type));

    const parsed = TypedClass.parse(canonical);
    assert.ok(parsed instanceof TypedClass, `parsed instance mismatch for ${type}`);

    const mismatchInput = "pkg:generic/example";
    if (type === "generic") {
      continue;
    }

    assert.throws(
      () => TypedClass.parse(mismatchInput),
      (error) => error && error.code === "E_TYPE_MISMATCH",
      `expected type mismatch rejection for ${type}`
    );
  }
});
