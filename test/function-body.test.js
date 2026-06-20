'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  isFunctionDeclarationLine,
  collectFunctionBodyLines,
  lastMeaningfulBodyLine,
} = require('../lib/function-body');

test('isFunctionDeclarationLine reconhece def/defp/defmodule Elixir', () => {
  assert.equal(isFunctionDeclarationLine('def soma(a, b) do'), true);
  assert.equal(isFunctionDeclarationLine('defp helper(x), do: x'), true);
  assert.equal(isFunctionDeclarationLine('defmodule Calc do'), true);
  assert.equal(isFunctionDeclarationLine('x = 1'), false);
  assert.equal(isFunctionDeclarationLine(''), false);
});

test('collectFunctionBodyLines lida com forma inline do: e balanceamento do/end', () => {
  assert.deepEqual(collectFunctionBodyLines(['defp helper(x), do: x + 1'], 0), ['x + 1']);

  const lines = ['def soma(a, b) do', '  total = a + b', '  total', 'end'];
  assert.deepEqual(collectFunctionBodyLines(lines, 0), ['  total = a + b', '  total']);
});

test('lastMeaningfulBodyLine ignora linhas vazias e comentarios', () => {
  assert.equal(lastMeaningfulBodyLine(['a = 1', '  result', '', '  # comentario']), 'result');
  assert.equal(lastMeaningfulBodyLine([]), '');
});
