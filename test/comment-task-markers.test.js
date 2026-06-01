'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCommentTaskTools } = require('../lib/generation-comment-task');

function buildCommentTaskDeps(overrides = {}) {
  return {
    analysisExtension: () => '.js',
    buildContextBlueprintTasks: () => [],
    buildSnippetDependencyIssues: () => [],
    commentTaskAlreadyApplied: () => false,
    inferTerminalTaskAction: () => ({ cwd: process.cwd(), command: 'npm test', description: 'npm test' }),
    isMermaidExtension: () => false,
    hasOpenAiConfiguration: () => false,
    normalizeGeneratedTaskResult: (result) => (typeof result === 'string'
      ? { snippet: result, dependencies: [] }
      : result),
    requiresAiForFeature: () => false,
    supportsEditorFeature: (_file, feature) => ['comment_task', 'context_file', 'terminal_task'].includes(feature),
    supportsHashComments: () => false,
    supportsSlashComments: () => true,
    synthesizeFromCommentTask: () => ({ snippet: 'function soma() { return 3; }', dependencies: [] }),
    mustUseAiForCommentAction: () => false,
    ...overrides,
  };
}

test('comment_task normalizes :: to the code-generation marker before synthesis', () => {
  const calls = [];
  const deps = buildCommentTaskDeps({
    synthesizeFromCommentTask: (...args) => {
      calls.push(args);
      return { snippet: 'function soma() { return 3; }', dependencies: [] };
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);

  const issues = checkCommentTask(['//:: criar funcao soma'], '/tmp/example.js');

  assert.equal(issues[0].kind, 'comment_task');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][4].marker, ':');
  assert.equal(calls[0][4].rawMarker, '::');
  assert.equal(calls[0][4].lineIndex, 0);
});

test('comment_task routes ::: to context blueprint generation', () => {
  const calls = [];
  const deps = buildCommentTaskDeps({
    buildContextBlueprintTasks: (...args) => {
      calls.push(args);
      return [{
        file: args[1],
        line: args[2],
        severity: 'info',
        kind: 'context_file',
        message: 'Blueprint',
        suggestion: 'Gerar contexto',
        snippet: 'context.md',
        action: { op: 'write_file', target_file: '/tmp/context.md', mkdir_p: true },
      }];
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);

  const issues = checkCommentTask(['//::: bff para crud de usuario'], '/tmp/example.js');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'context_file');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][3], 'bff para crud de usuario');
});

test('comment_task routes @pingu code directive to code generation', () => {
  const calls = [];
  const deps = buildCommentTaskDeps({
    synthesizeFromCommentTask: (...args) => {
      calls.push(args);
      return { snippet: 'function soma() { return 3; }', dependencies: [] };
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);

  const issues = checkCommentTask(['// @pingu code criar funcao soma'], '/tmp/example.js');

  assert.equal(issues[0].kind, 'comment_task');
  assert.equal(calls[0][4].marker, ':');
  assert.equal(calls[0][4].rawMarker, '@pingu code');
  assert.equal(calls[0][0], 'criar funcao soma');
});

test('comment_task routes pingu context directive to context blueprint generation', () => {
  const calls = [];
  const deps = buildCommentTaskDeps({
    buildContextBlueprintTasks: (...args) => {
      calls.push(args);
      return [{
        file: args[1],
        line: args[2],
        severity: 'info',
        kind: 'context_file',
        message: 'Blueprint',
        suggestion: 'Gerar contexto',
        snippet: 'context.md',
        action: { op: 'write_file', target_file: '/tmp/context.md', mkdir_p: true },
      }];
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);

  const issues = checkCommentTask(['// pingu: context bff para crud de usuario'], '/tmp/example.js');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'context_file');
  assert.equal(calls[0][3], 'bff para crud de usuario');
});

test('comment_task routes @pingu terminal directive to terminal task', () => {
  const { checkCommentTask } = createCommentTaskTools(buildCommentTaskDeps());

  const issues = checkCommentTask(['// @pingu terminal rodar testes'], '/tmp/example.js');

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'terminal_task');
  assert.equal(issues[0].action.command, 'npm test');
});

test('comment_task routes @pingu test directive to code-generation prompt with test intent', () => {
  const calls = [];
  const deps = buildCommentTaskDeps({
    synthesizeFromCommentTask: (...args) => {
      calls.push(args);
      return { snippet: 'test("soma", () => {})', dependencies: [] };
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);

  const issues = checkCommentTask(['// @pingu test funcao soma'], '/tmp/example.js');

  assert.equal(issues[0].kind, 'comment_task');
  assert.equal(calls[0][0], 'gerar testes unitarios para funcao soma');
});

test('comment_task ignores escaped slash markers', () => {
  const { checkCommentTask } = createCommentTaskTools(buildCommentTaskDeps());
  const issues = checkCommentTask([
    '//\\s:: criar funcao soma',
    '// \\s: criar funcao soma',
    '//\\s* rodar testes',
    '//\\s::: bff para crud de usuario',
    '//\\s@pingu code criar funcao soma',
  ], '/tmp/example.js');

  assert.deepEqual(issues, []);
});

test('comment_task ignores escaped hash markers', () => {
  const { checkCommentTask } = createCommentTaskTools(buildCommentTaskDeps({
    analysisExtension: () => '.py',
    supportsHashComments: () => true,
    supportsSlashComments: () => false,
  }));
  const issues = checkCommentTask([
    '#\\s:: criar funcao soma',
    '# \\s: criar funcao soma',
    '#\\s* rodar testes',
    '#\\s::: contexto de arquitetura',
    '#\\s@pingu code criar funcao soma',
  ], '/tmp/example.py');

  assert.deepEqual(issues, []);
});
