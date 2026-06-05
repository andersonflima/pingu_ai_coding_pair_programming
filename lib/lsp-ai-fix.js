'use strict';

const path = require('path');
const { createAiProvider } = require('./ai-provider');
const { DEFAULT_IGNORE_DIRS } = require('./cli-targets');
const { collectSourceSymbols } = require('./source-symbols');
const { resolveProjectRoot, toPosixPath } = require('./project-paths');

const fs = require('fs');

const DEFAULT_CONTEXT_RADIUS = 8;
const MAX_PROJECT_FILES_TO_SCAN = 160;
const MAX_IMPORT_CANDIDATES = 12;
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

  const line = clampLine(action.line || action.lnum || request.issue.line, request.lines.length);

  return {
    ok: true,
    issue: {
      file: request.file,
      line,
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
  const undefinedSymbol = extractUndefinedSymbol(diagnostic);
  const importCandidates = undefinedSymbol
    ? collectImportCandidates({ file, lines, symbolName: undefinedSymbol })
    : [];
  const context = buildLspDiagnosticContext(lines, line, diagnostic, file, {
    importCandidates,
    undefinedSymbol,
  });
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
      undefinedSymbol,
      importCandidates,
      lineText: context.lineText,
      surroundingLines: context.surroundingLines,
    },
  };

  const instruction = [
    'Corrija o warning do LSP preservando comportamento e estilo local.',
    'Use a menor edicao local possivel.',
    'Nao reescreva o arquivo inteiro.',
    buildUndefinedSymbolInstruction(undefinedSymbol, importCandidates, context),
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

function extractUndefinedSymbol(diagnostic = {}) {
  const message = String(diagnostic.message || '').trim();
  const code = String(diagnostic.code || '').trim();
  const isUndefinedDiagnostic = /undefined|not defined|unresolved|cannot find name/i.test(message)
    || /undefined|unresolved/i.test(code);
  if (!isUndefinedDiagnostic) {
    return '';
  }

  const quoted = message.match(/["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]\s+(?:is\s+)?(?:not\s+defined|undefined|unresolved|is\s+not\s+defined)/i);
  if (quoted) {
    return quoted[1];
  }

  const cannotFind = message.match(/Cannot find name ["'`]([A-Za-z_][A-Za-z0-9_]*)["'`]/i);
  if (cannotFind) {
    return cannotFind[1];
  }

  return '';
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

function buildLspDiagnosticContext(lines, line, diagnostic, file, options = {}) {
  const focusLine = clampLine(line, lines.length);
  const start = Math.max(0, focusLine - DEFAULT_CONTEXT_RADIUS - 1);
  const end = Math.min(lines.length, focusLine + DEFAULT_CONTEXT_RADIUS);
  const importCandidates = Array.isArray(options.importCandidates) ? options.importCandidates : [];
  const undefinedSymbol = String(options.undefinedSymbol || '');
  return {
    extension: path.extname(file).toLowerCase(),
    issueKind: 'lsp_ai_fix',
    issueMessage: diagnostic.message,
    issueSuggestion: 'Corrija o warning do LSP com edicao local minima.',
    focusLine,
    importInsertionLine: findImportInsertionLine(lines, path.extname(file).toLowerCase()),
    undefinedSymbol,
    importCandidates,
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
      undefinedSymbol,
      importCandidates,
    },
  };
}

function buildUndefinedSymbolInstruction(undefinedSymbol, importCandidates, context) {
  if (!undefinedSymbol) {
    return '';
  }

  const base = [
    `O simbolo indefinido e "${undefinedSymbol}".`,
    'Antes de criar codigo novo, avalie importCandidates no payload.',
    'Se houver candidato com nome exato e import seguro, prefira adicionar somente o import necessario.',
    `Para import, retorne action {"op":"insert_before","line":${context.importInsertionLine}} e snippet com a linha de import.`,
    'Se nao houver candidato util, crie a menor definicao local faltante antes do primeiro uso.',
    'Para chamada de funcao Python, crie uma funcao com assinatura minima inferida pelo uso e corpo seguro/coerente com o contexto.',
  ];
  if (importCandidates.length > 0) {
    base.push(`Candidatos encontrados: ${importCandidates.map((candidate) => candidate.importStatement || candidate.file).join(' | ')}`);
  }
  return base.join(' ');
}

function collectImportCandidates({ file, lines, symbolName }) {
  const ext = path.extname(file).toLowerCase();
  if (!symbolName || !ext) {
    return [];
  }

  const currentSymbols = collectSourceSymbols(lines, ext);
  if (currentSymbols.some((symbol) => symbol.name === symbolName)) {
    return [];
  }

  const root = resolveProjectRoot(file);
  const files = collectCandidateFiles(root, ext)
    .filter((candidateFile) => path.resolve(candidateFile) !== path.resolve(file))
    .slice(0, MAX_PROJECT_FILES_TO_SCAN);

  return files.flatMap((candidateFile) => {
    const source = safeReadFile(candidateFile);
    if (!source) {
      return [];
    }
    return collectSourceSymbols(source, candidateFile)
      .filter((symbol) => symbol.name === symbolName)
      .map((symbol) => ({
        file: candidateFile,
        importPath: buildImportPath(candidateFile, ext, root),
        importStatement: buildImportStatement(candidateFile, ext, symbol.name, root),
        kind: symbol.kind,
        line: symbol.line,
        name: symbol.name,
        signature: symbol.signature,
      }));
  }).filter((candidate) => candidate.importStatement).slice(0, MAX_IMPORT_CANDIDATES);
}

function collectCandidateFiles(root, ext) {
  const files = [];
  const visit = (currentDir) => {
    if (files.length >= MAX_PROJECT_FILES_TO_SCAN) {
      return;
    }
    const entries = safeReadDir(currentDir);
    entries.forEach((entry) => {
      if (files.length >= MAX_PROJECT_FILES_TO_SCAN) {
        return;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
          visit(fullPath);
        }
        return;
      }
      if (entry.isFile() && path.extname(entry.name).toLowerCase() === ext) {
        files.push(fullPath);
      }
    });
  };
  visit(root);
  return files;
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch (_error) {
    return [];
  }
}

function safeReadFile(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_error) {
    return '';
  }
}

function buildImportPath(candidateFile, ext, root) {
  if (ext !== '.py') {
    return '';
  }
  const relative = path.relative(root, candidateFile).replace(new RegExp(`${escapeRegExp(ext)}$`), '');
  const normalized = toPosixPath(relative).replace(/\/__init__$/, '').replace(/\//g, '.');
  return normalized.replace(/^\.\//, '').replace(/^\.$/, '').replace(/^\.+/, '');
}

function buildImportStatement(candidateFile, ext, symbolName, root) {
  if (ext !== '.py') {
    return '';
  }
  const importPath = buildImportPath(candidateFile, ext, root);
  if (!importPath) {
    return '';
  }
  return `from ${importPath} import ${symbolName}`;
}

function findImportInsertionLine(lines, ext) {
  if (ext !== '.py') {
    return 1;
  }
  const sourceLines = normalizeLines(lines);
  let insertionLine = 1;
  sourceLines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }
    if (/^(from\s+\S+\s+import\s+|import\s+)/.test(trimmed)) {
      insertionLine = index + 2;
    }
  });
  return Math.max(1, Math.min(insertionLine, sourceLines.length + 1));
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeLspAiAction(action, issue) {
  const raw = action && typeof action === 'object' ? action : {};
  const op = String(raw.op || '').trim() || 'replace_line';
  if (!LOCAL_EDIT_OPS.has(op)) {
    return null;
  }

  if (op === 'replace_range') {
    return raw.range && typeof raw.range === 'object'
      ? normalizeActionLocation({ op, range: raw.range }, raw)
      : null;
  }

  if (op === 'delete_line') {
    return normalizeActionLocation({ op }, raw);
  }

  if (['insert_after', 'insert_before', 'replace_line'].includes(op)) {
    return normalizeActionLocation({ op }, raw);
  }

  return normalizeActionLocation({ op: issue && issue.action && issue.action.op || 'replace_line' }, raw);
}

function normalizeActionLocation(action, raw = {}) {
  const normalized = { ...action };
  const line = Number(raw.line || raw.lnum || 0);
  if (Number.isFinite(line) && line > 0) {
    normalized.line = Math.floor(line);
  }
  if (typeof raw.indent === 'string') {
    normalized.indent = raw.indent;
  }
  if (typeof raw.text === 'string') {
    normalized.text = raw.text;
  }
  return normalized;
}

module.exports = {
  buildLspDiagnosticFixRequest,
  extractUndefinedSymbol,
  resolveLspDiagnosticFix,
};
