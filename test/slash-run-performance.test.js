import assert from "node:assert/strict";
import test from "node:test";

import { parse } from "../index.js";

// A long run of "/" followed by another character makes a trailing-slash
// regex such as /\/+$/ backtrack quadratically, so these inputs keep the
// slash trimming linear.
const SLASH_RUN = "/".repeat(200_000);
const TIME_BUDGET_MS = 1000;

function parseTimed(input) {
  const start = performance.now();
  const parsed = parse(input);
  const elapsed = performance.now() - start;
  return { parsed, elapsed };
}

test("long slash run inside subpath is parsed in linear time", () => {
  const { parsed, elapsed } = parseTimed(`pkg:npm/foo#a${SLASH_RUN}b`);

  assert.equal(parsed.name, "foo");
  assert.equal(parsed.subpath, "a/b");
  assert.ok(elapsed < TIME_BUDGET_MS, `subpath parse took ${elapsed.toFixed(1)} ms`);
});

test("long slash run before the name is parsed in linear time", () => {
  const { parsed, elapsed } = parseTimed(`pkg:npm/${SLASH_RUN}foo`);

  assert.equal(parsed.type, "npm");
  assert.equal(parsed.namespace, null);
  assert.equal(parsed.name, "foo");
  assert.ok(elapsed < TIME_BUDGET_MS, `leading slash parse took ${elapsed.toFixed(1)} ms`);
});

test("long slash run inside namespace is parsed in linear time", () => {
  const { parsed, elapsed } = parseTimed(`pkg:npm/a${SLASH_RUN}b/foo`);

  assert.equal(parsed.namespace, "a/b");
  assert.equal(parsed.name, "foo");
  assert.ok(elapsed < TIME_BUDGET_MS, `namespace parse took ${elapsed.toFixed(1)} ms`);
});
