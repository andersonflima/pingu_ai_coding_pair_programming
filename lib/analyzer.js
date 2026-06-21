'use strict';

const crypto = require('crypto');
const path = require('path');
const { checkCommonDeveloperErrors } = require('./analyzer-developer-errors');
const { checkLogicErrors } = require('./analyzer-logic-errors');
const { checkCommonTypos } = require('./analyzer-typos');
const { checkControlFlowSmells } = require('./analyzer-control-flow');
const { checkMissingAwait, checkAwaitInLoop } = require('./analyzer-async');
const { checkPythonNamingHazards } = require('./analyzer-python-naming');
const { checkRedundantConstructs } = require('./analyzer-redundant');
const { checkFunctionalReassignment, checkNestedConditionDepth } = require('./analyzer-complexity');
const { checkUndefinedVariables } = require('./analyzer-undefined-variables');
const { readElixirFunctionDeclaration, parseFunctionDeclaration } = require('./function-signature');
const { isFunctionDeclarationLine, collectFunctionBodyLines } = require('./function-body');
const { collectJavaScriptExportNames } = require('./analyzer-module-resolution');
const {
  readPythonFunctionDeclaration,
  parsePythonClassDeclaration,
  collectPythonLeadingDecorators,
  parseGenericParamDescriptors,
} = require('./python-signature');
const {
  buildFunctionIssueMetadata,
  collectCrossLanguageFunctionBodyLines,
  findEnclosingPythonClassName,
  inferCrossLanguageReturnExpression,
} = require('./function-metadata');
const {
  resolveElixirAnnotationRange,
  buildElixirAnnotationRangeLines,
  isElixirFunctionDocOutdated,
  collectLeadingElixirAnnotationsAbove,
  checkFunctionSpecs,
  inferFunctionSpecContext,
} = require('./analyzer-elixir-doc-spec');
const {
  checkMarkdownTitle,
  checkTerraformRequiredVersion,
  checkDockerfileWorkdir,
} = require('./analyzer-structured-text');
const { checkUnusedImports, checkUnusedVariables } = require('./analyzer-unused');
const {
  checkModuledoc,
  checkLongLines,
  checkDebugOutputs,
  checkTodoFixme,
  checkDuplicateConsecutiveLines,
  checkTrailingWhitespace,
  checkTabs,
  checkLargeFile,
} = require('./analyzer-hygiene');
const {
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
const { snippetFunctionDoc, snippetFunctionComment, snippetFunctionSpec, sanitizeIdentifier, countMatches, buildMaintenanceComment, isDependencyDeclarationLine, isCommentLine, lineIndentation, stripInlineComment, humanizeIdentifier, leadingIndentLength, isJavaScriptControlKeyword } = require('./support');
const { sanitizeScopedAnalysisLine, stripPythonMultilineStringContent } = require('./python-scope-utils');
const { checkSyntaxIssues } = require('./syntax-issues');
const DEFAULT_MAX_LINE_LENGTH = 120;
const DEBUG_ANALYZE_STEPS = /^(?:1|true|yes|on)$/i.test(String(process.env.PINGU_DEBUG_ANALYZE_STEPS || ''));

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
    let produced;
    try {
      produced = producer();
    } catch (error) {
      // Um check que falha (p.ex. arquivo de buffer ainda nao salvo em disco) nao deve
      // derrubar toda a analise: registra e segue para os demais checks.
      if (DEBUG_ANALYZE_STEPS) {
        process.stderr.write(`[PINGU_DEBUG] error ${label}: ${error && error.message}\n`);
      }
      return;
    }
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
      appendIssues('logic_errors', () => checkLogicErrors(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('typos', () => checkCommonTypos(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('control_flow_smells', () => checkControlFlowSmells(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('unused_imports', () => checkUnusedImports(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('unused_variables', () => checkUnusedVariables(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('missing_await', () => checkMissingAwait(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('await_in_loop', () => checkAwaitInLoop(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('python_naming', () => checkPythonNamingHazards(lines, analyzedFile, analyzedKind, { focusRange }));
      appendIssues('redundant_constructs', () => checkRedundantConstructs(lines, analyzedFile, analyzedKind, { focusRange }));
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

  const disabledKinds = parseDisabledIssueKinds(process.env.PINGU_DISABLED_ISSUE_KINDS);
  const dedup = [];
  const seen = new Set();
  for (const issue of sortedIssues) {
    if (disabledKinds.has(String(issue && issue.kind || ''))) {
      continue;
    }
    const issueKey = buildIssueDedupKey(issue);
    if (seen.has(issueKey)) {
      continue;
    }
    seen.add(issueKey);
    dedup.push(issue);
  }

  return dedup;
}
function parseDisabledIssueKinds(raw) {
  // Entrada: lista separada por virgula | Saida: conjunto de kinds a suprimir.
  return new Set(String(raw || '')
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean));
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
    const targetFile = String(action && action.target_file || '');
    return `${file}|${line}|${op}|${targetFile}|${range}|${normalizedSnippet}`;
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
function isJavaScriptPseudoMethodName(token) {
  return new Set(['constructor']).has(String(token || '').toLowerCase());
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
  // Sugestao de doc faltante so vale para o contrato publico (funcoes
  // exportadas); helpers internos sem doc nao geram ruido. Doc desatualizada
  // continua sinalizada para qualquer funcao mais abaixo.
  const exportedNames = new Set(collectJavaScriptExportNames(lines.join('\n')));
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
      if (declaration.name && !exportedNames.has(declaration.name)) {
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
  const docLines = buildElixirAnnotationRangeLines(lines, docRange);
  const referencedNames = parseCrossLanguageFunctionDocReferencedNames(docLines, ext);
  const declarationName = sanitizeIdentifier(declaration && declaration.name || '');
  if (declarationName && referencedNames.size > 0 && !referencedNames.has(declarationName)) {
    return true;
  }

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

function parseCrossLanguageFunctionDocReferencedNames(docLines, ext) {
  const linesSource = Array.isArray(docLines) ? docLines : [];
  const lowerExt = String(ext || '').toLowerCase();
  const hasSlashComment = supportsSlashComments(lowerExt);
  const hasHashComment = supportsHashComments(lowerExt);
  const referenced = new Set();
  const patterns = [
    /@spec\s+([A-Za-z_#][A-Za-z0-9_?!:#]*)\s*\(/ig,
    /\b(?:def|defp|function|fn)\s+([A-Za-z_#][A-Za-z0-9_?!:#]*)\s*\(/ig,
    /\b(?:func(?:ao|a[oã]|tion)|method|m[eé]todo)\s*[:\-]\s*`?([A-Za-z_#][A-Za-z0-9_?!:#]*)`?\b/ig,
    /\b(?:principal\s+de|produzid[oa]\s+por|contrato\s+de|fluxo\s+de)\s+`?([A-Za-z_#][A-Za-z0-9_?!:#]*)`?\b/ig,
  ];

  linesSource.forEach((rawLine) => {
    const line = stripLeadingCommentPrefixForDocs(rawLine, hasSlashComment, hasHashComment).trim();
    if (!line) {
      return;
    }

    patterns.forEach((pattern) => {
      pattern.lastIndex = 0;
      let match = pattern.exec(line);
      while (match) {
        if (match[1]) {
          referenced.add(sanitizeIdentifier(match[1]));
        }
        match = pattern.exec(line);
      }
    });
  });

  return referenced;
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
      // So o contrato publico precisa de doc: funcoes "privadas" por convencao
      // (prefixo _ que nao seja um dunder do protocolo) nao geram sugestao.
      if (/^_/.test(declaration.name || '') && !/^__.+__$/.test(declaration.name || '')) {
        idx = declarationEnd;
        continue;
      }
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
  const assignmentMatch = line.match(/^(local\s+)?([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?)\s*=\s*(.+)$/);
  if (!assignmentMatch) {
    return null;
  }
  const isLocal = Boolean(assignmentMatch[1]);
  const rawName = String(assignmentMatch[2] || '').trim();
  const rhs = String(assignmentMatch[3] || '').trim();
  const isMemberAssignment = rawName.includes('.');
  const isGlobalConstant = /^[A-Z][A-Z0-9_]*$/.test(rawName);
  if (!isLocal && !isMemberAssignment && !isGlobalConstant) {
    return null;
  }
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
module.exports = {
  analyzeText,
};
