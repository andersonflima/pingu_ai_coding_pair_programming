'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkUndefinedVariables } = require('../lib/analyzer-undefined-variables');

test('checkUndefinedVariables sinaliza uso de nome nao definido em Python', () => {
  const lines = [
    'def total(a, b):',
    '    return a + c',
  ];
  const issues = checkUndefinedVariables(lines, '/tmp/scope/sample.py', {});
  assert.ok(Array.isArray(issues));
  assert.ok(issues.some((issue) => issue.line === 2), 'deveria apontar a linha do uso indefinido');
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
