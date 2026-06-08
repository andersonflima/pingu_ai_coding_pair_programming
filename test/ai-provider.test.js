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

test('createAiProvider prefers codex in auto mode when both providers are available', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
    codexProvider: buildProvider('codex', true),
  });

  const env = { PINGU_AI_PROVIDER: 'auto' };
  assert.equal(provider.activeProviderName(env), 'codex');
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'codex:task');
});

test('createAiProvider uses copilot when mode is copilot', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
    codexProvider: buildProvider('codex', true),
  });

  const env = { PINGU_AI_PROVIDER: 'copilot' };
  assert.equal(provider.activeProviderName(env), 'copilot');
  assert.equal(provider.resolveAiIssueFix({}, env).snippet, 'copilot:fix');
});

test('createAiProvider uses codex provider when mode is codex', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
    codexProvider: buildProvider('codex', true),
  });

  const env = { PINGU_AI_PROVIDER: 'codex' };
  assert.equal(provider.readProviderMode(env), 'codex');
  assert.equal(provider.activeProviderName(env), 'codex');
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'codex:task');
});

test('createAiProvider defaults to codex when provider mode is not configured', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', true),
    codexProvider: buildProvider('codex', true),
  });

  const env = {};
  assert.equal(provider.readProviderMode(env), 'codex');
  assert.equal(provider.activeProviderName(env), 'codex');
  assert.equal(provider.resolveAiGeneratedTask({}, env).snippet, 'codex:task');
});

test('createAiProvider does not fallback to openai in auto mode when only openai is available', () => {
  const provider = createAiProvider({
    openAiProvider: buildProvider('openai', true),
    copilotProvider: buildProvider('copilot', false),
    codexProvider: buildProvider('codex', false),
  });

  const env = { PINGU_AI_PROVIDER: 'auto' };
  assert.equal(provider.activeProviderName(env), 'none');
  assert.equal(provider.hasOpenAiConfiguration(env), false);
  assert.equal(provider.resolveAiGeneratedTask({}, env), null);
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
