'use strict';

// Utilitarios de corpo de funcao compartilhados pelos checks de documentacao e
// escopo: reconhecimento de linha de declaracao de funcao, coleta das linhas do
// corpo (com forma inline `do:` e balanceamento do/end) e ultima linha
// significativa do corpo. Funcoes puras, par do function-signature.

const { countBlockDelta } = require('./support');
const { parseFunctionDeclaration } = require('./function-signature');

function isFunctionDeclarationLine(line) {
  const cleaned = String(line || '').trim();
  if (!cleaned) {
    return false;
  }
  return Boolean(parseFunctionDeclaration(line)) || /^defmodule\s+/.test(cleaned) || /^def(?:\b|p\b)/.test(cleaned);
}

function collectFunctionBodyLines(lines, startIdx) {
  const declarationLine = String(lines[startIdx] || '');
  const inlineMatch = declarationLine.match(/\bdo:\s*(.+)$/);
  if (inlineMatch && inlineMatch[1]) {
    return [inlineMatch[1]];
  }

  const bodyLines = [];
  let depth = countBlockDelta(declarationLine);
  if (depth <= 0) {
    return bodyLines;
  }

  for (let index = startIdx + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const delta = countBlockDelta(line);
    const closesCurrentBlock = depth === 1 && delta < 0 && /^end\b/.test(trimmed);
    if (!closesCurrentBlock) {
      bodyLines.push(line);
    }
    depth += delta;
  }

  return bodyLines;
}

function lastMeaningfulBodyLine(bodyLines) {
  for (let index = bodyLines.length - 1; index >= 0; index -= 1) {
    const trimmed = String(bodyLines[index] || '').trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    return trimmed;
  }
  return '';
}

module.exports = {
  isFunctionDeclarationLine,
  collectFunctionBodyLines,
  lastMeaningfulBodyLine,
};
