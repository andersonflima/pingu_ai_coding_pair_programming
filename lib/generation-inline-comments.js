'use strict';

// Geracao offline de comentarios passo a passo para o pedido "comente este codigo".
// Reconstroi a funcao seguinte ao gatilho preservando cada linha de codigo
// verbatim, inserindo um doc idiomatico (docstring/JSDoc/@doc/comentario de
// cabecalho) e um comentario factual antes de cada instrucao relevante. O resumo
// do doc descreve O QUE a funcao faz (proposito inferido do nome + efeitos e
// retorno do corpo); os comentarios inline descrevem O COMO. A acao e um
// replace_range local que cobre o gatilho e o bloco da funcao, removendo o
// gatilho sem tocar em nenhuma linha de codigo. Cobre as linguagens com funcao
// mapeadas no runtime; estrategias de bloco: chaves, indentacao e palavra-chave
// de fechamento (end/endfunction).

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
  const family = resolveFamily(normalizeExtension(ext));
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

  const commentedLines = renderCommentedFunction({ source, headerIndex, triggerIndex, block, family, buildDocstring });
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
  let docstring = !hasDoc && typeof buildDocstring === 'function'
    ? buildDocstring(family.parseHeader(headerLine), purpose)
    : '';
  if (!hasDoc && !docstring && typeof family.buildFallbackDoc === 'function') {
    docstring = family.buildFallbackDoc(family.parseHeader(headerLine), purpose);
  }
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
    const togglesFence = family.countStringFences(trimmed) % 2 === 1;
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
    if (line && line.trim() && !family.isClosingLine(line.trim())) {
      return leadingWhitespace(line);
    }
  }
  return `${leadingWhitespace(source[headerIndex])}  `;
}

function shouldCommentStatement(line, family) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return false;
  }
  if (family.isComment(trimmed) || family.isClosingLine(trimmed) || family.isContinuation(trimmed)) {
    return false;
  }
  if (/^["'`]/.test(trimmed)) {
    return false;
  }
  return true;
}

function findFunctionHeaderIndex(source, triggerIndex, family) {
  for (let index = Math.max(0, triggerIndex) + 1; index < source.length; index += 1) {
    const trimmed = String(source[index] || '').trim();
    if (!trimmed || family.isComment(trimmed)) {
      continue;
    }
    return family.isFunctionHeader(source[index]) ? index : -1;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Proposito da funcao (o que ela faz)
// ---------------------------------------------------------------------------

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
    const togglesFence = family.countStringFences(trimmed) % 2 === 1;
    if (fenceOpen || togglesFence) {
      if (togglesFence) {
        fenceOpen = !fenceOpen;
      }
      continue;
    }
    if (family.isComment(trimmed)) {
      continue;
    }
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

  const header = family.parseHeader(source[headerIndex]) || {};
  const summary = composePurposeSummary({ name: header.name, defines, calls, assigns, returns });
  const returnDescription = returns.length ? summarizeExpression(returns[returns.length - 1]) : '';
  return summary ? { summary, returnDescription } : {};
}

function composePurposeSummary({ name, defines, calls, assigns, returns }) {
  const ret = returns.length ? summarizeExpression(returns[returns.length - 1]) : '';
  const nameIntent = humanizeFunctionPurpose(name);
  if (nameIntent) {
    return ret ? `${nameIntent}, retornando ${ret}.` : `${nameIntent}.`;
  }

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
    parts.push(`retorna ${ret}`);
  }
  if (!parts.length) {
    return '';
  }
  const sentence = parts.join(' e ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

const VERB_TRANSLATIONS = Object.freeze({
  get: 'Obtem', fetch: 'Busca', load: 'Carrega', read: 'Le', set: 'Define',
  save: 'Salva', store: 'Armazena', persist: 'Persiste', create: 'Cria',
  make: 'Cria', build: 'Constroi', generate: 'Gera', gen: 'Gera', init: 'Inicializa',
  initialize: 'Inicializa', find: 'Encontra', search: 'Busca', lookup: 'Busca',
  update: 'Atualiza', edit: 'Edita', modify: 'Modifica', delete: 'Remove',
  remove: 'Remove', destroy: 'Remove', clear: 'Limpa', reset: 'Reinicia',
  validate: 'Valida', verify: 'Verifica', check: 'Verifica', ensure: 'Garante',
  parse: 'Analisa', format: 'Formata', render: 'Renderiza', draw: 'Desenha',
  send: 'Envia', dispatch: 'Despacha', emit: 'Emite', publish: 'Publica',
  handle: 'Trata', process: 'Processa', run: 'Executa', exec: 'Executa',
  execute: 'Executa', calculate: 'Calcula', calc: 'Calcula', compute: 'Calcula',
  sum: 'Soma', count: 'Conta', convert: 'Converte', transform: 'Transforma',
  map: 'Mapeia', filter: 'Filtra', sort: 'Ordena', merge: 'Combina', join: 'Junta',
  add: 'Adiciona', append: 'Adiciona', insert: 'Insere', push: 'Adiciona',
  register: 'Registra', resolve: 'Resolve', normalize: 'Normaliza', sanitize: 'Sanitiza',
  encode: 'Codifica', decode: 'Decodifica', serialize: 'Serializa', deserialize: 'Desserializa',
  apply: 'Aplica', use: 'Usa', toggle: 'Alterna', enable: 'Ativa', disable: 'Desativa',
  start: 'Inicia', stop: 'Para', open: 'Abre', close: 'Fecha', connect: 'Conecta',
  write: 'Escreve', print: 'Imprime', log: 'Registra', notify: 'Notifica',
  is: 'Indica se', has: 'Indica se', should: 'Indica se', can: 'Indica se',
  // Verbos ja em portugues.
  calcula: 'Calcula', calcular: 'Calcula', cria: 'Cria', criar: 'Cria', busca: 'Busca',
  buscar: 'Busca', valida: 'Valida', validar: 'Valida', obtem: 'Obtem', obter: 'Obtem',
  atualiza: 'Atualiza', atualizar: 'Atualiza', remove: 'Remove', remover: 'Remove',
  gera: 'Gera', gerar: 'Gera', processa: 'Processa', processar: 'Processa',
  envia: 'Envia', enviar: 'Envia', salva: 'Salva', salvar: 'Salva', carrega: 'Carrega',
  carregar: 'Carrega', formata: 'Formata', formatar: 'Formata', converte: 'Converte',
  converter: 'Converte', soma: 'Soma', somar: 'Soma', conta: 'Conta', contar: 'Conta',
});

function humanizeFunctionPurpose(name) {
  const words = splitIdentifierWords(name);
  if (!words.length) {
    return '';
  }
  const verb = VERB_TRANSLATIONS[words[0].toLowerCase()];
  if (!verb) {
    return '';
  }
  const rest = words.slice(1).join(' ').trim();
  return rest ? `${verb} ${rest}` : verb;
}

function splitIdentifierWords(name) {
  return String(name || '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Estrategias de bloco
// ---------------------------------------------------------------------------

function collectIndentBlock(lines, startIndex) {
  const headerIndent = leadingWhitespace(String(lines[startIndex] || '')).length;
  let end = startIndex;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    if (!line.trim()) {
      end = index;
      continue;
    }
    if (leadingWhitespace(line).length <= headerIndent) {
      break;
    }
    end = index;
  }
  while (end > startIndex && !String(lines[end] || '').trim()) {
    end -= 1;
  }
  return end > startIndex ? { end } : null;
}

function collectBraceBlock(lines, startIndex) {
  let depth = countBraceDelta(String(lines[startIndex] || ''));
  if (depth <= 0) {
    return /\{/.test(String(lines[startIndex] || '')) ? { end: startIndex } : null;
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
    if (char === '#') {
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

function makeKeywordEndCollector({ openers, closer }) {
  return (lines, startIndex) => {
    const header = String(lines[startIndex] || '');
    if (/,\s*do:\s*\S/.test(header)) {
      return { end: startIndex };
    }
    let depth = 1;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const trimmed = String(lines[index] || '').trim();
      if (!trimmed) {
        continue;
      }
      if (closer.test(trimmed)) {
        depth -= 1;
        if (depth <= 0) {
          return { end: index };
        }
        continue;
      }
      if (openers.test(trimmed)) {
        depth += 1;
      }
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Classificacao e descricao de instrucoes
// ---------------------------------------------------------------------------

function classifyByPatterns(trimmed, patterns) {
  for (const [type, regex, group] of patterns) {
    const match = trimmed.match(regex);
    if (match) {
      return { type, value: (match[group || 1] || '').trim() };
    }
  }
  return null;
}

const C_CALL = /^(?:await\s+)?([A-Za-z_$][\w$.]*)\s*\(/;
const C_ASSIGN = /^(?:[A-Za-z_$][\w$<>:\[\] *&]*\s+)?([A-Za-z_$][\w$.\[\]]*)\s*(?::?=|[-+*/%|&^]?=)(?!=)/;

function classifyCStyle(trimmed) {
  const clean = trimmed.replace(/;$/, '');
  return classifyByPatterns(clean, [
    ['return', /^return\b\s*(.*)$/],
    ['def', /^(?:export\s+)?(?:default\s+)?(?:pub\s+)?(?:async\s+)?(?:func|fn|fun|function|def)\s*\*?\s*([A-Za-z_$][\w$]*)/],
    ['def', /^(?:export\s+)?(?:abstract\s+|final\s+|sealed\s+)?class\s+([A-Za-z_$][\w$]*)/],
    ['def', /^(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\([^)]*\)\s*=>)/],
    ['assign', /^(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*[:=]/],
    ['assign', /^(\$[A-Za-z_]\w*)\s*=(?!=)/],
    ['assign', /^([A-Za-z_$][\w$.\[\]]*)\s*:=/],
    ['call', C_CALL],
    ['assign', C_ASSIGN],
  ]);
}

function describeCStyle(line) {
  const trimmed = String(line || '').trim().replace(/;$/, '');
  let match;
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if ((match = trimmed.match(/^(?:export\s+)?(?:const|let|var|val)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(.+)$/))) {
    return `Define ${match[1]} a partir de ${summarizeExpression(match[2])}.`;
  }
  if ((match = trimmed.match(/^(\$[A-Za-z_]\w*)\s*=\s*(.+)$/))) {
    return `Define ${match[1]} a partir de ${summarizeExpression(match[2])}.`;
  }
  if ((match = trimmed.match(/^([A-Za-z_$][\w$.\[\]]*)\s*:=\s*(.+)$/))) {
    return `Define ${match[1]} a partir de ${summarizeExpression(match[2])}.`;
  }
  if ((match = trimmed.match(/^if\s*\(?(.+?)\)?\s*\{?$/)) && /^if\b/.test(trimmed)) {
    return `Avalia a condicao ${summarizeExpression(match[1])}.`;
  }
  if (/^else\b/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if ((match = trimmed.match(/^for\s*\(?(.+?)\)?\s*\{?$/)) && /^for\b/.test(trimmed)) {
    return `Itera sobre ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^while\s*\(?(.+?)\)?\s*\{?$/)) && /^while\b/.test(trimmed)) {
    return `Repete enquanto ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^switch\s*\(?(.+?)\)?\s*\{?$/)) && /^switch\b/.test(trimmed)) {
    return `Seleciona o caso de ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^(?:throw|panic)\b\s*(.*)$/))) {
    return match[1] ? `Lanca ${summarizeExpression(match[1])}.` : 'Relanca o erro atual.';
  }
  if ((match = trimmed.match(C_CALL))) {
    return `Chama ${match[1]}.`;
  }
  if ((match = trimmed.match(C_ASSIGN))) {
    return `Atribui valor a ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

function classifyPython(trimmed) {
  return classifyByPatterns(trimmed, [
    ['return', /^return\b\s*(.*)$/],
    ['def', /^(?:async\s+)?def\s+([a-zA-Z_]\w*)/],
    ['def', /^class\s+([A-Za-z_]\w*)/],
    ['call', /^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/],
    ['assign', /^([A-Za-z_][\w]*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*)?=(?!=)/],
  ]);
}

function describePython(line) {
  const trimmed = String(line || '').trim();
  let match;
  if ((match = trimmed.match(/^(?:async\s+)?def\s+([a-zA-Z_]\w*)/))) {
    return `Define a funcao interna ${match[1]}.`;
  }
  if ((match = trimmed.match(/^class\s+([A-Za-z_]\w*)/))) {
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
  if ((match = trimmed.match(/^([A-Za-z_][\w.\[\]]*)\s*(?:\+|-|\*|\/|\/\/|%|\*\*)?=(?!=)\s*(.+)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  if ((match = trimmed.match(/^(?:await\s+)?([A-Za-z_][\w.]*)\s*\(/))) {
    return `Chama ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

const SCRIPT_CALL = /^([A-Za-z_][\w.:]*[?!]?)\s*[\s(]/;

function classifyScript(trimmed) {
  return classifyByPatterns(trimmed, [
    ['return', /^return\b\s*(.*)$/],
    ['def', /^(?:local\s+)?(?:function|def[p]?)\s+(?:self\.)?([A-Za-z_][\w.:]*[?!]?)/],
    ['def', /^(?:class|module|defmodule)\s+([A-Za-z_][\w.]*)/],
    ['assign', /^(?:local\s+)?([A-Za-z_][\w]*)\s*(?:\+|-|\*|\/|%|\|\||<<|\.)?=(?!=)/],
    ['call', SCRIPT_CALL],
  ]);
}

function describeScript(line) {
  const trimmed = String(line || '').trim();
  let match;
  if ((match = trimmed.match(/^(?:local\s+)?(?:function|def[p]?)\s+(?:self\.)?([A-Za-z_][\w.:]*[?!]?)/))) {
    return `Define a rotina interna ${match[1]}.`;
  }
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if ((match = trimmed.match(/^(?:els)?if\s+(.+?)(?:\s+then)?$/))) {
    return `Avalia a condicao ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^unless\s+(.+)$/))) {
    return `Trata o caso em que nao ${summarizeExpression(match[1])}.`;
  }
  if (/^else\b/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if ((match = trimmed.match(/^case\s+(.+?)(?:\s+do)?$/))) {
    return `Seleciona o caso de ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^(?:for|while)\s+(.+?)(?:\s+(?:do|then))?$/))) {
    return `Repete sobre ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/(.+?)\.each\b/))) {
    return `Itera sobre ${summarizeExpression(match[1])}.`;
  }
  if ((match = trimmed.match(/^(?:local\s+)?([A-Za-z_][\w]*)\s*(?:\+|-|\*|\/|%|\|\||<<|\.)?=(?!=)\s*(.+)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  if ((match = trimmed.match(SCRIPT_CALL))) {
    return `Chama ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

function classifyVim(trimmed) {
  return classifyByPatterns(trimmed, [
    ['return', /^return\b\s*(.*)$/],
    ['def', /^function!?\s+([A-Za-z_][\w:#]*)/],
    ['assign', /^let\s+([A-Za-z_][\w:]*)\s*[-+.*/]?=(?!=)/],
    ['call', /^call\s+([A-Za-z_][\w:#.]*)/],
    ['call', /^([A-Za-z_][\w:#.]*)\s*\(/],
  ]);
}

function describeVim(line) {
  const trimmed = String(line || '').trim();
  let match;
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if ((match = trimmed.match(/^let\s+([A-Za-z_][\w:]*)\s*[-+.*/]?=(?!=)\s*(.+)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  if ((match = trimmed.match(/^call\s+([A-Za-z_][\w:#.]*)/))) {
    return `Chama ${match[1]}.`;
  }
  if (/^(?:if|elseif)\b/.test(trimmed)) {
    return 'Avalia a condicao.';
  }
  if (/^else\b/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if (/^(?:for|while)\b/.test(trimmed)) {
    return 'Repete o bloco.';
  }
  if (/^try\b/.test(trimmed)) {
    return 'Inicia bloco protegido por tratamento de erro.';
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w:#.]*)\s*\(/))) {
    return `Chama ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

function classifyShell(trimmed) {
  return classifyByPatterns(trimmed, [
    ['return', /^return\b\s*(.*)$/],
    ['def', /^(?:function\s+)?([A-Za-z_]\w*)\s*\(\)\s*\{/],
    ['assign', /^(?:local\s+|export\s+|declare\s+)?([A-Za-z_]\w*)=(?!=)/],
    ['call', /^([A-Za-z_][\w-]*)\b/],
  ]);
}

function describeShell(line) {
  const trimmed = String(line || '').trim();
  let match;
  if (/^(?:then|do|fi|done|esac|;;|\}|\{)\s*$/.test(trimmed)) {
    return '';
  }
  if ((match = trimmed.match(/^return\b\s*(.*)$/))) {
    return match[1] ? `Retorna ${summarizeExpression(match[1])}.` : 'Retorna o controle ao chamador.';
  }
  if (/^(?:if|elif)\b/.test(trimmed)) {
    return 'Avalia a condicao.';
  }
  if (/^else\b/.test(trimmed)) {
    return 'Trata o caso alternativo.';
  }
  if (/^(?:for|while|until)\b/.test(trimmed)) {
    return 'Repete o bloco.';
  }
  if (/^case\b/.test(trimmed)) {
    return 'Seleciona o caso.';
  }
  if ((match = trimmed.match(/^(?:local\s+|export\s+|declare\s+)?([A-Za-z_]\w*)=(?!=)\s*(.*)$/))) {
    return `Atribui ${summarizeExpression(match[2])} a ${match[1]}.`;
  }
  if ((match = trimmed.match(/^([A-Za-z_][\w-]*)\b/))) {
    return `Executa o comando ${match[1]}.`;
  }
  return 'Executa a instrucao.';
}

// ---------------------------------------------------------------------------
// Familias por linguagem
// ---------------------------------------------------------------------------

function hasDocAbove(source, headerIndex, triggerIndex, isDocLine) {
  const previousIndex = headerIndex - 1;
  if (previousIndex <= triggerIndex) {
    return false;
  }
  const previous = String(source[previousIndex] || '').trim();
  return isDocLine(previous);
}

const PYTHON_FAMILY = {
  commentPrefix: '#',
  docPlacement: 'inside',
  bodyIndentUnit: 4,
  classify: classifyPython,
  describe: describePython,
  isComment: (trimmed) => trimmed.startsWith('#'),
  isClosingLine: () => false,
  isContinuation: (trimmed) => /^[)\]}]/.test(trimmed),
  countStringFences: (trimmed) => (String(trimmed).match(/"""|'''/g) || []).length,
  isFunctionHeader: (line) => /^\s*(?:async\s+)?def\s+[a-zA-Z_]\w*\s*\(/.test(String(line || '')) && /:\s*$/.test(String(line || '').trim()),
  parseHeader: (line) => {
    const match = String(line || '').match(/^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(([^)]*)\)\s*:/);
    return match ? { name: match[1], params: splitParams(match[2]) } : null;
  },
  collectBlock: collectIndentBlock,
  hasExistingDoc: (source, headerIndex) => {
    for (let index = headerIndex + 1; index < source.length; index += 1) {
      const trimmed = String(source[index] || '').trim();
      if (trimmed) {
        return /^("""|''')/.test(trimmed);
      }
    }
    return false;
  },
};

function braceFamily({ commentPrefix, headerRegexes, isDocLine, classify, describe, docFallbackStyle }) {
  return {
    commentPrefix,
    docPlacement: 'before',
    bodyIndentUnit: 2,
    classify: classify || classifyCStyle,
    describe: describe || describeCStyle,
    buildFallbackDoc: docFallbackStyle ? (header, purpose) => buildFallbackDocBlock(docFallbackStyle, header, purpose) : null,
    isComment: (trimmed) => trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('#'),
    isClosingLine: (trimmed) => /^[)\]}]+;?\s*$/.test(String(trimmed || '').trim()),
    isContinuation: (trimmed) => /^[).\]}]/.test(trimmed) || /^[?:&|]{1,2}/.test(trimmed),
    countStringFences: () => 0,
    isFunctionHeader: (line) => Boolean(matchAny(line, headerRegexes)) && /\{\s*$/.test(String(line || '')),
    parseHeader: (line) => {
      const match = matchAny(line, headerRegexes);
      return match ? { name: match.name, params: splitParams(match.params) } : null;
    },
    collectBlock: collectBraceBlock,
    hasExistingDoc: (source, headerIndex, triggerIndex) => hasDocAbove(source, headerIndex, triggerIndex, isDocLine),
  };
}

function keywordEndFamily({ commentPrefix, headerRegexes, openers, closer, isDocLine, classify, describe }) {
  return {
    commentPrefix,
    docPlacement: 'before',
    bodyIndentUnit: 2,
    classify: classify || classifyScript,
    describe: describe || describeScript,
    isComment: (trimmed) => trimmed.startsWith(commentPrefix) || (commentPrefix === '"' && trimmed.startsWith('"')),
    isClosingLine: (trimmed) => closer.test(String(trimmed || '').trim()),
    isContinuation: (trimmed) => /^[).\]}]/.test(trimmed),
    countStringFences: () => 0,
    isFunctionHeader: (line) => Boolean(matchAny(line, headerRegexes)),
    parseHeader: (line) => {
      const match = matchAny(line, headerRegexes);
      return match ? { name: match.name, params: splitParams(match.params) } : null;
    },
    collectBlock: makeKeywordEndCollector({ openers, closer }),
    hasExistingDoc: (source, headerIndex, triggerIndex) => hasDocAbove(source, headerIndex, triggerIndex, isDocLine),
  };
}

function buildFallbackDocBlock(style, header, purpose) {
  const name = String(header && header.name || '').trim();
  const params = Array.isArray(header && header.params) ? header.params : [];
  const summary = (purpose && purpose.summary) || `Documenta ${name || 'a funcao'}.`;
  const returnDescription = purpose && purpose.returnDescription;

  if (style === 'triple-slash') {
    const lines = [`/// ${summary}`];
    params.forEach((param) => lines.push(`/// - Parametro ${docParamName(param)}: entrada do fluxo.`));
    if (returnDescription) {
      lines.push(`/// - Retorno: ${returnDescription}.`);
    }
    return lines.join('\n');
  }

  const lines = ['/**', ` * ${summary}`];
  params.forEach((param) => lines.push(` * @param ${docParamName(param)} Parametro de entrada do fluxo.`));
  if (returnDescription) {
    lines.push(` * @return ${returnDescription}`);
  }
  lines.push(' */');
  return lines.join('\n');
}

function docParamName(param) {
  const text = String(param || '').trim();
  if (!text) {
    return 'arg';
  }
  if (text.includes(':')) {
    return text.split(':')[0].trim();
  }
  const tokens = text.replace(/[=].*$/, '').trim().split(/\s+/);
  return tokens[tokens.length - 1] || 'arg';
}

function matchAny(line, regexes) {
  const source = String(line || '');
  for (const regex of regexes) {
    const match = source.match(regex);
    if (match && match[1]) {
      return { name: String(match[1]), params: match[2] || '' };
    }
  }
  return null;
}

const RUBY_OPENERS = /^(?:def|class|module|if|unless|case|while|until|for|begin)\b|(?:\bdo\b\s*(?:\|[^|]*\|)?\s*$)/;
const ELIXIR_OPENERS = /^(?:def[p]?|defmodule|if|unless|case|cond|with|for|receive|try|fn)\b|(?:\bdo\b\s*$)/;
const LUA_OPENERS = /^(?:function|if|for|while|repeat)\b|(?:\bdo\b\s*$)|(?:\bthen\s*$)/;

const FAMILY_BY_EXTENSION = buildExtensionMap();

function buildExtensionMap() {
  const map = new Map();
  const register = (exts, family) => exts.forEach((ext) => map.set(ext, family));

  register(['.py', '.pyi'], PYTHON_FAMILY);

  register(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'], braceFamily({
    commentPrefix: '//',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//'),
    headerRegexes: [
      /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
      /^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*(?:async\s+)?(?:(?:get|set)\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/,
    ],
  }));

  register(['.go'], braceFamily({
    commentPrefix: '//',
    isDocLine: (line) => line.startsWith('//'),
    headerRegexes: [/^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)\s*\(([^)]*)\)/],
  }));

  register(['.rs'], braceFamily({
    commentPrefix: '//',
    isDocLine: (line) => line.startsWith('///') || line.startsWith('//'),
    headerRegexes: [/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/],
  }));

  register(['.c', '.h', '.cpp', '.hpp', '.cc', '.cxx'], braceFamily({
    commentPrefix: '//',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//'),
    headerRegexes: [/^\s*(?:(?:static|inline|extern|const|unsigned|signed|volatile|long|short)\s+)*(?:[A-Za-z_]\w*(?:\s*\*)*\s+)+([A-Za-z_]\w*)\s*\(([^;{}]*)\)\s*\{/],
  }));

  register(['.rb', '.rake'], keywordEndFamily({
    commentPrefix: '#',
    isDocLine: (line) => line.startsWith('#'),
    headerRegexes: [/^\s*def\s+(?:self\.)?([a-z_][\w?!]*)\s*(?:\(([^)]*)\))?/],
    openers: RUBY_OPENERS,
    closer: /^end\b/,
  }));

  register(['.ex', '.exs'], keywordEndFamily({
    commentPrefix: '#',
    isDocLine: (line) => line.startsWith('#') || line.startsWith('@doc') || line.endsWith('"""'),
    headerRegexes: [/^\s*def[p]?\s+([a-z_][\w?!]*)\s*(?:\(([^)]*)\))?/],
    openers: ELIXIR_OPENERS,
    closer: /^end\b/,
  }));

  register(['.lua'], keywordEndFamily({
    commentPrefix: '--',
    isDocLine: (line) => line.startsWith('--'),
    headerRegexes: [
      /^\s*function\s+(?:[A-Za-z_][\w]*[.:])?([A-Za-z_][\w]*)\s*\(([^)]*)\)/,
      /^\s*local\s+function\s+([A-Za-z_][\w]*)\s*\(([^)]*)\)/,
    ],
    openers: LUA_OPENERS,
    closer: /^end\b/,
  }));

  register(['.vim'], keywordEndFamily({
    commentPrefix: '"',
    isDocLine: (line) => line.startsWith('"'),
    classify: classifyVim,
    describe: describeVim,
    headerRegexes: [/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][\w:#]*)\s*\(([^)]*)\)/i],
    openers: /^x^/,
    closer: /^endfunc(?:tion)?\b/,
  }));

  register(['.java'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'jsdoc',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//') || line.startsWith('@'),
    headerRegexes: [/^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)+[\w<>\[\].,?&\s]+?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*(?:throws[\w\s,.]+)?\{/],
  }));

  register(['.cs'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'triple-slash',
    isDocLine: (line) => line.startsWith('///') || line.startsWith('//') || line.endsWith('*/'),
    headerRegexes: [/^\s*(?:(?:public|private|protected|internal|static|virtual|override|sealed|async|partial|abstract|extern|unsafe)\s+)+[\w<>\[\].,?&\s]+?\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/],
  }));

  register(['.kt', '.kts'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'jsdoc',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//'),
    headerRegexes: [/^\s*(?:(?:public|private|protected|internal|open|override|suspend|inline|operator|tailrec)\s+)*fun\s+(?:<[^>]+>\s*)?([A-Za-z_]\w*)\s*\(([^)]*)\)/],
  }));

  register(['.swift'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'triple-slash',
    isDocLine: (line) => line.startsWith('///') || line.startsWith('//') || line.endsWith('*/'),
    headerRegexes: [/^\s*(?:(?:public|private|internal|fileprivate|open|static|class|final|override|mutating|nonmutating|convenience|required)\s+)*func\s+([A-Za-z_]\w*)\s*(?:<[^>]+>)?\s*\(([^)]*)\)/],
  }));

  register(['.scala', '.sc'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'jsdoc',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//') || line.startsWith('*'),
    headerRegexes: [/^\s*(?:(?:private|protected|override|final|implicit)\s+)*def\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(([^)]*)\)/],
  }));

  register(['.php'], braceFamily({
    commentPrefix: '//',
    docFallbackStyle: 'jsdoc',
    isDocLine: (line) => line.endsWith('*/') || line.startsWith('//') || line.startsWith('*') || line.startsWith('#'),
    headerRegexes: [/^\s*(?:(?:public|private|protected|static|final|abstract)\s+)*function\s+&?\s*([A-Za-z_]\w*)\s*\(([^)]*)\)/],
  }));

  register(['.sh', '.bash', '.zsh'], braceFamily({
    commentPrefix: '#',
    isDocLine: (line) => line.startsWith('#'),
    classify: classifyShell,
    describe: describeShell,
    headerRegexes: [
      /^\s*function\s+([A-Za-z_]\w*)\s*(?:\(\))?\s*\{/,
      /^\s*([A-Za-z_]\w*)\s*\(\)\s*\{/,
    ],
  }));

  return map;
}

function resolveFamily(normalizedExt) {
  return FAMILY_BY_EXTENSION.get(normalizedExt) || null;
}

// ---------------------------------------------------------------------------
// Helpers compartilhados
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
