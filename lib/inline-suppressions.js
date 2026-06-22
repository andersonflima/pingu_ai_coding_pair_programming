'use strict';

// Supressao inline de diagnosticos, no estilo de linters maduros (ESLint et al.).
// As diretivas vivem em comentario, entao sao casadas como substring da linha,
// independente da sintaxe de comentario da linguagem:
//
//   pingu-disable-line [kind ...]       -> suprime os kinds NA PROPRIA linha
//   pingu-disable-next-line [kind ...]  -> suprime os kinds na PROXIMA linha
//   pingu-disable-file [kind ...]       -> suprime os kinds no ARQUIVO inteiro
//
// Sem kinds listados, suprime todos os diagnosticos no alvo. Para explicar a
// supressao sem que o texto vire kind, use ` -- explicacao` no fim:
//   // pingu-disable-next-line self_assignment -- reset intencional do acumulador

const DIRECTIVE = /pingu-disable-(next-line|line|file)\b([^\n]*)/i;
const KIND_TOKEN = /^[a-z][a-z0-9_]+$/;
const ALL = '*';

// Remainder da diretiva -> conjunto de kinds, ou ALL quando nenhum kind e listado.
function parseKinds(rawRemainder) {
  const beforeProse = String(rawRemainder || '').split('--')[0];
  const tokens = beforeProse
    .split(/[\s,]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => KIND_TOKEN.test(token));
  if (tokens.length === 0) {
    return ALL;
  }
  return new Set(tokens);
}

function mergeScope(existing, incoming) {
  if (existing === ALL || incoming === ALL) {
    return ALL;
  }
  const merged = new Set(existing || []);
  for (const kind of incoming) {
    merged.add(kind);
  }
  return merged;
}

function buildSuppressionIndex(lines) {
  const lineMap = new Map();
  let fileScope = null;
  const source = Array.isArray(lines) ? lines : [];
  source.forEach((rawLine, index) => {
    const match = String(rawLine || '').match(DIRECTIVE);
    if (!match) {
      return;
    }
    const scope = match[1].toLowerCase();
    const kinds = parseKinds(match[2]);
    if (scope === 'file') {
      fileScope = mergeScope(fileScope, kinds);
      return;
    }
    // index e 0-based; linhas reportadas sao 1-based.
    const targetLine = scope === 'next-line' ? index + 2 : index + 1;
    lineMap.set(targetLine, mergeScope(lineMap.get(targetLine) || null, kinds));
  });
  return { lineMap, fileScope };
}

function scopeSuppresses(scope, kind) {
  if (!scope) {
    return false;
  }
  if (scope === ALL) {
    return true;
  }
  return scope.has(String(kind || ''));
}

function isIssueSuppressed(index, issue) {
  if (!index || !issue) {
    return false;
  }
  const kind = String(issue.kind || '');
  if (scopeSuppresses(index.fileScope, kind)) {
    return true;
  }
  return scopeSuppresses(index.lineMap.get(Number(issue.line || 0)), kind);
}

function applyInlineSuppressions(issues, lines) {
  const list = Array.isArray(issues) ? issues : [];
  const index = buildSuppressionIndex(lines);
  if (index.lineMap.size === 0 && !index.fileScope) {
    return list;
  }
  return list.filter((issue) => !isIssueSuppressed(index, issue));
}

module.exports = {
  applyInlineSuppressions,
  buildSuppressionIndex,
  isIssueSuppressed,
};
