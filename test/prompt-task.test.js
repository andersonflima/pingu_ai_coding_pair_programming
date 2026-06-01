'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPromptTaskRequest,
  resolvePromptTask,
} = require('../lib/prompt-task');

test('buildPromptTaskRequest captures selected range and constraints', () => {
  const request = buildPromptTaskRequest({
    file: '/tmp/sample.js',
    language: 'javascript',
    prompt: 'corrige esse bloco',
    lines: ['const a = 1', 'const b = 2', 'console.log(a + b)'],
    startLine: 2,
    endLine: 3,
    cursorLine: 3,
    cursorColumn: 8,
  });

  assert.equal(request.mode, 'prompt_task');
  assert.equal(request.prompt, 'corrige esse bloco');
  assert.equal(request.selectedText, 'const b = 2\nconsole.log(a + b)');
  assert.deepEqual(request.selection, { startLine: 2, endLine: 3 });
  assert.equal(request.constraints.some((item) => item.includes('range selecionado')), true);
});

test('resolvePromptTask returns replace_range issue for provider snippet', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: (request) => ({
      snippet: `${request.selectedText};`,
      message: 'Bloco ajustado',
      suggestion: 'Aplicar ajuste',
      action: {},
    }),
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.js',
    prompt: 'adicione ponto e virgula',
    lines: ['const a = 1', 'const b = 2'],
    startLine: 2,
    endLine: 2,
  }, { provider });

  assert.equal(result.ok, true);
  assert.equal(result.issue.kind, 'prompt_task');
  assert.equal(result.issue.snippet, 'const b = 2;');
  assert.deepEqual(result.issue.action, {
    op: 'replace_range',
    range: {
      start: { line: 1, character: 0 },
      end: { line: 2, character: 0 },
    },
  });
});

test('resolvePromptTask refuses direct terminal action from provider', () => {
  const provider = {
    hasOpenAiConfiguration: () => true,
    resolveAiPromptTask: () => ({
      snippet: 'npm test',
      action: { op: 'run_command', command: 'npm test' },
    }),
  };

  const result = resolvePromptTask({
    file: '/tmp/sample.js',
    prompt: 'rode os testes',
    lines: ['const a = 1'],
    startLine: 1,
    endLine: 1,
  }, { provider });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'terminal_action_requires_terminal_task');
});
