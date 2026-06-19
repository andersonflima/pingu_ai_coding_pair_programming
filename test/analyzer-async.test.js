'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkMissingAwait } = require('../lib/analyzer-async');
const { issueKindConfig } = require('../lib/issue-kinds');

function awaits(source) {
  return checkMissingAwait(source.split('\n'), 'sample.js', '.js').map((issue) => issue.message);
}

test('missing_await e suggest-only (nunca auto-fix)', () => {
  assert.equal(issueKindConfig('missing_await').autoFixDefault, false);
});

test('detecta chamada async fire-and-forget (function, arrow e metodo)', () => {
  assert.deepEqual(awaits('async function save() {}\nfunction f() {\n  save();\n}'), ["Chamada async 'save' sem await"]);
  assert.deepEqual(awaits('const load = async () => {};\nfunction f() {\n  load();\n}'), ["Chamada async 'load' sem await"]);
  assert.deepEqual(awaits('class A {\n  async run() {}\n  go() {\n    this.run();\n  }\n}'), ["Chamada async 'run' sem await"]);
});

test('nao acusa quando a promise e consumida (await/return/.then/void)', () => {
  assert.deepEqual(awaits('async function save() {}\nasync function f() {\n  await save();\n}'), []);
  assert.deepEqual(awaits('async function save() {}\nfunction f() {\n  return save();\n}'), []);
  assert.deepEqual(awaits('async function save() {}\nfunction f() {\n  save().then((x) => x);\n}'), []);
  assert.deepEqual(awaits('async function save() {}\nfunction f() {\n  void save();\n}'), []);
});

test('nao acusa quando o resultado e atribuido (pode ser awaited depois)', () => {
  assert.deepEqual(awaits('async function save() {}\nfunction f() {\n  const p = save();\n}'), []);
});

test('nao acusa chamada a funcao sincrona', () => {
  assert.deepEqual(awaits('function save() {}\nfunction f() {\n  save();\n}'), []);
});
