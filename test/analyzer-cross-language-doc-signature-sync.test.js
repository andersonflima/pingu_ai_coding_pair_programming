'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { analyzeText } = require('../lib/analyzer');

function functionDocIssues(text, file = 'module.c') {
  return analyzeText(file, text).filter((issue) => issue.kind === 'function_doc');
}

function issuesByKind(text, file, kind) {
  return analyzeText(file, text).filter((issue) => issue.kind === kind);
}

function applyIssueSnippet(source, issue) {
  const lines = String(source || '').split('\n');
  const snippetLines = String(issue && issue.snippet || '').split('\n');
  const action = issue && issue.action && typeof issue.action === 'object'
    ? issue.action
    : { op: 'insert_before' };
  const lineIndex = Math.max(0, Number(issue && issue.line || 1) - 1);

  if (action.op === 'insert_before') {
    lines.splice(lineIndex, 0, ...snippetLines);
    return lines.join('\n');
  }
  if (action.op === 'insert_after') {
    lines.splice(lineIndex + 1, 0, ...snippetLines);
    return lines.join('\n');
  }
  if (action.op === 'replace_line') {
    lines.splice(lineIndex, 1, ...snippetLines);
    return lines.join('\n');
  }
  if (action.op === 'replace_range') {
    const range = action.range && typeof action.range === 'object' ? action.range : {};
    const start = Math.max(0, Number(range.start && range.start.line || lineIndex));
    const end = Math.max(start, Number(range.end && range.end.line || (lineIndex + 1)));
    lines.splice(start, end - start, ...snippetLines);
    return lines.join('\n');
  }

  return String(source || '');
}

test('detecta contrato desatualizado em doc em bloco de C', () => {
  const source = [
    '/*',
    ' * Soma de dois inteiros.',
    ' * @param x Primeiro inteiro.',
    ' * @param y Segundo inteiro.',
    ' */',
    'int sum(int x) {',
    '  return x + 1;',
    '}',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.c');
  assert.equal(issues.length > 0, true);
  assert.equal(issues[0].message.includes('desatualizada'), true);
});

test('mantem sincronizacao quando a assinatura esta alinhada em bloco no C', () => {
  const source = [
    '/*',
    ' * Soma de dois inteiros.',
    ' * @param x Primeiro inteiro.',
    ' * @param y Segundo inteiro.',
    ' */',
    'int sum(int x, int y) {',
    '  return x + y;',
    '}',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.c');
  assert.equal(issues.length, 0);
});

test('reconhece bloco de comentarios sem argumentos como valida para funcao sem args', () => {
  const source = [
    '/*',
    ' * Retorna uma saudacao.',
    ' * Nenhum argumento recebido.',
    ' */',
    'void ping() {',
    '  return;',
    '}',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.c');
  assert.equal(issues.length, 0);
});

test('detecta @doc Elixir desatualizado quando funcao recebe novo argumento', () => {
  const source = [
    'defmodule Zing do',
    '  @doc """',
    '  Orquestra o comportamento principal de show name',
    '',
    '  ## Argumentos',
    '  - Nenhum argumento recebido.',
    '',
    '  ## Retorno',
    '  Valor numerico calculado conforme a regra principal da funcao.',
    '  """',
    '  @spec show_name() :: any()',
    '  def show_name(name) do',
    '    :ok',
    '  end',
    'end',
  ].join('\n');

  const issues = functionDocIssues(source, 'zing.ex');
  assert.equal(issues.length > 0, true);
  assert.equal(issues[0].message.includes('desatualizada'), true);
});

test('detecta @doc Elixir desatualizado quando nome da funcao muda', () => {
  const source = [
    'defmodule Zing do',
    '  @doc """',
    '  Orquestra o comportamento principal de start.',
    '',
    '  ## Argumentos',
    '  - `_type`: entrada utilizada nesta etapa.',
    '  - `_args`: entrada utilizada nesta etapa.',
    '',
    '  ## Retorno',
    '  Retorna o resultado produzido por start conforme o contrato da funcao.',
    '  """',
    '  @spec sstart(term(), term()) :: term()',
    '  def sstart(_type, _args) do',
    '    :ok',
    '  end',
    'end',
  ].join('\n');

  const issues = functionDocIssues(source, 'zing.ex');
  assert.equal(issues.length > 0, true);
  assert.equal(issues[0].message.includes('desatualizada'), true);
});

test('detecta documentacao Lua em bloco desatualizada', () => {
  const source = [
    '--[[',
    'Argumentos',
    '- name: Nome recebido.',
    'Retorno: ok.',
    ']]',
    'function show_name()',
    '  return true',
    'end',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.lua');
  assert.equal(issues.length > 0, true);
  assert.equal(issues[0].message.includes('desatualizada'), true);
});

test('detecta documentacao Vim desatualizada por comentario de linha', () => {
  const source = [
    '" Argumentos',
    '" - name: Nome recebido.',
    '" Retorno: ok.',
    'function! ShowName()',
    '  return 1',
    'endfunction',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.vim');
  assert.equal(issues.length > 0, true);
  assert.equal(issues[0].message.includes('desatualizada'), true);
});

test('mantem doc alinhada quando parametro opcional esta documentado', () => {
  const source = [
    '/**',
    ' * Executa show name.',
    ' * @param {string} name optional.',
    ' * @returns {string} Nome calculado.',
    ' */',
    'export function showName(name = "Ada") {',
    '  return name;',
    '}',
  ].join('\n');

  const issues = functionDocIssues(source, 'sample.js');
  assert.equal(issues.length, 0);
});

test('mantem function_doc estavel em TypeScript com parametros opcionais e variadicos', () => {
  const source = [
    'export function greet(name: string, title?: string, ...tags: string[]): string {',
    '  return `${title ?? ""}${name}:${tags.join(",")}`;',
    '}',
  ].join('\n');

  const initialIssues = functionDocIssues(source, 'sample.ts');
  assert.equal(initialIssues.length > 0, true);
  const patched = applyIssueSnippet(source, initialIssues[0]);
  const secondIssues = functionDocIssues(patched, 'sample.ts');
  assert.equal(secondIssues.length, 0);
});

test('mantem function_doc estavel em Python com parametro default', () => {
  const source = [
    'def run(name: str, count: int = 1) -> str:',
    '    return name * count',
  ].join('\n');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-doc-idempotency-py-'));
  const sourceFile = path.join(tempDir, 'sample.py');
  fs.writeFileSync(sourceFile, source, 'utf8');

  try {
    const initialIssues = functionDocIssues(source, sourceFile);
    assert.equal(initialIssues.length > 0, true);
    const patched = applyIssueSnippet(source, initialIssues[0]);
    fs.writeFileSync(sourceFile, patched, 'utf8');
    const secondIssues = functionDocIssues(patched, sourceFile);
    assert.equal(secondIssues.length, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('nao replica function_spec em Elixir quando funcao possui multiplas clausulas', () => {
  const source = [
    'defmodule Multi do',
    '  @spec normalize(term(), term()) :: term()',
    '  def normalize(value, nil), do: value',
    '  def normalize(value, opts) when is_map(opts), do: Map.get(opts, :value, value)',
    'end',
  ].join('\n');

  const specIssues = issuesByKind(source, 'multi.ex', 'function_spec');
  assert.equal(specIssues.length, 0);
});

test('reporta apenas uma function_spec desatualizada em Elixir com multiplas clausulas', () => {
  const source = [
    'defmodule Multi do',
    '  @spec normalize(term()) :: term()',
    '  def normalize(value, nil), do: value',
    '  def normalize(value, opts) when is_map(opts), do: Map.get(opts, :value, value)',
    'end',
  ].join('\n');

  const specIssues = issuesByKind(source, 'multi.ex', 'function_spec');
  assert.equal(specIssues.length, 1);
  assert.equal(specIssues[0].message.includes('desatualizada'), true);
});

test('aplicacao de function_spec em Elixir com multiplas clausulas e idempotente', () => {
  const source = [
    'defmodule Multi do',
    '  @spec normalize(term()) :: term()',
    '  def normalize(value, nil), do: value',
    '  def normalize(value, opts) when is_map(opts), do: Map.get(opts, :value, value)',
    'end',
  ].join('\n');

  const initial = issuesByKind(source, 'multi.ex', 'function_spec');
  assert.equal(initial.length, 1);

  const patched = applyIssueSnippet(source, initial[0]);
  const after = issuesByKind(patched, 'multi.ex', 'function_spec');
  assert.equal(after.length, 0);
});

test('nao sobrescreve @spec de outra funcao ao corrigir assinatura Elixir', () => {
  const source = [
    'defmodule Multi do',
    '  @spec run(term()) :: term()',
    '  def run(value), do: value',
    '',
    '  @spec normalize(term()) :: term()',
    '  def normalize(value, opts), do: {value, opts}',
    'end',
  ].join('\n');

  const issues = issuesByKind(source, 'multi.ex', 'function_spec');
  const normalizeIssue = issues.find((issue) => String(issue.message || '').includes('normalize'));
  assert.ok(normalizeIssue);

  const patched = applyIssueSnippet(source, normalizeIssue);
  assert.equal(patched.includes('@spec run(term()) :: term()'), true);
  const after = issuesByKind(patched, 'multi.ex', 'function_spec');
  assert.equal(after.length, 0);
});

test('trata @spec renomeada como desatualizada e substitui no mesmo bloco', () => {
  const source = [
    'defmodule Multi do',
    '  @spec start(term(), term()) :: term()',
    '  def sstart(_type, _args), do: :ok',
    'end',
  ].join('\n');

  const issues = issuesByKind(source, 'multi.ex', 'function_spec');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].message.includes('desatualizada'), true);
  assert.equal(issues[0].action && issues[0].action.op, 'replace_range');
  assert.equal(String(issues[0].snippet || '').startsWith('@spec sstart('), true);
});
