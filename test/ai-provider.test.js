'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiProvider } = require('../lib/ai-provider');

function buildCopilotProvider(available = true) {
  return {
    hasOpenAiConfiguration: () => available,
    resolveAiGeneratedTask: () => ({ snippet: 'copilot:task', action: {}, dependencies: [] }),
    resolveAiIssueFix: () => ({ snippet: 'copilot:fix', action: {}, dependencies: [] }),
    resolveAiGeneratedUnitTests: () => ({ snippet: 'copilot:unit', action: {}, dependencies: [] }),
    resolveAiContextResolution: () => ({ snippet: 'copilot:context', action: {}, dependencies: [] }),
  };
}

test('createAiProvider exposes copilot when CLI is available', () => {
  const provider = createAiProvider({ copilotProvider: buildCopilotProvider(true) });
  const env = {};
  assert.equal(provider.activeProviderName(env), 'copilot');
  assert.equal(provider.hasOpenAiConfiguration(env), true);
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'copilot:task');
  assert.equal(provider.resolveAiIssueFix({}, env).snippet, 'copilot:fix');
  assert.equal(provider.resolveAiGeneratedUnitTests({}, env).snippet, 'copilot:unit');
  assert.equal(provider.resolveAiContextResolution({}, env).snippet, 'copilot:context');
});

test('createAiProvider reports none and returns null when copilot is unavailable', () => {
  const provider = createAiProvider({ copilotProvider: buildCopilotProvider(false) });
  const env = {};
  assert.equal(provider.activeProviderName(env), 'none');
  assert.equal(provider.hasOpenAiConfiguration(env), false);
  assert.equal(provider.resolveAiGeneratedTask({}, env), null);
  assert.equal(provider.resolveAiIssueFix({}, env), null);
});

test('resolveAiPromptTask falls back to resolveAiGeneratedTask when prompt method is absent', () => {
  const provider = createAiProvider({
    copilotProvider: {
      hasOpenAiConfiguration: () => true,
      resolveAiGeneratedTask: () => ({ snippet: 'copilot:task', action: {}, dependencies: [] }),
      resolveAiIssueFix: () => null,
      resolveAiGeneratedUnitTests: () => null,
      resolveAiContextResolution: () => null,
    },
  });
  assert.equal(provider.resolveAiPromptTask({}, {}).snippet, 'copilot:task');
});
