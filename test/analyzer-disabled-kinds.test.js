'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

function kindsFor(source, fileName, disabled) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-disabled-'));
  const previous = process.env.PINGU_DISABLED_ISSUE_KINDS;
  try {
    const file = path.join(dir, fileName);
    fs.writeFileSync(file, source);
    if (disabled === undefined) {
      delete process.env.PINGU_DISABLED_ISSUE_KINDS;
    } else {
      process.env.PINGU_DISABLED_ISSUE_KINDS = disabled;
    }
    return analyzeText(file, source).map((issue) => issue.kind);
  } finally {
    if (previous === undefined) {
      delete process.env.PINGU_DISABLED_ISSUE_KINDS;
    } else {
      process.env.PINGU_DISABLED_ISSUE_KINDS = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SOURCE = 'function f(x) {\n  x = x;\n  if (x === x) { return 1; }\n}\n';

test('sem PINGU_DISABLED_ISSUE_KINDS, os diagnosticos aparecem', () => {
  const kinds = kindsFor(SOURCE, 's.js', undefined);
  assert.ok(kinds.includes('self_assignment'));
  assert.ok(kinds.includes('self_comparison'));
});

test('PINGU_DISABLED_ISSUE_KINDS suprime o kind indicado', () => {
  const kinds = kindsFor(SOURCE, 's.js', 'self_assignment');
  assert.equal(kinds.includes('self_assignment'), false);
  assert.ok(kinds.includes('self_comparison'));
});

test('suporta multiplos kinds separados por virgula', () => {
  const kinds = kindsFor(SOURCE, 's.js', 'self_assignment, self_comparison');
  assert.equal(kinds.includes('self_assignment'), false);
  assert.equal(kinds.includes('self_comparison'), false);
});
