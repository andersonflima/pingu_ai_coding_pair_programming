'use strict';

const { createCopilotAiProvider } = require('./ai-provider-copilot');

function createClaudeAiProvider(deps = {}) {
  const claudeProvider = deps.claudeProvider || createCopilotAiProvider(deps.claudeDeps || {});

  function normalizeEnvValue(value) {
    return String(value || '').trim();
  }

  function mapClaudeEnv(env = process.env) {
    const mapped = Object.assign({}, env);

    const command = normalizeEnvValue(env.PINGU_CLAUDE_COMMAND || env.PINGU_ANTHROPIC_COMMAND);
    mapped.PINGU_COPILOT_COMMAND = command || 'claude';
    mapped.PINGU_CLI_PROVIDER_KIND = 'claude';

    const timeoutMs = normalizeEnvValue(env.PINGU_CLAUDE_TIMEOUT_MS || env.PINGU_ANTHROPIC_TIMEOUT_MS);
    if (timeoutMs) {
      mapped.PINGU_COPILOT_TIMEOUT_MS = timeoutMs;
    }

    const cooldownMs = normalizeEnvValue(
      env.PINGU_CLAUDE_FAILURE_COOLDOWN_MS || env.PINGU_ANTHROPIC_FAILURE_COOLDOWN_MS,
    );
    if (cooldownMs) {
      mapped.PINGU_COPILOT_FAILURE_COOLDOWN_MS = cooldownMs;
    }

    const disabled = normalizeEnvValue(env.PINGU_CLAUDE_DISABLED || env.PINGU_ANTHROPIC_DISABLED);
    if (disabled) {
      mapped.PINGU_COPILOT_DISABLED = disabled;
    }

    const model = normalizeEnvValue(
      env.PINGU_CLAUDE_MODEL || env.PINGU_ANTHROPIC_MODEL || env.PINGU_AI_MODEL,
    );
    if (model) {
      mapped.PINGU_COPILOT_MODEL = model;
      mapped.PINGU_AI_MODEL = model;
    }

    return mapped;
  }

  function withProviderEnv(methodName) {
    return function resolve(request, env = process.env) {
      const provider = claudeProvider;
      if (!provider || typeof provider[methodName] !== 'function') {
        return null;
      }
      return provider[methodName](request, mapClaudeEnv(env));
    };
  }

  return {
    hasOpenAiConfiguration: (env = process.env) => (
      claudeProvider.hasOpenAiConfiguration(mapClaudeEnv(env))
    ),
    resolveAiContextResolution: withProviderEnv('resolveAiContextResolution'),
    resolveAiGeneratedTask: withProviderEnv('resolveAiGeneratedTask'),
    resolveAiGeneratedUnitTests: withProviderEnv('resolveAiGeneratedUnitTests'),
    resolveAiIssueFix: withProviderEnv('resolveAiIssueFix'),
    resolveAiPromptTask: withProviderEnv('resolveAiPromptTask'),
  };
}

module.exports = {
  createClaudeAiProvider,
};
