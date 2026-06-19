'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  checkLongLines,
  checkDebugOutputs,
  checkTodoFixme,
  checkDuplicateConsecutiveLines,
  checkTrailingWhitespace,
  checkTabs,
  checkLargeFile,
  checkModuledoc,
} = require('../lib/analyzer-hygiene');

test('checkTrailingWhitespace sinaliza espaco final', () => {
  const issues = checkTrailingWhitespace(['const x = 1   ', 'const y = 2'], 'a.js');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'trailing_whitespace');
  assert.equal(issues[0].line, 1);
});

test('checkTabs sinaliza tab', () => {
  const issues = checkTabs(['\tconst x = 1', 'const y = 2'], 'a.js');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'tabs');
});

test('checkLongLines respeita o limite', () => {
  assert.equal(checkLongLines(['x'.repeat(10)], 'a.js', 80).length, 0);
  assert.equal(checkLongLines(['x'.repeat(120)], 'a.js', 80).length, 1);
});

test('checkDebugOutputs detecta console.log em JS e print em Python', () => {
  assert.equal(checkDebugOutputs(['console.log(x)'], 'a.js').length, 1);
  assert.equal(checkDebugOutputs(['print(x)'], 'a.py').length, 1);
});

test('checkTodoFixme detecta marcadores', () => {
  assert.equal(checkTodoFixme(['// TODO arrumar isso'], 'a.js').length, 1);
});

test('checkDuplicateConsecutiveLines detecta repeticao identica', () => {
  const issues = checkDuplicateConsecutiveLines(['doStuff(value)', 'doStuff(value)'], 'a.js');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'duplicate_line');
});

test('checkLargeFile sinaliza arquivos grandes', () => {
  assert.equal(checkLargeFile(Array(301).fill('x'), 'a.js').length, 1);
  assert.equal(checkLargeFile(Array(10).fill('x'), 'a.js').length, 0);
});

test('checkModuledoc sinaliza modulo Elixir sem @moduledoc', () => {
  const issues = checkModuledoc(['defmodule App do', '  def run do', '    :ok', '  end', 'end'], 'a.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'moduledoc');
});
