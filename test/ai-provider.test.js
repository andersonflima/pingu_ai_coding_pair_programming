'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAiProvider } = require('../lib/ai-provider');

function buildProvider(name, available = true) {
  return {
    hasOpenAiConfiguration: () => available,
    resolveAiGeneratedTask: () => ({ snippet: `${name}:task`, action: {}, dependencies: [] }),
    resolveAiIssueFix: () => ({ snippet: `${name}:fix`, action: {}, dependencies: [] }),
    resolveAiGeneratedUnitTests: () => ({ snippet: `${name}:unit`, action: {}, dependencies: [] }),
    resolveAiContextResolution: () => ({ snippet: `${name}:context`, action: {}, dependencies: [] }),
  };
}

test('createAiProvider prefers openai in auto mode when both providers are available', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
  });

  const env = { PINGU_AI_PROVIDER: 'auto' };
  assert.equal(provider.activeProviderName(env), 'openai');
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'openai:task');
});

test('createAiProvider uses copilot when mode is copilot', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
  });

  const env = { PINGU_AI_PROVIDER: 'copilot' };
  assert.equal(provider.activeProviderName(env), 'copilot');
  assert.equal(provider.resolveAiIssueFix({}, env).snippet, 'copilot:fix');
});

test('createAiProvider treats codex mode as openai provider', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
  });

  const env = { PINGU_AI_PROVIDER: 'codex' };
  assert.equal(provider.readProviderMode(env), 'openai');
  assert.equal(provider.activeProviderName(env), 'openai');
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'openai:task');
});

test('createAiProvider returns none when selected provider is unavailable', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', false),
    copilotProvider: buildProvider('copilot', false),
  });

  const env = { PINGU_AI_PROVIDER: 'openai' };
  assert.equal(provider.activeProviderName(env), 'none');
  assert.equal(provider.hasOpenAiConfiguration(env), false);
  assert.equal(provider.resolveAiGeneratedTask({}, env), null);
});
