'use strict';

const fs = require('fs');
const path = require('path');

function readPayload() {
  const rawPayload = fs.readFileSync(0, 'utf8');
  const normalizedPayload = String(rawPayload || '').trim();
  return normalizedPayload ? JSON.parse(normalizedPayload) : {};
}

function resolveEvaluateAutofixGuard() {
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  return require(path.join(repoRoot, 'lib', 'autofix-guard')).evaluateAutofixGuard;
}

function main() {
  const evaluateAutofixGuard = resolveEvaluateAutofixGuard();
  const result = evaluateAutofixGuard(readPayload());
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${String(error && (error.stack || error.message) || error)}\n`);
  process.exit(1);
}
