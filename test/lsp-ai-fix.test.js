'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildLspDiagnosticFixRequest,
  extractUndefinedSymbol,
  resolveLspDiagnosticFix,
} = require('../lib/lsp-ai-fix');

test('buildLspDiagnosticFixRequest monta contexto do warning do LSP', () => {
  const request = buildLspDiagnosticFixRequest({
    file: '/tmp/sample.py',
    lines: [
      'def run(value):',
      '    unused = value',
      '    return value',
    ],
    diagnostic: {
      line: 2,
      severity: 'warning',
      message: 'Local variable unused is assigned to but never used',
      source: 'pyright',
      code: 'reportUnusedVariable',
    },
  });

  assert.equal(request.ext, '.py');
  assert.equal(request.issue.kind, 'lsp_ai_fix');
  assert.equal(request.issue.line, 2);
  assert.equal(request.issue.metadata.lspSource, 'pyright');
  assert.match(request.instruction, /Local variable unused/);
  assert.equal(request.issueContext.lineText, '    unused = value');
});

test('resolveLspDiagnosticFix usa provider e limita action a edicao local', () => {
  const calls = [];
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiIssueFix: (request) => {
      calls.push(request);
      return {
        snippet: '    return value',
        message: 'Remove atribuicao nao usada',
        suggestion: 'Substituir linha pelo retorno direto.',
        action: { op: 'replace_line' },
      };
    },
  };

  const result = resolveLspDiagnosticFix({
    file: '/tmp/sample.py',
    lines: ['def run(value):', '    unused = value', '    return value'],
    diagnostic: {
      line: 2,
      severity: 'warning',
      message: 'unused variable',
      source: 'pyright',
    },
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.kind, 'lsp_ai_fix');
  assert.equal(result.issue.snippet, '    return value');
  assert.deepEqual(result.issue.action, { op: 'replace_line' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lspDiagnostic.source, 'pyright');
});

test('buildLspDiagnosticFixRequest orienta Pyright undefined variable a importar simbolo existente', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-lsp-ai-'));
  const helpersFile = path.join(root, 'inventory.py');
  const farmFile = path.join(root, 'farm.py');
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "sample"\n');
  fs.writeFileSync(helpersFile, 'def use_item(item):\n    return item\n');
  fs.writeFileSync(farmFile, 'def run(item):\n    return use_item(item)\n');

  const request = buildLspDiagnosticFixRequest({
    file: farmFile,
    lines: [
      'def run(item):',
      '    return use_item(item)',
    ],
    diagnostic: {
      line: 2,
      severity: 'error',
      message: '"use_item" is not defined',
      source: 'Pyright',
      code: 'reportUndefinedVariable',
    },
  });

  assert.equal(request.issue.metadata.undefinedSymbol, 'use_item');
  assert.equal(request.issue.metadata.importCandidates.length, 1);
  assert.equal(request.issue.metadata.importCandidates[0].importStatement, 'from inventory import use_item');
  assert.match(request.instruction, /Antes de criar codigo novo, avalie importCandidates/);
  assert.match(request.instruction, /prefira adicionar somente o import necessario/);
  assert.equal(request.issueContext.importInsertionLine, 1);
});

test('resolveLspDiagnosticFix preserva linha escolhida pela IA para inserir import', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiIssueFix: () => ({
      snippet: 'from inventory import use_item',
      message: 'Importa simbolo existente',
      suggestion: 'Adicionar import para use_item.',
      action: { op: 'insert_before', line: 1 },
    }),
  };

  const result = resolveLspDiagnosticFix({
    file: '/tmp/farm.py',
    lines: ['def run(item):', '    return use_item(item)'],
    diagnostic: {
      line: 2,
      severity: 'error',
      message: '"use_item" is not defined',
      source: 'Pyright',
      code: 'reportUndefinedVariable',
    },
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.line, 1);
  assert.deepEqual(result.issue.action, { op: 'insert_before', line: 1 });
  assert.equal(result.issue.snippet, 'from inventory import use_item');
});

test('extractUndefinedSymbol entende Ruff F821 com crases', () => {
  const symbol = extractUndefinedSymbol({
    message: 'Undefined name `use_item`',
    source: 'Ruff',
    code: 'F821',
  });

  assert.equal(symbol, 'use_item');
});

test('resolveLspDiagnosticFix usa fallback de import quando provider retorna vazio para Ruff F821', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-ruff-import-'));
  const helpersFile = path.join(root, 'inventory.py');
  const farmFile = path.join(root, 'farm.py');
  fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname = "sample"\n');
  fs.writeFileSync(helpersFile, 'def use_item(item):\n    return item\n');
  fs.writeFileSync(farmFile, 'def run(item):\n    return use_item(item)\n');

  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiIssueFix: () => null,
  };

  const result = resolveLspDiagnosticFix({
    file: farmFile,
    lines: ['def run(item):', '    return use_item(item)'],
    diagnostic: {
      line: 2,
      severity: 'error',
      message: 'Undefined name `use_item`',
      source: 'Ruff',
      code: 'F821',
    },
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.snippet, 'from inventory import use_item');
  assert.deepEqual(result.issue.action, { op: 'insert_before', line: 1 });
  assert.equal(result.issue.metadata.fallbackReason, 'empty_resolution');
});

test('resolveLspDiagnosticFix cria stub minimo quando Ruff F821 nao tem candidato de import', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiIssueFix: () => ({ snippet: '' }),
  };

  const result = resolveLspDiagnosticFix({
    file: '/tmp/farm.py',
    lines: [
      'def run(seed):',
      '    return plant(seed)',
    ],
    diagnostic: {
      line: 2,
      severity: 'error',
      message: 'Undefined name `plant`',
      source: 'Ruff',
      code: 'F821',
    },
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.line, 1);
  assert.equal(result.issue.snippet, 'def plant(seed):\n    pass\n');
  assert.deepEqual(result.issue.action, { op: 'insert_before', line: 1 });
});

test('resolveLspDiagnosticFix rejeita action ampla do provider', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiIssueFix: () => ({
      snippet: 'novo arquivo inteiro',
      action: { op: 'write_file', target_file: '/tmp/sample.py' },
    }),
  };

  const result = resolveLspDiagnosticFix({
    file: '/tmp/sample.py',
    lines: ['value = 1'],
    diagnostic: { line: 1, severity: 'warning', message: 'warning' },
  }, { provider });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'unsafe_action');
});
