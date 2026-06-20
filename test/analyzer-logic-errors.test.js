'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkLogicErrors } = require('../lib/analyzer-logic-errors');

function run(lines, kind) {
  return checkLogicErrors(lines, 'sample' + kind, kind, {});
}

test('chained_comparison sinaliza a < b < c em JavaScript', () => {
  const issues = run(['if (a < b < c) {'], '.js');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'chained_comparison');
  assert.equal(issues[0].snippet, 'if (a < b && b < c) {');
});

test('chained_comparison ignora comparacao unica e shifts', () => {
  assert.deepEqual(run(['if (a < b) {'], '.js'), []);
  assert.deepEqual(run(['const x = a >> b;'], '.js'), []);
});

test('chained_comparison nao dispara dentro de string', () => {
  assert.deepEqual(run(['const msg = "a < b < c";'], '.js'), []);
});

test('chained_comparison nao se aplica a Python (forma valida)', () => {
  assert.deepEqual(run(['if a < b < c:'], '.py'), []);
});

test('literal_identity_comparison sinaliza is com numero em Python', () => {
  const issues = run(['if x is 5:'], '.py');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'literal_identity_comparison');
  assert.equal(issues[0].snippet, 'if x == 5:');
});

test('literal_identity_comparison trata is not e string e colecao', () => {
  assert.equal(run(['if x is not "foo":'], '.py')[0].snippet, 'if x != "foo":');
  assert.equal(run(['if x is []:'], '.py')[0].snippet, 'if x == []:');
});

test('literal_identity_comparison preserva is None/True/False e identificadores', () => {
  assert.deepEqual(run(['if x is None:'], '.py'), []);
  assert.deepEqual(run(['if x is True:'], '.py'), []);
  assert.deepEqual(run(['if x is other:'], '.py'), []);
});

test('literal_identity_comparison nao dispara dentro de comentario', () => {
  assert.deepEqual(run(['# checa se x is 5 aqui'], '.py'), []);
});
