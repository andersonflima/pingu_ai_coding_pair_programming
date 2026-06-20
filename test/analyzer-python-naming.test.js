'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkPythonNamingHazards } = require('../lib/analyzer-python-naming');

function run(lines) {
  return checkPythonNamingHazards(lines, 'sample.py', '.py', {});
}

test('shadowed_builtin sinaliza atribuicao a builtin comum', () => {
  const issues = run(['list = [1, 2, 3]']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'shadowed_builtin');
  assert.match(issues[0].message, /list/);
});

test('shadowed_builtin ignora nomes que nao sao builtins e operadores compostos', () => {
  assert.deepEqual(run(['items = [1, 2, 3]']), []);
  assert.deepEqual(run(['total += 1']), []);
  assert.deepEqual(run(['list == other']), []);
});

test('shadowed_builtin ignora atributo e subscrito no LHS', () => {
  assert.deepEqual(run(['self.list = []']), []);
  assert.deepEqual(run(['data["list"] = 1']), []);
});

test('dunder_typo sinaliza metodo dunder com erro de digitacao', () => {
  const issues = run(['    def __inti__(self):']);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'dunder_typo');
  assert.match(issues[0].suggestion, /__init__/);
});

test('dunder_typo preserva dunders corretos e nomes distantes', () => {
  assert.deepEqual(run(['    def __init__(self):']), []);
  assert.deepEqual(run(['    def __repr__(self):']), []);
  assert.deepEqual(run(['    def __my_helper__(self):']), []);
});

test('checkPythonNamingHazards ignora arquivos nao-Python', () => {
  assert.deepEqual(checkPythonNamingHazards(['list = [1]'], 'a.js', '.js', {}), []);
});
