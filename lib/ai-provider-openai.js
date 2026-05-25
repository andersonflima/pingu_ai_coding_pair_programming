'use strict';

const { spawnSync } = require('child_process');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';
const DEFAULT_OPENAI_TIMEOUT_MS = 30000;
const DEFAULT_OPENAI_COMMAND = 'curl';
const PROVIDER_PROBE_TIMEOUT_MS = 1200;
const OPENAI_FAILURE_CACHE_TTL_MS = 15000;

function createOpenAiProvider(deps = {}) {
  const spawnSyncFn = typeof deps.spawnSync === 'function' ? deps.spawnSync : spawnSync;
  const parseJson = typeof deps.parseJson === 'function' ? deps.parseJson : JSON.parse;
  const failureCache = new Map();

  function normalizeEnvValue(value) {
    return String(value || '').trim();
  }

  function isProviderDisabled(env = process.env) {
    const normalized = normalizeEnvValue(env.PINGU_OPENAI_DISABLED || '').toLowerCase();
    return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalized);
  }

  function readApiKey(env = process.env) {
    return normalizeEnvValue(env.OPENAI_API_KEY);
  }

  function readBaseUrl(env = process.env) {
    const rawBaseUrl = normalizeEnvValue(env.PINGU_OPENAI_BASE_URL || env.OPENAI_BASE_URL);
    const baseUrl = rawBaseUrl || DEFAULT_OPENAI_BASE_URL;
    return baseUrl.replace(/\/+$/, '');
  }

  function readModel(env = process.env) {
    return normalizeEnvValue(env.PINGU_OPENAI_MODEL || env.OPENAI_MODEL) || DEFAULT_OPENAI_MODEL;
  }

  function readTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(normalizeEnvValue(env.PINGU_OPENAI_TIMEOUT_MS), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_OPENAI_TIMEOUT_MS;
    }
    return parsed;
  }

  function readProviderCommand(env = process.env) {
    return normalizeEnvValue(env.PINGU_OPENAI_COMMAND) || DEFAULT_OPENAI_COMMAND;
  }

  function buildProviderPrompt(payload) {
    return [
      'Voce e o runtime interno do Pingu para geracao de codigo.',
      'Responda SOMENTE com JSON valido no formato:',
      '{"snippet":"...","message":"...","suggestion":"...","dependencies":["..."],"action":{"op":"","target_file":"","mkdir_p":false,"remove_trigger":false,"command":"","description":""}}',
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

  function requestCacheKey(payload, env = process.env) {
    return JSON.stringify({
      payload: payload || {},
      baseUrl: readBaseUrl(env),
      model: readModel(env),
    });
  }

  function hasRecentFailure(cacheKey) {
    const cachedAt = Number(failureCache.get(cacheKey) || 0);
    if (!cachedAt) {
      return false;
    }
    if (Date.now() - cachedAt > OPENAI_FAILURE_CACHE_TTL_MS) {
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

  function hasOpenAiConfiguration(env = process.env) {
    if (isProviderDisabled(env)) {
      return false;
    }
    if (empty(readApiKey(env))) {
      return false;
    }
    const command = readProviderCommand(env);
    try {
      const probe = spawnSyncFn(command, ['--version'], {
        encoding: 'utf8',
        env,
        timeout: PROVIDER_PROBE_TIMEOUT_MS,
        maxBuffer: 128 * 1024,
      });
      return Boolean(probe && probe.status === 0);
    } catch (_error) {
      return false;
    }
  }

  function extractOutputText(responsePayload) {
    const direct = String(
      responsePayload
      && responsePayload.choices
      && responsePayload.choices[0]
      && responsePayload.choices[0].message
      && responsePayload.choices[0].message.content
      || '',
    ).trim();
    if (direct) {
      return direct;
    }

    const output = Array.isArray(responsePayload && responsePayload.output)
      ? responsePayload.output
      : [];
    const textFragments = [];
    output.forEach((item) => {
      if (type(item) !== 'dict') {
        return;
      }
      const content = Array.isArray(item.content) ? item.content : [];
      content.forEach((entry) => {
        if (type(entry) !== 'dict') {
          return;
        }
        if (String(entry.type || '') === 'output_text') {
          textFragments.push(String(entry.text || ''));
        }
      });
    });
    return textFragments.join('\n').trim();
  }

  function resolveOpenAiPayload(payload, mode = 'comment_task', env = process.env) {
    if (!hasOpenAiConfiguration(env)) {
      return null;
    }

    const cacheKey = requestCacheKey(payload, env);
    if (hasRecentFailure(cacheKey)) {
      return null;
    }

    const prompt = buildProviderPrompt(payload);
    const url = `${readBaseUrl(env)}/chat/completions`;
    const timeoutMs = readTimeoutMs(env);
    const command = readProviderCommand(env);

    try {
      const response = spawnSyncFn(command, [
        '-sS',
        '--fail-with-body',
        url,
        '-H',
        `Authorization: Bearer ${readApiKey(env)}`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({
          model: readModel(env),
          temperature: 0,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      ], {
        encoding: 'utf8',
        env,
        timeout: timeoutMs,
        maxBuffer: 2 * 1024 * 1024,
      });
      if (!response || response.status !== 0) {
        return storeFailure(cacheKey);
      }

      const responsePayload = safeJsonParse(String(response.stdout || '').trim());
      if (!responsePayload || typeof responsePayload !== 'object') {
        return storeFailure(cacheKey);
      }
      const rawText = extractOutputText(responsePayload);
      const jsonText = extractJsonLikeContent(rawText);
      if (!jsonText) {
        return storeFailure(cacheKey);
      }

      const parsed = safeJsonParse(jsonText);
      const normalized = normalizeAiTaskResult(parsed, mode);
      if (!normalized) {
        return storeFailure(cacheKey);
      }

      return normalized;
    } catch (_error) {
      return storeFailure(cacheKey);
    }
  }

  function resolveAiGeneratedTask(request, env = process.env) {
    return resolveOpenAiPayload(request, 'comment_task', env);
  }

  function resolveAiIssueFix(request, env = process.env) {
    return resolveOpenAiPayload(request, 'issue_fix', env);
  }

  function resolveAiGeneratedUnitTests(request, env = process.env) {
    return resolveOpenAiPayload(request, 'unit_test', env);
  }

  function resolveAiContextResolution(request, env = process.env) {
    return resolveOpenAiPayload(request, 'context_resolution', env);
  }

  return {
    hasOpenAiConfiguration,
    resolveAiContextResolution,
    resolveAiGeneratedTask,
    resolveAiGeneratedUnitTests,
    resolveAiIssueFix,
  };
}

function empty(value) {
  return String(value || '').trim().length === 0;
}

function type(value) {
  if (Array.isArray(value)) {
    return 'list';
  }
  if (value && typeof value === 'object') {
    return 'dict';
  }
  return typeof value;
}

module.exports = {
  createOpenAiProvider,
};
