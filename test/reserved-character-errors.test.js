import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { build, parse, roundTrip } from "../index.js";

function specTests() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(file);
      } else if (file.endsWith("-test.json")) {
        for (const spec of JSON.parse(readFileSync(file, "utf8")).tests || []) {
          out.push({ file: entry.name, ...spec });
        }
      }
    }
  };
  walk(new URL("../specification/tests", import.meta.url).pathname);
  return out;
}

test("an unescaped character names its component, index and escape", () => {
  assert.throws(
    () => parse("pkg:npm/test-v13@1.0.0+major"),
    (error) => {
      assert.equal(error.code, "E_INVALID_CHARACTER");
      assert.equal(error.component, "version");
      assert.equal(error.index, 5);
      assert.equal(error.character, "+");
      assert.equal(error.encoded, "%2B");
      assert.equal(error.input, "pkg:npm/test-v13@1.0.0+major");
      assert.match(error.message, /Invalid character "\+" in version at index 5; percent-encode it as %2B/);
      return true;
    }
  );
});

test("a multi-byte or control character is reported with its UTF-8 escape", () => {
  assert.throws(
    () => parse("pkg:generic/café@1.0"),
    (error) =>
      error.code === "E_INVALID_CHARACTER" &&
      error.component === "name" &&
      error.character === "é" &&
      error.encoded === "%C3%A9"
  );
  assert.throws(
    () => parse("pkg:generic/x@1\n0"),
    (error) => error.code === "E_INVALID_CHARACTER" && error.encoded === "%0A" && error.message.includes('"\\n"')
  );
  assert.throws(
    () => parse("pkg:generic/x@1.0?vcs_url=git+https://example.com/x.git"),
    (error) =>
      error.code === "E_INVALID_CHARACTER" && error.component === "qualifier vcs_url" && error.encoded === "%2B"
  );
});

test("a needless or separator escape says which form to write", () => {
  assert.throws(
    () => parse("pkg:generic/%41bc@1.0"),
    (error) =>
      error.code === "E_DISALLOWED_PERCENT_ENCODING" &&
      error.component === "name" &&
      error.character === "%41" &&
      error.message.includes('write "A" literally')
  );
  assert.throws(
    () => parse("pkg:npm/%40scope%2Fx/y@1.0"),
    (error) =>
      error.code === "E_DISALLOWED_PERCENT_ENCODING" &&
      error.component === "namespace" &&
      error.character === "%2F" &&
      error.message.includes("separator")
  );
});

test("build escapes build metadata that parse then reads back unchanged", () => {
  const purl = build({ type: "npm", name: "test-v13", version: "1.0.0+major" });
  assert.equal(purl, "pkg:npm/test-v13@1.0.0%2Bmajor");
  assert.equal(parse(purl).version, "1.0.0+major");
  assert.equal(roundTrip(purl), purl);
});

// The upstream suite includes parse and roundtrip cases whose input leaves a
// `+` unescaped. The strict grammar (specification/purl-proposed-grammar.abnf)
// does not allow that, so cdx-purl rejects them instead of guessing. The only
// difference is the escaping: the escaped form of every such input yields
// exactly the upstream expectation.
test("upstream inputs with a literal + are rejected, and their escaped form matches upstream", () => {
  const cases = specTests().filter(
    (spec) =>
      ["parse", "roundtrip"].includes(spec.test_type) &&
      !spec.expected_failure &&
      typeof spec.input === "string" &&
      spec.input.includes("+")
  );
  assert.ok(cases.length > 0, "the upstream suite should still carry literal + cases");
  for (const spec of cases) {
    const label = `${spec.file} ${spec.test_group} ${spec.test_type}: ${spec.input}`;
    assert.throws(
      () => parse(spec.input),
      (error) => error.code === "E_INVALID_CHARACTER" && error.character === "+",
      label
    );
    const escaped = spec.input.replaceAll("+", "%2B");
    if (spec.test_type === "parse") {
      const parsed = parse(escaped);
      assert.deepEqual(
        {
          type: parsed.type,
          namespace: parsed.namespace,
          name: parsed.name,
          version: parsed.version,
          qualifiers: parsed.qualifiers,
          subpath: parsed.subpath
        },
        spec.expected_output,
        label
      );
    } else {
      assert.equal(roundTrip(escaped), spec.expected_output, label);
    }
  }
});
