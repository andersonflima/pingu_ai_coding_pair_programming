'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  explainableKinds,
  explainIssueKind,
  renderIssueExplanation,
} = require('../lib/issue-explainer');
const issueKinds = require('../config/issue-kinds.json');

test('explainIssueKind retorna detalhe estruturado para um kind conhecido', () => {
  const detail = explainIssueKind('chained_comparison');
  assert.equal(detail.kind, 'chained_comparison');
  assert.ok(detail.summary && detail.why && detail.fix);
  assert.equal(detail.suggestOnly, true);
  assert.equal(detail.silenceWith, 'PINGU_DISABLED_ISSUE_KINDS=chained_comparison');
  assert.ok(Array.isArray(detail.languages));
});

test('explainIssueKind reflete suggestOnly a partir de issue-kinds.json', () => {
  // bare_except tem autoFixDefault true; deve aparecer como nao-suggest-only.
  assert.equal(explainIssueKind('bare_except').suggestOnly, false);
  // chained_comparison e suggest-only.
  assert.equal(explainIssueKind('chained_comparison').suggestOnly, true);
});

test('explainIssueKind retorna null para kind desconhecido', () => {
  assert.equal(explainIssueKind('kind_inexistente'), null);
});

test('renderIssueExplanation lista os kinds disponiveis quando nao encontra', () => {
  const text = renderIssueExplanation('kind_inexistente');
  assert.match(text, /Sem explicacao/);
  assert.match(text, /chained_comparison/);
});

test('todo kind com explicacao existe em issue-kinds.json', () => {
  const missing = explainableKinds().filter((kind) => !(kind in issueKinds));
  assert.deepEqual(missing, [], `explicacoes orfas: ${missing.join(', ')}`);
});
