'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCopilotAiProvider } = require('../lib/ai-provider-copilot');

function buildProvider(overrides = {}) {
  return createCopilotAiProvider({
    spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
    ...overrides,
  });
}

test('hasOpenAiConfiguration returns false when copilot cli is unavailable', () => {
  const provider = buildProvider({
    spawnSync: () => {
      throw new Error('command not found');
    },
  });

  assert.equal(provider.hasOpenAiConfiguration({}), false);
});

test('hasOpenAiConfiguration returns true when copilot cli probe succeeds', () => {
  const calls = [];
  const provider = buildProvider({
    spawnSync: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
    },
  });

  assert.equal(provider.hasOpenAiConfiguration({}), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'copilot');
  assert.deepEqual(calls[0].args, ['--version']);
});

test('resolveAiGeneratedTask returns null when provider is unavailable', () => {
  const provider = buildProvider({
    spawnSync: () => ({ status: 1, stdout: '', stderr: '' }),
  });

  const result = provider.resolveAiGeneratedTask({ instruction: 'criar funcao' }, {});
  assert.equal(result, null);
});

test('resolveAiGeneratedTask parses strict json response from copilot prompt mode', () => {
  let calls = 0;
  const provider = buildProvider({
    spawnSync: (command, args, options) => {
      calls += 1;
      if (args[0] === '--version') {
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      assert.equal(command, 'copilot');
      assert.equal(args[0], '-p');
      assert.ok(String(options.input || '').length === 0);
      return {
        status: 0,
        stdout: JSON.stringify({
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
        stderr: '',
      };
    },
  });

  const result = provider.resolveAiGeneratedTask({ instruction: 'criar funcao soma' }, {});
  assert.ok(result);
  assert.equal(result.snippet, 'function soma(a, b) { return a + b; }');
  assert.equal(result.mode, 'comment_task');
  assert.equal(calls >= 2, true);
});

test('resolveAiGeneratedTask handles fenced json payload', () => {
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      return {
        status: 0,
        stdout: '```json\n{"snippet":"echo ok","message":"","suggestion":"","dependencies":[],"action":{"op":"run_command","target_file":"","mkdir_p":false,"remove_trigger":true,"command":"echo ok","description":"echo ok"}}\n```',
        stderr: '',
      };
    },
  });

  const result = provider.resolveAiGeneratedTask({ instruction: 'rodar comando' }, {});
  assert.ok(result);
  assert.equal(result.action.op, 'run_command');
  assert.equal(result.action.command, 'echo ok');
});

test('resolveAiPromptTask preserves leading indentation in snippet', () => {
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
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
        stderr: '',
      };
    },
  });

  const result = provider.resolveAiPromptTask({ prompt: 'corrige logs' }, {});
  assert.ok(result);
  assert.equal(
    result.snippet,
    '      Logger.debug("a")\n      Logger.debug("b")',
  );
  assert.equal(result.mode, 'prompt_task');
});

test('hasOpenAiConfiguration enters temporary cooldown after runtime failure', () => {
  let versionCalls = 0;
  let promptCalls = 0;
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        versionCalls += 1;
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      promptCalls += 1;
      return { status: 1, stdout: '', stderr: 'not authenticated' };
    },
  });

  const env = { PINGU_COPILOT_FAILURE_COOLDOWN_MS: '30000' };

  assert.equal(provider.resolveAiGeneratedTask({ instruction: 'criar funcao' }, env), null);
  assert.equal(promptCalls, 1);
  assert.equal(provider.hasOpenAiConfiguration(env), false);
  assert.equal(versionCalls, 1);
});

test('provider retries after cooldown expires', async () => {
  let versionCalls = 0;
  let promptCalls = 0;
  const provider = buildProvider({
    spawnSync: (_command, args) => {
      if (args[0] === '--version') {
        versionCalls += 1;
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      promptCalls += 1;
      if (promptCalls === 1) {
        return { status: 1, stdout: '', stderr: 'temporary error' };
      }
      return {
        status: 0,
        stdout: JSON.stringify({
          snippet: 'const ok = true;',
          message: '',
          suggestion: '',
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
        stderr: '',
      };
    },
  });

  const env = { PINGU_COPILOT_FAILURE_COOLDOWN_MS: '5' };

  assert.equal(provider.resolveAiGeneratedTask({ instruction: 'primeira tentativa' }, env), null);
  await new Promise((resolve) => setTimeout(resolve, 10));
  const second = provider.resolveAiGeneratedTask({ instruction: 'segunda tentativa' }, env);
  assert.ok(second);
  assert.equal(second.snippet, 'const ok = true;');
  assert.equal(promptCalls, 2);
  assert.equal(versionCalls >= 1, true);
});
