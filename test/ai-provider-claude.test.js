'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createClaudeAiProvider } = require('../lib/ai-provider-claude');

function buildProvider(overrides = {}) {
  return createClaudeAiProvider({
    claudeDeps: {
      spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
      ...overrides,
    },
  });
}

test('hasOpenAiConfiguration returns false when claude command probe fails', () => {
  const provider = buildProvider();

  assert.equal(provider.hasOpenAiConfiguration({}), false);
});

test('hasOpenAiConfiguration probes claude command by default', () => {
  const calls = [];
  const provider = buildProvider({
    spawnSync: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'claude 1.0.0', stderr: '' };
    },
  });

  assert.equal(provider.hasOpenAiConfiguration({}), true);
  assert.equal(calls[0].command, 'claude');
  assert.deepEqual(calls[0].args, ['--version']);
});

test('resolveAiGeneratedTask executes claude print mode and parses result JSON', () => {
  const calls = [];
  const provider = buildProvider({
    spawnSync: (command, args) => {
      calls.push({ command, args });
      if (args[0] === '--version') {
        return { status: 0, stdout: 'claude 1.0.0', stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: JSON.stringify({
            snippet: 'const answer = 42;',
            message: 'ok',
            suggestion: 'ok',
            dependencies: [],
            action: {
              op: '',
              target_file: '',
              mkdir_p: false,
              remove_trigger: false,
              command: '',
              description: '',
            },
          }),
        }),
        stderr: '',
      };
    },
  });

  const env = {
    PINGU_CLAUDE_MODEL: 'sonnet',
  };
  const result = provider.resolveAiGeneratedTask({ instruction: 'criar resposta' }, env);
  const run = calls.find((call) => call.args[0] !== '--version');

  assert.ok(result);
  assert.equal(result.snippet, 'const answer = 42;');
  assert.ok(run);
  assert.equal(run.command, 'claude');
  assert.ok(run.args.includes('-p'));
  assert.ok(run.args.includes('--output-format'));
  assert.ok(run.args.includes('json'));
  assert.ok(run.args.includes('--max-turns'));
  assert.ok(run.args.includes('1'));
  assert.ok(run.args.includes('--model'));
  assert.ok(run.args.includes('sonnet'));
});

test('resolveAiGeneratedTask honors anthropic alias env vars', () => {
  const calls = [];
  const provider = buildProvider({
    spawnSync: (command, args) => {
      calls.push({ command, args });
      if (args[0] === '--version') {
        return { status: 0, stdout: 'claude 1.0.0', stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          result: JSON.stringify({
            snippet: 'ok',
            action: {},
            dependencies: [],
          }),
        }),
        stderr: '',
      };
    },
  });

  const env = {
    PINGU_ANTHROPIC_COMMAND: 'custom-claude',
    PINGU_ANTHROPIC_MODEL: 'opus',
  };

  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'ok');
  assert.equal(calls[0].command, 'custom-claude');
  assert.equal(calls.find((call) => call.args[0] !== '--version').command, 'custom-claude');
});
