'use strict';

// Maquina de correcao para variaveis nao declaradas: dado um identificador
// desconhecido e os candidatos do escopo, resolve a melhor sugestao (incluindo
// dica explicita "pingu - correction:"), monta o snippet/range/action de
// substituicao e decide quando a correcao seria insegura (alteraria a estrutura
// do codigo ou tocaria uma declaracao de import). Extraida do analyzer para
// isolar esse fluxo; depende apenas de utilitarios puros.

const { replaceIdentifierOnce, countMatches } = require('./support');
const { suggestSimilarIdentifier } = require('./identifier-similarity');

function buildUndefinedVariableCorrectionSnippet(rawLine, unknown, suggestion) {
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
    .replace(/[̀-ͯ]/g, '')
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

module.exports = {
  buildUndefinedVariableCorrectionSnippet,
  resolveUndefinedVariableReplacementRange,
  buildUndefinedVariableCorrectionAction,
  resolveUndefinedVariableSuggestion,
  unsafeUndefinedVariableCorrection,
};
