'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const {
  checkCommonDeveloperErrors,
  rewriteCodeSegments,
} = require('../lib/analyzer-developer-errors');

test('developer error rewrites protect strings and inline comments', () => {
  const rewritten = rewriteCodeSegments('if (total == expected) return "a == b" // keep == here', '.js', (code) =>
    code.replace(/==/g, '==='));

  assert.equal(rewritten, 'if (total === expected) return "a == b" // keep == here');
});

test('developer error checker emits deterministic language fixes', () => {
  const jsIssue = checkCommonDeveloperErrors(['if (total == expected) {'], '/tmp/sample.js', '.js')[0];
  const pythonIssue = checkCommonDeveloperErrors(['if value == None:'], '/tmp/sample.py', '.py')[0];

  assert.equal(jsIssue.kind, 'loose_equality');
  assert.equal(jsIssue.snippet, 'if (total === expected) {');
  assert.equal(pythonIssue.kind, 'none_comparison');
  assert.equal(pythonIssue.snippet, 'if value is None:');
});

function mutableDefaults(line) {
  return checkCommonDeveloperErrors([line], '/tmp/sample.py', '.py')
    .filter((issue) => issue.kind === 'mutable_default_arg');
}

test('detecta argumento padrao mutavel em Python (suggest-only)', () => {
  const { issueKindConfig } = require('../lib/issue-kinds');
  assert.equal(issueKindConfig('mutable_default_arg').autoFixDefault, false);
  assert.equal(mutableDefaults('def f(x=[]):').length, 1);
  assert.equal(mutableDefaults('def f(a, b={}):')[0].message.includes("'b'"), true);
  assert.equal(mutableDefaults('async def f(cache=dict()):').length, 1);
  assert.equal(mutableDefaults('def f(x: int, y=[1, 2]) -> None:').length, 1);
});

test('nao acusa defaults imutaveis nem chamadas que nao sao def', () => {
  assert.equal(mutableDefaults('def f(x=None):').length, 0);
  assert.equal(mutableDefaults('def f(x=0, y=""):').length, 0);
  assert.equal(mutableDefaults('def f(x=()):').length, 0);
  assert.equal(mutableDefaults('def f(x=g[0]):').length, 0);
  assert.equal(mutableDefaults('result = compute(x=[])').length, 0);
});

function assignmentIssues(line) {
  return checkCommonDeveloperErrors([line], '/tmp/sample.js', '.js')
    .filter((issue) => issue.kind === 'assignment_in_condition');
}

test('detecta atribuicao acidental dentro de if e sugere comparacao', () => {
  const issue = assignmentIssues('if (status = active) {')[0];
  assert.ok(issue, 'esperava aviso de atribuicao em condicao');
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.snippet, 'if (status === active) {');
});

test('detecta atribuicao acidental dentro de while', () => {
  const issue = assignmentIssues('while (node = node.next) {')[0];
  assert.ok(issue);
  assert.equal(issue.snippet, 'while (node === node.next) {');
});

test('nao marca comparacoes nem operadores compostos em condicao', () => {
  assert.equal(assignmentIssues('if (a === b) {').length, 0);
  assert.equal(assignmentIssues('if (a == b) {').length, 0);
  assert.equal(assignmentIssues('if (a <= b) {').length, 0);
  assert.equal(assignmentIssues('if (count += 1) {').length, 0);
  assert.equal(assignmentIssues('if (items.find((x) => x.id)) {').length, 0);
});

test('respeita parenteses duplos como atribuicao intencional', () => {
  assert.equal(assignmentIssues('if ((match = regex.exec(input))) {').length, 0);
});

test('ignora sinais de igual dentro de strings na condicao', () => {
  assert.equal(assignmentIssues('if (label("x = y")) {').length, 0);
});
