#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTypeRuleSource, renderTypeRulesModule } from "./generate-type-rules.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..");
const GENERATED_FILE = path.join(ROOT, "generated", "type-rules.js");

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

let expected = "";
try {
  expected = renderTypeRulesModule(loadTypeRuleSource());
} catch (error) {
  console.error(`Failed to compute generated type rules: ${error?.message || error}`);
  process.exit(1);
}
let current = "";

try {
  current = readFileSync(GENERATED_FILE, "utf8");
} catch {
  console.error("generated/type-rules.js is missing. Run: node scripts/generate-type-rules.mjs");
  process.exit(1);
}

if (normalizeLineEndings(current) !== normalizeLineEndings(expected)) {
  console.error("generated/type-rules.js is stale. Run: node scripts/generate-type-rules.mjs");
  process.exit(1);
}

console.log("generated/type-rules.js is up to date.");

