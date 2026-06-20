'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  matchPythonIdentifier,
  matchPythonInlineString,
  stripPythonInlineSyntax,
  normalizePythonImportSource,
  extractPythonImportVars,
} = require('../lib/python-scope-utils');

test('matchPythonIdentifier valida identificadores', () => {
  assert.equal(matchPythonIdentifier('valor'), 'valor');
  assert.equal(matchPythonIdentifier('  x_1 '), 'x_1');
  assert.equal(matchPythonIdentifier('1abc'), '');
  assert.equal(matchPythonIdentifier('a.b'), '');
});

test('stripPythonInlineSyntax remove strings e comentarios da linha', () => {
  assert.equal(stripPythonInlineSyntax('x = 1  # comentario').trim(), 'x = 1');
  assert.equal(stripPythonInlineSyntax('msg = "ola # mundo"').includes('ola'), false);
  assert.equal(stripPythonInlineSyntax("s = '''triplo'''").includes('triplo'), false);
});

test('matchPythonInlineString reconhece aspas simples, triplas e prefixos', () => {
  assert.equal(matchPythonInlineString('"abc"def', 0).end, 5);
  assert.equal(matchPythonInlineString("r'raw'", 0).end, 6);
  assert.equal(matchPythonInlineString('nao', 0), null);
});

test('normalizePythonImportSource normaliza import e from import', () => {
  assert.equal(normalizePythonImportSource('import   os,  sys '), 'import os, sys');
  assert.equal(normalizePythonImportSource('from x import ( a, b )'), 'from x import a, b');
});

test('extractPythonImportVars extrai nomes (com alias)', () => {
  assert.deepEqual(extractPythonImportVars('import os').sort(), ['os']);
  assert.deepEqual(extractPythonImportVars('import numpy as np').sort(), ['np']);
  assert.deepEqual(extractPythonImportVars('from x import a, b as c').sort(), ['a', 'c']);
  assert.deepEqual(extractPythonImportVars('from x import *'), []);
});
