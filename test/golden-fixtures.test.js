'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const cliPath = path.join(root, 'pingu_dev_agent.js');
const fixturesDir = path.join(__dirname, 'fixtures', 'golden');
const cliEnv = {
  ...process.env,
  PINGU_AI_MODE: 'off',
};

function readFixture(name) {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function runPromptGoldenCase(testCase) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `pingu-golden-${testCase.id}-`));
  const sourceFile = path.join(tempDir, testCase.fileName);

  fs.writeFileSync(sourceFile, readFixture(testCase.input), 'utf8');

  execFileSync(process.execPath, [cliPath, 'prompts', sourceFile, '--write', '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: cliEnv,
  });

  return fs.readFileSync(sourceFile, 'utf8');
}

[
  {
    id: 'comment-task-js',
    fileName: 'sample.js',
    input: 'comment-task-js.input.txt',
    expected: 'comment-task-js.expected.txt',
  },
  {
    id: 'comment-task-elixir',
    fileName: 'calculator.ex',
    input: 'comment-task-elixir.input.ex',
    expected: 'comment-task-elixir.expected.ex',
  },
].forEach((testCase) => {
  test(`golden prompt output remains stable for ${testCase.id}`, () => {
    assert.equal(runPromptGoldenCase(testCase), readFixture(testCase.expected));
  });
});
