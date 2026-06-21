'use strict';

// Utilitarios puros de analise lexica de Python (sem efeito colateral),
// extraidos do analyzer para reuso e para reduzir o arquivo principal:
// validacao de identificador, leitura de string inline (com triplas e prefixos
// r/u/b/f), remocao de comentarios/strings de uma linha e extracao de nomes
// importados (import/from import, com alias).

const { splitTopLevelParams, stripInlineComment } = require('./support');
const { isPythonLikeExtension } = require('./language-profiles');

function matchPythonIdentifier(value) {
  const match = String(value || '').trim().match(/^([A-Za-z_][A-Za-z0-9_]*)$/);
  return match && match[1] ? match[1] : '';
}

function matchPythonInlineString(source, startIndex) {
  const current = String(source || '');
  let cursor = Number(startIndex || 0);
  let prefixLength = 0;

  while (cursor + prefixLength < current.length && /[rRuUbBfF]/.test(current[cursor + prefixLength]) && prefixLength < 2) {
    prefixLength += 1;
  }

  const quoteIndex = cursor + prefixLength;
  const quote = current[quoteIndex];
  if (quote !== '"' && quote !== '\'') {
    return null;
  }

  if (prefixLength > 0) {
    const previousChar = cursor > 0 ? current[cursor - 1] : '';
    if (/[A-Za-z0-9_]/.test(previousChar)) {
      return null;
    }
  }

  const tripleQuote = current.slice(quoteIndex, quoteIndex + 3);
  const isTriple = tripleQuote === '"""' || tripleQuote === "'''";
  let index = quoteIndex + (isTriple ? 3 : 1);

  while (index < current.length) {
    if (!isTriple && current[index] === '\\') {
      index += 2;
      continue;
    }
    if (isTriple && current.slice(index, index + 3) === tripleQuote) {
      return { end: index + 3 };
    }
    if (!isTriple && current[index] === quote) {
      return { end: index + 1 };
    }
    index += 1;
  }

  return { end: current.length };
}

function stripPythonInlineSyntax(line) {
  const source = String(line || '');
  let result = '';
  let cursor = 0;

  while (cursor < source.length) {
    const current = source[cursor];
    if (current === '#') {
      break;
    }

    const stringToken = matchPythonInlineString(source, cursor);
    if (stringToken) {
      cursor = stringToken.end;
      continue;
    }

    result += current;
    cursor += 1;
  }

  return result;
}

function normalizePythonImportSource(source) {
  const normalized = String(source || '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) {
    return '';
  }

  const directImport = normalized.match(/^(import)\s+(.+)$/);
  if (directImport && directImport[2]) {
    return `${directImport[1]} ${String(directImport[2] || '').trim().replace(/,\s*$/, '')}`;
  }

  const fromImport = normalized.match(/^(from\s+[a-zA-Z0-9_\.]+\s+import)\s+(.+)$/);
  if (!fromImport || !fromImport[2]) {
    return normalized;
  }

  const bindings = String(fromImport[2] || '')
    .trim()
    .replace(/^\(\s*/, '')
    .replace(/\s*\)\s*$/, '')
    .replace(/,\s*$/, '');
  return `${fromImport[1]} ${bindings}`.trim();
}

function extractPythonImportVars(line) {
  const source = normalizePythonImportSource(line);
  if (!source) {
    return [];
  }

  const names = new Set();
  const directImport = source.match(/^import\s+(.+)$/);
  if (directImport && directImport[1]) {
    splitTopLevelParams(directImport[1]).forEach((token) => {
      const importToken = String(token || '').trim();
      if (!importToken) {
        return;
      }
      const aliasMatch = importToken.match(/\bas\s+([a-z_][a-zA-Z0-9_]*)$/);
      if (aliasMatch && aliasMatch[1]) {
        names.add(aliasMatch[1]);
        return;
      }
      const rootName = matchPythonIdentifier(importToken.split('.')[0] || '');
      if (rootName) {
        names.add(rootName);
      }
    });
    return Array.from(names);
  }

  const fromImport = source.match(/^from\s+[a-zA-Z0-9_\.]+\s+import\s+(.+)$/);
  if (!fromImport || !fromImport[1]) {
    return [];
  }

  splitTopLevelParams(fromImport[1]).forEach((token) => {
    const importToken = String(token || '').trim();
    if (!importToken || importToken === '*') {
      return;
    }
    const aliasMatch = importToken.match(/\bas\s+([a-z_][a-zA-Z0-9_]*)$/);
    if (aliasMatch && aliasMatch[1]) {
      names.add(aliasMatch[1]);
      return;
    }
    const normalized = matchPythonIdentifier(importToken);
    if (normalized) {
      names.add(normalized);
    }
  });

  return Array.from(names);
}

// Remove comentarios e conteudo de string de uma linha para analise de escopo,
// respeitando a sintaxe inline de cada linguagem (Python via stripPythonInlineSyntax).
function sanitizeScopedAnalysisLine(line, ext) {
  if (isPythonLikeExtension(ext)) {
    return stripPythonInlineSyntax(String(line || '')).trim();
  }
  return stripInlineComment(String(line || ''), ext)
    .replace(/"(?:\\.|[^"\\])*"/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '')
    // Literais de regex contendo escape (\b, \d, \.) — o backslash os distingue
    // de divisao, evitando que `\bprisma` vire um identificador `bprisma`.
    .replace(/\/[^/\n]*\\[^/\n]*\/[gimsuy]*/g, '')
    .trim();
}

// Posicao da proxima tripla aspas (''' ou """) a partir de startIndex.
function nextPythonTripleQuote(source, startIndex) {
  const singleQuoteIndex = source.indexOf("'''", startIndex);
  const doubleQuoteIndex = source.indexOf('"""', startIndex);

  if (singleQuoteIndex < 0 && doubleQuoteIndex < 0) {
    return null;
  }
  if (singleQuoteIndex < 0) {
    return { index: doubleQuoteIndex, quote: '"""' };
  }
  if (doubleQuoteIndex < 0) {
    return { index: singleQuoteIndex, quote: "'''" };
  }
  return singleQuoteIndex < doubleQuoteIndex
    ? { index: singleQuoteIndex, quote: "'''" }
    : { index: doubleQuoteIndex, quote: '"""' };
}

// Remove o conteudo de strings multilinha (triple-quoted), propagando o estado
// da aspa aberta entre linhas via `currentQuote`.
function stripPythonMultilineStringContent(rawLine, currentQuote = '') {
  const source = String(rawLine || '');
  let cursor = 0;
  let multilineQuote = String(currentQuote || '');
  let result = '';

  while (cursor < source.length) {
    if (multilineQuote) {
      const closingIndex = source.indexOf(multilineQuote, cursor);
      if (closingIndex < 0) {
        return { line: result, multilineQuote };
      }
      cursor = closingIndex + multilineQuote.length;
      multilineQuote = '';
      continue;
    }

    const nextQuote = nextPythonTripleQuote(source, cursor);
    if (!nextQuote) {
      result += source.slice(cursor);
      break;
    }

    result += source.slice(cursor, nextQuote.index);
    cursor = nextQuote.index + nextQuote.quote.length;
    multilineQuote = nextQuote.quote;
  }

  return { line: result, multilineQuote };
}

module.exports = {
  matchPythonIdentifier,
  matchPythonInlineString,
  stripPythonInlineSyntax,
  normalizePythonImportSource,
  extractPythonImportVars,
  sanitizeScopedAnalysisLine,
  nextPythonTripleQuote,
  stripPythonMultilineStringContent,
};
