#!/usr/bin/env node

import { TypedPurlBuilders, getAllowedQualifierKeysForType } from "../index.js";

const types = Object.keys(TypedPurlBuilders).sort();
const policy = {};

for (const type of types) {
  const allowed = getAllowedQualifierKeysForType(type);
  if (!(allowed instanceof Set)) {
    throw new Error(`Missing qualifier allow-list for type: ${type}`);
  }
  policy[type] = [...allowed].sort();
}

process.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);

