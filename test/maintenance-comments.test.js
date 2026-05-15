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

test('nao gera comentario automatico para declaracoes de dependencia nas linguagens mapeadas', () => {
  const cases = [
    ['python import direto', '.py', 'import os'],
    ['python from import', '.py', 'from pathlib import Path'],
    ['elixir alias', '.ex', 'alias MyApp.Accounts.User'],
    ['elixir import', '.ex', 'import Ecto.Query'],
    ['elixir require', '.ex', 'require Logger'],
    ['elixir use', '.ex', 'use GenServer'],
    ['go package', '.go', 'package main'],
    ['go import direto', '.go', 'import "fmt"'],
    ['go import bloco', '.go', 'import ('],
    ['rust use', '.rs', 'use std::fmt;'],
    ['rust extern crate', '.rs', 'extern crate serde;'],
    ['rust module', '.rs', 'mod accounts;'],
    ['ruby require', '.rb', "require 'json'"],
    ['ruby require_relative', '.rb', "require_relative './user'"],
    ['lua require local', '.lua', "local socket = require('socket')"],
    ['lua require direto', '.lua', "require('socket')"],
    ['vim runtime', '.vim', 'runtime plugin/pingu.vim'],
    ['c include', '.c', '#include <stdio.h>'],
    ['c header include', '.h', '#include "user.h"'],
    ['cpp include', '.cpp', '#include <vector>'],
    ['terraform provider', '.tf', 'provider "aws" {'],
    ['yaml services', '.yaml', 'services:'],
    ['markdown heading', '.md', '# Titulo'],
    ['mermaid graph', '.mmd', 'graph LR'],
    ['dockerfile from', '.dockerfile', 'FROM node:22-alpine'],
    ['shell source', '.sh', 'source ./env.sh'],
    ['shell dot source', '.zsh', '. ./env.zsh'],
    ['toml section', '.toml', '[dependencies]'],
  ];

  cases.forEach(([name, ext, line]) => {
    assert.equal(buildMaintenanceComment(line, ext), '', name);
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
