'use strict';

// Checks de higiene de workspace, extraidos do analyzer para manter o arquivo
// principal menor e o dominio coeso: moduledoc ausente, linhas longas, saidas
// de debug, TODO/FIXME, linhas duplicadas consecutivas, espaco em branco final,
// tabs e arquivo grande. Comportamento preservado.

const path = require('path');
const { isJavaScriptLikeExtension, isPythonLikeExtension } = require('./language-profiles');
const { isLineInsideFocusRange } = require('./analyzer-options');
const {
  snippetModuledoc,
  snippetLongLine,
  snippetDebugOutput,
  snippetTodoFixme,
  snippetTrailingWhitespace,
  snippetTabs,
  snippetLargeFile,
  lineIndentation,
  isCommentLine,
} = require('./support');

function checkModuledoc(lines, file) {
  const moduleLine = lines.findIndex((line) => /^\s*defmodule\s+/.test(line));
  if (moduleLine < 0) {
    return [];
  }
  const hasPublicFunction = lines.some((line) => /^\s*def\s+[a-z_][a-zA-Z0-9_?!]*\s*(?:\(|do\b)/.test(String(line || '')));
  if (!hasPublicFunction) {
    return [];
  }
  const hasDoc = lines.some((line) => /^\s*@moduledoc\b/.test(line));
  if (hasDoc) {
    return [];
  }
  return [
    {
      file,
      line: moduleLine + 1,
      severity: 'warning',
      kind: 'moduledoc',
      message: 'Modulo sem @moduledoc',
      suggestion: 'Acrescente @moduledoc para explicar o contrato do modulo e facilitar manutencao.',
      snippet: snippetModuledoc(),
      action: { op: 'insert_after' },
    },
  ];
}

function checkLongLines(lines, file, maxLineLength) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.length > maxLineLength) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'long_line',
        message: `Linha com ${line.length} caracteres (limite ${maxLineLength})`,
        suggestion: 'Quebre a linha em passos menores para melhorar leitura e review.',
        snippet: snippetLongLine(line),
      });
    }
  });
  return issues;
}

function checkDebugOutputs(lines, file, opts = {}) {
  const issues = [];
  const ext = path.extname(file).toLowerCase();
  const focusRange = opts.focusRange || null;
  let pattern = /\b(?:IO\.puts|IO\.inspect|dbg)\b/;
  if (isJavaScriptLikeExtension(ext)) {
    pattern = /\b(?:console\.(?:log|debug|info|warn|error)|dbg)\s*\(/;
  } else if (isPythonLikeExtension(ext)) {
    pattern = /\b(?:print|pdb\.set_trace)\s*\(/;
  }
  lines.forEach((line, idx) => {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'error',
        kind: 'debug_output',
        message: 'Saida de debug detectada',
        suggestion: isJavaScriptLikeExtension(ext)
          ? 'Remova logs de debug e mantenha apenas o retorno previsto pelo contrato da funcao.'
          : isPythonLikeExtension(ext)
            ? 'Remova prints de debug e mantenha o retorno previsto pelo contrato da funcao.'
          : 'Substitua por Logger.debug/1 para rastreamento controlado em producao.',
        snippet: snippetDebugOutput(line),
      });
    }
  });
  return issues;
}

function checkTodoFixme(lines, file, opts = {}) {
  const issues = [];
  const pattern = /\b(TODO|FIXME)\b/i;
  const focusRange = opts.focusRange || null;
  lines.forEach((line, idx) => {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      return;
    }
    if (pattern.test(line)) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'todo_fixme',
        message: 'Marcador TODO/FIXME encontrado',
        suggestion: 'Use um ticket ou comentario estruturado (p.ex. TODO(#id): ) para facilitar rastreamento.',
        snippet: snippetTodoFixme(line),
      });
    }
  });
  return issues;
}

function isDuplicateConsecutiveCodeLineCandidate(previousLine, currentLine, ext) {
  const previousRaw = String(previousLine || '');
  const currentRaw = String(currentLine || '');
  const previousTrimmed = previousRaw.trim();
  const currentTrimmed = currentRaw.trim();

  if (!previousTrimmed || !currentTrimmed) {
    return false;
  }
  if (previousTrimmed !== currentTrimmed) {
    return false;
  }
  if (lineIndentation(previousRaw) !== lineIndentation(currentRaw)) {
    return false;
  }
  if (isCommentLine(previousRaw, ext) || isCommentLine(currentRaw, ext)) {
    return false;
  }
  if (/^[\[\](){}]+[,;:]?$/.test(currentTrimmed)) {
    return false;
  }
  if (/^(?:end|else|elif|except|finally|catch|rescue|do)$/i.test(currentTrimmed)) {
    return false;
  }
  if (/[,:]$/.test(currentTrimmed)) {
    return false;
  }

  return currentTrimmed.length >= 6;
}

function checkDuplicateConsecutiveLines(lines, file, opts = {}) {
  const ext = path.extname(file).toLowerCase();
  const focusRange = opts.focusRange || null;
  const issues = [];

  for (let idx = 1; idx < lines.length; idx += 1) {
    if (!isLineInsideFocusRange(focusRange, idx + 1)) {
      continue;
    }

    const previousLine = String(lines[idx - 1] || '');
    const currentLine = String(lines[idx] || '');
    if (!isDuplicateConsecutiveCodeLineCandidate(previousLine, currentLine, ext)) {
      continue;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'warning',
      kind: 'duplicate_line',
      message: 'Linha duplicada consecutiva detectada',
      suggestion: 'Remova a repeticao consecutiva para evitar efeito colateral e ruido no diff.',
      snippet: currentLine,
      metadata: {
        duplicateOfLine: idx,
      },
      action: { op: 'delete_line' },
    });
  }

  return issues;
}

function checkTrailingWhitespace(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.trimEnd() !== line) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'info',
        kind: 'trailing_whitespace',
        message: 'Espaco em branco no final da linha',
        suggestion: 'Remova espaco para reduzir ruido em diff e conflitos em revisoes.',
        snippet: snippetTrailingWhitespace(line),
      });
    }
  });
  return issues;
}

function checkTabs(lines, file) {
  const issues = [];
  lines.forEach((line, idx) => {
    if (line.includes('\t')) {
      issues.push({
        file,
        line: idx + 1,
        severity: 'warning',
        kind: 'tabs',
        message: 'Caracter de tab encontrado',
        suggestion: 'Use somente espacos para manter layout consistente com o formatter.',
        snippet: snippetTabs(line),
      });
    }
  });
  return issues;
}

function checkLargeFile(lines, file) {
  if (lines.length > 300) {
    return [{
      file,
      line: 1,
      severity: 'warning',
      kind: 'large_file',
      message: `Arquivo com ${lines.length} linhas`,
      suggestion: 'Considere separar responsabilidades em modulos menores.',
      snippet: snippetLargeFile(),
    }];
  }
  return [];
}

module.exports = {
  checkModuledoc,
  checkLongLines,
  checkDebugOutputs,
  checkTodoFixme,
  checkDuplicateConsecutiveLines,
  checkTrailingWhitespace,
  checkTabs,
  checkLargeFile,
};
