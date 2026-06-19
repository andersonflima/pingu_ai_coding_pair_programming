'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { buildInlineCommentedFunction, isCommentInstructionForFollowingCode } = require('../lib/generation-inline-comments');
const { buildLeadingFunctionDocumentation } = require('../lib/generation');
const { analyzeText } = require('../lib/analyzer');

function docFor(ext) {
  return (header) => (header ? buildLeadingFunctionDocumentation(header.name, header.params, 'comment this code', ext) : '');
}

function build(lines, ext) {
  return buildInlineCommentedFunction({ lines, triggerIndex: 0, ext, file: `sample${ext}`, buildDocstring: docFor(ext) });
}

function assertContainsInOrder(text, expectedLines) {
  const produced = text.split('\n');
  let cursor = 0;
  for (const expected of expectedLines) {
    const found = produced.indexOf(expected, cursor);
    assert.ok(found >= 0, `linha original ausente ou fora de ordem: ${JSON.stringify(expected)}`);
    cursor = found + 1;
  }
}

test('reconhece o pedido de comentar o codigo seguinte', () => {
  assert.equal(isCommentInstructionForFollowingCode('comment this code'), true);
  assert.equal(isCommentInstructionForFollowingCode('comente este codigo'), true);
  assert.equal(isCommentInstructionForFollowingCode('documente a funcao abaixo'), true);
  assert.equal(isCommentInstructionForFollowingCode('cria funcao soma'), false);
  assert.equal(isCommentInstructionForFollowingCode('comment'), false);
});

test('comenta funcao Python passo a passo com docstring idiomatico', () => {
  const lines = ['# : comment this code', 'def helper(planta, fert):', '    use_item(fert)', '    return planta'];
  const result = build(lines, '.py');
  assert.ok(result && result.snippet);
  assert.equal(result.action.op, 'replace_range');
  assert.match(result.snippet, /"""/);
  assert.match(result.snippet, /# Chama use_item\./);
  assert.match(result.snippet, /# Retorna planta\./);
});

test('preserva todas as linhas de codigo originais verbatim (Python)', () => {
  const lines = ['# : comment this code', 'def helper(planta, fert):', '    use_item(fert)', '    return planta'];
  const result = build(lines, '.py');
  assertContainsInOrder(result.snippet, lines.slice(1));
});

test('comenta funcao JavaScript com JSDoc antes da funcao', () => {
  const lines = ['//: comment this code', 'function soma(a, b) {', '  const total = a + b;', '  return total;', '}'];
  const result = build(lines, '.js');
  assert.ok(result && result.snippet);
  assert.match(result.snippet, /\/\*\*/);
  assert.match(result.snippet, /\/\/ Define total a partir de a \+ b\./);
  assert.match(result.snippet, /\/\/ Retorna total\./);
  const idx = result.snippet.indexOf('function soma');
  assert.ok(result.snippet.indexOf('/**') < idx, 'JSDoc deve vir antes da funcao');
});

test('e idempotente quando ja ha docstring e comentarios', () => {
  const lines = ['# : comment this code', 'def helper(p):', '    """', '    doc', '    """', '    # Chama foo.', '    foo(p)'];
  assert.equal(build(lines, '.py'), null);
});

test('nao gera para linguagem sem suporte', () => {
  assert.equal(build(['# : comment this code', 'def x(): pass'], '.rb'), null);
});

test('integracao: intents explicitos @pingu comment/doc ativam o fluxo inline', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-inline-intent-'));
  try {
    for (const trigger of ['# @pingu comment this code', '# pingu: comment this code', '# @pingu doc this function']) {
      const file = path.join(dir, 'sample.py');
      const source = [trigger, 'def helper(planta, fert):', '    use_item(fert)', '    return planta', ''].join('\n');
      fs.writeFileSync(file, source);
      const task = analyzeText(file, source).filter((issue) => issue.kind === 'comment_task')[0];
      assert.ok(task, `esperava comment_task para: ${trigger}`);
      assert.match(task.snippet, /# Chama use_item\./);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('integracao: # : comment this code vira comment_task com replace_range', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-inline-'));
  try {
    const file = path.join(dir, 'sample.py');
    const source = ['# : comment this code', 'def helper(planta, fert):', '    use_item(fert)', '    return planta', ''].join('\n');
    fs.writeFileSync(file, source);
    const task = analyzeText(file, source).filter((issue) => issue.kind === 'comment_task')[0];
    assert.ok(task, 'esperava um comment_task');
    assert.equal(task.action.op, 'replace_range');
    assert.match(task.snippet, /# Chama use_item\./);

    // Aplicar o replace_range remove o gatilho e preserva o codigo.
    const lines = source.split('\n');
    const range = task.action.range;
    const applied = lines.slice(0, range.start.line)
      .concat(task.snippet.split('\n'))
      .concat(lines.slice(range.end.line))
      .join('\n');
    assert.equal(applied.includes('# : comment this code'), false, 'gatilho deve ser removido');
    assert.match(applied, /def helper\(planta, fert\):/);
    assert.match(applied, /    use_item\(fert\)/);
    assert.match(applied, /    return planta/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
