#!/usr/bin/env node
'use strict';

// Validates this repo's auth-config.json before electron-builder packages it.
// Runs as a pre-step of each `dist:*` script in package.json.
//
// Requirements: auth-config.json must exist in the repo root and contain a
// populated `prod` block with all fields below set to non-placeholder values.
//
// To create the file, copy auth-config.example.json to auth-config.json and
// fill in real values for the `prod` block.

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.join(ROOT, 'auth-config.json');

if (!fs.existsSync(CONFIG)) {
  console.error(`prebuild-config: ${CONFIG} not found.`);
  console.error('Copy auth-config.example.json to auth-config.json and fill in the prod block.');
  process.exit(1);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
} catch (err) {
  console.error(`prebuild-config: cannot parse ${CONFIG}: ${err.message}`);
  process.exit(1);
}

const prod = parsed.prod;
if (!prod || typeof prod !== 'object') {
  console.error(`prebuild-config: ${CONFIG} has no "prod" block.`);
  process.exit(1);
}

const required = [
  'githubClientId',
  'contentRepo',
  'contentBranch',
];
const missing = required.filter((k) => !prod[k]);
if (missing.length) {
  console.error(`prebuild-config: prod block missing fields: ${missing.join(', ')}`);
  process.exit(1);
}

console.log('prebuild-config: auth-config.json prod block is valid.');
