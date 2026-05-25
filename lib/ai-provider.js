'use strict';

const { createCopilotAiProvider } = require('./ai-provider-copilot');
const { createOpenAiProvider } = require('./ai-provider-openai');

function createAiProvider(deps = {}) {
  const copilotProvider = deps.copilotProvider || createCopilotAiProvider(deps.copilotDeps || {});
  const openAiProvider = deps.openAiProvider || createOpenAiProvider(deps.openAiDeps || {});

  function normalizeEnvValue(value) {
    return String(value || '').trim().toLowerCase();
  }

  function readProviderMode(env = process.env) {
    const mode = normalizeEnvValue(env.PINGU_AI_PROVIDER || 'copilot');
    if (['openai', 'copilot', 'auto'].includes(mode)) {
      return mode;
    }
    return 'copilot';
  }

  function providerAvailable(provider, env = process.env) {
    return Boolean(
      provider
      && typeof provider.hasOpenAiConfiguration === 'function'
      && provider.hasOpenAiConfiguration(env),
    );
  }

  function resolvePreferredProvider(env = process.env) {
    const mode = readProviderMode(env);
    if (mode === 'openai') {
      return providerAvailable(openAiProvider, env) ? openAiProvider : null;
    }
    if (mode === 'copilot') {
      return providerAvailable(copilotProvider, env) ? copilotProvider : null;
    }

    if (providerAvailable(openAiProvider, env)) {
      return openAiProvider;
    }
    if (providerAvailable(copilotProvider, env)) {
      return copilotProvider;
    }
    return null;
  }

  function hasOpenAiConfiguration(env = process.env) {
    return Boolean(resolvePreferredProvider(env));
  }

  function resolveWith(methodName, request, env = process.env) {
    const provider = resolvePreferredProvider(env);
    if (!provider || typeof provider[methodName] !== 'function') {
      return null;
    }
    return provider[methodName](request, env);
  }

  function resolveAiGeneratedTask(request, env = process.env) {
    return resolveWith('resolveAiGeneratedTask', request, env);
  }

  function resolveAiIssueFix(request, env = process.env) {
    return resolveWith('resolveAiIssueFix', request, env);
  }

  function resolveAiGeneratedUnitTests(request, env = process.env) {
    return resolveWith('resolveAiGeneratedUnitTests', request, env);
  }

  function resolveAiContextResolution(request, env = process.env) {
    return resolveWith('resolveAiContextResolution', request, env);
  }

  function activeProviderName(env = process.env) {
    const provider = resolvePreferredProvider(env);
    if (!provider) {
      return 'none';
    }
    if (provider === openAiProvider) {
      return 'openai';
    }
    if (provider === copilotProvider) {
      return 'copilot';
    }
    return 'custom';
  }

  return {
    activeProviderName,
    hasOpenAiConfiguration,
    readProviderMode,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
  };
}

module.exports = {
  createAiProvider,
};
