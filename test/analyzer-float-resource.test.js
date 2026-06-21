'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkLogicErrors } = require('../lib/analyzer-logic-errors');
const { checkCommonDeveloperErrors } = require('../lib/analyzer-developer-errors');

function logic(line, kind) {
  return checkLogicErrors([line], 'a' + kind, kind, {});
}
function dev(line, kind) {
  return checkCommonDeveloperErrors([line], 'a' + kind, kind, {});
}

test('float_equality sinaliza == com literal float em JS e Python', () => {
  assert.equal(logic('if (price == 19.99) {', '.js')[0].kind, 'float_equality');
  assert.equal(logic('if total === 0.3:', '.py').filter((i) => i.kind === 'float_equality').length, 1);
  assert.equal(logic('return x !== 1.5;', '.js')[0].kind, 'float_equality');
});

test('float_equality ignora atribuicao, inteiros e comparacao relacional', () => {
  assert.deepEqual(logic('const price = 0.1;', '.js'), []);
  assert.deepEqual(logic('if (count == 3) {', '.js'), []);
  assert.deepEqual(logic('if (x <= 0.5) {', '.js'), []);
});

test('float_equality nao dispara dentro de string', () => {
  assert.deepEqual(logic('const v = "version == 1.0";', '.js'), []);
});

test('resource_leak sinaliza open() sem with em Python', () => {
  const issues = dev('    f = open("data.txt")', '.py');
  const leak = issues.find((i) => i.kind === 'resource_leak');
  assert.ok(leak);
  assert.match(leak.suggestion, /with open/);
});

test('resource_leak ignora a forma correta com with e nao-Python', () => {
  assert.deepEqual(dev('with open("data.txt") as f:', '.py').filter((i) => i.kind === 'resource_leak'), []);
  assert.deepEqual(dev('const f = open("data.txt");', '.js').filter((i) => i.kind === 'resource_leak'), []);
});
