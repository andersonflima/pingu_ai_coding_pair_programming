'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkAwaitInLoop } = require('../lib/analyzer-async');

function run(lines) {
  return checkAwaitInLoop(lines, 'sample.js', '.js', {});
}

test('await_in_loop sinaliza await direto no corpo de um for', () => {
  const issues = run([
    'async function run(items) {',
    '  for (const item of items) {',
    '    await process(item);',
    '  }',
    '}',
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'await_in_loop');
  assert.equal(issues[0].line, 3);
});

test('await_in_loop detecta await dentro de if aninhado no loop', () => {
  const issues = run([
    'async function run(items) {',
    '  while (items.length) {',
    '    if (items[0]) {',
    '      await process(items.shift());',
    '    }',
    '  }',
    '}',
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 4);
});

test('await_in_loop ignora for await...of (sequencial intencional)', () => {
  const issues = run([
    'async function run(stream) {',
    '  for await (const chunk of stream) {',
    '    handle(chunk);',
    '  }',
    '}',
  ]);
  assert.deepEqual(issues, []);
});

test('await_in_loop ignora await Promise.all dentro do loop', () => {
  const issues = run([
    'async function run(groups) {',
    '  for (const group of groups) {',
    '    await Promise.all(group.map(process));',
    '  }',
    '}',
  ]);
  assert.deepEqual(issues, []);
});

test('await_in_loop nao confunde await de funcao aninhada no loop', () => {
  const issues = run([
    'async function run(items) {',
    '  for (const item of items) {',
    '    register(async () => {',
    '      await process(item);',
    '    });',
    '  }',
    '}',
  ]);
  assert.deepEqual(issues, []);
});

test('await_in_loop nao dispara fora de JavaScript', () => {
  assert.deepEqual(checkAwaitInLoop(['for x in items:', '    await process(x)'], 'a.py', '.py', {}), []);
});
