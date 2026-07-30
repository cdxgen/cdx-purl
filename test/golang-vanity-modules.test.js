import assert from "node:assert/strict";
import test from "node:test";

import { GolangPurlBuilder, build, parse, roundTrip } from "../index.js";

const VANITY_MODULES = [
  "go.opencensus.io",
  "go.uber.org",
  "gopkg.in",
  "k8s.io",
  "sigs.k8s.io",
  "go-simpler.org"
];

test("parses single-segment vanity Go module paths without a namespace", () => {
  for (const name of VANITY_MODULES) {
    const parsed = parse(`pkg:golang/${name}`);
    assert.equal(parsed.type, "golang");
    assert.equal(parsed.namespace, null);
    assert.equal(parsed.name, name);
  }
});

test("keeps version, qualifiers and subpath on vanity module purls", () => {
  const parsed = parse("pkg:golang/go.opencensus.io@v0.24.0#plugin/ochttp");
  assert.equal(parsed.namespace, null);
  assert.equal(parsed.name, "go.opencensus.io");
  assert.equal(parsed.version, "v0.24.0");
  assert.equal(parsed.subpath, "plugin/ochttp");
});

test("vanity module purls round-trip canonically", () => {
  for (const input of ["pkg:golang/go.opencensus.io", "pkg:golang/go.uber.org/zap@v1.27.0"]) {
    assert.equal(roundTrip(input), input);
  }
});

test("uppercase vanity module names are lowercased, not rejected", () => {
  assert.equal(parse("pkg:golang/Go.OpenCensus.IO").name, "go.opencensus.io");
});

test("builds vanity module purls without a namespace", () => {
  const purl = new GolangPurlBuilder().setName("go.opencensus.io").setVersion("v0.24.0").buildString();
  assert.equal(purl, "pkg:golang/go.opencensus.io@v0.24.0");

  assert.equal(build({ type: "golang", name: "k8s.io" }), "pkg:golang/k8s.io");
});

test("namespace is still required for non host-like golang names", () => {
  for (const input of ["pkg:golang/context", "pkg:golang/zap", "pkg:golang/go-uber"]) {
    assert.throws(() => parse(input), (error) => error.code === "E_REQUIRED_COMPONENT");
  }
});

test("malformed host-like golang names are rejected", () => {
  for (const name of ["go..io", ".go.io", "go.io.", "-go.io", "go.io-"]) {
    assert.throws(
      () => build({ type: "golang", name }),
      (error) => error.code === "E_REQUIRED_COMPONENT"
    );
  }
});

test("namespaced golang purls are unaffected", () => {
  const parsed = parse("pkg:golang/github.com/gorilla/context@234fd47e07d1004f0aed9c");
  assert.equal(parsed.namespace, "github.com/gorilla");
  assert.equal(parsed.name, "context");
});
