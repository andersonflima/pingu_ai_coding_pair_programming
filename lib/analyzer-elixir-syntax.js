'use strict';

// Checks de sintaxe especificos de Elixir, extraidos do analyzer: blocos do/end
// pendentes sem fechamento, keyword 'end' malformada (typo) e token isolado
// inesperado antes de um end. Dependem apenas de utilitarios de varredura de
// sintaxe (support), do perfil de linguagem e da distancia de edicao.

const { isElixirExtension } = require('./language-profiles');
const { levenshteinDistance } = require('./identifier-similarity');
const {
  stripInlineComment,
  countBlockDelta,
  lineIndentation,
  syntaxRelevantLine,
  findNextSyntaxLine,
  findPreviousSyntaxLine,
} = require('./support');

function checkElixirBlockDelimiterIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  let inTripleQuote = '';
  let pendingBlocks = 0;
  let lastOpenIndent = '';

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const strippedInline = String(stripInlineComment(rawLine, kind) || '');
    if (!strippedInline.trim()) {
      continue;
    }

    let structural = strippedInline;

    if (inTripleQuote) {
      const closeIndex = structural.indexOf(inTripleQuote);
      if (closeIndex < 0) {
        continue;
      }
      structural = structural.slice(closeIndex + 3);
      inTripleQuote = '';
    }

    while (true) {
      const tripleMatch = structural.match(/("""|''')/);
      if (!tripleMatch || !tripleMatch[1]) {
        break;
      }
      const delimiter = String(tripleMatch[1] || '');
      const start = Number(tripleMatch.index || 0);
      const afterStart = structural.slice(start + delimiter.length);
      const closeRelativeIndex = afterStart.indexOf(delimiter);
      if (closeRelativeIndex < 0) {
        structural = structural.slice(0, start);
        inTripleQuote = delimiter;
        break;
      }
      structural = structural.slice(0, start) + afterStart.slice(closeRelativeIndex + delimiter.length);
    }

    if (!structural.trim()) {
      continue;
    }

    const neutralized = structural
      .replace(/"(?:\\.|[^"\\])*"/g, '')
      .replace(/'(?:\\.|[^'\\])*'/g, '');
    const normalizedTrimmed = neutralized.trim();
    if (looksLikeMalformedElixirEndToken(normalizedTrimmed)) {
      pendingBlocks = Math.max(0, pendingBlocks - 1);
      continue;
    }
    const delta = countBlockDelta(neutralized);
    if (delta > 0) {
      pendingBlocks += delta;
      lastOpenIndent = lineIndentation(rawLine);
      continue;
    }
    if (delta < 0) {
      pendingBlocks = Math.max(0, pendingBlocks + delta);
    }
  }

  if (pendingBlocks <= 0) {
    return [];
  }

  const snippet = Array.from({ length: pendingBlocks }, () => `${lastOpenIndent}end`).join('\n');
  return [{
    file,
    line: lines.length > 0 ? lines.length : 1,
    severity: 'error',
    kind: 'syntax_missing_delimiter',
    message: `Blocos do/end pendentes sem fechamento: ${pendingBlocks}`,
    suggestion: 'Adicione end para fechar os blocos abertos e restaurar a sintaxe do modulo.',
    snippet,
    action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
  }];
}

function checkElixirMalformedEndKeywordIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const meaningful = syntaxRelevantLine(rawLine, kind).trim();
    if (!looksLikeMalformedElixirEndToken(meaningful)) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_malformed_keyword',
      message: `Keyword 'end' malformada: '${meaningful}'`,
      suggestion: "Substitua pela keyword correta 'end' para fechar o bloco.",
      snippet: `${lineIndentation(rawLine)}end`,
      action: { op: 'replace_line' },
    });
  }
  return issues;
}

function looksLikeMalformedElixirEndToken(token) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized || normalized === 'end') {
    return false;
  }
  if (!/^[a-z]+$/.test(normalized)) {
    return false;
  }
  if (normalized.length < 3 || normalized.length > 5) {
    return false;
  }
  if (!normalized.includes('e') || !normalized.includes('n') || !normalized.includes('d')) {
    return false;
  }
  return levenshteinDistance(normalized, 'end') <= 1;
}

function checkElixirUnexpectedStandaloneTokenIssues(lines, file, kind) {
  if (!isElixirExtension(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = String(lines[index] || '');
    const trimmed = syntaxRelevantLine(rawLine, kind).trim();
    if (!/^[A-Z][A-Za-z0-9_?!]{0,23}$/.test(trimmed)) {
      continue;
    }

    const previous = findPreviousSyntaxLine(lines, index - 1, kind);
    const next = findNextSyntaxLine(lines, index + 1, kind);
    if (!next || !/^end\b/.test(next.trimmed)) {
      continue;
    }
    if (!previous) {
      continue;
    }

    const previousTrimmed = previous.trimmed;
    if (
      /(?:\bdo|\bfn|\bdefp?\b|\bdefmodule\b|\bcase\b|\bcond\b|\bwith\b)\s*$/.test(previousTrimmed)
      || /,$/.test(previousTrimmed)
      || /(?:\b(alias|import|require|use)\s+.+)$/.test(previousTrimmed)
    ) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_unexpected_token',
      message: `Token inesperado '${trimmed}' em linha isolada`,
      suggestion: `Remova o token '${trimmed}' para restaurar a sintaxe do bloco.`,
      snippet: lineIndentation(rawLine),
      action: { op: 'replace_line' },
    });
  }

  return issues;
}

module.exports = {
  checkElixirBlockDelimiterIssues,
  checkElixirMalformedEndKeywordIssues,
  checkElixirUnexpectedStandaloneTokenIssues,
};
