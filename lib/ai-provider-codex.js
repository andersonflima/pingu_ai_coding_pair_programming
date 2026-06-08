'use strict';

const { createCopilotAiProvider } = require('./ai-provider-copilot');

function createCodexAiProvider(deps = {}) {
  const codexProvider = deps.codexProvider || createCopilotAiProvider(deps.codexDeps || {});

  function normalizeEnvValue(value) {
    return String(value || '').trim();
  }

  function mapCodexEnv(env = process.env) {
    const mapped = Object.assign({}, env);

    const command = normalizeEnvValue(env.PINGU_CODEX_COMMAND);
    mapped.PINGU_COPILOT_COMMAND = command || 'codex';

    const timeoutMs = normalizeEnvValue(env.PINGU_CODEX_TIMEOUT_MS);
    if (timeoutMs) {
      mapped.PINGU_COPILOT_TIMEOUT_MS = timeoutMs;
    }

    const cooldownMs = normalizeEnvValue(env.PINGU_CODEX_FAILURE_COOLDOWN_MS);
    if (cooldownMs) {
      mapped.PINGU_COPILOT_FAILURE_COOLDOWN_MS = cooldownMs;
    }

    const disabled = normalizeEnvValue(env.PINGU_CODEX_DISABLED);
    if (disabled) {
      mapped.PINGU_COPILOT_DISABLED = disabled;
    }

    const model = normalizeEnvValue(env.PINGU_CODEX_MODEL || env.PINGU_AI_MODEL);
    if (model) {
      mapped.PINGU_COPILOT_MODEL = model;
      mapped.PINGU_AI_MODEL = model;
    }

    return mapped;
  }

  function withProviderEnv(methodName) {
    return function resolve(request, env = process.env) {
      const provider = codexProvider;
      if (!provider || typeof provider[methodName] !== 'function') {
        return null;
      }
      return provider[methodName](request, mapCodexEnv(env));
    };
  }

  return {
    hasOpenAiConfiguration: (env = process.env) => codexProvider.hasOpenAiConfiguration(mapCodexEnv(env)),
    resolveAiContextResolution: withProviderEnv('resolveAiContextResolution'),
    resolveAiGeneratedTask: withProviderEnv('resolveAiGeneratedTask'),
    resolveAiGeneratedUnitTests: withProviderEnv('resolveAiGeneratedUnitTests'),
    resolveAiIssueFix: withProviderEnv('resolveAiIssueFix'),
    resolveAiPromptTask: withProviderEnv('resolveAiPromptTask'),
  };
}

module.exports = {
  createCodexAiProvider,
};
