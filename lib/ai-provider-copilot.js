'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');

const DEFAULT_PROVIDER_COMMAND = 'copilot';
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const PROVIDER_PROBE_TIMEOUT_MS = 1200;
const PROVIDER_AVAILABILITY_TTL_MS = 15000;
const RESPONSE_CACHE_MAX_ENTRIES = 128;
const FAILURE_CACHE_TTL_MS = 15000;

function createCopilotAiProvider(deps = {}) {
  const spawnSyncFn = typeof deps.spawnSync === 'function' ? deps.spawnSync : spawnSync;
  const parseJson = typeof deps.parseJson === 'function' ? deps.parseJson : JSON.parse;

  const availabilityCache = new Map();
  const responseCache = new Map();
  const responseCacheOrder = [];
  const failureCache = new Map();

  function normalizeEnvValue(value) {
    return String(value || '').trim();
  }

  function isProviderDisabled(env = process.env) {
    const normalized = normalizeEnvValue(env.PINGU_COPILOT_DISABLED || '').toLowerCase();
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
  }

  function readProviderCommand(env = process.env) {
    return normalizeEnvValue(env.PINGU_COPILOT_COMMAND) || DEFAULT_PROVIDER_COMMAND;
  }

  function readTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(normalizeEnvValue(env.PINGU_COPILOT_TIMEOUT_MS), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_REQUEST_TIMEOUT_MS;
    }
    return parsed;
  }

  function cacheAvailabilityResult(cacheKey, available) {
    availabilityCache.set(cacheKey, {
      available: Boolean(available),
      expiresAt: Date.now() + PROVIDER_AVAILABILITY_TTL_MS,
    });
    return Boolean(available);
  }

  function probeProviderAvailability(env = process.env) {
    if (isProviderDisabled(env)) {
      return false;
    }

    const command = readProviderCommand(env);
    const cacheKey = `${command}`;
    const cached = availabilityCache.get(cacheKey);
    if (cached && Number(cached.expiresAt) > Date.now()) {
      return Boolean(cached.available);
    }

    try {
      const result = spawnSyncFn(command, ['--version'], {
        encoding: 'utf8',
        env,
        timeout: PROVIDER_PROBE_TIMEOUT_MS,
        maxBuffer: 128 * 1024,
      });
      return cacheAvailabilityResult(cacheKey, result && result.status === 0);
    } catch (_error) {
      return cacheAvailabilityResult(cacheKey, false);
    }
  }

  function safeJsonParse(raw) {
    try {
      return parseJson(raw);
    } catch (_error) {
      return null;
    }
  }

  function extractJsonLikeContent(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return '';
    }

    if (text.startsWith('{') && text.endsWith('}')) {
      return text;
    }

    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      return String(fenced[1] || '').trim();
    }

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1).trim();
    }

    return '';
  }

  function normalizeAiTaskResult(rawResult, mode = 'comment_task') {
    if (!rawResult || typeof rawResult !== 'object') {
      return null;
    }

    const snippet = String(rawResult.snippet || '').trim();
    if (!snippet) {
      return null;
    }

    const action = rawResult.action && typeof rawResult.action === 'object'
      ? rawResult.action
      : {};

    return {
      snippet,
      message: String(rawResult.message || ''),
      suggestion: String(rawResult.suggestion || ''),
      dependencies: Array.isArray(rawResult.dependencies) ? rawResult.dependencies : [],
      action: {
        op: String(action.op || ''),
        target_file: String(action.target_file || ''),
        mkdir_p: Boolean(action.mkdir_p),
        remove_trigger: Boolean(action.remove_trigger),
        command: String(action.command || ''),
        description: String(action.description || ''),
      },
      mode,
    };
  }

  function responseCacheKey(payload, env) {
    return crypto.createHash('sha1')
      .update(JSON.stringify(payload || {}))
      .update('\0')
      .update(readProviderCommand(env))
      .digest('hex');
  }

  function cloneResult(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function touchResponseCacheKey(cacheKey) {
    const index = responseCacheOrder.indexOf(cacheKey);
    if (index >= 0) {
      responseCacheOrder.splice(index, 1);
    }
    responseCacheOrder.push(cacheKey);
  }

  function pruneResponseCache() {
    while (responseCacheOrder.length > RESPONSE_CACHE_MAX_ENTRIES) {
      const stale = responseCacheOrder.shift();
      responseCache.delete(stale);
    }
  }

  function readCachedResponse(cacheKey) {
    if (!responseCache.has(cacheKey)) {
      return null;
    }
    touchResponseCacheKey(cacheKey);
    return cloneResult(responseCache.get(cacheKey));
  }

  function storeCachedResponse(cacheKey, result) {
    failureCache.delete(cacheKey);
    responseCache.set(cacheKey, cloneResult(result));
    touchResponseCacheKey(cacheKey);
    pruneResponseCache();
    return cloneResult(result);
  }

  function hasRecentFailure(cacheKey) {
    const cachedAt = Number(failureCache.get(cacheKey) || 0);
    if (!cachedAt) {
      return false;
    }
    if (Date.now() - cachedAt > FAILURE_CACHE_TTL_MS) {
      failureCache.delete(cacheKey);
      return false;
    }
    return true;
  }

  function storeFailure(cacheKey) {
    if (cacheKey) {
      failureCache.set(cacheKey, Date.now());
    }
    return null;
  }

  function buildProviderPrompt(payload) {
    return [
      'Voce e o runtime interno do Pingu para geracao de codigo.',
      'Responda SOMENTE com JSON valido no formato:',
      '{"snippet":"...","message":"...","suggestion":"...","dependencies":["..."],"action":{"op":"","target_file":"","mkdir_p":false,"remove_trigger":false,"command":"","description":""}}',
      'Sem markdown, sem explicacao extra, sem texto fora do JSON.',
      'Use snippet com codigo ou comando final pronto.',
      'Se nao houver action especifica, retorne action com campos vazios e booleans false.',
      '',
      'Payload:',
      JSON.stringify(payload),
    ].join('\n');
  }

  function resolveCopilotPayload(payload, mode = 'comment_task', env = process.env) {
    if (!probeProviderAvailability(env)) {
      return null;
    }

    const cacheKey = responseCacheKey(payload, env);
    const cached = readCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }
    if (hasRecentFailure(cacheKey)) {
      return null;
    }

    const command = readProviderCommand(env);
    const prompt = buildProviderPrompt(payload);

    let result;
    try {
      result = spawnSyncFn(command, [
        '-p',
        prompt,
        '-s',
        '--no-ask-user',
        '--output-format=text',
      ], {
        encoding: 'utf8',
        env,
        timeout: readTimeoutMs(env),
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (_error) {
      return storeFailure(cacheKey);
    }

    if (!result || result.status !== 0) {
      return storeFailure(cacheKey);
    }

    const stdout = String(result.stdout || '').trim();
    const jsonText = extractJsonLikeContent(stdout);
    if (!jsonText) {
      return storeFailure(cacheKey);
    }

    const parsed = safeJsonParse(jsonText);
    const normalized = normalizeAiTaskResult(parsed, mode);
    if (!normalized) {
      return storeFailure(cacheKey);
    }

    return storeCachedResponse(cacheKey, normalized);
  }

  function hasOpenAiConfiguration(env = process.env) {
    return probeProviderAvailability(env);
  }

  function resolveAiGeneratedTask(request, env = process.env) {
    return resolveCopilotPayload(request, 'comment_task', env);
  }

  function resolveAiIssueFix(request, env = process.env) {
    return resolveCopilotPayload(request, 'issue_fix', env);
  }

  function resolveAiGeneratedUnitTests(request, env = process.env) {
    return resolveCopilotPayload(request, 'unit_test', env);
  }

  function resolveAiContextResolution(request, env = process.env) {
    return resolveCopilotPayload(request, 'context_resolution', env);
  }

  return {
    hasOpenAiConfiguration,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
  };
}

module.exports = {
  createCopilotAiProvider,
};
