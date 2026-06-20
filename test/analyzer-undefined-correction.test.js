'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  buildUndefinedVariableCorrectionSnippet,
  resolveUndefinedVariableReplacementRange,
  buildUndefinedVariableCorrectionAction,
  resolveUndefinedVariableSuggestion,
  unsafeUndefinedVariableCorrection,
} = require('../lib/analyzer-undefined-correction');

test('buildUndefinedVariableCorrectionSnippet substitui o identificador', () => {
  assert.equal(buildUndefinedVariableCorrectionSnippet('return usuairo', 'usuairo', 'usuario'), 'return usuario');
});

test('resolveUndefinedVariableReplacementRange aponta o intervalo do identificador', () => {
  const range = resolveUndefinedVariableReplacementRange('  const x = usuairo;', 'usuairo', 3);
  assert.equal(range.start.line, 2);
  assert.equal(range.start.character, 12);
  assert.equal(range.end.character, 12 + 'usuairo'.length);
  assert.equal(resolveUndefinedVariableReplacementRange('linha', '', 1), null);
});

test('buildUndefinedVariableCorrectionAction monta replace_line com range', () => {
  assert.deepEqual(buildUndefinedVariableCorrectionAction(null, 'x'), { op: 'replace_line' });
  const action = buildUndefinedVariableCorrectionAction({ start: {}, end: {} }, 'usuario');
  assert.equal(action.op, 'replace_line');
  assert.equal(action.text, 'usuario');
});

test('resolveUndefinedVariableSuggestion usa similaridade e dica explicita', () => {
  assert.equal(resolveUndefinedVariableSuggestion([], 1, 'usuairo', ['usuario', 'produto']), 'usuario');
  const withHint = ['# pingu - correction: variavel foo para bar', 'x = foo'];
  assert.equal(resolveUndefinedVariableSuggestion(withHint, 2, 'foo', ['outro']), 'bar');
});

test('unsafeUndefinedVariableCorrection bloqueia linhas de risco', () => {
  assert.equal(unsafeUndefinedVariableCorrection('import x from "y"', 'x', 'z', '.js'), true);
  assert.equal(unsafeUndefinedVariableCorrection('def helper(a):', 'helper', 'h', '.py'), true);
  assert.equal(unsafeUndefinedVariableCorrection('  return usuairo', 'usuairo', 'usuario', '.js'), false);
});
