'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

const REDUNDANT = ['trailing_whitespace', 'tabs', 'long_line', 'large_file'];
const SOURCE = `const x = 1   \n\tconst y = 2;\nconst z = ${'a'.repeat(140)};\n`;

function hygieneIssues(env) {
  const previous = process.env.PINGU_ENABLE_FORMATTING_HYGIENE;
  if (env === undefined) {
    delete process.env.PINGU_ENABLE_FORMATTING_HYGIENE;
  } else {
    process.env.PINGU_ENABLE_FORMATTING_HYGIENE = env;
  }
  try {
    return analyzeText('/tmp/hygiene-sample.js', SOURCE).filter((issue) => REDUNDANT.includes(issue.kind));
  } finally {
    if (previous === undefined) {
      delete process.env.PINGU_ENABLE_FORMATTING_HYGIENE;
    } else {
      process.env.PINGU_ENABLE_FORMATTING_HYGIENE = previous;
    }
  }
}

test('higiene redundante com formatter fica off por default', () => {
  assert.deepEqual(hygieneIssues(undefined), []);
});

test('PINGU_ENABLE_FORMATTING_HYGIENE reativa os checks', () => {
  const kinds = new Set(hygieneIssues('1').map((issue) => issue.kind));
  assert.ok(kinds.has('trailing_whitespace'));
  assert.ok(kinds.has('tabs'));
  assert.ok(kinds.has('long_line'));
});

test('valores nao-truthy mantem desligado', () => {
  assert.deepEqual(hygieneIssues('0'), []);
  assert.deepEqual(hygieneIssues('false'), []);
});
