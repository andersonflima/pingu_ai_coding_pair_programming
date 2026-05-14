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
