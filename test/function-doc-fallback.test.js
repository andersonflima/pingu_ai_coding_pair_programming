'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  functionDescriptionFromName,
  snippetFunctionComment,
  snippetFunctionDoc,
} = require('../lib/support');

test('functionDescriptionFromName evita frase generica no fallback', () => {
  const description = functionDescriptionFromName('start');

  assert.doesNotMatch(description, /Orquestra o comportamento principal/i);
  assert.match(description, /Executa a etapa principal/i);
});

test('snippetFunctionDoc gera argumentos contextualizados sem placeholder generico', () => {
  const snippet = snippetFunctionDoc('start', ['room_id', 'payload', '_args']);

  assert.doesNotMatch(snippet, /entrada utilizada nesta etapa/i);
  assert.match(snippet, /- room_id: Identificador usado para localizar o recurso tratado nesta etapa\./);
  assert.match(snippet, /- payload: Carga de dados recebida e validada antes de seguir no fluxo\./);
  assert.match(snippet, /- _args: Valor de entrada para args dentro desta funcao\./);
});

test('snippetFunctionComment descreve contrato com contexto da funcao', () => {
  const snippet = snippetFunctionComment('start', ['_type', '_args'], '.ex');

  assert.match(snippet, /Contrato: manter o retorno consistente com o fluxo de start\./);
});
