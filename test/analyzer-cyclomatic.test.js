'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkCyclomaticComplexity } = require('../lib/analyzer-complexity');

test('sinaliza funcao com muitos pontos de decisao', () => {
  const body = Array.from({ length: 32 }, (_, i) => `  if (a${i} && b${i}) { return ${i}; }`);
  const lines = ['function huge(x) {', ...body, '}'];
  const issues = checkCyclomaticComplexity(lines, 'sample.js');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'high_complexity');
  assert.equal(issues[0].line, 1);
});

test('nao sinaliza funcao simples', () => {
  const lines = ['function small(x) {', '  if (x) { return 1; }', '  return 0;', '}'];
  assert.deepEqual(checkCyclomaticComplexity(lines, 'sample.js'), []);
});

test('nao roda em linguagens sem chaves de bloco', () => {
  assert.deepEqual(checkCyclomaticComplexity(['def f():', '    return 1'], 'a.py'), []);
});
