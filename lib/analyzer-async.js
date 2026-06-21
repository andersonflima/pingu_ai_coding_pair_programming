'use strict';

// Deteccao conservadora de await ausente em JavaScript/TypeScript: chamada a uma
// funcao async definida no proprio arquivo, usada como instrucao isolada
// (fire-and-forget), sem await/return/void e sem encadear .then/.catch. Esse
// padrao costuma ser um bug de ordem de execucao ou rejeicao nao tratada.
// Suggest-only: o Pingu sinaliza, mas nunca reescreve sozinho (adicionar await
// muda a semantica e exige funcao async no escopo).

const { isJavaScriptLikeExtension } = require('./language-profiles');

function checkMissingAwait(lines, file, kind, opts = {}) {
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const asyncNames = collectAsyncFunctionNames(source);
  if (asyncNames.size === 0) {
    return [];
  }

  const focusRange = opts.focusRange || null;
  const issues = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!isLineInFocus(focusRange, index + 1)) {
      continue;
    }
    const name = bareFireAndForgetCallName(source[index], asyncNames);
    if (!name) {
      continue;
    }
    issues.push({
      file,
      line: index + 1,
      severity: 'warning',
      kind: 'missing_await',
      message: `Chamada async '${name}' sem await`,
      suggestion: 'Adicione await (em funcao async), retorne a promise ou use void para fire-and-forget intencional.',
      snippet: '',
      action: { op: 'insert_before' },
    });
  }
  return issues;
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function collectAsyncFunctionNames(lines) {
  const names = new Set();
  lines.forEach((line) => {
    let match;
    if ((match = line.match(/\basync\s+function\s*\*?\s*([A-Za-z_$][\w$]*)/))) {
      names.add(match[1]);
    }
    if ((match = line.match(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b/))) {
      names.add(match[1]);
    }
    // Metodo de classe/objeto: `async nome(` (evita palavras-chave de controle).
    if ((match = line.match(/^\s*(?:(?:public|private|protected|static|readonly|override)\s+)*async\s+([A-Za-z_$][\w$]*)\s*\(/))) {
      if (!['function', 'if', 'for', 'while', 'switch', 'catch'].includes(match[1])) {
        names.add(match[1]);
      }
    }
  });
  return names;
}

function bareFireAndForgetCallName(line, asyncNames) {
  const trimmed = String(line || '').trim();
  // A linha deve ser exatamente uma chamada: nome(...) ou this.nome(...), com ; opcional.
  const match = trimmed.match(/^(?:this\.)?([A-Za-z_$][\w$]*)\s*\([^]*\)\s*;?$/);
  if (!match) {
    return '';
  }
  const name = match[1];
  if (!asyncNames.has(name)) {
    return '';
  }
  // Encadeamento .then/.catch/.finally ja trata a promise.
  if (/\)\s*\.(?:then|catch|finally)\b/.test(trimmed)) {
    return '';
  }
  // Prefixos que ja consomem a promise.
  if (/^(?:await|return|void|yield)\b/.test(trimmed)) {
    return '';
  }
  // Atribuicao (a promise pode ser awaited depois) — fora do escopo conservador.
  if (/^[^(]*=[^=]/.test(trimmed)) {
    return '';
  }
  return name;
}

// Deteccao conservadora de await dentro de loop sequencial em JS/TS: cada
// iteracao espera a anterior, o que costuma ser oportunidade de paralelizar com
// Promise.all. Suggest-only e nunca em `for await...of` (a forma sequencial
// intencional) nem quando o await ja envolve Promise.all/allSettled/race.
function checkAwaitInLoop(lines, file, kind, opts = {}) {
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const focusRange = opts.focusRange || null;
  const issues = [];
  // Pilha de blocos abertos por '{', classificada pela linha que os abriu.
  const frames = [];

  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (
      isLineInFocus(focusRange, index + 1)
      && /\bawait\b/.test(line)
      && !/\bfor\s+await\b/.test(line)
      && !/\bawait\s+Promise\s*\.\s*(?:all|allSettled|race)\b/.test(line)
      && nearestBoundaryIsLoop(frames)
    ) {
      issues.push({
        file,
        line: index + 1,
        severity: 'warning',
        kind: 'await_in_loop',
        message: 'await dentro de loop executa as iteracoes em sequencia',
        suggestion: 'Se as iteracoes forem independentes, colete as promises e use await Promise.all para paralelizar.',
        snippet: '',
        action: { op: 'insert_before' },
      });
    }
    updateBlockFrames(frames, line);
  }
  return issues;
}

// Caminha a pilha do bloco mais interno para fora: se encontrar um loop antes de
// uma fronteira de funcao, o await pertence diretamente ao corpo do loop.
function nearestBoundaryIsLoop(frames) {
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    if (frames[i] === 'func') {
      return false;
    }
    if (frames[i] === 'loop') {
      return true;
    }
  }
  return false;
}

const CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'else']);

function classifyBlockOpener(line) {
  if (/(?:^|[^.\w])(?:for|while)\b/.test(line) && !/\bfor\s+await\b/.test(line)) {
    return 'loop';
  }
  if (/\bfunction\b/.test(line) || /=>\s*\{/.test(line)) {
    return 'func';
  }
  // Metodo abreviado: modificadores opcionais + nome(...) { , exceto blocos de
  // controle (if/else/try...) que tambem terminam em `) {` mas nao sao funcao.
  const method = line.trim().match(/^(?:(?:async|static|public|private|protected|override|readonly|get|set|\*)\s+)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/);
  if (method && !CONTROL_KEYWORDS.has(method[1])) {
    return 'func';
  }
  return 'other';
}

function updateBlockFrames(frames, line) {
  const opens = (line.match(/\{/g) || []).length;
  const closes = (line.match(/\}/g) || []).length;
  if (opens > 0) {
    const kind = classifyBlockOpener(line);
    for (let i = 0; i < opens; i += 1) {
      frames.push(i === 0 ? kind : 'other');
    }
  }
  for (let i = 0; i < closes; i += 1) {
    frames.pop();
  }
}

// Callback async em metodos de array que dependem do retorno sincrono
// (.forEach nao espera; .filter/.some/.every/.find recebem uma promise, sempre
// truthy). Quase sempre um bug: o await dentro nao sequencia e o predicado nao
// funciona. .map fica de fora (e correto com await Promise.all(...)).
const SYNC_ARRAY_METHODS = '(?:forEach|filter|some|every|find|findIndex|sort)';
const ASYNC_ARRAY_METHOD_PATTERN = new RegExp(`\\.${SYNC_ARRAY_METHODS}\\s*\\(\\s*async\\b`);

function checkAsyncArrayMethods(lines, file, kind, opts = {}) {
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const focusRange = opts.focusRange || null;
  const issues = [];
  for (let index = 0; index < source.length; index += 1) {
    if (!isLineInFocus(focusRange, index + 1)) {
      continue;
    }
    const match = source[index].match(new RegExp(`\\.(${SYNC_ARRAY_METHODS})\\s*\\(\\s*async\\b`));
    if (!ASYNC_ARRAY_METHOD_PATTERN.test(source[index]) || !match) {
      continue;
    }
    issues.push({
      file,
      line: index + 1,
      severity: 'warning',
      kind: 'async_array_method',
      message: `Callback async em .${match[1]} ignora a promise (sem await / predicado sempre truthy)`,
      suggestion: 'Use um for...of com await, ou await Promise.all(arr.map(async ...)) e itere/filtre sobre o resultado ja resolvido.',
      snippet: '',
      action: { op: 'insert_before' },
    });
  }
  return issues;
}

module.exports = {
  checkMissingAwait,
  checkAwaitInLoop,
  checkAsyncArrayMethods,
};
