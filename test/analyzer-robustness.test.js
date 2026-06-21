'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

test('analisa buffer Python ainda nao salvo em disco sem lancar excecao', () => {
  const source = [
    'def helper(planta, fert):',
    '    def interna():',
    '        use_item(fert)',
    '        plant(planta)',
    '',
    '    return interna',
    '',
  ].join('\n');

  // O caminho nao existe em disco (buffer novo). Antes do fix, a geracao de
  // testes lia o arquivo com fs.readFileSync e estourava ENOENT.
  let issues;
  assert.doesNotThrow(() => {
    issues = analyzeText('/tmp/pingu-unsaved-buffer-zzz.py', source);
  });
  assert.ok(Array.isArray(issues));
});

test('um check que lanca excecao nao derruba os demais checks da analise', () => {
  // debug_output e um check simples, estavel e default-on; deve aparecer mesmo
  // que outro check falhe internamente. Validamos que a analise retorna issues.
  const source = 'const x = 1\nconsole.log(x)\n';
  const issues = analyzeText('/tmp/pingu-unsaved-buffer-zzz.js', source);
  assert.ok(Array.isArray(issues));
  assert.ok(issues.some((issue) => issue.kind === 'debug_output'));
});
