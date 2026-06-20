'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

function generatedFunction(fileName, instruction) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-jvm-'));
  try {
    const file = path.join(dir, fileName);
    const source = `// @pingu code ${instruction}`;
    fs.writeFileSync(file, source);
    const task = analyzeText(file, source).filter((issue) => issue.kind === 'comment_task')[0];
    return task ? task.snippet : '';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('Java: gera assinatura idiomatica com tipos Object', () => {
  const snippet = generatedFunction('App.java', 'funcao soma que recebe a e b');
  assert.match(snippet, /public Object soma\(Object a, Object b\) \{/);
  assert.match(snippet, /return a \+ b;/);
});

test('C#: gera assinatura idiomatica com object', () => {
  const snippet = generatedFunction('Svc.cs', 'funcao soma que recebe a e b');
  assert.match(snippet, /public object soma\(object a, object b\) \{/);
  assert.match(snippet, /return a \+ b;/);
});

test('Kotlin: gera fun ... : Any', () => {
  const snippet = generatedFunction('m.kt', 'funcao soma que recebe a e b');
  assert.match(snippet, /fun soma\(a: Any, b: Any\): Any \{/);
  assert.match(snippet, /return a \+ b/);
});

test('Swift: gera func ... -> Any', () => {
  const snippet = generatedFunction('s.swift', 'funcao soma que recebe a e b');
  assert.match(snippet, /func soma\(_ a: Any, _ b: Any\) -> Any \{/);
  assert.match(snippet, /return a \+ b/);
});

test('Scala: gera def ... : Any =', () => {
  const snippet = generatedFunction('x.scala', 'funcao soma que recebe a e b');
  assert.match(snippet, /def soma\(a: Any, b: Any\): Any = \{/);
  assert.match(snippet, /return a \+ b/);
});

test('PHP: gera funcao com variaveis $ na assinatura e no corpo', () => {
  const snippet = generatedFunction('x.php', 'funcao soma que recebe a e b');
  assert.match(snippet, /function soma\(\$a, \$b\) \{/);
  assert.match(snippet, /return \$a \+ \$b;/);
  // nao deve sobrar parametro sem prefixo no corpo
  assert.doesNotMatch(snippet, /return a \+ b/);
});
