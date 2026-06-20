'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  checkFunctionSpecs,
  isElixirFunctionDocOutdated,
  resolveElixirAnnotationRange,
} = require('../lib/analyzer-elixir-doc-spec');

test('checkFunctionSpecs sinaliza @spec desatualizado frente a assinatura atual', () => {
  const lines = [
    'defmodule Calc do',
    '  @spec soma(integer()) :: integer()',
    '  def soma(a, b) do',
    '    a + b',
    '  end',
    'end',
  ];
  const issues = checkFunctionSpecs(lines, 'lib/calc.ex', {});
  assert.ok(Array.isArray(issues));
  assert.ok(issues.some((issue) => issue.line === 2), 'deveria apontar o @spec da linha 2');
});

test('checkFunctionSpecs nao reclama quando o @spec bate com a assinatura', () => {
  const lines = [
    'defmodule Calc do',
    '  @spec soma(integer(), integer()) :: integer()',
    '  def soma(a, b) do',
    '    a + b',
    '  end',
    'end',
  ];
  const issues = checkFunctionSpecs(lines, 'lib/calc.ex', {});
  assert.deepEqual(issues, []);
});

test('checkFunctionSpecs ignora arquivos nao-Elixir', () => {
  assert.deepEqual(checkFunctionSpecs(['function soma(a, b) {}'], 'src/calc.js', {}), []);
});

test('resolveElixirAnnotationRange devolve null quando nao ha anotacao acima', () => {
  const lines = ['def soma(a, b) do', '  a + b', 'end'];
  const range = resolveElixirAnnotationRange(lines, 0, '@doc');
  assert.ok(range === null || range === undefined || range.start === undefined);
});

test('isElixirFunctionDocOutdated e uma funcao exportada', () => {
  assert.equal(typeof isElixirFunctionDocOutdated, 'function');
});
