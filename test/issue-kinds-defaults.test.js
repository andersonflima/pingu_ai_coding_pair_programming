'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultAutoFixKinds, defaultActionForKind } = require('../lib/issue-kinds');

test('terminal_task remains manually actionable but is not part of default auto-fix', () => {
  assert.equal(defaultActionForKind('terminal_task').op, 'run_command');
  assert.equal(defaultAutoFixKinds().includes('terminal_task'), false);
});

test('prompt_task uses explicit range replacement outside default auto-fix', () => {
  assert.equal(defaultActionForKind('prompt_task').op, 'replace_range');
  assert.equal(defaultAutoFixKinds().includes('prompt_task'), false);
});

test('cobertura de testes e opt-in: unit_test nao entra no auto-fix padrao', () => {
  assert.equal(defaultAutoFixKinds().includes('unit_test'), false);
});

test('atualizacao de teste existente e opt-in: unit_test_signature nao entra no auto-fix padrao', () => {
  assert.equal(defaultAutoFixKinds().includes('unit_test_signature'), false);
});

test('typo e apenas sugestao: nao entra no auto-fix padrao', () => {
  assert.equal(defaultAutoFixKinds().includes('typo'), false);
});
