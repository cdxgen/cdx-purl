import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TYPE_RULES_SOURCE } from "../generated/type-rules.js";
import { deriveNormalizationOps } from "../scripts/generate-type-rules.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const SPEC_TYPES_DIR = path.join(ROOT, "specification", "types");

function readSpecTypes() {
  const files = readdirSync(SPEC_TYPES_DIR)
    .filter((name) => name.endsWith("-definition.json"))
    .sort();

  const out = {};
  for (const fileName of files) {
    const definition = JSON.parse(readFileSync(path.join(SPEC_TYPES_DIR, fileName), "utf8"));
    out[definition.type] = definition;
  }
  return out;
}

test("generated type rules include all specification types and qualifier keys", () => {
  const specByType = readSpecTypes();
  const generatedTypes = Object.keys(TYPE_RULES_SOURCE).sort();
  const specTypes = Object.keys(specByType).sort();

  assert.deepEqual(generatedTypes, specTypes);

  for (const type of specTypes) {
    const specQualifierKeys = (specByType[type].qualifiers_definition || [])
      .map((entry) => String(entry.key || "").toLowerCase())
      .filter(Boolean)
      .sort();

    const generatedQualifierKeys = (TYPE_RULES_SOURCE[type].qualifiers || [])
      .map((entry) => String(entry.key || "").toLowerCase())
      .filter(Boolean)
      .sort();

    assert.deepEqual(generatedQualifierKeys, specQualifierKeys, `qualifier key drift for ${type}`);
  }

  assert.deepEqual(TYPE_RULES_SOURCE.pypi?.name?.normalizationOps || [], [
    "replace_dot_with_underscore",
    "replace_underscore_with_dash"
  ]);
  assert.deepEqual(TYPE_RULES_SOURCE.pub?.name?.normalizationOps || [], ["replace_non_alnum_with_underscore"]);
});

test("runtime works with only index.js and generated/type-rules.js", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "cdx-purl-self-contained-"));

  try {
    mkdirSync(path.join(tempRoot, "generated"), { recursive: true });
    cpSync(path.join(ROOT, "index.js"), path.join(tempRoot, "index.js"));
    cpSync(path.join(ROOT, "generated", "type-rules.js"), path.join(tempRoot, "generated", "type-rules.js"));

    const moduleUrl = pathToFileURL(path.join(tempRoot, "index.js")).href;
    const runtime = await import(moduleUrl);

    const built = runtime.build({
      type: "generic",
      namespace: null,
      name: "example",
      version: "1.0.0",
      qualifiers: { checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      subpath: null
    });

    assert.equal(
      built,
      "pkg:generic/example@1.0.0?checksum=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    );

    const parsed = runtime.parse(built);
    assert.equal(parsed.type, "generic");
    assert.equal(parsed.qualifiers?.checksum, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("generator normalization mapping: explicit no-op text is allowed and unknown text fails closed", () => {
  assert.deepEqual(deriveNormalizationOps(["Apply kebab-case"], "hackage.name"), ["apply_kebab_case"]);
  assert.deepEqual(
    deriveNormalizationOps(
      ["normalize version as specified in vercmp(8) at https://man.archlinux.org/man/vercmp.8#DESCRIPTION as part of alpm."],
      "alpm.version"
    ),
    []
  );
  assert.throws(
    () => deriveNormalizationOps(["brand new normalization semantics"], "example.name"),
    /Unknown normalization rule text for example.name/
  );
});

