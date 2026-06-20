'use strict';

// Metadados cross-language de funcao para os checks de documentacao/spec:
// resolve o fim da declaracao, coleta as linhas do corpo, infere a expressao
// de retorno e a classe Python envolvente, e monta o metadata consumido pelos
// checks de doc. Cluster leaf, fechado sob support, language-profiles e
// python-signature.

const { countMatches, leadingIndentLength } = require('./support');
const { isPythonLikeExtension, isJavaScriptLikeExtension, isGoExtension, isRustExtension } = require('./language-profiles');
const { parsePythonClassDeclaration, readPythonFunctionDeclaration } = require('./python-signature');

function collectCrossLanguageFunctionBodyLines(lines, startIdx, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isPythonLikeExtension(lowerExt)) {
    const declarationLine = String(lines[startIdx] || '');
    const baseIndent = (declarationLine.match(/^\s*/) || [''])[0].length;
    const bodyLines = [];
    for (let index = startIdx + 1; index < lines.length; index += 1) {
      const currentLine = String(lines[index] || '');
      const trimmed = currentLine.trim();
      if (!trimmed) {
        bodyLines.push(currentLine);
        continue;
      }
      const currentIndent = (currentLine.match(/^\s*/) || [''])[0].length;
      if (currentIndent <= baseIndent) {
        break;
      }
      bodyLines.push(currentLine);
    }
    return bodyLines;
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    const declarationLine = String(lines[startIdx] || '');
    const inlineReturn = extractInlineJavaScriptReturnLine(declarationLine);
    if (inlineReturn) {
      return [inlineReturn];
    }

    const expressionBody = declarationLine.match(/=>\s*(.+?)\s*;?\s*$/);
    if (expressionBody && countMatches(/\{/g, declarationLine) === 0) {
      return [`return ${expressionBody[1].trim()};`];
    }
  }

  if (isJavaScriptLikeExtension(lowerExt) || isGoExtension(lowerExt) || isRustExtension(lowerExt) || ['.c', '.h', '.sh'].includes(lowerExt)) {
    const bodyLines = [];
    let depth = countMatches(/\{/g, String(lines[startIdx] || '')) - countMatches(/\}/g, String(lines[startIdx] || ''));
    for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
      const currentLine = String(lines[index] || '');
      bodyLines.push(currentLine);
      depth += countMatches(/\{/g, currentLine) - countMatches(/\}/g, currentLine);
    }
    return bodyLines;
  }

  return [];
}

function extractInlineJavaScriptReturnLine(line) {
  const source = String(line || '').trim();
  const match = source.match(/\{\s*return\s+(.+?)\s*;?\s*\}\s*;?$/);
  if (!match || !match[1]) {
    return '';
  }
  return `return ${match[1].trim()};`;
}

function inferCrossLanguageReturnExpression(bodyLines, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const returnLine = Array.isArray(bodyLines)
    ? bodyLines.find((line) => {
      const normalized = String(line || '').trim();
      if (!normalized) {
        return false;
      }
      if (isPythonLikeExtension(lowerExt)) {
        return /^return\b/.test(normalized);
      }
      return /\breturn\b/.test(normalized);
    })
    : '';
  if (!returnLine) {
    return '';
  }

  if (isPythonLikeExtension(lowerExt)) {
    const match = String(returnLine).match(/^\s*return\s+(.+?)\s*$/);
    return match && match[1] ? match[1].trim() : '';
  }

  const match = String(returnLine).match(/\breturn\s+([^;]+);?/);
  return match && match[1] ? match[1].trim() : '';
}

function buildFunctionIssueMetadata(lines, startIdx, declaration, ext) {
  const declarationEndIdx = resolveFunctionDeclarationEndIdx(lines, startIdx, ext);
  const bodyPreview = collectCrossLanguageFunctionBodyLines(lines, startIdx, ext)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .slice(0, 6);

  return {
    symbolName: declaration && declaration.name ? declaration.name : '',
    declarationStartLine: startIdx + 1,
    declarationEndLine: declarationEndIdx + 1,
    signaturePreview: lines.slice(startIdx, declarationEndIdx + 1).map((line) => String(line || '')),
    params: Array.isArray(declaration && declaration.params) ? declaration.params : [],
    paramDescriptors: Array.isArray(declaration && declaration.paramDescriptors) ? declaration.paramDescriptors : [],
    decorators: Array.isArray(declaration && declaration.decorators) ? declaration.decorators : [],
    decoratorStartLine: Number(declaration && declaration.decoratorStartIdx) >= 0 ? Number(declaration.decoratorStartIdx) + 1 : undefined,
    returnAnnotation: String(declaration && declaration.returnAnnotation || ''),
    returnExpression: inferCrossLanguageReturnExpression(bodyPreview, ext),
    bodyPreview,
    enclosingClassName: isPythonLikeExtension(ext) ? findEnclosingPythonClassName(lines, startIdx) : '',
  };
}

function resolveFunctionDeclarationEndIdx(lines, startIdx, ext) {
  if (isPythonLikeExtension(ext)) {
    const declaration = readPythonFunctionDeclaration(lines, startIdx);
    if (declaration) {
      return declaration.endIdx;
    }
  }
  return startIdx;
}

function findEnclosingPythonClassName(lines, idx) {
  const currentIndent = leadingIndentLength(lines[idx] || '');
  for (let cursor = idx; cursor >= 0; cursor -= 1) {
    const rawLine = String(lines[cursor] || '');
    const className = parsePythonClassDeclaration(rawLine);
    if (!className) {
      continue;
    }
    if (leadingIndentLength(rawLine) < currentIndent) {
      return className;
    }
  }
  return '';
}

module.exports = {
  buildFunctionIssueMetadata,
  collectCrossLanguageFunctionBodyLines,
  extractInlineJavaScriptReturnLine,
  findEnclosingPythonClassName,
  inferCrossLanguageReturnExpression,
  resolveFunctionDeclarationEndIdx,
};
