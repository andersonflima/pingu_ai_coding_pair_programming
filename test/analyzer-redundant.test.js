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
