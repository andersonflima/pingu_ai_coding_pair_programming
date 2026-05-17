'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildFollowUpInstruction } = require('../lib/follow-up');

test('buildFollowUpInstruction usa output de syntax error no prompt de correcao', () => {
  const instruction = buildFollowUpInstruction({
    file: 'lib/example.ex',
    kind: 'syntax_missing_delimiter',
    message: "Syntax error before: 'Logger' em lib/example.ex:30:7",
    suggestion: 'Feche o bloco do com end antes de Logger.debug/1.',
  });

  assert.match(instruction, /diagnostico:/i);
  assert.match(instruction, /Logger/);
  assert.match(instruction, /retorne apenas o trecho final corrigido/i);
});

test('buildFollowUpInstruction mantem comportamento padrao fora de syntax', () => {
  const instruction = buildFollowUpInstruction({
    file: 'lib/example.ex',
    kind: 'function_spec',
    message: 'Especificacao @spec ausente para run',
  });

  assert.equal(instruction, 'adicione @spec coerente com os parametros e o retorno reais da funcao');
});
