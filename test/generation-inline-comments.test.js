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
  return (header, context) => (header
    ? buildLeadingFunctionDocumentation(header.name, header.params, 'comment this code', ext, context || {})
    : '');
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

test('o resumo da docstring descreve o que a funcao faz (proposito estrutural)', () => {
  const py = build(['# : comment this code', 'def total(items):', '    acc = 0', '    for i in items:', '        acc += i', '    return acc'], '.py');
  assert.match(py.snippet, /Calcula acc e retorna acc\./);
  assert.doesNotMatch(py.snippet, /Executa a etapa principal/);

  const js = build(['//: comment this code', 'function helper(a, b) {', '  const total = a + b;', '  log(total);', '  return total;', '}'], '.js');
  assert.match(js.snippet, /Aciona log e retorna total\./);
});

test('o resumo infere a intencao pelo nome da funcao (melhor offline)', () => {
  const py = build(['# : comment this code', 'def calcula_frete(pedido):', '    total = pedido.base', '    return total'], '.py');
  assert.match(py.snippet, /Calcula frete, retornando total\./);

  const js = build(['//: comment this code', 'function fetchUser(id) {', '  const user = db.find(id);', '  return user;', '}'], '.js');
  assert.match(js.snippet, /Busca user, retornando user\./);
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

const LANGUAGE_CASES = [
  {
    label: 'Go',
    ext: '.go',
    lines: ['// : comment this code', 'func Soma(a int, b int) int {', '\ttotal := a + b', '\treturn total', '}'],
    code: ['func Soma(a int, b int) int {', '\ttotal := a + b', '\treturn total', '}'],
    expect: [/retornando total/, /\/\/ Define total a partir de a \+ b\./, /\/\/ Retorna total\./],
  },
  {
    label: 'Rust',
    ext: '.rs',
    lines: ['// : comment this code', 'pub fn soma(a: i32, b: i32) -> i32 {', '    let total = a + b;', '    return total;', '}'],
    code: ['pub fn soma(a: i32, b: i32) -> i32 {', '    let total = a + b;', '    return total;', '}'],
    expect: [/\/\/\//, /\/\/ Define total a partir de a \+ b\./, /\/\/ Retorna total\./],
  },
  {
    label: 'Ruby',
    ext: '.rb',
    lines: ['# : comment this code', 'def calcula(itens)', '  soma = 0', '  return soma', 'end'],
    code: ['def calcula(itens)', '  soma = 0', '  return soma', 'end'],
    expect: [/# Calcula/, /# Atribui 0 a soma\./, /# Retorna soma\./],
  },
  {
    label: 'Elixir',
    ext: '.ex',
    lines: ['# : comment this code', 'def soma(a, b) do', '  total = a + b', '  total', 'end'],
    code: ['def soma(a, b) do', '  total = a + b', '  total', 'end'],
    expect: [/@doc/, /# Atribui a \+ b a total\./],
  },
  {
    label: 'Lua',
    ext: '.lua',
    lines: ['-- : comment this code', 'function calcula(a, b)', '  local total = a + b', '  return total', 'end'],
    code: ['function calcula(a, b)', '  local total = a + b', '  return total', 'end'],
    expect: [/-- Calcula/, /-- Atribui a \+ b a total\./, /-- Retorna total\./],
  },
  {
    label: 'Vim',
    ext: '.vim',
    lines: ['" : comment this code', 'function! MyFunc(a, b)', '  let l:total = a:a + a:b', '  return l:total', 'endfunction'],
    code: ['function! MyFunc(a, b)', '  let l:total = a:a + a:b', '  return l:total', 'endfunction'],
    expect: [/" Atribui a:a \+ a:b a l:total\./, /" Retorna l:total\./],
  },
  {
    label: 'C',
    ext: '.c',
    lines: ['// : comment this code', 'int soma(int a, int b) {', '    int total = a + b;', '    return total;', '}'],
    code: ['int soma(int a, int b) {', '    int total = a + b;', '    return total;', '}'],
    expect: [/\/\/ Soma/, /\/\/ Retorna total\./],
  },
  {
    label: 'Shell',
    ext: '.sh',
    lines: ['# : comment this code', 'deploy() {', '  build_app', '  return 0', '}'],
    code: ['deploy() {', '  build_app', '  return 0', '}'],
    expect: [/# Executa o comando build_app\./, /# Retorna 0\./],
  },
  {
    label: 'Java',
    ext: '.java',
    lines: ['// : comment this code', 'public int soma(int a, int b) {', '    int total = a + b;', '    return total;', '}'],
    code: ['public int soma(int a, int b) {', '    int total = a + b;', '    return total;', '}'],
    expect: [/\/\*\*/, /@return total/, /\/\/ Retorna total\./],
  },
  {
    label: 'C#',
    ext: '.cs',
    lines: ['// : comment this code', 'public int Soma(int a) {', '    return a;', '}'],
    code: ['public int Soma(int a) {', '    return a;', '}'],
    expect: [/\/\/\/ /, /\/\/ Retorna a\./],
  },
  {
    label: 'Kotlin',
    ext: '.kt',
    lines: ['// : comment this code', 'fun calculaFrete(pedido: Int): Int {', '    val total = pedido + 1', '    return total', '}'],
    code: ['fun calculaFrete(pedido: Int): Int {', '    val total = pedido + 1', '    return total', '}'],
    expect: [/\/\*\*/, /Calcula frete/, /\/\/ Define total a partir de pedido \+ 1\./],
  },
  {
    label: 'Swift',
    ext: '.swift',
    lines: ['// : comment this code', 'func soma(a: Int, b: Int) -> Int {', '    let total = a + b', '    return total', '}'],
    code: ['func soma(a: Int, b: Int) -> Int {', '    let total = a + b', '    return total', '}'],
    expect: [/\/\/\/ /, /\/\/ Define total a partir de a \+ b\./, /\/\/ Retorna total\./],
  },
  {
    label: 'Scala',
    ext: '.scala',
    lines: ['// : comment this code', 'def soma(a: Int, b: Int): Int = {', '    val total = a + b', '    total', '}'],
    code: ['def soma(a: Int, b: Int): Int = {', '    val total = a + b', '    total', '}'],
    expect: [/\/\*\*/, /\/\/ Define total a partir de a \+ b\./],
  },
  {
    label: 'PHP',
    ext: '.php',
    lines: ['// : comment this code', 'function calc($x) {', '    $y = $x + 1;', '    return $y;', '}'],
    code: ['function calc($x) {', '    $y = $x + 1;', '    return $y;', '}'],
    expect: [/\/\*\*/, /\/\/ Define \$y a partir de \$x \+ 1\./, /\/\/ Retorna \$y\./],
  },
];

for (const testCase of LANGUAGE_CASES) {
  test(`comenta e preserva o codigo em ${testCase.label}`, () => {
    const result = build(testCase.lines, testCase.ext);
    assert.ok(result && result.snippet, `esperava snippet para ${testCase.label}`);
    assert.equal(result.action.op, 'replace_range');
    for (const pattern of testCase.expect) {
      assert.match(result.snippet, pattern, `${testCase.label}: faltou ${pattern}`);
    }
    assertContainsInOrder(result.snippet, testCase.code);
  });
}

test('integracao: novas linguagens geram comment_task pelo pipeline real', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-newlang-'));
  try {
    const cases = [
      ['App.java', '// : comment this code\npublic int soma(int a, int b) {\n    return a + b;\n}'],
      ['app.php', '<?php\n// : comment this code\nfunction calc($x) {\n    return $x + 1;\n}'],
      ['Svc.cs', '// : comment this code\npublic int Soma(int a) {\n    return a;\n}'],
      ['m.kt', '// : comment this code\nfun soma(a: Int): Int {\n    return a\n}'],
      ['s.swift', '// : comment this code\nfunc soma(a: Int) -> Int {\n    return a\n}'],
      ['x.scala', '// : comment this code\ndef soma(a: Int): Int = {\n    a\n}'],
    ];
    for (const [name, source] of cases) {
      const file = path.join(dir, name);
      fs.writeFileSync(file, source);
      const task = analyzeText(file, source).filter((issue) => issue.kind === 'comment_task')[0];
      assert.ok(task, `esperava comment_task para ${name}`);
      assert.equal(task.action.op, 'replace_range');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
