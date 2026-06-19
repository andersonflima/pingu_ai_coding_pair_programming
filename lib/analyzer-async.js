'use strict';

// Deteccao conservadora de await ausente em JavaScript/TypeScript: chamada a uma
// funcao async definida no proprio arquivo, usada como instrucao isolada
// (fire-and-forget), sem await/return/void e sem encadear .then/.catch. Esse
// padrao costuma ser um bug de ordem de execucao ou rejeicao nao tratada.
// Suggest-only: o Pingu sinaliza, mas nunca reescreve sozinho (adicionar await
// muda a semantica e exige funcao async no escopo).

const { isJavaScriptLikeExtension } = require('./language-profiles');

function checkMissingAwait(lines, file, kind, opts = {}) {
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const asyncNames = collectAsyncFunctionNames(source);
  if (asyncNames.size === 0) {
    return [];
  }

  const focusRange = opts.focusRange || null;
  const issues = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!isLineInFocus(focusRange, index + 1)) {
      continue;
    }
    const name = bareFireAndForgetCallName(source[index], asyncNames);
    if (!name) {
      continue;
    }
    issues.push({
      file,
      line: index + 1,
      severity: 'warning',
      kind: 'missing_await',
      message: `Chamada async '${name}' sem await`,
      suggestion: 'Adicione await (em funcao async), retorne a promise ou use void para fire-and-forget intencional.',
      snippet: '',
      action: { op: 'insert_before' },
    });
  }
  return issues;
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function collectAsyncFunctionNames(lines) {
  const names = new Set();
  lines.forEach((line) => {
    let match;
    if ((match = line.match(/\basync\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/))) {
      names.add(match[1]);
    }
    if ((match = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/))) {
      names.add(match[1]);
    }
    // Metodo de classe/objeto: `async nome(` (evita palavras-chave de controle).
    if ((match = line.match(/^\s*(?:(?:public|private|protected|static|readonly|override)\s+)*async\s+([A-Za-z_$][\w$]*)\s*\(/))) {
      if (!['function', 'if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        names.add(match[1]);
      }
    }
  });
  return names;
}

function bareFireAndForgetCallName(line, asyncNames) {
  const trimmed = String(line || '').trim();
  // A linha deve ser exatamente uma chamada: nome(...) ou this.nome(...), com ; opcional.
  const match = trimmed.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\([^]*\)\s*;?$/);
  if (!match) {
    return '';
  }
  const name = match[1];
  if (!asyncNames.has(name)) {
    return '';
  }
  // Encadeamento .then/.catch/.finally ja trata a promise.
  if (/\)\s*\.(?:then|catch|finally)\b/.test(trimmed)) {
    return '';
  }
  // Prefixos que ja consomem a promise.
  if (/^(?:await|return|void|yield)\b/.test(trimmed)) {
    return '';
  }
  // Atribuicao (a promise pode ser awaited depois) — fora do escopo conservador.
  if (/^[^(]*=[^=]/.test(trimmed)) {
    return '';
  }
  return name;
}

module.exports = {
  checkMissingAwait,
};
