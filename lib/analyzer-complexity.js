'use strict';

// Checks de complexidade/fluxo extraidos do analyzer: reatribuicao imperativa
// de variavel em Elixir (sinaliza preferencia por fluxo funcional) e
// aninhamento alto de estruturas de controle. Funcoes puras, dependentes apenas
// de utilitarios do support.

const path = require('path');
const {
  escapeRegExp,
  countMatches,
  removeInlineComment,
  snippetFunctionalReassignment,
  snippetNestedCondition,
} = require('./support');

function checkFunctionalReassignment(lines, file) {
  const issues = [];
  const ext = path.extname(file).toLowerCase();
  if (!['.ex', '.exs'].includes(ext)) {
    return issues;
  }

  const isNotCodeLine = /(^\s*$|^\s*#|^\s*\/\/|^\s*--)/;

  lines.forEach((line, idx) => {
    if (isNotCodeLine.test(line)) {
      return;
    }
    const match = line.match(/^\s*([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(.+)$/);
    if (!match) {
      return;
    }

    const variable = match[1];
    const rightSide = match[2];
    if (!variable || rightSide.length === 0) {
      return;
    }
    const hasReference = variable !== 'ok' && new RegExp(`\\b${escapeRegExp(variable)}\\b`).test(rightSide);
    if (!hasReference) {
      return;
    }
    if (rightSide.includes(`&${variable}`) || rightSide.includes(`.${variable}`)) {
      return;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'functional_reassignment',
      message: `Reatribuicao de '${variable}' detectada`,
      suggestion: 'Considere fluxo funcional: nova variavel por etapa e nomes imutaveis.',
      snippet: snippetFunctionalReassignment(variable, rightSide.trim()),
    });
  });
  return issues;
}

function checkNestedConditionDepth(lines, file) {
  const openers = /\b(if|cond|case|with|for|unless)\b/g;
  const closer = /^\s*end\b/;
  let depth = 0;
  let maxDepth = 0;
  const byLine = {};
  lines.forEach((line, idx) => {
    const clean = removeInlineComment(line);
    const opens = countMatches(openers, clean);
    const ends = closer.test(clean) ? 1 : 0;
    const newDepth = depth + opens;
    if (newDepth > maxDepth) {
      maxDepth = newDepth;
    }
    byLine[idx + 1] = newDepth;
    depth = Math.max(newDepth - ends, 0);
  });
  if (maxDepth <= 4) {
    return [];
  }
  const deepLine = Object.entries(byLine).find(([, depthByLine]) => depthByLine === maxDepth);
  return [{
    file,
    line: Number(deepLine ? deepLine[0] : 1),
    severity: 'warning',
    kind: 'nested_condition',
    message: `Aninhamento alto de controle (profundidade ${maxDepth})`,
    suggestion: 'Quebre logica complexa em funcoes pequenas e funcoes auxiliares com nomes de dominio.',
    snippet: snippetNestedCondition(),
  }];
}

module.exports = {
  checkFunctionalReassignment,
  checkNestedConditionDepth,
};
