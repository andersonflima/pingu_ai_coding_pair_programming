'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkAsyncArrayMethods } = require('../lib/analyzer-async');

function run(line) {
  return checkAsyncArrayMethods([line], 'a.js', '.js', {});
}

test('sinaliza callback async em forEach/filter/some/every/find', () => {
  assert.equal(run('items.forEach(async (x) => { await f(x); });')[0].kind, 'async_array_method');
  assert.equal(run('const r = arr.filter(async (x) => await ok(x));')[0].kind, 'async_array_method');
  assert.equal(run('if (arr.some(async (x) => await ok(x))) {}')[0].kind, 'async_array_method');
});

test('ignora map (correto com Promise.all) e callbacks sincronos', () => {
  assert.deepEqual(run('await Promise.all(arr.map(async (x) => f(x)));'), []);
  assert.deepEqual(run('items.forEach((x) => f(x));'), []);
  assert.deepEqual(run('const y = arr.map((x) => x * 2);'), []);
});

test('nao dispara fora de JavaScript', () => {
  assert.deepEqual(checkAsyncArrayMethods(['items.forEach(async x => f(x))'], 'a.py', '.py', {}), []);
});
