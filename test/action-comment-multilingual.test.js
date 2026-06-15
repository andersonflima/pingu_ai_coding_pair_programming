'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCommentTaskTools } = require('../lib/generation-comment-task');

function buildDeps(extension, overrides = {}) {
  const ext = extension.toLowerCase();
  const isMermaid = ['.mmd', '.mermaid'].includes(ext);
  const isMarkdown = ext === '.md';
  const isLua = ext === '.lua';
  const isVim = ext === '.vim';
  const isHash = ['.py', '.rb', '.sh', '.bash', '.zsh', '.fish', '.tf', '.toml', '.yaml', '.yml'].includes(ext);
  const isSlash = ['.js', '.ts', '.tsx', '.jsx', '.go', '.rs', '.c', '.cpp', '.cs', '.java', '.swift', '.kt'].includes(ext);
  return {
    analysisExtension: () => ext,
    buildContextBlueprintTasks: () => [],
    buildSnippetDependencyIssues: () => [],
    commentTaskAlreadyApplied: () => false,
    inferTerminalTaskAction: () => ({ cwd: process.cwd(), command: 'npm test', description: 'npm test' }),
    isMermaidExtension: () => isMermaid,
    hasOpenAiConfiguration: () => false,
    normalizeGeneratedTaskResult: (result) => (typeof result === 'string'
      ? { snippet: result, dependencies: [] }
      : result),
    requiresAiForFeature: () => false,
    supportsEditorFeature: (_file, feature) => ['comment_task', 'context_file', 'terminal_task'].includes(feature),
    supportsHashComments: () => isHash,
    supportsSlashComments: () => isSlash || isMarkdown === false && !isMermaid && !isLua && !isVim && !isHash ? isSlash : isSlash,
    synthesizeFromCommentTask: () => ({ snippet: 'generated', dependencies: [] }),
    mustUseAiForCommentAction: () => false,
    ...overrides,
  };
}

const LANG_CASES = [
  { lang: 'python', ext: '.py', file: '/tmp/sample.py', commentPrefix: '#' },
  { lang: 'ruby', ext: '.rb', file: '/tmp/sample.rb', commentPrefix: '#' },
  { lang: 'bash', ext: '.sh', file: '/tmp/sample.sh', commentPrefix: '#' },
  { lang: 'terraform', ext: '.tf', file: '/tmp/sample.tf', commentPrefix: '#' },
  { lang: 'lua', ext: '.lua', file: '/tmp/sample.lua', commentPrefix: '--' },
  { lang: 'vim', ext: '.vim', file: '/tmp/sample.vim', commentPrefix: '"' },
  { lang: 'go', ext: '.go', file: '/tmp/sample.go', commentPrefix: '//' },
  { lang: 'rust', ext: '.rs', file: '/tmp/sample.rs', commentPrefix: '//' },
  { lang: 'typescript', ext: '.ts', file: '/tmp/sample.ts', commentPrefix: '//' },
];

for (const langCase of LANG_CASES) {
  test(`comment_task detects ${langCase.lang} marker ":" (code generation)`, () => {
    const { checkCommentTask } = createCommentTaskTools(buildDeps(langCase.ext));
    const issues = checkCommentTask([`${langCase.commentPrefix}: criar funcao soma`], langCase.file);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'comment_task');
  });

  test(`comment_task detects ${langCase.lang} marker "*" (terminal task)`, () => {
    const { checkCommentTask } = createCommentTaskTools(buildDeps(langCase.ext));
    const issues = checkCommentTask([`${langCase.commentPrefix}* rodar testes`], langCase.file);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'terminal_task');
  });

  test(`comment_task detects ${langCase.lang} marker "::" (snippet generation)`, () => {
    const calls = [];
    const deps = buildDeps(langCase.ext, {
      synthesizeFromCommentTask: (...args) => {
        calls.push(args);
        return { snippet: 'snippet', dependencies: [] };
      },
    });
    const { checkCommentTask } = createCommentTaskTools(deps);
    const issues = checkCommentTask([`${langCase.commentPrefix}:: criar funcao soma maior`], langCase.file);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'comment_task');
    assert.equal(calls[0][4].marker, ':');
    assert.equal(calls[0][4].rawMarker, '::');
  });

  test(`comment_task detects ${langCase.lang} marker "**" (context file)`, () => {
    const calls = [];
    const deps = buildDeps(langCase.ext, {
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
    const issues = checkCommentTask([`${langCase.commentPrefix}** bff para crud de usuario`], langCase.file);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'context_file');
    assert.equal(calls[0][3], 'bff para crud de usuario');
  });

  test(`comment_task detects ${langCase.lang} @pingu code directive`, () => {
    const { checkCommentTask } = createCommentTaskTools(buildDeps(langCase.ext));
    const issues = checkCommentTask(
      [`${langCase.commentPrefix} @pingu code criar funcao soma`],
      langCase.file,
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'comment_task');
  });

  test(`comment_task detects ${langCase.lang} @pingu test directive routed to test prompt`, () => {
    const calls = [];
    const deps = buildDeps(langCase.ext, {
      synthesizeFromCommentTask: (...args) => {
        calls.push(args);
        return { snippet: 'test snippet', dependencies: [] };
      },
    });
    const { checkCommentTask } = createCommentTaskTools(deps);
    const issues = checkCommentTask(
      [`${langCase.commentPrefix} @pingu test funcao soma`],
      langCase.file,
    );
    assert.equal(issues.length, 1);
    assert.equal(issues[0].kind, 'comment_task');
    assert.equal(calls[0][0], 'gerar testes unitarios para funcao soma');
  });
}

test('comment_task detects Markdown HTML marker "<!--:" as code generation', () => {
  const deps = buildDeps('.md', { supportsSlashComments: () => false });
  const { checkCommentTask } = createCommentTaskTools(deps);
  const issues = checkCommentTask(['<!--: criar tabela de configuracao -->'], '/tmp/sample.md');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'comment_task');
});

test('comment_task detects Mermaid marker "%%::" as snippet generation', () => {
  const calls = [];
  const deps = buildDeps('.mmd', {
    synthesizeFromCommentTask: (...args) => {
      calls.push(args);
      return { snippet: 'diagram', dependencies: [] };
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);
  const issues = checkCommentTask(['%%:: criar diagrama de sequencia'], '/tmp/sample.mmd');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'comment_task');
  assert.equal(calls[0][4].rawMarker, '::');
});

test('comment_task accepts C-style block comments with :: marker', () => {
  const calls = [];
  const deps = buildDeps('.ts', {
    synthesizeFromCommentTask: (...args) => {
      calls.push(args);
      return { snippet: 'snippet', dependencies: [] };
    },
  });
  const { checkCommentTask } = createCommentTaskTools(deps);
  const issues = checkCommentTask(['/*:: criar interface User */'], '/tmp/sample.ts');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'comment_task');
  assert.equal(calls[0][4].marker, ':');
});

test('comment_task ignores plain comments without action marker', () => {
  const { checkCommentTask } = createCommentTaskTools(buildDeps('.js'));
  const issues = checkCommentTask(
    [
      '// just a regular comment',
      '// TODO add tests later',
      '// pinguim no zoo',
    ],
    '/tmp/sample.js',
  );
  assert.deepEqual(issues, []);
});

test('comment_task ignores marker with empty instruction', () => {
  const { checkCommentTask } = createCommentTaskTools(buildDeps('.js'));
  const issues = checkCommentTask(
    [
      '//: ',
      '//:: ',
      '//::: ',
      '//* ',
      '//** ',
    ],
    '/tmp/sample.js',
  );
  assert.deepEqual(issues, []);
});

test('comment_task ignores @pingu directive without instruction body', () => {
  const { checkCommentTask } = createCommentTaskTools(buildDeps('.js'));
  const issues = checkCommentTask(
    [
      '// @pingu code',
      '// @pingu test',
      '// @pingu context',
      '// @pingu terminal',
    ],
    '/tmp/sample.js',
  );
  assert.deepEqual(issues, []);
});

test('comment_task ignores @pingu directive with unknown verb', () => {
  const { checkCommentTask } = createCommentTaskTools(buildDeps('.js'));
  const issues = checkCommentTask(['// @pingu invented criar coisa'], '/tmp/sample.js');
  assert.deepEqual(issues, []);
});

test('comment_task ignores Python @pingu code with empty instruction', () => {
  const { checkCommentTask } = createCommentTaskTools(buildDeps('.py'));
  const issues = checkCommentTask(['# @pingu code'], '/tmp/sample.py');
  assert.deepEqual(issues, []);
});

test('comment_task ignores escape-prefixed markers across languages', () => {
  for (const langCase of LANG_CASES) {
    const { checkCommentTask } = createCommentTaskTools(buildDeps(langCase.ext));
    const issues = checkCommentTask(
      [
        `${langCase.commentPrefix}\\s: criar funcao soma`,
        `${langCase.commentPrefix}\\s:: criar funcao soma`,
        `${langCase.commentPrefix}\\s* rodar testes`,
        `${langCase.commentPrefix}\\s@pingu code criar funcao soma`,
      ],
      langCase.file,
    );
    assert.deepEqual(issues, [], `${langCase.lang} should not flag escaped markers`);
  }
});
