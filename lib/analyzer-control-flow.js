'use strict';

// Detectores conservadores de erros humanos de fluxo de controle, que o
// compilador frequentemente nao acusa: codigo inalcancavel apos uma instrucao
// terminal e erros engolidos silenciosamente (catch/except vazio). Ambos sao
// suggest-only: sinalizam, mas nunca reescrevem automaticamente.

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');

function checkControlFlowSmells(lines, file, kind, opts = {}) {
  const focusRange = opts.focusRange || null;
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  return [
    ...checkUnreachableCode(source, file, kind, focusRange),
    ...checkSwallowedErrors(source, file, kind, focusRange),
    ...checkDuplicateSwitchCase(source, file, kind, focusRange),
  ];
}

function leadingIndent(line) {
  const match = String(line || '').match(/^[ \t]*/);
  return match ? match[0].length : 0;
}

function nextSignificantIndex(lines, fromIndex, isComment) {
  for (let index = fromIndex; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed || isComment(trimmed)) {
      continue;
    }
    return index;
  }
  return -1;
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

// ---------------------------------------------------------------------------
// Codigo inalcancavel
// ---------------------------------------------------------------------------

function checkUnreachableCode(lines, file, kind, focusRange) {
  if (isJavaScriptLikeExtension(kind)) {
    return collectUnreachable(lines, file, focusRange, {
      isTerminal: (trimmed) => /^(?:return|throw)\b.*;?\s*$/.test(trimmed) && !trimmed.endsWith('{'),
      isComment: (trimmed) => trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'),
      isBlockBoundary: (trimmed) => /^[})\]]/.test(trimmed) || /^(?:case\b|default\s*:)/.test(trimmed),
    });
  }
  if (isPythonLikeExtension(kind)) {
    return collectUnreachable(lines, file, focusRange, {
      isTerminal: (trimmed) => /^(?:return|raise|break|continue)\b/.test(trimmed),
      isComment: (trimmed) => trimmed.startsWith('#'),
      isBlockBoundary: (trimmed) => /^(?:else\b|elif\b|except\b|finally\b|case\b)/.test(trimmed),
    });
  }
  return [];
}

function collectUnreachable(lines, file, focusRange, lang) {
  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || lang.isComment(trimmed) || !lang.isTerminal(trimmed)) {
      continue;
    }

    const nextIndex = nextSignificantIndex(lines, index + 1, lang.isComment);
    if (nextIndex < 0) {
      continue;
    }
    const nextTrimmed = lines[nextIndex].trim();
    // So acusa quando a proxima instrucao esta no MESMO bloco (mesma indentacao)
    // e nao e uma fronteira de bloco (fechamento, else/elif/except, case...).
    if (leadingIndent(lines[nextIndex]) !== leadingIndent(line)) {
      continue;
    }
    if (lang.isBlockBoundary(nextTrimmed)) {
      continue;
    }

    issues.push({
      file,
      line: nextIndex + 1,
      severity: 'warning',
      kind: 'unreachable_code',
      message: 'Codigo inalcancavel apos instrucao terminal',
      suggestion: `A linha ${index + 1} sempre interrompe o fluxo; remova o codigo morto ou revise a logica.`,
      snippet: '',
      action: { op: 'insert_before' },
    });
  }
  return issues.filter((issue) => isLineInFocus(focusRange, issue.line));
}

// ---------------------------------------------------------------------------
// Erros engolidos (catch/except vazio)
// ---------------------------------------------------------------------------

function checkSwallowedErrors(lines, file, kind, focusRange) {
  if (isJavaScriptLikeExtension(kind)) {
    return collectSwallowedJs(lines, file, focusRange);
  }
  if (isPythonLikeExtension(kind)) {
    return collectSwallowedPython(lines, file, focusRange);
  }
  return [];
}

function collectSwallowedJs(lines, file, focusRange) {
  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const inlineEmpty = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(trimmed);
    const opensEmpty = /\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/.test(trimmed)
      && nextNonBlankIsCloser(lines, index + 1);
    if (!inlineEmpty && !opensEmpty) {
      continue;
    }
    issues.push(buildSwallowedIssue(file, index + 1, 'Bloco catch vazio engole o erro silenciosamente',
      'Trate, registre ou repropague o erro; capturar e ignorar esconde falhas.'));
  }
  return issues.filter((issue) => isLineInFocus(focusRange, issue.line));
}

function nextNonBlankIsCloser(lines, fromIndex) {
  const index = nextSignificantIndex(lines, fromIndex, (trimmed) => trimmed.startsWith('//'));
  if (index < 0) {
    return false;
  }
  return /^\}/.test(lines[index].trim());
}

function collectSwallowedPython(lines, file, focusRange) {
  const issues = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!/^except\b.*:\s*$/.test(trimmed)) {
      continue;
    }
    const exceptIndent = leadingIndent(lines[index]);
    const bodyIndex = nextSignificantIndex(lines, index + 1, (line) => line.startsWith('#'));
    if (bodyIndex < 0) {
      continue;
    }
    const bodyTrimmed = lines[bodyIndex].trim();
    if (leadingIndent(lines[bodyIndex]) <= exceptIndent || bodyTrimmed !== 'pass') {
      continue;
    }
    // O bloco do except contem apenas 'pass'? A proxima instrucao significativa
    // deve sair do corpo (indentacao <= except).
    const afterIndex = nextSignificantIndex(lines, bodyIndex + 1, (line) => line.startsWith('#'));
    if (afterIndex >= 0 && leadingIndent(lines[afterIndex]) > exceptIndent) {
      continue;
    }
    issues.push(buildSwallowedIssue(file, index + 1, 'except com apenas pass engole o erro silenciosamente',
      'Trate, registre ou repropague a excecao; capturar e ignorar esconde falhas.'));
  }
  return issues.filter((issue) => isLineInFocus(focusRange, issue.line));
}

// ---------------------------------------------------------------------------
// case duplicado em switch
// ---------------------------------------------------------------------------

function checkDuplicateSwitchCase(lines, file, kind, focusRange) {
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const issues = [];
  const switchStack = [];
  let depth = 0;

  lines.forEach((rawLine, index) => {
    const code = stripBlockAwareComment(String(rawLine || ''));
    const trimmed = code.trim();

    if (/\bswitch\b\s*\(.*\)\s*\{?\s*$/.test(trimmed) && /\{/.test(code)) {
      switchStack.push({ openDepth: depth, seen: new Map() });
    } else {
      const caseMatch = trimmed.match(/^case\s+(.+?)\s*:/);
      if (caseMatch && switchStack.length > 0) {
        const context = switchStack[switchStack.length - 1];
        const value = caseMatch[1].trim();
        if (context.seen.has(value)) {
          if (isLineInFocus(focusRange, index + 1)) {
            issues.push({
              file,
              line: index + 1,
              severity: 'warning',
              kind: 'duplicate_case',
              message: `Caso 'case ${value}' duplicado no switch`,
              suggestion: `A primeira ocorrencia (linha ${context.seen.get(value)}) vence; o caso duplicado e inalcancavel.`,
              snippet: '',
              action: { op: 'insert_before' },
            });
          }
        } else {
          context.seen.set(value, index + 1);
        }
      }
    }

    depth += braceDelta(code);
    while (switchStack.length > 0 && depth <= switchStack[switchStack.length - 1].openDepth) {
      switchStack.pop();
    }
  });

  return issues;
}

function braceDelta(line) {
  let delta = 0;
  let inString = '';
  const text = String(line || '');
  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if (inString) {
      if (char === '\\') {
        cursor += 1;
      } else if (char === inString) {
        inString = '';
      }
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      inString = char;
      continue;
    }
    if (char === '/' && text[cursor + 1] === '/') {
      break;
    }
    if (char === '{') {
      delta += 1;
    } else if (char === '}') {
      delta -= 1;
    }
  }
  return delta;
}

function stripBlockAwareComment(line) {
  const slashIndex = String(line || '').indexOf('//');
  return slashIndex >= 0 ? line.slice(0, slashIndex) : line;
}

function buildSwallowedIssue(file, line, message, suggestion) {
  return {
    file,
    line,
    severity: 'warning',
    kind: 'swallowed_error',
    message,
    suggestion,
    snippet: '',
    action: { op: 'insert_before' },
  };
}

module.exports = {
  checkControlFlowSmells,
  checkUnreachableCode,
  checkSwallowedErrors,
};
