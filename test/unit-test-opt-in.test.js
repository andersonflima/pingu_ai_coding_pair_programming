'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

function createProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-optin-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'optin-fixture' }));
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  return root;
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test('metodo atualizado com teste existente: aponta o teste e e opt-in', () => {
  const root = createProject();
  try {
    // soma agora exige dois argumentos; o teste existente ainda chama com um.
    fs.writeFileSync(
      path.join(root, 'test', 'calc.test.js'),
      [
        "const { soma } = require('../calc');",
        "test('soma', () => { expect(soma(1)).toBe(1); });",
        '',
      ].join('\n'),
    );

    const sourceFile = path.join(root, 'calc.js');
    const source = ['function soma(a, b) {', '  return a + b;', '}', '', 'module.exports = { soma };', ''].join('\n');

    const drift = analyzeText(sourceFile, source).filter((issue) => issue.kind === 'unit_test_signature');
    assert.equal(drift.length >= 1, true, 'esperava ao menos um aviso de assinatura desatualizada');

    const issue = drift[0];
    assert.match(issue.message, /calc\.test\.js/, 'a mensagem deve apontar o teste existente');
    assert.match(issue.suggestion, /Aplique/, 'a sugestao deve pedir aplicacao explicita (opt-in)');
    // Continua acionavel manualmente, mas nunca como auto-fix automatico.
    assert.equal(issue.severity, 'warning');
  } finally {
    cleanup(root);
  }
});

test('multiplos testes do mesmo metodo sao apontados individualmente', () => {
  const root = createProject();
  try {
    const outdated = [
      "const { soma } = require('../calc');",
      "test('soma', () => { expect(soma(1)).toBe(1); });",
      '',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'test', 'calc.test.js'), outdated);
    fs.writeFileSync(path.join(root, 'test', 'calc.unit.test.js'), outdated);

    const sourceFile = path.join(root, 'calc.js');
    const source = ['function soma(a, b) {', '  return a + b;', '}', '', 'module.exports = { soma };', ''].join('\n');

    const drift = analyzeText(sourceFile, source).filter((issue) => issue.kind === 'unit_test_signature');
    const files = new Set(drift.map((issue) => issue.metadata && issue.metadata.targetFile));
    assert.equal(files.size >= 2, true, 'deve apontar cada teste relacionado ao metodo alterado');
  } finally {
    cleanup(root);
  }
});
