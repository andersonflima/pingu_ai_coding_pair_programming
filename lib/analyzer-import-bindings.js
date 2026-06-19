'use strict';

// Parsers puros de import bindings (JavaScript/TypeScript e Python), extraidos
// do analyzer para isolar o dominio de leitura de imports relativos usado na
// validacao de bindings inexistentes. Sao funcoes sem efeito colateral (apenas
// manipulacao de string); a resolucao de arquivos/exports e o cache permanecem
// no analyzer por dependerem de IO e de helpers de escopo.

const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');
const { splitTopLevelParams, stripInlineComment } = require('./support');

function supportsLocalImportBindingValidation(ext) {
  return isJavaScriptLikeExtension(ext) || isPythonLikeExtension(ext);
}

function parseLocalImportBindings(line, ext) {
  if (isJavaScriptLikeExtension(ext)) {
    return parseJavaScriptLocalImportBindings(line);
  }
  if (isPythonLikeExtension(ext)) {
    return parsePythonLocalImportBindings(line);
  }
  return null;
}

function parseJavaScriptLocalImportBindings(line) {
  const descriptor = parseJavaScriptImportBindingsSource(line);
  if (!descriptor || !isRelativeModuleSpecifier(descriptor.source)) {
    return null;
  }
  return descriptor;
}

function parseJavaScriptImportBindingsSource(line) {
  const sourceLine = String(line || '').replace(/\s+/g, ' ').trim();
  const namedImportMatch = sourceLine.match(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/);
  if (namedImportMatch && namedImportMatch[2]) {
    return {
      source: namedImportMatch[2],
      bindings: parseJavaScriptImportBindingList(namedImportMatch[1], 'esm'),
    };
  }

  const requireMatch = sourceLine.match(/^(?:const|let|var)\s*\{([^}]+)\}\s*=\s*require\(\s*['"]([^'"]+)['"]\s*\)/);
  if (requireMatch && requireMatch[2]) {
    return {
      source: requireMatch[2],
      bindings: parseJavaScriptImportBindingList(requireMatch[1], 'require'),
    };
  }

  return null;
}

function isPotentialJavaScriptImportStatementStart(line) {
  const content = String(line || '').trim();
  if (!content) {
    return false;
  }
  if (/^import\s*\{/.test(content)) {
    return true;
  }
  return /^(?:const|let|var)\s*\{/.test(content)
    && (!/=/.test(content) || /\brequire\s*\(/.test(content));
}

function readJavaScriptImportStatement(lines, startIdx) {
  const firstLine = String(stripInlineComment(String(lines[startIdx] || ''), '.js') || '');
  const directDescriptor = parseJavaScriptImportBindingsSource(firstLine);
  if (directDescriptor) {
    return {
      ...directDescriptor,
      endIdx: startIdx,
    };
  }
  if (!isPotentialJavaScriptImportStatementStart(firstLine)) {
    return null;
  }

  const statementLines = [firstLine];
  let endIdx = startIdx;

  while (endIdx + 1 < lines.length && endIdx - startIdx < 12) {
    endIdx += 1;
    const currentLine = String(stripInlineComment(String(lines[endIdx] || ''), '.js') || '');
    const trimmedLine = currentLine.trim();
    if (!trimmedLine) {
      return null;
    }
    statementLines.push(currentLine);
    const descriptor = parseJavaScriptImportBindingsSource(statementLines.join(' '));
    if (descriptor) {
      return {
        ...descriptor,
        endIdx,
      };
    }
    if (/;\s*$/.test(trimmedLine)) {
      break;
    }
  }

  return null;
}

function parseJavaScriptImportBindingList(raw, kind) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => parseJavaScriptImportBindingToken(token, kind))
    .filter((binding) => binding && binding.importedName);
}

function parseJavaScriptImportBindingToken(token, kind) {
  const normalized = String(token || '').trim();
  if (!normalized) {
    return null;
  }

  const match = kind === 'esm'
    ? normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/)
    : normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*:\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    importedName: match[1],
    localName: match[2] || match[1],
  };
}

function parsePythonLocalImportBindings(line) {
  const sourceLine = String(line || '').trim();
  const fromImportMatch = sourceLine.match(/^from\s+(\.+[A-Za-z0-9_\.]*)\s+import\s+(.+)$/);
  if (!fromImportMatch || !fromImportMatch[1] || !fromImportMatch[2]) {
    return null;
  }

  return {
    source: fromImportMatch[1],
    bindings: splitTopLevelParams(fromImportMatch[2])
      .map((token) => parsePythonImportBindingToken(token))
      .filter((binding) => binding && binding.importedName),
  };
}

function parsePythonImportBindingToken(token) {
  const normalized = String(token || '').trim();
  if (!normalized || normalized === '*') {
    return null;
  }

  const match = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?$/);
  if (!match || !match[1]) {
    return null;
  }

  return {
    importedName: match[1],
    localName: match[2] || match[1],
  };
}

function isRelativeModuleSpecifier(source) {
  return String(source || '').trim().startsWith('.');
}

module.exports = {
  supportsLocalImportBindingValidation,
  parseLocalImportBindings,
  parseJavaScriptImportBindingsSource,
  isPotentialJavaScriptImportStatementStart,
  readJavaScriptImportStatement,
  parseJavaScriptImportBindingList,
  parseJavaScriptImportBindingToken,
  parsePythonLocalImportBindings,
  parsePythonImportBindingToken,
  isRelativeModuleSpecifier,
};
