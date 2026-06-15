'use strict';

const { createCopilotAiProvider } = require('./ai-provider-copilot');

function createAiProvider(deps = {}) {
  const copilotProvider = deps.copilotProvider || createCopilotAiProvider(deps.copilotDeps || {});

  function hasOpenAiConfiguration(env = process.env) {
    return Boolean(
      copilotProvider
      && typeof copilotProvider.hasOpenAiConfiguration === 'function'
      && copilotProvider.hasOpenAiConfiguration(env),
    );
  }

  function activeProviderName(env = process.env) {
    return hasOpenAiConfiguration(env) ? 'copilot' : 'none';
  }

  function resolveWith(methodName, request, env = process.env) {
    if (!copilotProvider || typeof copilotProvider[methodName] !== 'function') {
      return null;
    }
    if (!hasOpenAiConfiguration(env)) {
      return null;
    }
    return copilotProvider[methodName](request, env);
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

  function resolveAiPromptTask(request, env = process.env) {
    return resolveWith('resolveAiPromptTask', request, env)
      || resolveAiGeneratedTask(request, env);
  }

  return {
    activeProviderName,
    hasOpenAiConfiguration,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
    resolveAiPromptTask,
  };
}

module.exports = {
  createAiProvider,
};
