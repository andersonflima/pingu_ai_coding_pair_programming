'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  checkElixirBlockDelimiterIssues,
  checkElixirMalformedEndKeywordIssues,
  checkElixirUnexpectedStandaloneTokenIssues,
} = require('../lib/analyzer-elixir-syntax');

test('checkElixirBlockDelimiterIssues sinaliza do/end pendente', () => {
  const issues = checkElixirBlockDelimiterIssues(['defmodule App do', '  def run do', '    :ok'], 'a.ex', '.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'syntax_missing_delimiter');
  assert.match(issues[0].message, /pendentes/);
});

test('checkElixirBlockDelimiterIssues nao acusa modulo balanceado', () => {
  assert.deepEqual(checkElixirBlockDelimiterIssues(['defmodule App do', '  def run do', '    :ok', '  end', 'end'], 'a.ex', '.ex'), []);
});

test('checkElixirMalformedEndKeywordIssues detecta end com typo', () => {
  const issues = checkElixirMalformedEndKeywordIssues(['def run do', '  :ok', 'ends'], 'a.ex', '.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'syntax_malformed_keyword');
  assert.equal(checkElixirMalformedEndKeywordIssues(['end'], 'a.ex', '.ex').length, 0);
});

test('checkElixirUnexpectedStandaloneTokenIssues detecta token isolado antes de end', () => {
  const issues = checkElixirUnexpectedStandaloneTokenIssues(['def run do', '  do_work()', '  Foo', 'end'], 'a.ex', '.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'syntax_unexpected_token');
});

test('os checks Elixir nao rodam para outras linguagens', () => {
  assert.deepEqual(checkElixirBlockDelimiterIssues(['function f() {'], 'a.js', '.js'), []);
  assert.deepEqual(checkElixirMalformedEndKeywordIssues(['edn'], 'a.js', '.js'), []);
});
