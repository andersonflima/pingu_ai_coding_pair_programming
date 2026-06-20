'use strict';

// Riscos de nomeacao em Python que o interpretador aceita em silencio:
//   - shadowing de builtin: `list = [...]` mascara a funcao `list` no escopo,
//     quebrando usos posteriores como `list(x)`;
//   - typo em metodo dunder: `def __inti__` nunca e chamado pelo protocolo de
//     dados, entao o comportamento esperado (p.ex. construcao) some.
// Ambos suggest-only: o Pingu sinaliza e aponta a intencao provavel, sem
// reescrever (renomear pode colidir com o restante do escopo).

const { isPythonLikeExtension } = require('./language-profiles');
const { levenshteinDistance } = require('./identifier-similarity');

// Builtins comumente sobrescritos por acidente, com alta chance de colisao.
const SHADOWABLE_BUILTINS = new Set([
  'list', 'dict', 'set', 'str', 'int', 'float', 'tuple', 'bytes', 'bool',
  'id', 'type', 'input', 'max', 'min', 'sum', 'len', 'sorted', 'filter',
  'map', 'zip', 'range', 'next', 'iter', 'open', 'object', 'hash', 'format',
  'vars', 'all', 'any', 'dir', 'bytearray', 'frozenset', 'complex',
]);

// Metodos especiais (dunder) reconhecidos pelo modelo de dados do Python.
const KNOWN_DUNDERS = new Set([
  'init', 'new', 'del', 'repr', 'str', 'bytes', 'format', 'hash', 'bool',
  'call', 'len', 'length_hint', 'getitem', 'setitem', 'delitem', 'missing',
  'iter', 'next', 'reversed', 'contains', 'enter', 'exit', 'add', 'sub',
  'mul', 'matmul', 'truediv', 'floordiv', 'mod', 'divmod', 'pow', 'lshift',
  'rshift', 'and', 'or', 'xor', 'neg', 'pos', 'abs', 'invert', 'round',
  'trunc', 'floor', 'ceil', 'index', 'int', 'float', 'complex', 'lt', 'le',
  'eq', 'ne', 'gt', 'ge', 'getattr', 'getattribute', 'setattr', 'delattr',
  'dir', 'get', 'set', 'delete', 'set_name', 'slots', 'class', 'dict', 'doc',
  'module', 'name', 'qualname', 'await', 'aiter', 'anext', 'aenter', 'aexit',
  'copy', 'deepcopy', 'sizeof', 'instancecheck', 'subclasscheck', 'post_init',
]);

function checkPythonNamingHazards(lines, file, kind, opts = {}) {
  if (!isPythonLikeExtension(kind)) {
    return [];
  }
  const focusRange = opts.focusRange || null;
  return (Array.isArray(lines) ? lines : []).flatMap((rawLine, index) => {
    const lineNumber = index + 1;
    if (!isLineInFocus(focusRange, lineNumber)) {
      return [];
    }
    const line = String(rawLine || '');
    return [
      checkShadowedBuiltin(line, file, lineNumber),
      checkDunderTypo(line, file, lineNumber),
    ].filter(Boolean);
  });
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function checkShadowedBuiltin(line, file, lineNumber) {
  // Atribuicao simples `nome = ...` (um unico '=', sem anotacao de tipo, sem
  // atributo/subscrito no LHS e sem operador composto).
  const match = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=)/);
  if (!match) {
    return null;
  }
  const name = match[2];
  if (!SHADOWABLE_BUILTINS.has(name)) {
    return null;
  }
  // Operadores compostos (+=, -=, ...) ja foram excluidos pelo `=(?!=)` apenas
  // parcialmente; rejeita explicitamente o caractere anterior ser um operador.
  const beforeEquals = line.slice(0, line.indexOf('=', match[1].length + name.length));
  if (/[+\-*/%&|^@:]\s*$/.test(beforeEquals)) {
    return null;
  }

  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'shadowed_builtin',
    message: `Atribuicao sobrescreve o builtin '${name}'`,
    suggestion: `Renomeie a variavel (p.ex. '${name}_' ou um nome de dominio) para nao mascarar o builtin '${name}' no escopo.`,
    snippet: '',
    action: { op: 'insert_before' },
  };
}

function checkDunderTypo(line, file, lineNumber) {
  const match = line.match(/^\s*(?:async\s+)?def\s+(__[A-Za-z0-9_]+__)\s*\(/);
  if (!match) {
    return null;
  }
  const dunder = match[1];
  const core = dunder.slice(2, -2);
  if (!core || KNOWN_DUNDERS.has(core)) {
    return null;
  }
  // Procura o dunder conhecido a um unico erro de edicao: uma substituicao/
  // insercao/remocao (Levenshtein 1) ou uma transposicao de caracteres
  // adjacentes (Damerau), que cobre enganos como `inti` por `init`.
  let best = '';
  for (const known of KNOWN_DUNDERS) {
    if (Math.abs(known.length - core.length) > 1) {
      continue;
    }
    if (levenshteinDistance(core, known) === 1 || isAdjacentTransposition(core, known)) {
      best = known;
      break;
    }
  }
  if (!best) {
    return null;
  }

  return {
    file,
    line: lineNumber,
    severity: 'warning',
    kind: 'dunder_typo',
    message: `Metodo dunder '${dunder}' parece um erro de digitacao`,
    suggestion: `Voce quis dizer '__${best}__'? Como esta, o metodo nao e chamado pelo protocolo de dados do Python.`,
    snippet: '',
    action: { op: 'insert_before' },
  };
}

// Verdadeiro quando `a` vira `b` trocando exatamente um par de caracteres
// adjacentes (mesmo comprimento, dois indices diferentes e contiguos invertidos).
function isAdjacentTransposition(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  const diffs = [];
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      diffs.push(i);
      if (diffs.length > 2) {
        return false;
      }
    }
  }
  return diffs.length === 2
    && diffs[1] === diffs[0] + 1
    && a[diffs[0]] === b[diffs[1]]
    && a[diffs[1]] === b[diffs[0]];
}

module.exports = {
  checkPythonNamingHazards,
};
