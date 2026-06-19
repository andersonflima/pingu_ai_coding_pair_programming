'use strict';

// Deteccao conservadora de imports nao utilizados em JavaScript/TypeScript e
// Python. Suggest-only: imports podem ter efeito colateral (modulos importados
// so pela execucao), entao o Pingu sinaliza mas nunca remove automaticamente.
// Heuristica deliberadamente conservadora: um binding so e marcado quando o
// nome nao aparece como palavra em nenhuma outra linha do arquivo (qualquer
// ocorrencia, inclusive acesso a propriedade, conta como uso => menos falso
// positivo, ao custo de alguns falsos negativos).

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');

function checkUnusedImports(lines, file, kind, opts = {}) {
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const bindings = isJavaScriptLikeExtension(kind)
    ? collectJavaScriptImportBindings(source)
    : isPythonLikeExtension(kind)
      ? collectPythonImportBindings(source)
      : [];
  if (bindings.length === 0) {
    return [];
  }

  const focusRange = opts.focusRange || null;
  return bindings
    .filter((binding) => !isBindingReferenced(source, binding))
    .filter((binding) => isLineInFocus(focusRange, binding.line))
    .map((binding) => buildUnusedImportIssue(file, binding));
}

function checkUnusedVariables(lines, file, kind, opts = {}) {
  // Conservador: apenas JavaScript/TypeScript, apenas variaveis locais
  // (indentadas) declaradas com const/let, com lado direito "puro" (sem chamada
  // de funcao, await ou new, que poderiam ter efeito colateral). Suggest-only.
  if (!isJavaScriptLikeExtension(kind)) {
    return [];
  }
  const source = Array.isArray(lines) ? lines.map((line) => String(line || '')) : [];
  const focusRange = opts.focusRange || null;
  const bindings = collectLocalConstBindings(source);
  return bindings
    .filter((binding) => !isBindingReferenced(source, binding))
    .filter((binding) => isLineInFocus(focusRange, binding.line))
    .map((binding) => buildUnusedVariableIssue(file, binding));
}

function collectLocalConstBindings(lines) {
  const bindings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // Precisa estar indentada (escopo local), nao exportada.
    if (!/^\s+/.test(line) || /^\s*export\b/.test(line)) {
      continue;
    }
    const match = line.match(/^\s*(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(.+?);?\s*$/);
    if (!match) {
      continue;
    }
    const name = match[1];
    const rhs = match[2];
    if (name.startsWith('_') || !isPureRightHandSide(rhs)) {
      continue;
    }
    bindings.push(makeBinding(name, index, new Set([index]), '//'));
  }
  return bindings;
}

function isPureRightHandSide(rhs) {
  const text = String(rhs || '').trim();
  if (!text) {
    return false;
  }
  // Sem chamada de funcao (parenteses), await, new, yield ou arrow: nesses casos
  // o lado direito pode ter efeito colateral e remover mudaria comportamento.
  if (/\(/.test(text)) {
    return false;
  }
  if (/\b(?:await|new|yield)\b/.test(text)) {
    return false;
  }
  if (/=>/.test(text)) {
    return false;
  }
  return true;
}

function buildUnusedVariableIssue(file, binding) {
  return {
    file,
    line: binding.line,
    severity: 'warning',
    kind: 'unused_variable',
    message: `Variavel '${binding.name}' declarada mas nao utilizada`,
    suggestion: 'Remova a variavel nao usada para reduzir ruido (o valor atribuido nao tem efeito colateral aparente).',
    snippet: '',
    action: { op: 'insert_before' },
  };
}

function isLineInFocus(focusRange, lineNumber) {
  if (!focusRange) {
    return true;
  }
  return lineNumber >= focusRange.start && lineNumber <= focusRange.end;
}

function isBindingReferenced(lines, binding) {
  const pattern = new RegExp(`\\b${escapeRegExp(binding.name)}\\b`);
  for (let index = 0; index < lines.length; index += 1) {
    if (binding.declarationLines.has(index)) {
      continue;
    }
    if (pattern.test(stripLineComment(lines[index], binding.commentPrefix))) {
      return true;
    }
  }
  return false;
}

function stripLineComment(line, commentPrefix) {
  const text = String(line || '');
  if (commentPrefix === '#') {
    const hashIndex = text.indexOf('#');
    return hashIndex >= 0 ? text.slice(0, hashIndex) : text;
  }
  const slashIndex = text.indexOf('//');
  return slashIndex >= 0 ? text.slice(0, slashIndex) : text;
}

function buildUnusedImportIssue(file, binding) {
  return {
    file,
    line: binding.line,
    severity: 'warning',
    kind: 'unused_import',
    message: `Import '${binding.name}' nao utilizado`,
    suggestion: 'Remova o import nao usado para reduzir ruido e dependencias mortas (verifique efeitos colaterais antes).',
    snippet: '',
    action: { op: 'insert_before' },
  };
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript
// ---------------------------------------------------------------------------

function collectJavaScriptImportBindings(lines) {
  const bindings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^import\b/.test(trimmed)) {
      const statement = readBlock(lines, index, /;|from\s+['"]/);
      const names = parseEsImportNames(statement.text);
      names.forEach((name) => bindings.push(makeBinding(name, index, statement.lineSet, '//')));
      index = statement.endIndex;
      continue;
    }

    const requireMatch = trimmed.match(/^(?:const|let|var)\s+(.+?)\s*=\s*require\s*\(/);
    if (requireMatch) {
      parseDestructuredNames(requireMatch[1]).forEach((name) => bindings.push(makeBinding(name, index, new Set([index]), '//')));
    }
  }
  return bindings;
}

function parseEsImportNames(statement) {
  // Ignora import puramente por efeito colateral: import 'mod';
  if (!/\bfrom\b/.test(statement) && !/^import\s+[A-Za-z_$]/.test(statement.trim())) {
    return [];
  }
  const names = [];
  const namespaceMatch = statement.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespaceMatch) {
    names.push(namespaceMatch[1]);
  }
  const defaultMatch = statement.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/);
  if (defaultMatch) {
    names.push(defaultMatch[1]);
  }
  const bracesMatch = statement.match(/\{([^}]*)\}/);
  if (bracesMatch) {
    parseDestructuredNames(bracesMatch[1]).forEach((name) => names.push(name));
  }
  return names.filter(Boolean);
}

function parseDestructuredNames(raw) {
  const inner = String(raw || '').replace(/[{}]/g, '');
  return inner
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => {
      const asMatch = token.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      if (asMatch) {
        return asMatch[1];
      }
      const nameMatch = token.match(/^([A-Za-z_$][\w$]*)/);
      return nameMatch ? nameMatch[1] : '';
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Python
// ---------------------------------------------------------------------------

function collectPythonImportBindings(lines) {
  const bindings = [];
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();

    const fromMatch = trimmed.match(/^from\s+[\w.]+\s+import\s+(.+)$/);
    if (fromMatch) {
      const statement = /\($/.test(trimmed.replace(/\s+$/, '')) || /\(/.test(fromMatch[1])
        ? readBlock(lines, index, /\)/)
        : { text: trimmed, endIndex: index, lineSet: new Set([index]) };
      const namesRaw = statement.text.replace(/^from\s+[\w.]+\s+import\s*/, '').replace(/[()]/g, '');
      parsePythonImportNames(namesRaw).forEach((name) => bindings.push(makeBinding(name, index, statement.lineSet, '#')));
      index = statement.endIndex;
      continue;
    }

    const importMatch = trimmed.match(/^import\s+(.+)$/);
    if (importMatch) {
      importMatch[1].split(',').forEach((part) => {
        const token = part.trim();
        const asMatch = token.match(/\bas\s+([A-Za-z_]\w*)/);
        const name = asMatch ? asMatch[1] : (token.split('.')[0] || '').trim();
        if (name && name !== '*') {
          bindings.push(makeBinding(name, index, new Set([index]), '#'));
        }
      });
    }
  }
  return bindings;
}

function parsePythonImportNames(raw) {
  return String(raw || '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token && token !== '*')
    .map((token) => {
      const asMatch = token.match(/\bas\s+([A-Za-z_]\w*)/);
      if (asMatch) {
        return asMatch[1];
      }
      const nameMatch = token.match(/^([A-Za-z_]\w*)/);
      return nameMatch ? nameMatch[1] : '';
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function readBlock(lines, startIndex, endPattern) {
  const lineSet = new Set([startIndex]);
  let text = lines[startIndex];
  if (endPattern.test(lines[startIndex])) {
    return { text, endIndex: startIndex, lineSet };
  }
  for (let index = startIndex + 1; index < lines.length && index < startIndex + 50; index += 1) {
    text += ` ${lines[index]}`;
    lineSet.add(index);
    if (endPattern.test(lines[index])) {
      return { text, endIndex: index, lineSet };
    }
  }
  return { text, endIndex: startIndex, lineSet };
}

function makeBinding(name, line, lineSet, commentPrefix) {
  return {
    name,
    line: line + 1,
    declarationLines: lineSet,
    commentPrefix,
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  checkUnusedImports,
  checkUnusedVariables,
};
