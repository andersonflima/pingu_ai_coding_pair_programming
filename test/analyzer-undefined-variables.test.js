'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkUndefinedVariables } = require('../lib/analyzer-undefined-variables');

test('checkUndefinedVariables sinaliza typo de nome no escopo em Python', () => {
  const lines = [
    'def total(amount, count):',
    '    return amount + amont',
  ];
  const issues = checkUndefinedVariables(lines, '/tmp/scope/sample.py', {});
  assert.ok(Array.isArray(issues));
  const flagged = issues.find((issue) => issue.line === 2);
  assert.ok(flagged, 'deveria apontar o uso de amont (typo de amount)');
  assert.match(flagged.suggestion, /amount/);
});

test('checkUndefinedVariables ignora nomes muito curtos (ruido)', () => {
  const issues = checkUndefinedVariables(['def f(a, b):', '    return a + c'], '/tmp/scope/short.py', {});
  assert.deepEqual(issues, []);
});

test('checkUndefinedVariables nao reclama quando todas as variaveis estao no escopo', () => {
  const lines = [
    'def total(a, b):',
    '    c = a + b',
    '    return c',
  ];
  const issues = checkUndefinedVariables(lines, '/tmp/scope/ok.py', {});
  assert.deepEqual(issues, []);
});

test('checkUndefinedVariables retorna lista vazia para linguagem sem analise de escopo', () => {
  const issues = checkUndefinedVariables(['SELECT * FROM t'], '/tmp/scope/sample.sql', {});
  assert.deepEqual(issues, []);
});
