'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { scanSyntaxStructure, checkMissingCommaIssues } = require('../lib/analyzer-syntax-scan');

test('scanSyntaxStructure detecta delimitador pendente e extra', () => {
  const pending = scanSyntaxStructure(['function f() {', '  return 1;'], '.js');
  assert.ok(pending.issues.some((issue) => issue.kind === 'syntax_missing_delimiter'));

  const extra = scanSyntaxStructure(['const x = 1)'], '.js');
  assert.ok(extra.issues.some((issue) => issue.kind === 'syntax_extra_delimiter'));
});

test('scanSyntaxStructure nao acusa codigo balanceado', () => {
  const result = scanSyntaxStructure(['function f() {', '  return 1;', '}'], '.js');
  assert.deepEqual(result.issues, []);
});

test('scanSyntaxStructure detecta aspa sem fechamento', () => {
  const result = scanSyntaxStructure(['const s = "aberta'], '.js');
  assert.ok(result.issues.some((issue) => issue.kind === 'syntax_missing_quote'));
});

test('scanSyntaxStructure expoe o contexto de colecao por linha', () => {
  const result = scanSyntaxStructure(['const o = {', '  a: 1', '  b: 2', '};'], '.js');
  assert.equal(result.collectionContexts[1], 'object');
});

test('checkMissingCommaIssues detecta virgula ausente em objeto', () => {
  const lines = ['const o = {', '  a: 1', '  b: 2', '};'];
  const { collectionContexts } = scanSyntaxStructure(lines, '.js');
  const issues = checkMissingCommaIssues(lines, 'a.js', '.js', collectionContexts);
  assert.ok(issues.some((issue) => issue.kind === 'syntax_missing_comma'));
});

test('checkMissingCommaIssues nao acusa objeto com virgulas corretas', () => {
  const lines = ['const o = {', '  a: 1,', '  b: 2,', '};'];
  const { collectionContexts } = scanSyntaxStructure(lines, '.js');
  assert.deepEqual(checkMissingCommaIssues(lines, 'a.js', '.js', collectionContexts), []);
});
