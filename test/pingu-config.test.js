'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadPinguConfig,
  resolveDisabledKinds,
  isFormattingHygieneEnabled,
  isAnalyzeAiEnabled,
  resolveMaxLineLength,
  clearPinguConfigCache,
} = require('../lib/pingu-config');

// Cria um projeto temporario com um arquivo de config na raiz e um arquivo de
// codigo em um subdiretorio, para exercitar a busca subindo a arvore.
function setupProject(configName, configBody) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-config-'));
  if (configName) {
    fs.writeFileSync(path.join(root, configName), configBody);
  }
  const srcFile = path.join(root, 'src', 'feature', 'mod.js');
  fs.mkdirSync(path.dirname(srcFile), { recursive: true });
  fs.writeFileSync(srcFile, 'module.exports = {};\n');
  return { root, srcFile };
}

test.beforeEach(() => clearPinguConfigCache());

test('loadPinguConfig finds .pingurc.json walking up from a nested file', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ maxLineLength: 120 }));
  const config = loadPinguConfig(srcFile);
  assert.deepEqual(config, { maxLineLength: 120 });
});

test('loadPinguConfig accepts pingu.config.json as an alternate name', () => {
  const { srcFile } = setupProject('pingu.config.json', JSON.stringify({ analyzeAi: true }));
  const config = loadPinguConfig(srcFile);
  assert.deepEqual(config, { analyzeAi: true });
});

test('loadPinguConfig returns null when no config exists', () => {
  const { srcFile } = setupProject(null, null);
  assert.equal(loadPinguConfig(srcFile), null);
});

test('loadPinguConfig treats malformed JSON as absent without throwing', () => {
  const { srcFile } = setupProject('.pingurc.json', '{ not valid json');
  assert.equal(loadPinguConfig(srcFile), null);
});

test('resolveDisabledKinds merges config list with env list', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ disabledKinds: ['tabs', 'long_line'] }));
  const kinds = resolveDisabledKinds(srcFile, { PINGU_DISABLED_ISSUE_KINDS: 'trailing_whitespace, tabs' });
  assert.deepEqual([...kinds].sort(), ['long_line', 'tabs', 'trailing_whitespace']);
});

test('resolveDisabledKinds works from config alone when env is unset', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ disabledKinds: ['float_equality'] }));
  const kinds = resolveDisabledKinds(srcFile, {});
  assert.deepEqual([...kinds], ['float_equality']);
});

test('isFormattingHygieneEnabled reads true from config when env is unset', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ formattingHygiene: true }));
  assert.equal(isFormattingHygieneEnabled(srcFile, {}), true);
});

test('isFormattingHygieneEnabled lets env override config (env wins)', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ formattingHygiene: true }));
  assert.equal(isFormattingHygieneEnabled(srcFile, { PINGU_ENABLE_FORMATTING_HYGIENE: '0' }), false);
});

test('isFormattingHygieneEnabled defaults to false with no config and no env', () => {
  const { srcFile } = setupProject(null, null);
  assert.equal(isFormattingHygieneEnabled(srcFile, {}), false);
});

test('isAnalyzeAiEnabled reads true from config when env is unset', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ analyzeAi: true }));
  assert.equal(isAnalyzeAiEnabled(srcFile, {}), true);
});

test('isAnalyzeAiEnabled lets env override config (env wins)', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ analyzeAi: true }));
  assert.equal(isAnalyzeAiEnabled(srcFile, { PINGU_ANALYZE_AI: 'false' }), false);
});

test('resolveMaxLineLength prefers an explicit option over config and fallback', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ maxLineLength: 120 }));
  assert.equal(resolveMaxLineLength(srcFile, 80, 100, {}), 80);
});

test('resolveMaxLineLength falls back to config when no explicit option', () => {
  const { srcFile } = setupProject('.pingurc.json', JSON.stringify({ maxLineLength: 120 }));
  assert.equal(resolveMaxLineLength(srcFile, undefined, 100, {}), 120);
});

test('resolveMaxLineLength uses the fallback when neither explicit nor config provide a value', () => {
  const { srcFile } = setupProject(null, null);
  assert.equal(resolveMaxLineLength(srcFile, undefined, 100, {}), 100);
});

const { analyzeText } = require('../lib/analyzer');

test('analyzeText suppresses a kind declared in .pingurc.json disabledKinds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-config-int-'));
  fs.writeFileSync(path.join(root, '.pingurc.json'), JSON.stringify({ disabledKinds: ['self_assignment'] }));
  const file = path.join(root, 's.js');
  const source = 'function f(x) {\n  x = x;\n  if (x === x) { return 1; }\n}\n';
  fs.writeFileSync(file, source);
  clearPinguConfigCache();

  const previous = process.env.PINGU_DISABLED_ISSUE_KINDS;
  delete process.env.PINGU_DISABLED_ISSUE_KINDS;
  try {
    const kinds = analyzeText(file, source).map((issue) => issue.kind);
    assert.equal(kinds.includes('self_assignment'), false, 'self_assignment deve ser suprimido pelo config');
    assert.ok(kinds.includes('self_comparison'), 'os demais diagnosticos continuam ativos');
  } finally {
    if (previous === undefined) {
      delete process.env.PINGU_DISABLED_ISSUE_KINDS;
    } else {
      process.env.PINGU_DISABLED_ISSUE_KINDS = previous;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
