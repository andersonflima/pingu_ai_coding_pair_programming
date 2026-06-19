'use strict';

// Geracao offline de comentarios passo a passo para o pedido "comente este codigo".
// Reconstroi a funcao seguinte ao gatilho preservando cada linha de codigo
// verbatim, inserindo um docstring idiomatico apos a assinatura e um comentario
// factual antes de cada instrucao relevante. Os comentarios descrevem a sintaxe
// real da linha (nome chamado, variavel atribuida, retorno), sem inventar
// semantica. A acao resultante e um replace_range local que cobre o gatilho e o
// bloco da funcao, removendo o gatilho sem tocar em nenhuma linha de codigo.

const PYTHON_EXTENSIONS = new Set(['.py', '.pyi']);
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);

function normalizeExtension(ext) {
  return String(ext || '').trim().toLowerCase();
}

function leadingWhitespace(line) {
  const match = String(line || '').match(/^[ \t]*/);
  return match ? match[0] : '';
}

function isCommentInstructionForFollowingCode(instruction) {
  const lower = String(instruction || '').toLowerCase().trim();
  if (!lower) {
    return false;
  }
  return /\b(comment|comments|comente|comenta|comentar|comentando|documente|documenta|documentar|document|doc|docstring|explique|explica|explicar|explain)\b/.test(lower)
    && /\b(this|the|that|code|codigo|código|function|funcao|função|method|metodo|método|isso|este|esse|aqui|abaixo|below|it)\b/.test(lower);
}

function buildInlineCommentedFunction({ lines, triggerIndex, ext, file, buildDocstring }) {
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const normalizedExt = normalizeExtension(ext);
  const family = resolveFamily(normalizedExt);
  if (!family) {
    return null;
  }

  const headerIndex = findFunctionHeaderIndex(source, triggerIndex, family);
  if (headerIndex < 0) {
    return null;
  }

  const block = family.collectBlock(source, headerIndex);
  if (!block) {
    return null;
  }

  const header = family.parseHeader(source[headerIndex]);
  if (!header || !header.name) {
    return null;
  }

  const commentedLines = renderCommentedFunction({
    source,
    headerIndex,
    triggerIndex,
    block,
    family,
    buildDocstring,
  });
  if (!commentedLines) {
    return null;
  }

  return {
    snippet: commentedLines.join('\n'),
    action: {
      op: 'replace_range',
      target_file: String(file || '') || undefined,
      range: {
        start: { line: Math.max(0, triggerIndex), character: 0 },
        end: { line: block.end + 1, character: 0 },
      },
    },
  };
}

function renderCommentedFunction({ source, headerIndex, triggerIndex, block, family, buildDocstring }) {
  const headerLine = source[headerIndex];
  const headerIndent = leadingWhitespace(headerLine);
  const bodyIndent = resolveBodyIndent(source, headerIndex, block, family);
  const output = [];
  let added = 0;

  const hasDoc = family.hasExistingDoc(source, headerIndex, triggerIndex);
  const purpose = buildPurposeContext(source, headerIndex, block, family);
  const docstring = !hasDoc && typeof buildDocstring === 'function'
    ? buildDocstring(family.parseHeader(headerLine), purpose)
    : '';
  const docIndent = family.docPlacement === 'before' ? headerIndent : bodyIndent;
  const docLines = reindentBlock(docstring, docIndent);
  if (docLines.length > 0) {
    added += 1;
  }

  if (family.docPlacement === 'before') {
    docLines.forEach((docLine) => output.push(docLine));
    output.push(headerLine);
  } else {
    output.push(headerLine);
    docLines.forEach((docLine) => output.push(docLine));
  }

  let fenceOpen = false;
  for (let index = headerIndex + 1; index <= block.end; index += 1) {
    const line = source[index];
    const trimmed = String(line || '').trim();
    const togglesFence = countDocFences(trimmed) % 2 === 1;
    const insideString = fenceOpen;
    if (togglesFence) {
      fenceOpen = !fenceOpen;
    }

    const previousIsComment = index > headerIndex + 1
      && family.isComment(String(source[index - 1] || '').trim());
    if (!insideString && !togglesFence && !previousIsComment && shouldCommentStatement(line, family)) {
      const description = family.describe(line);
      if (description) {
        output.push(`${leadingWhitespace(line) || bodyIndent}${family.commentPrefix} ${description}`);
        added += 1;
      }
    }
    output.push(line);
  }

  return added > 0 ? output : null;
}

function resolveBodyIndent(source, headerIndex, block, family) {
  for (let index = headerIndex + 1; index <= block.end; index += 1) {
    const line = source[index];
    if (line && line.trim() && !family.isClosingLine(line)) {
      return leadingWhitespace(line);
    }
  }
  return `${leadingWhitespace(source[headerIndex])}  `;
}

function buildPurposeContext(source, headerIndex, block, family) {
  const headerIndent = leadingWhitespace(source[headerIndex]).length;
  const defines = [];
  const calls = [];
  const assigns = [];
  const returns = [];
  let fenceOpen = false;

  for (let index = headerIndex + 1; index <= block.end; index += 1) {
    const trimmed = String(source[index] || '').trim();
    if (!trimmed) {
      continue;
    }
    const togglesFence = countDocFences(trimmed) % 2 === 1;
    if (fenceOpen || togglesFence) {
      if (togglesFence) {
        fenceOpen = !fenceOpen;
      }
      continue;
    }
    if (family.isComment(trimmed)) {
      continue;
    }
    // Considera apenas o primeiro nivel do corpo para resumir o proposito.
    const isDirectChild = leadingWhitespace(source[index]).length <= headerIndent + family.bodyIndentUnit;
    const info = family.classify(trimmed);
    if (!info) {
      continue;
    }
    if (info.type === 'return' && info.value) {
      returns.push(info.value);
    } else if (!isDirectChild) {
      continue;
    } else if (info.type === 'def') {
      pushUnique(defines, info.value);
    } else if (info.type === 'call') {
      pushUnique(calls, info.value);
    } else if (info.type === 'assign') {
      pushUnique(assigns, info.value);
    }
  }

  const summary = composePurposeSummary({ defines, calls, assigns, returns });
  const returnDescription = returns.length
    ? `Retorna ${summarizeExpression(returns[returns.length - 1])}.`
    : '';
  return summary ? { summary, returnDescription } : {};
}

function composePurposeSummary({ defines, calls, assigns, returns }) {
  const parts = [];
  if (defines.length) {
    parts.push(`define ${humanizeList(defines)}`);
  }
  if (calls.length) {
    parts.push(`aciona ${humanizeList(calls)}`);
  } else if (assigns.length) {
    parts.push(`calcula ${humanizeList(assigns)}`);
  }
  if (returns.length) {
    parts.push(`retorna ${summarizeExpression(returns[returns.length - 1])}`);
  }
  if (!parts.length) {
    return '';
  }
  const sentence = parts.join(' e ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function humanizeList(values) {
  const items = values.slice(0, 3);
  if (items.length <= 1) {
    return items.join('');
  }
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

function pushUnique(target, value) {
  if (value && !target.includes(value)) {
    target.push(value);
  }
}

function shouldCommentStatement(line, family) {
  const text = String(line || '');
  const trimmed = text.trim();
  if (!trimmed) {
    return false;
  }
  if (family.isComment(trimmed)) {
    return false;
  }
  if (family.isClosingLine(trimmed)) {
    return false;
  }
  if (family.isContinuation(trimmed)) {
    return false;
  }
  if (/^["'`]/.test(trimmed)) {
    return false;
  }
  return true;
}

function countDocFences(trimmed) {
  const triple = String(trimmed || '').match(/"""|'''/g);
  return triple ? triple.length : 0;
}

function findFunctionHeaderIndex(source, triggerIndex, family) {
  for (let index = Math.max(0, triggerIndex) + 1; index < source.length; index += 1) {
    const line = source[index];
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      continue;
    }
    if (family.isComment(trimmed)) {
      continue;
    }
    return family.isFunctionHeader(line) ? index : -1;
  }
  return -1;
}

function resolveFamily(normalizedExt) {
  if (PYTHON_EXTENSIONS.has(normalizedExt)) {
    return PYTHON_FAMILY;
  }
  if (JS_EXTENSIONS.has(normalizedExt)) {
    return JS_FAMILY;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

const PYTHON_FAMILY = Object.freeze({
  commentPrefix: '#',
  docPlacement: 'inside',
  bodyIndentUnit: 4,
  classify: (trimmed) => classifyPythonStatement(trimmed),
  isComment: (trimmed) => trimmed.startsWith('#'),
  isClosingLine: () => false,
  isContinuation: (trimmed) => /^[)\]}]/.test(trimmed),
  isFunctionHeader: (line) => /^\s*(?:async\s+)?def\s+[a-zA-Z_][\w]*\s*\(/.test(String(line || '')) && /:\s*$/.test(String(line || '').trim()),
  hasExistingDoc: (source, headerIndex) => {
    for (let index = headerIndex + 1; index < source.length; index += 1) {
      const trimmed = String(source[index] || '').trim();
      if (!trimmed) {
        continue;
      }
      return /^("""|''')/.test(trimmed);
    }
    return false;
  },
  parseHeader: (line) => {
    const match = String(line || '').match(/^\s*(?:async\s+)?def\s+([a-zA-Z_][\w]*)\s*\(([^)]*)\)\s*:/);
    if (!match) {
      return null;
    }
    return {
      name: String(match[1] || ''),
      params: splitParams(match[2]),
    };
  },
  collectBlock: (lines, startIndex) => collectIndentBlock(lines, startIndex),
  describe: (line) => describePythonStatement(line),
});

function collectIndentBlock(lines, startIndex) {
  const headerIndent = leadingWhitespace(String(lines[startIndex] || '')).length;
  let end = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      end = index;
      continue;
    }
    if (leadingWhitespace(line).length <= headerIndent) {
      break;
    }
    end = index;
  }
  // Recorta linhas em branco finais do bloco.
  while (end > startIndex && !String(lines[end] || '').trim()) {
    end -= 1;
  }
  return end > startIndex ? { end } : null;
}

function classifyPythonStatement(trimmed) {
  let match;
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return { type: 'return', value: match[1].trim() };
  }
  if ((match = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z_][\w]*)/))) {
    return { type: 'def', value: match[1] };
  }
  if ((match = trimmed.match(/^class\s+([A-Za-z_][\w]*)/))) {
    return { type: 'def', value: match[1] };
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w.]*)\s*\(/))) {
    return { type: 'call', value: match[1] };
  }
  if ((match = trimmed.match(/^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/))) {
    return { type: 'call', value: match[1] };
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w]*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*)?=(?!=)/))) {
    return { type: 'assign', value: match[1] };
  }
  return null;
}

function describePythonStatement(line) {
  const trimmed = String(line || '').trim();
  let match;
  if ((match = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z_][\w]*)/))) {
    return `Define a funcao interna ${match[1]}.`;
  }
  if ((match = trimmed.match(/^class\s+([A-Za-z_][\w]*)/))) {
    return `Define a classe ${match[1]}.`;
  }
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if ((match = trimmed.match(/^(?:el)?if\s+(.+?):?$/))) {
    return `Avalia a condicao ${summarizeExpression(match[1])}.`;
  }
  if (/^else\s*:/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if ((match = trimmed.match(/^for\s+(.+?)\s+in\s+(.+?):?$/))) {
    return `Itera ${summarizeExpression(match[1])} sobre ${summarizeExpression(match[2])}.`;
  }
  if ((match = trimmed.match(/^while\s+(.+?):?$/))) {
    return `Repete enquanto ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^with\s+(.+?):?$/))) {
    return `Abre o contexto ${summarizeExpression(match[1])}.`;
  }
  if (/^try\s*:/.test(trimmed)) {
    return 'Inicia bloco protegido por tratamento de erro.';
  }
  if ((match = trimmed.match(/^except\b\s*(.*)$/))) {
    return match[1] ? `Trata a excecao ${summarizeExpression(match[1].replace(/:$/, ''))}.` : 'Trata as excecoes capturadas.';
  }
  if (/^finally\s*:/.test(trimmed)) {
    return 'Executa a finalizacao garantida.';
  }
  if ((match = trimmed.match(/^raise\b\s*(.*)$/))) {
    return match[1] ? `Lanca ${summarizeExpression(match[1])}.` : 'Relanca a excecao atual.';
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w.\[\]]*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*|\|)?=(?!=)\s*(.+)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w.]*)\s*\(/))) {
    return `Chama ${match[1]}.`;
  }
  if ((match = trimmed.match(/^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/))) {
    return `Chama ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------

const JS_FAMILY = Object.freeze({
  commentPrefix: '//',
  docPlacement: 'before',
  bodyIndentUnit: 2,
  classify: (trimmed) => classifyJsStatement(trimmed),
  isComment: (trimmed) => trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*'),
  isClosingLine: (trimmed) => /^[)\]}]+;?\s*$/.test(String(trimmed || '').trim()),
  isContinuation: (trimmed) => /^[).\]}]/.test(trimmed) || /^[?:&|]{1,2}/.test(trimmed),
  isFunctionHeader: (line) => Boolean(parseJsHeader(line)) && /\{\s*$/.test(String(line || '')),
  hasExistingDoc: (source, headerIndex, triggerIndex) => {
    const previousIndex = headerIndex - 1;
    if (previousIndex <= triggerIndex) {
      return false;
    }
    const previous = String(source[previousIndex] || '').trim();
    return previous.endsWith('*/') || previous.startsWith('//');
  },
  parseHeader: (line) => parseJsHeader(line),
  collectBlock: (lines, startIndex) => collectBraceBlock(lines, startIndex),
  describe: (line) => describeJsStatement(line),
});

function parseJsHeader(line) {
  const source = String(line || '');
  let match = source.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/);
  if (!match) {
    match = source.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/);
  }
  if (!match) {
    match = source.match(/^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*(?:async\s+)?(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/);
    if (match && ['if', 'for', 'while', 'switch', 'catch', 'with', 'return'].includes(String(match[1] || '').toLowerCase())) {
      match = null;
    }
  }
  if (!match || !match[1]) {
    return null;
  }
  return {
    name: String(match[1] || ''),
    params: splitParams(match[2]),
  };
}

function collectBraceBlock(lines, startIndex) {
  let depth = countBraceDelta(String(lines[startIndex] || ''));
  if (depth <= 0) {
    return null;
  }
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    depth += countBraceDelta(String(lines[index] || ''));
    if (depth <= 0) {
      return { end: index };
    }
  }
  return null;
}

function countBraceDelta(line) {
  let depth = 0;
  let inString = '';
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inString) {
      if (char === '\\') {
        index += 1;
      } else if (char === inString) {
        inString = '';
      }
      continue;
    }
    if (char === '"' || char === '\'' || char === '`') {
      inString = char;
      continue;
    }
    if (char === '/' && line[index + 1] === '/') {
      break;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
    }
  }
  return depth;
}

function classifyJsStatement(trimmed) {
  const clean = String(trimmed || '').replace(/;$/, '');
  let match;
  if ((match = clean.match(/^return\b\s*(.*)$/))) {
    return { type: 'return', value: match[1].trim() };
  }
  if ((match = clean.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/))) {
    return { type: 'def', value: match[1] };
  }
  if ((match = clean.match(/^class\s+([A-Za-z_$][\w$]*)/))) {
    return { type: 'def', value: match[1] };
  }
  if ((match = clean.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/))) {
    return { type: 'def', value: match[1] };
  }
  if ((match = clean.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/))) {
    return { type: 'assign', value: match[1] };
  }
  if ((match = clean.match(/^(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/))) {
    return { type: 'call', value: match[1] };
  }
  if ((match = clean.match(/^([A-Za-z_$][\w$.\[\]]*)\s*(?:\+|-|\*|\/|%|\|\||&&|\?\?)?=(?!=)/))) {
    return { type: 'assign', value: match[1] };
  }
  return null;
}

function describeJsStatement(line) {
  const trimmed = String(line || '').trim().replace(/;$/, '');
  let match;
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if ((match = trimmed.match(/^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)$/))) {
    return `Define ${match[1]} a partir de ${summarizeExpression(match[2])}.`;
  }
  if ((match = trimmed.match(/^if\s*\((.+)\)\s*\{?$/))) {
    return `Avalia a condicao ${summarizeExpression(match[1])}.`;
  }
  if (/^else\b/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if ((match = trimmed.match(/^for\s*\((.+)\)\s*\{?$/))) {
    return `Itera sobre ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^while\s*\((.+)\)\s*\{?$/))) {
    return `Repete enquanto ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^switch\s*\((.+)\)\s*\{?$/))) {
    return `Seleciona o caso de ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^throw\b\s*(.*)$/))) {
    return match[1] ? `Lanca ${summarizeExpression(match[1])}.` : 'Relanca o erro atual.';
  }
  if ((match = trimmed.match(/^(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/))) {
    return `Chama ${match[1]}.`;
  }
  if ((match = trimmed.match(/^([A-Za-z_$][\w$.\[\]]*)\s*(?:\+|-|\*|\/|%|\|\||&&|\?\?)?=(?!=)\s*(.+)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function reindentBlock(block, indent) {
  if (!block) {
    return [];
  }
  return String(block).split('\n').map((line) => (line.trim() ? `${indent}${line}` : ''));
}

function splitParams(raw) {
  return String(raw || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function summarizeExpression(expression) {
  const normalized = String(expression || '').trim().replace(/\s+/g, ' ').replace(/[:{]+\s*$/, '').trim();
  if (normalized.length <= 48) {
    return normalized;
  }
  return `${normalized.slice(0, 45)}...`;
}

module.exports = {
  buildInlineCommentedFunction,
  isCommentInstructionForFollowingCode,
};
