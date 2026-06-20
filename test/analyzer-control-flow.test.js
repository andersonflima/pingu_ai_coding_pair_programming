'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkControlFlowSmells } = require('../lib/analyzer-control-flow');
const { issueKindConfig } = require('../lib/issue-kinds');

function smells(source, ext) {
  return checkControlFlowSmells(source.split('\n'), `sample${ext}`, ext);
}

function kindsAt(source, ext) {
  return smells(source, ext).map((issue) => `${issue.kind}@${issue.line}`);
}

test('os novos kinds sao suggest-only (nunca auto-fix)', () => {
  assert.equal(issueKindConfig('unreachable_code').autoFixDefault, false);
  assert.equal(issueKindConfig('swallowed_error').autoFixDefault, false);
});

test('detecta codigo inalcancavel em JavaScript apos return/throw', () => {
  assert.deepEqual(kindsAt('function f() {\n  return 1;\n  doStuff();\n}', '.js'), ['unreachable_code@3']);
  assert.deepEqual(kindsAt('function f() {\n  throw err;\n  cleanup();\n}', '.js'), ['unreachable_code@3']);
});

test('detecta codigo inalcancavel em Python apos return/raise/break', () => {
  assert.deepEqual(kindsAt('def f():\n    return 1\n    x = 2', '.py'), ['unreachable_code@3']);
  assert.deepEqual(kindsAt('def f():\n    raise Erro()\n    cleanup()', '.py'), ['unreachable_code@3']);
});

test('nao acusa inalcancavel quando o terminal esta dentro de um if', () => {
  assert.deepEqual(kindsAt('function f() {\n  if (x) return 1;\n  doStuff();\n}', '.js'), []);
  assert.deepEqual(kindsAt('def f():\n    if x:\n        return 1\n    return 2', '.py'), []);
});

test('detecta erro engolido em catch vazio (JS, inline e multilinha)', () => {
  assert.deepEqual(kindsAt('try { go(); } catch (e) {}', '.js'), ['swallowed_error@1']);
  assert.deepEqual(kindsAt('try {\n  go();\n} catch (e) {\n}', '.js'), ['swallowed_error@3']);
});

test('detecta erro engolido em except com apenas pass (Python)', () => {
  assert.deepEqual(kindsAt('try:\n    go()\nexcept Exception:\n    pass', '.py'), ['swallowed_error@3']);
});

test('nao acusa catch/except que trata ou registra o erro', () => {
  assert.deepEqual(kindsAt('try { go(); } catch (e) { log(e); }', '.js'), []);
  assert.deepEqual(kindsAt('try:\n    go()\nexcept Exception:\n    handle()', '.py'), []);
});

test('detecta case duplicado no mesmo switch', () => {
  const source = 'switch (x) {\n  case 1: a(); break;\n  case 2: b(); break;\n  case 1: c(); break;\n}';
  assert.deepEqual(kindsAt(source, '.js'), ['duplicate_case@4']);
});

test('nao acusa case igual em switches distintos nem aninhados', () => {
  assert.deepEqual(kindsAt('switch (x) {\n  case 1: a(); break;\n}\nswitch (y) {\n  case 1: b(); break;\n}', '.js'), []);
  assert.deepEqual(kindsAt('switch (x) {\n  case 1:\n    switch (y) {\n      case 1: a(); break;\n    }\n    break;\n  case 2: b(); break;\n}', '.js'), []);
});

test('respeita focusRange', () => {
  const source = 'function f() {\n  return 1;\n  doStuff();\n}\nfunction g() {\n  return 2;\n  more();\n}';
  const issues = checkControlFlowSmells(source.split('\n'), 'sample.js', '.js', { focusRange: { start: 5, end: 8 } });
  assert.deepEqual(issues.map((issue) => issue.line), [7]);
});
