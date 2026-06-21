'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeText } = require('../lib/analyzer');

// Guard de regressao de ruido: roda o Pingu sobre o proprio lib/ (codigo correto
// e testado) e trava o nivel de ruido apurado na auditoria de falso-positivo.
// Pega regressoes — p.ex. uma mudanca no scanner que volte a gerar milhares de
// avisos de sintaxe em codigo que compila — sem exigir zero, ja que resta um
// tail conhecido de casos de borda (regex/template) que so um parser real
// resolveria.

// Kinds de bug/seguranca/sintaxe que, em codigo correto, indicam falso positivo.
const STRUCTURAL_KINDS = new Set([
  'undefined_variable',
  'syntax_missing_comma',
  'syntax_extra_delimiter',
  'syntax_missing_quote',
  'syntax_missing_delimiter',
  'syntax_malformed_keyword',
  'hardcoded_secret',
  'command_injection',
  'unsafe_deserialization',
  'chained_comparison',
  'literal_identity_comparison',
  'self_comparison',
  'self_assignment',
  'duplicate_key',
  'invalid_typeof',
  'nan_comparison',
]);

// Tetos com folga sobre o baseline atual (estrutural ~142, total ~1030). Subir
// alem disso e sinal de regressao a investigar (ou de baixar o teto de proposito
// apos uma melhora).
const STRUCTURAL_CEILING = 150;
const TOTAL_CEILING = 1100;

let cachedReport = null;
function analyzeLibrary() {
  if (cachedReport) {
    return cachedReport;
  }
  const dir = path.resolve(__dirname, '..', 'lib');
  const files = fs.readdirSync(dir).filter((name) => name.endsWith('.js'));
  const structuralByKind = {};
  let total = 0;
  let structural = 0;

  for (const name of files) {
    const filePath = path.join(dir, name);
    const issues = analyzeText(filePath, fs.readFileSync(filePath, 'utf8'));
    total += issues.length;
    for (const issue of issues) {
      if (STRUCTURAL_KINDS.has(issue.kind)) {
        structural += 1;
        structuralByKind[issue.kind] = (structuralByKind[issue.kind] || 0) + 1;
      }
    }
  }
  cachedReport = { files: files.length, total, structural, structuralByKind };
  return cachedReport;
}

test('o Pingu nao regride em ruido estrutural sobre o proprio lib/', () => {
  const report = analyzeLibrary();
  assert.ok(
    report.structural <= STRUCTURAL_CEILING,
    `falso positivo estrutural subiu para ${report.structural} (teto ${STRUCTURAL_CEILING}): ${JSON.stringify(report.structuralByKind)}`,
  );
});

test('o total de issues sobre o proprio lib/ fica abaixo do teto', () => {
  const report = analyzeLibrary();
  assert.ok(
    report.total <= TOTAL_CEILING,
    `total de issues subiu para ${report.total} (teto ${TOTAL_CEILING})`,
  );
});
