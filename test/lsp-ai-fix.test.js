'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildLspDiagnosticFixRequest,
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
