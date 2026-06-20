'use strict';

// Parsing de declaracao de funcao/classe Python (incluindo decorators e a
// forma multilinha de assinatura) e descritores de parametros genericos
// cross-language. Cluster leaf, fechado sob utilitarios de support,
// language-profiles e o stripper de sintaxe inline de Python.

const { leadingIndentLength, countMatches, splitTopLevelParams, sanitizeIdentifier } = require('./support');
const { stripPythonInlineSyntax } = require('./python-scope-utils');
const { isJavaScriptLikeExtension, isPythonLikeExtension, isGoExtension, isRustExtension } = require('./language-profiles');

function readPythonFunctionDeclaration(lines, startIdx) {
  const firstLine = String(lines[startIdx] || '');
  if (!/^\s*(?:async\s+)?def\b/.test(firstLine)) {
    return null;
  }

  const baseIndent = leadingIndentLength(firstLine);
  const decoratorInfo = collectPythonLeadingDecorators(lines, startIdx);
  const signatureLines = [firstLine];
  let endIdx = startIdx;
  let parenDepth = countPythonSignatureParenDelta(firstLine);
  let hasTrailingColon = pythonSignatureHasTrailingColon(firstLine) && parenDepth <= 0;

  while ((parenDepth > 0 || !hasTrailingColon) && endIdx + 1 < lines.length) {
    endIdx += 1;
    const currentLine = String(lines[endIdx] || '');
    signatureLines.push(currentLine);
    parenDepth += countPythonSignatureParenDelta(currentLine);
    if (parenDepth <= 0 && pythonSignatureHasTrailingColon(currentLine)) {
      hasTrailingColon = true;
    }
  }

  const parsed = parsePythonFunctionDeclarationSource(signatureLines.join(' '));
  if (!parsed) {
    return null;
  }

  return {
    ...parsed,
    baseIndent,
    decorators: decoratorInfo.decorators,
    decoratorStartIdx: decoratorInfo.decoratorStartIdx,
    endIdx,
  };
}

function parsePythonFunctionDeclarationSource(source) {
  const normalized = String(source || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/^(?:async\s+)?def\s+([a-z_][a-zA-Z0-9_]*)\s*\((.*)\)\s*(?:->\s*([^:]+))?\s*:/);
  if (!match || !match[1]) {
    return null;
  }

  const paramDescriptors = parseGenericParamDescriptors(match[2] || '', '.py');
  return {
    name: sanitizeIdentifier(match[1]),
    params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
    paramDescriptors,
    returnAnnotation: String(match[3] || '').trim(),
  };
}

function pythonSignatureHasTrailingColon(line) {
  return /:\s*$/.test(stripPythonInlineSyntax(line).trim());
}

function countPythonSignatureParenDelta(line) {
  const stripped = stripPythonInlineSyntax(line);
  return countMatches(/\(/g, stripped) - countMatches(/\)/g, stripped);
}

function parsePythonDecoratorName(line) {
  const match = String(line || '').trim().match(/^@([A-Za-z_][A-Za-z0-9_\.]*)/);
  if (!match || !match[1]) {
    return '';
  }
  const segments = String(match[1] || '').split('.');
  return sanitizeIdentifier(segments[segments.length - 1] || '');
}

function collectPythonLeadingDecorators(lines, startIdx) {
  const baseIndent = leadingIndentLength(lines[startIdx] || '');
  const decorators = [];
  let decoratorStartIdx = startIdx;

  for (let idx = startIdx - 1; idx >= 0; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      break;
    }
    if (leadingIndentLength(rawLine) !== baseIndent || !/^@/.test(trimmed)) {
      break;
    }
    decorators.unshift(parsePythonDecoratorName(trimmed));
    decoratorStartIdx = idx;
  }

  return {
    decorators: decorators.filter(Boolean),
    decoratorStartIdx,
  };
}

function parsePythonClassDeclaration(line) {
  const match = String(line || '').match(/^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
  return match && match[1] ? sanitizeIdentifier(match[1]) : '';
}

function parseGenericParamDescriptors(raw, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  return splitTopLevelParams(String(raw || ''))
    .map((token) => String(token).trim())
    .filter(Boolean)
    .map((token) => {
      const baseDescriptor = {
        isOptional: isGenericFunctionParamOptional(token, lowerExt),
        isVariadic: isGenericFunctionParamVariadic(token, lowerExt),
      };
      if (isGoExtension(lowerExt)) {
        const parts = token.split(/\s+/).filter(Boolean);
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(parts[0] || ''),
          annotation: parts.slice(1).join(' '),
        };
      }
      if (isRustExtension(lowerExt)) {
        const [name, annotation] = token.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isPythonLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (isJavaScriptLikeExtension(lowerExt)) {
        const withoutDefault = token.replace(/=.*/, '').replace(/^\.\.\./, '').trim();
        const [name, annotation] = withoutDefault.split(':');
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(name || ''),
          annotation: String(annotation || '').trim(),
        };
      }
      if (['.c', '.h'].includes(lowerExt)) {
        const compact = token.replace(/\s+/g, ' ').trim();
        if (compact === 'void') {
          return {
            ...baseDescriptor,
            name: '',
            annotation: 'void',
          };
        }
        const parts = compact.split(/\s+/).filter(Boolean);
        return {
          ...baseDescriptor,
          name: sanitizeIdentifier(parts[parts.length - 1] || ''),
          annotation: parts.slice(0, -1).join(' '),
        };
      }
      return {
        ...baseDescriptor,
        name: sanitizeIdentifier(token),
        annotation: '',
      };
    })
    .filter((descriptor) => descriptor.name);
}

function isGenericFunctionParamOptional(token, ext) {
  const source = String(token || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!source) {
    return false;
  }
  if (isJavaScriptLikeExtension(lowerExt) || isPythonLikeExtension(lowerExt) || ['.rb', '.vim', '.lua'].includes(lowerExt)) {
    return /=/.test(source) || /\?\s*(?::|=|$)/.test(source);
  }
  return false;
}

function isGenericFunctionParamVariadic(token, ext) {
  const source = String(token || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!source) {
    return false;
  }
  if (isJavaScriptLikeExtension(lowerExt) || lowerExt === '.lua') {
    return source.startsWith('...') || source === '...';
  }
  if (isPythonLikeExtension(lowerExt)) {
    return /^\*{1,2}/.test(source);
  }
  if (isGoExtension(lowerExt)) {
    return /\.\.\./.test(source);
  }
  if (isRustExtension(lowerExt)) {
    return false;
  }
  return source.includes('...');
}

module.exports = {
  collectPythonLeadingDecorators,
  countPythonSignatureParenDelta,
  isGenericFunctionParamOptional,
  isGenericFunctionParamVariadic,
  parseGenericParamDescriptors,
  parsePythonClassDeclaration,
  parsePythonDecoratorName,
  parsePythonFunctionDeclarationSource,
  pythonSignatureHasTrailingColon,
  readPythonFunctionDeclaration,
};
