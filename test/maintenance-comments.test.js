'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { analyzeText } = require('../lib/analyzer');
const { buildMaintenanceComment } = require('../lib/support');

test('nao gera comentario automatico para imports JavaScript ESM e CommonJS', () => {
  const dependencyLines = [
    "import express from 'express';",
    "import { readFile } from 'node:fs/promises';",
    "export { createServer } from './server.js';",
    "export * from './contracts.js';",
    "const express = require('express');",
    "const { readFile } = require('node:fs/promises');",
    "const adapter = await import('./adapter.js');",
  ];

  dependencyLines.forEach((line) => {
    assert.equal(buildMaintenanceComment(line, '.js'), '');
  });
});

test('mantem comentario automatico para atribuicao JavaScript de fluxo', () => {
  const comment = buildMaintenanceComment('const payload = normalizePayload(input);', '.js');

  assert.match(comment, /^\/\/\s+\S/);
});

test('nao reporta comentario de manutencao para import CommonJS', () => {
  const source = [
    "const express = require('express');",
    "const { readFile } = require('node:fs/promises');",
    '',
    'const payload = normalizePayload(input);',
    'function run(input) {',
    '  return payload;',
    '}',
  ].join('\n');

  const importCommentIssues = analyzeText('server.js', source)
    .filter((issue) => ['flow_comment', 'variable_doc'].includes(issue.kind))
    .filter((issue) => issue.line <= 2);

  assert.deepEqual(importCommentIssues, []);
});
