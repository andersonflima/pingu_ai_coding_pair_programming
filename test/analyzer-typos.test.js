'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { checkCommonTypos } = require('../lib/analyzer-typos');

function typosFor(lines, file) {
  return checkCommonTypos(lines, file, file.slice(file.lastIndexOf('.')));
}

test('detecta typo de builtin JavaScript e sugere a correcao', () => {
  const issues = typosFor(['cosole.log("oi");'], 'app.js');
  assert.equal(issues.length, 1);
  const [issue] = issues;
  assert.equal(issue.kind, 'typo');
  assert.equal(issue.severity, 'warning');
  assert.match(issue.message, /cosole/);
  assert.match(issue.suggestion, /console/);
  assert.equal(issue.snippet, 'console.log("oi");');
  assert.equal(issue.col, 1);
});

test('nunca marca como auto-fix (suggest-only)', () => {
  const { issueKindConfig } = require('../lib/issue-kinds');
  assert.equal(issueKindConfig('typo').autoFixDefault, false);
});

test('detecta typo de keyword Python', () => {
  const issues = typosFor(['def soma(a, b):', '    retrun a + b'], 'calc.py');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 2);
  assert.match(issues[0].suggestion, /return/);
});

test('ignora ocorrencias dentro de strings e comentarios', () => {
  assert.equal(typosFor(['const msg = "retrun cedo";'], 'a.js').length, 0);
  assert.equal(typosFor(['// retrun aqui depois'], 'a.js').length, 0);
});

test('nao confunde substring de identificador maior com typo', () => {
  // "retrun" nao deve casar dentro de "retrunValue"
  assert.equal(typosFor(['const retrunValue = 1;'], 'a.js').length, 0);
});

test('reporta multiplos typos na mesma linha de forma agregada', () => {
  const issues = typosFor(['fucntion f(){ retrun 1; }'], 'a.js');
  assert.equal(issues.length, 1);
  assert.match(issues[0].suggestion, /function/);
  assert.match(issues[0].suggestion, /return/);
  assert.equal(issues[0].snippet, 'function f(){ return 1; }');
});

test('nao reporta nada quando a linguagem nao tem dicionario', () => {
  assert.equal(typosFor(['retrun 1'], 'a.txt').length, 0);
});

test('respeita focusRange', () => {
  const lines = ['cosole.log(1);', 'cosole.log(2);'];
  const issues = checkCommonTypos(lines, 'a.js', '.js', { focusRange: { start: 2, end: 2 } });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 2);
});
