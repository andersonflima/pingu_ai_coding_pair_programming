'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { analyzeText } = require('../lib/analyzer');
const { developerErrorFamiliesForLanguage, developerErrorKinds } = require('../lib/developer-error-taxonomy');

process.env.PINGU_AI_MODE = 'off';

function issueByKind(issues, kind) {
  return issues.find((issue) => issue.kind === kind);
}

test('developer error taxonomy maps correction families for active languages', () => {
  assert.ok(developerErrorKinds().includes('loose_equality'));
  assert.ok(developerErrorKinds().includes('none_comparison'));
  assert.ok(developerErrorKinds().includes('nil_comparison'));
  assert.ok(developerErrorFamiliesForLanguage('javascript').some((family) => family.id === 'nullability_and_equality'));
  assert.ok(developerErrorFamiliesForLanguage('python').some((family) => family.id === 'error_handling'));
});

test('analyzer corrects JavaScript loose equality without touching strings or null checks', () => {
  const issues = analyzeText('/tmp/sample.js', [
    'if (total == expected) {',
    '  return "a == b"',
    '}',
    'if (value == null) {',
    '  return false',
    '}',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'loose_equality');

  assert.equal(issue.line, 1);
  assert.equal(issue.snippet, 'if (total === expected) {');
});

test('analyzer corrects Python None comparison and bare except', () => {
  const issues = analyzeText('/tmp/sample.py', [
    'if value == None:',
    '    result = "value == None"',
    'try:',
    '    run()',
    'except:',
    '    pass',
  ].join('\n'), { analysisMode: 'light' });

  const noneIssue = issueByKind(issues, 'none_comparison');
  const exceptIssue = issueByKind(issues, 'bare_except');

  assert.equal(noneIssue.line, 1);
  assert.equal(noneIssue.snippet, 'if value is None:');
  assert.equal(exceptIssue.line, 5);
  assert.equal(exceptIssue.snippet, 'except Exception:');
});

test('analyzer corrects Ruby nil comparison', () => {
  const issues = analyzeText('/tmp/sample.rb', [
    'return user == nil',
    'message = "user == nil"',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'nil_comparison');

  assert.equal(issue.line, 1);
  assert.equal(issue.snippet, 'return user.nil?');
});

test('analyzer corrects Elixir nil comparison offline', () => {
  const issues = analyzeText('/tmp/sample.ex', [
    'value != nil',
    'message = "value != nil"',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'nil_comparison');

  assert.equal(issue.line, 1);
  assert.equal(issue.snippet, '!is_nil(value)');
});

test('analyzer does not treat equal trimmed lines with different indentation as duplicate', () => {
  const issues = analyzeText('/tmp/sample.py', [
    'def normalize(value):',
    '    if value is None:',
    '        return value',
    '    return value',
  ].join('\n'), { analysisMode: 'light' });

  assert.equal(issues.some((issue) => issue.kind === 'duplicate_line'), false);
});

test('analyzer detecta bloco do/end pendente em Elixir e sugere fechamento', () => {
  const issues = analyzeText('/tmp/example.ex', [
    'defmodule Example do',
    '  def run do',
    '    if true do',
    '      Logger.debug("Hello from another Task!")',
    '  end',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'syntax_missing_delimiter');
  assert.ok(issue);
  assert.equal(issue.line, 5);
  assert.equal(issue.snippet.includes('end'), true);
});

test('analyzer nao gera syntax_missing_delimiter para Elixir com do: inline valido', () => {
  const issues = analyzeText('/tmp/inline.ex', [
    'defmodule Demo do',
    '  def normalize(value) when is_binary(value), do: String.trim(value)',
    '  def normalize(value), do: value',
    'end',
  ].join('\n'), { analysisMode: 'light' });

  assert.equal(issues.some((issue) => issue.kind === 'syntax_missing_delimiter'), false);
});

test('analyzer detecta virgula ausente entre itens de lista Elixir', () => {
  const issues = analyzeText('/tmp/example.ex', [
    'defmodule Example do',
    '  def start(_type, _args) do',
    '    children = [',
    '      Logger.debug("Hello from a Task!")',
    '      Logger.debug("Hello from another Task!")',
    '    ]',
    '  end',
    'end',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'syntax_missing_comma');
  assert.ok(issue);
  assert.equal(issue.line, 4);
  assert.equal(issue.snippet.includes(','), true);
});

test('analyzer detecta token isolado inesperado em bloco Elixir', () => {
  const issues = analyzeText('/tmp/example.ex', [
    'defmodule Example do',
    '  def start(_type, _args) do',
    '    Supervisor.start_link([], strategy: :one_for_one)',
    '    E',
    '  end',
    'end',
  ].join('\n'), { analysisMode: 'light' });

  const issue = issueByKind(issues, 'syntax_unexpected_token');
  assert.ok(issue);
  assert.equal(issue.line, 4);
});
