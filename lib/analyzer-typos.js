'use strict';

// Detector conservador de erros de digitacao em palavras-chave e builtins.
// Trabalha apenas com um dicionario versionado de grafias claramente incorretas,
// ignorando strings e comentarios, e SEMPRE sugere (nunca reescreve sozinho):
// o issue kind 'typo' tem autoFixDefault=false. A correcao so e aplicada quando
// o desenvolvedor aceita explicitamente no editor.

const { escapeRegExp } = require('./support');
const { rewriteCodeSegments } = require('./analyzer-developer-errors');
const dictionary = require('../config/common-typos.json');

const EXTENSION_CORRECTIONS = buildExtensionIndex(dictionary);

function buildExtensionIndex(source) {
  const families = source && typeof source.families === 'object' ? source.families : {};
  const index = new Map();
  Object.values(families).forEach((family) => {
    const extensions = Array.isArray(family.extensions) ? family.extensions : [];
    const corrections = family.corrections && typeof family.corrections === 'object'
      ? family.corrections
      : {};
    const entries = Object.entries(corrections).filter(([typo, correction]) => typo && correction && typo !== correction);
    extensions.forEach((extension) => {
      const normalized = String(extension || '').toLowerCase();
      const existing = index.get(normalized) || [];
      index.set(normalized, existing.concat(entries));
    });
  });
  return index;
}

function typoCorrectionsForKind(kind) {
  return EXTENSION_CORRECTIONS.get(String(kind || '').toLowerCase()) || [];
}

function checkCommonTypos(lines, file, kind, opts = {}) {
  const corrections = typoCorrectionsForKind(kind);
  if (corrections.length === 0) {
    return [];
  }

  const focusRange = opts.focusRange || null;
  return (Array.isArray(lines) ? lines : []).flatMap((line, index) => {
    const lineNumber = index + 1;
    if (!isLineInsideFocusRange(focusRange, lineNumber)) {
      return [];
    }
    const issue = buildTypoIssueForLine(String(line || ''), file, kind, lineNumber, corrections);
    return issue ? [issue] : [];
  });
}

function buildTypoIssueForLine(line, file, kind, lineNumber, corrections) {
  const found = [];
  const corrected = rewriteCodeSegments(line, kind, (code) =>
    applyTypoCorrections(code, corrections, found));

  if (found.length === 0 || corrected === line) {
    return null;
  }

  const first = found[0];
  const column = locateTypoColumn(line, first.typo);
  return {
    file,
    line: lineNumber,
    col: column,
    severity: 'warning',
    kind: 'typo',
    message: `Possivel erro de digitacao: '${first.typo}'`,
    suggestion: buildTypoSuggestion(found),
    snippet: corrected,
    action: { op: 'replace_line' },
    metadata: { typos: found.map((entry) => ({ ...entry })) },
  };
}

function applyTypoCorrections(code, corrections, found) {
  return corrections.reduce((acc, [typo, correction]) => {
    const pattern = new RegExp(`\\b${escapeRegExp(typo)}\\b`, 'g');
    if (!pattern.test(acc)) {
      return acc;
    }
    if (!found.some((entry) => entry.typo === typo)) {
      found.push({ typo, correction });
    }
    return acc.replace(new RegExp(`\\b${escapeRegExp(typo)}\\b`, 'g'), correction);
  }, code);
}

function buildTypoSuggestion(found) {
  if (found.length === 1) {
    return `Voce quis dizer '${found[0].correction}'?`;
  }
  const list = found.map((entry) => `'${entry.typo}' -> '${entry.correction}'`).join(', ');
  return `Possiveis correcoes: ${list}.`;
}

function locateTypoColumn(line, typo) {
  const match = String(line || '').match(new RegExp(`\\b${escapeRegExp(typo)}\\b`));
  if (!match || typeof match.index !== 'number') {
    return undefined;
  }
  return match.index + 1;
}

function isLineInsideFocusRange(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  const normalizedLine = Number.isFinite(lineNumber)
    ? lineNumber
    : Number.parseInt(String(lineNumber || 0), 10);
  return normalizedLine >= focusRange.start && normalizedLine <= focusRange.end;
}

module.exports = {
  checkCommonTypos,
  typoCorrectionsForKind,
};
