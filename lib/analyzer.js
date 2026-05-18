'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createBoundedEntryCache } = require('./lru-cache');
const { checkCommonDeveloperErrors } = require('./analyzer-developer-errors');
const {
  filterIssuesByFocusRange,
  intersectsFocusRange,
  isLightAnalysisMode,
  isLineInsideFocusRange,
  normalizeAnalysisMode,
  normalizeFocusedLineRange,
  shouldAnalyzeDocumentationIssues,
  shouldAnalyzeFlowComments,
  shouldRunLightAnalysisDeepPass,
} = require('./analyzer-options');
const { checkCommentTask, checkUnitTestCoverage, checkMissingDependencies, buildLeadingFunctionDocumentation, isJavaScriptLikeExtension, isPythonLikeExtension, isGoExtension, isRustExtension, isRubyExtension, resolveAutomaticIssuesWithAi } = require('./generation');
const {
  isStructuredTextKind: resolveStructuredTextKind,
  supportsSlashComments,
  supportsHashComments,
  isElixirExtension,
  commentPrefix,
} = require('./language-profiles');
const { defaultActionForKind } = require('./issue-kinds');
const { annotateIssuesWithConfidence } = require('./issue-confidence');
const { loadProjectMemory } = require('./project-memory');
const { isLanguageActive } = require('./language-capabilities');
const { snippetModuledoc, snippetLongLine, snippetDebugOutput, snippetTodoFixme, snippetFunctionDoc, snippetFunctionComment, snippetFunctionSpec, snippetFunctionalReassignment, snippetNestedCondition, snippetTrailingWhitespace, snippetTabs, snippetLargeFile, sanitizeAnalysisLine, sanitizeIdentifier, replaceIdentifierOnce, countBlockDelta, countMatches, isReservedToken, escapeRegExp, buildMaintenanceComment, isDependencyDeclarationLine, isCommentLine, removeInlineComment, lineIndentation, stripInlineComment, humanizeIdentifier } = require('./support');
const DEFAULT_MAX_LINE_LENGTH = 120;
const GLOBAL_MODULE_EXPORT_CACHE_MAX_ENTRIES = 512;
const GLOBAL_UNDEFINED_VARIABLE_CACHE_MAX_ENTRIES = 128;
const DEBUG_ANALYZE_STEPS = /^(?:1|true|yes|on)$/i.test(String(process.env.PINGU_DEBUG_ANALYZE_STEPS || ''));
const globalLocalModuleExportCache = createBoundedEntryCache(GLOBAL_MODULE_EXPORT_CACHE_MAX_ENTRIES);
const globalUndefinedVariableCache = createBoundedEntryCache(GLOBAL_UNDEFINED_VARIABLE_CACHE_MAX_ENTRIES);

function localModuleExportCacheKey(sourceFile, mtimeMs) {
  return `${String(sourceFile || '')}|${Number.isFinite(mtimeMs) ? mtimeMs : 0}`;
}

function readCachedLocalModuleExportNames(sourceFile) {
  try {
    const stats = fs.statSync(sourceFile);
    if (!stats.isFile()) {
      return null;
    }
    const cacheKey = localModuleExportCacheKey(sourceFile, stats.mtimeMs);
    if (!globalLocalModuleExportCache.has(cacheKey)) {
      return null;
    }
    return globalLocalModuleExportCache.get(cacheKey);
  } catch (_error) {
    return null;
  }
}

function storeCachedLocalModuleExportNames(sourceFile, exportNames) {
  try {
    const stats = fs.statSync(sourceFile);
    if (!stats.isFile()) {
      return exportNames;
    }
    const cacheKey = localModuleExportCacheKey(sourceFile, stats.mtimeMs);
    globalLocalModuleExportCache.set(cacheKey, exportNames);
    return exportNames;
  } catch (_error) {
    return exportNames;
  }
}

function undefinedVariableCacheKey(filePath, text, ext) {
  const normalizedText = String(text || '');
  if (!normalizedText) {
    return '';
  }

  return crypto.createHash('sha1')
    .update(String(filePath || ''))
    .update('\0')
    .update(String(ext || ''))
    .update('\0')
    .update(normalizedText)
    .digest('hex');
}

function readCachedUndefinedVariableIssues(cacheKey) {
  if (!cacheKey || !globalUndefinedVariableCache.has(cacheKey)) {
    return null;
  }

  return (globalUndefinedVariableCache.get(cacheKey) || []).map((issue) => ({ ...issue }));
}

function storeCachedUndefinedVariableIssues(cacheKey, issues) {
  if (!cacheKey) {
    return Array.isArray(issues) ? issues : [];
  }

  const clonedIssues = (Array.isArray(issues) ? issues : []).map((issue) => ({ ...issue }));
  globalUndefinedVariableCache.set(cacheKey, clonedIssues);
  return clonedIssues.map((issue) => ({ ...issue }));
}

function analyzeText(filePath, text, opts = {}) {
  const lines = text.split(/\r?\n/);
  const maxLineLength = Number.isFinite(opts.maxLineLength) ? opts.maxLineLength : DEFAULT_MAX_LINE_LENGTH;
  const analyzedFile = filePath || 'stdin';
  const analyzedKind = analysisFileKind(analyzedFile);
  const analysisMode = normalizeAnalysisMode(opts.analysisMode);
  const focusRange = normalizeFocusedLineRange(opts, lines.length);
  const documentationFocusRange = null;
  const localModuleCache = new Map();
  const cachedUndefinedVariableIssuesKey = undefinedVariableCacheKey(analyzedFile, text, path.extname(analyzedFile).toLowerCase());
  const issues = [];
  const activeLanguage = isLanguageActive(analyzedFile);
  const shouldAnalyzeDocumentation = shouldAnalyzeDocumentationIssues(lines);
  const skipStructuralGeneration = isLightAnalysisMode(analysisMode);
  const runLightAnalysisDeepPass = shouldRunLightAnalysisDeepPass(lines, analysisMode);
  const appendIssues = (label, producer) => {
    const beforeLength = issues.length;
    if (DEBUG_ANALYZE_STEPS) {
      process.stderr.write(`[PINGU_DEBUG] start ${label}\n`);
    }
    const produced = producer();
    if (Array.isArray(produced) && produced.length > 0) {
      issues.push(...produced);
    }
    if (DEBUG_ANALYZE_STEPS) {
      process.stderr.write(`[PINGU_DEBUG] done ${label} +${issues.length - beforeLength}\n`);
    }
  };

  if (isStructuredTextKind(analyzedKind)) {
    if (!activeLanguage) {
      appendIssues('structured_inactive_syntax', () => checkSyntaxIssues(lines, analyzedFile, analyzedKind));
      appendIssues('structured_inactive_trailing_whitespace', () => checkTrailingWhitespace(lines, analyzedFile));
      appendIssues('structured_inactive_tabs', () => checkTabs(lines, analyzedFile));
    } else {
      appendIssues('structured_active', () => checkStructuredTextIssues(lines, analyzedFile, analyzedKind, maxLineLength));
    }
  } else {
    if (!activeLanguage) {
      appendIssues('plain_inactive_syntax', () => checkSyntaxIssues(lines, analyzedFile, analyzedKind));
      appendIssues('plain_inactive_trailing_whitespace', () => checkTrailingWhitespace(lines, analyzedFile));
      appendIssues('plain_inactive_tabs', () => checkTabs(lines, analyzedFile));
    } else {
      appendIssues('moduledoc', () => checkModuledoc(lines, analyzedFile));
      appendIssues('long_lines', () => checkLongLines(lines, analyzedFile, maxLineLength));
      appendIssues('debug_outputs', () => checkDebugOutputs(lines, analyzedFile, { focusRange }));
      appendIssues('todo_fixme', () => checkTodoFixme(lines, analyzedFile, { focusRange }));
      appendIssues('comment_task', () => checkCommentTask(lines, analyzedFile, { focusRange }));
      appendIssues('syntax', () => checkSyntaxIssues(lines, analyzedFile, analyzedKind));
      appendIssues('developer_errors', () => checkCommonDeveloperErrors(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('duplicate_lines', () => checkDuplicateConsecutiveLines(lines, analyzedFile, { focusRange }));
      if (!skipStructuralGeneration) {
        appendIssues('unit_test', () => checkUnitTestCoverage(lines, analyzedFile));
        appendIssues('missing_dependencies', () => checkMissingDependencies(lines, analyzedFile));
      }
      appendIssues('undefined_variables', () => checkUndefinedVariables(lines, analyzedFile, {
        localModuleCache,
        focusRange,
        analysisMode,
        undefinedVariableCacheKey: cachedUndefinedVariableIssuesKey,
      }));
      appendIssues('functional_reassignment', () => checkFunctionalReassignment(lines, analyzedFile));
      appendIssues('trailing_whitespace', () => checkTrailingWhitespace(lines, analyzedFile));
      appendIssues('tabs', () => checkTabs(lines, analyzedFile));
      if (shouldAnalyzeDocumentation) {
        appendIssues('function_docs', () => checkFunctionDocs(lines, analyzedFile, { focusRange: documentationFocusRange }));
        appendIssues('cross_language_function_docs', () => checkCrossLanguageFunctionDocs(lines, analyzedFile, { focusRange: documentationFocusRange }));
        appendIssues('class_docs', () => checkClassDocs(lines, analyzedFile, { focusRange: documentationFocusRange }));
        appendIssues('function_comment', () => checkFunctionMaintenanceComments(lines, analyzedFile, { focusRange: documentationFocusRange }));
      }
      if (shouldAnalyzeDocumentation && runLightAnalysisDeepPass) {
        appendIssues('variable_docs', () => checkVariableDocs(lines, analyzedFile, { focusRange: documentationFocusRange }));
        appendIssues('flow_comments', () => checkFlowMaintenanceComments(lines, analyzedFile, { focusRange: documentationFocusRange }));
      }
      if (runLightAnalysisDeepPass) {
        appendIssues('function_specs', () => checkFunctionSpecs(lines, analyzedFile, { focusRange }));
        appendIssues('nested_condition_depth', () => checkNestedConditionDepth(lines, analyzedFile));
      }
      appendIssues('large_file', () => checkLargeFile(lines, analyzedFile));
    }
  }

  if (DEBUG_ANALYZE_STEPS) {
    process.stderr.write('[PINGU_DEBUG] start resolve_ai\n');
  }
  const aiResolvedIssues = activeLanguage
    ? resolveAutomaticIssuesWithAi(lines, analyzedFile, issues, {
      allowAiCalls: true,
    })
    : issues;
  if (DEBUG_ANALYZE_STEPS) {
    process.stderr.write(`[PINGU_DEBUG] done resolve_ai ${Array.isArray(aiResolvedIssues) ? aiResolvedIssues.length : 0}\n`);
    process.stderr.write('[PINGU_DEBUG] start confidence\n');
  }

  const sortedIssues = annotateIssuesWithConfidence(aiResolvedIssues)
    .map((issue) => ({
      ...issue,
      action: issue.action && typeof issue.action === 'object'
        ? issue.action
        : normalizeAction(issue.kind, issue),
    }))
    .sort((a, b) => {
      const severityDiff = severityRank(b.severity) - severityRank(a.severity);
      if (severityDiff !== 0) {
        return severityDiff;
      }
      const priorityDiff = Number(a && a.autofixPriority || 999) - Number(b && b.autofixPriority || 999);
      if (priorityDiff !== 0) {
        return priorityDiff;
      }
      return Number(a && a.line || 1) - Number(b && b.line || 1);
    });
  if (DEBUG_ANALYZE_STEPS) {
    process.stderr.write(`[PINGU_DEBUG] done confidence ${sortedIssues.length}\n`);
  }

  const dedup = [];
  const seen = new Set();
  for (const issue of sortedIssues) {
    const issueKey = buildIssueDedupKey(issue);
    if (seen.has(issueKey)) {
      continue;
    }
    seen.add(issueKey);
    dedup.push(issue);
  }

  return dedup;
}
function normalizeAction(kind, issue) {
  const action = defaultActionForKind(kind);
  if (action && action.op) {
    return action;
  }
  if (issue && issue.snippet && issue.snippet.split('\n').length > 1) {
    return { op: 'insert_before' };
  }
  return { op: 'insert_before' };
}
function normalizeIssueSnippetForDedup(snippet) {
  return String(snippet || '')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join('\n');
}
function buildIssueDedupKey(issue) {
  const action = issue && issue.action && typeof issue.action === 'object'
    ? issue.action
    : normalizeAction(issue && issue.kind, issue);
  const op = String(action && action.op || '');
  const file = String(issue && issue.file || '');
  const line = Number(issue && issue.line || 0);
  const normalizedSnippet = normalizeIssueSnippetForDedup(issue && issue.snippet);

  if (['insert_before', 'insert_after', 'replace_line', 'replace_range', 'delete_line'].includes(op) && normalizedSnippet) {
    const range = action && action.range && typeof action.range === 'object'
      ? JSON.stringify(action.range)
      : '';
    return `${file}|${line}|${op}|${range}|${normalizedSnippet}`;
  }

  if (op === 'write_file') {
    return `${file}|${line}|${op}|${String(action && action.target_file || '')}|${normalizedSnippet}`;
  }

  if (op === 'run_command') {
    return `${file}|${line}|${op}|${String(action && action.command || '')}`;
  }

  return `${file}|${line}|${String(issue && issue.kind || '')}|${String(issue && issue.message || '')}`;
}
function severityRank(issue) {
  switch (issue.severity) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
    default:
      return 0;
  }
}
function checkModuledoc(lines, file) {
  const moduleLine = lines.findIndex((line) => /^\s*defmodule\s+/.test(line));
  if (moduleLine < 0) {
    return [];
  }
  const hasPublicFunction = lines.some((line) => /^\s*def\s+[a-z_][a-zA-Z0-9_?!]*\s*(?:\(|do\b)/.test(String(line || '')));
  if (!hasPublicFunction) {
    return [];
  }
  const hasDoc = lines.some((line) => /^\s*@moduledoc\b/.test(line));
  if (hasDoc) {
    return [];
  }
  return [
    {
      file,
      line: moduleLine + 1,
      severity: 'warning',
      kind: 'moduledoc',
      message: 'Modulo sem @moduledoc',
      suggestion: 'Acrescente @moduledoc para explicar o contrato do modulo e facilitar manutencao.',
      snippet: snippetModuledoc(),
      action: { op: 'insert_after' },
    },
  ];
}
function checkLongLines(lines, file, maxLineLength) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.length > maxLineLength) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'long_line',
        message: `Linha com ${line.length} caracteres (limite ${maxLineLength})`,
        suggestion: 'Quebre a linha em passos menores para melhorar leitura e review.',
        snippet: snippetLongLine(line),
      });
    }
  });
  return issues;
}
function checkDebugOutputs(lines, file, opts = {}) {
  const issues = [];
  const ext = path.extname(file).toLowerCase();
  const focusRange = opts.focusRange || null;
  let pattern = /\b(?:IO\.puts|IO\.inspect|dbg)\b/;
  if (isJavaScriptLikeExtension(ext)) {
    pattern = /\b(?:console\.(?:log|debug|info|warn|error)|dbg)\s*\(/;
  } else if (isPythonLikeExtension(ext)) {
    pattern = /\b(?:print|pdb\.set_trace)\s*\(/;
  }
  lines.forEach((line, idx) => {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'error',
        kind: 'debug_output',
        message: 'Saida de debug detectada',
        suggestion: isJavaScriptLikeExtension(ext)
          ? 'Remova logs de debug e mantenha apenas o retorno previsto pelo contrato da funcao.'
          : isPythonLikeExtension(ext)
            ? 'Remova prints de debug e mantenha o retorno previsto pelo contrato da funcao.'
          : 'Substitua por Logger.debug/1 para rastreamento controlado em producao.',
        snippet: snippetDebugOutput(line),
      });
    }
  });
  return issues;
}
function checkTodoFixme(lines, file, opts = {}) {
  const issues = [];
  const pattern = /\b(TODO|FIXME)\b/i;
  const focusRange = opts.focusRange || null;
  lines.forEach((line, idx) => {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'todo_fixme',
        message: 'Marcador TODO/FIXME encontrado',
        suggestion: 'Use um ticket ou comentario estruturado (p.ex. TODO(#id): ) para facilitar rastreamento.',
        snippet: snippetTodoFixme(line),
      });
    }
  });
  return issues;
}
function isDuplicateConsecutiveCodeLineCandidate(previousLine, currentLine, ext) {
  const previousRaw = String(previousLine || '');
  const currentRaw = String(currentLine || '');
  const previousTrimmed = previousRaw.trim();
  const currentTrimmed = currentRaw.trim();

  if (!previousTrimmed || !currentTrimmed) {
    return false;
  }
  if (previousTrimmed !== currentTrimmed) {
    return false;
  }
  if (lineIndentation(previousRaw) !== lineIndentation(currentRaw)) {
    return false;
  }
  if (isCommentLine(previousRaw, ext) || isCommentLine(currentRaw, ext)) {
    return false;
  }
  if (/^[\[\](){}]+[,;:]?$/.test(currentTrimmed)) {
    return false;
  }
  if (/^(?:end|else|elif|except|finally|catch|rescue|do)$/i.test(currentTrimmed)) {
    return false;
  }
  if (/[,:]$/.test(currentTrimmed)) {
    return false;
  }

  return currentTrimmed.length >= 6;
}
function checkDuplicateConsecutiveLines(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const focusRange = opts.focusRange || null;
  const issues = [];

  for (let idx = 1; idx < lines.length; idx += 1) {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      continue;
    }

    const previousLine = String(lines[idx - 1] || '');
    const currentLine = String(lines[idx] || '');
    if (!isDuplicateConsecutiveCodeLineCandidate(previousLine, currentLine, ext)) {
      continue;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'warning',
      kind: 'duplicate_line',
      message: 'Linha duplicada consecutiva detectada',
      suggestion: 'Remova a repeticao consecutiva para evitar efeito colateral e ruido no diff.',
      snippet: currentLine,
      metadata: {
        duplicateOfLine: idx,
      },
      action: { op: 'delete_line' },
    });
  }

  return issues;
}
function checkUndefinedVariables(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const focusRange = opts.focusRange || null;
  const cachedIssues = readCachedUndefinedVariableIssues(opts.undefinedVariableCacheKey || '');
  if (cachedIssues) {
    return filterIssuesByFocusRange(cachedIssues, focusRange);
  }

  const importIssues = checkLocalImportBindings(lines, file, ext, {
    ...opts,
    focusRange: null,
  });
  let issues = importIssues;
  if (isElixirExtension(ext)) {
    issues = issues.concat(checkElixirUndefinedVariables(lines, file));
  } else if (isPythonLikeExtension(ext)) {
    issues = issues.concat(checkPythonUndefinedVariables(lines, file));
  } else if (supportsBraceScopedUndefinedVariableAnalysis(ext)) {
    issues = issues.concat(checkBraceScopedUndefinedVariables(lines, file, ext));
  }

  return filterIssuesByFocusRange(
    storeCachedUndefinedVariableIssues(opts.undefinedVariableCacheKey || '', issues),
    focusRange,
  );
}
function checkLocalImportBindings(lines, file, ext, opts = {}) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!supportsLocalImportBindingValidation(lowerExt)) {
    return [];
  }

  const cache = opts.localModuleCache instanceof Map ? opts.localModuleCache : new Map();
  const warned = new Set();
  const issues = [];

  lines.forEach((rawLine, idx) => {
    if (!isLineInsideFocusRange(opts.focusRange || null, idx + 1)) {
      return;
    }
    const importDescriptor = parseLocalImportBindings(rawLine, lowerExt);
    if (!importDescriptor || !importDescriptor.source) {
      return;
    }

    const exportNames = resolveLocalModuleExportNames(file, importDescriptor.source, lowerExt, cache);
    if (exportNames.length === 0) {
      return;
    }

    importDescriptor.bindings.forEach((binding) => {
      const importedName = String(binding && binding.importedName || '').trim();
      if (!importedName || exportNames.includes(importedName)) {
        return;
      }

      const suggestion = suggestSimilarIdentifier(importedName, exportNames);
      if (!suggestion || suggestion === importedName) {
        return;
      }

      const issueKey = `${idx + 1}|${importDescriptor.source}|${importedName}|${suggestion}`;
      if (warned.has(issueKey)) {
        return;
      }

      const replacementRange = resolveUndefinedVariableReplacementRange(rawLine, importedName, idx + 1);
      const snippet = buildUndefinedVariableCorrectionSnippet(rawLine, importedName, suggestion, lowerExt);
      if (!replacementRange || snippet === String(rawLine || '')) {
        return;
      }

      issues.push({
        file,
        line: idx + 1,
        col: replacementRange.start.character + 1,
        severity: 'error',
        kind: 'undefined_variable',
        message: `Import '${importedName}' nao exportado por '${importDescriptor.source}'`,
        suggestion: `Substitua por '${suggestion}' para alinhar com a origem importada.`,
        snippet,
        action: buildUndefinedVariableCorrectionAction(replacementRange, suggestion),
      });
      warned.add(issueKey);
    });
  });

  return issues;
}
function supportsLocalImportBindingValidation(ext) {
  return isJavaScriptLikeExtension(ext) || isPythonLikeExtension(ext);
}
function parseLocalImportBindings(line, ext) {
  if (isJavaScriptLikeExtension(ext)) {
    return parseJavaScriptLocalImportBindings(line);
  }
  if (isPythonLikeExtension(ext)) {
    return parsePythonLocalImportBindings(line);
  }
  return null;
}
function parseJavaScriptLocalImportBindings(line) {
  const descriptor = parseJavaScriptImportBindingsSource(line);
  if (!descriptor || !isRelativeModuleSpecifier(descriptor.source)) {
    return null;
  }
  return descriptor;
}
function parseJavaScriptImportBindingsSource(line) {
  const sourceLine = String(line || '').replace(/\s+/g, ' ').trim();
  const namedImportMatch = sourceLine.match(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
  if (namedImportMatch && namedImportMatch[2]) {
    return {
      source: namedImportMatch[2],
      bindings: parseJavaScriptImportBindingList(namedImportMatch[1], 'esm'),
    };
  }

  const requireMatch = sourceLine.match(/^(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (requireMatch && requireMatch[2]) {
    return {
      source: requireMatch[2],
      bindings: parseJavaScriptImportBindingList(requireMatch[1], 'require'),
    };
  }

  return null;
}
function isPotentialJavaScriptImportStatementStart(line) {
  const content = String(line || '').trim();
  if (!content) {
    return false;
  }
  if (/^import\s*\{/.test(content)) {
    return true;
  }
  return /^(?:const|let|var)\s*\{/.test(content)
    && (!/=/.test(content) || /\brequire\s*\(/.test(content));
}
function readJavaScriptImportStatement(lines, startIdx) {
  const firstLine = String(stripInlineComment(String(lines[startIdx] || ''), '.js') || '');
  const directDescriptor = parseJavaScriptImportBindingsSource(firstLine);
  if (directDescriptor) {
    return {
      ...directDescriptor,
      endIdx: startIdx,
    };
  }
  if (!isPotentialJavaScriptImportStatementStart(firstLine)) {
    return null;
  }

  const statementLines = [firstLine];
  let endIdx = startIdx;

  while (endIdx + 1 < lines.length && endIdx - startIdx < 12) {
    endIdx += 1;
    const currentLine = String(stripInlineComment(String(lines[endIdx] || ''), '.js') || '');
    const trimmedLine = currentLine.trim();
    if (!trimmedLine) {
      return null;
    }
    statementLines.push(currentLine);
    const descriptor = parseJavaScriptImportBindingsSource(statementLines.join(' '));
    if (descriptor) {
      return {
        ...descriptor,
        endIdx,
      };
    }
    if (/;\s*$/.test(trimmedLine)) {
      break;
    }
  }

  return null;
}
function parseJavaScriptImportBindingList(raw, kind) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => parseJavaScriptImportBindingToken(token, kind))
    .filter((binding) => binding && binding.importedName);
}
function parseJavaScriptImportBindingToken(token, kind) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return null;
  }

  const match = kind === 'esm'
    ? normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/)
    : normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    importedName: match[1],
    localName: match[2] || match[1],
  };
}
function parsePythonLocalImportBindings(line) {
  const sourceLine = String(line || '').trim();
  const fromImportMatch = sourceLine.match(/^from\s+(\.+[A-Za-z0-9_\.]*)\s+import\s+(.+)$/);
  if (!fromImportMatch || !fromImportMatch[1] || !fromImportMatch[2]) {
    return null;
  }

  return {
    source: fromImportMatch[1],
    bindings: splitTopLevelParams(fromImportMatch[2])
      .map((token) => parsePythonImportBindingToken(token))
      .filter((binding) => binding && binding.importedName),
  };
}
function parsePythonImportBindingToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized || normalized === '*') {
    return null;
  }

  const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    importedName: match[1],
    localName: match[2] || match[1],
  };
}
function isRelativeModuleSpecifier(source) {
  return String(source || '').trim().startsWith('.');
}
function resolveLocalModuleExportNames(file, importSource, ext, cache) {
  const sourceFile = resolveLocalModuleFile(file, importSource, ext, cache);
  if (!sourceFile) {
    return [];
  }

  const exportCacheKey = `exports:${sourceFile}`;
  if (cache.has(exportCacheKey)) {
    return cache.get(exportCacheKey);
  }

  const globallyCachedExportNames = readCachedLocalModuleExportNames(sourceFile);
  if (globallyCachedExportNames) {
    cache.set(exportCacheKey, globallyCachedExportNames);
    return globallyCachedExportNames;
  }

  let exportNames = [];
  try {
    const sourceText = fs.readFileSync(sourceFile, 'utf8');
    exportNames = collectLocalModuleExportNames(sourceFile, sourceText);
  } catch (_error) {
    exportNames = [];
  }

  const normalizedExportNames = Array.from(new Set(exportNames
    .map((name) => String(name || '').trim())
    .filter(Boolean)));
  const cachedExportNames = storeCachedLocalModuleExportNames(sourceFile, normalizedExportNames);
  cache.set(exportCacheKey, cachedExportNames);
  return cachedExportNames;
}
function resolveLocalModuleFile(file, importSource, ext, cache) {
  const cacheKey = `resolve:${file}:${ext}:${importSource}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const resolvedFile = isPythonLikeExtension(ext)
    ? resolvePythonLocalModuleFile(file, importSource)
    : resolveJavaScriptLocalModuleFile(file, importSource);
  cache.set(cacheKey, resolvedFile);
  return resolvedFile;
}
function resolveJavaScriptLocalModuleFile(file, importSource) {
  if (!isRelativeModuleSpecifier(importSource)) {
    return '';
  }

  const importerDir = path.dirname(path.resolve(String(file || '')));
  const targetBase = path.resolve(importerDir, String(importSource || '').trim());
  const explicitExtension = path.extname(targetBase).toLowerCase();
  const defaultExtensions = uniqueValues([
    path.extname(String(file || '')).toLowerCase(),
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
  ]);
  const candidates = explicitExtension
    ? [targetBase]
    : uniqueValues([
      targetBase,
      ...defaultExtensions.map((extension) => `${targetBase}${extension}`),
      ...defaultExtensions.map((extension) => path.join(targetBase, `index${extension}`)),
    ]);

  return firstExistingFile(candidates);
}
function resolvePythonLocalModuleFile(file, importSource) {
  const normalizedSource = String(importSource || '').trim();
  const match = normalizedSource.match(/^(\.+)(.*)$/);
  if (!match || !match[1]) {
    return '';
  }

  let importerDir = path.dirname(path.resolve(String(file || '')));
  for (let level = 1; level < match[1].length; level += 1) {
    importerDir = path.dirname(importerDir);
  }

  const moduleSuffix = String(match[2] || '').replace(/^\./, '');
  const targetBase = moduleSuffix
    ? path.join(importerDir, ...moduleSuffix.split('.').filter(Boolean))
    : importerDir;
  const explicitExtension = path.extname(targetBase).toLowerCase();
  const candidates = explicitExtension === '.py'
    ? [targetBase]
    : uniqueValues([
      path.join(targetBase, '__init__.py'),
      `${targetBase}.py`,
    ]);

  return firstExistingFile(candidates);
}
function firstExistingFile(candidates) {
  for (const candidate of uniqueValues(candidates)) {
    if (!candidate) {
      continue;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_error) {
      continue;
    }
  }
  return '';
}
function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}
function collectLocalModuleExportNames(filePath, sourceText) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (isJavaScriptLikeExtension(ext)) {
    return collectJavaScriptExportNames(sourceText);
  }
  if (isPythonLikeExtension(ext)) {
    return collectPythonExportNames(sourceText);
  }
  return [];
}
function collectJavaScriptExportNames(sourceText) {
  const names = new Set();
  const source = String(sourceText || '');
  const lines = source.split(/\r?\n/);

  lines.forEach((rawLine) => {
    const line = String(stripInlineComment(rawLine, '.js') || '');
    const functionMatch = line.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (functionMatch && functionMatch[1]) {
      names.add(functionMatch[1]);
    }

    const classMatch = line.match(/^\s*export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (classMatch && classMatch[1]) {
      names.add(classMatch[1]);
    }

    const valueMatch = line.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (valueMatch && valueMatch[1]) {
      names.add(valueMatch[1]);
    }

    const memberExportMatch = line.match(/^\s*(?:module\.)?exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (memberExportMatch && memberExportMatch[1]) {
      names.add(memberExportMatch[1]);
    }
  });

  [...source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*['"][^'"]+['"])?/g)].forEach((match) => {
    parseJavaScriptNamedExportList(match[1]).forEach((name) => names.add(name));
  });
  [...source.matchAll(/\bmodule\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/g)].forEach((match) => {
    parseCommonJsObjectExportList(match[1]).forEach((name) => names.add(name));
  });

  return Array.from(names);
}
function parseJavaScriptNamedExportList(raw) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => {
      const normalized = String(token || '').trim();
      const match = normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
      if (!match || !match[1]) {
        return '';
      }
      return match[2] || match[1];
    })
    .filter(Boolean);
}
function parseCommonJsObjectExportList(raw) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => extractCommonJsObjectExportName(token))
    .filter(Boolean);
}
function extractCommonJsObjectExportName(token) {
  const normalized = String(token || '').trim().replace(/,$/, '');
  if (!normalized || normalized.startsWith('...')) {
    return '';
  }

  const keyToken = normalized.includes(':')
    ? normalized.split(':')[0].trim()
    : normalized;
  const quotedMatch = keyToken.match(/^['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]$/);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  const bracketMatch = keyToken.match(/^\[\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\s*\]$/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1];
  }

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyToken) ? keyToken : '';
}
function collectPythonExportNames(sourceText) {
  const names = new Set();

  String(sourceText || '')
    .split(/\r?\n/)
    .forEach((rawLine) => {
      const line = stripPythonInlineSyntax(rawLine);
      if (!String(line || '').trim() || leadingIndentLength(rawLine) > 0) {
        return;
      }

      const functionMatch = String(line || '').match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
      if (functionMatch && functionMatch[1]) {
        names.add(functionMatch[1]);
      }

      const classMatch = String(line || '').match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (classMatch && classMatch[1]) {
        names.add(classMatch[1]);
      }

      const assignmentMatch = String(line || '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>~])/);
      if (assignmentMatch && assignmentMatch[1]) {
        names.add(assignmentMatch[1]);
      }

      extractPythonImportVars(line).forEach((name) => names.add(name));
    });

  return Array.from(names);
}
function checkElixirUndefinedVariables(lines, file) {
  const state = {
    inFunction: false,
    depth: 0,
    vars: new Set(),
    allVars: new Set(),
    warned: new Set(),
  };
  const issues = [];

  lines.forEach((rawLine, idx) => {
    const line = sanitizeAnalysisLine(rawLine);
    if (!line) {
      return;
    }

    if (state.inFunction) {
      checkUndefinedLineInScope(rawLine, line, idx + 1, state, file, issues, lines);
    } else {
      const declaration = readElixirFunctionDeclaration(lines, idx);
      if (!declaration || declaration.visibility !== 'def' && declaration.visibility !== 'defp') {
        return;
      }
      const params = declaration.scopeParams || declaration.params;
      const depth = countBlockDelta(declaration.headerText || line);
      if (depth <= 0) {
        return;
      }
      state.inFunction = true;
      state.depth = depth;
      state.vars = new Set(params);
      state.allVars = collectFunctionAllVariables(lines, idx, params);
      state.warned = new Set();
    }
  });

  return issues;
}
function checkPythonUndefinedVariables(lines, file) {
  const issues = [];
  const syntaxIssueLines = new Set(
    checkSyntaxIssues(lines, file, '.py')
      .map((issue) => Number(issue && issue.line || 0))
      .filter((lineNumber) => lineNumber > 0),
  );
  const moduleState = {
    multilineQuote: '',
    vars: new Set(),
    allVars: collectPythonModuleAllVariables(lines),
    warned: new Set(),
  };
  const state = {
    inFunction: false,
    baseIndent: 0,
    multilineQuote: '',
    vars: new Set(),
    allVars: new Set(),
    warned: new Set(),
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = String(lines[idx] || '');

    if (state.inFunction) {
      if (pythonFunctionScopeEnded(rawLine, state.baseIndent)) {
        state.inFunction = false;
        state.baseIndent = 0;
        state.multilineQuote = '';
        state.vars = new Set();
        state.allVars = new Set();
        state.warned = new Set();
        idx -= 1;
        continue;
      }

      const strippedLine = stripPythonMultilineStringContent(rawLine, state.multilineQuote);
      state.multilineQuote = strippedLine.multilineQuote;
      const line = sanitizeScopedAnalysisLine(strippedLine.line, '.py');
      if (!line) {
        continue;
      }
      const importStatement = readPythonImportStatement(lines, idx);
      if (importStatement) {
        importStatement.importedNames.forEach((name) => {
          state.vars.add(name);
          state.allVars.add(name);
        });
        idx = importStatement.endIdx;
        continue;
      }
      if (syntaxIssueLines.has(idx + 1)) {
        continue;
      }
      checkUndefinedLineInPythonScope(rawLine, line, idx + 1, state, file, issues, lines);
      continue;
    }

    const declaration = readPythonFunctionDeclaration(lines, idx);
    if (declaration) {
      const params = (declaration.params || []).filter((param) => param !== 'self');
      moduleState.vars.add(declaration.name);
      moduleState.allVars.add(declaration.name);
      state.inFunction = true;
      state.baseIndent = declaration.baseIndent;
      state.vars = new Set(params);
      state.allVars = new Set([
        ...moduleState.allVars,
        ...collectPythonFunctionAllVariables(lines, idx, params, declaration.baseIndent, declaration.endIdx),
      ]);
      state.warned = new Set();
      idx = declaration.endIdx;
      continue;
    }

    const className = parsePythonClassDeclaration(rawLine);
    if (className) {
      moduleState.vars.add(className);
      moduleState.allVars.add(className);
      continue;
    }

    const strippedModuleLine = stripPythonMultilineStringContent(rawLine, moduleState.multilineQuote);
    moduleState.multilineQuote = strippedModuleLine.multilineQuote;
    const moduleLine = sanitizeScopedAnalysisLine(strippedModuleLine.line, '.py');
    if (!moduleLine) {
      continue;
    }
    const importStatement = readPythonImportStatement(lines, idx);
    if (importStatement) {
      importStatement.importedNames.forEach((name) => {
        moduleState.vars.add(name);
        moduleState.allVars.add(name);
      });
      idx = importStatement.endIdx;
      continue;
    }

    const importedNames = extractPythonImportVars(moduleLine);
    if (importedNames.length > 0) {
      importedNames.forEach((name) => {
        moduleState.vars.add(name);
        moduleState.allVars.add(name);
      });
      continue;
    }

    if (syntaxIssueLines.has(idx + 1)) {
      continue;
    }
    checkUndefinedLineInPythonScope(rawLine, moduleLine, idx + 1, moduleState, file, issues, lines);
  }

  return issues;
}
function readPythonFunctionDeclaration(lines, startIdx) {
  const firstLine = String(lines[startIdx] || '');
  if (!/^\s*(?:async\s+)?def\b/.test(firstLine)) {
    return null;
  }

  const baseIndent = leadingIndentLength(firstLine);
  const decoratorInfo = collectPythonLeadingDecorators(lines, startIdx);
  const signatureLines = [firstLine];
  let endIdx = startIdx;
  let parenDepth = countPythonSignatureParenDelta(firstLine);
  let hasTrailingColon = pythonSignatureHasTrailingColon(firstLine) && parenDepth <= 0;

  while ((parenDepth > 0 || !hasTrailingColon) && endIdx + 1 < lines.length) {
    endIdx += 1;
    const currentLine = String(lines[endIdx] || '');
    signatureLines.push(currentLine);
    parenDepth += countPythonSignatureParenDelta(currentLine);
    if (parenDepth <= 0 && pythonSignatureHasTrailingColon(currentLine)) {
      hasTrailingColon = true;
    }
  }

  const parsed = parsePythonFunctionDeclarationSource(signatureLines.join(' '));
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    baseIndent,
    decorators: decoratorInfo.decorators,
    decoratorStartIdx: decoratorInfo.decoratorStartIdx,
    endIdx,
  };
}
function parsePythonFunctionDeclarationSource(source) {
  const normalized = String(source || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(?:async\s+)?def\s+([a-z_][a-zA-Z0-9_]*)\s*\((.*)\)\s*(?:->\s*([^:]+))?\s*:/);
  if (!match || !match[1]) {
    return null;
  }

  const paramDescriptors = parseGenericParamDescriptors(match[2] || '', '.py');
  return {
    name: sanitizeIdentifier(match[1]),
    params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
    paramDescriptors,
    returnAnnotation: String(match[3] || '').trim(),
  };
}
function pythonSignatureHasTrailingColon(line) {
  return /:\s*$/.test(stripPythonInlineSyntax(line).trim());
}
function countPythonSignatureParenDelta(line) {
  const stripped = stripPythonInlineSyntax(line);
  return countMatches(/\(/g, stripped) - countMatches(/\)/g, stripped);
}
function countPythonImportParenDelta(line) {
  const stripped = stripPythonInlineSyntax(line);
  return countMatches(/\(/g, stripped) - countMatches(/\)/g, stripped);
}
function pythonLineHasTrailingContinuation(line) {
  return /\\\s*$/.test(String(line || '').trimEnd());
}
function parsePythonDecoratorName(line) {
  const match = String(line || '').trim().match(/^@([A-Za-z_][A-Za-z0-9_\.]*)/);
  if (!match || !match[1]) {
    return '';
  }
  const segments = String(match[1] || '').split('.');
  return sanitizeIdentifier(segments[segments.length - 1] || '');
}
function collectPythonLeadingDecorators(lines, startIdx) {
  const baseIndent = leadingIndentLength(lines[startIdx] || '');
  const decorators = [];
  let decoratorStartIdx = startIdx;

  for (let idx = startIdx - 1; idx >= 0; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      break;
    }
    if (leadingIndentLength(rawLine) !== baseIndent || !/^@/.test(trimmed)) {
      break;
    }
    decorators.unshift(parsePythonDecoratorName(trimmed));
    decoratorStartIdx = idx;
  }

  return {
    decorators: decorators.filter(Boolean),
    decoratorStartIdx,
  };
}
function readPythonImportStatement(lines, startIdx) {
  const firstLine = stripPythonInlineSyntax(String(lines[startIdx] || ''));
  if (!/^\s*(?:from|import)\b/.test(firstLine)) {
    return null;
  }

  const statementLines = [firstLine];
  let endIdx = startIdx;
  let parenDepth = countPythonImportParenDelta(firstLine);
  let hasContinuation = pythonLineHasTrailingContinuation(firstLine);

  while ((parenDepth > 0 || hasContinuation) && endIdx + 1 < lines.length) {
    endIdx += 1;
    const currentLine = stripPythonInlineSyntax(String(lines[endIdx] || ''));
    statementLines.push(currentLine);
    parenDepth += countPythonImportParenDelta(currentLine);
    hasContinuation = pythonLineHasTrailingContinuation(currentLine);
  }

  return {
    source: statementLines.join(' '),
    importedNames: extractPythonImportVars(statementLines.join(' ')),
    endIdx,
  };
}
function leadingIndentLength(line) {
  return (String(line || '').match(/^\s*/) || [''])[0].length;
}
function pythonFunctionScopeEnded(rawLine, baseIndent) {
  const source = String(rawLine || '');
  const trimmed = source.trim();
  if (!trimmed || /^\s*#/.test(source)) {
    return false;
  }
  return leadingIndentLength(source) <= baseIndent;
}
function nextPythonTripleQuote(source, startIndex) {
  const singleQuoteIndex = source.indexOf("'''", startIndex);
  const doubleQuoteIndex = source.indexOf('"""', startIndex);

  if (singleQuoteIndex < 0 && doubleQuoteIndex < 0) {
    return null;
  }
  if (singleQuoteIndex < 0) {
    return { index: doubleQuoteIndex, quote: '"""' };
  }
  if (doubleQuoteIndex < 0) {
    return { index: singleQuoteIndex, quote: "'''" };
  }
  return singleQuoteIndex < doubleQuoteIndex
    ? { index: singleQuoteIndex, quote: "'''" }
    : { index: doubleQuoteIndex, quote: '"""' };
}
function stripPythonMultilineStringContent(rawLine, currentQuote = '') {
  const source = String(rawLine || '');
  let cursor = 0;
  let multilineQuote = String(currentQuote || '');
  let result = '';

  while (cursor < source.length) {
    if (multilineQuote) {
      const closingIndex = source.indexOf(multilineQuote, cursor);
      if (closingIndex < 0) {
        return { line: result, multilineQuote };
      }
      cursor = closingIndex + multilineQuote.length;
      multilineQuote = '';
      continue;
    }

    const nextQuote = nextPythonTripleQuote(source, cursor);
    if (!nextQuote) {
      result += source.slice(cursor);
      break;
    }

    result += source.slice(cursor, nextQuote.index);
    cursor = nextQuote.index + nextQuote.quote.length;
    multilineQuote = nextQuote.quote;
  }

  return { line: result, multilineQuote };
}
function collectPythonFunctionAllVariables(lines, startIdx, params, baseIndent, signatureEndIdx = startIdx) {
  const result = new Set((params || []).map((param) => sanitizeIdentifier(param)).filter(Boolean));
  let multilineQuote = '';

  for (let idx = Math.max(startIdx + 1, signatureEndIdx + 1); idx < lines.length; idx += 1) {
    const rawLine = String(lines[idx] || '');
    if (pythonFunctionScopeEnded(rawLine, baseIndent)) {
      break;
    }

    const nestedDeclaration = readPythonFunctionDeclaration(lines, idx);
    if (nestedDeclaration && nestedDeclaration.baseIndent > baseIndent) {
      result.add(nestedDeclaration.name);
      idx = nestedDeclaration.endIdx;
      continue;
    }

    const strippedLine = stripPythonMultilineStringContent(rawLine, multilineQuote);
    multilineQuote = strippedLine.multilineQuote;
    const line = sanitizeScopedAnalysisLine(strippedLine.line, '.py');
    if (!line) {
      continue;
    }
    const importStatement = readPythonImportStatement(lines, idx);
    if (importStatement) {
      importStatement.importedNames.forEach((name) => result.add(name));
      idx = importStatement.endIdx;
      continue;
    }

    extractPythonAssignmentVars(line).forEach((name) => {
      const normalized = sanitizeIdentifier(name);
      if (normalized) {
        result.add(normalized);
      }
    });
  }

  return result;
}
function collectPythonModuleAllVariables(lines) {
  const result = new Set();
  let multilineQuote = '';
  let skippedFunctionIndent = null;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = String(lines[idx] || '');
    if (skippedFunctionIndent !== null && pythonFunctionScopeEnded(rawLine, skippedFunctionIndent)) {
      skippedFunctionIndent = null;
    }
    if (skippedFunctionIndent !== null) {
      continue;
    }

    const declaration = readPythonFunctionDeclaration(lines, idx);
    if (declaration) {
      result.add(declaration.name);
      skippedFunctionIndent = declaration.baseIndent;
      idx = declaration.endIdx;
      continue;
    }

    const className = parsePythonClassDeclaration(rawLine);
    if (className) {
      result.add(className);
      continue;
    }

    const strippedLine = stripPythonMultilineStringContent(rawLine, multilineQuote);
    multilineQuote = strippedLine.multilineQuote;
    const line = sanitizeScopedAnalysisLine(strippedLine.line, '.py');
    if (!line) {
      continue;
    }
    const importStatement = readPythonImportStatement(lines, idx);
    if (importStatement) {
      importStatement.importedNames.forEach((name) => result.add(name));
      idx = importStatement.endIdx;
      continue;
    }

    extractPythonImportVars(line).forEach((name) => result.add(name));
    extractPythonAssignmentVars(line).forEach((name) => {
      const normalized = sanitizeIdentifier(name);
      if (normalized) {
        result.add(normalized);
      }
    });
  }

  return result;
}
function extractPythonAssignmentVars(line) {
  const source = String(line || '');
  const names = new Set();

  const assignmentMatch = source.match(/^\s*(.+?)\s*=\s*(?![=<>~])/);
  if (assignmentMatch && assignmentMatch[1]) {
    const leftSide = String(assignmentMatch[1] || '')
      .replace(/:\s*[^=]+$/, '')
      .trim();
    extractBoundPatternVars(leftSide).forEach((name) => names.add(name));
  }

  [...source.matchAll(/\b(?:async\s+)?for\s+(.+?)\s+in\b/g)].forEach((match) => {
    extractBoundPatternVars(match[1]).forEach((name) => names.add(name));
  });
  [...source.matchAll(/\bexcept\b[^:]*\bas\s+([a-z_][a-zA-Z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
  [...source.matchAll(/\bwith\b.+?\bas\s+([a-z_][a-zA-Z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));

  return Array.from(names);
}
function extractPythonImportVars(line) {
  const source = normalizePythonImportSource(line);
  if (!source) {
    return [];
  }

  const names = new Set();
  const directImport = source.match(/^import\s+(.+)$/);
  if (directImport && directImport[1]) {
    splitTopLevelParams(directImport[1]).forEach((token) => {
      const importToken = String(token || '').trim();
      if (!importToken) {
        return;
      }
      const aliasMatch = importToken.match(/\bas\s+([a-z_][a-zA-Z0-9_]*)$/);
      if (aliasMatch && aliasMatch[1]) {
        names.add(aliasMatch[1]);
        return;
      }
      const rootName = matchPythonIdentifier(importToken.split('.')[0] || '');
      if (rootName) {
        names.add(rootName);
      }
    });
    return Array.from(names);
  }

  const fromImport = source.match(/^from\s+[a-zA-Z0-9_\.]+\s+import\s+(.+)$/);
  if (!fromImport || !fromImport[1]) {
    return [];
  }

  splitTopLevelParams(fromImport[1]).forEach((token) => {
    const importToken = String(token || '').trim();
    if (!importToken || importToken === '*') {
      return;
    }
    const aliasMatch = importToken.match(/\bas\s+([a-z_][a-zA-Z0-9_]*)$/);
    if (aliasMatch && aliasMatch[1]) {
      names.add(aliasMatch[1]);
      return;
    }
    const normalized = matchPythonIdentifier(importToken);
    if (normalized) {
      names.add(normalized);
    }
  });

  return Array.from(names);
}
function normalizePythonImportSource(source) {
  const normalized = String(source || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }

  const directImport = normalized.match(/^(import)\s+(.+)$/);
  if (directImport && directImport[2]) {
    return `${directImport[1]} ${String(directImport[2] || '').trim().replace(/,\s*$/, '')}`;
  }

  const fromImport = normalized.match(/^(from\s+[a-zA-Z0-9_\.]+\s+import)\s+(.+)$/);
  if (!fromImport || !fromImport[2]) {
    return normalized;
  }

  const bindings = String(fromImport[2] || '')
    .trim()
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/, '')
    .replace(/,\s*$/, '');
  return `${fromImport[1]} ${bindings}`.trim();
}
function matchPythonIdentifier(value) {
  const match = String(value || '').trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
  return match && match[1] ? match[1] : '';
}
function parsePythonClassDeclaration(line) {
  const match = String(line || '').match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  return match && match[1] ? sanitizeIdentifier(match[1]) : '';
}
function checkUndefinedLineInPythonScope(rawLine, line, idx, state, file, issues, lines) {
  const importedNames = extractPythonImportVars(line);
  if (importedNames.length > 0) {
    const knownVars = new Set([...state.vars, ...importedNames]);
    state.vars = knownVars;
    knownVars.forEach((name) => state.allVars.add(name));
    return;
  }

  const assignments = extractPythonAssignmentVars(line);
  const assignmentSet = new Set(assignments);
  const candidates = new Set([...state.vars, ...state.allVars]);
  const unknowns = extractUnknownVariables(line, candidates, assignmentSet, '.py');

  unknowns.forEach((unknown) => {
    const key = `${idx}|${unknown}`;
    if (state.warned.has(key)) {
      return;
    }
    const suggestion = resolveUndefinedVariableSuggestion(lines, idx, unknown, Array.from(candidates));
    if (!suggestion) {
      return;
    }
    if (unsafeUndefinedVariableCorrection(rawLine, unknown, suggestion, '.py')) {
      return;
    }
    const replacementRange = resolveUndefinedVariableReplacementRange(rawLine, unknown, idx);
    issues.push({
      file,
      line: idx,
      col: replacementRange ? replacementRange.start.character + 1 : undefined,
      severity: 'error',
      kind: 'undefined_variable',
      message: `Variavel '${unknown}' nao declarada`,
      suggestion: `Substitua por '${suggestion}' para manter coerencia do escopo atual.`,
      snippet: buildUndefinedVariableCorrectionSnippet(rawLine, unknown, suggestion, '.py'),
      action: buildUndefinedVariableCorrectionAction(replacementRange, suggestion),
    });
    state.warned.add(key);
  });

  const knownVars = new Set([...state.vars, ...assignmentSet]);
  state.vars = knownVars;
  knownVars.forEach((name) => state.allVars.add(name));
}
function supportsBraceScopedUndefinedVariableAnalysis(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return isJavaScriptLikeExtension(lowerExt)
    || isGoExtension(lowerExt)
    || isRustExtension(lowerExt)
    || lowerExt === '.c';
}
function collectImportBindingLocalNames(bindings) {
  return (bindings || [])
    .map((binding) => sanitizeIdentifier(String(binding && (binding.localName || binding.importedName) || '')))
    .filter(Boolean);
}
function countCurlyBlockDeltaRange(lines, startIdx, endIdx) {
  let total = 0;
  for (let idx = startIdx; idx <= endIdx; idx += 1) {
    total += countCurlyBlockDelta(lines[idx]);
  }
  return total;
}
function checkBraceScopedUndefinedVariables(lines, file, ext) {
  const issues = [];
  let state = null;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = sanitizeScopedAnalysisLine(rawLine, ext);
    if (!line) {
      if (state) {
        state.depth += countCurlyBlockDelta(rawLine);
        if (state.depth <= 0) {
          state = null;
        }
      }
      continue;
    }

    if (!state) {
      const declaration = parseBraceScopedFunctionDeclaration(rawLine, ext);
      if (!declaration) {
        continue;
      }
      const depth = countCurlyBlockDelta(rawLine);
      if (depth <= 0) {
        continue;
      }
      state = {
        depth,
        vars: new Set(declaration.params),
        allVars: collectBraceScopeAllVariables(lines, idx, declaration.params, ext),
        warned: new Set(),
        ext,
      };
      continue;
    }

    const importStatement = isJavaScriptLikeExtension(state.ext)
      ? readJavaScriptImportStatement(lines, idx)
      : null;
    if (importStatement) {
      collectImportBindingLocalNames(importStatement.bindings).forEach((name) => {
        state.vars.add(name);
        state.allVars.add(name);
      });
      state.depth += countCurlyBlockDeltaRange(lines, idx, importStatement.endIdx);
      if (state.depth <= 0) {
        state = null;
      }
      idx = importStatement.endIdx;
      continue;
    }

    checkUndefinedLineInBraceScope(rawLine, line, idx + 1, state, file, issues, lines);
    if (state.depth <= 0) {
      state = null;
    }
  }

  return issues;
}
function sanitizeScopedAnalysisLine(line, ext) {
  if (isPythonLikeExtension(ext)) {
    return stripPythonInlineSyntax(String(line || '')).trim();
  }
  return stripInlineComment(String(line || ''), ext)
    .replace(/"(?:\\.|[^"\\])*"/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '')
    .trim();
}
function stripPythonInlineSyntax(line) {
  const source = String(line || '');
  let result = '';
  let cursor = 0;

  while (cursor < source.length) {
    const current = source[cursor];
    if (current === '#') {
      break;
    }

    const stringToken = matchPythonInlineString(source, cursor);
    if (stringToken) {
      cursor = stringToken.end;
      continue;
    }

    result += current;
    cursor += 1;
  }

  return result;
}
function matchPythonInlineString(source, startIndex) {
  const current = String(source || '');
  let cursor = Number(startIndex || 0);
  let prefixLength = 0;

  while (cursor + prefixLength < current.length && /[rRuUbBfF]/.test(current[cursor + prefixLength]) && prefixLength < 2) {
    prefixLength += 1;
  }

  const quoteIndex = cursor + prefixLength;
  const quote = current[quoteIndex];
  if (quote !== '"' && quote !== '\'') {
    return null;
  }

  if (prefixLength > 0) {
    const previousChar = cursor > 0 ? current[cursor - 1] : '';
    if (/[A-Za-z0-9_]/.test(previousChar)) {
      return null;
    }
  }

  const tripleQuote = current.slice(quoteIndex, quoteIndex + 3);
  const isTriple = tripleQuote === '"""' || tripleQuote === "'''";
  let index = quoteIndex + (isTriple ? 3 : 1);

  while (index < current.length) {
    if (!isTriple && current[index] === '\\') {
      index += 2;
      continue;
    }
    if (isTriple && current.slice(index, index + 3) === tripleQuote) {
      return { end: index + 3 };
    }
    if (!isTriple && current[index] === quote) {
      return { end: index + 1 };
    }
    index += 1;
  }

  return { end: current.length };
}
function countCurlyBlockDelta(line) {
  const sanitized = sanitizeScopedAnalysisLine(line, '.js');
  return countMatches(/\{/g, sanitized) - countMatches(/\}/g, sanitized);
}
function parseBraceScopedFunctionDeclaration(line, ext) {
  const source = String(line || '');
  const lowerExt = String(ext || '').toLowerCase();
  let match = null;

  if (isJavaScriptLikeExtension(lowerExt)) {
    match = source.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/);
    if (!match) {
      match = source.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>\s*\{/);
    }
    if (!match) {
      const classMethodMatch = source.match(/^\s*(?:async\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/);
      if (classMethodMatch && !isJavaScriptControlKeyword(classMethodMatch[1])) {
        match = classMethodMatch;
      }
    }
  } else if (isGoExtension(lowerExt)) {
    match = source.match(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:\([^)]*\)\s*)?(?:[A-Za-z_][A-Za-z0-9_\[\]\*\s]*\s*)?\{/);
  } else if (isRustExtension(lowerExt)) {
    match = source.match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*[^\\{]+)?\{/);
  } else if (lowerExt === '.c') {
    match = source.match(/^\s*(?:[A-Za-z_][A-Za-z0-9_\s\*]*?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{/);
  }

  if (!match || !match[1]) {
    return null;
  }

  return {
    name: sanitizeIdentifier(match[1]),
    params: parseBraceScopedParams(match[2] || '', lowerExt),
  };
}
function isJavaScriptControlKeyword(token) {
  return new Set(['if', 'for', 'while', 'switch', 'catch', 'with']).has(String(token || '').toLowerCase());
}
function isJavaScriptPseudoMethodName(token) {
  return new Set(['constructor']).has(String(token || '').toLowerCase());
}
function parseBraceScopedParams(rawParams, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const normalized = String(rawParams || '').trim();
  if (!normalized || normalized === 'void') {
    return [];
  }

  return normalized
    .split(',')
    .map((token) => String(token || '').trim())
    .filter(Boolean)
    .map((token) => {
      if (isGoExtension(lowerExt)) {
        return sanitizeIdentifier(token.split(/\s+/)[0] || '');
      }
      if (isRustExtension(lowerExt)) {
        return sanitizeIdentifier(token.split(':')[0] || '');
      }
      if (lowerExt === '.c') {
        const compact = token.replace(/\s+/g, ' ').trim();
        const match = compact.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?$/);
        return sanitizeIdentifier(match ? match[1] : compact);
      }
      return sanitizeIdentifier(token.replace(/=.*/, ''));
    })
    .filter(Boolean);
}
function collectBraceScopeAllVariables(lines, startIdx, params, ext) {
  const result = new Set((params || []).map((param) => sanitizeIdentifier(param)).filter(Boolean));
  let depth = 0;

  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = sanitizeScopedAnalysisLine(rawLine, ext);
    const delta = countCurlyBlockDelta(rawLine);

    if (idx === startIdx) {
      depth = delta;
      if (depth <= 0) {
        break;
      }
    } else {
      depth += delta;
    }

    if (line) {
      const importStatement = isJavaScriptLikeExtension(ext)
        ? readJavaScriptImportStatement(lines, idx)
        : null;
      if (importStatement) {
        collectImportBindingLocalNames(importStatement.bindings).forEach((name) => result.add(name));
        if (importStatement.endIdx > idx) {
          depth += countCurlyBlockDeltaRange(lines, idx + 1, importStatement.endIdx);
          idx = importStatement.endIdx;
        }
        if (depth <= 0) {
          break;
        }
        continue;
      }
      extractScopedAssignmentVars(line, ext).forEach((name) => {
        const normalized = sanitizeIdentifier(name);
        if (normalized) {
          result.add(normalized);
        }
      });
    }

    if (depth <= 0) {
      break;
    }
  }

  return result;
}
function extractScopedAssignmentVars(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const source = String(line || '');
  const names = new Set();

  if (isJavaScriptLikeExtension(lowerExt)) {
    [...source.matchAll(/\b(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>~])/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b(?:for|for\s+await)\s*\(\s*(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    const declarationMatch = source.match(/^\s*(?:const|let|var)\s+(.+?)\s*=\s*(?![=<>~])/);
    if (declarationMatch && declarationMatch[1]) {
      extractBoundPatternVars(declarationMatch[1]).forEach((name) => names.add(name));
    }
    [...source.matchAll(/\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:,\s*([A-Za-z_][A-Za-z0-9_]*)\s*)?\)\s*=>/g)].forEach((match) => {
      names.add(match[1]);
      if (match[2]) {
        names.add(match[2]);
      }
    });
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=>/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (isGoExtension(lowerExt)) {
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\bvar\s+([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (isRustExtension(lowerExt)) {
    [...source.matchAll(/\blet\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\b/g)].forEach((match) => names.add(match[1]));
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    return Array.from(names);
  }

  if (lowerExt === '.c') {
    [...source.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?![=<>:])/g)].forEach((match) => names.add(match[1]));
    const declarationMatch = source.match(/^\s*(?:const\s+)?(?:unsigned\s+|signed\s+|long\s+|short\s+|struct\s+\w+\s+|enum\s+\w+\s+|[A-Za-z_][A-Za-z0-9_]*\s+)+\**\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:=\s*.+)?;?$/);
    if (declarationMatch && declarationMatch[1]) {
      names.add(declarationMatch[1]);
    }
  }

  return Array.from(names);
}
function buildUndefinedVariableCorrectionSnippet(rawLine, unknown, suggestion, ext) {
  const sourceLine = String(rawLine || '');
  return replaceIdentifierOnce(sourceLine, unknown, suggestion);
}
function resolveUndefinedVariableReplacementRange(rawLine, unknown, lineNumber) {
  const sourceLine = String(rawLine || '');
  const normalizedUnknown = String(unknown || '').trim();
  if (!normalizedUnknown) {
    return null;
  }

  const escapedUnknown = normalizedUnknown.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`\\b${escapedUnknown}\\b`).exec(sourceLine);
  if (!match) {
    return null;
  }

  const lineIndex = Math.max(0, Number(lineNumber || 1) - 1);
  return {
    start: {
      line: lineIndex,
      character: match.index,
    },
    end: {
      line: lineIndex,
      character: match.index + normalizedUnknown.length,
    },
  };
}
function buildUndefinedVariableCorrectionAction(range, suggestion) {
  if (!range) {
    return { op: 'replace_line' };
  }

  return {
    op: 'replace_line',
    range,
    text: String(suggestion || ''),
  };
}
function normalizePinguHintText(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function resolvePinguCorrectionHint(lines, lineNumber, unknown) {
  if (!Array.isArray(lines) || !Number.isFinite(lineNumber)) {
    return '';
  }

  const normalizedUnknown = String(unknown || '').toLowerCase();
  const startIndex = Math.max(0, (lineNumber - 1) - 12);
  for (let cursor = lineNumber - 2; cursor >= startIndex; cursor -= 1) {
    const rawLine = String(lines[cursor] || '');
    if (!rawLine.trim()) {
      continue;
    }
    const normalizedLine = normalizePinguHintText(rawLine);
    if (!/pingu\s*-\s*correction\s*:/.test(normalizedLine)) {
      continue;
    }
    const patterns = [
      /\bvariavel\s+([a-z_][a-z0-9_]*)\s+para\s+([a-z_][a-z0-9_]*)/,
      /\buso\s+de\s+([a-z_][a-z0-9_]*)\s+para\s+([a-z_][a-z0-9_]*)/,
      /\bretorno\s+([a-z_][a-z0-9_]*)\s+para\s+([a-z_][a-z0-9_]*)/,
    ];
    for (const pattern of patterns) {
      const match = normalizedLine.match(pattern);
      if (!match) {
        continue;
      }
      if (match[1] === normalizedUnknown) {
        return match[2];
      }
    }
  }
  return '';
}
function resolveUndefinedVariableSuggestion(lines, lineNumber, unknown, candidates) {
  const hinted = resolvePinguCorrectionHint(lines, lineNumber, unknown);
  if (hinted) {
    return hinted;
  }
  return suggestSimilarIdentifier(unknown, candidates);
}
function checkUndefinedLineInBraceScope(rawLine, line, idx, state, file, issues, lines) {
  const assignments = extractScopedAssignmentVars(line, state.ext);
  const assignmentSet = new Set(assignments);
  const candidates = new Set([...state.vars, ...state.allVars]);
  const unknowns = extractUnknownVariables(line, candidates, assignmentSet, state.ext);

  unknowns.forEach((unknown) => {
    const key = `${idx}|${unknown}`;
    if (state.warned.has(key)) {
      return;
    }
    const suggestion = resolveUndefinedVariableSuggestion(lines, idx, unknown, Array.from(candidates));
    if (!suggestion) {
      return;
    }
    if (unsafeUndefinedVariableCorrection(rawLine, unknown, suggestion, state.ext)) {
      return;
    }
    const replacementRange = resolveUndefinedVariableReplacementRange(rawLine, unknown, idx);
    issues.push({
      file,
      line: idx,
      col: replacementRange ? replacementRange.start.character + 1 : undefined,
      severity: 'error',
      kind: 'undefined_variable',
      message: `Variavel '${unknown}' nao declarada`,
      suggestion: `Substitua por '${suggestion}' para manter coerencia do escopo atual.`,
      snippet: buildUndefinedVariableCorrectionSnippet(rawLine, unknown, suggestion, state.ext),
      action: buildUndefinedVariableCorrectionAction(replacementRange, suggestion),
    });
    state.warned.add(key);
  });

  const knownVars = new Set([...state.vars, ...assignmentSet]);
  knownVars.forEach((name) => {
    state.allVars.add(name);
  });
  state.vars = knownVars;
  state.depth += countCurlyBlockDelta(rawLine);
  if (state.depth <= 0) {
    state.depth = 0;
    state.vars = new Set();
    state.allVars = new Set();
    state.warned = new Set();
  }
}
function checkUndefinedLineInScope(rawLine, line, idx, state, file, issues, lines) {
  const assignments = extractAssignmentVars(line);
  const anonymousParams = extractAnonymousFunctionParams(line);
  const assignmentSet = new Set([...assignments, ...anonymousParams]);
  const candidates = new Set([...state.vars, ...state.allVars, ...anonymousParams]);
  const unknowns = extractUnknownVariables(line, candidates, assignmentSet, '.ex');

  unknowns.forEach((unknown) => {
    const key = `${idx}|${unknown}`;
    if (state.warned.has(key)) {
      return;
    }
    const suggestion = resolveUndefinedVariableSuggestion(lines, idx, unknown, Array.from(candidates));
    if (!suggestion) {
      return;
    }
    if (unsafeUndefinedVariableCorrection(rawLine, unknown, suggestion, '.ex')) {
      return;
    }
    const replacementRange = resolveUndefinedVariableReplacementRange(rawLine, unknown, idx);
    issues.push({
      file,
      line: idx,
      col: replacementRange ? replacementRange.start.character + 1 : undefined,
      severity: 'error',
      kind: 'undefined_variable',
      message: `Variavel '${unknown}' nao declarada`,
      suggestion: `Substitua por '${suggestion}' para manter coerencia do escopo atual.`,
      snippet: buildUndefinedVariableCorrectionSnippet(rawLine, unknown, suggestion, '.ex'),
      action: buildUndefinedVariableCorrectionAction(replacementRange, suggestion),
    });
    state.warned.add(key);
  });

  const knownVars = new Set([...state.vars, ...assignmentSet]);
  state.vars = knownVars;
  knownVars.forEach((name) => {
    state.allVars.add(name);
  });
  const delta = countBlockDelta(line);
  state.depth += delta;
  if (state.depth <= 0) {
    state.inFunction = false;
    state.depth = 0;
    state.vars = new Set();
    state.allVars = new Set();
    state.warned = new Set();
  }
}
function collectFunctionAllVariables(lines, startIdx, params = []) {
  const result = new Set();
  for (const param of params) {
    const normalized = sanitizeIdentifier(param);
    if (normalized) {
      result.add(normalized);
    }
  }

  let depth = 0;
  for (let idx = startIdx; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];
    const line = sanitizeAnalysisLine(rawLine);
    const delta = countBlockDelta(rawLine);

    if (idx === startIdx) {
      depth = delta;
      if (depth <= 0) {
        break;
      }
    } else {
      depth += delta;
    }

    if (line) {
      extractAssignmentVars(line).forEach((name) => {
        const normalized = sanitizeIdentifier(name);
        if (normalized) {
          result.add(normalized);
        }
      });
    }

    if (depth <= 0) {
      break;
    }
  }

  return result;
}
function normalizeElixirFunctionHeaderSource(source) {
  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingElixirGuardClause(source) {
  const normalized = String(source || '').trim();
  if (!normalized) {
    return '';
  }
  const match = normalized.match(/^(.*?)(?:\s+when\s+.+)$/i);
  return match ? String(match[1] || '').trim() : normalized;
}

function parseElixirFunctionDeclarationSource(source) {
  const normalized = normalizeElixirFunctionHeaderSource(source);
  const match = normalized.match(/^\s*(defp?)\s+([a-z_][a-zA-Z0-9_?!]*)(.*)$/i);
  if (!match) {
    return null;
  }

  let remainder = String(match[3] || '').trim();
  if (!remainder || !/(?:\bdo\b|,\s*do:\s*)/.test(remainder)) {
    return null;
  }

  remainder = remainder
    .replace(/,\s*do:\s*.*$/i, '')
    .replace(/\bdo\b.*$/i, '')
    .trim();

  let rawParams = '';
  if (remainder.startsWith('(')) {
    const closingIndex = remainder.lastIndexOf(')');
    if (closingIndex <= 0) {
      return null;
    }
    rawParams = remainder.slice(1, closingIndex).trim();
  } else {
    rawParams = stripTrailingElixirGuardClause(remainder);
  }

  return {
    visibility: match[1],
    name: sanitizeIdentifier(match[2]),
    params: parseFunctionParams(rawParams),
    scopeParams: parseFunctionScopeParams(rawParams),
    paramArity: splitTopLevelParams(rawParams).length,
  };
}

function readElixirFunctionDeclaration(lines, startIdx) {
  const firstLine = String(lines[startIdx] || '');
  if (!/^\s*defp?\b/.test(firstLine)) {
    return null;
  }

  const headerLines = [];
  const maxHeaderLines = Math.min(lines.length, startIdx + 12);
  for (let idx = startIdx; idx < maxHeaderLines; idx += 1) {
    const currentLine = String(lines[idx] || '');
    if (idx > startIdx && !currentLine.trim()) {
      break;
    }
    headerLines.push(currentLine);
    const parsed = parseElixirFunctionDeclarationSource(headerLines.join('\n'));
    if (parsed) {
      return {
        ...parsed,
        startIdx,
        endIdx: idx,
        headerText: normalizeElixirFunctionHeaderSource(headerLines.join('\n')),
      };
    }
  }

  const parsedSingleLine = parseElixirFunctionDeclarationSource(firstLine);
  if (!parsedSingleLine) {
    return null;
  }

  return {
    ...parsedSingleLine,
    startIdx,
    endIdx: startIdx,
    headerText: normalizeElixirFunctionHeaderSource(firstLine),
  };
}

function resolveElixirAnnotationRange(lines, declarationIdx, annotationName) {
  const targetAnnotation = String(annotationName || '').trim();
  const annotationPattern = new RegExp(`^\\s*${escapeRegExp(targetAnnotation)}\\b`);
  const maxLookback = 60;
  const declarationIndex = Number.isFinite(declarationIdx) ? declarationIdx : -1;

  for (let idx = declarationIndex - 1; idx >= 0 && idx >= declarationIndex - maxLookback; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }
    if (isFunctionDeclarationLine(rawLine)) {
      return null;
    }
    if (/^\s*#/.test(trimmed)) {
      continue;
    }

    if (annotationPattern.test(trimmed)) {
      return resolveElixirAnnotationRangeFromStart(lines, idx, targetAnnotation);
    }

    if (/^\s*@/i.test(trimmed)) {
      continue;
    }

    if (!/"""/.test(trimmed)) {
      return null;
    }

    for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
      const docLine = String(lines[cursor] || '');
      const docTrimmed = docLine.trim();
      if (!docTrimmed) {
        continue;
      }
      if (isFunctionDeclarationLine(docLine)) {
        return null;
      }
      if (/^\s*#/.test(docTrimmed)) {
        continue;
      }
      if (annotationPattern.test(docTrimmed)) {
        return resolveElixirAnnotationRangeFromStart(lines, cursor, targetAnnotation);
      }
      if (/^\s*@/.test(docTrimmed)) {
        break;
      }
    }
  }

  return null;
}

function resolveElixirAnnotationRangeFromStart(lines, startLine, annotationName) {
  const normalizedAnnotation = String(annotationName || '').trim();
  const safeStart = Math.max(0, Math.min(Number.isFinite(startLine) ? startLine : 0, lines.length - 1));

  if (!normalizedAnnotation) {
    return null;
  }

  const annotationLine = String(lines[safeStart] || '');
  if (!annotationLine.trim()) {
    return null;
  }

  if (normalizedAnnotation === '@doc') {
    const lineText = String(lines[safeStart] || '');
    if ((lineText.match(/"""/g) || []).length >= 2) {
      return { startLine: safeStart, endLine: safeStart };
    }
    if (lineText.includes('"""')) {
      for (let end = safeStart + 1; end < lines.length; end += 1) {
        if (String(lines[end] || '').includes('"""')) {
          return { startLine: safeStart, endLine: end };
        }
      }
    }
    return { startLine: safeStart, endLine: safeStart };
  }

  if (normalizedAnnotation === '@spec') {
    for (let end = safeStart; end < Math.min(lines.length, safeStart + 20); end += 1) {
      if (String(lines[end] || '').includes('::')) {
        return { startLine: safeStart, endLine: end };
      }
    }
    return { startLine: safeStart, endLine: safeStart };
  }

  return { startLine: safeStart, endLine: safeStart };
}

function buildElixirAnnotationRangeLines(lines, range) {
  if (!range || !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)) {
    return [];
  }

  const from = Math.max(0, range.startLine);
  const to = Math.min(lines.length - 1, range.endLine);
  if (to < from) {
    return [];
  }

  return lines.slice(from, to + 1);
}

function parseElixirFunctionDocArgumentNames(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  let inArgumentsSection = false;
  let hasArgumentsSection = false;
  let hasNoArgsPlaceholder = false;
  const argNames = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const trimmed = String(lines[idx] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/^##\s*(?:Argumentos|Parametros)\b/i.test(trimmed)) {
      inArgumentsSection = true;
      hasArgumentsSection = true;
      continue;
    }
    if (inArgumentsSection && /^##\s*/.test(trimmed)) {
      inArgumentsSection = false;
      continue;
    }
    if (!inArgumentsSection) {
      continue;
    }
    if (/^(?:[-*])\s*Nenhum argumento recebido\./i.test(trimmed)) {
      hasNoArgsPlaceholder = true;
      continue;
    }

    const argMatch = trimmed.match(/^(?:[-*])\s*`?([a-z_][a-zA-Z0-9_?!]*)`?\s*:/i);
    if (argMatch && argMatch[1]) {
      argNames.push(sanitizeIdentifier(argMatch[1]));
    }
  }

  return {
    argNames,
    hasArgumentsSection,
    hasNoArgsPlaceholder,
  };
}

function parseElixirFunctionDocDeclaredName(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  const summaryPattern = /\b(?:comportamento|tratamento|fluxo)\s+principal\s+de\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\b/i;
  const fallbackPattern = /\bfunc(?:ao|a[oã])\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\b/i;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = String(lines[idx] || '').trim();
    if (!line) {
      continue;
    }
    const summaryMatch = line.match(summaryPattern);
    if (summaryMatch && summaryMatch[1]) {
      return sanitizeIdentifier(summaryMatch[1]);
    }
    const fallbackMatch = line.match(fallbackPattern);
    if (fallbackMatch && fallbackMatch[1]) {
      return sanitizeIdentifier(fallbackMatch[1]);
    }
  }

  return '';
}

function parseElixirFunctionSpecSignatureFromRange(lines, range) {
  const annotationLines = buildElixirAnnotationRangeLines(lines, range);
  const signatureSource = annotationLines.join(' ').trim();
  if (!signatureSource) {
    return null;
  }

  const match = signatureSource.match(/^\s*@spec\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(([\s\S]*?)\)\s*::/i);
  if (!match) {
    return null;
  }

  return {
    name: sanitizeIdentifier(match[1]),
    paramArity: splitTopLevelParams(match[2]).length,
  };
}

function isElixirFunctionDocOutdated(docRange, declaration, lines = []) {
  if (!docRange) {
    return false;
  }
  const contextLines = Array.isArray(lines) ? lines : [];
  const docLines = buildElixirAnnotationRangeLines(contextLines, docRange);
  const parsedDoc = parseElixirFunctionDocArgumentNames(docLines);
  const declaredDocName = parseElixirFunctionDocDeclaredName(docLines);
  const expectedArgCount = Number.isInteger(declaration.paramArity)
    ? declaration.paramArity
    : declaration.params.length;
  if (declaredDocName && declaredDocName !== sanitizeIdentifier(declaration.name)) {
    return true;
  }

  if (expectedArgCount === 0) {
    return !(
      parsedDoc.hasArgumentsSection
      && parsedDoc.hasNoArgsPlaceholder
      && parsedDoc.argNames.length === 0
    );
  }

  if (!parsedDoc.hasArgumentsSection) {
    return true;
  }
  if (parsedDoc.argNames.length !== expectedArgCount) {
    return true;
  }

  return parsedDoc.argNames.some((argumentName, index) =>
    argumentName !== sanitizeIdentifier(declaration.params[index] || argumentName),
  );
}

function isElixirFunctionSpecOutdated(specRange, declaration, lines = []) {
  if (!specRange) {
    return false;
  }
  const contextLines = Array.isArray(lines) ? lines : [];
  const parsedSpec = parseElixirFunctionSpecSignatureFromRange(contextLines, specRange);
  if (!parsedSpec) {
    return false;
  }

  return parsedSpec.name !== declaration.name
    || parsedSpec.paramArity !== declaration.paramArity;
}

function resolveElixirFunctionSpecRangeForDeclaration(lines, declarationIdx, declaration) {
  const declarationName = sanitizeIdentifier(declaration && declaration.name || '');
  const declarationArity = Number.isInteger(declaration && declaration.paramArity)
    ? declaration.paramArity
    : Array.isArray(declaration && declaration.params) ? declaration.params.length : 0;

  if (!declarationName) {
    return null;
  }

  const specCandidates = [];
  const maxLookback = 80;
  for (let idx = declarationIdx - 1; idx >= 0 && idx >= declarationIdx - maxLookback; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (isFunctionDeclarationLine(rawLine)) {
      break;
    }
    if (/^\s*#/.test(rawLine)) {
      continue;
    }
    if (/^\s*@spec\b/.test(rawLine)) {
      const range = resolveElixirAnnotationRangeFromStart(lines, idx, '@spec');
      if (!range) {
        continue;
      }
      const parsed = parseElixirFunctionSpecSignatureFromRange(lines, range);
      specCandidates.push({
        range,
        parsed,
      });
      idx = Math.max(0, range.startLine - 1);
      continue;
    }
    if (/^\s*@/.test(rawLine) || /"""/.test(rawLine)) {
      continue;
    }
    break;
  }

  if (specCandidates.length === 0) {
    return null;
  }

  const exactMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && candidate.parsed.name === declarationName
    && Number(candidate.parsed.paramArity) === declarationArity);
  if (exactMatch) {
    return exactMatch.range;
  }

  const nameMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && candidate.parsed.name === declarationName);
  if (nameMatch) {
    return nameMatch.range;
  }

  const arityMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && Number(candidate.parsed.paramArity) === declarationArity);
  if (arityMatch) {
    return arityMatch.range;
  }

  if (specCandidates.length === 1) {
    return specCandidates[0].range;
  }

  return null;
}

function parseFunctionDeclaration(line) {
  return parseElixirFunctionDeclarationSource(line);
}
function parseFunctionParams(raw) {
  const tokens = splitTopLevelParams(raw);
  if (tokens.length === 0) {
    return [];
  }
  return tokens
    .map((token) => extractParamName(token))
    .filter((token) => token.length > 0);
}
function parseFunctionScopeParams(raw) {
  const names = new Set();
  splitTopLevelParams(raw).forEach((token) => {
    extractBoundPatternVars(token).forEach((name) => names.add(name));
  });
  return Array.from(names);
}
function extractFunctionParams(matchData) {
  const rawParams = matchData ? matchData[1] : null;
  if (!rawParams) {
    return [];
  }
  return splitTopLevelParams(rawParams)
    .map((token) => extractParamName(token))
    .filter((token) => token.length > 0);
}
function extractParamName(token) {
  const rawToken = String(token || '').trim();
  const match = rawToken.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)(?:\s*=.*)?\s*$/);
  if (match) {
    return match[1];
  }

  const rightMatch = rawToken.match(/=\s*([a-z_][a-zA-Z0-9_?!]*)\s*$/);
  if (rightMatch && rightMatch[1]) {
    return rightMatch[1];
  }

  const scopedMatches = extractBoundPatternVars(rawToken);
  if (scopedMatches.length > 0) {
    return scopedMatches[scopedMatches.length - 1];
  }

  return '';
}
function splitTopLevelParams(raw) {
  const source = String(raw || '').trim();
  if (!source) {
    return [];
  }

  const tokens = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;

  for (const char of source) {
    if (char === ',' && parenDepth === 0 && bracketDepth === 0 && braceDepth === 0 && angleDepth === 0) {
      const normalized = current.trim();
      if (normalized) {
        tokens.push(normalized);
      }
      current = '';
      continue;
    }

    current += char;
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === '[') {
      bracketDepth += 1;
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === '{') {
      braceDepth += 1;
    } else if (char === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === '<') {
      angleDepth += 1;
    } else if (char === '>') {
      angleDepth = Math.max(0, angleDepth - 1);
    }
  }

  const normalized = current.trim();
  if (normalized) {
    tokens.push(normalized);
  }
  return tokens;
}
function extractBoundPatternVars(pattern) {
  const source = String(pattern || '').trim();
  if (!source) {
    return [];
  }

  const names = new Set();
  [...source.matchAll(/\b([a-z_][a-zA-Z0-9_?!]*)\b/g)].forEach((match) => {
    const identifier = String(match[1] || '');
    if (!identifier || isReservedToken(identifier)) {
      return;
    }
    const nextChar = source[match.index + identifier.length] || '';
    const previousChar = match.index > 0 ? source[match.index - 1] : '';
    if (nextChar === ':' || previousChar === ':') {
      return;
    }
    names.add(identifier);
  });

  return Array.from(names);
}
function extractAssignmentVars(line) {
  const source = String(line || '');
  const names = new Set();

  const matches = [...source.matchAll(/\b([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(?![=<>~])/g)];
  matches.forEach((match) => {
    if (match[1]) {
      names.add(match[1]);
    }
  });

  const assignmentMatch = source.match(/^\s*(.+?)\s*=\s*(?![=<>~])/);
  if (assignmentMatch && assignmentMatch[1]) {
    extractBoundPatternVars(assignmentMatch[1]).forEach((name) => names.add(name));
  }

  return Array.from(names);
}
function extractAnonymousFunctionParams(line) {
  const match = String(line || '').match(/\bfn\s+(.+?)\s*->/);
  if (!match || !match[1]) {
    return [];
  }

  return match[1]
    .split(',')
    .map((token) => String(token || '').trim())
    .map((token) => {
      const paramMatch = token.match(/\b([a-z_][a-zA-Z0-9_?!]*)\b/);
      return paramMatch ? paramMatch[1] : '';
    })
    .filter(Boolean);
}
function extractUnknownVariables(line, vars, assignmentSet, ext) {
  const unknowns = [];
  for (const match of line.matchAll(/\b[a-z_][a-zA-Z0-9_?!]*\b/g)) {
    const token = match[0];
    if (tokenShouldIgnore(token, match.index, line, vars, assignmentSet, ext)) {
      continue;
    }
    if (!unknowns.includes(token)) {
      unknowns.push(token);
    }
  }
  return unknowns;
}
function unsafeUndefinedVariableCorrection(line, unknown, suggestion, ext = '') {
  const sourceLine = String(line || '');
  if (!sourceLine.trim()) {
    return true;
  }

  if (
    isDependencyImportStatement(sourceLine, ext)
    ||
    /^\s*@/.test(sourceLine)
    || /^\s*defp?\b/.test(sourceLine)
    || /^\s*class\b/.test(sourceLine)
    || /^\s*defmodule\b/.test(sourceLine)
    || /\bfn\b/.test(sourceLine)
    || /->/.test(sourceLine)
  ) {
    return true;
  }

  const updatedLine = replaceIdentifierOnce(sourceLine, unknown, suggestion);
  if (updatedLine === sourceLine) {
    return true;
  }

  return changesStructuralTokens(sourceLine, updatedLine);
}
function isDependencyImportStatement(line, ext = '') {
  const sourceLine = String(line || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!sourceLine) {
    return false;
  }

  if (
    /^\s*import\b/.test(sourceLine)
    || /^\s*export\s+\{/.test(sourceLine)
    || /^\s*export\s+\*\s+from\b/.test(sourceLine)
    || /^\s*from\b.+\bimport\b/.test(sourceLine)
    || /^\s*(?:alias|use|require)\b/.test(sourceLine)
    || /^\s*require_relative\b/.test(sourceLine)
    || /^\s*#include\b/.test(sourceLine)
  ) {
    return true;
  }

  if (lowerExt === '.py') {
    return /^\s*(?:import|from)\b/.test(sourceLine);
  }

  return /^\s*(?:const|let|var)\s+.+?=\s*require\(/.test(sourceLine);
}
function changesStructuralTokens(before, after) {
  return countMatches(/\bfn\b/g, before) !== countMatches(/\bfn\b/g, after)
    || countMatches(/->/g, before) !== countMatches(/->/g, after)
    || countMatches(/\bdo\b/g, before) !== countMatches(/\bdo\b/g, after)
    || countMatches(/\bend\b/g, before) !== countMatches(/\bend\b/g, after)
    || countMatches(/[()]/g, before) !== countMatches(/[()]/g, after)
    || countMatches(/[\[\]]/g, before) !== countMatches(/[\[\]]/g, after)
    || countMatches(/[{}]/g, before) !== countMatches(/[{}]/g, after);
}
function tokenShouldIgnore(token, start, line, vars, assignmentSet, ext) {
  const len = token.length;
  const previousChar = start > 0 ? line[start - 1] : '';
  const nextChar = start + len < line.length ? line[start + len] : '';
  if (
    isReservedTokenForExtension(token, ext)
    || /^[A-Z][A-Za-z0-9_?!]*$/.test(token)
    || nextChar === ':'
    || previousChar === '.'
    || vars.has(token)
    || assignmentSet.has(token)
  ) {
    return true;
  }
  if (tokenIsKeywordArgument(line, start, len)) {
    return true;
  }
  if (tokenIsFunctionCall(line, start, len) || tokenIsMemberOrCapture(line, start, len, ext)) {
    return true;
  }
  return false;
}
function isReservedTokenForExtension(token, ext) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return true;
  }
  if (isReservedToken(normalized)) {
    return true;
  }

  const lowerExt = String(ext || '').toLowerCase();
  const shared = new Set(['true', 'false', 'null', 'undefined', 'True', 'False', 'None']);
  if (shared.has(normalized)) {
    return true;
  }

  if (isPythonLikeExtension(lowerExt)) {
    return new Set([
      'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
      'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
      'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
      'with', 'yield', 'self', '__name__', '__file__', '__package__', '__doc__', '__spec__',
      '__cached__', '__loader__', '__builtins__', 'bool', 'bytes', 'dict', 'enumerate',
      'float', 'frozenset', 'int', 'isinstance', 'len', 'list', 'max', 'min', 'object',
      'range', 'set', 'sorted', 'str', 'sum', 'tuple', 'type',
    ]).has(normalized);
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    return new Set([
      'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
      'delete', 'else', 'export', 'extends', 'finally', 'for', 'function', 'if', 'import',
      'in', 'instanceof', 'let', 'new', 'of', 'return', 'super', 'switch', 'this', 'throw',
      'try', 'typeof', 'var', 'void', 'while', 'yield', 'console',
    ]).has(normalized);
  }

  if (isGoExtension(lowerExt)) {
    return new Set([
      'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
      'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
      'return', 'select', 'struct', 'switch', 'type', 'var',
    ]).has(normalized);
  }

  if (isRustExtension(lowerExt)) {
    return new Set([
      'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'fn',
      'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref',
      'return', 'self', 'Self', 'static', 'struct', 'trait', 'type', 'unsafe', 'use', 'where',
      'while',
    ]).has(normalized);
  }

  if (lowerExt === '.c') {
    return new Set([
      'auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else',
      'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register',
      'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef',
      'union', 'unsigned', 'void', 'volatile', 'while',
    ]).has(normalized);
  }

  return false;
}
function tokenIsFunctionCall(line, start, len) {
  const tail = line.slice(start + len);
  return tail.trimStart().startsWith('(');
}
function tokenIsKeywordArgument(line, start, len) {
  const tail = line.slice(start + len).trimStart();
  return /^=(?!=)/.test(tail);
}
function tokenIsMemberOrCapture(line, start, len, ext) {
  const tail = line.slice(start + len);
  if (!tail.trimStart().startsWith('.')) {
    return false;
  }
  if (isJavaScriptLikeExtension(ext) || isPythonLikeExtension(ext)) {
    return false;
  }
  return true;
}
function checkFunctionalReassignment(lines, file) {
  const issues = [];
  const ext = path.extname(file).toLowerCase();
  if (!['.ex', '.exs'].includes(ext)) {
    return issues;
  }

  const isNotCodeLine = /(^\s*$|^\s*#|^\s*\/\/|^\s*--)/;

  lines.forEach((line, idx) => {
    if (isNotCodeLine.test(line)) {
      return;
    }
    const match = line.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(.+)$/);
    if (!match) {
      return;
    }

    const variable = match[1];
    const rightSide = match[2];
    if (!variable || rightSide.length === 0) {
      return;
    }
    const hasReference = variable !== 'ok' && new RegExp(`\\b${escapeRegExp(variable)}\\b`).test(rightSide);
    if (!hasReference) {
      return;
    }
    if (rightSide.includes(`&${variable}`) || rightSide.includes(`.${variable}`)) {
      return;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'functional_reassignment',
      message: `Reatribuicao de '${variable}' detectada`,
      suggestion: 'Considere fluxo funcional: nova variavel por etapa e nomes imutaveis.',
      snippet: snippetFunctionalReassignment(variable, rightSide.trim()),
    });
  });
  return issues;
}
function checkFunctionDocs(lines, file, opts = {}) {
  if (!isElixirExtension(path.extname(file))) {
    return [];
  }

  const issues = [];
  const focusRange = opts.focusRange || null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = readElixirFunctionDeclaration(lines, idx);
    if (!declaration || declaration.visibility !== 'def') {
      continue;
    }
    if (!intersectsFocusRange(focusRange, idx + 1, declaration.endIdx + 1)) {
      idx = declaration.endIdx;
      continue;
    }

    const annotationRange = resolveElixirAnnotationRange(lines, idx, '@doc');
    if (annotationRange) {
      if (isElixirFunctionDocOutdated(annotationRange, declaration, lines)) {
        issues.push({
          file,
          line: annotationRange.startLine + 1,
          severity: 'warning',
          kind: 'function_doc',
          message: `Documentacao @doc desatualizada para ${declaration.name}`,
          suggestion: 'Atualize os argumentos da documentação para refletir a assinatura atual da funcao.',
          snippet: snippetFunctionDoc(
            declaration.name,
            declaration.params,
            inferFunctionDocContext(lines, idx, declaration, path.extname(file)),
          ),
          metadata: buildFunctionIssueMetadata(lines, idx, declaration, path.extname(file)),
          action: {
            op: 'replace_range',
            range: {
              start: {
                line: annotationRange.startLine,
                character: 0,
              },
              end: {
                line: annotationRange.endLine + 1,
                character: 0,
              },
            },
          },
        });
      }
      idx = declaration.endIdx;
      continue;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_doc',
      message: 'Funcao publica sem @doc',
      suggestion: 'Documente pelo menos funcoes de dominio para reduzir ambiguidade do contrato.',
      snippet: snippetFunctionDoc(
        declaration.name,
        declaration.params,
        inferFunctionDocContext(lines, idx, declaration, path.extname(file)),
      ),
      metadata: buildFunctionIssueMetadata(lines, idx, declaration, path.extname(file)),
    });
    idx = declaration.endIdx;
  }
  return issues;
}
function checkCrossLanguageFunctionDocs(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (isElixirExtension(ext)) {
    return [];
  }

  if (isPythonLikeExtension(ext)) {
    return checkPythonFunctionDocs(lines, file, opts);
  }

  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = parseCrossLanguageFunctionDeclaration(lines[idx], ext);
    if (!declaration) {
      continue;
    }
    const declarationEnd = Number.isInteger(declaration.endIdx) ? declaration.endIdx : idx;
    if (!intersectsFocusRange(focusRange, idx + 1, declarationEnd + 1)) {
      idx = declarationEnd;
      continue;
    }

    const documentedRange = resolveCrossLanguageFunctionDocRange(lines, idx, declaration, ext);
    if (!documentedRange) {
      if (hasCrossLanguageFunctionDocumentation(lines, idx, ext)) {
        idx = declarationEnd;
        continue;
      }
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'function_doc',
        message: 'Funcao sem documentacao',
        suggestion: 'Adicione comentario ou documentacao idiomatica para facilitar manutencao.',
        snippet: buildLeadingFunctionDocumentation(
          declaration.name,
          declaration.params,
          declaration.name,
          ext,
          {
            ...inferCrossLanguageFunctionDocContext(lines, idx, declaration, ext),
            projectMemory,
          },
        ),
        metadata: buildFunctionIssueMetadata(lines, idx, declaration, ext),
      });
      idx = declarationEnd;
      continue;
    }

    if (isCrossLanguageFunctionDocOutdated(documentedRange, declaration, ext, lines)) {
      const generatedSnippet = buildLeadingFunctionDocumentation(
        declaration.name,
        normalizeDocumentedFunctionParams(declaration, ext),
        declaration.name,
        ext,
        {
          ...inferCrossLanguageFunctionDocContext(lines, idx, declaration, ext),
          projectMemory,
        },
      );
      const currentDocText = functionDocRangeText(lines, documentedRange);
      if (normalizeFunctionDocText(currentDocText) === normalizeFunctionDocText(generatedSnippet)) {
        idx = declarationEnd;
        continue;
      }

      issues.push({
        file,
        line: documentedRange.startLine + 1,
        severity: 'warning',
        kind: 'function_doc',
        message: `Documentacao desatualizada para ${declaration.name}`,
        suggestion: 'Atualize a documentacao para refletir a assinatura atual da funcao.',
        snippet: generatedSnippet,
        metadata: buildFunctionIssueMetadata(lines, idx, declaration, ext),
        action: {
          op: 'replace_range',
          range: {
            start: {
              line: documentedRange.startLine,
              character: 0,
            },
            end: {
              line: documentedRange.endLine + 1,
              character: 0,
            },
          },
        },
      });
    }

    idx = declarationEnd;
  }
  return issues;
}

function resolveCrossLanguageFunctionDocRange(lines, declarationLineIdx, declaration, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt)) {
    return resolveCrossLanguagePythonDocRange(lines, declaration);
  }
  if (supportsCrossLanguageBlockComments(lowerExt)) {
    const blockRange = resolveCrossLanguageBlockCommentDocRange(lines, declarationLineIdx, lowerExt);
    if (blockRange) {
      return blockRange;
    }
  }
  if (isJavaScriptLikeExtension(lowerExt)) {
    return resolveCrossLanguageJavaScriptDocRange(lines, declarationLineIdx);
  }
  if (supportsCrossLanguageLineComments(lowerExt)) {
    return resolveCrossLanguageLineCommentDocRange(lines, declarationLineIdx, lowerExt);
  }
  return null;
}

function resolveCrossLanguageLineCommentDocRange(lines, declarationLineIdx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const linePrefixes = crossLanguageLineCommentPrefixes(lowerExt);
  if (!linePrefixes.length) {
    return null;
  }

  let cursor = Number.isInteger(declarationLineIdx) ? declarationLineIdx - 1 : -1;
  while (cursor >= 0 && !String(lines[cursor] || '').trim()) {
    cursor -= 1;
  }
  if (cursor < 0 || !isCrossLanguageLineComment(lines[cursor], lowerExt)) {
    return null;
  }

  let endLine = cursor;
  let startLine = cursor;
  let found = false;
  for (let idx = cursor; idx >= 0; idx -= 1) {
    const currentLine = String(lines[idx] || '').trim();
    if (!currentLine) {
      continue;
    }
    if (!isCrossLanguageLineComment(currentLine, lowerExt)) {
      break;
    }

    found = true;
    startLine = idx;
  }

  return found ? { startLine, endLine } : null;
}

function isCrossLanguageLineComment(line, ext) {
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine) {
    return false;
  }
  const linePrefixes = crossLanguageLineCommentPrefixes(ext);
  return linePrefixes.some((prefix) => normalizedLine.startsWith(prefix));
}

function supportsCrossLanguageLineComments(ext) {
  return crossLanguageLineCommentPrefixes(ext).length > 0;
}

function supportsCrossLanguageBlockComments(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return supportsSlashComments(lowerExt) || lowerExt === '.lua';
}

function crossLanguageLineCommentPrefixes(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const profilePrefix = String(commentPrefix(lowerExt) || '').trim();
  const prefixes = new Set();

  if (profilePrefix) {
    prefixes.add(profilePrefix);
  }
  if (supportsSlashComments(lowerExt)) {
    prefixes.add('//');
  }
  if (supportsHashComments(lowerExt)) {
    prefixes.add('#');
  }
  if (lowerExt === '.vim') {
    prefixes.add('"');
  }
  if (lowerExt === '.lua') {
    prefixes.add('--');
  }

  return Array.from(prefixes)
    .filter((prefix) => prefix && prefix.length > 0);
}

function resolveCrossLanguageBlockCommentDocRange(lines, declarationLineIdx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!supportsCrossLanguageBlockComments(lowerExt)) {
    return null;
  }

  const normalizedLines = Array.isArray(lines) ? lines : [];
  let cursor = Number.isInteger(declarationLineIdx) ? declarationLineIdx - 1 : -1;
  while (cursor >= 0 && !String(normalizedLines[cursor] || '').trim()) {
    cursor -= 1;
  }
  if (cursor < 0) {
    return null;
  }

  const endTrimmed = String(normalizedLines[cursor] || '').trim();
  if (!isCrossLanguageBlockCommentLineEnd(endTrimmed, lowerExt)
    && !isCrossLanguageBlockCommentLineStart(endTrimmed, lowerExt)) {
    return null;
  }
  if (isCrossLanguageBlockCommentLineStart(endTrimmed, lowerExt) && isCrossLanguageBlockCommentLineEnd(endTrimmed, lowerExt)) {
    return {
      startLine: cursor,
      endLine: cursor,
    };
  }

  for (let idx = cursor; idx >= 0; idx -= 1) {
    const trimmedLine = String(normalizedLines[idx] || '').trim();
    if (!trimmedLine) {
      continue;
    }

    if (isCrossLanguageBlockCommentLineStart(trimmedLine, lowerExt)) {
      return {
        startLine: idx,
        endLine: cursor,
      };
    }

    if (lowerExt === '.lua') {
      continue;
    }

    if (supportsSlashComments(lowerExt) && trimmedLine.startsWith('*')) {
      continue;
    }

    if (!isCrossLanguageLineComment(trimmedLine, lowerExt) && !isCrossLanguageBlockCommentLineEnd(trimmedLine, lowerExt)) {
      return null;
    }
  }

  return null;
}

function isCrossLanguageBlockCommentLineStart(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine) {
    return false;
  }
  if (lowerExt === '.lua') {
    return normalizedLine.includes('--[[');
  }
  return supportsSlashComments(lowerExt) && normalizedLine.includes('/*');
}

function isCrossLanguageBlockCommentLineEnd(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const normalizedLine = String(line || '').trim();
  if (!normalizedLine) {
    return false;
  }
  if (lowerExt === '.lua') {
    return normalizedLine.includes(']]');
  }
  return supportsSlashComments(lowerExt) && normalizedLine.includes('*/');
}

function resolveCrossLanguagePythonDocRange(lines, declaration) {
  const declarationEnd = Number.isInteger(declaration && declaration.endIdx) ? declaration.endIdx : -1;
  if (declarationEnd < 0 || declarationEnd + 1 >= lines.length) {
    return null;
  }
  const docStart = declarationEnd + 1;
  const docStartLine = String(lines[docStart] || '').trim();
  if (!docStartLine) {
    return null;
  }
  const quote = docStartLine.startsWith('"""') ? '"""' : (docStartLine.startsWith("'''") ? "'''" : null);
  if (!quote) {
    return null;
  }

  const sameLineClose = docStartLine.indexOf(quote, 3);
  if (sameLineClose >= 0) {
    return { startLine: docStart, endLine: docStart };
  }

  for (let idx = docStart + 1; idx < lines.length; idx += 1) {
    if (String(lines[idx] || '').includes(quote)) {
      return {
        startLine: docStart,
        endLine: idx,
      };
    }
  }

  return {
    startLine: docStart,
    endLine: lines.length - 1,
  };
}

function resolveCrossLanguageJavaScriptDocRange(lines, declarationLineIdx) {
  const blockRange = resolveCrossLanguageBlockCommentDocRange(lines, declarationLineIdx, '.js');
  if (blockRange) {
    return blockRange;
  }
  const lineRange = resolveCrossLanguageLineCommentDocRange(lines, declarationLineIdx, '.js');
  if (!lineRange) {
    return null;
  }
  return lineRange;
}

function normalizeFunctionDocText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').replace(/\s+$/g, ''))
    .join('\n')
    .trim();
}

function functionDocRangeText(lines, range) {
  return buildElixirAnnotationRangeLines(lines, range).join('\n');
}

function isCrossLanguageFunctionDocOutdated(docRange, declaration, ext, lines = []) {
  const parsed = parseCrossLanguageFunctionDocSignatureLines(lines, docRange, ext);
  if (!parsed || !hasCrossLanguageFunctionDocSignature(parsed, ext)) {
    return false;
  }

  const expectedSignature = buildFunctionSignatureRangeFromDeclaration(declaration, ext);
  const documentedSignature = buildFunctionSignatureRangeFromDoc(parsed);
  if (!expectedSignature || !documentedSignature) {
    return false;
  }

  if (expectedSignature.min === 0 && expectedSignature.max === 0) {
    return !documentedSignature.hasNoArgsPlaceholder
      && (documentedSignature.total > 0 || documentedSignature.min > 0 || documentedSignature.max > 0);
  }

  if (documentedSignature.total !== expectedSignature.total) {
    return true;
  }

  if (documentedSignature.hasVariadic !== expectedSignature.hasVariadic) {
    return true;
  }
  if (documentedSignature.min !== expectedSignature.min) {
    return true;
  }
  if (documentedSignature.max !== expectedSignature.max) {
    return true;
  }

  for (let index = 0; index < documentedSignature.argDescriptors.length; index += 1) {
    const documentedArg = documentedSignature.argDescriptors[index];
    const expectedArg = expectedSignature.argDescriptors[index];
    if (String(documentedArg.name || '') !== String(expectedArg.name || '')) {
      return true;
    }
    if (Boolean(documentedArg.isOptional) !== Boolean(expectedArg.isOptional)) {
      return true;
    }
    if (Boolean(documentedArg.isVariadic) !== Boolean(expectedArg.isVariadic)) {
      return true;
    }
  }

  return false;
}

function buildFunctionSignatureRangeFromDeclaration(declaration, ext) {
  const descriptors = Array.isArray(declaration && declaration.paramDescriptors)
    ? declaration.paramDescriptors
    : normalizeDocumentedFunctionParams(declaration, ext).map((name) => ({ name }));
  return buildFunctionSignatureRangeFromDescriptors(
    descriptors.filter((descriptor) => !isFunctionDocImplicitReceiver(descriptor && descriptor.name, ext)),
  );
}

function buildFunctionSignatureRangeFromDoc(parsedSignature) {
  if (!parsedSignature) {
    return null;
  }
  return buildFunctionSignatureRangeFromDescriptors(
    Array.isArray(parsedSignature.argDescriptors) ? parsedSignature.argDescriptors : [],
    parsedSignature,
  );
}

function buildFunctionSignatureRangeFromDescriptors(descriptors = [], source = {}) {
  const normalized = normalizeFunctionDescriptorList(descriptors);
  const hasNoArgsPlaceholder = Boolean(source && source.hasNoArgsPlaceholder);
  if (hasNoArgsPlaceholder) {
    return {
      argDescriptors: [],
      min: 0,
      max: 0,
      total: 0,
      hasVariadic: false,
      hasNoArgsPlaceholder: true,
    };
  }

  const hasVariadic = normalized.some((descriptor) => descriptor.isVariadic);
  const requiredCount = normalized.filter((descriptor) => !descriptor.isOptional && !descriptor.isVariadic).length;
  return {
    argDescriptors: normalized,
    min: requiredCount,
    max: hasVariadic ? Infinity : normalized.length,
    total: normalized.length,
    hasVariadic,
    hasNoArgsPlaceholder: false,
  };
}

function normalizeFunctionDescriptorList(descriptors = []) {
  return (Array.isArray(descriptors) ? descriptors : [])
    .map((descriptor) => ({
      name: sanitizeIdentifier(descriptor && descriptor.name || ''),
      isOptional: Boolean(descriptor && descriptor.isOptional),
      isVariadic: Boolean(descriptor && descriptor.isVariadic),
    }))
    .filter((descriptor) => descriptor.name);
}

function parseCrossLanguageFunctionDocSignatureLines(lines, docRange, ext) {
  const rangeLines = buildElixirAnnotationRangeLines(lines, docRange);
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt)) {
    return parsePythonFunctionDocSignature(rangeLines);
  }
  if (isJavaScriptLikeExtension(lowerExt)) {
    return parseJavaScriptFunctionDocSignature(rangeLines);
  }
  return parseGenericFunctionDocSignature(rangeLines, lowerExt);
}

function parseGenericFunctionDocSignature(docLines, ext) {
  const linesSource = Array.isArray(docLines) ? docLines : [];
  const hasSlashComment = supportsSlashComments(ext);
  const hasHashComment = supportsHashComments(ext);
  const argDescriptors = [];
  const seenArgs = new Set();
  let hasArgumentsSection = false;
  let hasNoArgsPlaceholder = false;
  let hasReturnTag = false;
  let isDocBlock = false;
  let inArgumentsSection = false;

  for (let idx = 0; idx < linesSource.length; idx += 1) {
    const rawLine = String(linesSource[idx] || '');
    const strippedLine = stripLeadingCommentPrefixForDocs(rawLine, hasSlashComment, hasHashComment).trim();
    if (!strippedLine) {
      continue;
    }
    if (isLineCommentBlockMarker(strippedLine)) {
      isDocBlock = true;
    }

    if (strippedLine.startsWith('*/') || strippedLine.startsWith('/**') || strippedLine.startsWith('*')) {
      continue;
    }

    if (/^(?:##\s*)?(?:argumentos|args?|par[aá]metros?|parameters?)\b/i.test(strippedLine)) {
      hasArgumentsSection = true;
      inArgumentsSection = true;
      continue;
    }
    if (/^(?:##\s*)?(?:retorno|returns?|resultado|sa[ií]da|output|outputs?|throws?|raises?|exce[cç][aã]o|erros?)\b/i.test(strippedLine)) {
      inArgumentsSection = false;
      continue;
    }

    if (/\b(no|sem|nenhum|nenhuma|none)\b.*\b(argumento|argumentos|args?|par[aá]metro[s]?|params?|par[âa]metros?)\b/i.test(strippedLine)) {
      hasNoArgsPlaceholder = true;
      hasArgumentsSection = true;
      continue;
    }

    if (/\s*@(return|returns?)\b/i.test(strippedLine)) {
      hasReturnTag = true;
      continue;
    }

    const parsedArg = parseDocArgumentDescriptor(strippedLine, ext);
    if (parsedArg && parsedArg.name) {
      appendDocArgDescriptor(argDescriptors, seenArgs, parsedArg);
      hasArgumentsSection = true;
      inArgumentsSection = true;
      continue;
    }

    if (!inArgumentsSection) {
      continue;
    }
  }

  return {
    argDescriptors,
    hasArgumentsSection,
    hasNoArgsPlaceholder,
    hasReturnTag,
    isDocBlock,
  };
}

function parseDocArgumentDescriptor(rawLine, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const normalizedLine = String(rawLine || '').trim();
  if (!normalizedLine) {
    return null;
  }

  const line = normalizedLine.replace(/^[-*+]\s*/, '').trim();
  const optionalPattern = /\b(opcional|optional|default|padrao|padr[aã]o)\b/i;
  const variadicPattern = /\b(vararg|variadic|rest)\b|\.{3}/i;
  const matchers = [
    /^@param\b(?:\s+\{[^}]+\})?\s+(\.{3}[a-z_][a-zA-Z0-9_?!]*|[a-z_][a-zA-Z0-9_?!]*|\.{3})(\?*)\b/i,
    /^`?(\.{3}[a-z_][a-zA-Z0-9_?!]*|[a-z_][a-zA-Z0-9_?!]*|\.{3})(\?*)`?(?:\([^:]+\))?\s*(?:[:\-–—]\s*|\s{2,}|=>\s+|$)/i,
    /^`?(\.{3}[a-z_][a-zA-Z0-9_?!]*|[a-z_][a-zA-Z0-9_?!]*|\.{3})(\?*)`?\s*:\s*/i,
  ];

  for (const matcher of matchers) {
    const match = line.match(matcher);
    if (!match || !match[1]) {
      continue;
    }

    const rawName = String(match[1] || '').trim();
    return {
      name: normalizeDocArgumentName(rawName),
      isOptional: Boolean(match[2]) || optionalPattern.test(normalizedLine),
      isVariadic: rawName === '...' || rawName.startsWith('...') || variadicPattern.test(normalizedLine),
      ext: lowerExt,
    };
  }

  return null;
}

function appendDocArgDescriptor(target, seenArgs, descriptor) {
  const normalizedName = sanitizeIdentifier(normalizeDocArgumentName(descriptor && descriptor.name));
  if (!normalizedName || seenArgs.has(normalizedName)) {
    return;
  }
  seenArgs.add(normalizedName);
  target.push({
    name: normalizedName,
    isOptional: Boolean(descriptor && descriptor.isOptional),
    isVariadic: Boolean(descriptor && descriptor.isVariadic),
  });
}

function normalizeDocArgumentName(rawName) {
  const normalized = String(rawName || '').trim();
  if (!normalized || normalized === '...') {
    return normalized;
  }
  return normalized.replace(/^\.\.\./, '').replace(/\?+$/g, '').trim();
}

function isLineCommentBlockMarker(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }
  return trimmed.startsWith('/*')
    || trimmed.startsWith('*')
    || trimmed.startsWith('*/')
    || trimmed.includes('@param')
    || trimmed.includes('@returns');
}

function stripLeadingCommentPrefixForDocs(line, supportsSlash, supportsHash) {
  const trimmedLine = String(line || '').trim();
  if (supportsSlash && /^\/\*\*/.test(trimmedLine)) {
    return trimmedLine.replace(/^\/\*\*+/, '');
  }
  if (supportsSlash && /^\/\*/.test(trimmedLine)) {
    return trimmedLine.replace(/^\/\*+/, '');
  }
  if (supportsSlash && /^\/\/\/?/.test(trimmedLine)) {
    return trimmedLine.replace(/^\/\/\/?/, '').trim();
  }
  if (supportsHash && /^#/.test(trimmedLine)) {
    return trimmedLine.replace(/^#/, '').trim();
  }
  if (/^--\[\[/.test(trimmedLine)) {
    return trimmedLine.replace(/^--\[\[/, '').replace(/\]\]$/, '').trim();
  }
  if (/^--/.test(trimmedLine)) {
    return trimmedLine.replace(/^--/, '').trim();
  }
  if (/^"/.test(trimmedLine)) {
    return trimmedLine.replace(/^"+/, '').trim();
  }
  if (trimmedLine === ']]') {
    return '';
  }
  if (supportsSlash && /^\*\/|^\*/.test(trimmedLine)) {
    return trimmedLine.replace(/^\*+|^\*\/\s*/, '');
  }
  return trimmedLine;
}

function hasCrossLanguageFunctionDocSignature(parsedSignature, ext) {
  if (isPythonLikeExtension(ext)) {
    return parsedSignature.hasArgumentsSection || parsedSignature.hasNoArgsPlaceholder;
  }
  if (isJavaScriptLikeExtension(ext)) {
    return parsedSignature.isDocBlock && (parsedSignature.hasArgumentsSection || parsedSignature.hasReturnTag);
  }
  return Boolean(parsedSignature
    && (parsedSignature.hasArgumentsSection
      || parsedSignature.hasNoArgsPlaceholder
      || (Array.isArray(parsedSignature.argDescriptors) && parsedSignature.argDescriptors.length > 0)));
}

function normalizeDocumentedFunctionParams(declaration, ext) {
  const params = Array.isArray(declaration && declaration.params) ? declaration.params : [];
  return params.filter((param) => !isFunctionDocImplicitReceiver(param, ext));
}

function isFunctionDocImplicitReceiver(param, ext) {
  const normalized = String(param || '').toLowerCase();
  if (isPythonLikeExtension(ext) && normalized === 'self') {
    return true;
  }
  if (isJavaScriptLikeExtension(ext) && normalized === 'this') {
    return true;
  }
  return false;
}

function parsePythonFunctionDocSignature(docLines) {
  const linesSource = Array.isArray(docLines) ? docLines : [];
  let hasArgumentsSection = false;
  let hasNoArgsPlaceholder = false;
  const argDescriptors = [];
  const seenArgs = new Set();
  let inArgumentsSection = false;

  for (let idx = 0; idx < linesSource.length; idx += 1) {
    const trimmed = String(linesSource[idx] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      continue;
    }
    if (/^Args:/i.test(trimmed)) {
      inArgumentsSection = true;
      hasArgumentsSection = true;
      continue;
    }
    if (inArgumentsSection && /^Returns?:/i.test(trimmed)) {
      inArgumentsSection = false;
      continue;
    }
    if (inArgumentsSection) {
      if (/^Nenhum argumento recebido/.test(trimmed)) {
        hasNoArgsPlaceholder = true;
      }
      const parsedArg = parseDocArgumentDescriptor(trimmed, '.py');
      if (parsedArg && parsedArg.name) {
        appendDocArgDescriptor(argDescriptors, seenArgs, parsedArg);
      }
    }
  }

  return {
    argDescriptors,
    hasArgumentsSection,
    hasNoArgsPlaceholder,
  };
}

function parseJavaScriptFunctionDocSignature(docLines) {
  const linesSource = Array.isArray(docLines) ? docLines : [];
  const genericSignature = parseGenericFunctionDocSignature(linesSource, '.js');
  const argDescriptors = [...(Array.isArray(genericSignature.argDescriptors) ? genericSignature.argDescriptors : [])];
  const seenArgs = new Set(argDescriptors.map((descriptor) => descriptor.name));
  const clean = linesSource.join('\n');
  const isDocBlock = genericSignature.isDocBlock || /\/\*\*/.test(clean) || /\* /.test(clean);
  linesSource.forEach((line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      return;
    }
    const parsedArg = parseDocArgumentDescriptor(stripLeadingCommentPrefixForDocs(trimmed, true, false), '.js');
    if (parsedArg && parsedArg.name) {
      appendDocArgDescriptor(argDescriptors, seenArgs, parsedArg);
    }
  });
  const hasArgumentsSection = genericSignature.hasArgumentsSection || argDescriptors.length > 0;
  const hasReturnTag = genericSignature.hasReturnTag || /@returns?\b/.test(clean);

  return {
    argDescriptors,
    hasArgumentsSection,
    hasNoArgsPlaceholder: genericSignature.hasNoArgsPlaceholder,
    hasReturnTag,
    isDocBlock,
  };
}

function checkPythonFunctionDocs(lines, file, opts = {}) {
  const issues = [];
  const projectMemory = loadProjectMemory(file);
  const focusRange = opts.focusRange || null;
  const ext = '.py';

  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = readPythonFunctionDeclaration(lines, idx);
    if (!declaration) {
      continue;
    }
    if ((Array.isArray(declaration.decorators) ? declaration.decorators : []).includes('overload')) {
      idx = declaration.endIdx;
      continue;
    }

    const declarationEnd = declaration.endIdx;
    if (!intersectsFocusRange(focusRange, idx + 1, declarationEnd + 1)) {
      idx = declarationEnd;
      continue;
    }

    const documentedRange = resolveCrossLanguagePythonDocRange(lines, declaration);
    if (!documentedRange) {
      issues.push({
        file,
        line: declaration.endIdx + 1,
        severity: 'info',
        kind: 'function_doc',
        message: `Funcao '${declaration.name}' sem documentacao`,
        suggestion: 'Adicione comentario ou documentacao idiomatica para facilitar manutencao.',
        snippet: buildLeadingFunctionDocumentation(
          declaration.name,
          declaration.params,
          declaration.name,
          '.py',
          {
            ...inferCrossLanguageFunctionDocContext(lines, idx, declaration, '.py'),
            projectMemory,
            indent: `${' '.repeat(declaration.baseIndent + 4)}`,
          },
        ),
        metadata: buildFunctionIssueMetadata(lines, idx, declaration, '.py'),
        action: {
          op: 'insert_after',
          indent: `${' '.repeat(declaration.baseIndent + 4)}`,
        },
      });
      idx = declaration.endIdx;
      continue;
    }

    const isOutdated = isCrossLanguageFunctionDocOutdated(documentedRange, declaration, ext, lines);
    if (isOutdated) {
      const generatedSnippet = buildLeadingFunctionDocumentation(
        declaration.name,
        declaration.params,
        declaration.name,
        '.py',
        {
          ...inferCrossLanguageFunctionDocContext(lines, idx, declaration, '.py'),
          projectMemory,
          indent: `${' '.repeat(declaration.baseIndent + 4)}`,
        },
      );
      const currentDocText = functionDocRangeText(lines, documentedRange);
      if (normalizeFunctionDocText(currentDocText) === normalizeFunctionDocText(generatedSnippet)) {
        idx = declaration.endIdx;
        continue;
      }

      issues.push({
        file,
        line: documentedRange.startLine + 1,
        severity: 'warning',
        kind: 'function_doc',
        message: `Documentacao desatualizada para ${declaration.name}`,
        suggestion: 'Atualize a documentacao para refletir a assinatura atual da funcao.',
        snippet: generatedSnippet,
        metadata: buildFunctionIssueMetadata(lines, idx, declaration, '.py'),
        action: {
          op: 'replace_range',
          range: {
            start: {
              line: documentedRange.startLine,
              character: 0,
            },
            end: {
              line: documentedRange.endLine + 1,
              character: 0,
            },
          },
        },
      });
    }
    idx = declaration.endIdx;
  }

  return issues;
}
function parseJavaScriptLikeFunctionDeclaration(line) {
  const source = String(line || '').trim();
  const matchers = [
    () => source.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{=>]+))?/),
    () => source.match(/^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?function(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{=>]+))?/),
    () => source.match(/^(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:<[^>]+>\s*)?(?:\(([^)]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*(?::\s*([^=]+?))?\s*=>/),
    () => source.match(/^(?:(?:public|private|protected|static|readonly|declare|override|abstract)\s+)*(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?(?:<[^>]+>\s*)?(?:\(([^)]*)\)|([A-Za-z_$][A-Za-z0-9_$]*))\s*(?::\s*([^=]+?))?\s*=>/),
    () => source.match(/^(?:(?:public|private|protected|static|async|get|set|override|readonly|abstract|declare)\s+)*(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)\s*(?::\s*([^{=>]+))?\s*\{/),
  ];

  return matchers.reduce((resolved, resolveMatch) => {
    if (resolved) {
      return resolved;
    }

    const match = resolveMatch();
    if (!match || !match[1]) {
      return null;
    }

    const rawName = String(match[1] || '').trim();
    const normalizedName = rawName.replace(/^#/, '');
    if (!normalizedName || isJavaScriptControlKeyword(normalizedName) || isJavaScriptPseudoMethodName(normalizedName)) {
      return null;
    }

    return {
      name: normalizedName,
      paramsSource: String(match[2] || match[3] || '').trim(),
      returnAnnotation: /=>/.test(match[0])
        ? String(match[4] || '').trim()
        : String(match[3] || '').trim(),
    };
  }, null);
}
function parseCrossLanguageFunctionDeclaration(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  let match = null;
  let returnAnnotation = '';
  let rawName = '';
  let rawParams = '';

  if (isJavaScriptLikeExtension(lowerExt)) {
    const declaration = parseJavaScriptLikeFunctionDeclaration(line);
    if (!declaration) {
      return null;
    }
    rawName = declaration.name;
    rawParams = declaration.paramsSource;
    returnAnnotation = declaration.returnAnnotation;
  } else if (isPythonLikeExtension(lowerExt)) {
    match = String(line).match(/^\s*def\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?\s*:/);
  } else if (isGoExtension(lowerExt)) {
    match = String(line).match(/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:\(([^)]*)\)|([A-Za-z_][A-Za-z0-9_\[\]\*\.]*))?/);
  } else if (isRustExtension(lowerExt)) {
    match = String(line).match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*(?:->\s*([^{]+))?/);
  } else if (lowerExt === '.rb') {
    match = String(line).match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)(?:\(([^)]*)\))?/);
  } else if (lowerExt === '.vim') {
    match = String(line).match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(([^)]*)\)/);
  } else if (lowerExt === '.lua') {
    match = String(line).match(/^\s*(?:local\s+)?function\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)/);
  } else if (['.c', '.h'].includes(lowerExt)) {
    match = String(line).match(/^\s*((?:static|inline|extern|const|unsigned|signed|volatile|register|long|short)\s+)*(?:struct\s+\w+\s+|enum\s+\w+\s+|union\s+\w+\s+)?([A-Za-z_][A-Za-z0-9_]*(?:\s*\*)*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{/);
    if (match && match[2] && match[3]) {
      returnAnnotation = String(match[2] || '').trim();
      rawName = String(match[3] || '').trim();
      rawParams = String(match[4] || '').trim();
    }
  } else if (['.sh', '.bash', '.zsh'].includes(lowerExt)) {
    match = String(line).match(/^\s*(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\s*\))?\s*\{\s*$/);
  }

  if (['.c', '.h'].includes(lowerExt)) {
    if (!rawName) {
      return null;
    }
    const paramDescriptors = parseGenericParamDescriptors(rawParams, lowerExt);
    return {
      name: sanitizeIdentifier(rawName),
      params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
      paramDescriptors,
      returnAnnotation,
    };
  }

  if (!match || !match[1]) {
    if (!isJavaScriptLikeExtension(lowerExt)) {
      return null;
    }
  }

  if (!isJavaScriptLikeExtension(lowerExt) && (isPythonLikeExtension(lowerExt) || isRustExtension(lowerExt))) {
    returnAnnotation = String(match[3] || '').trim();
  } else if (isGoExtension(lowerExt)) {
    returnAnnotation = String(match[3] || match[4] || '').trim();
  }

  if (!isJavaScriptLikeExtension(lowerExt)) {
    rawName = String(match[1] || '').trim();
    rawParams = String(match[2] || '').trim();
  }

  const paramDescriptors = parseGenericParamDescriptors(rawParams, lowerExt);

  return {
    name: sanitizeIdentifier(rawName),
    params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
    paramDescriptors,
    returnAnnotation,
  };
}
function parseGenericParamDescriptors(raw, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return splitTopLevelParams(String(raw || ''))
    .map((token) => String(token).trim())
    .filter(Boolean)
    .map((token) => {
      const baseDescriptor = {
        isOptional: isGenericFunctionParamOptional(token, lowerExt),
        isVariadic: isGenericFunctionParamVariadic(token, lowerExt),
      };
      if (isGoExtension(lowerExt)) {
        const parts = token.split(/\s+/).filter(Boolean);
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(parts[0] || ''),
          annotation: parts.slice(1).join(' '),
        };
      }
      if (isRustExtension(lowerExt)) {
        const [name, annotation] = token.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isPythonLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isJavaScriptLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').replace(/^\.\.\./, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (['.c', '.h'].includes(lowerExt)) {
        const compact = token.replace(/\s+/g, ' ').trim();
        if (compact === 'void') {
          return {
            ...baseDescriptor,
            name: '',
            annotation: 'void',
          };
        }
        const parts = compact.split(/\s+/).filter(Boolean);
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(parts[parts.length - 1] || ''),
          annotation: parts.slice(0, -1).join(' '),
        };
      }
      return {
        ...baseDescriptor,
        name: sanitizeIdentifier(token),
        annotation: '',
      };
    })
    .filter((descriptor) => descriptor.name);
}

function isGenericFunctionParamOptional(token, ext) {
  const source = String(token || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!source) {
    return false;
  }
  if (isJavaScriptLikeExtension(lowerExt) || isPythonLikeExtension(lowerExt) || ['.rb', '.vim', '.lua'].includes(lowerExt)) {
    return /=/.test(source) || /\?\s*(?::|=|$)/.test(source);
  }
  return false;
}

function isGenericFunctionParamVariadic(token, ext) {
  const source = String(token || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!source) {
    return false;
  }
  if (isJavaScriptLikeExtension(lowerExt) || lowerExt === '.lua') {
    return source.startsWith('...') || source === '...';
  }
  if (isPythonLikeExtension(lowerExt)) {
    return /^\*{1,2}/.test(source);
  }
  if (isGoExtension(lowerExt)) {
    return /\.\.\./.test(source);
  }
  if (isRustExtension(lowerExt)) {
    return false;
  }
  return source.includes('...');
}
function parseGenericFunctionParams(raw, ext) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => String(token).trim())
    .filter(Boolean)
    .map((token) => {
      if (isGoExtension(ext)) {
        return sanitizeIdentifier(token.split(/\s+/)[0] || '');
      }
      if (isRustExtension(ext)) {
        return sanitizeIdentifier(token.split(':')[0] || '');
      }
      if (isPythonLikeExtension(ext)) {
        return sanitizeIdentifier(token.replace(/=.*/, ''));
      }
      return sanitizeIdentifier(token);
    })
    .filter(Boolean);
}
function inferCrossLanguageFunctionDocContext(lines, startIdx, declaration, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const bodyLines = collectCrossLanguageFunctionBodyLines(lines, startIdx, ext);
  return {
    paramDescriptors: declaration.paramDescriptors || [],
    returnAnnotation: declaration.returnAnnotation || '',
    returnExpression: inferCrossLanguageReturnExpression(bodyLines, lowerExt),
    bodyLines,
  };
}
function collectCrossLanguageFunctionBodyLines(lines, startIdx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt)) {
    const declarationLine = String(lines[startIdx] || '');
    const baseIndent = (declarationLine.match(/^\s*/) || [''])[0].length;
    const bodyLines = [];
    for (let index = startIdx + 1; index < lines.length; index += 1) {
      const currentLine = String(lines[index] || '');
      const trimmed = currentLine.trim();
      if (!trimmed) {
        bodyLines.push(currentLine);
        continue;
      }
      const currentIndent = (currentLine.match(/^\s*/) || [''])[0].length;
      if (currentIndent <= baseIndent) {
        break;
      }
      bodyLines.push(currentLine);
    }
    return bodyLines;
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    const declarationLine = String(lines[startIdx] || '');
    const inlineReturn = extractInlineJavaScriptReturnLine(declarationLine);
    if (inlineReturn) {
      return [inlineReturn];
    }

    const expressionBody = declarationLine.match(/=>\s*(.+?)\s*;?\s*$/);
    if (expressionBody && countMatches(/\{/g, declarationLine) === 0) {
      return [`return ${expressionBody[1].trim()};`];
    }
  }

  if (isJavaScriptLikeExtension(lowerExt) || isGoExtension(lowerExt) || isRustExtension(lowerExt) || ['.c', '.h', '.sh'].includes(lowerExt)) {
    const bodyLines = [];
    let depth = countMatches(/\{/g, String(lines[startIdx] || '')) - countMatches(/\}/g, String(lines[startIdx] || ''));
    for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
      const currentLine = String(lines[index] || '');
      bodyLines.push(currentLine);
      depth += countMatches(/\{/g, currentLine) - countMatches(/\}/g, currentLine);
    }
    return bodyLines;
  }

  return [];
}
function extractInlineJavaScriptReturnLine(line) {
  const source = String(line || '').trim();
  const match = source.match(/\{\s*return\s+(.+?)\s*;?\s*\}\s*;?$/);
  if (!match || !match[1]) {
    return '';
  }
  return `return ${match[1].trim()};`;
}
function inferCrossLanguageReturnExpression(bodyLines, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const returnLine = Array.isArray(bodyLines)
    ? bodyLines.find((line) => {
      const normalized = String(line || '').trim();
      if (!normalized) {
        return false;
      }
      if (isPythonLikeExtension(lowerExt)) {
        return /^return\b/.test(normalized);
      }
      return /\breturn\b/.test(normalized);
    })
    : '';
  if (!returnLine) {
    return '';
  }

  if (isPythonLikeExtension(lowerExt)) {
    const match = String(returnLine).match(/^\s*return\s+(.+?)\s*$/);
    return match && match[1] ? match[1].trim() : '';
  }

  const match = String(returnLine).match(/\breturn\s+([^;]+);?/);
  return match && match[1] ? match[1].trim() : '';
}
function hasCrossLanguageFunctionDocumentation(lines, idx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt) && hasPythonFunctionDocstring(lines, idx)) {
    return true;
  }

  const anchorIdx = isPythonLikeExtension(lowerExt)
    ? collectPythonLeadingDecorators(lines, idx).decoratorStartIdx
    : idx;
  if (supportsSlashComments(lowerExt) && resolveCrossLanguageBlockCommentDocRange(lines, anchorIdx, lowerExt)) {
    return true;
  }

  for (let cursor = anchorIdx - 1; cursor >= 0; cursor -= 1) {
    const line = String(lines[cursor] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (/^(?:\/\/|#|--|")\s*:/.test(trimmed)) {
      continue;
    }
    if (
      trimmed.startsWith('/**')
      || trimmed.startsWith('*')
      || trimmed.startsWith('*/')
      || trimmed.startsWith('///')
      || trimmed.startsWith('//')
      || trimmed.startsWith('#')
      || trimmed.startsWith('--')
      || trimmed.startsWith('"')
    ) {
      return true;
    }
    break;
  }

  return false;
}
function hasPythonFunctionDocstring(lines, idx) {
  const declaration = readPythonFunctionDeclaration(lines, idx);
  const startIdx = declaration ? declaration.endIdx + 1 : idx + 1;

  for (let cursor = startIdx; cursor < lines.length; cursor += 1) {
    const trimmed = String(lines[cursor] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/^("""|''')/.test(trimmed)) {
      return true;
    }
    break;
  }
  return false;
}
function checkFlowMaintenanceComments(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (!shouldAnalyzeFlowComments(lines)) {
    return [];
  }
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);

  lines.forEach((line, idx) => {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      return;
    }
    const snippet = buildMaintenanceComment(line, ext, lines.slice(idx + 1, idx + 4), {
      projectMemory,
    });
    if (!snippet) {
      return;
    }
    if (hasLeadingFlowComment(lines, idx, ext)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'flow_comment',
      message: 'Trecho sem comentario de manutencao',
      suggestion: 'Adicione comentario curto explicando a intencao deste passo antes de editar o corpo.',
      snippet,
      metadata: buildFlowCommentIssueMetadata(lines, idx, ext),
    });
  });

  return issues;
}
function checkClassDocs(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (isJavaScriptLikeExtension(ext)) {
    return checkJavaScriptClassDocs(lines, file, opts);
  }
  if (isRubyExtension(ext)) {
    return checkRubyClassDocs(lines, file, opts);
  }

  if (isPythonLikeExtension(ext)) {
    const issues = [];
    const focusRange = opts.focusRange || null;
    const projectMemory = loadProjectMemory(file);
    lines.forEach((line, idx) => {
      const className = parsePythonClassDeclaration(line);
      if (!className) {
        return;
      }
      if (!intersectsFocusRange(focusRange, idx + 1)) {
        return;
      }
      if (hasPythonClassDocumentation(lines, idx)) {
        return;
      }
      const indent = `${lineIndentation(line)}    `;
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'class_doc',
        message: `Classe '${className}' sem documentacao`,
        suggestion: 'Adicione documentacao curta para explicitar responsabilidade e contrato da classe.',
        snippet: [
          `${indent}"""`,
          `${indent}${describePythonClassTarget(className, buildPythonClassIssueMetadata(lines, idx, className), projectMemory)}`,
          `${indent}"""`,
        ].join('\n'),
        metadata: buildPythonClassIssueMetadata(lines, idx, className),
        action: {
          op: 'insert_after',
          indent,
        },
      });
    });

    return issues;
  }

  return [];
}
function checkVariableDocs(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  if (isJavaScriptLikeExtension(ext)) {
    return checkJavaScriptVariableDocs(lines, file, opts);
  }
  if (isRubyExtension(ext)) {
    return checkRubyVariableDocs(lines, file, opts);
  }
  if (ext === '.lua') {
    return checkLuaVariableDocs(lines, file, opts);
  }
  if (!isPythonLikeExtension(ext)) {
    return [];
  }

  return checkPythonVariableDocs(lines, file, opts);
}
function checkPythonVariableDocs(lines, file, opts = {}) {
  const issues = [];
  const projectMemory = loadProjectMemory(file);
  const focusRange = opts.focusRange || null;
  let multilineQuote = '';

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = String(lines[idx] || '');
    const functionDeclaration = readPythonFunctionDeclaration(lines, idx);
    if (functionDeclaration) {
      idx = findPythonIndentedBlockEnd(lines, functionDeclaration.endIdx, functionDeclaration.baseIndent);
      continue;
    }

    const className = parsePythonClassDeclaration(rawLine);
    if (className) {
      issues.push(...collectPythonClassVariableDocIssues(lines, file, idx, { focusRange }));
      idx = findPythonIndentedBlockEnd(lines, idx, leadingIndentLength(rawLine));
      continue;
    }

    const strippedLine = stripPythonMultilineStringContent(rawLine, multilineQuote);
    multilineQuote = strippedLine.multilineQuote;
    const candidate = parsePythonVariableDocCandidate(strippedLine.line, { allowBareAnnotation: false });
    if (!candidate) {
      continue;
    }
    if (leadingIndentLength(rawLine) !== 0) {
      continue;
    }
    if (!isPythonModuleVariableDocTarget(candidate, rawLine)) {
      continue;
    }
    if (hasLeadingPythonVariableDocumentation(lines, idx)) {
      continue;
    }
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      continue;
    }

    issues.push(buildPythonVariableDocIssue(file, idx, rawLine, candidate, false, {
      projectMemory,
    }));
  }

  return issues;
}
function collectPythonClassVariableDocIssues(lines, file, classStartIdx, opts = {}) {
  const className = parsePythonClassDeclaration(lines[classStartIdx]);
  const classBaseIndent = leadingIndentLength(lines[classStartIdx]);
  const classEndIdx = findPythonIndentedBlockEnd(lines, classStartIdx, classBaseIndent);
  const issues = [];
  const projectMemory = loadProjectMemory(file);
  const focusRange = opts.focusRange || null;
  let multilineQuote = '';

  for (let idx = classStartIdx + 1; idx <= classEndIdx; idx += 1) {
    const rawLine = String(lines[idx] || '');
    const currentIndent = leadingIndentLength(rawLine);
    const nestedClass = parsePythonClassDeclaration(rawLine);
    if (nestedClass && currentIndent > classBaseIndent) {
      idx = findPythonIndentedBlockEnd(lines, idx, currentIndent);
      continue;
    }

    const functionDeclaration = readPythonFunctionDeclaration(lines, idx);
    if (functionDeclaration && functionDeclaration.baseIndent > classBaseIndent) {
      idx = findPythonIndentedBlockEnd(lines, functionDeclaration.endIdx, functionDeclaration.baseIndent);
      continue;
    }

    const strippedLine = stripPythonMultilineStringContent(rawLine, multilineQuote);
    multilineQuote = strippedLine.multilineQuote;
    const candidate = parsePythonVariableDocCandidate(strippedLine.line, { allowBareAnnotation: true });
    if (!candidate) {
      continue;
    }
    if (currentIndent !== classBaseIndent + 4) {
      continue;
    }
    if (hasLeadingPythonVariableDocumentation(lines, idx)) {
      continue;
    }
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      continue;
    }
    if (shouldSkipPythonVariableDocCandidate(candidate, true)) {
      continue;
    }

    issues.push(buildPythonVariableDocIssue(file, idx, rawLine, candidate, true, {
      containerClassName: className,
      projectMemory,
    }));
  }

  return issues;
}
function findPythonIndentedBlockEnd(lines, startIdx, baseIndent) {
  let endIdx = startIdx;

  for (let idx = startIdx + 1; idx < lines.length; idx += 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();
    if (!trimmed || /^\s*#/.test(rawLine)) {
      endIdx = idx;
      continue;
    }
    if (leadingIndentLength(rawLine) <= baseIndent) {
      break;
    }
    endIdx = idx;
  }

  return endIdx;
}
function parsePythonVariableDocCandidate(rawLine, options = {}) {
  const line = sanitizeScopedAnalysisLine(rawLine, '.py');
  if (!line) {
    return null;
  }
  if (/^(?:from\b|import\b|return\b|raise\b|assert\b|yield\b|await\b|if\b|elif\b|else\b|for\b|while\b|try\b|except\b|finally\b|with\b|match\b|case\b|pass\b|break\b|continue\b|global\b|nonlocal\b|del\b|def\b|class\b|@)/.test(line)) {
    return null;
  }

  const assignmentMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^=]+))?\s*=\s*(.+)$/);
  if (assignmentMatch && isEligiblePythonVariableDocName(assignmentMatch[1])) {
    return {
      name: sanitizeIdentifier(assignmentMatch[1]),
      annotation: String(assignmentMatch[2] || '').trim(),
      rhs: String(assignmentMatch[3] || '').trim(),
      style: 'assignment',
    };
  }

  if (!options.allowBareAnnotation) {
    return null;
  }

  const annotationMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)$/);
  if (!annotationMatch || !isEligiblePythonVariableDocName(annotationMatch[1])) {
    return null;
  }

  return {
    name: sanitizeIdentifier(annotationMatch[1]),
    annotation: String(annotationMatch[2] || '').trim(),
    rhs: '',
    style: 'annotation',
  };
}
function isEligiblePythonVariableDocName(name) {
  const normalized = sanitizeIdentifier(name);
  if (!normalized) {
    return false;
  }
  return !/^__.*__$/.test(normalized);
}
function normalizePythonAnnotationBaseType(annotation) {
  return String(annotation || '')
    .split(/[|\[\],\s]/)
    .map((segment) => String(segment || '').trim().toLowerCase())
    .find(Boolean) || '';
}
function shouldSkipPythonVariableDocCandidate(candidate, insideClass) {
  if (!insideClass || !candidate || !candidate.name) {
    return false;
  }

  const normalizedName = String(candidate.name || '').trim().toLowerCase();
  const annotationType = normalizePythonAnnotationBaseType(candidate.annotation);
  const trivialScalarNames = new Set([
    'id',
    'name',
    'title',
    'label',
    'value',
    'count',
    'total',
    'status',
    'enabled',
    'active',
    'host',
    'port',
    'path',
    'url',
    'token',
    'code',
    'created_at',
    'updated_at',
    'version',
  ]);
  const trivialScalarTypes = new Set(['str', 'int', 'float', 'bool', 'bytes']);
  const hasTrivialScalarSuffix = /_(?:id|name|title|label|value|count|total|status)$/.test(normalizedName);
  const hasTrivialBooleanPrefix = annotationType === 'bool' && /^(?:is|has|can|should)_/.test(normalizedName);

  if (!trivialScalarTypes.has(annotationType)) {
    return false;
  }

  return trivialScalarNames.has(normalizedName)
    || hasTrivialScalarSuffix
    || hasTrivialBooleanPrefix;
}
function isPythonModuleVariableDocTarget(candidate, rawLine) {
  if (!candidate || !candidate.name) {
    return false;
  }
  if (/^(?:T|KT|VT|PT|RT)$/.test(String(candidate.name || ''))) {
    return false;
  }
  if (/\b(?:TypeVar|ParamSpec|TypeAlias)\b/.test(String(candidate.rhs || candidate.annotation || ''))) {
    return false;
  }
  if (buildMaintenanceComment(rawLine, '.py')) {
    return true;
  }
  return /^[A-Z][A-Za-z0-9_]*$/.test(candidate.name);
}
function hasLeadingPythonVariableDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^#\s*:/.test(trimmed)) {
      return false;
    }
    return /^\s*#/.test(currentLine);
  }

  return false;
}
function buildPythonVariableDocIssue(file, idx, rawLine, candidate, insideClass, options = {}) {
  const subject = insideClass ? 'Atributo' : 'Variavel';
  return {
    file,
    line: idx + 1,
    severity: 'info',
    kind: 'variable_doc',
    message: `${subject} '${candidate.name}' sem documentacao contextual`,
    suggestion: 'Adicione comentario curto explicando o papel desta variavel ou atributo no contrato atual.',
    snippet: buildPythonVariableDocumentationSnippet(rawLine, candidate, insideClass, options),
    metadata: {
      symbolName: candidate.name,
      annotation: candidate.annotation || '',
      rhs: candidate.rhs || '',
      style: candidate.style || '',
      insideClass: Boolean(insideClass),
      containerClassName: String(options.containerClassName || ''),
    },
  };
}
function buildPythonVariableDocumentationSnippet(rawLine, candidate, insideClass, options = {}) {
  if (insideClass || candidate.style === 'annotation' || /^[A-Z][A-Za-z0-9_]*$/.test(String(candidate && candidate.name || ''))) {
    return `${lineIndentation(rawLine)}# ${describePythonVariableTarget(candidate, insideClass, options)}`;
  }

  const fallback = buildMaintenanceComment(rawLine, '.py', [], {
    projectMemory: options.projectMemory,
  });
  if (fallback) {
    return fallback;
  }

  return `${lineIndentation(rawLine)}# ${describePythonVariableTarget(candidate, insideClass, options)}`;
}

function checkJavaScriptClassDocs(lines, file, opts = {}) {
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);

  lines.forEach((line, idx) => {
    const className = parseJavaScriptClassDeclaration(line);
    if (!className) {
      return;
    }
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (hasJavaScriptClassDocumentation(lines, idx)) {
      return;
    }

    const metadata = buildJavaScriptClassIssueMetadata(lines, idx, className);
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'class_doc',
      message: `Classe '${className}' sem documentacao`,
      suggestion: 'Adicione documentacao curta para explicitar responsabilidade e contrato da classe.',
      snippet: [
        '/**',
        ` * ${describeJavaScriptClassTarget(className, metadata, projectMemory)}`,
        ' */',
      ].join('\n'),
      metadata,
      action: { op: 'insert_before' },
    });
  });

  return issues;
}

function checkRubyClassDocs(lines, file, opts = {}) {
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);

  lines.forEach((line, idx) => {
    const declaration = parseRubyClassLikeDeclaration(line);
    if (!declaration) {
      return;
    }
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (hasRubyClassDocumentation(lines, idx)) {
      return;
    }

    const metadata = buildRubyClassIssueMetadata(lines, idx, declaration);
    const label = declaration.kind === 'module' ? 'Modulo' : 'Classe';
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'class_doc',
      message: `${label} '${declaration.name}' sem documentacao`,
      suggestion: 'Adicione documentacao curta para explicitar responsabilidade e contrato da estrutura Ruby.',
      snippet: `${lineIndentation(line)}# ${describeRubyClassTarget(declaration, metadata, projectMemory)}`,
      metadata,
      action: { op: 'insert_before' },
    });
  });

  return issues;
}

function checkJavaScriptVariableDocs(lines, file, opts = {}) {
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);

  lines.forEach((rawLine, idx) => {
    const line = String(rawLine || '');
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }

    const topLevelCandidate = parseJavaScriptVariableDocCandidate(line, false);
    if (topLevelCandidate && leadingIndentLength(line) === 0 && !hasLeadingJavaScriptVariableDocumentation(lines, idx)) {
      const issue = buildJavaScriptVariableDocIssue(file, idx, rawLine, topLevelCandidate, false, { projectMemory });
      if (issue) {
        issues.push(issue);
      }
      return;
    }

    const className = parseJavaScriptClassDeclaration(line);
    if (!className) {
      return;
    }

    const classBlock = collectJavaScriptClassBlock(lines, idx);
    if (!classBlock) {
      return;
    }

    for (let cursor = idx + 1; cursor <= classBlock.endIdx; cursor += 1) {
      if (!intersectsFocusRange(focusRange, cursor + 1)) {
        continue;
      }
      const candidate = parseJavaScriptVariableDocCandidate(lines[cursor], true);
      if (!candidate || hasLeadingJavaScriptVariableDocumentation(lines, cursor)) {
        continue;
      }
      const issue = buildJavaScriptVariableDocIssue(file, cursor, lines[cursor], candidate, true, {
        containerClassName: className,
        projectMemory,
      });
      if (issue) {
        issues.push(issue);
      }
    }
  });

  return issues;
}

function parseJavaScriptClassDeclaration(line) {
  const match = String(line || '').match(/^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
  return match && match[1] ? sanitizeIdentifier(match[1]) : '';
}

function collectJavaScriptClassBlock(lines, startIdx) {
  const header = String(lines[startIdx] || '');
  let depth = countMatches(/\{/g, header) - countMatches(/\}/g, header);
  if (depth <= 0) {
    return null;
  }
  let endIdx = startIdx;
  const bodyPreview = [];

  for (let idx = startIdx + 1; idx < lines.length && depth > 0; idx += 1) {
    const currentLine = String(lines[idx] || '');
    const trimmed = currentLine.trim();
    if (trimmed && !/^\s*\/\//.test(currentLine) && bodyPreview.length < 6) {
      bodyPreview.push(trimmed);
    }
    depth += countMatches(/\{/g, currentLine) - countMatches(/\}/g, currentLine);
    endIdx = idx;
  }

  return {
    endIdx,
    bodyPreview,
  };
}

function buildJavaScriptClassIssueMetadata(lines, idx, className) {
  const block = collectJavaScriptClassBlock(lines, idx);
  return {
    symbolName: className,
    declarationLine: idx + 1,
    bodyPreview: Array.isArray(block && block.bodyPreview) ? block.bodyPreview : [],
  };
}

function describeJavaScriptClassTarget(className, metadata = {}, projectMemory = {}) {
  const normalizedName = String(className || '').toLowerCase();
  const bodyPreview = Array.isArray(metadata.bodyPreview) ? metadata.bodyPreview.join(' ').toLowerCase() : '';
  const projectEntity = String(projectMemory && projectMemory.entity || '').trim();

  if (/state|session|store/.test(normalizedName) || /(runtime|state|cache|socket|participant|client|message)/.test(bodyPreview)) {
    return projectEntity
      ? `Agrupa o estado e as dependencias compartilhadas de ${projectEntity}.`
      : `Agrupa o estado e as dependencias compartilhadas de ${className}.`;
  }
  if (/payload|event|message|response|request/.test(normalizedName) || /(payload|event|message|response|request)/.test(bodyPreview)) {
    return `Representa a estrutura principal usada pelo fluxo de ${className}.`;
  }
  return `Representa a responsabilidade principal de ${className}.`;
}

function hasJavaScriptClassDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    return isCommentLine(currentLine, '.js');
  }
  return false;
}

function parseJavaScriptVariableDocCandidate(rawLine, insideClass) {
  const line = String(stripInlineComment(rawLine, '.js') || '').trim();
  if (!line) {
    return null;
  }
  if (isDependencyDeclarationLine(line, '.js')) {
    return null;
  }
  if (/^(?:return|throw|if|for|while|switch|case|break|continue|import|export\s+\{|class|function)\b/.test(line)) {
    return null;
  }
  if (insideClass && /^(?:constructor|get|set|async)\b/.test(line)) {
    return null;
  }
  if (/[=(].*=>/.test(line)) {
    return null;
  }
  if (!/=/.test(line) && /\w+\s*\(/.test(line.replace(/^(?:export\s+)?(?:const|let|var|static|readonly)\s+/, ''))) {
    return null;
  }

  const assignmentMatch = line.match(/^(?:export\s+)?(?:(?:const|let|var|static|readonly)\s+)?(#?[A-Za-z_$][A-Za-z0-9_$]*)\s*(?::\s*([^=;]+))?(?:=\s*(.+?))?;?$/);
  if (!assignmentMatch) {
    return null;
  }

  const name = sanitizeIdentifier(String(assignmentMatch[1] || '').replace(/^#/, ''));
  const annotation = String(assignmentMatch[2] || '').trim();
  const rhs = String(assignmentMatch[3] || '').trim();
  if (!name || shouldSkipJavaScriptVariableDocCandidate(name, annotation, rhs, insideClass)) {
    return null;
  }

  if (!insideClass && !rhs) {
    return null;
  }

  return {
    name,
    annotation,
    rhs,
  };
}

function shouldSkipJavaScriptVariableDocCandidate(name, annotation, rhs, insideClass) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const typeSignal = `${String(annotation || '')} ${String(rhs || '')}`.toLowerCase();
  const trivialScalarNames = new Set(['id', 'name', 'title', 'label', 'value', 'count', 'total', 'status', 'host', 'port', 'path', 'url']);
  if (insideClass && trivialScalarNames.has(normalizedName) && /\b(?:string|number|boolean)\b/.test(typeSignal)) {
    return true;
  }
  if (/^(?:true|false|null|undefined|["'`].*["'`]|[0-9.]+)$/.test(String(rhs || '').trim()) && trivialScalarNames.has(normalizedName)) {
    return true;
  }
  return false;
}

function hasLeadingJavaScriptVariableDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^\s*(?:\/\/|\/\*\*|\*)\s*:/.test(trimmed)) {
      return false;
    }
    return isCommentLine(currentLine, '.js');
  }
  return false;
}

function buildJavaScriptVariableDocIssue(file, idx, rawLine, candidate, insideClass, options = {}) {
  const snippet = buildJavaScriptVariableDocumentationSnippet(rawLine, candidate, insideClass, options);
  if (!snippet) {
    return null;
  }

  return {
    file,
    line: idx + 1,
    severity: 'info',
    kind: 'variable_doc',
    message: `${insideClass ? 'Atributo' : 'Variavel'} '${candidate.name}' sem documentacao contextual`,
    suggestion: 'Adicione comentario curto explicando o papel desta variavel ou atributo no contrato atual.',
    snippet,
    metadata: {
      symbolName: candidate.name,
      annotation: candidate.annotation || '',
      rhs: candidate.rhs || '',
      insideClass: Boolean(insideClass),
      containerClassName: String(options.containerClassName || ''),
    },
  };
}

function buildJavaScriptVariableDocumentationSnippet(rawLine, candidate, insideClass, options = {}) {
  const fallback = buildMaintenanceComment(rawLine, '.js', [], {
    projectMemory: options.projectMemory,
  });
  if (fallback) {
    return fallback;
  }
  return `${lineIndentation(rawLine)}// ${describeJavaScriptVariableTarget(candidate, insideClass, options)}`;
}

function describeJavaScriptVariableTarget(candidate, insideClass, options = {}) {
  const normalizedName = String(candidate && candidate.name || '').toLowerCase();
  const humanizedName = humanizeIdentifier(candidate && candidate.name || 'valor').toLowerCase();
  const combined = `${String(candidate && candidate.annotation || '')} ${String(candidate && candidate.rhs || '')}`.toLowerCase();
  const projectEntity = String(options && options.projectMemory && options.projectMemory.entity || '').trim();

  if (/\b(state|runtime|cache|store)\b/.test(`${normalizedName} ${combined}`)) {
    return projectEntity
      ? `Mantem o estado compartilhado usado pelo fluxo de ${projectEntity}.`
      : 'Mantem o estado compartilhado usado pelo fluxo atual.';
  }
  if (/\b(payload|message|event|response|request)\b/.test(`${normalizedName} ${combined}`)) {
    return 'Agrupa os dados principais usados pela proxima etapa do fluxo.';
  }
  if (insideClass) {
    return `Mantem ${humanizedName} como parte do contrato interno da classe.`;
  }
  return `Prepara ${humanizedName} para a proxima etapa do fluxo.`;
}
function describePythonVariableTarget(candidate, insideClass, options = {}) {
  const name = String(candidate && candidate.name || '');
  const normalizedName = name.toLowerCase();
  const combinedType = `${String(candidate && candidate.annotation || '')} ${String(candidate && candidate.rhs || '')}`.toLowerCase();
  const projectEntity = String(options && options.projectMemory && options.projectMemory.entity || '').trim();

  if (/json.*dict|dict.*json/.test(normalizedName) || (/^json/.test(normalizedName) && /\bdict\b|\[/.test(combinedType))) {
    return 'Define o alias tipado usado nas cargas JSON deste modulo.';
  }
  if (/lock/.test(`${normalizedName} ${combinedType}`)) {
    return 'Sincroniza o acesso concorrente ao estado compartilhado.';
  }
  if (/sockets?_by_client_id|connections?_by_client_id/.test(normalizedName)) {
    return 'Agrupa as conexoes ativas indexadas por cliente.';
  }
  if (/(chat_)?state|runtime_state/.test(normalizedName)) {
    return 'Mantem o estado compartilhado usado pelo fluxo realtime.';
  }
  if (/room_ids?_by_client_id/.test(normalizedName)) {
    return 'Relaciona cada cliente as rooms em que participa.';
  }
  if (/payload|message|event/.test(normalizedName)) {
    return 'Concentra a carga recebida para validar e encaminhar a proxima etapa.';
  }
  if (/participant_ids?|client_ids?/.test(normalizedName)) {
    return 'Mantem os participantes afetados para notificar as conexoes corretas.';
  }
  if (/invite(_code)?/.test(normalizedName)) {
    return 'Mantem a referencia de convite usada para autorizar o fluxo protegido.';
  }
  if (/snapshot/.test(normalizedName)) {
    return 'Preserva uma visao serializada do estado para resposta ou broadcast.';
  }
  if (insideClass) {
    if (projectEntity) {
      return `Explicita ${humanizePythonVariableTarget(name)} como parte do contrato de ${projectEntity}.`;
    }
    return `Explicita ${humanizePythonVariableTarget(name)} como parte do contrato desta estrutura.`;
  }
  if (/^[A-Z][A-Za-z0-9_]*$/.test(name)) {
    return `Define o alias tipado associado a ${humanizePythonVariableTarget(name)} neste modulo.`;
  }
  return `Documenta ${humanizePythonVariableTarget(name)} para reduzir ambiguidade neste modulo.`;
}
function humanizePythonVariableTarget(name) {
  return String(name || 'valor')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseRubyClassLikeDeclaration(line) {
  const match = String(line || '').match(/^\s*(class|module)\s+([A-Z][A-Za-z0-9_:]*)\b/);
  if (!match || !match[2]) {
    return null;
  }
  return {
    kind: String(match[1] || '').trim().toLowerCase(),
    name: String(match[2] || '').trim(),
  };
}

function parseRubyMethodDeclaration(line) {
  const match = String(line || '').match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_?!]*|self\.[A-Za-z_][A-Za-z0-9_?!]*)/);
  return match && match[1] ? String(match[1] || '').trim() : '';
}

function countRubyBlockDelta(rawLine) {
  const line = String(stripInlineComment(rawLine, '.rb') || '').trim();
  if (!line || /^#/.test(line)) {
    return 0;
  }
  const openings = [
    /^\s*class\b/,
    /^\s*module\b/,
    /^\s*def\b/,
    /^\s*if\b/,
    /^\s*unless\b/,
    /^\s*case\b/,
    /^\s*begin\b/,
    /^\s*for\b/,
    /^\s*while\b/,
    /^\s*until\b/,
    /\bdo\b(?:\s*\|[^|]*\|)?\s*$/,
  ];
  const openDelta = openings.some((pattern) => pattern.test(line)) ? 1 : 0;
  const closeDelta = /^\s*end\b/.test(line) ? 1 : 0;
  return openDelta - closeDelta;
}

function collectRubyScopedBlock(lines, startIdx) {
  let depth = 1;
  let endIdx = startIdx;
  const bodyPreview = [];

  for (let idx = startIdx + 1; idx < lines.length && depth > 0; idx += 1) {
    const currentLine = String(lines[idx] || '');
    const trimmed = String(stripInlineComment(currentLine, '.rb') || '').trim();
    if (trimmed && !/^#/.test(trimmed) && bodyPreview.length < 6) {
      bodyPreview.push(trimmed);
    }
    depth += countRubyBlockDelta(currentLine);
    endIdx = idx;
  }

  return {
    endIdx,
    bodyPreview,
  };
}

function buildRubyClassIssueMetadata(lines, idx, declaration) {
  const block = collectRubyScopedBlock(lines, idx);
  return {
    symbolName: String(declaration && declaration.name || ''),
    declarationLine: idx + 1,
    enclosingClassName: '',
    bodyPreview: Array.isArray(block && block.bodyPreview) ? block.bodyPreview : [],
  };
}

function describeRubyClassTarget(declaration, metadata = {}, projectMemory = {}) {
  const className = String(declaration && declaration.name || '').split('::').pop() || 'estrutura';
  const normalizedName = humanizeIdentifier(className).toLowerCase();
  const bodyPreview = Array.isArray(metadata.bodyPreview) ? metadata.bodyPreview.join(' ').toLowerCase() : '';
  const projectEntity = String(projectMemory && projectMemory.entity || '').trim();

  if (/\b(state|runtime|cache|store|socket|participant|client|message)\b/.test(`${normalizedName} ${bodyPreview}`)) {
    return projectEntity
      ? `Agrupa o estado e as dependencias compartilhadas de ${projectEntity}.`
      : `Agrupa o estado e as dependencias compartilhadas de ${className}.`;
  }
  if (/\b(service|handler|builder|serializer|adapter)\b/.test(`${normalizedName} ${bodyPreview}`)) {
    return `Concentra a responsabilidade principal de ${className} no fluxo atual.`;
  }
  return declaration && declaration.kind === 'module'
    ? `Organiza o namespace e o contrato principal de ${className}.`
    : `Representa a responsabilidade principal de ${className}.`;
}

function hasRubyClassDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    return /^\s*#/.test(currentLine);
  }
  return false;
}

function collectRubyClassRanges(lines) {
  const ranges = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = parseRubyClassLikeDeclaration(lines[idx]);
    if (!declaration) {
      continue;
    }
    const block = collectRubyScopedBlock(lines, idx);
    ranges.push({
      startIdx: idx,
      endIdx: block.endIdx,
      name: declaration.name,
      kind: declaration.kind,
    });
    idx = block.endIdx;
  }
  return ranges;
}

function collectRubyMethodRanges(lines) {
  const ranges = [];
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = parseRubyMethodDeclaration(lines[idx]);
    if (!declaration) {
      continue;
    }
    const block = collectRubyScopedBlock(lines, idx);
    ranges.push({
      startIdx: idx,
      endIdx: block.endIdx,
      name: declaration,
    });
    idx = block.endIdx;
  }
  return ranges;
}

function findRubyContainingStructure(ranges, idx) {
  return (Array.isArray(ranges) ? ranges : []).find((range) => idx > range.startIdx && idx < range.endIdx) || null;
}

function checkRubyVariableDocs(lines, file, opts = {}) {
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);
  const classRanges = collectRubyClassRanges(lines);
  const methodRanges = collectRubyMethodRanges(lines);

  lines.forEach((rawLine, idx) => {
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (parseRubyClassLikeDeclaration(rawLine) || parseRubyMethodDeclaration(rawLine)) {
      return;
    }
    if (findRubyContainingStructure(methodRanges, idx)) {
      return;
    }

    const candidate = parseRubyVariableDocCandidate(rawLine);
    if (!candidate || hasLeadingRubyVariableDocumentation(lines, idx)) {
      return;
    }

    const container = findRubyContainingStructure(classRanges, idx);
    const insideClass = Boolean(container);
    if (!isRubyVariableDocTarget(candidate, insideClass)) {
      return;
    }

    issues.push(buildRubyVariableDocIssue(file, idx, rawLine, candidate, insideClass, {
      projectMemory,
      containerClassName: String(container && container.name || ''),
    }));
  });

  return issues;
}

function parseRubyVariableDocCandidate(rawLine) {
  const line = String(stripInlineComment(rawLine, '.rb') || '').trim();
  if (!line || /^(?:class|module|def|if|unless|elsif|else|case|when|begin|rescue|ensure|for|while|until|end|return)\b/.test(line)) {
    return null;
  }
  const assignmentMatch = line.match(/^(@@?[a-z_][A-Za-z0-9_]*|[A-Z][A-Za-z0-9_]*|[a-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (!assignmentMatch) {
    return null;
  }
  const name = String(assignmentMatch[1] || '').trim();
  const rhs = String(assignmentMatch[2] || '').trim();
  if (!name || shouldSkipRubyVariableDocCandidate(name, rhs)) {
    return null;
  }
  return {
    name,
    rhs,
  };
}

function shouldSkipRubyVariableDocCandidate(name, rhs) {
  const normalizedName = String(name || '').replace(/^@+/, '').toLowerCase();
  const normalizedRhs = String(rhs || '').trim().toLowerCase();
  if (/^(?:id|name|title|label|value|count|total|status|host|port|path|url)$/.test(normalizedName) && /^(?:true|false|nil|["'`].*["'`]|[0-9.]+)$/.test(normalizedRhs)) {
    return true;
  }
  return false;
}

function isRubyVariableDocTarget(candidate, insideClass) {
  const name = String(candidate && candidate.name || '');
  if (!name) {
    return false;
  }
  return insideClass || /^[A-Z]/.test(name);
}

function hasLeadingRubyVariableDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^\s*#\s*:/.test(trimmed)) {
      return false;
    }
    return /^\s*#/.test(currentLine);
  }
  return false;
}

function buildRubyVariableDocIssue(file, idx, rawLine, candidate, insideClass, options = {}) {
  return {
    file,
    line: idx + 1,
    severity: 'info',
    kind: 'variable_doc',
    message: `${insideClass ? 'Atributo' : 'Variavel'} '${candidate.name}' sem documentacao contextual`,
    suggestion: 'Adicione comentario curto explicando o papel desta variavel ou atributo no contrato Ruby atual.',
    snippet: `${lineIndentation(rawLine)}# ${describeRubyVariableTarget(candidate, insideClass, options)}`,
    metadata: {
      symbolName: candidate.name,
      rhs: candidate.rhs || '',
      insideClass: Boolean(insideClass),
      containerClassName: String(options.containerClassName || ''),
    },
  };
}

function describeRubyVariableTarget(candidate, insideClass, options = {}) {
  const name = String(candidate && candidate.name || '').replace(/^@+/, '');
  const humanizedName = humanizeIdentifier(name || 'valor').toLowerCase();
  const combined = `${String(candidate && candidate.rhs || '')} ${name}`.toLowerCase();
  const projectEntity = String(options && options.projectMemory && options.projectMemory.entity || '').trim();

  if (/\b(state|runtime|cache|store)\b/.test(combined)) {
    return projectEntity
      ? `Mantem o estado compartilhado usado pelo fluxo de ${projectEntity}.`
      : 'Mantem o estado compartilhado usado pelo fluxo atual.';
  }
  if (/\b(payload|message|event|response|request)\b/.test(combined)) {
    return 'Agrupa os dados principais usados pela proxima etapa do fluxo.';
  }
  if (insideClass) {
    return `Explicita ${humanizedName} como parte do contrato interno desta estrutura.`;
  }
  if (/^[A-Z]/.test(String(candidate && candidate.name || ''))) {
    return `Define a constante ${humanizedName} para sustentar o contrato principal deste arquivo.`;
  }
  return `Documenta ${humanizedName} para reduzir ambiguidade neste arquivo.`;
}

function checkLuaVariableDocs(lines, file, opts = {}) {
  const issues = [];
  const focusRange = opts.focusRange || null;
  const projectMemory = loadProjectMemory(file);

  lines.forEach((rawLine, idx) => {
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }
    const candidate = parseLuaVariableDocCandidate(rawLine);
    if (!candidate || hasLeadingLuaVariableDocumentation(lines, idx)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'variable_doc',
      message: `Variavel '${candidate.name}' sem documentacao contextual`,
      suggestion: 'Adicione comentario curto explicando o papel desta variavel no contrato Lua atual.',
      snippet: `${lineIndentation(rawLine)}-- ${describeLuaVariableTarget(candidate, { projectMemory })}`,
      metadata: {
        symbolName: candidate.name,
        rhs: candidate.rhs || '',
        insideClass: false,
        containerClassName: '',
      },
    });
  });

  return issues;
}

function parseLuaVariableDocCandidate(rawLine) {
  const line = String(stripInlineComment(rawLine, '.lua') || '').trim();
  if (!line || /^(?:function|local\s+function|if|for|while|repeat|until|return|end)\b/.test(line)) {
    return null;
  }
  const assignmentMatch = line.match(/^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*=\s*(.+)$/);
  if (!assignmentMatch) {
    return null;
  }
  const rawName = String(assignmentMatch[1] || '').trim();
  const rhs = String(assignmentMatch[2] || '').trim();
  const name = rawName.split('.').pop();
  if (!name || name === 'M' || /^(?:id|name|title|label|value|count|total|status)$/.test(name.toLowerCase()) && /^(?:true|false|nil|["'`].*["'`]|[0-9.]+)$/.test(rhs)) {
    return null;
  }
  return {
    name,
    rawName,
    rhs,
  };
}

function hasLeadingLuaVariableDocumentation(lines, idx) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^\s*--\s*:/.test(trimmed)) {
      return false;
    }
    return /^\s*--/.test(currentLine);
  }
  return false;
}

function describeLuaVariableTarget(candidate, options = {}) {
  const humanizedName = humanizeIdentifier(candidate && candidate.name || 'valor').toLowerCase();
  const combined = `${humanizeIdentifier(candidate && candidate.rawName || '')} ${String(candidate && candidate.rhs || '')}`.toLowerCase();
  const projectEntity = String(options && options.projectMemory && options.projectMemory.entity || '').trim();

  if (/\b(state|runtime|cache|store)\b/.test(combined)) {
    return projectEntity
      ? `Mantem o estado compartilhado usado pelo fluxo de ${projectEntity}.`
      : 'Mantem o estado compartilhado usado pelo fluxo atual.';
  }
  if (/\b(payload|message|event|response|request)\b/.test(combined)) {
    return 'Agrupa os dados principais usados pela proxima etapa do fluxo.';
  }
  return `Documenta ${humanizedName} para reduzir ambiguidade neste modulo Lua.`;
}
function buildFunctionIssueMetadata(lines, startIdx, declaration, ext) {
  const declarationEndIdx = resolveFunctionDeclarationEndIdx(lines, startIdx, ext);
  const bodyPreview = collectCrossLanguageFunctionBodyLines(lines, startIdx, ext)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    symbolName: declaration && declaration.name ? declaration.name : '',
    declarationStartLine: startIdx + 1,
    declarationEndLine: declarationEndIdx + 1,
    signaturePreview: lines.slice(startIdx, declarationEndIdx + 1).map((line) => String(line || '')),
    params: Array.isArray(declaration && declaration.params) ? declaration.params : [],
    paramDescriptors: Array.isArray(declaration && declaration.paramDescriptors) ? declaration.paramDescriptors : [],
    decorators: Array.isArray(declaration && declaration.decorators) ? declaration.decorators : [],
    decoratorStartLine: Number(declaration && declaration.decoratorStartIdx) >= 0 ? Number(declaration.decoratorStartIdx) + 1 : undefined,
    returnAnnotation: String(declaration && declaration.returnAnnotation || ''),
    returnExpression: inferCrossLanguageReturnExpression(bodyPreview, ext),
    bodyPreview,
    enclosingClassName: isPythonLikeExtension(ext) ? findEnclosingPythonClassName(lines, startIdx) : '',
  };
}
function resolveFunctionDeclarationEndIdx(lines, startIdx, ext) {
  if (isPythonLikeExtension(ext)) {
    const declaration = readPythonFunctionDeclaration(lines, startIdx);
    if (declaration) {
      return declaration.endIdx;
    }
  }
  return startIdx;
}
function buildPythonClassIssueMetadata(lines, idx, className) {
  const classBaseIndent = leadingIndentLength(lines[idx] || '');
  const classEndIdx = findPythonIndentedBlockEnd(lines, idx, classBaseIndent);
  const decoratorInfo = collectPythonLeadingDecorators(lines, idx);
  return {
    symbolName: className,
    declarationLine: idx + 1,
    decorators: decoratorInfo.decorators,
    decoratorStartLine: decoratorInfo.decoratorStartIdx + 1,
    bodyPreview: lines
      .slice(idx + 1, Math.min(classEndIdx + 1, idx + 7))
      .map((line) => String(line || '').trim())
      .filter(Boolean)
      .slice(0, 6),
  };
}
function describePythonClassTarget(className, metadata = {}, projectMemory = {}) {
  const normalizedName = String(className || '').toLowerCase();
  const bodyPreview = Array.isArray(metadata && metadata.bodyPreview) ? metadata.bodyPreview.join(' ').toLowerCase() : '';
  const projectEntity = String(projectMemory && projectMemory.entity || '').trim();

  if (/state|session/.test(normalizedName) || /(chat_state|runtime_state|lock|participant)/.test(bodyPreview)) {
    return projectEntity
      ? `Agrupa o estado e as dependencias compartilhadas de ${projectEntity}.`
      : `Agrupa o estado e as dependencias compartilhadas de ${className}.`;
  }
  if (/payload|message|event/.test(normalizedName) || /(payload|message|event)/.test(bodyPreview)) {
    return `Representa a carga validada usada pelo fluxo principal de ${className}.`;
  }
  return `Representa a responsabilidade principal de ${className}.`;
}
function buildFlowCommentIssueMetadata(lines, idx, ext) {
  const previousLine = findNearestMeaningfulLine(lines, idx, -1);
  const nextLine = findNearestMeaningfulLine(lines, idx, 1);
  return {
    currentStep: String(lines[idx] || '').trim(),
    previousStep: previousLine ? previousLine.text : '',
    nextStep: nextLine ? nextLine.text : '',
    enclosingClassName: isPythonLikeExtension(ext) ? findEnclosingPythonClassName(lines, idx) : '',
  };
}
function findNearestMeaningfulLine(lines, startIdx, direction) {
  const step = direction >= 0 ? 1 : -1;
  for (let idx = startIdx + step; idx >= 0 && idx < lines.length; idx += step) {
    const text = String(lines[idx] || '').trim();
    if (!text) {
      continue;
    }
    return {
      line: idx + 1,
      text,
    };
  }
  return null;
}
function findEnclosingPythonClassName(lines, idx) {
  const currentIndent = leadingIndentLength(lines[idx] || '');
  for (let cursor = idx; cursor >= 0; cursor -= 1) {
    const rawLine = String(lines[cursor] || '');
    const className = parsePythonClassDeclaration(rawLine);
    if (!className) {
      continue;
    }
    if (leadingIndentLength(rawLine) < currentIndent) {
      return className;
    }
  }
  return '';
}
function hasPythonClassDocumentation(lines, idx) {
  for (let cursor = idx + 1; cursor < lines.length; cursor += 1) {
    const trimmed = String(lines[cursor] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/^("""|''')/.test(trimmed)) {
      return true;
    }
    break;
  }

  const anchorIdx = collectPythonLeadingDecorators(lines, idx).decoratorStartIdx;
  for (let cursor = anchorIdx - 1; cursor >= 0; cursor -= 1) {
    const current = String(lines[cursor] || '');
    const trimmed = current.trim();
    if (!trimmed) {
      continue;
    }
    return isCommentLine(current, '.py');
  }

  return false;
}
function hasLeadingFlowComment(lines, idx, ext) {
  for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
    const currentLine = String(lines[cursor] || '');
    const trimmed = currentLine.trim();
    if (!trimmed) {
      continue;
    }
    if (/^(?:\/\/|#|--|")\s*:/.test(trimmed)) {
      return false;
    }
    return isCommentLine(currentLine, ext);
  }
  return false;
}
function checkFunctionMaintenanceComments(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const issues = [];
  const focusRange = opts.focusRange || null;
  lines.forEach((line, idx) => {
    const declaration = isElixirExtension(ext)
      ? parseFunctionDeclaration(line)
      : parseCrossLanguageFunctionDeclaration(line, ext);
    if (!declaration) {
      return;
    }
    if (!intersectsFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (isElixirExtension(ext) && ['def', 'defp'].includes(declaration.visibility) && hasFunctionDocAbove(lines, idx)) {
      return;
    }
    if (hasFunctionCommentAbove(lines, idx, ext)) {
      return;
    }
    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_comment',
      message: 'Funcao sem comentario de manutencao',
      suggestion: 'Descreva responsabilidade, entradas e saida esperada dessa funcao.',
      snippet: snippetFunctionComment(declaration.name, declaration.params, ext),
    });
  });
  return issues;
}
function hasFunctionCommentAbove(lines, idx, ext = '') {
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (isFunctionDeclarationLine(lines[i])) {
      return false;
    }
    const current = String(lines[i]).trim();
    if (!current) {
      continue;
    }
    if (/^\s*@doc\b/.test(lines[i]) || /^\s*@moduledoc\b/.test(lines[i]) || isCommentLine(lines[i], ext)) {
      return true;
    }
    return false;
  }
  return false;
}

function collectLeadingElixirAnnotationsAbove(lines, idx) {
  const annotations = {
    doc: false,
    moduledoc: false,
    spec: false,
  };

  for (let i = idx - 1; i >= 0; i -= 1) {
    const currentLine = String(lines[i] || '');
    const current = currentLine.trim();
    if (!current) {
      continue;
    }
    if (isFunctionDeclarationLine(currentLine)) {
      return annotations;
    }
    if (/^\s*#/.test(currentLine)) {
      continue;
    }
    if (/^\s*@spec\b/.test(currentLine)) {
      annotations.spec = true;
      continue;
    }
    if (/^\s*@doc\b/.test(currentLine)) {
      annotations.doc = true;
      continue;
    }
    if (/^\s*@moduledoc\b/.test(currentLine)) {
      annotations.moduledoc = true;
      continue;
    }
    if (/"""/.test(currentLine)) {
      for (let cursor = i - 1; cursor >= 0; cursor -= 1) {
        const blockLine = String(lines[cursor] || '');
        const blockTrimmed = blockLine.trim();
        if (!blockTrimmed) {
          continue;
        }
        if (/^\s*@doc\b/.test(blockLine)) {
          annotations.doc = true;
          i = cursor;
          break;
        }
        if (/^\s*@moduledoc\b/.test(blockLine)) {
          annotations.moduledoc = true;
          i = cursor;
          break;
        }
        if (isFunctionDeclarationLine(blockLine)) {
          return annotations;
        }
      }
      continue;
    }
    return annotations;
  }

  return annotations;
}

function checkFunctionSpecs(lines, file, opts = {}) {
  const ext = path.extname(file);
  if (!isElixirExtension(ext)) {
    return [];
  }

  const issues = [];
  const seenSignatures = new Set();
  const focusRange = opts.focusRange || null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = readElixirFunctionDeclaration(lines, idx);
    if (!declaration || declaration.visibility !== 'def') {
      continue;
    }
    if (!intersectsFocusRange(focusRange, idx + 1, declaration.endIdx + 1)) {
      idx = declaration.endIdx;
      continue;
    }

    const paramCount = Number.isInteger(declaration.paramArity)
      ? declaration.paramArity
      : declaration.params.length;
    const signatureKey = `${sanitizeIdentifier(declaration.name)}/${Math.max(0, paramCount)}`;
    if (seenSignatures.has(signatureKey)) {
      idx = declaration.endIdx;
      continue;
    }
    seenSignatures.add(signatureKey);

    const specParams = Array.from({ length: Math.max(0, paramCount) }, (_unused, index) =>
      declaration.params[index] || `arg${index + 1}`,
    );

    const annotationRange = resolveElixirFunctionSpecRangeForDeclaration(lines, idx, declaration);
    if (annotationRange) {
      if (isElixirFunctionSpecOutdated(annotationRange, declaration, lines)) {
        issues.push({
          file,
          line: annotationRange.startLine + 1,
          severity: 'warning',
          kind: 'function_spec',
          message: `Especificacao @spec desatualizada para ${declaration.name}`,
          suggestion: 'Atualize a assinatura da @spec para refletir a aridade da funcao.',
          snippet: snippetFunctionSpec(
            declaration.name,
            specParams,
            ext,
            inferFunctionSpecContext(lines, idx, declaration, ext),
          ),
          metadata: buildFunctionIssueMetadata(lines, idx, declaration, ext),
          action: {
            op: 'replace_range',
            range: {
              start: {
                line: annotationRange.startLine,
                character: 0,
              },
              end: {
                line: annotationRange.endLine + 1,
                character: 0,
              },
            },
          },
        });
      }
      idx = declaration.endIdx;
      continue;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_spec',
      message: `Especificacao @spec ausente para ${declaration.name}`,
      suggestion: 'Declare @spec para contrato da funcao e facilitar validação de dominio.',
      snippet: snippetFunctionSpec(
        declaration.name,
        specParams,
        ext,
        inferFunctionSpecContext(lines, idx, declaration, ext),
      ),
    });
    idx = declaration.endIdx;
  }
  return issues;
}
function hasFunctionSpecAbove(lines, idx, functionName) {
  const safeName = escapeRegExp(sanitizeIdentifier(functionName));
  if (!safeName) {
    return false;
  }
  const pattern = new RegExp(`^\\s*@spec\\s+${safeName}\\b`);
  const annotations = collectLeadingElixirAnnotationsAbove(lines, idx);
  if (!annotations.spec) {
    return false;
  }

  for (let i = idx - 1; i >= 0; i -= 1) {
    const currentLine = String(lines[i] || '');
    const current = currentLine.trim();
    if (!current) {
      continue;
    }
    if (isFunctionDeclarationLine(currentLine)) {
      return false;
    }
    if (pattern.test(current)) {
      return true;
    }
  }

  return false;
}
function collectFunctionBodyLines(lines, startIdx) {
  const declarationLine = String(lines[startIdx] || '');
  const inlineMatch = declarationLine.match(/\bdo:\s*(.+)$/);
  if (inlineMatch && inlineMatch[1]) {
    return [inlineMatch[1]];
  }

  const bodyLines = [];
  let depth = countBlockDelta(declarationLine);
  if (depth <= 0) {
    return bodyLines;
  }

  for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const delta = countBlockDelta(line);
    const closesCurrentBlock = depth === 1 && delta < 0 && /^end\b/.test(trimmed);
    if (!closesCurrentBlock) {
      bodyLines.push(line);
    }
    depth += delta;
  }

  return bodyLines;
}
function lastMeaningfulBodyLine(bodyLines) {
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const trimmed = String(bodyLines[index] || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    return trimmed;
  }
  return '';
}
function inferFunctionSpecContext(lines, startIdx, declaration, ext) {
  if (!['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
    return {};
  }

  const bodyLines = collectFunctionBodyLines(lines, startIdx);
  const bodyText = bodyLines.join('\n');
  return {
    returnType: inferElixirReturnType(bodyText, bodyLines),
    paramTypes: inferElixirParamTypes(bodyText, declaration.params),
  };
}
function inferElixirParamTypes(bodyText, params) {
  const safeParams = Array.isArray(params) ? params : [];
  return safeParams.map((param) => {
    const safeParam = escapeRegExp(String(param || ''));
    if (!safeParam) {
      return 'term()';
    }
    if (new RegExp(`\\b${safeParam}\\b\\s*\\.\\.|\\.\\.\\s*\\b${safeParam}\\b`).test(bodyText)) {
      return 'integer()';
    }
    return 'term()';
  });
}
function inferElixirReturnType(bodyText, bodyLines) {
  const lastLine = lastMeaningfulBodyLine(bodyLines);

  const diceMatch = bodyText.match(/\bEnum\.random\(\s*1\s*\.\.\s*(\d+)\s*\)/);
  if (diceMatch) {
    return 'integer()';
  }
  if (/\bEnum\.map\(/.test(bodyText) || /^\s*\[.*\]\s*$/.test(lastLine)) {
    return 'list(any())';
  }
  if (/^\s*(true|false)\s*$/.test(lastLine)) {
    return 'boolean()';
  }
  if (/^\s*".*"\s*$/.test(lastLine)) {
    return 'String.t()';
  }
  if (/^\s*%{/.test(lastLine)) {
    return 'map()';
  }
  if (/^\s*\{:ok,/.test(lastLine) || /^\s*\{:error,/.test(lastLine)) {
    return '{:ok, term()} | {:error, term()}';
  }
  if (/^\s*\d+\s*$/.test(lastLine)) {
    return 'integer()';
  }
  return 'term()';
}
function inferFunctionDocContext(lines, startIdx, declaration, ext) {
  if (!['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
    return {};
  }

  const bodyLines = collectFunctionBodyLines(lines, startIdx);
  const bodyText = bodyLines.join('\n');
  const diceMatch = bodyText.match(/\bEnum\.random\(\s*1\s*\.\.\s*(\d+)\s*\)/);
  if (diceMatch) {
    return {
      summary: `Retorna um valor aleatorio entre 1 e ${diceMatch[1]} simulando a rolagem de um dado.`,
      action: 'Gera um valor aleatorio dentro do intervalo configurado para a rolagem.',
      returnDescription: `Retorna um numero inteiro entre 1 e ${diceMatch[1]}.`,
      ext,
      specSignature: snippetFunctionSpec(
        declaration.name,
        declaration.params,
        ext,
        inferFunctionSpecContext(lines, startIdx, declaration, ext),
      ),
    };
  }

  if (/\bEnum\.map\(/.test(bodyText)) {
    return {
      summary: `Transforma os dados de entrada aplicando a regra principal de ${declaration.name}.`,
      action: 'Percorre a colecao e aplica a transformacao definida para cada elemento.',
      returnDescription: 'Retorna uma lista com os resultados transformados.',
      ext,
      specSignature: snippetFunctionSpec(
        declaration.name,
        declaration.params,
        ext,
        inferFunctionSpecContext(lines, startIdx, declaration, ext),
      ),
    };
  }

  return {
    ext,
    specSignature: snippetFunctionSpec(
      declaration.name,
      declaration.params,
      ext,
      inferFunctionSpecContext(lines, startIdx, declaration, ext),
    ),
  };
}
function hasFunctionDocAbove(lines, idx) {
  const annotations = collectLeadingElixirAnnotationsAbove(lines, idx);
  return annotations.doc;
}
function isFunctionDeclarationLine(line) {
  const cleaned = String(line || '').trim();
  if (!cleaned) {
    return false;
  }
  return Boolean(parseFunctionDeclaration(line)) || /^defmodule\s+/.test(cleaned) || /^def(?:\b|p\b)/.test(cleaned);
}
function checkNestedConditionDepth(lines, file) {
  const openers = /\b(if|cond|case|with|for|unless)\b/g;
  const closer = /^\s*end\b/;
  let depth = 0;
  let maxDepth = 0;
  const byLine = {};
  lines.forEach((line, idx) => {
    const clean = removeInlineComment(line);
    const opens = countMatches(openers, clean);
    const ends = closer.test(clean) ? 1 : 0;
    const newDepth = depth + opens;
    if (newDepth > maxDepth) {
      maxDepth = newDepth;
    }
    byLine[idx + 1] = newDepth;
    depth = Math.max(newDepth - ends, 0);
  });
  if (maxDepth <= 4) {
    return [];
  }
  const deepLine = Object.entries(byLine).find(([, depthByLine]) => depthByLine === maxDepth);
  return [{
    file,
    line: Number(deepLine ? deepLine[0] : 1),
    severity: 'warning',
    kind: 'nested_condition',
    message: `Aninhamento alto de controle (profundidade ${maxDepth})`,
    suggestion: 'Quebre logica complexa em funcoes pequenas e funcoes auxiliares com nomes de dominio.',
    snippet: snippetNestedCondition(),
  }];
}
function checkTrailingWhitespace(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.trimEnd() !== line) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'trailing_whitespace',
        message: 'Espaco em branco no final da linha',
        suggestion: 'Remova espaco para reduzir ruido em diff e conflitos em revisoes.',
        snippet: snippetTrailingWhitespace(line),
      });
    }
  });
  return issues;
}
function checkTabs(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.includes('\t')) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'tabs',
        message: 'Caracter de tab encontrado',
        suggestion: 'Use somente espacos para manter layout consistente com o formatter.',
        snippet: snippetTabs(line),
      });
    }
  });
  return issues;
}
function checkLargeFile(lines, file) {
  if (lines.length > 300) {
    return [{
      file,
      line: 1,
      severity: 'warning',
      kind: 'large_file',
      message: `Arquivo com ${lines.length} linhas`,
      suggestion: 'Considere separar responsabilidades em modulos menores.',
      snippet: snippetLargeFile(),
    }];
  }
  return [];
}
function suggestSimilarIdentifier(undefinedName, candidates) {
  const normalized = String(undefinedName).trim();
  const normalizedLen = normalized.length;
  const unknown = normalized.toLowerCase();
  const maxDistance = normalizedLen <= 4 ? 2 : normalizedLen <= 7 ? 3 : 4;
  const candidateScores = candidates
    .filter(Boolean)
    .filter((candidate, index, arr) => arr.indexOf(candidate) === index)
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = levenshteinDistance(unknown, normalizedCandidate);
      const collapsedUnknown = collapseRepeatedChars(unknown);
      const collapsedCandidate = collapseRepeatedChars(normalizedCandidate);
      const collapsedDistance = levenshteinDistance(collapsedUnknown, collapsedCandidate);
      const isSubseq = isSubsequence(normalizedCandidate, unknown) || isSubsequence(unknown, normalizedCandidate);
      const firstCharBonus = !normalizedCandidate || unknown[0] !== normalizedCandidate[0] ? 1 : 0;
      const lengthDelta = Math.abs(normalizedCandidate.length - normalizedLen);
      const isRelevant = distance <= maxDistance || collapsedDistance <= 1 || isSubseq;
      return { candidate, distance, collapsedDistance, firstCharBonus, lengthDelta, isSubseq, isRelevant };
    })
    .filter((entry) => entry.isRelevant && entry.distance > 0);

  const strictCandidates = candidateScores.filter((entry) => entry.firstCharBonus === 0);
  const bestPool = strictCandidates.length > 0 ? strictCandidates : candidateScores;
  const finalPool = bestPool.filter((entry) => entry.lengthDelta <= 3);
  const subseqPool = bestPool.filter((entry) => entry.isSubseq && entry.lengthDelta > 3);
  if (subseqPool.length === 0 && finalPool.length === 0) {
    const firstCharMatch = bestPool.filter((entry) => !entry.firstCharBonus && entry.lengthDelta <= 8);
    if (firstCharMatch.length === 1) {
      return firstCharMatch[0].candidate;
    }
    if (firstCharMatch.length > 1) {
      firstCharMatch.sort((a, b) => a.lengthDelta - b.lengthDelta);
      return firstCharMatch[0].candidate;
    }
  }
  if (subseqPool.length > 0) {
    subseqPool.sort((a, b) => a.lengthDelta - b.lengthDelta);
    return subseqPool[0].candidate;
  }
  if (finalPool.length === 0) {
    return null;
  }
  finalPool.sort((a, b) => {
    const scoreA = (a.distance * 10) + (a.collapsedDistance * 4) + (a.firstCharBonus * 2) + (a.lengthDelta * 2) + (a.isSubseq ? 0 : 3);
    const scoreB = (b.distance * 10) + (b.collapsedDistance * 4) + (b.firstCharBonus * 2) + (b.lengthDelta * 2) + (b.isSubseq ? 0 : 3);
    return scoreA - scoreB;
  });
  return finalPool[0].candidate;
}
function levenshteinDistance(a, b) {
  const aRunes = [...a];
  const bRunes = [...b];
  let previous = Array.from({ length: bRunes.length + 1 }, (_, idx) => idx);
  let current = [];
  for (let i = 0; i < aRunes.length; i += 1) {
    current = [i + 1];
    for (let j = 0; j < bRunes.length; j += 1) {
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      const substitution = previous[j] + (aRunes[i] === bRunes[j] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[previous.length - 1];
}
function collapseRepeatedChars(value) {
  const chars = String(value || '').toLowerCase();
  if (!chars) {
    return '';
  }
  return chars.split('').filter((char, index, list) => index === 0 || char !== list[index - 1]).join('');
}
function isSubsequence(target, source) {
  if (target.length === 0) {
    return true;
  }
  if (target.length > source.length) {
    return false;
  }
  let i = 0;
  let j = 0;
  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      j += 1;
    }
    i += 1;
  }
  return j === target.length;
}

function analysisFileKind(file) {
  const source = String(file || '');
  const base = path.basename(source).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return '.dockerfile';
  }
  return path.extname(source).toLowerCase();
}
function isStructuredTextKind(kind) {
  return resolveStructuredTextKind(kind);
}
function checkStructuredTextIssues(lines, file, kind, maxLineLength) {
  const issues = [];
  if (kind !== '.md') {
    issues.push(...checkLongLines(lines, file, maxLineLength));
  }
  issues.push(
    ...checkTodoFixme(lines, file),
    ...checkCommentTask(lines, file),
    ...checkSyntaxIssues(lines, file, kind),
    ...checkUnitTestCoverage(lines, file),
    ...checkTrailingWhitespace(lines, file),
    ...checkTabs(lines, file),
  );
  if (kind === '.md') {
    issues.push(...checkMarkdownTitle(lines, file));
  }
  if (kind === '.tf') {
    issues.push(...checkTerraformRequiredVersion(lines, file));
  }
  if (kind === '.dockerfile') {
    issues.push(...checkDockerfileWorkdir(lines, file));
  }
  return issues;
}
function checkMarkdownTitle(lines, file) {
  const firstNonEmpty = lines.findIndex((line) => String(line || '').trim().length > 0);
  if (firstNonEmpty < 0) {
    return [];
  }
  if (/^#\s+\S/.test(String(lines[firstNonEmpty] || '').trim())) {
    return [];
  }
  return [
    {
      file,
      line: firstNonEmpty + 1,
      severity: 'info',
      kind: 'markdown_title',
      message: 'Documento Markdown sem titulo principal',
      suggestion: 'Adicione um H1 para explicitar o objetivo do documento.',
      snippet: '# Titulo do documento',
    },
  ];
}
function checkTerraformRequiredVersion(lines, file) {
  const terraformLine = lines.findIndex((line) => /^\s*terraform\s*{/.test(String(line || '')));
  const hasRequiredVersion = lines.some((line) => /required_version\s*=/.test(String(line || '')));
  const hasTerraformContent = lines.some((line) => /^\s*(resource|data|module|provider|variable|output|locals)\b/.test(String(line || '')));
  if (!hasTerraformContent || hasRequiredVersion) {
    return [];
  }
  if (terraformLine >= 0) {
    return [
      {
        file,
        line: terraformLine + 1,
        severity: 'info',
        kind: 'terraform_required_version',
        message: 'Bloco Terraform sem required_version',
        suggestion: 'Declare a versao minima do Terraform para reduzir drift entre ambientes.',
        snippet: '  required_version = ">= 1.5.0"',
        action: { op: 'insert_after', dedupeLookahead: 6 },
      },
    ];
  }
  return [
    {
      file,
      line: 1,
      severity: 'info',
      kind: 'terraform_required_version',
      message: 'Arquivo Terraform sem bloco de versao declarada',
      suggestion: 'Defina required_version para estabilizar o comportamento entre ambientes.',
      snippet: ['terraform {', '  required_version = ">= 1.5.0"', '}'].join('\n'),
    },
  ];
}
function checkDockerfileWorkdir(lines, file) {
  const fromLine = lines.findIndex((line) => /^\s*FROM\b/i.test(String(line || '')));
  const hasWorkdir = lines.some((line) => /^\s*WORKDIR\b/i.test(String(line || '')));
  if (fromLine < 0 || hasWorkdir) {
    return [];
  }
  return [
    {
      file,
      line: fromLine + 1,
      severity: 'info',
      kind: 'dockerfile_workdir',
      message: 'Dockerfile sem WORKDIR explicito',
      suggestion: 'Defina WORKDIR para estabilizar o contexto de copia e execucao.',
      snippet: 'WORKDIR /app',
      action: { op: 'insert_after', dedupeLookahead: 6 },
    },
  ];
}
function checkSyntaxIssues(lines, file, kind) {
  const syntaxScan = scanSyntaxStructure(lines, kind);
  return [
    ...checkMarkdownFenceIssues(lines, file, kind),
    ...syntaxScan.issues.map((issue) => ({ ...issue, file })),
    ...checkElixirBlockDelimiterIssues(lines, file, kind),
    ...checkElixirMalformedEndKeywordIssues(lines, file, kind),
    ...checkElixirUnexpectedStandaloneTokenIssues(lines, file, kind),
    ...checkMissingCommaIssues(lines, file, kind, syntaxScan.collectionContexts),
  ];
}
function checkMarkdownFenceIssues(lines, file, kind) {
  if (kind !== '.md') {
    return [];
  }

  let openFence = null;
  lines.forEach((line, index) => {
    const trimmed = String(line || '').trim();
    const match = trimmed.match(/^(```+|~~~+)(.*)$/);
    if (!match) {
      return;
    }
    if (!openFence) {
      openFence = { marker: match[1], line: index + 1 };
      return;
    }
    if (match[1][0] === openFence.marker[0] && match[1].length >= openFence.marker.length) {
      openFence = null;
    }
  });

  if (!openFence) {
    return [];
  }

  return [
    {
      file,
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: 'Bloco Markdown sem fence de fechamento',
      suggestion: `Feche o bloco com ${openFence.marker} para restaurar a estrutura do documento.`,
      snippet: openFence.marker,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    },
  ];
}
function scanSyntaxStructure(lines, kind) {
  const issues = [];
  const stack = [];
  const collectionContexts = [];
  let inBlockComment = false;
  let tripleQuote = '';
  let tripleQuoteLine = 0;
  const quoteIssuesByLine = new Set();
  const extraDelimiterIssuesByLine = new Set();
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    let activeCollection = '';
    for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
      const candidate = stack[stackIndex];
      if (candidate.context === 'array' || candidate.context === 'object') {
        activeCollection = candidate.context;
        break;
      }
    }
    collectionContexts[index] = activeCollection;

    let inQuote = '';
    for (let cursor = 0; cursor < line.length; cursor += 1) {
      const current = line[cursor];
      const next = line[cursor + 1] || '';
      const prev = cursor > 0 ? line[cursor - 1] : '';

      if (tripleQuote) {
        if (line.slice(cursor, cursor + 3) === tripleQuote) {
          tripleQuote = '';
          cursor += 2;
        }
        continue;
      }

      if (inBlockComment) {
        if (current === '*' && next === '/') {
          inBlockComment = false;
          cursor += 1;
        }
        continue;
      }

      if (inQuote) {
        if (current === '\\') {
          cursor += 1;
          continue;
        }
        if (current === inQuote && prev !== '\\') {
          inQuote = '';
        }
        continue;
      }

      if ((isPythonLikeExtension(kind) || isElixirExtension(kind)) && (line.slice(cursor, cursor + 3) === '"""' || line.slice(cursor, cursor + 3) === "'''")) {
        tripleQuote = line.slice(cursor, cursor + 3);
        tripleQuoteLine = index + 1;
        cursor += 2;
        continue;
      }

      if (supportsSlashComments(kind) && current === '/' && next === '*') {
        inBlockComment = true;
        cursor += 1;
        continue;
      }
      if (startsInlineComment(line, cursor, kind)) {
        break;
      }

      if (current === '"' || current === '\'') {
        inQuote = current;
        continue;
      }

      if (isOpeningDelimiter(current)) {
        stack.push({
          char: current,
          line: index + 1,
          col: cursor + 1,
          indent: lineIndentation(line),
          context: inferDelimiterContext(line, cursor, kind, current),
        });
        continue;
      }

      if (isClosingDelimiter(current)) {
        if (stack.length > 0 && matchingDelimiter(stack[stack.length - 1].char) === current) {
          stack.pop();
          continue;
        }

        if (!extraDelimiterIssuesByLine.has(index + 1)) {
          issues.push({
            line: index + 1,
            severity: 'error',
            kind: 'syntax_extra_delimiter',
            message: `Delimitador '${current}' sem abertura correspondente`,
            suggestion: `Remova '${current}' para reequilibrar a estrutura do arquivo.`,
            snippet: line.slice(0, cursor) + line.slice(cursor + 1),
            action: { op: 'replace_line' },
          });
          extraDelimiterIssuesByLine.add(index + 1);
        }
      }
    }

    if (inQuote && !quoteIssuesByLine.has(index + 1) && shouldAutoCloseQuote(line, kind)) {
      issues.push({
        line: index + 1,
        severity: 'error',
        kind: 'syntax_missing_quote',
        message: `Aspa '${inQuote}' sem fechamento`,
        suggestion: `Feche a aspa '${inQuote}' para restaurar a sintaxe da linha.`,
        snippet: line + inQuote,
        action: { op: 'replace_line' },
      });
      quoteIssuesByLine.add(index + 1);
    }
  });

  if (tripleQuote) {
    issues.push({
      line: lines.length > 0 ? lines.length : tripleQuoteLine || 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `String multilinha ${tripleQuote} sem fechamento`,
      suggestion: `Feche a string com ${tripleQuote} para restaurar a estrutura do arquivo.`,
      snippet: tripleQuote,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  if (stack.length > 0) {
    const snippet = stack.slice().reverse().map((entry) => `${entry.indent}${matchingDelimiter(entry.char)}`).join('\n');
    const pending = stack.slice().reverse().map((entry) => matchingDelimiter(entry.char)).join(' ');
    issues.push({
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `Delimitadores pendentes sem fechamento: ${pending}`,
      suggestion: 'Feche os delimitadores abertos para restaurar a estrutura do arquivo.',
      snippet,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  return { issues, collectionContexts };
}
function checkMissingCommaIssues(lines, file, kind, collectionContexts) {
  if (!supportsAutomaticCommaFix(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const context = collectionContexts[index];
    if (context !== 'object' && context !== 'array') {
      continue;
    }

    const currentLine = String(lines[index] || '');
    const currentTrimmed = syntaxRelevantLine(currentLine, kind).trim();
    if (!currentTrimmed || currentTrimmed.endsWith(',')) {
      continue;
    }
    if (/[([{,:\\]$/.test(currentTrimmed) || /(?:=>|->)$/.test(currentTrimmed)) {
      continue;
    }

    const nextCandidate = findNextSyntaxLine(lines, index + 1, kind);
    if (!nextCandidate) {
      continue;
    }

    const nextTrimmed = nextCandidate.trimmed;
    if (!nextTrimmed || /^[\]\})]/.test(nextTrimmed)) {
      continue;
    }
    if (kind === '.py' && /^(?:for|if)\b/.test(nextTrimmed)) {
      continue;
    }

    if (context === 'object') {
      if (!looksLikeObjectEntry(currentTrimmed, kind) || !looksLikeObjectEntry(nextTrimmed, kind)) {
        continue;
      }
    } else if (!looksLikeArrayEntry(currentTrimmed) || !looksLikeArrayEntry(nextTrimmed)) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_missing_comma',
      message: 'Virgula ausente entre itens consecutivos',
      suggestion: 'Adicione virgula ao fim da linha para separar os itens corretamente.',
      snippet: `${currentLine},`,
      action: { op: 'replace_line' },
    });
  }

  return issues;
}

function checkElixirBlockDelimiterIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  let inTripleQuote = '';
  let pendingBlocks = 0;
  let lastOpenIndent = '';

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const strippedInline = String(stripInlineComment(rawLine, kind) || '');
    if (!strippedInline.trim()) {
      continue;
    }

    let structural = strippedInline;

    if (inTripleQuote) {
      const closeIndex = structural.indexOf(inTripleQuote);
      if (closeIndex < 0) {
        continue;
      }
      structural = structural.slice(closeIndex + 3);
      inTripleQuote = '';
    }

    while (true) {
      const tripleMatch = structural.match(/("""|''')/);
      if (!tripleMatch || !tripleMatch[1]) {
        break;
      }
      const delimiter = String(tripleMatch[1] || '');
      const start = Number(tripleMatch.index || 0);
      const afterStart = structural.slice(start + delimiter.length);
      const closeRelativeIndex = afterStart.indexOf(delimiter);
      if (closeRelativeIndex < 0) {
        structural = structural.slice(0, start);
        inTripleQuote = delimiter;
        break;
      }
      structural = structural.slice(0, start) + afterStart.slice(closeRelativeIndex + delimiter.length);
    }

    if (!structural.trim()) {
      continue;
    }

    const neutralized = structural
      .replace(/"(?:\\.|[^"\\])*"/g, '')
      .replace(/'(?:\\.|[^'\\])*'/g, '');
    const normalizedTrimmed = neutralized.trim();
    if (looksLikeMalformedElixirEndToken(normalizedTrimmed)) {
      pendingBlocks = Math.max(0, pendingBlocks - 1);
      continue;
    }
    const delta = countBlockDelta(neutralized);
    if (delta > 0) {
      pendingBlocks += delta;
      lastOpenIndent = lineIndentation(rawLine);
      continue;
    }
    if (delta < 0) {
      pendingBlocks = Math.max(0, pendingBlocks + delta);
    }
  }

  if (pendingBlocks <= 0) {
    return [];
  }

  const snippet = Array.from({ length: pendingBlocks }, () => `${lastOpenIndent}end`).join('\n');
  return [{
    file,
    line: lines.length > 0 ? lines.length : 1,
    severity: 'error',
    kind: 'syntax_missing_delimiter',
    message: `Blocos do/end pendentes sem fechamento: ${pendingBlocks}`,
    suggestion: 'Adicione end para fechar os blocos abertos e restaurar a sintaxe do modulo.',
    snippet,
    action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
  }];
}

function checkElixirMalformedEndKeywordIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const meaningful = syntaxRelevantLine(rawLine, kind).trim();
    if (!looksLikeMalformedElixirEndToken(meaningful)) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_malformed_keyword',
      message: `Keyword 'end' malformada: '${meaningful}'`,
      suggestion: "Substitua pela keyword correta 'end' para fechar o bloco.",
      snippet: `${lineIndentation(rawLine)}end`,
      action: { op: 'replace_line' },
    });
  }
  return issues;
}

function looksLikeMalformedElixirEndToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized || normalized === 'end') {
    return false;
  }
  if (!/^[a-z]+$/.test(normalized)) {
    return false;
  }
  if (normalized.length < 3 || normalized.length > 5) {
    return false;
  }
  if (!normalized.includes('e') || !normalized.includes('n') || !normalized.includes('d')) {
    return false;
  }
  return levenshteinDistance(normalized, 'end') <= 1;
}

function levenshteinDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + substitutionCost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function checkElixirUnexpectedStandaloneTokenIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const trimmed = syntaxRelevantLine(rawLine, kind).trim();
    if (!/^[A-Z][A-Za-z0-9_?!]{0,23}$/.test(trimmed)) {
      continue;
    }

    const previous = findPreviousSyntaxLine(lines, index - 1, kind);
    const next = findNextSyntaxLine(lines, index + 1, kind);
    if (!next || !/^end\b/.test(next.trimmed)) {
      continue;
    }
    if (!previous) {
      continue;
    }

    const previousTrimmed = previous.trimmed;
    if (
      /(?:\bdo|\bfn|\bdefp?\b|\bdefmodule\b|\bcase\b|\bcond\b|\bwith\b)\s*$/.test(previousTrimmed)
      || /,$/.test(previousTrimmed)
      || /(?:\b(alias|import|require|use)\s+.+)$/.test(previousTrimmed)
    ) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_unexpected_token',
      message: `Token inesperado '${trimmed}' em linha isolada`,
      suggestion: `Remova o token '${trimmed}' para restaurar a sintaxe do bloco.`,
      snippet: lineIndentation(rawLine),
      action: { op: 'replace_line' },
    });
  }

  return issues;
}

function supportsAutomaticCommaFix(kind) {
  return ['.js', '.jsx', '.ts', '.tsx', '.lua', '.py', '.rb', '.rs', '.ex', '.exs'].includes(kind);
}
function syntaxRelevantLine(line, kind) {
  return String(stripInlineComment(String(line || ''), kind) || '');
}
function findNextSyntaxLine(lines, startIndex, kind) {
  for (let index = startIndex; index < lines.length; index += 1) {
    const trimmed = syntaxRelevantLine(lines[index], kind).trim();
    if (trimmed) {
      return { index, trimmed };
    }
  }
  return null;
}

function findPreviousSyntaxLine(lines, startIndex, kind) {
  for (let index = startIndex; index >= 0; index -= 1) {
    const trimmed = syntaxRelevantLine(lines[index], kind).trim();
    if (trimmed) {
      return { index, trimmed };
    }
  }
  return null;
}
function looksLikeObjectEntry(trimmed, kind) {
  if (kind === '.lua') {
    return /^(?:[A-Za-z_][A-Za-z0-9_]*\s*=|\[[^\]]+\]\s*=).+/.test(trimmed);
  }
  return /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|["'][^"']+["']|\[[^\]]+\])\s*:\s*.+$/.test(trimmed);
}
function looksLikeArrayEntry(trimmed) {
  return /^(?:["'{\[]|[+-]?\d|true\b|false\b|null\b|nil\b|[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^)]*\))?)/.test(trimmed);
}
function shouldAutoCloseQuote(line, kind) {
  if (kind === '.md') {
    return false;
  }
  return !String(line || '').trimEnd().endsWith('\\');
}
function startsInlineComment(line, cursor, kind) {
  const current = line[cursor];
  const next = line[cursor + 1] || '';
  const prev = cursor > 0 ? line[cursor - 1] : '';

  if (supportsSlashComments(kind)) {
    return current === '/' && next === '/';
  }
  if (supportsHashComments(kind) || kind === '.tf') {
    return current === '#';
  }
  if (kind === '.lua') {
    return current === '-' && next === '-';
  }
  if (kind === '.vim') {
    return current === '"' && (cursor === 0 || /\s/.test(prev));
  }
  if (kind === '.md') {
    return line.slice(cursor, cursor + 4) === '<!--';
  }
  return false;
}
function isOpeningDelimiter(char) {
  return char === '(' || char === '[' || char === '{';
}
function isClosingDelimiter(char) {
  return char === ')' || char === ']' || char === '}';
}
function matchingDelimiter(char) {
  return {
    '(': ')',
    '[': ']',
    '{': '}',
  }[char] || '';
}
function inferDelimiterContext(line, cursor, kind, delimiter) {
  if (delimiter === '[') {
    return 'array';
  }
  if (delimiter === '(') {
    return 'paren';
  }
  if (delimiter !== '{') {
    return 'block';
  }

  if (['.tf', '.yaml', '.yml'].includes(kind)) {
    return 'object';
  }

  const prefix = String(line || '').slice(0, cursor).trimEnd();
  if (!prefix) {
    return 'object';
  }
  if (/\b(?:if|for|while|switch|catch|else|try|finally|do|fn|function|class|struct|enum|impl)\b[^{]*$/.test(prefix)) {
    return 'block';
  }
  if (/(?:=|:|=>|\(|\[|,|\breturn|\bcase)\s*$/.test(prefix)) {
    return 'object';
  }
  if (/\)\s*$/.test(prefix)) {
    return 'block';
  }
  return 'object';
}
module.exports = {
  analyzeText,
};
