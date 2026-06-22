'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyInlineSuppressions,
  buildSuppressionIndex,
  isIssueSuppressed,
} = require('../lib/inline-suppressions');
const { analyzeText } = require('../lib/analyzer');

function issue(line, kind) {
  return { file: 's.js', line, kind, severity: 'warning', message: '', snippet: '' };
}

test('disable-line suprime apenas a propria linha', () => {
  const lines = [
    'a = a; // pingu-disable-line self_assignment',
    'b = b;',
  ];
  const issues = [issue(1, 'self_assignment'), issue(2, 'self_assignment')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => i.line);
  assert.deepEqual(kept, [2]);
});

test('disable-next-line suprime a linha seguinte', () => {
  const lines = [
    '// pingu-disable-next-line self_assignment',
    'a = a;',
    'b = b;',
  ];
  const issues = [issue(2, 'self_assignment'), issue(3, 'self_assignment')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => i.line);
  assert.deepEqual(kept, [3]);
});

test('sem kind listado, suprime todos os diagnosticos no alvo', () => {
  const lines = ['x = x; // pingu-disable-line'];
  const issues = [issue(1, 'self_assignment'), issue(1, 'self_comparison')];
  assert.deepEqual(applyInlineSuppressions(issues, lines), []);
});

test('suprime apenas o kind listado, mantendo os demais', () => {
  const lines = ['x = x; // pingu-disable-line self_assignment'];
  const issues = [issue(1, 'self_assignment'), issue(1, 'self_comparison')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => i.kind);
  assert.deepEqual(kept, ['self_comparison']);
});

test('aceita multiplos kinds separados por virgula/espaco', () => {
  const lines = ['x = x; // pingu-disable-line self_assignment, self_comparison'];
  const issues = [issue(1, 'self_assignment'), issue(1, 'self_comparison'), issue(1, 'unused_variable')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => i.kind);
  assert.deepEqual(kept, ['unused_variable']);
});

test('prosa apos -- nao vira kind', () => {
  const lines = ['x = x; // pingu-disable-line self_assignment -- reset intencional do acumulador'];
  const issues = [issue(1, 'self_assignment'), issue(1, 'self_comparison')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => i.kind);
  assert.deepEqual(kept, ['self_comparison']);
});

test('disable-file suprime o kind no arquivo inteiro', () => {
  const lines = [
    '// pingu-disable-file self_assignment',
    'a = a;',
    'b = b;',
  ];
  const issues = [issue(2, 'self_assignment'), issue(3, 'self_assignment'), issue(3, 'self_comparison')];
  const kept = applyInlineSuppressions(issues, lines).map((i) => `${i.line}:${i.kind}`);
  assert.deepEqual(kept, ['3:self_comparison']);
});

test('buildSuppressionIndex mapeia linha e arquivo; isIssueSuppressed avalia', () => {
  const index = buildSuppressionIndex(['// pingu-disable-next-line tabs', 'code']);
  assert.equal(isIssueSuppressed(index, issue(2, 'tabs')), true);
  assert.equal(isIssueSuppressed(index, issue(2, 'long_line')), false);
});

test('sem diretiva, retorna a lista intacta', () => {
  const issues = [issue(1, 'self_assignment')];
  assert.equal(applyInlineSuppressions(issues, ['a = a;']), issues);
});

test('integra com analyzeText: comentario silencia o diagnostico da linha', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-suppress-'));
  const file = path.join(dir, 's.js');
  const withDirective = 'function f(x) {\n  x = x; // pingu-disable-line self_assignment\n  return x;\n}\n';
  const without = 'function f(x) {\n  x = x;\n  return x;\n}\n';
  try {
    fs.writeFileSync(file, withDirective);
    const suppressed = analyzeText(file, withDirective).map((i) => i.kind);
    const baseline = analyzeText(file, without).map((i) => i.kind);
    assert.ok(baseline.includes('self_assignment'), 'baseline deve ter o diagnostico');
    assert.equal(suppressed.includes('self_assignment'), false, 'diretiva deve silenciar o diagnostico');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
