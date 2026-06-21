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

test('cobre Python por indentacao', () => {
  const body = Array.from({ length: 32 }, (_, i) => `    if a${i} and b${i}:`);
  const lines = ['def huge(x):', ...body, '    return x'];
  const issues = checkCyclomaticComplexity(lines, 'sample.py');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'high_complexity');
  assert.equal(issues[0].line, 1);
});

test('Python: funcao aninhada densa e atribuida a ela, nao a externa', () => {
  const inner = Array.from({ length: 32 }, (_, i) => `        if c${i} or d${i}:`);
  const lines = ['def outer():', '    x = 1', '    def inner(y):', ...inner, '        return y', '    return inner'];
  const issues = checkCyclomaticComplexity(lines, 'sample.py');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
});

test('Python: funcao simples nao e sinalizada', () => {
  assert.deepEqual(checkCyclomaticComplexity(['def f(x):', '    if x:', '        return 1', '    return 0'], 'a.py'), []);
});
