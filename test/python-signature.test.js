'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  readPythonFunctionDeclaration,
  parsePythonClassDeclaration,
  collectPythonLeadingDecorators,
  parseGenericParamDescriptors,
} = require('../lib/python-signature');

test('readPythonFunctionDeclaration entende def simples e multilinha', () => {
  const single = readPythonFunctionDeclaration(['def soma(a, b):'], 0);
  assert.equal(single.name, 'soma');
  assert.deepEqual(single.params, ['a', 'b']);

  const multi = readPythonFunctionDeclaration(['def soma(', '    a,', '    b,', '):'], 0);
  assert.equal(multi.name, 'soma');
  assert.equal(multi.endIdx, 3);
  assert.deepEqual(multi.params, ['a', 'b']);
});

test('readPythonFunctionDeclaration ignora linhas que nao sao def', () => {
  assert.equal(readPythonFunctionDeclaration(['x = 1'], 0), null);
});

test('parsePythonClassDeclaration extrai o nome da classe', () => {
  assert.equal(parsePythonClassDeclaration('class Pedido:'), 'Pedido');
  assert.equal(parsePythonClassDeclaration('class Pedido(Base):'), 'Pedido');
  assert.equal(parsePythonClassDeclaration('def f():'), '');
});

test('collectPythonLeadingDecorators junta decorators acima da assinatura', () => {
  const lines = ['@app.route("/")', '@cache', 'def handler():'];
  const result = collectPythonLeadingDecorators(lines, 2);
  assert.deepEqual(result.decorators, ['route', 'cache']);
  assert.equal(result.decoratorStartIdx, 0);
});

test('parseGenericParamDescriptors devolve descritores de parametros', () => {
  const descriptors = parseGenericParamDescriptors('a, b');
  assert.ok(Array.isArray(descriptors));
  assert.equal(descriptors.length, 2);
});
