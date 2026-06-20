'use strict';

// Detectores de erros de logica de comparacao/identidade — enganos humanos que
// o compilador costuma aceitar silenciosamente:
//   - comparacao encadeada em linguagens C-like (a < b < c avalia (a < b) < c);
//   - comparacao de identidade contra literal em Python (x is 5 / x is "foo").
// Todos suggest-only: sinalizam e propoem a correcao, sem auto-fix.

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');
const { maskProtectedSegments } = require('./analyzer-developer-errors');

function checkLogicErrors(lines, file, kind, opts = {}) {
  const focusRange = opts.focusRange || null;
  return (Array.isArray(lines) ? lines : []).flatMap((rawLine, index) => {
    const lineNumber = index + 1;
    if (!isLineInsideFocusRange(focusRange, lineNumber)) {
      return [];
    }
    const line = String(rawLine || '');
    return [
      checkChainedComparison(line, file, kind, lineNumber),
      checkLiteralIdentityComparison(line, file, kind, lineNumber),
    ].filter(Boolean);
  });
}

function isLineInsideFocusRange(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

// a < b < c — em JS/TS o resultado da primeira comparacao (um boolean) entra na
// segunda, quase sempre um engano. Em Python a forma e valida, por isso fica
// restrito as linguagens C-like.
const CHAINED_COMPARISON_PATTERN = /([A-Za-z0-9_$.)\]]+)\s+(<=?|>=?)\s+([A-Za-z0-9_$.([]+)\s+(<=?|>=?)\s+([A-Za-z0-9_$.]+)/;

function checkChainedComparison(line, file, kind, lineNumber) {
  if (!isJavaScriptLikeExtension(kind)) {
    return null;
  }
  const masked = maskProtectedSegments(line, kind);
  const match = masked.match(CHAINED_COMPARISON_PATTERN);
  if (!match) {
    return null;
  }
  const [, left, op1, middle, op2, right] = match;
  const replacement = `${left} ${op1} ${middle} && ${middle} ${op2} ${right}`;
  const snippet = line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);

  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'chained_comparison',
    message: 'Comparacao encadeada: o resultado booleano da primeira comparacao entra na segunda',
    suggestion: 'Separe em duas comparacoes ligadas por && para expressar a intencao.',
    snippet,
    action: { op: 'replace_line' },
  };
}

const PYTHON_IDENTITY_PATTERN = /\bis\b(\s+not\b)?/g;
const PYTHON_LITERAL_RHS_START = /^["'\[{(]|^[-+]?\.?\d|^[frbu]+["']/i;

// x is 5 / x is "foo" / x is [] — `is` compara identidade de objeto, nunca o
// valor de um literal; CPython ja emite SyntaxWarning para esse engano.
function checkLiteralIdentityComparison(line, file, kind, lineNumber) {
  if (!isPythonLikeExtension(kind)) {
    return null;
  }
  const masked = maskProtectedSegments(line, kind);
  const replacements = [];
  for (const match of masked.matchAll(PYTHON_IDENTITY_PATTERN)) {
    const operator = match[0];
    const isNot = Boolean(match[1]);
    const rhsIndex = match.index + operator.length;
    const rhs = line.slice(rhsIndex).replace(/^\s+/, '');
    if (!PYTHON_LITERAL_RHS_START.test(rhs)) {
      continue;
    }
    replacements.push({ start: match.index, end: rhsIndex, value: isNot ? '!=' : '==' });
  }
  if (replacements.length === 0) {
    return null;
  }

  let snippet = line;
  for (const { start, end, value } of replacements.reverse()) {
    snippet = snippet.slice(0, start) + value + snippet.slice(end);
  }

  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'literal_identity_comparison',
    message: 'Comparacao de identidade (is) contra literal: compara objeto, nao valor',
    suggestion: 'Use == para comparar valor; reserve is/is not para None, True e False.',
    snippet,
    action: { op: 'replace_line' },
  };
}

module.exports = {
  checkLogicErrors,
};
