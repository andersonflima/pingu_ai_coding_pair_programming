'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  buildFunctionIssueMetadata,
  collectCrossLanguageFunctionBodyLines,
  findEnclosingPythonClassName,
  inferCrossLanguageReturnExpression,
} = require('../lib/function-metadata');

test('collectCrossLanguageFunctionBodyLines coleta o corpo de uma funcao Python', () => {
  const lines = ['def soma(a, b):', '    total = a + b', '    return total', '', 'x = 1'];
  const body = collectCrossLanguageFunctionBodyLines(lines, 0, '.py');
  assert.ok(body.join('\n').includes('return total'));
});

test('inferCrossLanguageReturnExpression extrai a expressao de retorno', () => {
  const ret = inferCrossLanguageReturnExpression(['total = a + b', 'return total'], '.py');
  assert.equal(ret, 'total');
});

test('findEnclosingPythonClassName encontra a classe acima do metodo', () => {
  const lines = ['class Pedido:', '    def total(self):', '        return 0'];
  assert.equal(findEnclosingPythonClassName(lines, 1), 'Pedido');
  assert.equal(findEnclosingPythonClassName(['def solta():'], 0), '');
});

test('buildFunctionIssueMetadata monta metadata da funcao com nome e retorno', () => {
  const lines = ['def soma(a, b):', '    return a + b'];
  const meta = buildFunctionIssueMetadata(lines, 0, { name: 'soma', params: ['a', 'b'] }, '.py');
  assert.ok(meta && typeof meta === 'object');
  assert.equal(meta.symbolName, 'soma');
  assert.deepEqual(meta.params, ['a', 'b']);
  assert.equal(meta.declarationStartLine, 1);
});
