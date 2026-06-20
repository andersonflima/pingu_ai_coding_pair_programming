'use strict';

// Detectores conservadores de construcoes redundantes que quase sempre sao bug
// humano: auto-comparacao (x === x, sempre verdadeira/falsa) e auto-atribuicao
// (x = x, sem efeito). JavaScript/TypeScript e Python. Suggest-only.

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');

function checkRedundantConstructs(lines, file, kind, opts = {}) {
  const supported = isJavaScriptLikeExtension(kind) || isPythonLikeExtension(kind);
  if (!supported) {
    return [];
  }
  const focusRange = opts.focusRange || null;
  const commentPrefix = isPythonLikeExtension(kind) ? '#' : '//';
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];

  const issues = [];
  source.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (!isLineInFocus(focusRange, lineNumber)) {
      return;
    }
    const code = stripLineComment(rawLine, commentPrefix);
    const selfComparison = findSelfComparison(code);
    if (selfComparison) {
      issues.push(buildIssue(file, lineNumber, 'self_comparison',
        `Comparacao de '${selfComparison}' consigo mesmo`,
        'A expressao e sempre verdadeira ou sempre falsa; revise se o operando deveria ser diferente.'));
    }
    const selfAssignment = findSelfAssignment(code);
    if (selfAssignment) {
      issues.push(buildIssue(file, lineNumber, 'self_assignment',
        `Atribuicao de '${selfAssignment}' a si mesmo`,
        'A atribuicao nao tem efeito; remova-a ou corrija o lado direito.'));
    }
  });
  return issues;
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function stripLineComment(line, commentPrefix) {
  const text = String(line || '');
  const index = text.indexOf(commentPrefix);
  return index >= 0 ? text.slice(0, index) : text;
}

function findSelfComparison(code) {
  // Operandos simples (identificador ou acesso a membro), sem chamadas.
  const pattern = /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*(===|!==|==|!=|<=|>=|<|>)\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)/g;
  let match;
  while ((match = pattern.exec(String(code || ''))) !== null) {
    if (match[1] === match[3]) {
      return match[1];
    }
  }
  return '';
}

function findSelfAssignment(code) {
  // Statement isolado `alvo = alvo`, sem declaracao (const/let/var) e sem
  // operador composto. Member access conta (obj.x = obj.x), mas this.x = x nao
  // (lados diferentes).
  const match = String(code || '').trim().match(/^([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)\s*=\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\[[^\]]*\])*)\s*;?$/);
  if (!match) {
    return '';
  }
  if (/^(?:const|let|var)\b/.test(String(code || '').trim())) {
    return '';
  }
  return match[1] === match[2] ? match[1] : '';
}

function buildIssue(file, line, kind, message, suggestion) {
  return {
    file,
    line,
    severity: 'warning',
    kind,
    message,
    suggestion,
    snippet: '',
    action: { op: 'insert_before' },
  };
}

module.exports = {
  checkRedundantConstructs,
};
