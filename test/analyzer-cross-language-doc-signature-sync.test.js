'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const { analyzeText } = require('../lib/analyzer');

function functionDocIssues(text, file = 'module.c') {
  return analyzeText(file, text).filter((issue) => issue.kind === 'function_doc');
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
