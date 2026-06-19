'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  collapseRepeatedChars,
  isSubsequence,
  levenshteinDistance,
  suggestSimilarIdentifier,
} = require('../lib/identifier-similarity');

test('levenshteinDistance conta operacoes de edicao basicas', () => {
  assert.equal(levenshteinDistance('', ''), 0);
  assert.equal(levenshteinDistance('abc', 'abc'), 0);
  assert.equal(levenshteinDistance('usuario', 'usuairo'), 2);
  assert.equal(levenshteinDistance('retrun', 'return'), 2);
  assert.equal(levenshteinDistance('lenght', 'length'), 2);
});

test('levenshteinDistance trata entradas nulas como string vazia', () => {
  assert.equal(levenshteinDistance(null, undefined), 0);
  assert.equal(levenshteinDistance('abc', null), 3);
});

test('collapseRepeatedChars remove repeticoes consecutivas', () => {
  assert.equal(collapseRepeatedChars('aabbcc'), 'abc');
  assert.equal(collapseRepeatedChars('Hello'), 'helo');
  assert.equal(collapseRepeatedChars(''), '');
});

test('isSubsequence reconhece subsequencias', () => {
  assert.equal(isSubsequence('abc', 'aXbXc'), true);
  assert.equal(isSubsequence('', 'qualquer'), true);
  assert.equal(isSubsequence('abc', 'ab'), false);
});

test('suggestSimilarIdentifier escolhe o candidato mais proximo do escopo', () => {
  assert.equal(suggestSimilarIdentifier('usuairo', ['usuario', 'produto', 'pedido']), 'usuario');
  assert.equal(suggestSimilarIdentifier('contdor', ['contador', 'total']), 'contador');
});

test('suggestSimilarIdentifier retorna null quando nada e proximo', () => {
  assert.equal(suggestSimilarIdentifier('xyz', ['totalmenteDiferente', 'outro']), null);
  assert.equal(suggestSimilarIdentifier('usuario', []), null);
});
