'use strict';

const path = require('path');

function buildRemoveCommentsFallbackIssue(request, reason) {
  if (!isRemoveCommentsPrompt(request.prompt)) {
    return null;
  }

  const source = request.selectedText || request.lines.join('\n');
  const snippet = removeCommentsFromSource(source, request);
  if (snippet === source) {
    return null;
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
      message: 'Comentarios removidos do range selecionado',
      suggestion: 'Remover comentarios preservando o codigo.',
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
      providerFallbackReason: reason,
      selectedText: request.selectedText,
    },
  };
}

function isRemoveCommentsPrompt(prompt) {
  const normalized = normalizePromptIntent(prompt);
  return /\b(remova|remover|remove|retire|tirar|apague|delete|remove)\b/.test(normalized)
    && /\b(comentario|comentarios|comments?|commentary)\b/.test(normalized);
}

function normalizePromptIntent(prompt) {
  return String(prompt || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function removeCommentsFromSource(source, request = {}) {
  const ext = fileExtensionForRequest(request);
  const lineMarkers = lineCommentMarkersForExt(ext);
  const supportsSlashBlocks = supportsSlashBlockComments(ext);
  let inSlashBlock = false;

  return String(source || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line, index) => {
      const withoutBlocks = supportsSlashBlocks
        ? stripSlashBlockComment(line, { inBlock: inSlashBlock })
        : { text: line, inBlock: false };
      inSlashBlock = withoutBlocks.inBlock;
      return {
        original: line,
        text: stripLineComment(withoutBlocks.text, lineMarkers, index + request.selection.startLine),
      };
    })
    .filter((line) => line.text.trim() !== '' || String(line.original || '').trim() === '')
    .map((line) => line.text)
    .join('\n');
}

function fileExtensionForRequest(request = {}) {
  const ext = path.extname(request.file || '').toLowerCase();
  if (ext) {
    return ext;
  }
  const language = String(request.language || '').trim().toLowerCase();
  const map = {
    elixir: '.ex',
    javascript: '.js',
    lua: '.lua',
    python: '.py',
    ruby: '.rb',
    typescript: '.ts',
    vim: '.vim',
  };
  return map[language] || '';
}

function lineCommentMarkersForExt(ext) {
  if (['.py', '.rb', '.sh', '.bash', '.zsh', '.yaml', '.yml', '.toml', '.ex', '.exs'].includes(ext)) {
    return ['#'];
  }
  if (['.lua'].includes(ext)) {
    return ['--'];
  }
  if (['.vim'].includes(ext)) {
    return ['"'];
  }
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java', '.cs'].includes(ext)) {
    return ['//'];
  }
  return ['#', '//'];
}

function supportsSlashBlockComments(ext) {
  return ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.go', '.rs', '.c', '.cpp', '.h', '.hpp', '.java', '.cs'].includes(ext);
}

function stripSlashBlockComment(line, state) {
  const text = String(line || '');
  let inBlock = Boolean(state && state.inBlock);
  let output = '';
  let index = 0;

  while (index < text.length) {
    if (inBlock) {
      const end = text.indexOf('*/', index);
      if (end < 0) {
        return { text: output, inBlock: true };
      }
      index = end + 2;
      inBlock = false;
      continue;
    }

    const start = findTokenOutsideStrings(text, '/*', index);
    if (start < 0) {
      output += text.slice(index);
      break;
    }
    output += text.slice(index, start);
    index = start + 2;
    inBlock = true;
  }

  return { text: output, inBlock };
}

function stripLineComment(line, markers, absoluteLine) {
  const text = String(line || '');
  if (isPreservedInterpreterLine(text, absoluteLine)) {
    return text.replace(/\s+$/, '');
  }

  const commentIndex = markers
    .map((marker) => findLineCommentIndex(text, marker))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (commentIndex === undefined) {
    return text.replace(/\s+$/, '');
  }
  return text.slice(0, commentIndex).replace(/\s+$/, '');
}

function isPreservedInterpreterLine(line, absoluteLine) {
  if (absoluteLine !== 1) {
    return false;
  }
  return /^#!/.test(String(line || ''));
}

function findLineCommentIndex(line, marker) {
  const index = findTokenOutsideStrings(line, marker, 0);
  if (index < 0) {
    return -1;
  }
  if (index === 0) {
    return 0;
  }
  return /\s/.test(line[index - 1]) ? index : -1;
}

function findTokenOutsideStrings(line, token, startIndex = 0) {
  const text = String(line || '');
  let quote = '';
  let escaped = false;
  for (let index = 0; index <= text.length - token.length; index += 1) {
    const char = text[index];
    if (index < startIndex) {
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote && char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      quote = char;
      continue;
    }
    if (text.startsWith(token, index)) {
      return index;
    }
  }
  return -1;
}

function leadingWhitespace(value) {
  const firstLine = String(value || '').split(/\r?\n/, 1)[0] || '';
  const match = firstLine.match(/^\s*/);
  return match ? match[0] : '';
}

module.exports = {
  buildRemoveCommentsFallbackIssue,
  removeCommentsFromSource,
};
