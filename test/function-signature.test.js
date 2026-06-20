'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  parseFunctionParams,
  parseFunctionScopeParams,
  extractBoundPatternVars,
  parseFunctionDeclaration,
  readElixirFunctionDeclaration,
  stripTrailingElixirGuardClause,
} = require('../lib/function-signature');

test('parseFunctionParams extrai nomes de parametros', () => {
  assert.deepEqual(parseFunctionParams('a, b, c'), ['a', 'b', 'c']);
  assert.deepEqual(parseFunctionParams('opts \\\\ []'), ['opts']);
  assert.deepEqual(parseFunctionParams(''), []);
});

test('extractBoundPatternVars ignora reservadas e chaves de mapa', () => {
  assert.deepEqual(extractBoundPatternVars('%{a: x, b: y}').sort(), ['x', 'y']);
  assert.deepEqual(parseFunctionScopeParams('{first, second}').sort(), ['first', 'second']);
});

test('stripTrailingElixirGuardClause remove clausula when', () => {
  assert.equal(stripTrailingElixirGuardClause('soma(a, b) when is_integer(a)'), 'soma(a, b)');
  assert.equal(stripTrailingElixirGuardClause('soma(a, b)'), 'soma(a, b)');
});

test('parseFunctionDeclaration entende def Elixir com parenteses e do:', () => {
  const withParens = parseFunctionDeclaration('def soma(a, b) do');
  assert.equal(withParens.name, 'soma');
  assert.deepEqual(withParens.params, ['a', 'b']);
  assert.equal(withParens.paramArity, 2);

  const inline = parseFunctionDeclaration('defp helper(x), do: x + 1');
  assert.equal(inline.visibility, 'defp');
  assert.equal(inline.name, 'helper');

  assert.equal(parseFunctionDeclaration('x = 1'), null);
});

test('readElixirFunctionDeclaration junta cabecalho multilinha', () => {
  const lines = ['def soma(', '  a,', '  b', ') do'];
  const decl = readElixirFunctionDeclaration(lines, 0);
  assert.equal(decl.name, 'soma');
  assert.equal(decl.endIdx, 3);
  assert.deepEqual(decl.params, ['a', 'b']);
});
