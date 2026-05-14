'use strict';

const fs = require('fs');
const path = require('path');
const { analyzeText } = require('./analyzer');
const { evaluateAutofixGuard } = require('./autofix-guard');
const { resolveIssueAction } = require('./issue-kinds');

const DEFAULT_MIN_CONFIDENCE = 0.85;
const LOCAL_FIX_OPS = new Set([
  'delete_line',
  'insert_after',
  'insert_before',
  'replace_line',
  'replace_range',
  'write_file',
]);
const DEFAULT_CLI_FIX_KINDS = Object.freeze([
  'function_doc',
  'function_spec',
  'unit_test_signature',
  'bare_except',
  'debug_output',
  'duplicate_line',
  'loose_equality',
  'nil_comparison',
  'none_comparison',
  'syntax_extra_delimiter',
  'syntax_missing_comma',
  'syntax_missing_delimiter',
  'syntax_missing_quote',
  'tabs',
  'trailing_whitespace',
  'undefined_variable',
]);

function createCliFixPlan(file, text, options = {}) {
  const issues = analyzeText(file, text, {
    maxLineLength: options.maxLineLength,
    analysisMode: options.analysisMode || 'light',
    focusStartLine: options.focusStartLine,
    focusEndLine: options.focusEndLine,
  });
  const allowedKinds = normalizeAllowedKinds(options.kinds);
  const minConfidence = readMinConfidence(options.minConfidence);
  const candidates = issues
    .map((issue, index) => normalizeFixCandidate(issue, index))
    .filter((candidate) => isApplicableLocalFix(candidate, allowedKinds, minConfidence));

  return {
    file,
    issues,
    candidates,
    minConfidence,
    allowedKinds: Array.from(allowedKinds).sort(),
  };
}

function applyCliFixPlan(file, text, plan, options = {}) {
  const appliedIssues = [];
  const sourcePath = resolveAbsolutePath(file);
  const sourceState = createFixFileState(sourcePath, String(text || ''));
  const fileStates = new Map([[sourceState.path, sourceState]]);
  const orderedCandidates = [...(plan && Array.isArray(plan.candidates) ? plan.candidates : [])]
    .sort((left, right) => {
      const lineDiff = Number(right.issue.line || 0) - Number(left.issue.line || 0);
      if (lineDiff !== 0) {
        return lineDiff;
      }
      return Number(right.index || 0) - Number(left.index || 0);
    });

  orderedCandidates.forEach((candidate) => {
    const action = resolveIssueAction(candidate && candidate.issue);
    const targetFile = resolveIssueTargetFile(sourcePath, action);
    const targetState = getOrCreateFixFileState(fileStates, targetFile);
    const changed = applyLocalIssue(targetState.lines, candidate.issue, targetState.path);
    if (changed) {
      appliedIssues.push(candidate.issue);
      targetState.modified = true;
    }
  });

  const nextText = sourceState.modified
    ? joinEditableLines(sourceState.lines, sourceState.hasFinalNewline)
    : String(text || '');

  if (!options.validate || appliedIssues.length === 0) {
    const modifiedFiles = collectModifiedFiles(fileStates);
    return {
      ok: true,
      text: nextText,
      appliedIssues,
      guard: null,
      writtenFiles: modifiedFiles,
      fileContents: Object.fromEntries(
        modifiedFiles
          .map((targetFile) => {
            const state = fileStates.get(targetFile);
            return [
              targetFile,
              state ? joinEditableLines(state.lines, state.hasFinalNewline) : '',
            ];
          })
          .filter((entry) => entry[1] !== undefined),
      ),
    };
  }

  const changedFileStates = collectAffectedFileStates(fileStates);
  const afterIssues = changedFileStates.flatMap((entry) => analyzeText(entry.path, joinEditableLines(entry.lines, entry.hasFinalNewline), {
    maxLineLength: options.maxLineLength,
    analysisMode: options.analysisMode || 'light',
  }));

  const guard = evaluateAutofixGuard({
    appliedIssues,
    beforeIssues: plan.issues,
    afterIssues,
    fileEntries: changedFileStates.map((entry) => ({
      path: entry.path,
      contents: joinEditableLines(entry.lines, entry.hasFinalNewline),
    })),
  });

  const finalWrittenFiles = collectModifiedFiles(fileStates);
  const finalFileContents = finalWrittenFiles.reduce((acc, targetFile) => {
    const state = fileStates.get(targetFile);
    if (!state) {
      return acc;
    }
    acc[targetFile] = joinEditableLines(state.lines, state.hasFinalNewline);
    return acc;
  }, {});

  return {
    ok: guard.ok,
    text: guard.ok ? nextText : String(text || ''),
    appliedIssues: guard.ok ? appliedIssues : [],
    rejectedIssues: guard.ok ? [] : appliedIssues,
    guard,
    writtenFiles: guard.ok ? finalWrittenFiles : [],
    fileContents: guard.ok ? finalFileContents : {},
  };
}

function fixFile(file, options = {}) {
  const text = fs.readFileSync(file, 'utf8');
  const plan = createCliFixPlan(file, text, options);
  if (!options.write) {
    return {
      ok: true,
      file,
      mode: 'plan',
      plan,
      appliedIssues: [],
      written: false,
      writtenFiles: [],
      fileContents: {},
    };
  }

  const result = applyCliFixPlan(file, text, plan, {
    ...options,
    validate: options.validate !== false,
  });
  const filesToWrite = new Set([...(result.writtenFiles || []), sourceFileIfChanged(file, text, result.text)]);
  filesToWrite.forEach((targetFile) => {
    if (!targetFile) {
      return;
    }
    const contents = result.fileContents && Object.prototype.hasOwnProperty.call(result.fileContents, targetFile)
      ? result.fileContents[targetFile]
      : null;
    if (contents === null) {
      return;
    }
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, contents, 'utf8');
  });

  return {
    ok: result.ok,
    file,
    mode: 'write',
    plan,
    appliedIssues: result.appliedIssues,
    rejectedIssues: result.rejectedIssues || [],
    guard: result.guard,
    written: result.ok && (result.writtenFiles || []).length > 0,
    writtenFiles: result.writtenFiles || [],
    fileContents: result.fileContents || {},
  };
}

function normalizeAllowedKinds(kinds) {
  const source = Array.isArray(kinds) && kinds.length > 0
    ? kinds
    : DEFAULT_CLI_FIX_KINDS;
  return new Set(source.map((kind) => String(kind || '').trim()).filter(Boolean));
}

function readMinConfidence(value) {
  const parsed = Number.parseFloat(String(value || ''));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_MIN_CONFIDENCE;
  }
  return Math.max(0, Math.min(0.99, parsed));
}

function normalizeFixCandidate(issue, index) {
  const action = resolveIssueAction(issue);
  return {
    index,
    issue: {
      ...issue,
      action,
    },
    action,
  };
}

function isApplicableLocalFix(candidate, allowedKinds, minConfidence) {
  const issue = candidate && candidate.issue;
  const action = candidate && candidate.action;
  const kind = String(issue && issue.kind || '').trim();
  const op = String(action && action.op || '').trim();
  const confidence = issue && issue.confidence && typeof issue.confidence === 'object'
    ? Number(issue.confidence.score || 0)
    : 0;

  if (!kind || !allowedKinds.has(kind)) {
    return false;
  }
  if (!LOCAL_FIX_OPS.has(op)) {
    return false;
  }
  if (confidence < minConfidence) {
    return false;
  }
  if (op !== 'delete_line' && !String(issue && issue.snippet || '').length) {
    return false;
  }
  return true;
}

function applyLocalIssue(lines, issue) {
  const action = resolveIssueAction(issue);
  const op = String(action && action.op || '').trim();
  const lineNumber = Number(issue && issue.line || 0);
  const index = lineNumber - 1;
  if (!Number.isInteger(index) || index < 0 || (op !== 'insert_after' && op !== 'delete_line' && index >= lines.length)) {
    return false;
  }

  const snippetLines = splitSnippetLines(issue && issue.snippet);
  if (op === 'delete_line') {
    lines.splice(index, 1);
    if (lines.length === 0) {
      lines.push('');
    }
    return true;
  }
  if (op === 'replace_line') {
    lines.splice(index, 1, ...snippetLines);
    return true;
  }
  if (op === 'insert_before') {
    lines.splice(index, 0, ...snippetLines);
    return true;
  }
  if (op === 'insert_after') {
    lines.splice(index + 1, 0, ...snippetLines);
    return true;
  }
  if (op === 'replace_range') {
    const range = resolvePatchRange(action, index, lines.length);
    if (!range) {
      return false;
    }
    const start = Number(range.start || 0);
    const end = Number(range.end || 0);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start >= end) {
      return false;
    }
    lines.splice(start, end - start, ...snippetLines);
    return true;
  }
  if (op === 'write_file') {
    const snippet = String(issue && issue.snippet || '');
    const normalizedSnippet = normalizeSnippetText(snippet);
    lines.splice(0, lines.length, ...splitSnippetLines(normalizedSnippet));
    return true;
  }
  return false;
}

function normalizeIssueActionTargetFile(file, action) {
  const targetFile = String(action && action.target_file || '').trim();
  if (!targetFile) {
    return resolveAbsolutePath(file);
  }
  if (path.isAbsolute(targetFile)) {
    return targetFile;
  }
  return resolveAbsolutePath(path.join(path.dirname(file), targetFile));
}

function resolveIssueTargetFile(file, action) {
  return normalizeIssueActionTargetFile(file, action || {});
}

function resolveAbsolutePath(file) {
  return path.resolve(String(file || ''));
}

function createFixFileState(file, text = '') {
  const hasFinalNewline = /\n$/.test(String(text || ''));
  return {
    path: resolveAbsolutePath(file),
    lines: splitEditableLines(text),
    hasFinalNewline,
    modified: false,
  };
}

function getOrCreateFixFileState(fileStates, file) {
  const normalized = resolveAbsolutePath(file);
  if (fileStates.has(normalized)) {
    return fileStates.get(normalized);
  }

  if (fs.existsSync(normalized)) {
    const text = fs.readFileSync(normalized, 'utf8');
    const state = createFixFileState(normalized, text);
    fileStates.set(normalized, state);
    return state;
  }

  const state = createFixFileState(normalized, '');
  fileStates.set(normalized, state);
  return state;
}

function collectModifiedFiles(fileStates) {
  return Array.from(fileStates.values())
    .filter((entry) => entry.modified)
    .map((entry) => entry.path);
}

function collectAffectedFileStates(fileStates) {
  return Array.from(fileStates.values()).filter((entry) => entry.modified);
}

function sourceFileIfChanged(file, currentText, nextText) {
  const sourcePath = resolveAbsolutePath(file);
  if (String(currentText || '') === String(nextText || '')) {
    return null;
  }
  return sourcePath;
}

function normalizeSnippetText(snippet) {
  const raw = String(snippet || '').replace(/\r\n/g, '\n');
  if (!raw) {
    return '';
  }
  return raw.endsWith('\n') ? raw.slice(0, -1) : raw;
}

function resolvePatchRange(action, fallbackIndex, totalLines) {
  const total = Number.isFinite(totalLines) ? totalLines : 0;
  const fallbackStart = Number.isFinite(fallbackIndex) ? Math.max(0, Math.min(fallbackIndex, Math.max(0, total - 1))) : 0;
  const fallbackEnd = Math.min(total, fallbackStart + 1);
  const range = action && action.range;
  const rangeStart = Number(range && range.start && range.start.line);
  const rangeEnd = Number(range && range.end && range.end.line);
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) {
    return {
      start: fallbackStart,
      end: fallbackEnd,
    };
  }
  const rawStart = rangeStart;
  const rawEnd = rangeEnd;
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) {
    return {
      start: fallbackStart,
      end: fallbackEnd,
    };
  }
  const safeStart = Math.max(0, Math.min(Math.floor(rawStart), total));
  const safeEnd = Math.max(safeStart + 1, Math.min(Math.floor(rawEnd), total));
  return {
    start: safeStart,
    end: safeEnd,
  };
}

function splitEditableLines(text) {
  const source = String(text || '');
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length > 0 ? lines : [''];
}

function joinEditableLines(lines, finalNewline) {
  const body = (Array.isArray(lines) && lines.length > 0 ? lines : ['']).join('\n');
  return finalNewline ? `${body}\n` : body;
}

function splitSnippetLines(snippet) {
  const lines = String(snippet || '').replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

module.exports = {
  applyCliFixPlan,
  createCliFixPlan,
  fixFile,
};
