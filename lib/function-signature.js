'use strict';

// Parsing de assinatura de funcao compartilhado pelos checks de escopo,
// documentacao e specs: nomes de parametros, variaveis ligadas em padroes e a
// declaracao de funcoes Elixir (def/defp, com clausula de guarda e forma
// `, do:`). Funcoes puras, dependentes apenas de utilitarios do support.

const { sanitizeIdentifier, splitTopLevelParams, isReservedToken } = require('./support');

function normalizeElixirFunctionHeaderSource(source) {
  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTrailingElixirGuardClause(source) {
  const normalized = String(source || '').trim();
  if (!normalized) {
    return '';
  }
  const match = normalized.match(/^(.*?)(?:\s+when\s+.+)$/i);
  return match ? String(match[1] || '').trim() : normalized;
}

function parseElixirFunctionDeclarationSource(source) {
  const normalized = normalizeElixirFunctionHeaderSource(source);
  const match = normalized.match(/^\s*(defp?)\s+([a-z_][a-zA-Z0-9_?!]*)(.*)$/i);
  if (!match) {
    return null;
  }

  let remainder = String(match[3] || '').trim();
  if (!remainder || !/(?:\bdo\b|,\s*do:\s*)/.test(remainder)) {
    return null;
  }

  remainder = remainder
    .replace(/,\s*do:\s*.*$/i, '')
    .replace(/\bdo\b.*$/i, '')
    .trim();

  let rawParams = '';
  if (remainder.startsWith('(')) {
    const closingIndex = remainder.lastIndexOf(')');
    if (closingIndex <= 0) {
      return null;
    }
    rawParams = remainder.slice(1, closingIndex).trim();
  } else {
    rawParams = stripTrailingElixirGuardClause(remainder);
  }

  return {
    visibility: match[1],
    name: sanitizeIdentifier(match[2]),
    params: parseFunctionParams(rawParams),
    scopeParams: parseFunctionScopeParams(rawParams),
    paramArity: splitTopLevelParams(rawParams).length,
  };
}

function readElixirFunctionDeclaration(lines, startIdx) {
  const firstLine = String(lines[startIdx] || '');
  if (!/^\s*defp?\b/.test(firstLine)) {
    return null;
  }

  const headerLines = [];
  const maxHeaderLines = Math.min(lines.length, startIdx + 12);
  for (let idx = startIdx; idx < maxHeaderLines; idx += 1) {
    const currentLine = String(lines[idx] || '');
    if (idx > startIdx && !currentLine.trim()) {
      break;
    }
    headerLines.push(currentLine);
    const parsed = parseElixirFunctionDeclarationSource(headerLines.join('\n'));
    if (parsed) {
      return {
        ...parsed,
        startIdx,
        endIdx: idx,
        headerText: normalizeElixirFunctionHeaderSource(headerLines.join('\n')),
      };
    }
  }

  const parsedSingleLine = parseElixirFunctionDeclarationSource(firstLine);
  if (!parsedSingleLine) {
    return null;
  }

  return {
    ...parsedSingleLine,
    startIdx,
    endIdx: startIdx,
    headerText: normalizeElixirFunctionHeaderSource(firstLine),
  };
}

function parseFunctionDeclaration(line) {
  return parseElixirFunctionDeclarationSource(line);
}

function parseFunctionParams(raw) {
  const tokens = splitTopLevelParams(raw);
  if (tokens.length === 0) {
    return [];
  }
  return tokens
    .map((token) => extractParamName(token))
    .filter((token) => token.length > 0);
}

function parseFunctionScopeParams(raw) {
  const names = new Set();
  splitTopLevelParams(raw).forEach((token) => {
    extractBoundPatternVars(token).forEach((name) => names.add(name));
  });
  return Array.from(names);
}

function extractParamName(token) {
  const rawToken = String(token || '').trim();
  const match = rawToken.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)(?:\s*=.*)?\s*$/);
  if (match) {
    return match[1];
  }

  const rightMatch = rawToken.match(/=\s*([a-z_][a-zA-Z0-9_?!]*)\s*$/);
  if (rightMatch && rightMatch[1]) {
    return rightMatch[1];
  }

  const scopedMatches = extractBoundPatternVars(rawToken);
  if (scopedMatches.length > 0) {
    return scopedMatches[scopedMatches.length - 1];
  }

  return '';
}

function extractBoundPatternVars(pattern) {
  const source = String(pattern || '').trim();
  if (!source) {
    return [];
  }

  const names = new Set();
  [...source.matchAll(/\b([a-z_][a-zA-Z0-9_?!]*)\b/g)].forEach((match) => {
    const identifier = String(match[1] || '');
    if (!identifier || isReservedToken(identifier)) {
      return;
    }
    const nextChar = source[match.index + identifier.length] || '';
    const previousChar = match.index > 0 ? source[match.index - 1] : '';
    if (nextChar === ':' || previousChar === ':') {
      return;
    }
    names.add(identifier);
  });

  return Array.from(names);
}

module.exports = {
  normalizeElixirFunctionHeaderSource,
  stripTrailingElixirGuardClause,
  parseElixirFunctionDeclarationSource,
  readElixirFunctionDeclaration,
  parseFunctionDeclaration,
  parseFunctionParams,
  parseFunctionScopeParams,
  extractParamName,
  extractBoundPatternVars,
};
