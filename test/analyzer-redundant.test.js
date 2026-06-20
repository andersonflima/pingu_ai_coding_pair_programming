'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkRedundantConstructs } = require('../lib/analyzer-redundant');
const { issueKindConfig } = require('../lib/issue-kinds');

function kinds(source, ext) {
  return checkRedundantConstructs(source.split('\n'), `sample${ext}`, ext).map((issue) => issue.kind);
}

test('self_comparison e self_assignment sao suggest-only', () => {
  assert.equal(issueKindConfig('self_comparison').autoFixDefault, false);
  assert.equal(issueKindConfig('self_assignment').autoFixDefault, false);
});

test('detecta auto-comparacao (identificador e membro, JS e Python)', () => {
  assert.deepEqual(kinds('if (x === x) {}', '.js'), ['self_comparison']);
  assert.deepEqual(kinds('if (a.b == a.b) {}', '.js'), ['self_comparison']);
  assert.deepEqual(kinds('if x == x:', '.py'), ['self_comparison']);
});

test('detecta auto-atribuicao (identificador e membro)', () => {
  assert.deepEqual(kinds('x = x;', '.js'), ['self_assignment']);
  assert.deepEqual(kinds('obj.prop = obj.prop;', '.js'), ['self_assignment']);
  assert.deepEqual(kinds('x = x', '.py'), ['self_assignment']);
});

test('nao acusa comparacao ou atribuicao legitima', () => {
  assert.deepEqual(kinds('if (x === y) {}', '.js'), []);
  assert.deepEqual(kinds('this.x = x;', '.js'), []);
  assert.deepEqual(kinds('const x = x;', '.js'), []);
  assert.deepEqual(kinds('x = x.next;', '.js'), []);
});

test('ignora ocorrencias em comentario', () => {
  assert.deepEqual(kinds('// x === x exemplo', '.js'), []);
});

test('nao acusa comparacao entre chamadas (podem diferir)', () => {
  assert.deepEqual(kinds('if (f() === f()) {}', '.js'), []);
});

test('detecta chave duplicada em objeto JS e dict Python', () => {
  assert.deepEqual(kinds('const o = { a: 1, b: 2, a: 3 };', '.js'), ['duplicate_key']);
  assert.deepEqual(kinds("const o = { 'x': 1, x: 2 };", '.js'), ['duplicate_key']);
  assert.deepEqual(kinds("d = { 'a': 1, 'a': 2 }", '.py'), ['duplicate_key']);
});

test('nao acusa objeto sem chave duplicada nem blocos de codigo', () => {
  assert.deepEqual(kinds('const o = { a: 1, b: 2 };', '.js'), []);
  assert.deepEqual(kinds('function f() { return 1; }', '.js'), []);
  assert.deepEqual(kinds('if (x) { doThing(); }', '.js'), []);
  assert.deepEqual(kinds('const o = { a: x ? 1 : 2, b: 3 };', '.js'), []);
  assert.deepEqual(kinds('const o = { ...base, a: 1 };', '.js'), []);
});

test('detecta typeof comparado com tipo invalido (typo)', () => {
  assert.deepEqual(kinds('if (typeof x === "fucntion") {}', '.js'), ['invalid_typeof']);
  assert.deepEqual(kinds('if (typeof x !== "undefiend") {}', '.js'), ['invalid_typeof']);
  assert.deepEqual(kinds('if ("strnig" === typeof y) {}', '.js'), ['invalid_typeof']);
});

test('nao acusa typeof com tipo valido', () => {
  assert.deepEqual(kinds('if (typeof x === "function") {}', '.js'), []);
  assert.deepEqual(kinds('if (typeof x === "undefined") {}', '.js'), []);
});

test('detecta comparacao direta com NaN', () => {
  assert.deepEqual(kinds('if (x === NaN) {}', '.js'), ['nan_comparison']);
  assert.deepEqual(kinds('if (NaN !== y) {}', '.js'), ['nan_comparison']);
});

test('nao acusa Number.isNaN nem identificador parecido', () => {
  assert.deepEqual(kinds('if (Number.isNaN(x)) {}', '.js'), []);
  assert.deepEqual(kinds('if (x === NaNlike) {}', '.js'), []);
});

test('typeof e NaN sao apenas para JavaScript', () => {
  assert.deepEqual(kinds('if (x === NaN) {}', '.py'), []);
});
