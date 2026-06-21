'use strict';

// Scanner de estrutura sintatica generico, extraido do analyzer: percorre o
// arquivo equilibrando delimitadores (parenteses, colchetes, chaves), strings,
// comentarios de bloco/linha e strings multilinha, produzindo diagnosticos de
// aspas/delimitadores faltantes ou extras, e detecta virgula ausente entre
// itens consecutivos de objeto/array. Depende apenas de perfis de linguagem e
// de utilitarios de varredura puros do support.

const {
  isPythonLikeExtension,
  isElixirExtension,
  isJavaScriptLikeExtension,
  supportsSlashComments,
  supportsHashComments,
} = require('./language-profiles');
const { lineIndentation, syntaxRelevantLine, findNextSyntaxLine } = require('./support');

function scanSyntaxStructure(lines, kind) {
  const issues = [];
  const stack = [];
  const collectionContexts = [];
  let inBlockComment = false;
  let inTemplate = false;
  let tripleQuote = '';
  let tripleQuoteLine = 0;
  const quoteIssuesByLine = new Set();
  const extraDelimiterIssuesByLine = new Set();
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    // A linha pertence a uma colecao apenas se o delimitador IMEDIATO (topo da
    // pilha) for array/object. Um bloco ou parenteses entre a linha e uma
    // colecao externa sombreia esse contexto: statements no corpo de uma funcao
    // definida dentro de um objeto nao sao itens do objeto.
    const enclosing = stack.length > 0 ? stack[stack.length - 1] : null;
    const activeCollection = enclosing && (enclosing.context === 'array' || enclosing.context === 'object')
      ? enclosing.context
      : '';
    collectionContexts[index] = activeCollection;

    let inQuote = '';
    for (let cursor = 0; cursor < line.length; cursor += 1) {
      const current = line[cursor];
      const next = line[cursor + 1] || '';
      const prev = cursor > 0 ? line[cursor - 1] : '';

      if (tripleQuote) {
        if (line.slice(cursor, cursor + 3) === tripleQuote) {
          tripleQuote = '';
          cursor += 2;
        }
        continue;
      }

      if (inBlockComment) {
        if (current === '*' && next === '/') {
          inBlockComment = false;
          cursor += 1;
        }
        continue;
      }

      // Template literal (JS/TS): o corpo e opaco; apenas `${` reentra em codigo
      // (empilhado como interpolacao) e o backtick fecha o literal. Sem isso, as
      // chaves de `${...}` e outros delimitadores no texto corrompem a pilha.
      if (inTemplate) {
        if (current === '\\') {
          cursor += 1;
          continue;
        }
        if (current === '`') {
          inTemplate = false;
          continue;
        }
        if (current === '$' && next === '{') {
          stack.push({
            char: '{',
            line: index + 1,
            col: cursor + 1,
            indent: lineIndentation(line),
            context: 'template-interp',
          });
          inTemplate = false;
          cursor += 1;
        }
        continue;
      }
      if (current === '`' && isJavaScriptLikeExtension(kind)) {
        inTemplate = true;
        continue;
      }

      if (inQuote) {
        if (current === '\\') {
          cursor += 1;
          continue;
        }
        if (current === inQuote && prev !== '\\') {
          inQuote = '';
        }
        continue;
      }

      if ((isPythonLikeExtension(kind) || isElixirExtension(kind)) && (line.slice(cursor, cursor + 3) === '"""' || line.slice(cursor, cursor + 3) === "'''")) {
        tripleQuote = line.slice(cursor, cursor + 3);
        tripleQuoteLine = index + 1;
        cursor += 2;
        continue;
      }

      if (supportsSlashComments(kind) && current === '/' && next === '*') {
        inBlockComment = true;
        cursor += 1;
        continue;
      }
      if (startsInlineComment(line, cursor, kind)) {
        break;
      }

      if (current === '"' || current === '\'') {
        inQuote = current;
        continue;
      }

      // Literais de regex em JS/TS: pular o corpo (que contem [], (), {} e
      // escapes) evita que esses delimitadores corrompam a pilha e gerem falsos
      // positivos de virgula/delimitador. Heuristica conservadora de posicao
      // para nao confundir com o operador de divisao.
      if (current === '/' && isJavaScriptLikeExtension(kind) && isRegexPosition(line, cursor)) {
        const regexEnd = consumeRegexLiteral(line, cursor);
        if (regexEnd > cursor) {
          let after = regexEnd + 1;
          while (after < line.length && /[gimsuy]/.test(line[after])) {
            after += 1;
          }
          cursor = after - 1;
          continue;
        }
      }

      if (isOpeningDelimiter(current)) {
        stack.push({
          char: current,
          line: index + 1,
          col: cursor + 1,
          indent: lineIndentation(line),
          context: inferDelimiterContext(line, cursor, kind, current),
        });
        continue;
      }

      if (isClosingDelimiter(current)) {
        if (stack.length > 0 && matchingDelimiter(stack[stack.length - 1].char) === current) {
          const popped = stack.pop();
          if (popped.context === 'template-interp') {
            inTemplate = true;
          }
          continue;
        }

        if (!extraDelimiterIssuesByLine.has(index + 1)) {
          issues.push({
            line: index + 1,
            severity: 'error',
            kind: 'syntax_extra_delimiter',
            message: `Delimitador '${current}' sem abertura correspondente`,
            suggestion: `Remova '${current}' para reequilibrar a estrutura do arquivo.`,
            snippet: line.slice(0, cursor) + line.slice(cursor + 1),
            action: { op: 'replace_line' },
          });
          extraDelimiterIssuesByLine.add(index + 1);
        }
      }
    }

    if (inQuote && !quoteIssuesByLine.has(index + 1) && shouldAutoCloseQuote(line, kind)) {
      issues.push({
        line: index + 1,
        severity: 'error',
        kind: 'syntax_missing_quote',
        message: `Aspa '${inQuote}' sem fechamento`,
        suggestion: `Feche a aspa '${inQuote}' para restaurar a sintaxe da linha.`,
        snippet: line + inQuote,
        action: { op: 'replace_line' },
      });
      quoteIssuesByLine.add(index + 1);
    }
  });

  if (tripleQuote) {
    issues.push({
      line: lines.length > 0 ? lines.length : tripleQuoteLine || 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `String multilinha ${tripleQuote} sem fechamento`,
      suggestion: `Feche a string com ${tripleQuote} para restaurar a estrutura do arquivo.`,
      snippet: tripleQuote,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  if (stack.length > 0) {
    const snippet = stack.slice().reverse().map((entry) => `${entry.indent}${matchingDelimiter(entry.char)}`).join('\n');
    const pending = stack.slice().reverse().map((entry) => matchingDelimiter(entry.char)).join(' ');
    issues.push({
      line: lines.length > 0 ? lines.length : 1,
      severity: 'error',
      kind: 'syntax_missing_delimiter',
      message: `Delimitadores pendentes sem fechamento: ${pending}`,
      suggestion: 'Feche os delimitadores abertos para restaurar a estrutura do arquivo.',
      snippet,
      action: { op: 'insert_after', dedupeLookbehind: 4, dedupeLookahead: 4 },
    });
  }

  return { issues, collectionContexts };
}

function checkMissingCommaIssues(lines, file, kind, collectionContexts) {
  if (!supportsAutomaticCommaFix(kind)) {
    return [];
  }

  const issues = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const context = collectionContexts[index];
    if (context !== 'object' && context !== 'array') {
      continue;
    }

    const currentLine = String(lines[index] || '');
    const currentTrimmed = syntaxRelevantLine(currentLine, kind).trim();
    if (!currentTrimmed || currentTrimmed.endsWith(',')) {
      continue;
    }
    if (/[([{,:\\]$/.test(currentTrimmed) || /(?:=>|->)$/.test(currentTrimmed)) {
      continue;
    }

    const nextCandidate = findNextSyntaxLine(lines, index + 1, kind);
    if (!nextCandidate) {
      continue;
    }

    const nextTrimmed = nextCandidate.trimmed;
    if (!nextTrimmed || /^[\]\})]/.test(nextTrimmed)) {
      continue;
    }
    if (kind === '.py' && /^(?:for|if)\b/.test(nextTrimmed)) {
      continue;
    }

    if (context === 'object') {
      if (!looksLikeObjectEntry(currentTrimmed, kind) || !looksLikeObjectEntry(nextTrimmed, kind)) {
        continue;
      }
    } else if (!looksLikeArrayEntry(currentTrimmed) || !looksLikeArrayEntry(nextTrimmed)) {
      continue;
    }

    issues.push({
      file,
      line: index + 1,
      severity: 'error',
      kind: 'syntax_missing_comma',
      message: 'Virgula ausente entre itens consecutivos',
      suggestion: 'Adicione virgula ao fim da linha para separar os itens corretamente.',
      snippet: `${currentLine},`,
      action: { op: 'replace_line' },
    });
  }

  return issues;
}

function supportsAutomaticCommaFix(kind) {
  return ['.js', '.jsx', '.ts', '.tsx', '.lua', '.py', '.rb', '.rs', '.ex', '.exs'].includes(kind);
}

function looksLikeObjectEntry(trimmed, kind) {
  if (kind === '.lua') {
    return /^(?:[A-Za-z_][A-Za-z0-9_]*\s*=|\[[^\]]+\]\s*=).+/.test(trimmed);
  }
  return /^(?:[A-Za-z_$][A-Za-z0-9_$-]*|["'][^"']+["']|\[[^\]]+\])\s*:\s*.+$/.test(trimmed);
}

function looksLikeArrayEntry(trimmed) {
  return /^(?:["'{\[]|[+-]?\d|true\b|false\b|null\b|nil\b|[A-Za-z_$][A-Za-z0-9_$.]*(?:\([^)]*\))?)/.test(trimmed);
}

function shouldAutoCloseQuote(line, kind) {
  if (kind === '.md') {
    return false;
  }
  return !String(line || '').trimEnd().endsWith('\\');
}

function startsInlineComment(line, cursor, kind) {
  const current = line[cursor];
  const next = line[cursor + 1] || '';
  const prev = cursor > 0 ? line[cursor - 1] : '';

  if (supportsSlashComments(kind)) {
    return current === '/' && next === '/';
  }
  if (supportsHashComments(kind) || kind === '.tf') {
    return current === '#';
  }
  if (kind === '.lua') {
    return current === '-' && next === '-';
  }
  if (kind === '.vim') {
    return current === '"' && (cursor === 0 || /\s/.test(prev));
  }
  if (kind === '.md') {
    return line.slice(cursor, cursor + 4) === '<!--';
  }
  return false;
}

// Um `/` inicia regex (e nao divisao) quando vem no inicio da expressao: logo
// apos um operador/delimitador de abertura ou apos uma palavra-chave que espera
// uma expressao (return, typeof, case...). Nunca apos um valor (identificador,
// numero ou fechamento de `)`/`]`/`}`).
const REGEX_START_CHARS = new Set(['(', '[', '{', ',', ';', ':', '=', '+', '-', '*', '/', '%', '&', '|', '!', '^', '~', '<', '>', '?']);
const REGEX_START_KEYWORDS = /(?:^|[^.\w$])(?:return|typeof|instanceof|case|do|else|in|of|void|delete|yield|await|new)$/;
function isRegexPosition(line, cursor) {
  const prefix = String(line).slice(0, cursor).replace(/\s+$/, '');
  if (!prefix) {
    return true;
  }
  return REGEX_START_CHARS.has(prefix[prefix.length - 1]) || REGEX_START_KEYWORDS.test(prefix);
}

// Consome um literal de regex a partir do `/` em `start`, respeitando escapes e
// classes de caractere `[...]`. Retorna o indice do `/` de fechamento, ou -1 se
// nao houver fechamento valido na linha (tratado como divisao).
function consumeRegexLiteral(line, start) {
  let cursor = start + 1;
  let inClass = false;
  while (cursor < line.length) {
    const char = line[cursor];
    if (char === '\\') {
      cursor += 2;
      continue;
    }
    if (inClass) {
      if (char === ']') {
        inClass = false;
      }
    } else if (char === '[') {
      inClass = true;
    } else if (char === '/') {
      return cursor === start + 1 ? -1 : cursor;
    }
    cursor += 1;
  }
  return -1;
}

function isOpeningDelimiter(char) {
  return char === '(' || char === '[' || char === '{';
}

function isClosingDelimiter(char) {
  return char === ')' || char === ']' || char === '}';
}

function matchingDelimiter(char) {
  return {
    '(': ')',
    '[': ']',
    '{': '}',
  }[char] || '';
}

function inferDelimiterContext(line, cursor, kind, delimiter) {
  if (delimiter === '[') {
    return 'array';
  }
  if (delimiter === '(') {
    return 'paren';
  }
  if (delimiter !== '{') {
    return 'block';
  }

  if (['.tf', '.yaml', '.yml'].includes(kind)) {
    return 'object';
  }

  const prefix = String(line || '').slice(0, cursor).trimEnd();
  if (!prefix) {
    return 'object';
  }
  if (/\b(?:if|for|while|switch|catch|else|try|finally|do|fn|function|class|struct|enum|impl)\b[^{]*$/.test(prefix)) {
    return 'block';
  }
  if (/(?:=|:|=>|\(|\[|,|\breturn|\bcase)\s*$/.test(prefix)) {
    return 'object';
  }
  if (/\)\s*$/.test(prefix)) {
    return 'block';
  }
  return 'object';
}

module.exports = {
  scanSyntaxStructure,
  checkMissingCommaIssues,
};
