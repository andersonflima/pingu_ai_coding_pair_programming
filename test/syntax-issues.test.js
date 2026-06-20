'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkSyntaxIssues } = require('../lib/syntax-issues');

test('checkSyntaxIssues anexa o arquivo as issues e agrega os checks de sintaxe', () => {
  const issues = checkSyntaxIssues(['const x = "aberta'], '/tmp/sample.js', '.js');
  assert.ok(Array.isArray(issues));
  for (const issue of issues) {
    assert.equal(issue.file, '/tmp/sample.js');
  }
});

test('checkSyntaxIssues nao reclama de codigo bem formado', () => {
  const issues = checkSyntaxIssues(['const x = 1;', 'console.log(x);'], '/tmp/ok.js', '.js');
  assert.deepEqual(issues, []);
});
