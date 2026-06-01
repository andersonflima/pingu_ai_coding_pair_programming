'use strict';

const path = require('path');
const { createAiProvider } = require('./ai-provider');

function normalizeLineNumber(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function normalizePromptText(payload = {}) {
  return String(payload.prompt || payload.instruction || '').trim();
}

function selectedTextFromPayload(payload = {}) {
  if (typeof payload.selectedText === 'string') {
    return payload.selectedText;
  }
  if (!Array.isArray(payload.lines)) {
    return '';
  }
  const startLine = normalizeLineNumber(payload.startLine, 1);
  const endLine = normalizeLineNumber(payload.endLine, startLine);
  return payload.lines.slice(startLine - 1, endLine).join('\n');
}

function buildPromptTaskRequest(payload = {}) {
  const file = path.resolve(String(payload.file || payload.sourcePath || 'stdin'));
  const prompt = normalizePromptText(payload);
  const startLine = normalizeLineNumber(payload.startLine, normalizeLineNumber(payload.line, 1));
  const endLine = normalizeLineNumber(payload.endLine, startLine);
  const selectedText = selectedTextFromPayload({ ...payload, startLine, endLine });
  const lines = Array.isArray(payload.lines) ? payload.lines.map((line) => String(line || '')) : [];

  return {
    mode: 'prompt_task',
    file,
    language: String(payload.language || path.extname(file).replace(/^\./, '') || '').trim(),
    prompt,
    selectedText,
    selection: {
      startLine,
      endLine: Math.max(startLine, endLine),
    },
    cursor: {
      line: normalizeLineNumber(payload.cursorLine, startLine),
      column: normalizeLineNumber(payload.cursorColumn, 1),
    },
    lines,
    constraints: [
      'Altere somente o range selecionado quando selectedText estiver presente.',
      'Preserve a assinatura publica e o comportamento externo salvo pedido explicito.',
      'Retorne apenas o bloco final substituto no campo snippet.',
      'Nao retorne comando de terminal para aplicacao direta.',
    ],
  };
}

function buildUnavailableIssue(request, reason = 'provider_unavailable') {
  return {
    ok: false,
    reason,
    issue: {
      file: request.file,
      line: request.selection.startLine,
      severity: 'error',
      kind: 'prompt_task',
      message: 'Provider assistido indisponivel para prompt manual',
      suggestion: 'Configure Copilot/OpenAI ou tente novamente quando o provider estiver disponivel.',
      snippet: '',
      action: { op: 'replace_range' },
    },
  };
}

function normalizePromptTaskIssue(request, resolution) {
  if (!resolution || typeof resolution !== 'object') {
    return buildUnavailableIssue(request, 'empty_provider_response');
  }

  const action = resolution.action && typeof resolution.action === 'object'
    ? resolution.action
    : {};
  if (String(action.op || '').trim() === 'run_command') {
    return buildUnavailableIssue(request, 'terminal_action_requires_terminal_task');
  }

  const snippet = String(resolution.snippet || '').trim();
  if (!snippet) {
    return buildUnavailableIssue(request, 'empty_snippet');
  }

  return {
    ok: true,
    issue: {
      file: request.file,
      filename: request.file,
      line: request.selection.startLine,
      lnum: request.selection.startLine,
      col: 1,
      severity: 'info',
      kind: 'prompt_task',
      message: String(resolution.message || 'Prompt manual aplicado ao range selecionado'),
      suggestion: String(resolution.suggestion || request.prompt),
      snippet,
      action: {
        op: 'replace_range',
        range: {
          start: { line: request.selection.startLine - 1, character: 0 },
          end: { line: request.selection.endLine, character: 0 },
        },
      },
      prompt: request.prompt,
      selectedText: request.selectedText,
    },
  };
}

function resolvePromptTask(payload = {}, deps = {}) {
  const provider = deps.provider || createAiProvider(deps.providerDeps || {});
  const env = deps.env || process.env;
  const request = buildPromptTaskRequest(payload);

  if (!request.prompt) {
    return buildUnavailableIssue(request, 'empty_prompt');
  }

  const hasProvider = typeof provider.hasOpenAiConfiguration === 'function'
    ? provider.hasOpenAiConfiguration(env)
    : false;
  if (!hasProvider) {
    return buildUnavailableIssue(request);
  }

  const resolution = typeof provider.resolveAiPromptTask === 'function'
    ? provider.resolveAiPromptTask(request, env)
    : provider.resolveAiGeneratedTask(request, env);
  return normalizePromptTaskIssue(request, resolution);
}

module.exports = {
  buildPromptTaskRequest,
  normalizePromptTaskIssue,
  resolvePromptTask,
};
