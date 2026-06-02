'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createOpenAiProvider } = require('../lib/ai-provider-openai');

function buildProvider(overrides = {}) {
  return createOpenAiProvider({
    spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
    ...overrides,
  });
}

test('hasOpenAiConfiguration returns false when OPENAI_API_KEY is missing', () => {
  const provider = buildProvider({
    spawnSync: () => ({ status: 0, stdout: 'curl 8.0.0', stderr: '' }),
  });
  assert.equal(provider.hasOpenAiConfiguration({}), false);
});

test('hasOpenAiConfiguration returns true when key exists and command probe succeeds', () => {
  const calls = [];
  const provider = buildProvider({
    spawnSync: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'curl 8.0.0', stderr: '' };
    },
  });

  const env = {
    OPENAI_API_KEY: 'test-key',
    PINGU_OPENAI_COMMAND: 'curl',
  };

  assert.equal(provider.hasOpenAiConfiguration(env), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'curl');
  assert.deepEqual(calls[0].args, ['--version']);
});

test('resolveAiGeneratedTask parses JSON content from OpenAI chat completion response', () => {
  let promptCalls = 0;
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'curl 8.0.0', stderr: '' };
      }
      promptCalls += 1;
      return {
        status: 0,
        stdout: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  snippet: 'function soma(a, b) { return a + b; }',
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
              },
            },
          ],
        }),
        stderr: '',
      };
    },
  });

  const env = {
    OPENAI_API_KEY: 'test-key',
    PINGU_OPENAI_COMMAND: 'curl',
    PINGU_OPENAI_MODEL: 'gpt-4o-mini',
  };

  const result = provider.resolveAiGeneratedTask({ instruction: 'criar funcao soma' }, env);
  assert.ok(result);
  assert.equal(result.snippet, 'function soma(a, b) { return a + b; }');
  assert.equal(result.mode, 'comment_task');
  assert.equal(promptCalls, 1);
});

test('resolveAiPromptTask preserves leading indentation in snippet', () => {
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'curl 8.0.0', stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  snippet: '\n      Logger.debug("a")\n      Logger.debug("b")\n',
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
              },
            },
          ],
        }),
        stderr: '',
      };
    },
  });

  const env = {
    OPENAI_API_KEY: 'test-key',
    PINGU_OPENAI_COMMAND: 'curl',
    PINGU_OPENAI_MODEL: 'gpt-4o-mini',
  };

  const result = provider.resolveAiPromptTask({ prompt: 'corrige logs' }, env);
  assert.ok(result);
  assert.equal(
    result.snippet,
    '      Logger.debug("a")\n      Logger.debug("b")',
  );
  assert.equal(result.mode, 'prompt_task');
});
