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
const {
  isJavaScriptLikeExtension,
  isGoExtension,
  isRustExtension,
} = require('./language-profiles');

// Acima deste numero de pontos de decisao numa funcao, vale quebrar em partes.
// Threshold alto e deliberado: so as funcoes realmente densas devem aparecer,
// para nao reintroduzir o ruido que a auditoria de falso-positivo removeu.
const CYCLOMATIC_THRESHOLD = 30;
const DECISION_TOKENS = /\b(?:if|for|while|case|catch)\b|&&|\|\||\?\?/g;
const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else', 'do', 'try']);

function supportsBraceComplexity(ext) {
  const lower = String(ext || '').toLowerCase();
  return isJavaScriptLikeExtension(lower) || isGoExtension(lower) || isRustExtension(lower)
    || ['.c', '.cpp', '.h', '.hpp', '.java', '.cs'].includes(lower);
}

// Conta pontos de decisao por funcao (delimitada por chaves) e sinaliza as que
// passam do limiar. Aproximacao de complexidade ciclomatica: 1 + decisoes.
function checkCyclomaticComplexity(lines, file) {
  const ext = path.extname(String(file || '')).toLowerCase();
  if (!supportsBraceComplexity(ext)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const issues = [];
  const stack = [];

  for (let index = 0; index < source.length; index += 1) {
    const clean = removeInlineComment(source[index]);
    const opens = countMatches(/\{/g, clean);
    const closes = countMatches(/\}/g, clean);

    if (stack.length > 0) {
      const top = stack[stack.length - 1];
      top.decisions += countMatches(DECISION_TOKENS, clean);
    }

    if (opens > 0 && isFunctionHeader(clean)) {
      stack.push({ startLine: index + 1, depth: 0, decisions: countMatches(DECISION_TOKENS, clean) });
    }
    if (stack.length > 0) {
      stack[stack.length - 1].depth += opens - closes;
      while (stack.length > 0 && stack[stack.length - 1].depth <= 0) {
        const frame = stack.pop();
        const complexity = frame.decisions + 1;
        if (complexity > CYCLOMATIC_THRESHOLD) {
          issues.push({
            file,
            line: frame.startLine,
            severity: 'info',
            kind: 'high_complexity',
            message: `Funcao com complexidade alta (~${complexity} caminhos)`,
            suggestion: 'Extraia partes em funcoes auxiliares com nomes de dominio para reduzir os caminhos e facilitar teste e leitura.',
            snippet: '',
            action: { op: 'insert_before' },
          });
        }
      }
    }
  }
  return issues;
}

function isFunctionHeader(cleanLine) {
  const trimmed = String(cleanLine || '').trim();
  if (/\bfunction\b/.test(trimmed) || /=>\s*\{/.test(trimmed) || /\bfn\s+[A-Za-z_]/.test(trimmed) || /\bfunc\s/.test(trimmed)) {
    return true;
  }
  const method = trimmed.match(/^(?:(?:public|private|protected|static|async|override|final|[A-Za-z_][\w<>,\s*]*?)\s+)*([A-Za-z_$][\w$]*)\s*\([^;]*\)\s*(?:->[^{]+)?\{/);
  return Boolean(method && !CONTROL_KEYWORDS.has(method[1]));
}

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
  checkCyclomaticComplexity,
};
