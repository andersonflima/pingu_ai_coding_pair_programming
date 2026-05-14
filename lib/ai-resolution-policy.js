'use strict';

const DEFAULT_OFFLINE_FIRST = true;

const DEFAULT_AI_FEATURE_MODES = Object.freeze({
  comment_task: 'prefer',
  context_file: 'prefer',
  unit_test: 'prefer',
  automatic_comment: 'prefer',
  automatic_fix: 'off',
});

const FEATURE_MODE_ENV_KEYS = Object.freeze({
  comment_task: ['PINGU_AI_COMMENT_TASK_MODE', 'PINGU_AI_ACTIONS_MODE', 'PINGU_AI_MODE'],
  context_file: ['PINGU_AI_CONTEXT_FILE_MODE', 'PINGU_AI_ACTIONS_MODE', 'PINGU_AI_MODE'],
  unit_test: ['PINGU_AI_UNIT_TEST_MODE', 'PINGU_AI_ACTIONS_MODE', 'PINGU_AI_MODE'],
  automatic_comment: ['PINGU_AI_AUTOMATIC_COMMENT_MODE', 'PINGU_AI_AUTOFIX_MODE', 'PINGU_AI_MODE'],
  automatic_fix: ['PINGU_AI_AUTOMATIC_FIX_MODE', 'PINGU_AI_AUTOFIX_MODE', 'PINGU_AI_MODE'],
});

const FEATURE_BOOLEAN_ENV_KEYS = Object.freeze({
  comment_task: {
    force: ['PINGU_FORCE_AI_COMMENT_TASK', 'PINGU_FORCE_AI_ACTIONS'],
    prefer: ['PINGU_PREFER_AI_COMMENT_TASK', 'PINGU_PREFER_AI_ACTIONS'],
  },
  context_file: {
    force: ['PINGU_FORCE_AI_CONTEXT_FILE', 'PINGU_FORCE_AI_ACTIONS'],
    prefer: ['PINGU_PREFER_AI_CONTEXT_FILE', 'PINGU_PREFER_AI_ACTIONS'],
  },
  unit_test: {
    force: ['PINGU_FORCE_AI_UNIT_TEST', 'PINGU_FORCE_AI_ACTIONS'],
    prefer: ['PINGU_PREFER_AI_UNIT_TEST', 'PINGU_PREFER_AI_ACTIONS'],
  },
  automatic_comment: {
    force: ['PINGU_FORCE_AI_AUTOMATIC_COMMENT', 'PINGU_FORCE_AI_AUTOFIX'],
    prefer: ['PINGU_AUTOMATIC_AI_COMMENT_RESOLUTION', 'PINGU_PREFER_AI_AUTOMATIC_COMMENT', 'PINGU_PREFER_AI_AUTOFIX'],
  },
  automatic_fix: {
    force: ['PINGU_FORCE_AI_AUTOMATIC_FIX', 'PINGU_FORCE_AI_AUTOFIX'],
    prefer: ['PINGU_AUTOMATIC_AI_RESOLUTION', 'PINGU_PREFER_AI_AUTOMATIC_FIX', 'PINGU_PREFER_AI_AUTOFIX'],
  },
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
  return isBooleanEnabledValue(
    env.PINGU_OFFLINE_FIRST,
    DEFAULT_OFFLINE_FIRST,
  );
}

function isTruthyFlag(value) {
  return /^(?:1|true|yes|on|enabled)$/i.test(String(value || '').trim());
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

function firstConfiguredMode(env = {}, keys = [], fallbackMode = '') {
  return keys.reduce((resolvedMode, key) => {
    if (resolvedMode) {
      return resolvedMode;
    }

    const rawValue = String(env[key] || '').trim();
    if (!rawValue) {
      return '';
    }

    return normalizeAiResolutionMode(rawValue, fallbackMode);
  }, '');
}

function hasAnyTruthyFlag(env = {}, keys = []) {
  return keys.some((key) => isTruthyFlag(env[key]));
}

function readAiFeatureMode(feature, env = process.env) {
  // Entrada: feature + env | Saida: modo normalizado para força/preferência/off.
  if (isOfflineFirstMode(env)) {
    return 'off';
  }
  const normalizedFeature = String(feature || '').trim();
  const fallbackMode = DEFAULT_AI_FEATURE_MODES[normalizedFeature] || 'off';

  const configuredMode = firstConfiguredMode(env, FEATURE_MODE_ENV_KEYS[normalizedFeature] || [], fallbackMode);
  if (configuredMode) {
    return configuredMode;
  }

  const featureFlags = FEATURE_BOOLEAN_ENV_KEYS[normalizedFeature] || {};
  if (hasAnyTruthyFlag(env, featureFlags.force || [])) {
    return 'force';
  }
  if (hasAnyTruthyFlag(env, featureFlags.prefer || [])) {
    return 'prefer';
  }

  return fallbackMode;
}

function resolveAiFeaturePolicy(feature, env = process.env, options = {}) {
  // Entrada: feature/env/opções | Saida: objeto de política para decidir fallback e chamada IA.
  const offlineFirst = isOfflineFirstMode(env);
  if (offlineFirst) {
    return {
      feature: String(feature || '').trim(),
      mode: 'off',
      hasOpenAiConfiguration: false,
      mustUseAi: false,
      shouldUseAi: false,
      canFallBack: true,
      offlineFirst,
    };
  }

  const mode = readAiFeatureMode(feature, env);
  const hasOpenAiConfiguration = options.hasOpenAiConfiguration === true;
  const mustUseAi = mode === 'force';
  const shouldUseAi = mustUseAi || (mode === 'prefer' && hasOpenAiConfiguration);

  return {
    feature: String(feature || '').trim(),
    mode,
    hasOpenAiConfiguration,
    mustUseAi,
    shouldUseAi,
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
