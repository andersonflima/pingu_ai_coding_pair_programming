'use strict';

const DEFAULT_OFFLINE_FIRST = true;
const DEFAULT_AI_FEATURE_MODES = Object.freeze({
  comment_task: 'off',
  context_file: 'off',
  unit_test: 'off',
  automatic_comment: 'off',
  automatic_fix: 'off',
});

function isBooleanEnabledValue(value, fallback = false) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (['0', 'false', 'off', 'disable', 'disabled', 'no', 'nao', 'não'].includes(normalized)) {
    return false;
  }
  if (['1', 'true', 'on', 'enabled', 'enable', 'yes', 'sim'].includes(normalized)) {
    return true;
  }
  return fallback;
}

function isOfflineFirstMode(env = process.env) {
  // Runtime consolidado como offline-only: variáveis de ambiente não alternam modo.
  void env;
  return DEFAULT_OFFLINE_FIRST;
}

function normalizeAiResolutionMode(value, fallbackMode = 'off') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallbackMode;
  }

  if (['force', 'forced', 'strict', 'required', 'mandatory'].includes(normalized)) {
    return 'force';
  }
  if (['prefer', 'preferred', 'on', 'true', 'enabled', 'auto'].includes(normalized)) {
    return 'prefer';
  }
  if (['off', 'false', 'disabled', 'none'].includes(normalized)) {
    return 'off';
  }

  return fallbackMode;
}

function readAiFeatureMode(feature, env = process.env) {
  // Entrada: feature + env | Saida: sempre off no runtime offline-only.
  void env;
  const normalizedFeature = String(feature || '').trim();
  return DEFAULT_AI_FEATURE_MODES[normalizedFeature] || 'off';
}

function resolveAiFeaturePolicy(feature, env = process.env, options = {}) {
  // Entrada: feature/env/opções | Saida: política fixa offline-only.
  void options;
  const offlineFirst = isOfflineFirstMode(env);
  const mode = readAiFeatureMode(feature, env);

  return {
    feature: String(feature || '').trim(),
    mode,
    hasOpenAiConfiguration: false,
    mustUseAi: false,
    shouldUseAi: false,
    offlineFirst,
    canFallBack: true,
  };
}

module.exports = {
  DEFAULT_AI_FEATURE_MODES,
  isOfflineFirstMode,
  isBooleanEnabledValue,
  normalizeAiResolutionMode,
  readAiFeatureMode,
  resolveAiFeaturePolicy,
};
