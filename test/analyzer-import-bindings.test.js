'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  supportsLocalImportBindingValidation,
  parseLocalImportBindings,
  isRelativeModuleSpecifier,
  readJavaScriptImportStatement,
} = require('../lib/analyzer-import-bindings');
const { splitTopLevelParams } = require('../lib/support');

test('supportsLocalImportBindingValidation cobre JS e Python', () => {
  assert.equal(supportsLocalImportBindingValidation('.js'), true);
  assert.equal(supportsLocalImportBindingValidation('.py'), true);
  assert.equal(supportsLocalImportBindingValidation('.go'), false);
});

test('parseLocalImportBindings extrai bindings ESM relativos', () => {
  const descriptor = parseLocalImportBindings("import { a, b as c } from './mod';", '.js');
  assert.equal(descriptor.source, './mod');
  assert.deepEqual(descriptor.bindings.map((binding) => binding.importedName), ['a', 'b']);
  assert.deepEqual(descriptor.bindings.map((binding) => binding.localName), ['a', 'c']);
});

test('parseLocalImportBindings ignora imports nao relativos', () => {
  assert.equal(parseLocalImportBindings("import { a } from 'react';", '.js'), null);
});

test('parseLocalImportBindings extrai from-import relativo em Python', () => {
  const descriptor = parseLocalImportBindings('from .mod import a, b as c', '.py');
  assert.equal(descriptor.source, '.mod');
  assert.deepEqual(descriptor.bindings.map((binding) => binding.importedName), ['a', 'b']);
});

test('isRelativeModuleSpecifier distingue caminho relativo', () => {
  assert.equal(isRelativeModuleSpecifier('./x'), true);
  assert.equal(isRelativeModuleSpecifier('react'), false);
});

test('readJavaScriptImportStatement junta import multilinha', () => {
  const lines = ['import {', '  a,', '  b,', "} from './mod';"];
  const result = readJavaScriptImportStatement(lines, 0);
  assert.equal(result.source, './mod');
  assert.equal(result.endIdx, 3);
  assert.deepEqual(result.bindings.map((binding) => binding.importedName), ['a', 'b']);
});

test('splitTopLevelParams (movido para support) respeita aninhamento', () => {
  assert.deepEqual(splitTopLevelParams('a, b, c'), ['a', 'b', 'c']);
  assert.deepEqual(splitTopLevelParams('a, fn(x, y), b'), ['a', 'fn(x, y)', 'b']);
  assert.deepEqual(splitTopLevelParams('Map<string, number>, b'), ['Map<string, number>', 'b']);
});
