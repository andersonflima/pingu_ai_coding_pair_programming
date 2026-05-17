'use strict';

const DEFAULT_OFFLINE_FIRST = false;
const DEFAULT_AI_FEATURE_MODES = Object.freeze({
  comment_task: 'prefer',
  context_file: 'prefer',
  unit_test: 'prefer',
  automatic_comment: 'prefer',
  automatic_fix: 'prefer',
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
  // Runtime usa fallback offline, mas pode acionar provider externo quando estiver disponível.
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
  // Entrada: feature + env | Saida: modo default do runtime (prefer/off) sem dependência obrigatória.
  void env;
  const normalizedFeature = String(feature || '').trim();
  return DEFAULT_AI_FEATURE_MODES[normalizedFeature] || 'off';
}

function resolveAiFeaturePolicy(feature, env = process.env, options = {}) {
  // Entrada: feature/env/opções | Saida: uso oportunista de provider com fallback local.
  const offlineFirst = isOfflineFirstMode(env);
  const mode = readAiFeatureMode(feature, env);
  const hasProviderConfiguration = options.hasOpenAiConfiguration === true;
  const mustUseAi = mode === 'force';
  const shouldUseAi = mustUseAi || (mode === 'prefer' && hasProviderConfiguration);

  return {
    feature: String(feature || '').trim(),
    mode,
    hasOpenAiConfiguration: hasProviderConfiguration,
    mustUseAi,
    shouldUseAi,
    offlineFirst,
    canFallBack: !mustUseAi,
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
