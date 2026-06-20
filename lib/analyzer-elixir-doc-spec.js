'use strict';

// Checks de documentacao e @spec de Elixir: resolve o range de @doc/@spec
// acima de uma funcao (incluindo comentarios de manutencao gerados), detecta
// doc/@spec desatualizados frente a assinatura atual, e infere o contexto de
// spec (tipos de parametro e retorno). Cluster leaf, fechado sob support,
// function-body, function-signature, function-metadata, language-profiles e
// analyzer-options.

const path = require('path');
const { escapeRegExp, sanitizeIdentifier, splitTopLevelParams, snippetFunctionSpec } = require('./support');
const { isFunctionDeclarationLine, collectFunctionBodyLines, lastMeaningfulBodyLine } = require('./function-body');
const { readElixirFunctionDeclaration } = require('./function-signature');
const { buildFunctionIssueMetadata } = require('./function-metadata');
const { isElixirExtension } = require('./language-profiles');
const { intersectsFocusRange } = require('./analyzer-options');

function resolveElixirAnnotationRange(lines, declarationIdx, annotationName) {
  const targetAnnotation = String(annotationName || '').trim();
  const annotationPattern = new RegExp(`^\\s*${escapeRegExp(targetAnnotation)}\\b`);
  const maxLookback = 60;
  const declarationIndex = Number.isFinite(declarationIdx) ? declarationIdx : -1;

  for (let idx = declarationIndex - 1; idx >= 0 && idx >= declarationIndex - maxLookback; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();

    if (!trimmed) {
      continue;
    }
    if (isFunctionDeclarationLine(rawLine)) {
      return null;
    }
    if (/^\s*#/.test(trimmed)) {
      continue;
    }

    if (annotationPattern.test(trimmed)) {
      return resolveElixirAnnotationRangeFromStart(lines, idx, targetAnnotation);
    }

    if (/^\s*@/i.test(trimmed)) {
      continue;
    }

    if (!/"""/.test(trimmed)) {
      return null;
    }

    for (let cursor = idx - 1; cursor >= 0; cursor -= 1) {
      const docLine = String(lines[cursor] || '');
      const docTrimmed = docLine.trim();
      if (!docTrimmed) {
        continue;
      }
      if (isFunctionDeclarationLine(docLine)) {
        return null;
      }
      if (/^\s*#/.test(docTrimmed)) {
        continue;
      }
      if (annotationPattern.test(docTrimmed)) {
        return resolveElixirAnnotationRangeFromStart(lines, cursor, targetAnnotation);
      }
      if (/^\s*@/.test(docTrimmed)) {
        break;
      }
    }
  }

  return null;
}

function resolveElixirAnnotationRangeFromStart(lines, startLine, annotationName) {
  const normalizedAnnotation = String(annotationName || '').trim();
  const safeStart = Math.max(0, Math.min(Number.isFinite(startLine) ? startLine : 0, lines.length - 1));

  if (!normalizedAnnotation) {
    return null;
  }

  const annotationLine = String(lines[safeStart] || '');
  if (!annotationLine.trim()) {
    return null;
  }

  if (normalizedAnnotation === '@doc') {
    const lineText = String(lines[safeStart] || '');
    if ((lineText.match(/"""/g) || []).length >= 2) {
      return extendElixirDocRangeWithMaintenanceComments(lines, {
        startLine: safeStart,
        endLine: safeStart,
      });
    }
    if (lineText.includes('"""')) {
      for (let end = safeStart + 1; end < lines.length; end += 1) {
        if (String(lines[end] || '').includes('"""')) {
          return extendElixirDocRangeWithMaintenanceComments(lines, {
            startLine: safeStart,
            endLine: end,
          });
        }
      }
    }
    return extendElixirDocRangeWithMaintenanceComments(lines, {
      startLine: safeStart,
      endLine: safeStart,
    });
  }

  if (normalizedAnnotation === '@spec') {
    for (let end = safeStart; end < Math.min(lines.length, safeStart + 20); end += 1) {
      if (String(lines[end] || '').includes('::')) {
        return { startLine: safeStart, endLine: end };
      }
    }
    return { startLine: safeStart, endLine: safeStart };
  }

  return { startLine: safeStart, endLine: safeStart };
}

function isElixirGeneratedFunctionMaintenanceComment(line) {
  return /^\s*#\s*(?:Func(?:ao|a[oã])|Argumentos?|Parametros?|Retorno|Contrato)\b/i
    .test(String(line || ''));
}

function extendElixirDocRangeWithMaintenanceComments(lines, range) {
  if (!range || !Number.isInteger(range.endLine)) {
    return range;
  }

  let cursor = range.endLine + 1;
  let candidateEndLine = range.endLine;
  let hasGeneratedComment = false;

  while (cursor < lines.length) {
    const line = String(lines[cursor] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      candidateEndLine = cursor;
      cursor += 1;
      continue;
    }
    if (/^\s*@spec\b/.test(line) || isFunctionDeclarationLine(line)) {
      break;
    }
    if (!isElixirGeneratedFunctionMaintenanceComment(line)) {
      break;
    }

    hasGeneratedComment = true;
    candidateEndLine = cursor;
    cursor += 1;
  }

  return hasGeneratedComment
    ? { ...range, endLine: candidateEndLine }
    : range;
}

function buildElixirAnnotationRangeLines(lines, range) {
  if (!range || !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine)) {
    return [];
  }

  const from = Math.max(0, range.startLine);
  const to = Math.min(lines.length - 1, range.endLine);
  if (to < from) {
    return [];
  }

  return lines.slice(from, to + 1);
}

function parseElixirFunctionDocArgumentNames(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  let inArgumentsSection = false;
  let hasArgumentsSection = false;
  let hasNoArgsPlaceholder = false;
  const argNames = [];

  for (let idx = 0; idx < lines.length; idx += 1) {
    const trimmed = String(lines[idx] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/^##\s*(?:Argumentos|Parametros)\b/i.test(trimmed)) {
      inArgumentsSection = true;
      hasArgumentsSection = true;
      continue;
    }
    if (inArgumentsSection && /^##\s*/.test(trimmed)) {
      inArgumentsSection = false;
      continue;
    }
    if (!inArgumentsSection) {
      continue;
    }
    if (/^(?:[-*])\s*Nenhum argumento recebido\./i.test(trimmed)) {
      hasNoArgsPlaceholder = true;
      continue;
    }

    const argMatch = trimmed.match(/^(?:[-*])\s*`?([a-z_][a-zA-Z0-9_?!]*)`?\s*:/i);
    if (argMatch && argMatch[1]) {
      argNames.push(sanitizeIdentifier(argMatch[1]));
    }
  }

  return {
    argNames,
    hasArgumentsSection,
    hasNoArgsPlaceholder,
  };
}

function parseElixirFunctionDocDeclaredName(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  const summaryPattern = /\b(?:comportamento|tratamento|fluxo|etapa)\s+principal\s+de\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\b/i;
  const fallbackPattern = /\bfunc(?:ao|a[oã])\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\b/i;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = String(lines[idx] || '').trim();
    if (!line) {
      continue;
    }
    const summaryMatch = line.match(summaryPattern);
    if (summaryMatch && summaryMatch[1]) {
      return sanitizeIdentifier(summaryMatch[1]);
    }
    const fallbackMatch = line.match(fallbackPattern);
    if (fallbackMatch && fallbackMatch[1]) {
      return sanitizeIdentifier(fallbackMatch[1]);
    }
  }

  return '';
}

function parseElixirFunctionDocReferencedNames(docLines) {
  const lines = Array.isArray(docLines) ? docLines : [];
  const referenced = new Set();
  const patterns = [
    /@spec\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(/ig,
    /\bfunc(?:ao|a[oã])\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\s*:/ig,
    /\b(?:principal\s+de|produzid[oa]\s+por|contrato\s+de|fluxo\s+de)\s+`?([a-z_][a-zA-Z0-9_?!]*)`?\b/ig,
  ];

  lines.forEach((rawLine) => {
    const line = String(rawLine || '');
    patterns.forEach((pattern) => {
      pattern.lastIndex = 0;
      let match = pattern.exec(line);
      while (match) {
        if (match[1]) {
          referenced.add(sanitizeIdentifier(match[1]));
        }
        match = pattern.exec(line);
      }
    });
  });

  return referenced;
}

function parseElixirFunctionSpecSignatureFromRange(lines, range) {
  const annotationLines = buildElixirAnnotationRangeLines(lines, range);
  const signatureSource = annotationLines.join(' ').trim();
  if (!signatureSource) {
    return null;
  }

  const match = signatureSource.match(/^\s*@spec\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(([\s\S]*?)\)\s*::/i);
  if (!match) {
    return null;
  }

  return {
    name: sanitizeIdentifier(match[1]),
    paramArity: splitTopLevelParams(match[2]).length,
  };
}

function isElixirFunctionDocOutdated(docRange, declaration, lines = []) {
  if (!docRange) {
    return false;
  }
  const contextLines = Array.isArray(lines) ? lines : [];
  const docLines = buildElixirAnnotationRangeLines(contextLines, docRange);
  const parsedDoc = parseElixirFunctionDocArgumentNames(docLines);
  const declaredDocName = parseElixirFunctionDocDeclaredName(docLines);
  const referencedNames = parseElixirFunctionDocReferencedNames(docLines);
  const declarationName = sanitizeIdentifier(declaration.name);
  const expectedArgCount = Number.isInteger(declaration.paramArity)
    ? declaration.paramArity
    : declaration.params.length;
  if (declaredDocName && declaredDocName !== declarationName) {
    return true;
  }
  if (Array.from(referencedNames).some((referencedName) => referencedName !== declarationName)) {
    return true;
  }

  if (expectedArgCount === 0) {
    return !(
      parsedDoc.hasArgumentsSection
      && parsedDoc.hasNoArgsPlaceholder
      && parsedDoc.argNames.length === 0
    );
  }

  if (!parsedDoc.hasArgumentsSection) {
    return true;
  }
  if (parsedDoc.argNames.length !== expectedArgCount) {
    return true;
  }

  return parsedDoc.argNames.some((argumentName, index) =>
    argumentName !== sanitizeIdentifier(declaration.params[index] || argumentName),
  );
}

function isElixirFunctionSpecOutdated(specRange, declaration, lines = []) {
  if (!specRange) {
    return false;
  }
  const contextLines = Array.isArray(lines) ? lines : [];
  const parsedSpec = parseElixirFunctionSpecSignatureFromRange(contextLines, specRange);
  if (!parsedSpec) {
    return false;
  }

  return parsedSpec.name !== declaration.name
    || parsedSpec.paramArity !== declaration.paramArity;
}

function resolveElixirFunctionSpecRangeForDeclaration(lines, declarationIdx, declaration) {
  const declarationName = sanitizeIdentifier(declaration && declaration.name || '');
  const declarationArity = Number.isInteger(declaration && declaration.paramArity)
    ? declaration.paramArity
    : Array.isArray(declaration && declaration.params) ? declaration.params.length : 0;

  if (!declarationName) {
    return null;
  }

  const specCandidates = [];
  const maxLookback = 80;
  for (let idx = declarationIdx - 1; idx >= 0 && idx >= declarationIdx - maxLookback; idx -= 1) {
    const rawLine = String(lines[idx] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }
    if (isFunctionDeclarationLine(rawLine)) {
      break;
    }
    if (/^\s*#/.test(rawLine)) {
      continue;
    }
    if (/^\s*@spec\b/.test(rawLine)) {
      const range = resolveElixirAnnotationRangeFromStart(lines, idx, '@spec');
      if (!range) {
        continue;
      }
      const parsed = parseElixirFunctionSpecSignatureFromRange(lines, range);
      specCandidates.push({
        range,
        parsed,
      });
      idx = Math.max(0, range.startLine - 1);
      continue;
    }
    if (/^\s*@/.test(rawLine) || /"""/.test(rawLine)) {
      continue;
    }
    break;
  }

  if (specCandidates.length === 0) {
    return null;
  }

  const exactMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && candidate.parsed.name === declarationName
    && Number(candidate.parsed.paramArity) === declarationArity);
  if (exactMatch) {
    return exactMatch.range;
  }

  const nameMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && candidate.parsed.name === declarationName);
  if (nameMatch) {
    return nameMatch.range;
  }

  const arityMatch = specCandidates.find((candidate) =>
    candidate
    && candidate.parsed
    && Number(candidate.parsed.paramArity) === declarationArity);
  if (arityMatch) {
    return arityMatch.range;
  }

  if (specCandidates.length === 1) {
    return specCandidates[0].range;
  }

  return null;
}

function collectLeadingElixirAnnotationsAbove(lines, idx) {
  const annotations = {
    doc: false,
    moduledoc: false,
    spec: false,
  };

  for (let i = idx - 1; i >= 0; i -= 1) {
    const currentLine = String(lines[i] || '');
    const current = currentLine.trim();
    if (!current) {
      continue;
    }
    if (isFunctionDeclarationLine(currentLine)) {
      return annotations;
    }
    if (/^\s*#/.test(currentLine)) {
      continue;
    }
    if (/^\s*@spec\b/.test(currentLine)) {
      annotations.spec = true;
      continue;
    }
    if (/^\s*@doc\b/.test(currentLine)) {
      annotations.doc = true;
      continue;
    }
    if (/^\s*@moduledoc\b/.test(currentLine)) {
      annotations.moduledoc = true;
      continue;
    }
    if (/"""/.test(currentLine)) {
      for (let cursor = i - 1; cursor >= 0; cursor -= 1) {
        const blockLine = String(lines[cursor] || '');
        const blockTrimmed = blockLine.trim();
        if (!blockTrimmed) {
          continue;
        }
        if (/^\s*@doc\b/.test(blockLine)) {
          annotations.doc = true;
          i = cursor;
          break;
        }
        if (/^\s*@moduledoc\b/.test(blockLine)) {
          annotations.moduledoc = true;
          i = cursor;
          break;
        }
        if (isFunctionDeclarationLine(blockLine)) {
          return annotations;
        }
      }
      continue;
    }
    return annotations;
  }

  return annotations;
}

function checkFunctionSpecs(lines, file, opts = {}) {
  const ext = path.extname(file);
  if (!isElixirExtension(ext)) {
    return [];
  }

  const issues = [];
  const seenSignatures = new Set();
  const focusRange = opts.focusRange || null;
  for (let idx = 0; idx < lines.length; idx += 1) {
    const declaration = readElixirFunctionDeclaration(lines, idx);
    if (!declaration || declaration.visibility !== 'def') {
      continue;
    }
    if (!intersectsFocusRange(focusRange, idx + 1, declaration.endIdx + 1)) {
      idx = declaration.endIdx;
      continue;
    }

    const paramCount = Number.isInteger(declaration.paramArity)
      ? declaration.paramArity
      : declaration.params.length;
    const signatureKey = `${sanitizeIdentifier(declaration.name)}/${Math.max(0, paramCount)}`;
    if (seenSignatures.has(signatureKey)) {
      idx = declaration.endIdx;
      continue;
    }
    seenSignatures.add(signatureKey);

    const specParams = Array.from({ length: Math.max(0, paramCount) }, (_unused, index) =>
      declaration.params[index] || `arg${index + 1}`,
    );

    const annotationRange = resolveElixirFunctionSpecRangeForDeclaration(lines, idx, declaration);
    if (annotationRange) {
      if (isElixirFunctionSpecOutdated(annotationRange, declaration, lines)) {
        issues.push({
          file,
          line: annotationRange.startLine + 1,
          severity: 'warning',
          kind: 'function_spec',
          message: `Especificacao @spec desatualizada para ${declaration.name}`,
          suggestion: 'Atualize a assinatura da @spec para refletir a aridade da funcao.',
          snippet: snippetFunctionSpec(
            declaration.name,
            specParams,
            ext,
            inferFunctionSpecContext(lines, idx, declaration, ext),
          ),
          metadata: buildFunctionIssueMetadata(lines, idx, declaration, ext),
          action: {
            op: 'replace_range',
            range: {
              start: {
                line: annotationRange.startLine,
                character: 0,
              },
              end: {
                line: annotationRange.endLine + 1,
                character: 0,
              },
            },
          },
        });
      }
      idx = declaration.endIdx;
      continue;
    }

    issues.push({
      file,
      line: idx + 1,
      severity: 'info',
      kind: 'function_spec',
      message: `Especificacao @spec ausente para ${declaration.name}`,
      suggestion: 'Declare @spec para contrato da funcao e facilitar validação de dominio.',
      snippet: snippetFunctionSpec(
        declaration.name,
        specParams,
        ext,
        inferFunctionSpecContext(lines, idx, declaration, ext),
      ),
    });
    idx = declaration.endIdx;
  }
  return issues;
}

function inferFunctionSpecContext(lines, startIdx, declaration, ext) {
  if (!['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
    return {};
  }

  const bodyLines = collectFunctionBodyLines(lines, startIdx);
  const bodyText = bodyLines.join('\n');
  return {
    returnType: inferElixirReturnType(bodyText, bodyLines),
    paramTypes: inferElixirParamTypes(bodyText, declaration.params),
  };
}

function inferElixirParamTypes(bodyText, params) {
  const safeParams = Array.isArray(params) ? params : [];
  return safeParams.map((param) => {
    const safeParam = escapeRegExp(String(param || ''));
    if (!safeParam) {
      return 'term()';
    }
    if (new RegExp(`\\b${safeParam}\\b\\s*\\.\\.|\\.\\.\\s*\\b${safeParam}\\b`).test(bodyText)) {
      return 'integer()';
    }
    return 'term()';
  });
}

function inferElixirReturnType(bodyText, bodyLines) {
  const lastLine = lastMeaningfulBodyLine(bodyLines);

  const diceMatch = bodyText.match(/\bEnum\.random\(\s*1\s*\.\.\s*(\d+)\s*\)/);
  if (diceMatch) {
    return 'integer()';
  }
  if (/\bEnum\.map\(/.test(bodyText) || /^\s*\[.*\]\s*$/.test(lastLine)) {
    return 'list(any())';
  }
  if (/^\s*(true|false)\s*$/.test(lastLine)) {
    return 'boolean()';
  }
  if (/^\s*".*"\s*$/.test(lastLine)) {
    return 'String.t()';
  }
  if (/^\s*%{/.test(lastLine)) {
    return 'map()';
  }
  if (/^\s*\{:ok,/.test(lastLine) || /^\s*\{:error,/.test(lastLine)) {
    return '{:ok, term()} | {:error, term()}';
  }
  if (/^\s*\d+\s*$/.test(lastLine)) {
    return 'integer()';
  }
  return 'term()';
}

module.exports = {
  buildElixirAnnotationRangeLines,
  checkFunctionSpecs,
  collectLeadingElixirAnnotationsAbove,
  extendElixirDocRangeWithMaintenanceComments,
  inferElixirParamTypes,
  inferElixirReturnType,
  inferFunctionSpecContext,
  isElixirFunctionDocOutdated,
  isElixirFunctionSpecOutdated,
  isElixirGeneratedFunctionMaintenanceComment,
  parseElixirFunctionDocArgumentNames,
  parseElixirFunctionDocDeclaredName,
  parseElixirFunctionDocReferencedNames,
  parseElixirFunctionSpecSignatureFromRange,
  resolveElixirAnnotationRange,
  resolveElixirAnnotationRangeFromStart,
  resolveElixirFunctionSpecRangeForDeclaration,
};
