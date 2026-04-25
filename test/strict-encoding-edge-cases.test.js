import assert from "node:assert/strict";
import test from "node:test";

import { build, parse, roundTrip } from "../index.js";

test("unicode encoded input survives repeated roundtrip cycles", () => {
  const input =
    "pkg:generic/%E4%BE%8B/%E5%90%8D%E5%89%8D@v%E2%82%AC?download_url=%F0%9F%98%80&vcs_url=%F0%9F%8D%A3#%E8%B7%AF%E5%BE%84/%C3%9F";

  const first = roundTrip(input);
  let current = first;
  for (let i = 0; i < 8; i += 1) {
    current = roundTrip(current);
    assert.equal(current, first);
  }
});

test("builder encodes unicode object parts and parse restores values", () => {
  const purl = build({
    type: "generic",
    namespace: "例/組織",
    name: "名前",
    version: "v€",
    qualifiers: {
      download_url: "😀",
      vcs_url: "東京"
    },
    subpath: "路径/ß"
  });

  assert.equal(
    purl,
    "pkg:generic/%E4%BE%8B/%E7%B5%84%E7%B9%94/%E5%90%8D%E5%89%8D@v%E2%82%AC?download_url=%F0%9F%98%80&vcs_url=%E6%9D%B1%E4%BA%AC#%E8%B7%AF%E5%BE%84/%C3%9F"
  );

  assert.deepEqual(parse(purl), {
    type: "generic",
    namespace: "例/組織",
    name: "名前",
    version: "v€",
    qualifiers: {
      download_url: "😀",
      vcs_url: "東京"
    },
    subpath: "路径/ß"
  });
});

test("canonical output normalizes lowercase percent triplets", () => {
  const input = "pkg:generic/acme/app@1.0.0?checksum=%e2%82%ac#%c3%9f";
  const out = roundTrip(input);
  assert.equal(out, "pkg:generic/acme/app@1.0.0?checksum=%E2%82%AC#%C3%9F");
});

test("strict ABNF rejects raw unicode in input purl", () => {
  assert.throws(() => parse("pkg:generic/例/名前@1.0.0"));
});

test("strict ABNF rejects malformed percent encoding", () => {
  assert.throws(() => parse("pkg:generic/acme/app@1.0.0?msg=%E2%82"));
  assert.throws(() => parse("pkg:generic/acme/app@1.0.0?msg=%ZZ"));
});

test("strict ABNF rejects percent-encoding of unreserved bytes", () => {
  assert.throws(() => parse("pkg:generic/acme/%61pp@1.0.0"));
  assert.throws(() => parse("pkg:generic/acme/app@%31.0.0"));
});

test("strict ABNF rejects unescaped separators in qualifier values", () => {
  assert.throws(() => parse("pkg:generic/acme/app?repository_url=https://example.com/repo"));
});

test("strict ABNF accepts escaped separators in qualifier values", () => {
  const input = "pkg:generic/acme/app?repository_url=https:%2F%2Fexample.com%2Frepo";
  const parsed = parse(input);
  assert.deepEqual(parsed.qualifiers, {
    repository_url: "https://example.com/repo"
  });

  const rebuilt = build(parsed);
  assert.equal(rebuilt, input);
});

test("phase 2 rejects qualifier keys not allowed by type policy", () => {
  assert.throws(() =>
    parse("pkg:maven/org.apache.commons/io@1.3.4?mykey=my%20value")
  );

  assert.throws(() =>
    build({
      type: "maven",
      namespace: "org.apache.commons",
      name: "io",
      version: "1.3.4",
      qualifiers: { mykey: "my value" },
      subpath: null
    })
  );
});

test("phase 2 rejects multi-value qualifiers unless explicitly allowed", () => {
  assert.throws(() =>
    build({
      type: "maven",
      namespace: "org.apache.commons",
      name: "io",
      version: "1.3.4",
      qualifiers: { classifier: "sources,docs" },
      subpath: null
    })
  );

  const checksumPurl = build({
    type: "generic",
    namespace: null,
    name: "openssl",
    version: "1.1.10g",
    qualifiers: { checksum: "sha1:aaa,sha256:bbb" },
    subpath: null
  });

  assert.equal(checksumPurl, "pkg:generic/openssl@1.1.10g?checksum=sha1:aaa%2Csha256:bbb");
});
