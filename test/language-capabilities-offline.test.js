'use strict';

const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

function loadLanguageCapabilities() {
  const modulePath = path.resolve(__dirname, '../lib/language-capabilities');
  delete require.cache[modulePath];
  return require(modulePath);
}

function withPatchedNodeEnv(nextEnv, fn) {
  const originalEnv = new Map(Object.entries({
    NODE_ENV: process.env.NODE_ENV,
    PINGU_OFFLINE_MODE: process.env.PINGU_OFFLINE_MODE,
    PINGU_ACTIVE_LANGUAGE_IDS: process.env.PINGU_ACTIVE_LANGUAGE_IDS,
  }));

  try {
    if (nextEnv.NODE_ENV === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = nextEnv.NODE_ENV;
    }

    if (nextEnv.PINGU_OFFLINE_MODE === undefined) {
      delete process.env.PINGU_OFFLINE_MODE;
    } else {
      process.env.PINGU_OFFLINE_MODE = nextEnv.PINGU_OFFLINE_MODE;
    }

    if (nextEnv.PINGU_ACTIVE_LANGUAGE_IDS === undefined) {
      delete process.env.PINGU_ACTIVE_LANGUAGE_IDS;
    } else {
      process.env.PINGU_ACTIVE_LANGUAGE_IDS = nextEnv.PINGU_ACTIVE_LANGUAGE_IDS;
    }

    return fn(loadLanguageCapabilities());
  } finally {
    originalEnv.forEach((value, key) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    });
  }
}

test('requiresAiForFeature retorna false em runtime de produção para features offline', () => {
  withPatchedNodeEnv({ NODE_ENV: 'production' }, ({ languageCapabilityRegistry, requiresAiForFeature }) => {
    const entries = languageCapabilityRegistry()
      .filter((entry) => entry.id !== 'default')
      .filter((entry) => Array.isArray(entry.editorFeatures) && entry.editorFeatures.length > 0);

    entries.forEach((entry) => {
      const representativeExtension = entry.extensions[0] || '.txt';
      ['comment_task', 'context_file', 'unit_test', 'terminal_task'].forEach((feature) => {
        if (entry.editorFeatures.includes(feature)) {
          assert.equal(
            requiresAiForFeature(representativeExtension, feature),
            false,
            `language=${entry.id} feature=${feature}`,
          );
        }
      });
    });
  });
});

test('requiresAiForFeature retorna false quando PINGU_OFFLINE_MODE for true', () => {
  withPatchedNodeEnv({ PINGU_OFFLINE_MODE: 'true' }, ({ requiresAiForFeature }) => {
    assert.equal(requiresAiForFeature('.js', 'comment_task'), false);
    assert.equal(requiresAiForFeature('.py', 'unit_test'), false);
  });
});

test('formatos estruturados nao anunciam unit_test', () => {
  withPatchedNodeEnv({}, ({ supportsEditorFeature, declaredOfflineCapabilitiesFor }) => {
    ['.md', '.mmd', '.mermaid', '.dockerfile', '.yaml', '.yml', '.toml', '.tf'].forEach((extension) => {
      assert.equal(supportsEditorFeature(extension, 'unit_test'), false, extension);
      assert.equal(declaredOfflineCapabilitiesFor(extension).includes('contract_test_generation'), false, extension);
      assert.equal(declaredOfflineCapabilitiesFor(extension).includes('unit_test_generation'), false, extension);
    });
  });
});
