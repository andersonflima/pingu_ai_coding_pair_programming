'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isOfflineFirstMode,
  normalizeAiResolutionMode,
  readAiFeatureMode,
  resolveAiFeaturePolicy,
} = require('../lib/ai-resolution-policy');

test('normalizeAiResolutionMode understands prefer, force and off aliases', () => {
  assert.equal(normalizeAiResolutionMode('auto'), 'prefer');
  assert.equal(normalizeAiResolutionMode('required'), 'force');
  assert.equal(normalizeAiResolutionMode('disabled'), 'off');
});

test('readAiFeatureMode mantém modo offline como padrão e respeita ambiente online', () => {
  assert.equal(readAiFeatureMode('comment_task', {}), 'off');
  assert.equal(readAiFeatureMode('comment_task', { PINGU_OFFLINE_FIRST: 'false' }), 'prefer');
});

test('readAiFeatureMode respeita configurações quando online', () => {
  assert.equal(readAiFeatureMode('comment_task', {
    PINGU_OFFLINE_FIRST: 'false',
    PINGU_AI_COMMENT_TASK_MODE: 'off',
  }), 'off');
  assert.equal(readAiFeatureMode('unit_test', {
    PINGU_OFFLINE_FIRST: 'false',
    PINGU_FORCE_AI_UNIT_TEST: '1',
  }), 'force');
  assert.equal(readAiFeatureMode('automatic_fix', {
    PINGU_OFFLINE_FIRST: 'false',
    PINGU_AUTOMATIC_AI_RESOLUTION: 'true',
  }), 'prefer');
});

test('resolveAiFeaturePolicy mantém comportamento offline-first e alterna em ambiente online', () => {
  const offline = resolveAiFeaturePolicy('comment_task', {}, { hasOpenAiConfiguration: false });
  const onlineWithoutKey = resolveAiFeaturePolicy('comment_task', { PINGU_OFFLINE_FIRST: 'false' }, {
    hasOpenAiConfiguration: false,
  });
  const onlineWithKey = resolveAiFeaturePolicy('comment_task', { PINGU_OFFLINE_FIRST: 'false' }, {
    hasOpenAiConfiguration: true,
  });
  const forced = resolveAiFeaturePolicy(
    'comment_task',
    {
      PINGU_OFFLINE_FIRST: 'false',
      PINGU_AI_COMMENT_TASK_MODE: 'force',
    },
    { hasOpenAiConfiguration: false },
  );

  assert.equal(offline.offlineFirst, true);
  assert.equal(offline.mode, 'off');
  assert.equal(offline.shouldUseAi, false);
  assert.equal(onlineWithoutKey.mode, 'prefer');
  assert.equal(onlineWithoutKey.shouldUseAi, false);
  assert.equal(onlineWithKey.mode, 'prefer');
  assert.equal(onlineWithKey.shouldUseAi, true);
  assert.equal(forced.mode, 'force');
  assert.equal(forced.mustUseAi, true);
  assert.equal(forced.canFallBack, false);
});

test('resolveAiFeaturePolicy pode alternar modo offline via PINGU_OFFLINE_FIRST', () => {
  const envOnline = {
    PINGU_OFFLINE_FIRST: 'false',
    PINGU_AI_COMMENT_TASK_MODE: 'force',
  };

  const policy = resolveAiFeaturePolicy('comment_task', envOnline, { hasOpenAiConfiguration: false });
  const fallback = readAiFeatureMode('comment_task', envOnline);

  assert.equal(isOfflineFirstMode(envOnline), false);
  assert.equal(fallback, 'force');
  assert.equal(policy.mode, 'force');
  assert.equal(policy.mustUseAi, true);
  assert.equal(policy.canFallBack, false);
  assert.equal(policy.offlineFirst, false);
});

test('readAiFeatureMode respeita modo off desativando offline-first', () => {
  const envOnline = {
    PINGU_OFFLINE_FIRST: '0',
    PINGU_AI_UNIT_TEST_MODE: 'off',
  };
  assert.equal(readAiFeatureMode('unit_test', envOnline), 'off');
});
