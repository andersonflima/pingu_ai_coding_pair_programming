'use strict';

// Analise de variaveis indefinidas (escopo) para Python, Elixir e linguagens
// brace-scoped (JS/TS/Go/Rust): coleta as variaveis visiveis em cada escopo de
// funcao/modulo, detecta usos de nomes nao definidos e sugere correcao por
// similaridade. Inclui o cache (bounded) de resultados e de exports de modulo
// local. Cluster fechado sob os modulos de support/parsing ja extraidos.

const fs = require('fs');
const path = require('path');
const { createBoundedEntryCache } = require('./lru-cache');
const { countBlockDelta, countMatches, isJavaScriptControlKeyword, isReservedToken, leadingIndentLength, sanitizeAnalysisLine, sanitizeIdentifier } = require('./support');
const { isElixirExtension, isPythonLikeExtension, isJavaScriptLikeExtension, isGoExtension, isRustExtension } = require('./language-profiles');
const { filterIssuesByFocusRange, isLineInsideFocusRange } = require('./analyzer-options');
const { supportsLocalImportBindingValidation, parseLocalImportBindings, readJavaScriptImportStatement } = require('./analyzer-import-bindings');
const { suggestSimilarIdentifier } = require('./identifier-similarity');
const { resolveUndefinedVariableReplacementRange, buildUndefinedVariableCorrectionSnippet, buildUndefinedVariableCorrectionAction, resolveUndefinedVariableSuggestion, unsafeUndefinedVariableCorrection } = require('./analyzer-undefined-correction');
const { readElixirFunctionDeclaration, extractBoundPatternVars } = require('./function-signature');
const { checkSyntaxIssues } = require('./syntax-issues');
const { stripPythonMultilineStringContent, sanitizeScopedAnalysisLine, extractPythonImportVars, stripPythonInlineSyntax } = require('./python-scope-utils');
const { readPythonFunctionDeclaration, parsePythonClassDeclaration } = require('./python-signature');
const { resolveLocalModuleFile, collectJavaScriptExportNames } = require('./analyzer-module-resolution');

const GLOBAL_MODULE_EXPORT_CACHE_MAX_ENTRIES = 512;
const GLOBAL_UNDEFINED_VARIABLE_CACHE_MAX_ENTRIES = 128;
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

function countPythonImportParenDelta(line) {
  const stripped = stripPythonInlineSyntax(line);
  return countMatches(/\(/g, stripped) - countMatches(/\)/g, stripped);
}

function pythonLineHasTrailingContinuation(line) {
  return /\\\s*$/.test(String(line || '').trimEnd());
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

function pythonFunctionScopeEnded(rawLine, baseIndent) {
  const source = String(rawLine || '');
  const trimmed = source.trim();
  if (!trimmed || /^\s*#/.test(source)) {
    return false;
  }
  return leadingIndentLength(source) <= baseIndent;
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

module.exports = {
  checkUndefinedVariables,
};
