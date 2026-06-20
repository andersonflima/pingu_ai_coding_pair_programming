'use strict';

// Explica uma issue para o desenvolvedor: o que e, por que importa, como
// corrigir, se e suggest-only e como silenciar. Combina as explicacoes curadas
// (config/issue-explanations.json) com o contrato do kind (issue-kinds.json) e a
// familia/linguagens da taxonomia, sem depender do runtime de analise.

const explanations = require('../config/issue-explanations.json');
const issueKinds = require('../config/issue-kinds.json');
const taxonomy = require('../config/developer-error-taxonomy.json');

function explainableKinds() {
  return Object.keys(explanations).sort();
}

function findTaxonomyFamily(kind) {
  return taxonomy.families.find((family) => Array.isArray(family.mappedIssueKinds)
    && family.mappedIssueKinds.includes(kind)) || null;
}

function explainIssueKind(kind) {
  const normalized = String(kind || '').trim();
  const explanation = explanations[normalized];
  if (!explanation) {
    return null;
  }
  const contract = issueKinds[normalized] || {};
  const family = findTaxonomyFamily(normalized);
  const autoFixDefault = contract.autoFixDefault === true;

  return {
    kind: normalized,
    summary: explanation.summary,
    why: explanation.why,
    fix: explanation.fix,
    suggestOnly: !autoFixDefault,
    family: family ? family.id : null,
    languages: family && Array.isArray(family.languages) ? family.languages : [],
    silenceWith: `PINGU_DISABLED_ISSUE_KINDS=${normalized}`,
  };
}

function renderIssueExplanation(kind) {
  const detail = explainIssueKind(kind);
  if (!detail) {
    const known = explainableKinds();
    return [
      `Sem explicacao para o kind '${String(kind || '').trim()}'.`,
      '',
      'Kinds com explicacao disponivel:',
      ...known.map((entry) => `  ${entry}`),
    ].join('\n');
  }

  const lines = [
    `Pingu explica: ${detail.kind}`,
    '',
    `  O que e:   ${detail.summary}`,
    `  Por que:   ${detail.why}`,
    `  Como corrigir: ${detail.fix}`,
    `  Aplicacao: ${detail.suggestOnly ? 'suggest-only (nunca reescreve sozinho)' : 'auto-fix quando a transformacao e segura'}`,
  ];
  if (detail.family) {
    lines.push(`  Familia:   ${detail.family}`);
  }
  if (detail.languages.length > 0) {
    lines.push(`  Linguagens: ${detail.languages.join(', ')}`);
  }
  lines.push(`  Silenciar: ${detail.silenceWith}`);
  return lines.join('\n');
}

module.exports = {
  explainableKinds,
  explainIssueKind,
  renderIssueExplanation,
};
