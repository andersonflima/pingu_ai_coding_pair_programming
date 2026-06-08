'use strict';

const path = require('path');
const { createAiProvider } = require('./ai-provider');
const { buildRemoveCommentsFallbackIssue } = require('./prompt-comment-removal');

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

function normalizePromptHistory(payload = {}) {
  if (!Array.isArray(payload.promptHistory)) {
    return [];
  }

  return payload.promptHistory
    .filter((entry) => entry && typeof entry === 'object')
    .slice(-50)
    .map((entry) => ({
      role: String(entry.role || '').trim() || 'user',
      text: String(entry.text || '').trim(),
    }))
    .filter((entry) => entry.text.length > 0);
}

function normalizeContextRadius(value, fallback = 80) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function promptContextFromLines(lines, startLine, endLine, radius) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      contextStartLine: startLine,
      contextEndLine: endLine,
      contextLines: [],
    };
  }

  const contextStartLine = Math.max(1, startLine - radius);
  const contextEndLine = Math.min(lines.length, Math.max(startLine, endLine) + radius);
  return {
    contextStartLine,
    contextEndLine,
    contextLines: lines.slice(contextStartLine - 1, contextEndLine),
  };
}

function trimBoundaryNewlines(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '');
}

function leadingWhitespace(value) {
  const firstLine = String(value || '').split(/\r?\n/, 1)[0] || '';
  const match = firstLine.match(/^\s*/);
  return match ? match[0] : '';
}

function buildPromptTaskRequest(payload = {}) {
  const file = path.resolve(String(payload.file || payload.sourcePath || 'stdin'));
  const prompt = normalizePromptText(payload);
  const startLine = normalizeLineNumber(payload.startLine, normalizeLineNumber(payload.line, 1));
  const endLine = normalizeLineNumber(payload.endLine, startLine);
  const selectedText = selectedTextFromPayload({ ...payload, startLine, endLine });
  const lines = Array.isArray(payload.lines) ? payload.lines.map((line) => String(line || '')) : [];
  const hasContextRadius = Object.prototype.hasOwnProperty.call(payload, 'contextRadius');
  const contextRadius = normalizeContextRadius(
    hasContextRadius ? payload.contextRadius : payload.promptContextRadius,
  );
  const context = promptContextFromLines(lines, startLine, endLine, contextRadius);

  return {
    mode: 'prompt_task',
    file,
    language: String(payload.language || path.extname(file).replace(/^\./, '') || '').trim(),
    prompt,
    promptHistory: normalizePromptHistory(payload),
    selectedText,
    allLines: lines,
    selection: {
      startLine,
      endLine: Math.max(startLine, endLine),
      hasExplicitRange: Boolean(payload.hasExplicitRange),
    },
    cursor: {
      line: normalizeLineNumber(payload.cursorLine, startLine),
      column: normalizeLineNumber(payload.cursorColumn, 1),
    },
    lines: context.contextLines,
    context: {
      startLine: context.contextStartLine,
      endLine: context.contextEndLine,
      radius: contextRadius,
    },
    constraints: [
      'Altere somente o range selecionado quando selectedText estiver presente.',
      'Preserve exatamente a indentacao relativa do bloco selecionado.',
      'Nao remova os espacos iniciais da primeira linha do snippet.',
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
      suggestion: 'Configure o provider de IA no ambiente (Codex, Claude ou Copilot) e tente novamente.',
      snippet: '',
      action: { op: 'replace_range' },
    },
  };
}

function normalizePromptTaskIssue(request, resolution) {
  if (!resolution || typeof resolution !== 'object') {
    return buildRemoveCommentsFallbackIssue(request, 'empty_provider_response')
      || buildUnavailableIssue(request, 'empty_provider_response');
  }

  const action = resolution.action && typeof resolution.action === 'object'
    ? resolution.action
    : {};
  if (String(action.op || '').trim() === 'run_command') {
    return buildUnavailableIssue(request, 'terminal_action_requires_terminal_task');
  }

  const snippet = trimBoundaryNewlines(resolution.snippet);
  if (!snippet.trim()) {
    return buildRemoveCommentsFallbackIssue(request, 'empty_snippet')
      || buildUnavailableIssue(request, 'empty_snippet');
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
        indent: leadingWhitespace(request.selectedText),
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
    return buildRemoveCommentsFallbackIssue(request, 'provider_unavailable')
      || buildUnavailableIssue(request);
  }

  const providerRequest = {
    ...request,
    allLines: undefined,
  };
  const resolution = typeof provider.resolveAiPromptTask === 'function'
    ? provider.resolveAiPromptTask(providerRequest, env)
    : provider.resolveAiGeneratedTask(providerRequest, env);
  return normalizePromptTaskIssue(request, resolution);
}

module.exports = {
  buildPromptTaskRequest,
  leadingWhitespace,
  trimBoundaryNewlines,
  normalizePromptTaskIssue,
  resolvePromptTask,
};
