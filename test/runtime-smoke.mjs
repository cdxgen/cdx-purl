import assert from "node:assert/strict";

import { build, parse, roundTrip } from "../index.js";

const input = "pkg:npm/%40angular/animation@12.3.1";
const parsed = parse(input);

assert.equal(parsed.type, "npm");
assert.equal(parsed.namespace, "@angular");
assert.equal(parsed.name, "animation");
assert.equal(parsed.version, "12.3.1");

const rebuilt = build(parsed);
assert.equal(rebuilt, input);
assert.equal(roundTrip(input), input);

console.log("runtime smoke passed");

