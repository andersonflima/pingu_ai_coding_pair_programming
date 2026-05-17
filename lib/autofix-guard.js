'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { analysisExtension } = require('./language-capabilities');
const { mustClearKindsForIssue } = require('./issue-kinds');

const COMMENT_ONLY_AUTOFIX_KINDS = new Set([
  'class_doc',
  'flow_comment',
  'function_comment',
  'function_doc',
  'moduledoc',
  'variable_doc',
]);
const STRUCTURAL_AUTOFIX_KINDS = new Set([
  'comment_task',
  'context_file',
  'unit_test',
]);
const CONSULTATIVE_AUTOFIX_KINDS = new Set([
  'ai_required',
  'large_file',
]);
const LOW_RISK_LOCAL_REWRITE_KINDS = new Set([
  'debug_output',
  'duplicate_line',
  'syntax_extra_delimiter',
  'syntax_missing_comma',
  'syntax_missing_delimiter',
  'syntax_malformed_keyword',
  'syntax_missing_quote',
  'tabs',
  'todo_fixme',
  'trailing_whitespace',
]);
const VALIDATION_CACHE_MAX_ENTRIES = 256;
const validationCache = new Map();
const validationCacheOrder = [];

function resolveAbsoluteFilePath(filePath) {
  const normalized = String(filePath || '').trim();
  if (!normalized) {
    return '';
  }
  return path.resolve(normalized);
}

function normalizeFileEntryContents(contents) {
  return String(contents || '').replace(/\u0000/g, '\n');
}

function countIssuesByKind(issues, kind) {
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => String(issue && issue.kind || '') === String(kind || ''))
    .length;
}

function issueFilePath(issue) {
  return resolveAbsoluteFilePath(
    issue && (issue.file || issue.filename || issue.filePath)
      || issue && issue.action && issue.action.target_file
      || '',
  );
}

function issueLine(issue) {
  const value = Number(issue && issue.line || issue && issue.lnum || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function issueMetadata(issue) {
  return issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
}

function normalizedMetadataString(value) {
  return String(value || '').trim().toLowerCase();
}

function issueSymbolIdentity(issue) {
  const metadata = issueMetadata(issue);
  const symbolName = normalizedMetadataString(metadata.symbolName);
  const enclosingClassName = normalizedMetadataString(metadata.enclosingClassName);
  const containerClassName = normalizedMetadataString(metadata.containerClassName);
  const signaturePreview = Array.isArray(metadata.signaturePreview)
    ? metadata.signaturePreview.map((line) => normalizedMetadataString(line)).filter(Boolean).join('\n')
    : '';

  return {
    symbolName,
    enclosingClassName,
    containerClassName,
    signaturePreview,
  };
}

function issuesDescribeSameSymbol(leftIssue, rightIssue) {
  const leftIdentity = issueSymbolIdentity(leftIssue);
  const rightIdentity = issueSymbolIdentity(rightIssue);

  if (leftIdentity.symbolName && rightIdentity.symbolName) {
    if (leftIdentity.symbolName !== rightIdentity.symbolName) {
      return false;
    }
    if (
      leftIdentity.enclosingClassName
      && rightIdentity.enclosingClassName
      && leftIdentity.enclosingClassName !== rightIdentity.enclosingClassName
    ) {
      return false;
    }
    if (
      leftIdentity.containerClassName
      && rightIdentity.containerClassName
      && leftIdentity.containerClassName !== rightIdentity.containerClassName
    ) {
      return false;
    }
    return true;
  }

  if (leftIdentity.signaturePreview && rightIdentity.signaturePreview) {
    return leftIdentity.signaturePreview === rightIdentity.signaturePreview;
  }

  return false;
}

function issuesReferToSameLocation(leftIssue, rightIssue) {
  const leftLine = issueLine(leftIssue);
  const rightLine = issueLine(rightIssue);
  if (leftLine <= 0 || rightLine <= 0) {
    return false;
  }
  return Math.abs(leftLine - rightLine) <= 8;
}

function isSamePersistentIssue(appliedIssue, candidateIssue, expectedKind) {
  const appliedKind = String(expectedKind || appliedIssue && appliedIssue.kind || '').trim();
  if (!appliedKind) {
    return false;
  }
  if (String(candidateIssue && candidateIssue.kind || '').trim() !== appliedKind) {
    return false;
  }

  const appliedFile = issueFilePath(appliedIssue);
  const candidateFile = issueFilePath(candidateIssue);
  if (appliedFile && candidateFile && appliedFile !== candidateFile) {
    return false;
  }

  if (issuesDescribeSameSymbol(appliedIssue, candidateIssue)) {
    return true;
  }

  return issuesReferToSameLocation(appliedIssue, candidateIssue);
}

function countPersistentMatchingIssues(issues, appliedIssue, expectedKind) {
  return (Array.isArray(issues) ? issues : [])
    .filter((candidateIssue) => isSamePersistentIssue(appliedIssue, candidateIssue, expectedKind))
    .length;
}

function mustClearValidationFailures(
  appliedIssues,
  beforeIssues,
  afterIssues,
  resolveMustClearKinds = mustClearKindsForIssue,
) {
  const failures = [];
  (Array.isArray(appliedIssues) ? appliedIssues : []).forEach((issue) => {
    const mustClearKinds = typeof resolveMustClearKinds === 'function'
      ? resolveMustClearKinds(issue)
      : mustClearKindsForIssue(issue);
    (Array.isArray(mustClearKinds) ? mustClearKinds : []).forEach((kind) => {
      const normalizedKind = String(kind || '').trim();
      const beforeCount = normalizedKind === String(issue && issue.kind || '').trim()
        ? countPersistentMatchingIssues(beforeIssues, issue, normalizedKind)
        : countIssuesByKind(beforeIssues, normalizedKind);
      if (beforeCount <= 0) {
        return;
      }
      const afterCount = normalizedKind === String(issue && issue.kind || '').trim()
        ? countPersistentMatchingIssues(afterIssues, issue, normalizedKind)
        : countIssuesByKind(afterIssues, normalizedKind);
      if (afterCount >= beforeCount) {
        failures.push({
          kind: normalizedKind,
          beforeCount,
          afterCount,
        });
      }
    });
  });
  return failures;
}

function normalizeFileEntry(fileEntry) {
  if (!fileEntry || typeof fileEntry !== 'object') {
    return null;
  }
  const filePath = resolveAbsoluteFilePath(fileEntry.path || fileEntry.filePath);
  if (!filePath) {
    return null;
  }

  if (typeof fileEntry.contents === 'string') {
    return {
      path: filePath,
      contents: normalizeFileEntryContents(fileEntry.contents),
    };
  }

  if (fs.existsSync(filePath)) {
    return {
      path: filePath,
      contents: fs.readFileSync(filePath, 'utf8'),
    };
  }

  return {
    path: filePath,
    contents: '',
  };
}

function uniqueFileEntries(fileEntries) {
  const entries = Array.isArray(fileEntries) ? fileEntries : [];
  const unique = new Map();
  entries
    .map(normalizeFileEntry)
    .filter(Boolean)
    .forEach((entry) => {
      unique.set(entry.path, entry);
    });
  return Array.from(unique.values());
}

function validationCommandFor(filePath) {
  const extension = analysisExtension(filePath);
  if (extension === '.py') {
    return {
      command: 'python3',
      args: [
        '-c',
        'import pathlib, sys; source = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"); compile(source, sys.argv[1], "exec")',
      ],
      label: 'python3 -c compile(...)',
    };
  }

  if (['.js', '.mjs', '.cjs'].includes(extension)) {
    return {
      command: 'node',
      args: ['--check'],
      label: 'node --check',
    };
  }

  if (['.ex', '.exs'].includes(extension)) {
    return {
      command: 'elixirc',
      args: [],
      label: 'elixirc',
    };
  }

  return null;
}

function writeValidationTempCopy(tempRoot, fileEntry, index) {
  const sourcePath = String(fileEntry.path || '');
  const sourceExtension = analysisExtension(sourcePath) || path.extname(sourcePath);
  const sourceBaseName = path.basename(sourcePath) || `file-${index}${sourceExtension || ''}`;
  const baseName = sourceExtension && !sourceBaseName.endsWith(sourceExtension)
    ? `${sourceBaseName}${sourceExtension}`
    : sourceBaseName;
  const targetDirectory = path.join(tempRoot, String(index));
  const targetPath = path.join(targetDirectory, baseName || `file-${index}`);
  fs.mkdirSync(targetDirectory, { recursive: true });
  fs.writeFileSync(targetPath, String(fileEntry.contents || ''), 'utf8');
  return targetPath;
}

function touchValidationCacheKey(key) {
  const index = validationCacheOrder.indexOf(key);
  if (index >= 0) {
    validationCacheOrder.splice(index, 1);
  }
  validationCacheOrder.push(key);
}

function pruneValidationCache() {
  while (validationCacheOrder.length > VALIDATION_CACHE_MAX_ENTRIES) {
    const staleKey = validationCacheOrder.shift();
    validationCache.delete(staleKey);
  }
}

function cloneValidationFailures(failures) {
  return (Array.isArray(failures) ? failures : []).map((failure) => ({
    ...failure,
  }));
}

function validationCacheKey(fileEntry, validationCommand) {
  const cacheHash = crypto.createHash('sha1')
    .update(String(fileEntry && fileEntry.path || ''))
    .update('\0')
    .update(String(validationCommand && validationCommand.label || ''))
    .update('\0')
    .update(String(fileEntry && fileEntry.contents || ''))
    .digest('hex');
  return cacheHash;
}

function readCachedValidationFailures(key) {
  if (!validationCache.has(key)) {
    return null;
  }
  touchValidationCacheKey(key);
  return cloneValidationFailures(validationCache.get(key));
}

function storeCachedValidationFailures(key, failures) {
  validationCache.set(key, cloneValidationFailures(failures));
  touchValidationCacheKey(key);
  pruneValidationCache();
  return cloneValidationFailures(failures);
}

function validateFileEntries(fileEntries) {
  const entries = uniqueFileEntries(fileEntries);
  if (entries.length === 0) {
    return [];
  }

  const validationWorkItems = entries.map((entry) => {
    const validationCommand = validationCommandFor(entry.path);
    if (!validationCommand) {
      return {
        entry,
        validationCommand: null,
        cacheKey: '',
        cachedFailures: [],
      };
    }

    const cacheKey = validationCacheKey(entry, validationCommand);
    const cachedFailures = readCachedValidationFailures(cacheKey);
    return {
      entry,
      validationCommand,
      cacheKey,
      cachedFailures,
    };
  });
  const hasPendingValidation = validationWorkItems.some((item) =>
    item.validationCommand && item.cachedFailures === null);
  if (!hasPendingValidation) {
    return validationWorkItems.flatMap((item) => item.cachedFailures || []);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-autofix-guard-'));
  try {
    return validationWorkItems.flatMap((item, index) => {
      if (!item.validationCommand) {
        return item.cachedFailures || [];
      }

      if (item.cachedFailures) {
        return item.cachedFailures;
      }

      const tempFilePath = writeValidationTempCopy(tempRoot, item.entry, index);
      const result = spawnSync(
        item.validationCommand.command,
        [...item.validationCommand.args, tempFilePath],
        {
          cwd: path.dirname(tempFilePath),
          encoding: 'utf8',
          env: {
            ...process.env,
            ...(item.validationCommand.env || {}),
          },
        },
      );

      if (result.status === 0) {
        return storeCachedValidationFailures(item.cacheKey, []);
      }

      return storeCachedValidationFailures(item.cacheKey, [{
        filePath: item.entry.path,
        command: item.validationCommand.label,
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: String(result.stdout || '').trim(),
        stderr: String(result.stderr || '').trim(),
      }]);
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function isCommentOnlyIssueBatch(appliedIssues) {
  const issues = Array.isArray(appliedIssues) ? appliedIssues : [];
  if (issues.length === 0) {
    return false;
  }

  return issues.every((issue) => COMMENT_ONLY_AUTOFIX_KINDS.has(String(issue && issue.kind || '')));
}

function languageKeyForPath(filePath) {
  const extension = analysisExtension(filePath);
  return extension ? extension.replace(/^\./, '') : 'unknown';
}

function classifyAutofixBatch(appliedIssues, fileEntries = []) {
  const issues = Array.isArray(appliedIssues) ? appliedIssues : [];
  const entries = uniqueFileEntries(fileEntries);
  const kinds = new Set();
  const operations = new Set();
  const languages = new Set();
  let documentationOnly = issues.length > 0;
  let hasStructuralGeneration = false;
  let hasConsultativeOnly = issues.length > 0;
  let lowRiskLocalRewriteOnly = issues.length > 0;

  issues.forEach((issue) => {
    const kind = String(issue && issue.kind || '').trim();
    const action = issue && issue.action && typeof issue.action === 'object'
      ? issue.action
      : {};
    const operation = String(action.op || '').trim() || 'unknown';
    if (kind) {
      kinds.add(kind);
    }
    operations.add(operation);
    if (!COMMENT_ONLY_AUTOFIX_KINDS.has(kind)) {
      documentationOnly = false;
    }
    if (STRUCTURAL_AUTOFIX_KINDS.has(kind) || operation === 'write_file') {
      hasStructuralGeneration = true;
    }
    if (!CONSULTATIVE_AUTOFIX_KINDS.has(kind)) {
      hasConsultativeOnly = false;
    }
    if (
      !LOW_RISK_LOCAL_REWRITE_KINDS.has(kind)
      || operation === 'write_file'
      || operation === 'run_command'
    ) {
      lowRiskLocalRewriteOnly = false;
    }
    languages.add(languageKeyForPath(issue && issue.file || action.target_file || ''));
  });

  entries.forEach((entry) => {
    languages.add(languageKeyForPath(entry.path));
  });

  const strategy = documentationOnly
    ? 'documentation_only'
    : hasStructuralGeneration
      ? 'structural_generation'
      : hasConsultativeOnly
        ? 'consultative_only'
        : lowRiskLocalRewriteOnly
          ? 'low_risk_local_rewrite'
        : 'code_rewrite';

  return {
    issueCount: issues.length,
    strategies: Array.from(new Set([
      documentationOnly ? 'documentation_only' : '',
      hasStructuralGeneration ? 'structural_generation' : '',
      hasConsultativeOnly ? 'consultative_only' : '',
      lowRiskLocalRewriteOnly ? 'low_risk_local_rewrite' : '',
      !documentationOnly && !hasStructuralGeneration && !hasConsultativeOnly && !lowRiskLocalRewriteOnly ? 'code_rewrite' : '',
    ].filter(Boolean))),
    strategy,
    documentationOnly,
    hasStructuralGeneration,
    hasConsultativeOnly,
    lowRiskLocalRewriteOnly,
    requiresRuntimeValidation: !documentationOnly && !hasConsultativeOnly && !lowRiskLocalRewriteOnly,
    kinds: Array.from(kinds).sort(),
    operations: Array.from(operations).sort(),
    languages: Array.from(languages).filter(Boolean).sort(),
  };
}

function evaluateAutofixGuard(options = {}) {
  const batchProfile = classifyAutofixBatch(options.appliedIssues, options.fileEntries);
  const validationFailures = mustClearValidationFailures(
    options.appliedIssues,
    options.beforeIssues,
    options.afterIssues,
    options.resolveMustClearKinds,
  );
  const runtimeFailures = batchProfile.requiresRuntimeValidation
    ? validateFileEntries(options.fileEntries)
    : [];
  return {
    ok: validationFailures.length === 0 && runtimeFailures.length === 0,
    batchProfile,
    validationFailures,
    runtimeFailures,
  };
}

function collectAffectedFilePaths(sourceFile, issues = [], resolveIssueAction = () => ({})) {
  const affected = new Set();
  const normalizedSourceFile = resolveAbsoluteFilePath(sourceFile);
  if (normalizedSourceFile) {
    affected.add(normalizedSourceFile);
  }

  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    const action = resolveIssueAction(issue);
    if (String(action && action.op || '') !== 'write_file') {
      return;
    }
    const targetFile = resolveAbsoluteFilePath(action.target_file);
    if (targetFile) {
      affected.add(targetFile);
    }
  });

  return Array.from(affected);
}

function captureFileSnapshot(filePaths) {
  const snapshot = new Map();
  (Array.isArray(filePaths) ? filePaths : []).forEach((filePath) => {
    const resolvedPath = resolveAbsoluteFilePath(filePath);
    if (!resolvedPath) {
      return;
    }
    const exists = fs.existsSync(resolvedPath);
    snapshot.set(resolvedPath, {
      exists,
      contents: exists ? fs.readFileSync(resolvedPath, 'utf8') : '',
    });
  });
  return snapshot;
}

function restoreFileSnapshot(snapshot) {
  if (!(snapshot instanceof Map)) {
    return;
  }

  snapshot.forEach((state, filePath) => {
    if (!state || !filePath) {
      return;
    }
    if (!state.exists) {
      fs.rmSync(filePath, { force: true });
      return;
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, String(state.contents || ''), 'utf8');
  });
}

module.exports = {
  captureFileSnapshot,
  classifyAutofixBatch,
  collectAffectedFilePaths,
  countIssuesByKind,
  evaluateAutofixGuard,
  isCommentOnlyIssueBatch,
  mustClearValidationFailures,
  restoreFileSnapshot,
  validateFileEntries,
};
