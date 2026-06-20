'use strict';

// Detectores conservadores de construcoes redundantes que quase sempre sao bug
// humano: auto-comparacao (x === x, sempre verdadeira/falsa) e auto-atribuicao
// (x = x, sem efeito). JavaScript/TypeScript e Python. Suggest-only.

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');
const { splitTopLevelParams } = require('./support');

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
    const duplicateKey = findDuplicateKey(code);
    if (duplicateKey) {
      issues.push(buildIssue(file, lineNumber, 'duplicate_key',
        `Chave '${duplicateKey}' duplicada no objeto`,
        'A ultima ocorrencia sobrescreve as anteriores; remova a duplicata ou corrija a chave.'));
    }
    if (isJavaScriptLikeExtension(kind)) {
      const invalidTypeof = findInvalidTypeof(code);
      if (invalidTypeof) {
        issues.push(buildIssue(file, lineNumber, 'invalid_typeof',
          `Comparacao de typeof com '${invalidTypeof}', que nao e um tipo valido`,
          'A expressao e sempre falsa; use um dos tipos validos (undefined, object, boolean, number, bigint, string, symbol, function).'));
      }
      if (hasNaNComparison(code)) {
        issues.push(buildIssue(file, lineNumber, 'nan_comparison',
          'Comparacao direta com NaN',
          'Comparar com NaN e sempre falso; use Number.isNaN() para testar NaN.'));
      }
    }
  });
  return issues;
}

const VALID_TYPEOF_RESULTS = new Set([
  'undefined', 'object', 'boolean', 'number', 'bigint', 'string', 'symbol', 'function',
]);

function findInvalidTypeof(code) {
  const pattern = /(?:typeof\s+[\w$.[\]'"]+\s*(?:===|!==|==|!=)\s*(['"])([a-z]+)\1)|(?:(['"])([a-z]+)\3\s*(?:===|!==|==|!=)\s*typeof\b)/g;
  let match;
  while ((match = pattern.exec(String(code || ''))) !== null) {
    const value = match[2] || match[4];
    if (value && !VALID_TYPEOF_RESULTS.has(value)) {
      return value;
    }
  }
  return '';
}

function hasNaNComparison(code) {
  return /(?:===|!==|==|!=)\s*NaN\b/.test(String(code || ''))
    || /\bNaN\s*(?:===|!==|==|!=)/.test(String(code || ''));
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

function findDuplicateKey(code) {
  // Apenas literais de objeto de uma linha, sem chaves aninhadas (conservador).
  const pattern = /\{([^{}]*)\}/g;
  let match;
  while ((match = pattern.exec(String(code || ''))) !== null) {
    const keys = collectObjectLiteralKeys(match[1]);
    if (keys.length < 2) {
      continue;
    }
    const seen = new Set();
    for (const key of keys) {
      if (seen.has(key)) {
        return key;
      }
      seen.add(key);
    }
  }
  return '';
}

function collectObjectLiteralKeys(inner) {
  const tokens = splitTopLevelParams(String(inner || ''));
  // Considera literal de objeto apenas quando ha pelo menos dois pares chave:valor.
  const pairs = tokens.filter((token) => /:/.test(token));
  if (pairs.length < 2) {
    return [];
  }
  const keys = [];
  for (const token of tokens) {
    const keyMatch = token.match(/^\s*(?:'([A-Za-z_$][\w$]*)'|"([A-Za-z_$][\w$]*)"|([A-Za-z_$][\w$]*))\s*:/);
    if (!keyMatch) {
      // Token sem chave simples (spread, computed, shorthand): aborta para evitar falso positivo.
      return [];
    }
    keys.push(keyMatch[1] || keyMatch[2] || keyMatch[3]);
  }
  return keys;
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
