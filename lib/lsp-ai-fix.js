'use strict';

const path = require('path');
const { createAiProvider } = require('./ai-provider');

const DEFAULT_CONTEXT_RADIUS = 8;
const LOCAL_EDIT_OPS = new Set([
  'delete_line',
  'insert_after',
  'insert_before',
  'replace_line',
  'replace_range',
]);

function resolveLspDiagnosticFix(payload = {}, deps = {}) {
  const provider = deps.provider || createAiProvider(deps.providerDeps || {});
  const env = deps.env || process.env;
  const hasProvider = typeof provider.hasOpenAiConfiguration === 'function'
    ? provider.hasOpenAiConfiguration(env)
    : false;
  if (!hasProvider || typeof provider.resolveAiIssueFix !== 'function') {
    return { ok: false, reason: 'provider_unavailable' };
  }

  const request = buildLspDiagnosticFixRequest(payload);
  const resolution = provider.resolveAiIssueFix(request, env);
  if (!resolution || !String(resolution.snippet || '').trim()) {
    return { ok: false, reason: 'empty_resolution' };
  }

  const action = normalizeLspAiAction(resolution.action, request.issue);
  if (!action) {
    return { ok: false, reason: 'unsafe_action' };
  }

  return {
    ok: true,
    issue: {
      file: request.file,
      line: request.issue.line,
      severity: 'warning',
      kind: 'lsp_ai_fix',
      message: resolution.message || request.issue.message,
      suggestion: resolution.suggestion || request.issue.suggestion,
      snippet: String(resolution.snippet || ''),
      action,
      metadata: request.issue.metadata,
    },
  };
}

function buildLspDiagnosticFixRequest(payload = {}) {
  const file = path.resolve(String(payload.file || payload.sourcePath || 'stdin'));
  const lines = normalizeLines(payload.lines);
  const diagnostic = normalizeDiagnostic(payload.diagnostic || payload.issue || {});
  const line = clampLine(diagnostic.line || payload.line || 1, lines.length);
  const context = buildLspDiagnosticContext(lines, line, diagnostic, file);
  const issue = {
    file,
    line,
    severity: 'warning',
    kind: 'lsp_ai_fix',
    message: diagnostic.message || 'Warning do LSP sem code action aplicavel.',
    suggestion: 'Corrija o warning do LSP com a menor alteracao local segura.',
    action: { op: 'replace_line' },
    metadata: {
      lspSeverity: diagnostic.severity,
      lspSource: diagnostic.source,
      lspCode: diagnostic.code,
      lspMessage: diagnostic.message,
      lineText: context.lineText,
      surroundingLines: context.surroundingLines,
    },
  };

  const instruction = [
    'Corrija o warning do LSP preservando comportamento e estilo local.',
    'Use a menor edicao local possivel.',
    'Nao reescreva o arquivo inteiro.',
    `Diagnostico: ${issue.message}`,
    diagnostic.source ? `Fonte: ${diagnostic.source}` : '',
    diagnostic.code ? `Codigo: ${diagnostic.code}` : '',
  ].filter(Boolean).join(' ');

  return {
    ext: path.extname(file).toLowerCase(),
    lines,
    sourceFile: file,
    issue,
    issueInstruction: instruction,
    instruction,
    effectiveInstruction: instruction,
    issueContext: context,
    lspDiagnostic: diagnostic,
  };
}

function normalizeLines(lines) {
  if (Array.isArray(lines)) {
    return lines.map((line) => String(line || ''));
  }
  return String(lines || '').replace(/\r\n/g, '\n').split('\n');
}

function normalizeDiagnostic(diagnostic = {}) {
  return {
    line: Number(diagnostic.line || diagnostic.lnum || 1) || 1,
    col: Number(diagnostic.col || diagnostic.column || 1) || 1,
    severity: String(diagnostic.severity || 'warning'),
    message: String(diagnostic.message || '').trim(),
    source: String(diagnostic.source || '').trim(),
    code: String(diagnostic.code || '').trim(),
  };
}

function clampLine(line, lineCount) {
  const parsed = Number(line || 1);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1;
  }
  if (lineCount <= 0) {
    return Math.max(1, Math.floor(parsed));
  }
  return Math.min(lineCount, Math.max(1, Math.floor(parsed)));
}

function buildLspDiagnosticContext(lines, line, diagnostic, file) {
  const focusLine = clampLine(line, lines.length);
  const start = Math.max(0, focusLine - DEFAULT_CONTEXT_RADIUS - 1);
  const end = Math.min(lines.length, focusLine + DEFAULT_CONTEXT_RADIUS);
  return {
    extension: path.extname(file).toLowerCase(),
    issueKind: 'lsp_ai_fix',
    issueMessage: diagnostic.message,
    issueSuggestion: 'Corrija o warning do LSP com edicao local minima.',
    focusLine,
    lineText: String(lines[focusLine - 1] || ''),
    surroundingLines: lines.slice(start, end).map((text, index) => ({
      line: start + index + 1,
      text: String(text || ''),
    })),
    metadata: {
      lspSeverity: diagnostic.severity,
      lspSource: diagnostic.source,
      lspCode: diagnostic.code,
      lspMessage: diagnostic.message,
    },
  };
}

function normalizeLspAiAction(action, issue) {
  const raw = action && typeof action === 'object' ? action : {};
  const op = String(raw.op || '').trim() || 'replace_line';
  if (!LOCAL_EDIT_OPS.has(op)) {
    return null;
  }

  if (op === 'replace_range') {
    return raw.range && typeof raw.range === 'object'
      ? { op, range: raw.range }
      : null;
  }

  if (op === 'delete_line') {
    return { op };
  }

  if (['insert_after', 'insert_before', 'replace_line'].includes(op)) {
    return { op };
  }

  return { op: issue && issue.action && issue.action.op || 'replace_line' };
}

module.exports = {
  buildLspDiagnosticFixRequest,
  resolveLspDiagnosticFix,
};
