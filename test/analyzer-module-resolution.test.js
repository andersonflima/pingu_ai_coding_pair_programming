'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { resolveLocalModuleFile, collectJavaScriptExportNames } = require('../lib/analyzer-module-resolution');

test('collectJavaScriptExportNames coleta exports nomeados, default-like e CommonJS', () => {
  const source = [
    'export function alpha() {}',
    'export const beta = 1;',
    'export class Gamma {}',
    'exports.delta = () => {};',
    'export { epsilon, zeta as eta };',
    'module.exports = { theta, iota: 1 };',
  ].join('\n');
  const names = collectJavaScriptExportNames(source).sort();
  assert.deepEqual(names, ['Gamma', 'alpha', 'beta', 'delta', 'epsilon', 'eta', 'iota', 'theta']);
});

test('resolveLocalModuleFile resolve import relativo JS e usa o cache', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-mod-'));
  try {
    fs.writeFileSync(path.join(dir, 'util.js'), 'export const x = 1;');
    const importer = path.join(dir, 'main.js');
    const cache = new Map();
    const resolved = resolveLocalModuleFile(importer, './util', '.js', cache);
    assert.equal(resolved, path.join(dir, 'util.js'));
    // segunda chamada vem do cache (mesmo resultado).
    assert.equal(resolveLocalModuleFile(importer, './util', '.js', cache), resolved);
    assert.equal(cache.size >= 1, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveLocalModuleFile retorna vazio para modulo nao relativo ou inexistente', () => {
  const cache = new Map();
  assert.equal(resolveLocalModuleFile('/tmp/a/main.js', 'react', '.js', cache), '');
  assert.equal(resolveLocalModuleFile('/tmp/a/main.js', './nao-existe', '.js', cache), '');
});
