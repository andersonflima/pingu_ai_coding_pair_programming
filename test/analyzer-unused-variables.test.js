'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkUnusedVariables } = require('../lib/analyzer-unused');
const { issueKindConfig } = require('../lib/issue-kinds');

function unused(source, ext = '.js') {
  return checkUnusedVariables(source.split('\n'), `sample${ext}`, ext).map((issue) => issue.message);
}

test('unused_variable e suggest-only (nunca auto-fix)', () => {
  assert.equal(issueKindConfig('unused_variable').autoFixDefault, false);
});

test('detecta variavel local com lado direito puro nao utilizada', () => {
  assert.deepEqual(unused('function f() {\n  const x = 5;\n  return 1;\n}'), ["Variavel 'x' declarada mas nao utilizada"]);
  assert.deepEqual(unused('function f() {\n  const y = obj.prop;\n  return 1;\n}'), ["Variavel 'y' declarada mas nao utilizada"]);
  assert.deepEqual(unused('function f() {\n  const z = a + b;\n  return 1;\n}'), ["Variavel 'z' declarada mas nao utilizada"]);
});

test('nao acusa variavel utilizada', () => {
  assert.deepEqual(unused('function f() {\n  const x = 5;\n  return x;\n}'), []);
});

test('nao acusa quando o lado direito pode ter efeito colateral', () => {
  assert.deepEqual(unused('function f() {\n  const x = doThing();\n  return 1;\n}'), []);
  assert.deepEqual(unused('async function f() {\n  const x = await go();\n  return 1;\n}'), []);
  assert.deepEqual(unused('function f() {\n  const x = new Thing();\n  return 1;\n}'), []);
});

test('ignora declaracoes de modulo (nao indentadas) e exportadas', () => {
  assert.deepEqual(unused('const API = 5;\nfoo();'), []);
});

test('ignora nomes prefixados com underscore (uso intencional)', () => {
  assert.deepEqual(unused('function f() {\n  const _unused = 5;\n  return 1;\n}'), []);
});

test('nao suporta Python (evita falso positivo com atributos de classe)', () => {
  assert.deepEqual(unused('def f():\n    x = 5\n    return 1', '.py'), []);
});
