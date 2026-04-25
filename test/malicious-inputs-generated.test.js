import assert from "node:assert/strict";
import test from "node:test";

import { parse, build } from "../index.js";
import { deriveSeedParts, ensureBuildable, insertQualifier, loadTypeDefinitions } from "./support/type-test-utils.js";

const DEFINITIONS = loadTypeDefinitions();
const BASELINES = new Map();

function getBaseline(definition) {
  const cached = BASELINES.get(definition.type);
  if (cached) {
    return {
      ...cached,
      qualifiers: cached.qualifiers ? { ...cached.qualifiers } : null
    };
  }

  const baseline = ensureBuildable(deriveSeedParts(definition));
  BASELINES.set(definition.type, baseline);
  return {
    ...baseline,
    qualifiers: baseline.qualifiers ? { ...baseline.qualifiers } : null
  };
}

function withRawName(definition, rawName) {
  const canonical = build(getBaseline(definition));
  const body = canonical.slice(4);
  const at = body.indexOf("@");
  const q = body.indexOf("?");
  const h = body.indexOf("#");
  const indexes = [at, q, h].filter((value) => value >= 0);
  const cut = indexes.length ? Math.min(...indexes) : body.length;

  const pathPart = body.slice(0, cut);
  const suffix = body.slice(cut);
  const lastSlash = pathPart.lastIndexOf("/");
  return `pkg:${pathPart.slice(0, lastSlash + 1)}${rawName}${suffix}`;
}

function withRawVersion(definition, rawVersion) {
  const canonical = build(getBaseline(definition));
  const body = canonical.slice(4);
  const q = body.indexOf("?");
  const h = body.indexOf("#");
  const indexes = [q, h].filter((value) => value >= 0);
  const cut = indexes.length ? Math.min(...indexes) : body.length;

  const main = body.slice(0, cut);
  const suffix = body.slice(cut);
  const pathOnly = main.includes("@") ? main.slice(0, main.indexOf("@")) : main;
  return `pkg:${pathOnly}@${rawVersion}${suffix}`;
}

for (const definition of DEFINITIONS) {
  const type = definition.type;

  test(`${type}: malicious raw newline in name is rejected`, () => {
    const input = withRawName(definition, "evil\nname");
    assert.throws(
      () => parse(input),
      (error) => error?.code === "E_INVALID_CHARACTER"
    );
  });

  test(`${type}: malformed qualifier list with empty entry is rejected`, () => {
    const canonical = build(getBaseline(definition));
    const base = canonical.includes("?") ? canonical.replace("?", "?x=1&&") : `${canonical}?x=1&&y=2`;

    assert.throws(
      () => parse(base),
      (error) => error?.code === "E_INVALID_QUALIFIERS"
    );
  });

  test(`${type}: malicious qualifier missing equals is rejected`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(canonical, "badQualifier");

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_INVALID_QUALIFIER"
    );
  });

  test(`${type}: unescaped separator characters in qualifier value are rejected`, () => {
    const canonical = build(getBaseline(definition));
    const mutated = insertQualifier(canonical, "repository_url=https://example.com/repo");

    assert.throws(
      () => parse(mutated),
      (error) => ["E_INVALID_CHARACTER", "E_UNKNOWN_QUALIFIER"].includes(error?.code)
    );
  });

  test(`${type}: malicious second @ in version is rejected`, () => {
    const mutated = withRawVersion(definition, "1@2");

    assert.throws(
      () => parse(mutated),
      (error) => error?.code === "E_INVALID_CHARACTER"
    );
  });
}
