'use strict';

// Agregador dos checks de sintaxe: estrutura geral (aspas/delimitadores/blocos),
// fences de markdown, delimitadores e keywords malformadas de Elixir, e virgulas
// faltantes em colecoes. E compartilhado entre o pipeline de analise e os checks
// de escopo (que usam a presenca de erro de sintaxe como guarda), por isso vive
// em modulo proprio para evitar acoplamento circular.

const { scanSyntaxStructure, checkMissingCommaIssues } = require('./analyzer-syntax-scan');
const { checkMarkdownFenceIssues } = require('./analyzer-structured-text');
const {
  checkElixirBlockDelimiterIssues,
  checkElixirMalformedEndKeywordIssues,
  checkElixirUnexpectedStandaloneTokenIssues,
} = require('./analyzer-elixir-syntax');

function checkSyntaxIssues(lines, file, kind) {
  const syntaxScan = scanSyntaxStructure(lines, kind);
  return [
    ...checkMarkdownFenceIssues(lines, file, kind),
    ...syntaxScan.issues.map((issue) => ({ ...issue, file })),
    ...checkElixirBlockDelimiterIssues(lines, file, kind),
    ...checkElixirMalformedEndKeywordIssues(lines, file, kind),
    ...checkElixirUnexpectedStandaloneTokenIssues(lines, file, kind),
    ...checkMissingCommaIssues(lines, file, kind, syntaxScan.collectionContexts),
  ];
}

module.exports = {
  checkSyntaxIssues,
};
