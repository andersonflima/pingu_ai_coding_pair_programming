'use strict';

const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULT_PROVIDER_COMMAND = 'copilot';
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const PROVIDER_PROBE_TIMEOUT_MS = 1200;
const PROVIDER_AVAILABILITY_TTL_MS = 15000;
const PROVIDER_RUNTIME_FAILURE_COOLDOWN_MS = 30000;
const RESPONSE_CACHE_MAX_ENTRIES = 128;
const FAILURE_CACHE_TTL_MS = 15000;

function createCopilotAiProvider(deps = {}) {
  const spawnSyncFn = typeof deps.spawnSync === 'function' ? deps.spawnSync : spawnSync;
  const parseJson = typeof deps.parseJson === 'function' ? deps.parseJson : JSON.parse;

  const availabilityCache = new Map();
  const responseCache = new Map();
  const responseCacheOrder = [];
  const failureCache = new Map();
  const runtimeFailureCache = new Map();

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

  function readFailureCooldownMs(env = process.env) {
    const parsed = Number.parseInt(normalizeEnvValue(env.PINGU_COPILOT_FAILURE_COOLDOWN_MS), 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return PROVIDER_RUNTIME_FAILURE_COOLDOWN_MS;
    }
    return parsed;
  }

  function readProviderModel(env = process.env) {
    return normalizeEnvValue(env.PINGU_COPILOT_MODEL || env.PINGU_AI_MODEL);
  }

  function isCodexCommand(command) {
    return path.basename(String(command || '').trim()) === 'codex';
  }

  function isClaudeCommand(command) {
    return path.basename(String(command || '').trim()) === 'claude';
  }

  function readProviderKind(command, env = process.env) {
    const kind = normalizeEnvValue(env.PINGU_CLI_PROVIDER_KIND).toLowerCase();
    if (['codex', 'claude', 'copilot'].includes(kind)) {
      return kind;
    }
    if (isCodexCommand(command)) {
      return 'codex';
    }
    if (isClaudeCommand(command)) {
      return 'claude';
    }
    return 'copilot';
  }

  function buildProviderArgs(command, prompt, env = process.env) {
    const model = readProviderModel(env);
    const kind = readProviderKind(command, env);
    if (kind === 'codex') {
      const args = ['exec', '--skip-git-repo-check', '-s', 'read-only'];
      if (model) {
        args.push('-m', model);
      }
      args.push(prompt);
      return args;
    }

    if (kind === 'claude') {
      const args = ['-p', prompt, '--output-format', 'json', '--max-turns', '1'];
      if (model) {
        args.push('--model', model);
      }
      return args;
    }

    return [
      '-p',
      prompt,
      '-s',
      '--no-ask-user',
      '--output-format=text',
    ];
  }

  function hasRuntimeFailureCooldown(command) {
    const expiresAt = Number(runtimeFailureCache.get(command) || 0);
    if (!expiresAt) {
      return false;
    }
    if (expiresAt <= Date.now()) {
      runtimeFailureCache.delete(command);
      return false;
    }
    return true;
  }

  function storeRuntimeFailure(command, env = process.env) {
    if (!command) {
      return;
    }
    const cooldownMs = readFailureCooldownMs(env);
    if (cooldownMs <= 0) {
      return;
    }
    runtimeFailureCache.set(command, Date.now() + cooldownMs);
  }

  function clearRuntimeFailure(command) {
    if (!command) {
      return;
    }
    runtimeFailureCache.delete(command);
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
    if (hasRuntimeFailureCooldown(command)) {
      return false;
    }
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
      const available = Boolean(result && result.status === 0);
      if (available) {
        clearRuntimeFailure(command);
      }
      return cacheAvailabilityResult(cacheKey, available);
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

  function unwrapProviderJsonResult(parsed) {
    if (!parsed || typeof parsed !== 'object') {
      return parsed;
    }
    const result = typeof parsed.result === 'string' ? parsed.result : '';
    if (!result.trim()) {
      return parsed;
    }
    const jsonText = extractJsonLikeContent(result);
    return jsonText ? safeJsonParse(jsonText) || parsed : parsed;
  }

  function normalizeAiTaskResult(rawResult, mode = 'comment_task') {
    if (!rawResult || typeof rawResult !== 'object') {
      return null;
    }

    const snippet = mode === 'prompt_task'
      ? String(rawResult.snippet || '').replace(/\r\n/g, '\n').replace(/^\n+/, '').replace(/\n+$/, '')
      : String(rawResult.snippet || '').trim();
    if (!snippet.trim()) {
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
        line: Number(action.line || action.lnum || 0) || undefined,
        lnum: Number(action.lnum || action.line || 0) || undefined,
        range: action.range && typeof action.range === 'object' ? action.range : undefined,
        text: typeof action.text === 'string' ? action.text : undefined,
        indent: typeof action.indent === 'string' ? action.indent : undefined,
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
      .update('\0')
      .update(readProviderModel(env))
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

  function storeFailure(cacheKey, command = '', env = process.env) {
    if (cacheKey) {
      failureCache.set(cacheKey, Date.now());
    }
    storeRuntimeFailure(command, env);
    return null;
  }

  function buildProviderPrompt(payload) {
    return [
      'Voce e o runtime interno do Pingu para geracao de codigo.',
      'Responda SOMENTE com JSON valido no formato:',
      '{"snippet":"...","message":"...","suggestion":"...","dependencies":["..."],"action":{"op":"","line":0,"range":null,"text":"","indent":"","target_file":"","mkdir_p":false,"remove_trigger":false,"command":"","description":""}}',
      'Sem markdown, sem explicacao extra, sem texto fora do JSON.',
      'Use snippet com codigo ou comando final pronto.',
      'Para comentarios/docstrings, produza texto especifico ao simbolo e ao fluxo real do arquivo; evite frases vagas.',
      'Nao usar formulacoes genericas como "orquestra o comportamento principal" sem contexto concreto.',
      'Quando payload.syntaxErrorOutput estiver presente, trate esse output como fonte primaria para corrigir syntax/lint no trecho alvo.',
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
    if (hasRuntimeFailureCooldown(command)) {
      return null;
    }
    const prompt = buildProviderPrompt(payload);
    const args = buildProviderArgs(command, prompt, env);

    let result;
    try {
      result = spawnSyncFn(command, args, {
        encoding: 'utf8',
        env,
        timeout: readTimeoutMs(env),
        maxBuffer: 2 * 1024 * 1024,
      });
    } catch (_error) {
      return storeFailure(cacheKey, command, env);
    }

    if (!result || result.status !== 0) {
      return storeFailure(cacheKey, command, env);
    }

    const stdout = String(result.stdout || '').trim();
    const jsonText = extractJsonLikeContent(stdout);
    if (!jsonText) {
      return storeFailure(cacheKey, command, env);
    }

    const parsed = safeJsonParse(jsonText);
    const normalized = normalizeAiTaskResult(unwrapProviderJsonResult(parsed), mode);
    if (!normalized) {
      return storeFailure(cacheKey, command, env);
    }

    clearRuntimeFailure(command);
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

  function resolveAiPromptTask(request, env = process.env) {
    return resolveCopilotPayload(request, 'prompt_task', env);
  }

  return {
    hasOpenAiConfiguration,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
    resolveAiPromptTask,
  };
}

module.exports = {
  createCopilotAiProvider,
};
