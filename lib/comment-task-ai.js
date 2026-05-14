'use strict';

const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { loadProjectMemory } = require('./project-memory');
const { buildActionCommentContext, buildBufferFocusWindow } = require('./action-comment-context');
const { sourceSummary } = require('./source-symbols');
const { buildInstalledLibraryContext } = require('./installed-library-context');

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com';
const DEFAULT_OPENAI_MODEL = 'gpt-5-codex';
const DEFAULT_AI_TIMEOUT_MS = 30000;
const DEFAULT_OPENAI_REQUEST_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_OPENAI_REQUEST_TIME_BUFFER_MS = 1000;
const DEFAULT_SHELL_ENV_LOOKUP_TIMEOUT_MS = 1500;
const AI_RESPONSE_CACHE_MAX_ENTRIES = 128;
const AI_FAILURE_CACHE_TTL_MS = 15000;
const aiResponseCache = new Map();
const aiResponseCacheOrder = [];
const aiFailureCache = new Map();
const OPENAI_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['snippet', 'message', 'suggestion', 'dependencies', 'action'],
  properties: {
    snippet: { type: 'string' },
    message: { type: 'string' },
    suggestion: { type: 'string' },
    dependencies: {
      type: 'array',
      items: { type: 'string' },
    },
    action: {
      type: 'object',
      additionalProperties: false,
      required: ['op', 'target_file', 'mkdir_p', 'remove_trigger', 'command', 'description'],
      properties: {
        op: { type: 'string' },
        target_file: { type: 'string' },
        mkdir_p: { type: 'boolean' },
        remove_trigger: { type: 'boolean' },
        command: { type: 'string' },
        description: { type: 'string' },
      },
    },
  },
};

function createCommentTaskAiTools(deps = {}) {
  const {
    analysisExtension,
    bestPracticesFor,
    getCapabilityProfile,
    executeOpenAiRequest,
    parseJson,
    readEnvironmentValue: readEnvironmentValueOverride,
  } = deps;
  const spawnSyncFn = typeof deps.spawnSync === 'function' ? deps.spawnSync : spawnSync;
  const shellEnvCache = new Map();
  const jsonParse = typeof parseJson === 'function' ? parseJson : JSON.parse;
  const resolveOpenAiRequest = typeof executeOpenAiRequest === 'function'
    ? executeOpenAiRequest
    : createOpenAiRequestExecutor(spawnSyncFn);

  function createOpenAiRequestExecutor(spawnRequest) {
    return (requestBody, env = process.env, timeoutMs = readTimeoutMs(env)) => {
      const effectiveTimeout = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : DEFAULT_AI_TIMEOUT_MS;
      const endpoint = new URL('/v1/responses', readOpenAiBaseUrl(env)).toString();
      return spawnRequest('curl', [
        '--silent',
        '--show-error',
        '--fail',
        '--max-time',
        String(Math.max(1, Math.ceil(effectiveTimeout / 1000))),
        '-X',
        'POST',
        endpoint,
        '-H',
        `Authorization: Bearer ${readOpenAiApiKey(env)}`,
        '-H',
        'Content-Type: application/json',
        '-H',
        'Accept: application/json',
        '--data-binary',
        '@-',
      ], {
        encoding: 'utf8',
        input: String(requestBody || ''),
        timeout: effectiveTimeout + DEFAULT_OPENAI_REQUEST_TIME_BUFFER_MS,
        maxBuffer: DEFAULT_OPENAI_REQUEST_MAX_BUFFER_BYTES,
        env,
      });
    };
  }

  function normalizeEnvValue(value) {
    return String(value || '').trim();
  }

  function readShellResolvedEnvironmentValue(name, env = process.env) {
    const normalizedName = normalizeEnvValue(name);
    if (!/^[A-Z0-9_]+$/.test(normalizedName)) {
      return '';
    }

    const shellPath = normalizeEnvValue(env.SHELL || process.env.SHELL);
    if (!shellPath) {
      return '';
    }

    const cacheKey = [
      normalizedName,
      shellPath,
      normalizeEnvValue(env.HOME || process.env.HOME),
      normalizeEnvValue(env.USER || process.env.USER),
    ].join('\0');
    if (shellEnvCache.has(cacheKey)) {
      return shellEnvCache.get(cacheKey);
    }

    const beginMarker = '__PINGU_ENV_BEGIN__';
    const endMarker = '__PINGU_ENV_END__';
    const command = `command printf '${beginMarker}%s${endMarker}' "$${normalizedName}"`;

    try {
      const result = spawnSyncFn(shellPath, ['-lc', command], {
        encoding: 'utf8',
        env,
        timeout: DEFAULT_SHELL_ENV_LOOKUP_TIMEOUT_MS,
        maxBuffer: 64 * 1024,
      });
      const stdout = String(result && result.stdout || '');
      const startIndex = stdout.indexOf(beginMarker);
      const endIndex = stdout.indexOf(endMarker, startIndex + beginMarker.length);
      const resolvedValue = startIndex >= 0 && endIndex >= 0
        ? normalizeEnvValue(stdout.slice(startIndex + beginMarker.length, endIndex))
        : '';
      shellEnvCache.set(cacheKey, resolvedValue);
      return resolvedValue;
    } catch (_error) {
      shellEnvCache.set(cacheKey, '');
      return '';
    }
  }

  function readEnvironmentValue(name, env = process.env) {
    if (typeof readEnvironmentValueOverride === 'function') {
      return readEnvironmentValueOverride(name, env);
    }
    const directValue = normalizeEnvValue(env && env[name]);
    return directValue || readShellResolvedEnvironmentValue(name, env);
  }

  function resolveOpenAiResponseText(response, env) {
    const stdout = response && String(response.stdout || '').trim();
    if (!stdout) {
      return null;
    }

    const parsedResponse = safeJsonParse(stdout, jsonParse);
    if (!parsedResponse) {
      return null;
    }

    const rawText = extractStructuredTextFromResponse(parsedResponse);
    if (!rawText) {
      return null;
    }

    return safeJsonParse(rawText, jsonParse);
  }

  function readOpenAiApiKey(env = process.env) {
    return readEnvironmentValue('OPENAI_API_KEY', env);
  }

  function readOpenAiModel(env = process.env) {
    const configured = readEnvironmentValue('PINGU_OPENAI_MODEL', env)
      || readEnvironmentValue('OPENAI_MODEL', env)
      || DEFAULT_OPENAI_MODEL;
    return configured || DEFAULT_OPENAI_MODEL;
  }

  function readOpenAiBaseUrl(env = process.env) {
    const configured = readEnvironmentValue('OPENAI_BASE_URL', env)
      || readEnvironmentValue('PINGU_OPENAI_BASE_URL', env)
      || DEFAULT_OPENAI_BASE_URL;
    return configured || DEFAULT_OPENAI_BASE_URL;
  }

  function hasOpenAiConfiguration(env = process.env) {
    return readOpenAiApiKey(env).length > 0;
  }

  function readTimeoutMs(env = process.env) {
    const parsed = Number.parseInt(readEnvironmentValue('PINGU_OPENAI_TIMEOUT_MS', env) || DEFAULT_AI_TIMEOUT_MS, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_AI_TIMEOUT_MS;
  }

  function safeJsonParse(raw, parser = JSON.parse) {
    try {
      return parser(raw);
    } catch (_error) {
      return null;
    }
  }

  function touchAiResponseCacheKey(key) {
    const index = aiResponseCacheOrder.indexOf(key);
    if (index >= 0) {
      aiResponseCacheOrder.splice(index, 1);
    }
    aiResponseCacheOrder.push(key);
  }

  function pruneAiResponseCache() {
    while (aiResponseCacheOrder.length > AI_RESPONSE_CACHE_MAX_ENTRIES) {
      const staleKey = aiResponseCacheOrder.shift();
      aiResponseCache.delete(staleKey);
    }
  }

  function cloneAiResult(result) {
    return result ? JSON.parse(JSON.stringify(result)) : null;
  }

  function aiResponseCacheKey(payload, env) {
    return crypto.createHash('sha1')
      .update(JSON.stringify(payload || {}))
      .update('\0')
      .update(readOpenAiModel(env))
      .update('\0')
      .update(readOpenAiBaseUrl(env))
      .update('\0')
      .update(crypto.createHash('sha1').update(readOpenAiApiKey(env)).digest('hex'))
      .digest('hex');
  }

  function readCachedAiResponse(cacheKey) {
    if (!aiResponseCache.has(cacheKey)) {
      return null;
    }
    touchAiResponseCacheKey(cacheKey);
    return cloneAiResult(aiResponseCache.get(cacheKey));
  }

  function storeCachedAiResponse(cacheKey, result) {
    aiFailureCache.delete(cacheKey);
    aiResponseCache.set(cacheKey, cloneAiResult(result));
    touchAiResponseCacheKey(cacheKey);
    pruneAiResponseCache();
    return cloneAiResult(result);
  }

  function readCachedAiFailure(cacheKey) {
    const cachedAt = Number(aiFailureCache.get(cacheKey) || 0);
    if (!cachedAt) {
      return false;
    }
    if (Date.now() - cachedAt > AI_FAILURE_CACHE_TTL_MS) {
      aiFailureCache.delete(cacheKey);
      return false;
    }
    return true;
  }

  function storeCachedAiFailure(cacheKey) {
    if (!cacheKey) {
      return null;
    }
    aiFailureCache.set(cacheKey, Date.now());
    return null;
  }

  function sanitizeIssueFixSnippet(rawSnippet) {
    const source = String(rawSnippet || '').replace(/\r\n/g, '\n');
    return source
      .split('\n')
      .map((line) => line.replace(/\s*(?:#|\/\/|--|"|\/\*+|\*)\s*pingu\s*-\s*correction\s*:.*$/i, ''))
      .filter((line) => line.trim() !== '')
      .join('\n');
  }

  function normalizeAiTaskResult(rawResult, mode = 'comment_task') {
    if (!rawResult) {
      return null;
    }
    if (typeof rawResult === 'string') {
      const snippet = mode === 'issue_fix' ? sanitizeIssueFixSnippet(rawResult) : rawResult;
      return snippet.trim() ? { snippet } : null;
    }
    if (typeof rawResult !== 'object') {
      return null;
    }
    const rawSnippet = String(rawResult.snippet || '');
    const snippet = (mode === 'issue_fix' ? sanitizeIssueFixSnippet(rawSnippet) : rawSnippet).trim();
    if (!snippet) {
      return null;
    }
    return {
      ...rawResult,
      snippet,
      dependencies: Array.isArray(rawResult.dependencies) ? rawResult.dependencies : [],
    };
  }

  function summarizeCapabilityProfile(sourceFile) {
    if (typeof getCapabilityProfile !== 'function') {
      return null;
    }
    const profile = getCapabilityProfile(sourceFile);
    if (!profile) {
      return null;
    }
    return {
      id: profile.id,
      commentTaskIntents: Array.isArray(profile.commentTaskIntents) ? profile.commentTaskIntents : [],
      editorFeatures: Array.isArray(profile.editorFeatures) ? profile.editorFeatures : [],
      offlineCapabilities: Array.isArray(profile.offlineCapabilities) ? profile.offlineCapabilities : [],
      unitTestStyle: profile.unitTestStyle || 'none',
    };
  }

  function buildBasePayload(request, mode) {
    const instruction = String(request && request.instruction || '');
    const effectiveInstruction = String(request && request.effectiveInstruction || instruction);
    const ext = String(request && request.ext || '');
    const lines = Array.isArray(request && request.lines) ? request.lines : [];
    const sourceFile = String(request && request.sourceFile || '');
    const activeBlueprint = request && request.activeBlueprint ? request.activeBlueprint : null;
    const semanticIntent = request && request.semanticIntent ? request.semanticIntent : null;
    const intentIR = request && request.intentIR ? request.intentIR : null;
    const normalizedExt = analysisExtension(ext);
    const focusLineIndex = resolveFocusLineIndex(request, lines);
    const focusContext = focusLineIndex >= 0
      ? buildBufferFocusWindow(lines, focusLineIndex, 8)
      : { startLine: 0, endLine: 0, lines: [] };
    const actionComment = buildRequestActionComment(request, lines);

    const fullBufferContent = lines.join('\n');

    return {
      ...request,
      instruction,
      effectiveInstruction,
      extension: normalizedExt,
      sourceFile,
      content: fullBufferContent,
      bufferContext: {
        policy: 'full_buffer',
        lineCount: lines.length,
      },
      sourceSummary: sourceSummary(lines, normalizedExt),
      focusContext,
      actionComment,
      activeBlueprint,
      projectMemory: loadProjectMemory(sourceFile),
      installedLibraryContext: buildInstalledLibraryContext({
        sourceFile,
        lines,
        ext: normalizedExt,
      }),
      languageProfile: summarizeCapabilityProfile(sourceFile),
      bestPractices: bestPracticesFor(normalizedExt),
      semanticIntent,
      intentIR,
      mode,
      outputRules: mode === 'issue_fix'
        ? {
          returnOnlyCode: true,
          minimalDiff: true,
          forbidNarrativeComments: true,
          forbiddenMarkers: ['pingu - correction'],
        }
        : undefined,
    };
  }

  function resolveFocusLineIndex(request, lines = []) {
    if (request && Number.isInteger(request.lineIndex) && request.lineIndex >= 0 && request.lineIndex < lines.length) {
      return request.lineIndex;
    }

    const focusLine = Number.parseInt(String(request && request.focusLine || 0), 10);
    if (Number.isFinite(focusLine) && focusLine > 0 && focusLine <= lines.length) {
      return focusLine - 1;
    }

    const issueContextFocusLine = Number.parseInt(String(request && request.issueContext && request.issueContext.focusLine || 0), 10);
    if (Number.isFinite(issueContextFocusLine) && issueContextFocusLine > 0 && issueContextFocusLine <= lines.length) {
      return issueContextFocusLine - 1;
    }

    const testCandidates = Array.isArray(request && request.testCandidates) ? request.testCandidates : [];
    const candidateLine = Number.parseInt(String(testCandidates[0] && testCandidates[0].line || 0), 10);
    if (Number.isFinite(candidateLine) && candidateLine > 0 && candidateLine <= lines.length) {
      return candidateLine - 1;
    }

    return -1;
  }

  function buildRequestActionComment(request, lines = []) {
    if (!request || typeof request !== 'object') {
      return null;
    }

    if (request.actionComment && typeof request.actionComment === 'object') {
      return request.actionComment;
    }

    if (!request.marker && !Number.isInteger(request.lineIndex)) {
      return null;
    }

    return buildActionCommentContext({
      marker: request.marker,
      rawMarker: request.rawMarker,
      instruction: request.instruction,
      lines,
      lineIndex: Number.isInteger(request.lineIndex) ? request.lineIndex : -1,
    });
  }

  function extractStructuredTextFromResponse(response) {
    if (response && typeof response.output_text === 'string' && response.output_text.trim()) {
      return response.output_text.trim();
    }

    const outputItems = Array.isArray(response && response.output) ? response.output : [];
    const fragments = outputItems.flatMap((item) => {
      const contentItems = Array.isArray(item && item.content) ? item.content : [];
      return contentItems
        .map((content) => {
          if (!content || typeof content !== 'object') {
            return '';
          }
          if (typeof content.text === 'string') {
            return content.text;
          }
          if (typeof content.output_text === 'string') {
            return content.output_text;
          }
          return '';
        })
        .filter((fragment) => fragment.trim().length > 0);
    });

    return fragments.join('\n').trim();
  }

  function buildSystemInstruction(payload) {
    const mode = payload && payload.mode;
    const requestedAction = String(payload && payload.requestedAction || '').trim();
    const modeRule = mode === 'issue_fix'
      ? 'Retorne somente o trecho final corrigido, minimo e diretamente aplicavel no campo snippet.'
      : mode === 'unit_test'
        ? 'Retorne testes completos e executaveis no campo snippet.'
        : mode === 'context_resolution'
          ? 'Retorne um documento de contexto consolidado e diretamente utilizavel no campo snippet.'
          : 'Retorne implementacao diretamente aplicavel no campo snippet.';
    const requestedActionRule = requestedAction === 'run_command'
      ? 'requestedAction=run_command: action.op deve ser run_command, action.command deve conter exatamente o comando final, action.description deve resumir o comando, e snippet deve conter o mesmo comando em texto puro.'
      : '';

    return [
      'Voce eh o runtime interno do Pingu para geracao de codigo com OpenAI Codex.',
      'Responda estritamente com JSON valido conforme o schema fornecido.',
      'Nao use markdown, nao use cercas de codigo, nao use texto fora do JSON.',
      'Preencha snippet com codigo puro.',
      'Use dependencies somente quando realmente necessario.',
      'Se action nao for necessaria, retorne action com strings vazias e booleans false.',
      'Ao gerar documentacao ou comentarios, use o contexto ao redor para explicar responsabilidade, contrato, efeitos e motivacao real do trecho; evite comentarios genericos ou tautologicos.',
      'Nao use formulas vagas como "comportamento principal", "responsabilidade principal", "etapa atual" ou "proxima etapa do fluxo".',
      'Se o payload trouxer domainTerms, cite pelo menos um termo concreto desses na documentacao ou comentario quando isso for pertinente.',
      'Prefira mencionar efeitos concretos, estruturas de dominio, contratos de retorno e transicoes de estado observaveis no payload.',
      'O payload sempre traz content com o buffer completo do arquivo; use esse buffer completo como contexto principal.',
      'Quando focusContext estiver presente, trate essa janela como ancora principal da resposta e use o restante do buffer como validacao de contrato.',
      'Quando installedLibraryContext trouxer bibliotecas instaladas, use publicApi, version, range e importedSymbols para validar o uso real da dependencia antes de sugerir ou corrigir codigo.',
      'Quando actionComment estiver presente, respeite marker, feature, role, triggerLine e triggerText para responder exatamente ao comentario acionavel.',
      'Use sourceSummary.symbols para nao duplicar funcoes, metodos, classes, tipos ou modulos que ja existem no arquivo.',
      'Se o pedido exigir complementar codigo existente, prefira alterar ou completar o menor bloco relacionado ao foco em vez de recriar estruturas ja presentes.',
      'Nao retorne o arquivo inteiro exceto quando action.op for write_file e o pedido exigir uma reescrita contextual validada.',
      'Nunca duplique metodos, funcoes, classes, imports ou exports existentes no payload.',
      'Preserve comportamento publico, nomes existentes e contratos observaveis salvo quando o comentario pedir explicitamente a mudanca.',
      'Nunca altere import, use, require, alias, include ou bindings equivalentes sem validacao explicita da origem do simbolo no proprio payload.',
      modeRule,
      requestedActionRule,
    ].join(' ');
  }

  function buildOpenAiRequestBody(payload, env = process.env) {
    return {
      model: readOpenAiModel(env),
      input: [
        {
          role: 'system',
          content: [
            {
              type: 'input_text',
              text: buildSystemInstruction(payload),
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'input_text',
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'pingu_ai_task',
          strict: true,
          schema: OPENAI_OUTPUT_SCHEMA,
        },
      },
    };
  }

  function resolveOpenAiPayload(payload, env = process.env) {
    const apiKey = readOpenAiApiKey(env);
    if (!apiKey) {
      return null;
    }

    const cacheKey = aiResponseCacheKey(payload, env);
    const cachedResponse = readCachedAiResponse(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    if (readCachedAiFailure(cacheKey)) {
      return null;
    }

    try {
      const response = resolveOpenAiRequest(JSON.stringify(buildOpenAiRequestBody(payload, env)), env, readTimeoutMs(env));
      if (!response || response.error || response.status !== 0) {
        return storeCachedAiFailure(cacheKey);
      }

      const parsedOpenAiPayload = resolveOpenAiResponseText(response, env);
      const normalizedResult = normalizeAiTaskResult(parsedOpenAiPayload, payload && payload.mode);
      if (!normalizedResult) {
        return storeCachedAiFailure(cacheKey);
      }

      return storeCachedAiResponse(cacheKey, normalizedResult);
    } catch (_error) {
      return storeCachedAiFailure(cacheKey);
    }
  }
  function resolveAiPayload(payload, env = process.env) {
    return resolveOpenAiPayload(payload, env);
  }

  function resolveAiGeneratedTask(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'comment_task'), env);
  }

  function resolveAiIssueFix(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'issue_fix'), env);
  }

  function resolveAiGeneratedUnitTests(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'unit_test'), env);
  }

  function resolveAiContextResolution(request, env = process.env) {
    return resolveAiPayload(buildBasePayload(request, 'context_resolution'), env);
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
  createCommentTaskAiTools,
};
