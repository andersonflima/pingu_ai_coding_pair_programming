'use strict';

const path = require('path');
const { snippetFunctionSpec, functionDescriptionFromName, safeComment, commentPrefix, sanitizeIdentifier, sanitizeNaturalIdentifier, escapeRegExp, buildMaintenanceComment, humanizeIdentifier } = require('./support');
const {
  goDependencySpec,
  inferModuleStyle,
  jsDependencySpec,
  pythonDependencySpec,
  rustDependencySpec,
} = require('./dependency-specs');
const {
  findUpwards,
  pathExists,
  resolveProjectRoot,
  toImportPath,
  toPosixPath,
  upwardDepth,
} = require('./project-paths');
const { parseSemanticCommentIntent, buildCommentIntentIR } = require('./comment-intent');
const { buildFollowUpInstruction } = require('./follow-up');
const {
  analysisExtension: resolveAnalysisExtension,
  bestPracticesFor,
  isJavaScriptLikeExtension: resolveJavaScriptLikeExtension,
  isReactLikeExtension: resolveReactLikeExtension,
  isPythonLikeExtension: resolvePythonLikeExtension,
  isRubyExtension: resolveRubyExtension,
  isElixirExtension: resolveElixirExtension,
  isGoExtension: resolveGoExtension,
  isRustExtension: resolveRustExtension,
  isMermaidExtension,
  supportsSlashComments,
  supportsHashComments,
} = require('./language-profiles');
const { buildOfflineLanguageGuidance, createLanguageSnippetLibrary } = require('./language-snippets');
const { getCapabilityProfile, supportsCommentTaskIntent } = require('./language-capabilities');
const { requiresAiForFeature, supportsEditorFeature } = require('./language-capabilities');
const { createGenerationOutputValidator } = require('./generation-output-validator');
const { createBlueprintTools } = require('./generation-blueprint');
const { createCommentTaskTools } = require('./generation-comment-task');
const { createDependencyTools } = require('./generation-dependencies');
const { createTerminalTaskTools } = require('./generation-terminal-task');
const { createStructuredGenerators } = require('./generation-structured');
const { createUiSnippetGenerator } = require('./generation-react');
const { createUnitTestCoverageChecker } = require('./generation-unit-tests');
const { loadProjectMemory } = require('./project-memory');
const { defaultActionForKind } = require('./issue-kinds');
const { resolveAiFeaturePolicy } = require('./ai-resolution-policy');
const { buildActionCommentContext } = require('./action-comment-context');
const { collectSourceSymbols, hasSourceSymbol } = require('./source-symbols');
const { createCopilotAiProvider } = require('./ai-provider-copilot');

const {
  generateStructuredConfigSnippet,
  generateStructureSnippet,
  parseVariableCorrectionRequest,
  structuredTaskAlreadyApplied,
} = createStructuredGenerators({
  sanitizeNaturalIdentifier,
  escapeRegExp,
  isInstructionNoiseToken,
  extractLiteralFromInstruction,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  toCamelCaseIdentifier,
  toSnakeCaseIdentifier,
});

const { validateGeneratedTaskResult } = createGenerationOutputValidator();

const generateUiSnippet = createUiSnippetGenerator({
  isReactLikeExtension,
  generateGenericSnippet,
  decorateGeneratedSnippet,
  inferModuleStyle,
  jsDependencySpec,
});

const {
  hasOpenAiConfiguration,
  resolveAiContextResolution,
  resolveAiGeneratedTask,
  resolveAiGeneratedUnitTests,
  resolveAiIssueFix,
} = createCopilotAiProvider();

const checkUnitTestCoverage = createUnitTestCoverageChecker({
  hasOpenAiConfiguration,
  loadActiveBlueprintContext: (...args) => loadActiveBlueprintContext(...args),
  resolveAiGeneratedUnitTests,
  sanitizeIdentifier,
  sanitizeNaturalIdentifier,
  escapeRegExp,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  isRubyExtension,
  resolveProjectRoot,
  findUpwards,
  pathExists,
  requiresAiForFeature,
  resolveAiFeaturePolicy,
  toPosixPath,
  toImportPath,
  upwardDepth,
  upperFirst,
});

const { deriveOfflineFunctionPlan } = createLanguageSnippetLibrary({
  inferInstructionExpression,
  extractLiteralFromInstruction,
  inferArithmeticOperator,
  extractArithmeticLiteral,
  inferRequestedParamCount,
  inferSingleParamName,
});

const { buildSnippetDependencyIssues, checkMissingDependencies } = createDependencyTools({
  escapeRegExp,
  inferModuleStyle,
  isGoExtension,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isRustExtension,
});

const { inferTerminalTaskAction } = createTerminalTaskTools({
  analysisExtension,
  isGoExtension,
  isPythonLikeExtension,
  isRubyExtension,
  isRustExtension,
  pathExists,
  resolveProjectRoot,
  safeComment,
});

const {
  buildContextBlueprintTasks,
  generateBlueprintAwareSnippet,
  loadActiveBlueprintContext,
} = createBlueprintTools({
  analysisExtension,
  buildOfflineLanguageGuidance,
  crudEntityNames,
  escapeRegExp,
  hasOpenAiConfiguration,
  generateCrudSnippet,
  isJavaScriptLikeExtension,
  jsDocBlock,
  parseCrudEntityName,
  pathExists,
  resolveAiContextResolution,
  resolveAiFeaturePolicy,
  resolveProjectRoot,
  sanitizeNaturalIdentifier,
  toImportPath,
  toPosixPath,
  upperFirst,
  mustUseAiForContextBlueprint: mustUseAiForCommentAction,
});

const { checkCommentTask } = createCommentTaskTools({
  analysisExtension,
  buildContextBlueprintTasks,
  buildSnippetDependencyIssues,
  commentTaskAlreadyApplied,
  inferTerminalTaskAction,
  isMermaidExtension,
  hasOpenAiConfiguration,
  normalizeGeneratedTaskResult,
  requiresAiForFeature,
  supportsEditorFeature,
  supportsHashComments,
  supportsSlashComments,
  synthesizeFromCommentTask,
  mustUseAiForCommentAction,
});

function mustUseAiForCommentAction() {
  return resolveAiFeaturePolicy('comment_task', process.env, {
    hasOpenAiConfiguration: hasOpenAiConfiguration(),
  }).mustUseAi;
}

function preferAiForCommentTask() {
  return resolveAiFeaturePolicy('comment_task', process.env, {
    hasOpenAiConfiguration: hasOpenAiConfiguration(),
  }).shouldUseAi;
}

function normalizeGeneratedTaskResult(result, ext = '') {
  let normalized = { snippet: '', dependencies: [] };
  let metadata = {};
  let disableMaintenanceComments = false;
  if (!result) {
    normalized = { snippet: '', dependencies: [] };
  } else if (typeof result === 'string') {
    normalized = { snippet: result, dependencies: [] };
  } else {
    metadata = { ...result };
    delete metadata.snippet;
    delete metadata.dependencies;
    disableMaintenanceComments = Boolean(result.disableMaintenanceComments);
    normalized = {
      snippet: String(result.snippet || ''),
      dependencies: Array.isArray(result.dependencies) ? result.dependencies : [],
    };
  }

  return {
    ...metadata,
    ...normalized,
    snippet: disableMaintenanceComments
      ? String(normalized.snippet || '')
      : addMaintenanceCommentsToSnippet(normalized.snippet, ext),
  };
}
function mapGeneratedTaskResultSnippet(result, mapper) {
  if (typeof mapper !== 'function') {
    return result;
  }

  if (typeof result === 'string') {
    return mapper(result);
  }

  if (!result || typeof result !== 'object') {
    return result;
  }

  return {
    ...result,
    snippet: mapper(String(result.snippet || '')),
  };
}
function commentTaskAlreadyApplied(lines, commentIndex, generatedTask, ext = '') {
  const generatedAction = generatedTask && typeof generatedTask === 'object'
    ? generatedTask.action || null
    : null;
  if (generatedAction && String(generatedAction.op || '') === 'write_file') {
    const currentContent = Array.isArray(lines) ? lines.join('\n').trim() : '';
    const targetContent = String(generatedTask && generatedTask.snippet || '').trim();
    return targetContent.length > 0 && currentContent === targetContent;
  }

  if (structuredTaskAlreadyApplied(lines, commentIndex, generatedTask, ext)) {
    return true;
  }

  const snippet = typeof generatedTask === 'string'
    ? generatedTask
    : String(generatedTask && generatedTask.snippet || '');
  const snippetSignificantLines = significantSnippetLines(snippet, ext);
  if (snippetSignificantLines.length === 0) {
    return false;
  }
  const signatureLines = extractGeneratedSignatureLines(snippet);
  if (signatureLines.length > 0) {
    const existingLines = new Set();
    for (let index = 0; index < lines.length; index += 1) {
      if (index === commentIndex) {
        continue;
      }
      existingLines.add(String(lines[index] || '').trim());
    }
    if (signatureLines.every((signatureLine) => existingLines.has(signatureLine))) {
      return true;
    }
  }

  const generatedSymbolNames = collectSourceSymbols(snippet, ext)
    .map((symbol) => symbol.name)
    .filter(Boolean);
  if (generatedSymbolNames.length > 0) {
    const sourceWithoutComment = lines.filter((_, index) => index !== commentIndex);
    return generatedSymbolNames.every((name) => hasSourceSymbol(sourceWithoutComment, ext, name));
  }

  const sourceSignificantLines = significantSourceLines(lines, commentIndex, ext);
  if (sourceSignificantLines.length === 0) {
    return false;
  }

  if (snippetSignificantLines.length === 1) {
    return hasSnippetPrefixMatch(sourceSignificantLines, snippetSignificantLines, 1);
  }

  return hasContiguousSnippetMatch(sourceSignificantLines, snippetSignificantLines);
}
function significantSnippetLines(snippet, ext = '') {
  return String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean)
    .filter((line) => !isGeneratedCommentLine(line, ext));
}
function significantSourceLines(lines = [], commentIndex = -1, ext = '') {
  return (Array.isArray(lines) ? lines : [])
    .filter((_, index) => index !== commentIndex)
    .map((line) => String(line || '').trim())
    .filter(Boolean)
    .filter((line) => !isGeneratedCommentLine(line, ext));
}
function hasSnippetPrefixMatch(sourceLines, snippetLines, prefixLength = 1) {
  const normalizedPrefixLength = Math.max(1, Math.min(prefixLength, snippetLines.length));
  if (sourceLines.length < normalizedPrefixLength) {
    return false;
  }

  for (let index = 0; index <= sourceLines.length - normalizedPrefixLength; index += 1) {
    let matches = true;
    for (let offset = 0; offset < normalizedPrefixLength; offset += 1) {
      if (sourceLines[index + offset] !== snippetLines[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}
function hasContiguousSnippetMatch(sourceLines, snippetLines) {
  if (!Array.isArray(sourceLines) || !Array.isArray(snippetLines) || snippetLines.length === 0) {
    return false;
  }
  if (sourceLines.length < snippetLines.length) {
    return false;
  }

  for (let index = 0; index <= sourceLines.length - snippetLines.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < snippetLines.length; offset += 1) {
      if (sourceLines[index + offset] !== snippetLines[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return true;
    }
  }

  return false;
}
function isGeneratedCommentLine(line, ext = '') {
  const trimmed = String(line || '').trim();
  const lowerExt = analysisExtension(ext);
  if (!trimmed) {
    return false;
  }
  if (lowerExt === '.md') {
    return /^<!--.*-->$/.test(trimmed);
  }
  return /^(?:\/\*\*|\/\*|\*\/|\*|\/\/|#|--|"|@doc\b|@spec\b|@moduledoc\b|"""|''')/.test(trimmed);
}
function hasLeadingSnippetComment(lines, ext = '') {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const trimmed = String(lines[index] || '').trim();
    if (!trimmed) {
      continue;
    }
    return isGeneratedCommentLine(trimmed, ext);
  }
  return false;
}
function addMaintenanceCommentsToSnippet(snippet, ext) {
  if (analysisExtension(ext) === '.md') {
    return String(snippet || '');
  }
  const sourceLines = String(snippet || '').split('\n');
  const resultLines = [];

  for (let index = 0; index < sourceLines.length; index += 1) {
    const line = String(sourceLines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      resultLines.push(line);
      continue;
    }

    if (!hasLeadingSnippetComment(resultLines, ext) && !isGeneratedCommentLine(line, ext)) {
      const comment = buildMaintenanceComment(line, ext, sourceLines.slice(index + 1, index + 4));
      if (comment) {
        resultLines.push(comment);
      }
    }

    resultLines.push(line);
  }

  return resultLines.join('\n');
}
function extractGeneratedSignatureLines(snippet) {
  const signatureLines = [];
  const lines = String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean);
  for (const line of lines) {
    if (
      /^def\s+[a-z_][a-zA-Z0-9_?!]*\s*\(/.test(line)
      || /^def\s+[a-z_][a-zA-Z0-9_?!]*\s*do\b/.test(line)
      || /^function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^export function\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^func\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
      || /^fn\s+[a-z_][a-zA-Z0-9_]*\s*\(/.test(line)
      || /^[A-Za-z_][A-Za-z0-9_]*\s*\(\)\s*\{$/.test(line)
      || /^function!?\s+(?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*\s*\(/.test(line)
    ) {
      signatureLines.push(line);
    }
  }
  return signatureLines;
}
function analysisExtension(fileOrExt) {
  return resolveAnalysisExtension(fileOrExt);
}
function isJavaScriptLikeExtension(ext) {
  return resolveJavaScriptLikeExtension(ext);
}
function isReactLikeExtension(ext) {
  return resolveReactLikeExtension(ext);
}
function isPythonLikeExtension(ext) {
  return resolvePythonLikeExtension(ext);
}
function isElixirExtension(ext) {
  return resolveElixirExtension(ext);
}
function isRubyExtension(ext) {
  return resolveRubyExtension(ext);
}
function isGoExtension(ext) {
  return resolveGoExtension(ext);
}
function isRustExtension(ext) {
  return resolveRustExtension(ext);
}
function isShellExtension(ext) {
  return ['.sh', '.bash', '.zsh'].includes(analysisExtension(ext));
}
function synthesizeFromCommentTask(instruction, ext, lines = [], sourceFile = '', options = {}) {
  const normalizedExt = analysisExtension(ext);
  const forceTerminalAction = Boolean(options && options.forceTerminalAction);
  const lineIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const marker = String(options && options.marker || (forceTerminalAction ? '*' : ':')).trim() || ':';
  const rawMarker = String(options && options.rawMarker || marker).trim() || marker;
  const terminalTaskInstruction = String(instruction || '').trim();
  const aiInstruction = forceTerminalAction
    ? `converter para acao de terminal segura: ${terminalTaskInstruction}`
    : instruction;
  const aiEffectiveInstruction = forceTerminalAction
    ? `Gere exclusivamente action.run_command para executar no terminal o pedido: ${terminalTaskInstruction}`
    : instruction;
  const contextualFunctionUpdateTarget = resolveContextualFunctionUpdateTarget(
    aiInstruction,
    normalizedExt,
    lines,
    sourceFile,
    options,
  );
  const activeBlueprint = loadActiveBlueprintContext(sourceFile);
  const actionComment = buildActionCommentContext({
    marker,
    rawMarker,
    instruction,
    lines,
    lineIndex,
  });
  const effectiveInstruction = contextualFunctionUpdateTarget
    ? buildContextualFunctionUpdateInstruction(aiEffectiveInstruction, contextualFunctionUpdateTarget)
    : activeBlueprint && /\bcrud\b/i.test(aiEffectiveInstruction) && !new RegExp(`\\b${escapeRegExp(activeBlueprint.entity)}\\b`, 'i').test(aiEffectiveInstruction)
      ? `${aiEffectiveInstruction} ${activeBlueprint.entity}`
      : aiEffectiveInstruction;
  const semanticIntent = parseSemanticCommentIntent(effectiveInstruction, normalizedExt);
  const intentIR = buildCommentIntentIR(semanticIntent);
  const strictAiCommentTask = mustUseAiForCommentAction() || requiresAiForFeature(sourceFile, 'comment_task');
  const preferAiCommentTask = strictAiCommentTask || preferAiForCommentTask();

  if (contextualFunctionUpdateTarget && !preferAiCommentTask) {
    return synthesizeOfflineCommentTask({
      instruction: aiInstruction,
      effectiveInstruction,
      ext,
      lines,
      sourceFile,
      options,
      semanticIntent,
      intentIR,
      contextualFunctionUpdateTarget,
    });
  }

  if (!preferAiCommentTask && normalizedExt === '.md') {
    return generateMarkdownSnippet(instruction);
  }

  if (!preferAiCommentTask) {
    return synthesizeOfflineCommentTask({
      instruction,
      effectiveInstruction,
      ext,
      lines,
      sourceFile,
      options,
      semanticIntent,
      intentIR,
      contextualFunctionUpdateTarget,
    });
  }

  const aiGeneratedTask = resolveAiGeneratedTask({
    instruction: aiInstruction,
    effectiveInstruction,
    ext,
    lines,
    sourceFile,
    activeBlueprint,
    lineIndex,
    marker,
    actionComment,
    semanticIntent,
    intentIR,
    targetContext: contextualFunctionUpdateTarget || undefined,
    requestedAction: forceTerminalAction ? 'run_command' : undefined,
    terminalTaskInstruction: forceTerminalAction ? terminalTaskInstruction : undefined,
  });
  const validatedAiTask = validateAiGeneratedTask(aiGeneratedTask, ext, semanticIntent);
  if (validatedAiTask) {
    const normalizedAiTask = contextualFunctionUpdateTarget
      ? materializeContextualFunctionUpdateTask(validatedAiTask, contextualFunctionUpdateTarget, lines, sourceFile)
      : validatedAiTask;
    if (normalizedAiTask) {
      return finalizeGeneratedTaskResult(
        withSemanticMetadata(normalizedAiTask, semanticIntent, intentIR),
        ext,
        lines,
        sourceFile,
        { semanticIntent, intentIR },
      );
    }
  }
  if (contextualFunctionUpdateTarget) {
    if (strictAiCommentTask) {
      return {
        snippet: '',
        aiFailure: true,
        aiFailureMessage: buildContextualFunctionUpdateAiFailureMessage(contextualFunctionUpdateTarget),
        semanticIntent,
        intentIR,
      };
    }
    return synthesizeOfflineCommentTask({
      instruction: aiInstruction,
      effectiveInstruction,
      ext,
      lines,
      sourceFile,
      options,
      semanticIntent,
      intentIR,
      contextualFunctionUpdateTarget,
    });
  }
  if (strictAiCommentTask) {
    return {
      snippet: '',
      aiFailure: true,
      aiFailureMessage: `Sem retorno de implementacao valida no modo offline para comment_task em ${normalizedExt || 'arquivo atual'}.`,
      semanticIntent,
      intentIR,
    };
  }
  return synthesizeOfflineCommentTask({
    instruction,
    effectiveInstruction,
    ext,
    lines,
    sourceFile,
    options,
    semanticIntent,
    intentIR,
    contextualFunctionUpdateTarget,
  });
}

function synthesizeOfflineCommentTask(params = {}) {
  const {
    instruction,
    effectiveInstruction,
    ext,
    lines,
    sourceFile,
    options,
    semanticIntent,
    intentIR,
    contextualFunctionUpdateTarget,
  } = params;

  if (contextualFunctionUpdateTarget) {
    const contextualTask = buildOfflineContextualFunctionUpdateTask(
      instruction,
      ext,
      lines,
      sourceFile,
      contextualFunctionUpdateTarget,
      { semanticIntent, intentIR },
    );
    if (contextualTask && String(contextualTask.snippet || '').trim()) {
      return contextualTask;
    }
  }

  const blueprintSnippet = generateBlueprintAwareSnippet(instruction, ext, sourceFile);
  if (blueprintSnippet) {
    return blueprintSnippet;
  }

  const structuredConfigSnippet = generateStructuredConfigSnippet(effectiveInstruction, ext);
  if (structuredConfigSnippet) {
    return finalizeGeneratedTaskResult(
      withSemanticMetadata(structuredConfigSnippet, semanticIntent, intentIR),
      ext,
      lines,
      sourceFile,
      { semanticIntent, intentIR },
    );
  }

  const renderableIntentKind = resolveRenderableIntentKind(semanticIntent, ext, effectiveInstruction);
  const renderedTask = renderCommentTaskByIntent(renderableIntentKind, effectiveInstruction, ext, lines, sourceFile, options);
  const finalizedOfflineTask = finalizeGeneratedTaskResult(
    withSemanticMetadata(renderedTask, semanticIntent, intentIR),
    ext,
    lines,
    sourceFile,
    { semanticIntent, intentIR },
  );
  if (String(finalizedOfflineTask && finalizedOfflineTask.snippet || '').trim()) {
    return finalizedOfflineTask;
  }

  return {
    snippet: '',
    semanticIntent,
    intentIR,
  };
}
function withSemanticMetadata(generatedTask, semanticIntent, intentIR) {
  if (!generatedTask || typeof generatedTask !== 'object') {
    return {
      snippet: String(generatedTask || ''),
      semanticIntent,
      intentIR,
    };
  }

  return {
    ...generatedTask,
    semanticIntent,
    intentIR,
  };
}
function validateAiGeneratedTask(generatedTask, ext, semanticIntent) {
  if (!generatedTask) {
    return null;
  }

  const validation = validateGeneratedTaskResult({
    generatedTask,
    ext,
    semanticIntent,
    strict: true,
  });
  if (!validation.ok) {
    return null;
  }

  if (typeof generatedTask === 'string') {
    return {
      snippet: generatedTask,
      generationValidation: validation,
    };
  }

  return {
    ...generatedTask,
    generationValidation: validation,
  };
}
function resolveRenderableIntentKind(semanticIntent, ext, instruction) {
  const fallbackIntent = classifyCommentTask(String(instruction || '').toLowerCase());
  const resolvedSemanticKind = semanticIntent && semanticIntent.kind
    ? semanticIntent.kind
    : fallbackIntent;
  const supportedToken = semanticIntent && semanticIntent.token
    ? semanticIntent.token
    : '';
  const structuredTokens = ['enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'];

  if (!supportedToken || supportsCommentTaskIntent(ext, supportedToken)) {
    return resolvedSemanticKind;
  }

  if (
    resolvedSemanticKind === 'structure'
    && structuredTokens.some((token) => supportsCommentTaskIntent(ext, token))
  ) {
    return 'structure';
  }

  if (supportsCommentTaskIntent(ext, 'function')) {
    return 'function';
  }

  return 'generic';
}
function renderCommentTaskByIntent(intentKind, instruction, ext, lines = [], sourceFile = '', options = {}) {
  const normalizedIntent = String(intentKind || '').trim().toLowerCase();
  const renderers = {
    example: () => generateExampleSnippet(instruction, ext),
    crud: () => generateCrudSnippet(instruction, ext),
    ui: () => generateUiSnippet(instruction, ext, lines),
    structure: () => generateStructureSnippet(instruction, ext),
    function: () => generateFunctionSnippet(instruction, ext, lines, sourceFile, options),
    comment: () => generateCommentSnippet(instruction, ext),
    test: () => generateTestSnippet(instruction, ext),
    generic: () => generateGenericSnippet(instruction, ext, lines, sourceFile, options),
  };
  const renderer = renderers[normalizedIntent] || renderers.generic;
  return renderer();
}
function classifyCommentTask(instruction) {
  if (/\b(teste|testa|testando|assert|it )/i.test(instruction)) {
    return 'test';
  }
  if (/\bsolid\b/i.test(instruction)) {
    return 'example';
  }
  if (/\bcrud\b/i.test(instruction)) {
    return 'crud';
  }
  if (/\b(tela|pagina|página|screen|page|login|formulario|formulário|form|componente|component|modal|dashboard)\b/i.test(instruction)) {
    return 'ui';
  }
  if (/\b(enum|class|classe|interface|contrato|type|struct|module|modulo|módulo|namespace|variavel|variável|constante|lista|array|vetor|colecao|coleção|objeto|mapa|dicionario|dicionário)\b/i.test(instruction)) {
    return 'structure';
  }
  if (isContextualCorrectionInstruction(instruction)) {
    return 'generic';
  }
  if (/\b(funcao|função|function|metodo|método)\b/i.test(instruction)) {
    return 'function';
  }
  if (/\b(implementa|implementar|implementacao|implemente|cria|criar|crie|criem|faca|faça|adiciona|adicionar|monta|montar|gera|gerar|escreve|escrever|esqueleto|faz|fazer)\b/i.test(instruction)) {
    return 'function';
  }
  if (/\b(comentario|comment|doc|docstring)\b/i.test(instruction)) {
    return 'comment';
  }
  return 'generic';
}
function isContextualCorrectionInstruction(instruction) {
  return /\b(corrige|corrigir|corrigindo|ajusta|ajustar|substitui|substituir|altera|alterar|troca|trocar|remove|remover|troque|corrija|refatora|refatorar|refactor|atualiza|atualizar|atualize|update|melhora|melhorar|melhore|aprimora|aprimorar|aprimore)\b/i.test(String(instruction || ''));
}

function isContextualFunctionUpdateInstruction(instruction) {
  const normalized = String(instruction || '').trim();
  if (!normalized) {
    return false;
  }

  if (isContextualCorrectionInstruction(normalized)) {
    return true;
  }

  return /\b(adiciona|adicionar|adicione|add|insere|inserir|insira|valida|validar|valide|validacao|validação|verifica|verificar|verifique|checa|checar|check|garanta|garantir|garante|if|elif|else|case|guard|condicional|condicao|condição)\b/i.test(normalized);
}

function resolveContextualFunctionUpdateConfig(ext) {
  const normalizedExt = analysisExtension(ext);

  if (isElixirExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'elixir',
      languageLabel: 'elixir',
      commentPrefix: '#',
      allowDecoratorLines: true,
      parseHeader: parseElixirPublicFunctionHeader,
      collectBlock: collectElixirFunctionBlock,
    };
  }
  if (isJavaScriptLikeExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'javascript',
      languageLabel: 'javascript',
      commentPrefix: '//',
      allowDecoratorLines: true,
      parseHeader: parseJavaScriptPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
    };
  }
  if (isPythonLikeExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'python',
      languageLabel: 'python',
      commentPrefix: '#',
      allowDecoratorLines: true,
      parseHeader: parsePythonPublicFunctionHeader,
      collectBlock: collectPythonFunctionBlock,
    };
  }
  if (isGoExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'go',
      languageLabel: 'go',
      commentPrefix: '//',
      allowDecoratorLines: false,
      parseHeader: parseGoPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
    };
  }
  if (isRustExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'rust',
      languageLabel: 'rust',
      commentPrefix: '//',
      allowDecoratorLines: true,
      parseHeader: parseRustPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
    };
  }
  if (['.c', '.h', '.cpp', '.hpp'].includes(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'c',
      languageLabel: 'c',
      commentPrefix: '//',
      allowDecoratorLines: false,
      parseHeader: parseCPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
    };
  }
  if (isRubyExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'ruby',
      languageLabel: 'ruby',
      commentPrefix: '#',
      allowDecoratorLines: false,
      parseHeader: parseRubyPublicFunctionHeader,
      collectBlock: collectRubyFunctionBlock,
    };
  }
  if (normalizedExt === '.lua') {
    return {
      extension: normalizedExt,
      languageId: 'lua',
      languageLabel: 'lua',
      commentPrefix: '--',
      allowDecoratorLines: false,
      parseHeader: parseLuaPublicFunctionHeader,
      collectBlock: collectLuaFunctionBlock,
    };
  }
  if (normalizedExt === '.vim') {
    return {
      extension: normalizedExt,
      languageId: 'vim',
      languageLabel: 'vim',
      commentPrefix: '"',
      allowDecoratorLines: false,
      parseHeader: parseVimPublicFunctionHeader,
      collectBlock: collectVimFunctionBlock,
    };
  }
  if (isShellExtension(normalizedExt)) {
    return {
      extension: normalizedExt,
      languageId: 'shell',
      languageLabel: 'shell',
      commentPrefix: '#',
      allowDecoratorLines: false,
      parseHeader: parseShellPublicFunctionHeader,
      collectBlock: collectShellFunctionBlock,
    };
  }

  return null;
}

function isIgnorableContextualGapLine(line, config = {}) {
  const trimmed = String(line || '').trim();
  if (!trimmed) {
    return true;
  }

  const commentPrefix = String(config.commentPrefix || '').trim();
  if (commentPrefix && trimmed.startsWith(commentPrefix)) {
    return true;
  }

  if (/^(?:\/\*+|\*+\/?|\*)/.test(trimmed)) {
    return true;
  }

  if (config.allowDecoratorLines && (/^@/.test(trimmed) || /^#\[/.test(trimmed))) {
    return true;
  }

  return false;
}

function findContextualFunctionRange(lines, config, options = {}) {
  if (!Array.isArray(lines) || lines.length === 0 || !config) {
    return null;
  }

  const parseHeader = typeof config.parseHeader === 'function'
    ? config.parseHeader
    : () => null;
  const collectBlock = typeof config.collectBlock === 'function'
    ? config.collectBlock
    : () => null;
  const expectedName = String(options.expectedName || '').trim();
  const startSearchIndex = Number.isInteger(options.startSearchIndex)
    ? Math.max(0, options.startSearchIndex)
    : 0;
  const requireAdjacency = options.requireAdjacency === true;

  for (let index = startSearchIndex; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const declaration = parseHeader(line);
    const candidateName = declaration && declaration.name
      ? String(declaration.name).trim()
      : '';
    if (candidateName && (!expectedName || candidateName === expectedName)) {
      const block = collectBlock(lines, index);
      if (!block || !Number.isInteger(block.end)) {
        return null;
      }
      return {
        start: index,
        end: block.end,
        name: candidateName,
      };
    }

    if (requireAdjacency && !isIgnorableContextualGapLine(line, config)) {
      break;
    }
  }

  return null;
}

function resolveContextualFunctionUpdateTarget(instruction, ext, lines = [], sourceFile = '', options = {}) {
  const config = resolveContextualFunctionUpdateConfig(ext);
  if (!config || !isContextualFunctionUpdateInstruction(instruction) || !sourceFile) {
    return null;
  }

  const commentIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const functionRange = findContextualFunctionRange(lines, config, {
    startSearchIndex: commentIndex >= 0 ? commentIndex + 1 : 0,
    requireAdjacency: true,
  });
  if (!functionRange) {
    return null;
  }

  return {
    sourceFile,
    commentIndex,
    name: functionRange.name,
    start: functionRange.start,
    end: functionRange.end,
    snippet: lines.slice(functionRange.start, functionRange.end + 1).join('\n'),
    extension: config.extension,
    languageId: config.languageId,
    languageLabel: config.languageLabel,
  };
}

function extractContextualFunctionSnippet(snippet, target = {}) {
  const source = String(snippet || '').replace(/\r\n/g, '\n').trim();
  if (!source) {
    return '';
  }

  const config = resolveContextualFunctionUpdateConfig(target && target.extension);
  if (!config) {
    return '';
  }

  const lines = source.split('\n');
  const directRange = findContextualFunctionRange(lines, config, {
    startSearchIndex: 0,
    expectedName: String(target && target.name || '').trim(),
    requireAdjacency: false,
  });
  if (!directRange) {
    return '';
  }

  return lines.slice(directRange.start, directRange.end + 1).join('\n').trim();
}

function buildContextualFunctionUpdateAiFailureMessage(target = {}) {
  const functionName = String(target && target.name || '').trim() || 'funcao_alvo';
  const languageLabel = String(target && target.languageLabel || 'alvo').trim() || 'alvo';
  return `Atualizacao contextual da funcao ${languageLabel} '${functionName}' exige uma resposta de IA valida; o fallback offline foi bloqueado para evitar gerar uma funcao nova incorreta.`;
}

function buildContextualFunctionUpdateAiFailure(instruction, ext, lines = [], options = {}) {
  const config = resolveContextualFunctionUpdateConfig(ext);
  if (!config || !isContextualFunctionUpdateInstruction(instruction)) {
    return null;
  }

  const commentIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const functionRange = findContextualFunctionRange(lines, config, {
    startSearchIndex: commentIndex >= 0 ? commentIndex + 1 : 0,
    requireAdjacency: true,
  });
  if (!functionRange) {
    return null;
  }

  return {
    snippet: '',
    aiFailure: true,
    aiFailureMessage: buildContextualFunctionUpdateAiFailureMessage({
      name: functionRange.name,
      languageLabel: config.languageLabel,
    }),
  };
}

function buildContextualFunctionUpdateInstruction(instruction, target) {
  const functionName = String(target && target.name || '').trim() || 'funcao_alvo';
  const languageLabel = String(target && target.languageLabel || 'alvo').trim() || 'alvo';
  const requestedChange = safeComment(instruction);
  return [
    `Atualize somente a funcao ${languageLabel} ${functionName}.`,
    `Pedido original: ${requestedChange}.`,
    'Preserve o escopo sintatico e a indentacao do bloco atual.',
    'Retorne apenas a funcao completa final com o mesmo nome.',
    'Nao retorne o comentario gatilho.',
    'Nao retorne o restante do arquivo.',
  ].join(' ');
}

function materializeContextualFunctionUpdateTask(generatedTask, target, lines = [], sourceFile = '') {
  if (!target || !sourceFile) {
    return null;
  }

  const updatedFunctionSnippet = extractContextualFunctionSnippet(
    generatedTask && generatedTask.snippet,
    target,
  );
  if (!updatedFunctionSnippet) {
    return null;
  }

  const updatedFunctionLines = updatedFunctionSnippet.split('\n');
  const filteredLines = Array.isArray(lines)
    ? lines.filter((_, index) => index !== target.commentIndex)
    : [];
  const adjustedStart = target.start > target.commentIndex && target.commentIndex >= 0
    ? target.start - 1
    : target.start;
  const adjustedEnd = target.end > target.commentIndex && target.commentIndex >= 0
    ? target.end - 1
    : target.end;
  const rewrittenLines = [
    ...filteredLines.slice(0, adjustedStart),
    ...updatedFunctionLines,
    ...filteredLines.slice(adjustedEnd + 1),
  ];

  return {
    ...generatedTask,
    snippet: rewrittenLines.join('\n'),
    action: {
      op: 'write_file',
      target_file: sourceFile,
      mkdir_p: true,
      remove_trigger: false,
    },
    disableMaintenanceComments: true,
  };
}

function buildOfflineContextualFunctionUpdateTask(instruction, ext, lines = [], sourceFile = '', target = {}, metadata = {}) {
  if (!target || !sourceFile) {
    return null;
  }

  const params = extractContextualFunctionParams(target, ext);
  const offlineFunctionPlan = deriveOfflineFunctionPlan({
    instruction,
    ext,
    name: target.name,
    params,
  });
  const resolvedParams = offlineFunctionPlan && Array.isArray(offlineFunctionPlan.params)
    ? offlineFunctionPlan.params
    : params;
  const body = offlineFunctionPlan
    ? baseHint(offlineFunctionPlan.expression, ext)
    : functionBodyHint(instruction, resolvedParams, ext);
  const updatedFunction = buildRenderedFunctionSnippet(
    target.name,
    resolvedParams,
    instruction,
    ext,
    body,
    resolveFunctionRenderingOptions(instruction, ext, lines, { contextualTarget: target }),
  );
  const task = materializeContextualFunctionUpdateTask(
    {
      snippet: updatedFunction,
      disableMaintenanceComments: true,
      semanticIntent: metadata.semanticIntent || null,
      intentIR: metadata.intentIR || null,
      generationValidation: {
        ok: true,
        reasons: [],
        offlineFallback: true,
      },
    },
    target,
    lines,
    sourceFile,
  );
  if (!task) {
    return null;
  }

  return {
    ...task,
    semanticIntent: metadata.semanticIntent || null,
    intentIR: metadata.intentIR || null,
  };
}

function extractContextualFunctionParams(target, ext) {
  const snippet = String(target && target.snippet || '').replace(/\r\n/g, '\n');
  const firstMeaningfulLine = snippet
    .split('\n')
    .map((line) => String(line || '').trim())
    .find((line) => line && !isGeneratedCommentLine(line, ext));
  if (!firstMeaningfulLine) {
    return [];
  }

  const normalizedExt = analysisExtension(ext);
  if (['.ex', '.exs'].includes(normalizedExt)) {
    const match = firstMeaningfulLine.match(/\bdefp?\s+[A-Za-z_][A-Za-z0-9_?!]*\s*\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]);
  }
  if (normalizedExt === '.py') {
    const match = firstMeaningfulLine.match(/\bdef\s+[A-Za-z_][A-Za-z0-9_]*\s*\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]).filter((param) => param !== 'self' && param !== 'cls');
  }
  if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(normalizedExt)) {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]);
  }
  if (normalizedExt === '.go') {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]).map((param) => param.split(/\s+/)[0]).filter(Boolean);
  }
  if (normalizedExt === '.rs') {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1])
      .map((param) => param.replace(/^mut\s+/, '').split(':')[0].trim())
      .filter((param) => param && param !== '&self' && param !== 'self');
  }
  if (normalizedExt === '.rb') {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]);
  }
  if (normalizedExt === '.lua') {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]);
  }
  if (normalizedExt === '.vim') {
    const match = firstMeaningfulLine.match(/\(([^)]*)\)/);
    return splitSimpleParamList(match && match[1]);
  }
  if (isShellExtension(normalizedExt)) {
    return [];
  }

  const genericMatch = firstMeaningfulLine.match(/\(([^)]*)\)/);
  return splitSimpleParamList(genericMatch && genericMatch[1]);
}

function splitSimpleParamList(rawParams) {
  return String(rawParams || '')
    .split(',')
    .map((param) => String(param || '').trim())
    .map((param) => param.replace(/=.*$/, '').replace(/:.*/, '').trim())
    .map((param) => param.replace(/^[*&]+/, '').trim())
    .filter(Boolean);
}
function generateFunctionSnippet(instruction, ext, lines = [], sourceFile = '', options = {}) {
  const directedGraphSnippet = generateDirectedGraphSnippet(instruction, ext);
  if (directedGraphSnippet) {
    return {
      snippet: directedGraphSnippet,
      disableMaintenanceComments: true,
    };
  }

  const contextualFunctionUpdate = buildContextualFunctionUpdateAiFailure(instruction, ext, lines, options);
  if (contextualFunctionUpdate) {
    return contextualFunctionUpdate;
  }

  if (isShellExtension(ext)) {
    const shellSnippet = generateShellFunctionSnippet(instruction);
    const shellName = extractGeneratedFunctionName(shellSnippet, ext);
    return decorateGeneratedSnippet(shellSnippet, shellName, [], instruction, ext, { lines, sourceFile });
  }

  const databaseFunction = generateDatabaseFunctionSnippet(instruction, ext, lines);
  if (databaseFunction) {
    const databaseName = extractGeneratedFunctionName(databaseFunction.snippet, ext);
    return decorateGeneratedSnippet(databaseFunction, databaseName, [], instruction, ext, { lines, sourceFile });
  }

  const [name, params] = parseFunctionRequest(instruction);
  const offlineFunctionPlan = deriveOfflineFunctionPlan({ instruction, ext, name, params });
  const resolvedName = offlineFunctionPlan && offlineFunctionPlan.name ? offlineFunctionPlan.name : name;
  const resolvedParams = offlineFunctionPlan && Array.isArray(offlineFunctionPlan.params)
    ? offlineFunctionPlan.params
    : params;
  const body = offlineFunctionPlan
    ? baseHint(offlineFunctionPlan.expression, ext)
    : functionBodyHint(instruction, resolvedParams, ext);
  const renderOptions = resolveFunctionRenderingOptions(instruction, ext, lines, options);
  const snippet = buildRenderedFunctionSnippet(resolvedName, resolvedParams, instruction, ext, body, renderOptions);
  return decorateGeneratedSnippet(snippet, resolvedName, resolvedParams, instruction, ext, { lines, sourceFile });
}
function buildRenderedFunctionSnippet(name, params, instruction, ext, body, renderOptions = {}) {
  const [signature, closer] = functionSignature(name, params, instruction, ext, renderOptions);
  const bodyIndent = functionBodyIndent(ext);
  const functionLines = [`${signature}`];
  const inlineDocBlock = buildInlineFunctionDocumentation(name, params, instruction, ext);
  if (inlineDocBlock) {
    functionLines.push(...inlineDocBlock.split('\n'));
  }
  functionLines.push(`${bodyIndent}${body}`);
  if (closer === 'none') {
    return functionLines.join('\n');
  }
  functionLines.push(closer);
  return functionLines.join('\n');
}
function decorateGeneratedSnippet(result, name, params, instruction, ext, options = {}) {
  const normalized = normalizeGeneratedTaskResult(result, ext);
  let decoratedSnippet = addLeadingFunctionDocumentation(normalized.snippet, name, params, instruction, ext);
  decoratedSnippet = wrapElixirSnippetInModuleIfNeeded(
    decoratedSnippet,
    ext,
    Array.isArray(options.lines) ? options.lines : [],
    options.sourceFile || '',
    name,
  );
  return {
    ...normalized,
    snippet: decoratedSnippet,
  };
}
function addLeadingFunctionDocumentation(snippet, name, params, instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!shouldAddLeadingFunctionDocumentation(snippet, lowerExt)) {
    return snippet;
  }

  const functionName = name || extractGeneratedFunctionName(snippet, ext);
  const documentation = buildLeadingFunctionDocumentation(functionName, params, instruction, ext);
  if (!documentation) {
    return snippet;
  }
  return `${documentation}\n${snippet}`;
}
function shouldAddLeadingFunctionDocumentation(snippet, ext) {
  const generatedName = extractGeneratedFunctionName(snippet, ext);
  if (!snippet || !generatedName) {
    return false;
  }
  if (isPythonLikeExtension(ext)) {
    return false;
  }
  if (isReactLikeExtension(ext) && /^[A-Z]/.test(generatedName)) {
    return false;
  }
  const trimmed = String(snippet || '').trimStart();
  if (
    trimmed.startsWith('/**')
    || trimmed.startsWith('///')
    || trimmed.startsWith('// ')
    || trimmed.startsWith('# ')
    || trimmed.startsWith('@doc')
  ) {
    return false;
  }
  return true;
}
function finalizeGeneratedTaskResult(result, ext, lines = [], sourceFile = '', metadata = {}) {
  const semanticIntent = metadata.semanticIntent || (result && result.semanticIntent) || null;
  const intentIR = metadata.intentIR || (result && result.intentIR) || null;
  const mappedResult = mapGeneratedTaskResultSnippet(result, (snippet) =>
    wrapElixirSnippetInModuleIfNeeded(snippet, ext, lines, sourceFile, ''),
  );
  const validation = validateGeneratedTaskResult({
    generatedTask: mappedResult,
    ext,
    semanticIntent,
    strict: false,
  });
  if (mappedResult && typeof mappedResult === 'object') {
    return {
      ...mappedResult,
      semanticIntent,
      intentIR,
      generationValidation: mappedResult.generationValidation || validation,
    };
  }

  return {
    snippet: String(mappedResult || ''),
    semanticIntent,
    intentIR,
    generationValidation: validation,
  };
}
function wrapElixirSnippetInModuleIfNeeded(snippet, ext, lines = [], sourceFile = '', fallbackName = '') {
  const lowerExt = analysisExtension(ext);
  const normalizedSnippet = String(snippet || '');
  if (!['.ex', '.exs'].includes(lowerExt)) {
    return normalizedSnippet;
  }
  if (!shouldWrapElixirSnippet(normalizedSnippet, lines)) {
    return normalizedSnippet;
  }

  const moduleName = inferElixirModuleName(sourceFile, fallbackName);
  const indentedSnippet = normalizedSnippet
    .split('\n')
    .map((line) => line.length > 0 ? `  ${line}` : '')
    .join('\n');

  return [
    `defmodule ${moduleName} do`,
    indentedSnippet,
    'end',
  ].join('\n');
}
function shouldWrapElixirSnippet(snippet, lines = []) {
  const text = String(snippet || '');
  if (!text.trim()) {
    return false;
  }
  if (/^\s*defmodule\s+/m.test(text)) {
    return false;
  }
  if (Array.isArray(lines) && lines.some((line) => /^\s*defmodule\s+/.test(String(line || '')))) {
    return false;
  }
  return /^\s*(?:@doc|@spec|def\s+)/m.test(text);
}
function inferElixirModuleName(sourceFile, fallbackName = '') {
  const sourceName = String(sourceFile || '').trim()
    ? path.parse(String(sourceFile)).name
    : '';
  const candidate = sourceName || fallbackName || 'generated_task';
  return String(candidate)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((segment, index) => normalizePascalModuleSegment(segment, index === 0))
    .join('') || 'GeneratedTask';
}
function normalizePascalModuleSegment(segment, isLeadingSegment = false) {
  const normalized = String(segment || '')
    .replace(/[^A-Za-z0-9]/g, '')
    .trim();
  if (!normalized) {
    return '';
  }

  const pascalized = upperFirst(normalized.toLowerCase());
  if (isLeadingSegment && /^[0-9]/.test(pascalized)) {
    return `Generated${pascalized}`;
  }
  return pascalized;
}
function buildInlineFunctionDocumentation(name, params, instruction, ext, context = {}) {
  if (!isPythonLikeExtension(ext)) {
    return '';
  }

  const documentation = inferFunctionDocumentationContext(name, params, instruction, ext, context);
  const argsDescription = documentation.paramDocs.length
    ? documentation.paramDocs.map((param) => `        ${param.name} (${param.type}): ${param.description}`).join('\n')
    : '        Nenhum argumento recebido.';

  return [
    '    """',
    `    ${documentation.summary}`,
    '',
    '    Args:',
    argsDescription,
    '',
    '    Returns:',
    `        ${documentation.pythonReturnType}: ${documentation.returnDescription}`,
    '    """',
  ].join('\n');
}
function buildLeadingFunctionDocumentation(name, params, instruction, ext, context = {}) {
  const lowerExt = String(ext || '').toLowerCase();
  const documentation = inferFunctionDocumentationContext(name, params, instruction, ext, context);
  const normalizedName = sanitizeIdentifier(name || extractGeneratedFunctionName('', ext) || 'funcao_gerada');

  if (['.ex', '.exs'].includes(lowerExt)) {
    const spec = snippetFunctionSpec(normalizedName, params, ext, inferGeneratedSpecContext(instruction, ext));
    const doc = [
      '@doc """',
      `  ${documentation.summary}`,
      '',
      '  ## Parametros',
      params.length
        ? documentation.paramDocs.map((param) => `  - \`${param.name}\`: ${param.description}`).join('\n')
        : '  - Nenhum argumento recebido.',
      '',
      '  ## Retorno',
      `  ${documentation.returnDescription}`,
      '',
      '  ## Contrato',
      `  \`${spec}\``,
      '  """',
    ].join('\n');
    return `${doc}\n${spec}`;
  }

  if (isJavaScriptLikeExtension(lowerExt)) {
    const paramLines = documentation.paramDocs.map((param) => {
      const paramName = renderFunctionDocParamName(param, lowerExt);
      const description = renderFunctionDocParamDescription(param, lowerExt);
      return ` * @param {${param.type}} ${paramName} ${description}`;
    });
    return [
      '/**',
      ` * ${documentation.summary}`,
      ...paramLines,
      ` * @returns {${documentation.jsReturnType}} ${documentation.returnDescription}`,
      ' */',
    ].join('\n');
  }

  if (isPythonLikeExtension(lowerExt)) {
    const indent = String(context.indent || '');
    const blankLine = indent;
    return [
      `${indent}"""`,
      `${indent}${documentation.summary}`,
      blankLine,
      `${indent}Args:`,
      ...(documentation.paramDocs.length
        ? documentation.paramDocs.map((param) => {
          const description = renderFunctionDocParamDescription(param, lowerExt);
          return `${indent}  ${param.name} (${param.pythonType}): ${description}`;
        })
        : [`${indent}  Nenhum argumento recebido.`]),
      blankLine,
      `${indent}Returns:`,
      `${indent}  ${documentation.pythonReturnType}: ${documentation.returnDescription}`,
      `${indent}"""`,
    ].join('\n');
  }

  if (isGoExtension(lowerExt)) {
    return `// ${toCamelCaseIdentifier(normalizedName)} ${lowercaseFirst(documentation.summary)}`;
  }

  if (isRustExtension(lowerExt)) {
    return `/// ${documentation.summary}`;
  }

  if (lowerExt === '.rb') {
    return [
      `# ${documentation.summary}`,
      `# Retorno: ${documentation.returnDescription}`,
    ].join('\n');
  }

  if (lowerExt === '.vim') {
    return [
      `" ${documentation.summary}`,
      `" Retorno: ${documentation.returnDescription}`,
    ].join('\n');
  }

  if (lowerExt === '.lua') {
    return [
      `-- ${documentation.summary}`,
      `-- Retorno: ${documentation.returnDescription}`,
    ].join('\n');
  }

  if (['.c', '.h'].includes(lowerExt)) {
    return [
      `// ${documentation.summary}`,
      `// Retorno: ${documentation.returnDescription}`,
    ].join('\n');
  }

  if (lowerExt === '.sh') {
    return [
      `# ${documentation.summary}`,
      `# Retorno: ${documentation.returnDescription}`,
    ].join('\n');
  }

  return '';
}
function inferFunctionDocumentationContext(name, params, instruction, ext, context = {}) {
  const rawParams = Array.isArray(params) ? params : [];
  const paramDescriptors = Array.isArray(context.paramDescriptors) ? context.paramDescriptors : [];
  const normalizedParams = rawParams
    .map((param, index) => ({
      name: param,
      paramContext: paramDescriptors[index] || {},
    }))
    .filter((entry) => !isImplicitReceiverParameter(entry.name, ext));
  const summary = context.summary || functionDocumentationSummary(name, instruction, context);
  const semanticReturnType = inferSemanticReturnType(name, instruction, ext, context);
  const returnDescription = context.returnDescription || functionReturnDocumentation(instruction, ext, semanticReturnType, context);
  const paramDocs = normalizedParams.map((entry) => {
    const semanticType = inferSemanticParamType(entry.name, instruction, ext, {
      ...context,
      paramContext: entry.paramContext,
      semanticReturnType,
    });
    return {
      name: entry.name,
      type: renderJavaScriptDocType(semanticType, entry.paramContext.annotation || ''),
      pythonType: renderPythonDocType(semanticType, entry.paramContext.annotation || ''),
      description: describeParameterForDocumentation(entry.name, semanticType, context),
      isOptional: Boolean(entry.paramContext.isOptional),
      isVariadic: Boolean(entry.paramContext.isVariadic),
    };
  });

  return {
    summary,
    returnDescription,
    paramDocs: paramDocs.map((param) => ({
      ...param,
      type: isPythonLikeExtension(ext) ? param.pythonType : param.type,
    })),
    jsReturnType: renderJavaScriptDocType(semanticReturnType, context.returnAnnotation || ''),
    pythonReturnType: renderPythonDocType(semanticReturnType, context.returnAnnotation || ''),
  };
}

function renderFunctionDocParamName(param, ext) {
  let name = String(param && param.name || '').trim();
  if (!name) {
    return 'arg';
  }

  if (isJavaScriptLikeExtension(ext) && Boolean(param && param.isVariadic) && !name.startsWith('...')) {
    name = `...${name}`;
  }
  if (isJavaScriptLikeExtension(ext) && Boolean(param && param.isOptional) && !name.endsWith('?')) {
    name = `${name}?`;
  }

  return name;
}

function renderFunctionDocParamDescription(param, ext) {
  const baseDescription = String(param && param.description || '').trim();
  const paramName = String(param && param.name || '').trim();
  const qualifiers = [];

  if (Boolean(param && param.isOptional)) {
    qualifiers.push('optional');
  }
  if (Boolean(param && param.isVariadic)) {
    qualifiers.push('variadic');
  }

  if (!qualifiers.length || isJavaScriptLikeExtension(ext)) {
    if (baseDescription) {
      return baseDescription;
    }
    if (paramName) {
      return `Valor de entrada para ${humanizeIdentifier(paramName).toLowerCase()} no fluxo da funcao.`;
    }
    return 'Valor de entrada utilizado no fluxo da funcao.';
  }

  const suffix = `(${qualifiers.join(', ')})`;
  if (!baseDescription) {
    if (paramName) {
      return `Valor de entrada para ${humanizeIdentifier(paramName).toLowerCase()} no fluxo da funcao ${suffix}.`;
    }
    return `Valor de entrada utilizado no fluxo da funcao ${suffix}.`;
  }
  if (/[.!?]$/.test(baseDescription)) {
    return `${baseDescription.slice(0, -1)} ${suffix}.`;
  }
  return `${baseDescription} ${suffix}.`;
}
function isImplicitReceiverParameter(name, ext) {
  const normalizedName = String(name || '').trim().toLowerCase();
  const lowerExt = String(ext || '').toLowerCase();
  if (normalizedName === 'self' && (isPythonLikeExtension(lowerExt) || ['.rb', '.lua', '.vim'].includes(lowerExt))) {
    return true;
  }
  if (normalizedName === 'this' && isJavaScriptLikeExtension(lowerExt)) {
    return true;
  }
  return false;
}
function inferSemanticParamType(name, instruction, ext, context = {}) {
  const annotation = normalizeAnnotatedType(context.paramContext && context.paramContext.annotation, ext);
  if (annotation && annotation !== 'any') {
    return annotation;
  }

  const lowerInstruction = String(instruction || '').toLowerCase();
  const normalizedName = String(name || '').toLowerCase();
  const returnExpression = String(context.returnExpression || '').toLowerCase();

  if (isArithmeticDocumentationContext(lowerInstruction, returnExpression)) {
    return 'number';
  }
  if (/^(room_?id|sala_?id|chat_?id)$/.test(normalizedName)) {
    return 'string';
  }
  if (/^(usuario|user|cliente|socket|conexao|connection)$/.test(normalizedName)) {
    return 'object';
  }
  if (/(usuarios?_conectados?_a_rooms?|usuarios?_por_room|rooms?_por_usuario|salas?_por_usuario)/.test(normalizedName)) {
    return 'object';
  }
  if (/\b(id|idade|indice|index|numero|total|quantidade|valor|amount|count|limite|offset|pagina)\b/.test(normalizedName)) {
    return 'number';
  }
  if (/^(a|b|x|y|z)$/.test(normalizedName) && isArithmeticDocumentationContext(lowerInstruction, returnExpression)) {
    return 'number';
  }
  if (/^(is_|has_|can_|deve_|ativo|enabled|flag|ativo\?)/.test(normalizedName) || /\b(boolean|bool|verdadeiro|falso)\b/.test(lowerInstruction)) {
    return 'boolean';
  }
  if (/\b(nome|name|texto|text|mensagem|message|email|slug|titulo|title|descricao|description)\b/.test(normalizedName)) {
    return 'string';
  }
  if (/\b(lista|items|itens|usuarios|users|pedidos|orders)\b/.test(normalizedName)) {
    return 'array';
  }
  if (/\b(config|payload|dados|data|objeto|mapa|options)\b/.test(normalizedName)) {
    return 'object';
  }
  return 'any';
}
function inferSemanticReturnType(name, instruction, ext, context = {}) {
  const annotation = normalizeAnnotatedType(context.returnAnnotation, ext);
  if (annotation && annotation !== 'any') {
    return annotation;
  }

  const lowerInstruction = String(instruction || '').toLowerCase();
  const expression = String(context.returnExpression || '').trim();
  const normalizedExpression = expression.toLowerCase();
  const literalValue = extractLiteralFromInstruction(lowerInstruction);

  if (extractDiceSides(instruction)) {
    return 'number';
  }
  if (literalValue === 'true' || literalValue === 'false') {
    return 'boolean';
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(literalValue)) {
    return 'number';
  }
  if (/^".*"$/.test(literalValue) || /^'.*'$/.test(literalValue)) {
    return 'string';
  }
  if (isArithmeticDocumentationContext(lowerInstruction, normalizedExpression)) {
    return 'number';
  }
  if (/\b(usuarios_da_room|usuariosconectados|usuarios_conectados|users_in_room|messages)\b/.test(normalizedExpression)) {
    return 'array';
  }
  if (/\b(usuarios_conectados_a_rooms|usuarios_por_room|rooms_por_usuario)\b/.test(normalizedExpression)) {
    return 'object';
  }
  if (/^\[/.test(expression) || /\.map\(|\.filter\(|\.reduce\(/.test(expression)) {
    return 'array';
  }
  if (/^\{/.test(expression) || /^%\{/.test(expression)) {
    return 'object';
  }
  if (/^(true|false|True|False)$/.test(expression)) {
    return 'boolean';
  }
  if (/^[+-]?\d+(?:\.\d+)?$/.test(expression)) {
    return 'number';
  }
  if (/^["'].*["']$/.test(expression)) {
    return 'string';
  }
  if (/^None$|^null$|^undefined$|^nil$/i.test(expression)) {
    return 'void';
  }
  if (/\b(lista|items|itens|usuarios|users|pedidos|orders)\b/.test(String(name || '').toLowerCase())) {
    return 'array';
  }
  return 'any';
}
function normalizeAnnotatedType(annotation, ext) {
  const normalized = String(annotation || '').trim();
  if (!normalized) {
    return '';
  }
  const lower = normalized.toLowerCase();
  if (/\b(?:number|float64|float32|f64|f32|double|decimal|bigint|int|integer|usize|isize|u\d+|i\d+)\b/.test(lower)) {
    return 'number';
  }
  if (/\b(?:string|str|String\.t\(\)|&str)\b/.test(lower)) {
    return 'string';
  }
  if (/\b(?:bool|boolean)\b/.test(lower)) {
    return 'boolean';
  }
  if (/\b(?:list|array|vec|slice)\b|\[\]/.test(lower)) {
    return 'array';
  }
  if (/\b(?:map|dict|record|object)\b|\{.*:.*\}/.test(lower)) {
    return 'object';
  }
  if (/\b(?:none|void|nil|null|undefined)\b/.test(lower)) {
    return 'void';
  }
  if (isPythonLikeExtension(ext) && /^[A-Z][A-Za-z0-9_.\[\]]+$/.test(normalized)) {
    return 'object';
  }
  return 'any';
}
function renderJavaScriptDocType(semanticType, annotation = '') {
  const normalizedAnnotation = String(annotation || '').trim();
  if (normalizedAnnotation) {
    const cleaned = normalizedAnnotation.replace(/\s*=\s*.+$/, '').trim();
    if (cleaned) {
      return cleaned;
    }
  }

  switch (semanticType) {
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'Array';
    case 'object':
      return 'object';
    case 'void':
      return 'void';
    default:
      return 'any';
  }
}
function renderPythonDocType(semanticType, annotation = '') {
  const normalizedAnnotation = String(annotation || '').trim();
  if (normalizedAnnotation) {
    return normalizedAnnotation.replace(/\s*=\s*.+$/, '').trim();
  }

  switch (semanticType) {
    case 'number':
      return 'int';
    case 'string':
      return 'str';
    case 'boolean':
      return 'bool';
    case 'array':
      return 'list';
    case 'object':
      return 'dict';
    case 'void':
      return 'None';
    default:
      return 'Any';
  }
}
function describeParameterForDocumentation(name, semanticType, context = {}) {
  const normalizedName = String(name || '').toLowerCase();
  const projectEntity = String(context && context.projectMemory && context.projectMemory.entity || '').trim();
  if (/^(payload|evento|event)$/.test(normalizedName)) {
    return 'Carga recebida que precisa ser validada e roteada pela regra principal.';
  }
  if (/^(runtime_?state|chat_?state|state)$/.test(normalizedName)) {
    return 'Estado compartilhado usado para coordenar a operacao atual.';
  }
  if (/^(client_?id|cliente_?id|user_?id|usuario_?id)$/.test(normalizedName)) {
    return 'Identificador do participante afetado por esta operacao.';
  }
  if (/^(invite_?code|codigo_?convite)$/.test(normalizedName)) {
    return 'Codigo usado para autorizar o acesso ao fluxo protegido.';
  }
  if (/^(participant_?ids|participantes?|room_?snapshot|snapshot)$/.test(normalizedName)) {
    return 'Estado derivado usado para notificar os participantes corretos.';
  }
  if (/^(room_?id|sala_?id|chat_?id)$/.test(normalizedName)) {
    return 'Identificador textual da room usada para localizar os usuarios conectados.';
  }
  if (/^(usuario|user|cliente|socket|conexao|connection)$/.test(normalizedName)) {
    return 'Participante ou conexao usada no fluxo realtime.';
  }
  switch (semanticType) {
    case 'number':
      return 'Valor numerico usado na regra principal da funcao.';
    case 'string':
      return 'Texto de entrada usado no fluxo principal.';
    case 'boolean':
      return 'Sinalizador que controla a regra principal da funcao.';
    case 'array':
      return projectEntity
        ? `Colecao de entrada processada pelo fluxo principal de ${projectEntity}.`
        : 'Colecao de entrada processada pelo fluxo principal.';
    case 'object':
      return projectEntity
        ? `Estrutura de dados de entrada consumida pela funcao dentro de ${projectEntity}.`
        : 'Estrutura de dados de entrada consumida pela funcao.';
    default:
      return 'Parametro de entrada do fluxo.';
  }
}
function isArithmeticDocumentationContext(instruction, returnExpression) {
  const combined = `${String(instruction || '')} ${String(returnExpression || '')}`.toLowerCase();
  return Boolean(
    inferArithmeticOperator(combined)
    || /\b[a-z_][a-z0-9_]*\s*[+\-*/%]\s*[a-z_0-9][a-z0-9_]*\b/.test(combined)
    || /\b(?:soma|somar|subtrai|subtrair|multiplica|multiplicar|divide|dividir|calcula|calcular)\b/.test(combined),
  );
}
function inferGeneratedSpecContext(instruction, ext) {
  return {
    returnType: inferInstructionReturnType(instruction, ext),
    paramTypes: [],
  };
}
function inferInstructionReturnType(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!['.ex', '.exs'].includes(lowerExt)) {
    return 'any()';
  }

  if (extractDiceSides(instruction)) {
    return 'integer()';
  }

  const literalValue = extractLiteralFromInstruction(String(instruction || '').toLowerCase());
  if (/^(true|false)$/.test(literalValue)) {
    return 'boolean()';
  }
  if (/^[+-]?\d+$/.test(literalValue)) {
    return 'integer()';
  }
  if (/^[+-]?\d+\.\d+$/.test(literalValue)) {
    return 'float()';
  }
  if (/^".*"$/.test(literalValue)) {
    return 'String.t()';
  }
  return 'term()';
}
function functionDocumentationSummary(name, instruction, context = {}) {
  const diceSides = extractDiceSides(instruction);
  if (diceSides) {
    return `Retorna um valor aleatorio entre 1 e ${diceSides} simulando a rolagem de um dado.`;
  }

  const lowerInstruction = String(instruction || '').toLowerCase();
  if (/\b(banco|database|db|postgres|postgresql|mysql|mongo|mongodb|prisma)\b/.test(lowerInstruction)) {
    return `Estabelece a conexao principal para ${sanitizeIdentifier(name || 'recurso')}.`;
  }

  const literalValue = extractLiteralFromInstruction(lowerInstruction);
  if (literalValue) {
    return `Retorna ${literalValue} de forma deterministica para o fluxo atual.`;
  }

  return enrichDocumentationSummary(
    functionDescriptionFromName(name || inferFunctionNameFromInstruction(instruction)),
    context,
  );
}
function functionReturnDocumentation(instruction, ext, semanticType = '', context = {}) {
  const diceSides = extractDiceSides(instruction);
  if (diceSides) {
    return `Numero inteiro entre 1 e ${diceSides}.`;
  }

  const literalValue = extractLiteralFromInstruction(String(instruction || '').toLowerCase());
  if (literalValue === 'true' || literalValue === 'false') {
    return `Valor booleano ${literalValue}.`;
  }
  if (literalValue) {
    return `Valor ${literalValue}.`;
  }

  if (semanticType === 'number') {
    return enrichReturnDocumentation('Valor numerico calculado conforme a regra principal da funcao.', context, semanticType);
  }
  if (semanticType === 'string') {
    return enrichReturnDocumentation('Texto resultante produzido pela regra principal da funcao.', context, semanticType);
  }
  if (semanticType === 'boolean') {
    return enrichReturnDocumentation('Resultado booleano que representa o desfecho da regra principal.', context, semanticType);
  }
  if (semanticType === 'array') {
    return enrichReturnDocumentation('Colecao resultante produzida pelo fluxo principal da funcao.', context, semanticType);
  }
  if (semanticType === 'object') {
    return enrichReturnDocumentation('Estrutura de dados retornada ao final do fluxo principal.', context, semanticType);
  }
  if (semanticType === 'void') {
    return enrichReturnDocumentation('Nao retorna valor util para o chamador.', context, semanticType);
  }

  if (isJavaScriptLikeExtension(ext) || isPythonLikeExtension(ext)) {
    return enrichReturnDocumentation('Valor calculado conforme a regra principal da funcao.', context, semanticType);
  }

  return enrichReturnDocumentation('Resultado alinhado ao contrato principal da funcao.', context, semanticType);
}

function enrichDocumentationSummary(summary, context = {}) {
  const base = String(summary || '').trim();
  const projectEntity = String(context && context.projectMemory && context.projectMemory.entity || '').trim();
  const combinedContext = [
    String(context && context.returnExpression || ''),
    ...(Array.isArray(context && context.bodyPreview) ? context.bodyPreview : []),
    ...(Array.isArray(context && context.bodyLines) ? context.bodyLines : []),
  ].join(' ').toLowerCase();

  if (!projectEntity) {
    return base;
  }
  if (!/(room|invite|chat|session|payload|socket|client|participant|message|state)/.test(`${base.toLowerCase()} ${combinedContext}`)) {
    return base;
  }
  if (base.toLowerCase().includes(projectEntity.toLowerCase())) {
    return base;
  }
  return `${base} no fluxo de ${projectEntity}.`;
}

function enrichReturnDocumentation(description, context = {}, semanticType = '') {
  const base = String(description || '').trim();
  const projectEntity = String(context && context.projectMemory && context.projectMemory.entity || '').trim();
  const returnExpression = [
    String(context && context.returnExpression || ''),
    ...(Array.isArray(context && context.bodyPreview) ? context.bodyPreview : []),
    ...(Array.isArray(context && context.bodyLines) ? context.bodyLines : []),
  ].join(' ').toLowerCase();
  if (!projectEntity) {
    return base;
  }
  if (semanticType === 'array' || semanticType === 'object' || /(room|invite|chat|session|payload|socket|client|participant|message|state)/.test(returnExpression)) {
    return `${base} Mantem o contrato observavel de ${projectEntity}.`;
  }
  return base;
}
function extractGeneratedFunctionName(snippet, ext) {
  const lines = String(snippet || '')
    .split('\n')
    .map((line) => String(line).trim())
    .filter(Boolean);
  for (const line of lines) {
    let match = null;
    if (['.ex', '.exs'].includes(String(ext || '').toLowerCase())) {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_?!]*)/);
    } else if (isJavaScriptLikeExtension(ext)) {
      match = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)/);
    } else if (isPythonLikeExtension(ext)) {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    } else if (isGoExtension(ext)) {
      match = line.match(/^func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
    } else if (isRustExtension(ext)) {
      match = line.match(/^(?:async\s+)?fn\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    } else if (String(ext || '').toLowerCase() === '.rb') {
      match = line.match(/^def\s+([a-z_][a-zA-Z0-9_?!]*)/);
    } else if (String(ext || '').toLowerCase() === '.sh') {
      match = line.match(/^([a-z_][a-zA-Z0-9_]*)\s*\(\)\s*\{/);
    } else if (String(ext || '').toLowerCase() === '.vim') {
      match = line.match(/^function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(/);
    } else if (String(ext || '').toLowerCase() === '.lua') {
      match = line.match(/^(?:local\s+)?function\s+([a-z_][a-zA-Z0-9_]*)\s*\(/);
    }

    if (match && match[1]) {
      return sanitizeIdentifier(match[1]);
    }
  }
  return '';
}
function lowercaseFirst(text) {
  const value = String(text || '');
  if (!value) {
    return value;
  }
  return value.charAt(0).toLowerCase() + value.slice(1);
}
function functionBodyIndent(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (lowerExt === '.py') {
    return '    ';
  }
  return '  ';
}
function generateShellFunctionSnippet(instruction) {
  const [rawName, params] = parseFunctionRequest(instruction);
  const functionName = sanitizeIdentifier(rawName || inferFunctionNameFromInstruction(instruction));
  const normalizedParams = Array.isArray(params)
    ? params.map((param) => sanitizeNaturalIdentifier(param)).filter(Boolean)
    : [];

  return [
    `${functionName}() {`,
    ...normalizedParams.map((param, index) => `  ${param}="$${index + 1}"`),
    ...buildShellFunctionBody(instruction, normalizedParams).map((line) => `  ${line}`),
    '}',
  ].join('\n');
}

function buildShellFunctionBody(instruction, params) {
  const lowerInstruction = String(instruction || '').toLowerCase();
  const arithmeticExpression = inferArithmeticExpression(lowerInstruction, params);
  if (arithmeticExpression) {
    return [`printf '%s\\n' "$(( ${arithmeticExpression} ))"`];
  }

  const explicitLiteral = extractLiteralFromInstruction(lowerInstruction);
  if (explicitLiteral) {
    return [`printf '%s\\n' ${explicitLiteral}`];
  }

  return [
    `printf '%s\\n' ${JSON.stringify(`TODO: implementar logica para: ${safeComment(instruction)}`)}`,
  ];
}
function generateDatabaseFunctionSnippet(instruction, ext, fileLines = []) {
  const lowerInstruction = String(instruction || '').toLowerCase();
  const mentionsDatabase = /\b(banco|database|db|postgres|postgresql|mysql|mongo|mongodb|prisma)\b/.test(lowerInstruction);
  const mentionsConnect = /\b(conecta|conectar|conecte|conexao|conexão|connect|connection)\b/.test(lowerInstruction);
  if (!mentionsDatabase || !mentionsConnect) {
    return null;
  }

  const [parsedName] = parseFunctionRequest(instruction);
  const functionName = formatFunctionNameForLanguage(parsedName || inferDatabaseFunctionName(lowerInstruction), ext);
  const lowerExt = ext.toLowerCase();

  if (isJavaScriptLikeExtension(lowerExt)) {
    return generateJavaScriptDatabaseFunctionSnippet(functionName, lowerInstruction, lowerExt, fileLines);
  }

  if (isPythonLikeExtension(lowerExt)) {
    return generatePythonDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (isGoExtension(lowerExt)) {
    return generateGoDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (isRustExtension(lowerExt)) {
    return generateRustDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  if (['.ex', '.exs'].includes(lowerExt)) {
    return generateElixirDatabaseFunctionSnippet(functionName, lowerInstruction);
  }

  return null;
}
function inferDatabaseFunctionName(instruction) {
  if (/\bprisma\b/.test(instruction)) {
    return 'connectPrisma';
  }
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return 'connectMongo';
  }
  if (/\bmysql\b/.test(instruction)) {
    return 'connectMysql';
  }
  if (/\bpostgres\b|\bpostgresql\b/.test(instruction)) {
    return 'connectPostgres';
  }
  return 'connectDatabase';
}
function formatFunctionNameForLanguage(name, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isGoExtension(lowerExt) || isJavaScriptLikeExtension(lowerExt)) {
    return toCamelCaseIdentifier(name);
  }
  if (isPythonLikeExtension(lowerExt) || isRustExtension(lowerExt) || ['.ex', '.exs'].includes(lowerExt)) {
    return toSnakeCaseIdentifier(name);
  }
  return sanitizeIdentifier(name);
}
function toSnakeCaseIdentifier(value) {
  const raw = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
  return raw || 'funcao_gerada';
}
function toCamelCaseIdentifier(value) {
  const parts = String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) {
    return 'funcaoGerada';
  }
  return parts
    .map((part, index) => {
      const lower = part.toLowerCase();
      if (index === 0) {
        return lower;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join('');
}
function generateJavaScriptDatabaseFunctionSnippet(functionName, instruction, ext, lines = []) {
  const style = inferModuleStyle(ext, lines);

  if (/\bprisma\b/.test(instruction)) {
    return {
      snippet: [
        `function ${functionName}() {`,
        '  return new PrismaClient();',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('named', 'PrismaClient', '@prisma/client', style)],
    };
  }

  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `async function ${functionName}() {`,
        '  const client = new MongoClient(process.env.MONGODB_URL);',
        '  await client.connect();',
        '  return client;',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('named', 'MongoClient', 'mongodb', style)],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `async function ${functionName}() {`,
        '  return mysql.createConnection({',
        '    uri: process.env.DATABASE_URL,',
        '  });',
        '}',
      ].join('\n'),
      dependencies: [jsDependencySpec('default', 'mysql', 'mysql2/promise', style)],
    };
  }

  return {
    snippet: [
      `function ${functionName}() {`,
      '  return new Pool({',
      '    connectionString: process.env.DATABASE_URL,',
      '  });',
      '}',
    ].join('\n'),
    dependencies: [jsDependencySpec('named', 'Pool', 'pg', style)],
  };
}
function generatePythonDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    client = MongoClient(os.environ["MONGODB_URL"])',
        '    return client',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('from', 'pymongo', 'MongoClient'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    return mysql.connector.connect(',
        '        option_files=os.environ["MYSQL_CONFIG_PATH"],',
        '    )',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('import', 'mysql.connector'),
      ],
    };
  }

  if (/\bpostgres\b|\bpostgresql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}():`,
        '    return psycopg.connect(os.environ["DATABASE_URL"])',
      ].join('\n'),
      dependencies: [
        pythonDependencySpec('import', 'os'),
        pythonDependencySpec('import', 'psycopg'),
      ],
    };
  }

  return {
    snippet: [
      `def ${functionName}():`,
      '    return create_engine(os.environ["DATABASE_URL"])',
    ].join('\n'),
    dependencies: [
      pythonDependencySpec('import', 'os'),
      pythonDependencySpec('from', 'sqlalchemy', 'create_engine'),
    ],
  };
}
function generateGoDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `func ${functionName}(ctx context.Context) (*mongo.Client, error) {`,
        '  return mongo.Connect(ctx, options.Client().ApplyURI(os.Getenv("MONGODB_URL")))',
        '}',
      ].join('\n'),
      dependencies: [
        goDependencySpec('context'),
        goDependencySpec('os'),
        goDependencySpec('go.mongodb.org/mongo-driver/mongo'),
        goDependencySpec('go.mongodb.org/mongo-driver/mongo/options'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `func ${functionName}() (*sql.DB, error) {`,
        '  return sql.Open("mysql", os.Getenv("DATABASE_URL"))',
        '}',
      ].join('\n'),
      dependencies: [
        goDependencySpec('database/sql'),
        goDependencySpec('os'),
        goDependencySpec('github.com/go-sql-driver/mysql', '_'),
      ],
    };
  }

  return {
    snippet: [
      `func ${functionName}() (*sql.DB, error) {`,
      '  return sql.Open("postgres", os.Getenv("DATABASE_URL"))',
      '}',
    ].join('\n'),
    dependencies: [
      goDependencySpec('database/sql'),
      goDependencySpec('os'),
      goDependencySpec('github.com/lib/pq', '_'),
    ],
  };
}
function generateRustDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `async fn ${functionName}() -> mongodb::error::Result<Client> {`,
        '    Client::with_uri_str(std::env::var("MONGODB_URL").expect("MONGODB_URL nao definido")).await',
        '}',
      ].join('\n'),
      dependencies: [
        rustDependencySpec('mongodb::Client'),
      ],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `async fn ${functionName}() -> Result<MySqlPool, sqlx::Error> {`,
        '    MySqlPoolOptions::new()',
        '        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL nao definido"))',
        '        .await',
        '}',
      ].join('\n'),
      dependencies: [
        rustDependencySpec('sqlx::MySqlPool'),
        rustDependencySpec('sqlx::mysql::MySqlPoolOptions'),
      ],
    };
  }

  return {
    snippet: [
      `async fn ${functionName}() -> Result<PgPool, sqlx::Error> {`,
      '    PgPoolOptions::new()',
      '        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL nao definido"))',
      '        .await',
      '}',
    ].join('\n'),
    dependencies: [
      rustDependencySpec('sqlx::PgPool'),
      rustDependencySpec('sqlx::postgres::PgPoolOptions'),
    ],
  };
}
function generateElixirDatabaseFunctionSnippet(functionName, instruction) {
  if (/\bmongo\b|\bmongodb\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}(opts \\\\ []) do`,
        '  Mongo.start_link([',
        '    url: System.get_env("MONGODB_URL"),',
        '    name: __MODULE__.Mongo,',
        '  ] ++ opts)',
        'end',
      ].join('\n'),
      dependencies: [],
    };
  }

  if (/\bmysql\b/.test(instruction)) {
    return {
      snippet: [
        `def ${functionName}(opts \\\\ []) do`,
        '  MyXQL.start_link(',
        '    Keyword.merge([',
        '      hostname: "localhost",',
        '      username: "root",',
        '      password: "root",',
        '      database: "app_dev",',
        '    ], opts)',
        '  )',
        'end',
      ].join('\n'),
      dependencies: [],
    };
  }

  return {
    snippet: [
      `def ${functionName}(opts \\\\ []) do`,
      '  Postgrex.start_link(',
      '    Keyword.merge([',
      '      hostname: "localhost",',
      '      username: "postgres",',
      '      password: "postgres",',
      '      database: "app_dev",',
      '    ], opts)',
      '  )',
      'end',
    ].join('\n'),
    dependencies: [],
  };
}
function generateCrudSnippet(instruction, ext) {
  const entityName = parseCrudEntityName(instruction);
  const lowerExt = String(ext || '').toLowerCase();

  if (isJavaScriptLikeExtension(lowerExt)) {
    return generateJavaScriptCrudSnippet(entityName);
  }
  if (isPythonLikeExtension(lowerExt)) {
    return generatePythonCrudSnippet(entityName);
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return generateElixirCrudSnippet(entityName);
  }
  if (isGoExtension(lowerExt)) {
    return generateGoCrudSnippet(entityName);
  }
  if (isRustExtension(lowerExt)) {
    return generateRustCrudSnippet(entityName);
  }
  if (lowerExt === '.lua') {
    return generateLuaCrudSnippet(entityName);
  }

  return generateGenericCrudSnippet(entityName, ext);
}
function generateExampleSnippet(instruction, ext) {
  const lower = String(instruction || '').toLowerCase();
  if (/\bsolid\b/.test(lower)) {
    return generateSolidExampleSnippet(ext);
  }
  return generateGenericSnippet(instruction, ext);
}
function generateSolidExampleSnippet(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (isJavaScriptLikeExtension(lowerExt)) {
    return [
      jsDocBlock(
        'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
        [{ name: 'payload', description: 'Dados de entrada do usuario.' }],
        'Payload validado para o fluxo de criacao.',
      ),
      'export function validateUserPayload(payload) {',
      '  if (!payload?.email) {',
      '    throw new Error("email obrigatorio");',
      '  }',
      '  return { ...payload };',
      '}',
      '',
      jsDocBlock(
        'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
        [
          { name: 'repository', description: 'Porta de persistencia com a funcao save.' },
          { name: 'notifier', description: 'Porta de notificacao com a funcao sendWelcome.' },
        ],
        'Funcao de criacao de usuario desacoplada das implementacoes concretas.',
      ),
      'export function buildCreateUser({ repository, notifier }) {',
      '  return function createUser(payload) {',
      '    const user = repository.save(validateUserPayload(payload));',
      '    notifier.sendWelcome(user.email);',
      '    return user;',
      '  };',
      '}',
      '',
      jsDocBlock(
        'Aplica o principio aberto para extensao por meio de formatador injetado.',
        [{ name: 'formatter', description: 'Funcao que formata o usuario para a camada consumidora.' }],
        'Funcao especializada para apresentar usuarios sem alterar o fluxo principal.',
      ),
      'export function buildUserPresenter(formatter) {',
      '  return function presentUser(user) {',
      '    return formatter(user);',
      '  };',
      '}',
    ].join('\n');
  }

  if (isPythonLikeExtension(lowerExt)) {
    return [
      'def validate_user_payload(payload):',
      pythonDocstringBlock(
        'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
        [{ name: 'payload', description: 'Dados de entrada do usuario.' }],
        'Payload validado para o fluxo de criacao.',
      ),
      '    if not payload.get("email"):',
      '        raise ValueError("email obrigatorio")',
      '    return {**payload}',
      '',
      'def build_create_user(repository, notifier):',
      pythonDocstringBlock(
        'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
        [
          { name: 'repository', description: 'Porta de persistencia com a funcao save.' },
          { name: 'notifier', description: 'Porta de notificacao com a funcao send_welcome.' },
        ],
        'Funcao de criacao de usuario desacoplada das implementacoes concretas.',
      ),
      '    def create_user(payload):',
      '        user = repository["save"](validate_user_payload(payload))',
      '        notifier["send_welcome"](user["email"])',
      '        return user',
      '',
      '    return create_user',
      '',
      'def build_user_presenter(formatter):',
      pythonDocstringBlock(
        'Aplica o principio aberto para extensao por meio de formatador injetado.',
        [{ name: 'formatter', description: 'Funcao que formata o usuario para a camada consumidora.' }],
        'Funcao especializada para apresentar usuarios sem alterar o fluxo principal.',
      ),
      '    def present_user(user):',
      '        return formatter(user)',
      '',
      '    return present_user',
    ].join('\n');
  }

  if (['.ex', '.exs'].includes(lowerExt)) {
    return [
      '@doc """',
      'Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.',
      '"""',
      '@spec validate_user_payload(map()) :: map()',
      'def validate_user_payload(payload) do',
      '  if Map.get(payload, :email) || Map.get(payload, "email") do',
      '    payload',
      '  else',
      '    raise ArgumentError, "email obrigatorio"',
      '  end',
      'end',
      '',
      '@doc """',
      'Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.',
      '"""',
      '@spec build_create_user((map() -> map()), (String.t() -> any())) :: (map() -> map())',
      'def build_create_user(save_user, send_welcome) do',
      '  fn payload ->',
      '    user = payload |> validate_user_payload() |> save_user.()',
      '    send_welcome.(Map.get(user, :email, Map.get(user, "email")))',
      '    user',
      '  end',
      'end',
      '',
      '@doc """',
      'Aplica o principio aberto para extensao por meio de formatador injetado.',
      '"""',
      '@spec build_user_presenter((map() -> any())) :: (map() -> any())',
      'def build_user_presenter(formatter) do',
      '  fn user -> formatter.(user) end',
      'end',
    ].join('\n');
  }

  if (isGoExtension(lowerExt)) {
    return [
      goDocLine('ValidateUserPayload', 'valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.'),
      'func ValidateUserPayload(payload map[string]any) (map[string]any, error) {',
      '  if _, ok := payload["email"]; !ok {',
      '    return nil, errors.New("email obrigatorio")',
      '  }',
      '  copia := map[string]any{}',
      '  for chave, valor := range payload {',
      '    copia[chave] = valor',
      '  }',
      '  return copia, nil',
      '}',
      '',
      'type SaveUser func(map[string]any) map[string]any',
      'type SendWelcome func(string)',
      '',
      goDocLine('BuildCreateUser', 'constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.'),
      'func BuildCreateUser(saveUser SaveUser, sendWelcome SendWelcome) func(map[string]any) (map[string]any, error) {',
      '  return func(payload map[string]any) (map[string]any, error) {',
      '    validated, err := ValidateUserPayload(payload)',
      '    if err != nil {',
      '      return nil, err',
      '    }',
      '    user := saveUser(validated)',
      '    if email, ok := user["email"].(string); ok {',
      '      sendWelcome(email)',
      '    }',
      '    return user, nil',
      '  }',
      '}',
      '',
      goDocLine('BuildUserPresenter', 'aplica o principio aberto para extensao por meio de formatador injetado.'),
      'func BuildUserPresenter(formatter func(map[string]any) string) func(map[string]any) string {',
      '  return func(user map[string]any) string {',
      '    return formatter(user)',
      '  }',
      '}',
    ].join('\n');
  }

  if (isRustExtension(lowerExt)) {
    return [
      'use std::collections::HashMap;',
      '',
      rustDocLine('Valida os dados do usuario sem efeito colateral, mantendo responsabilidade unica.'),
      'pub fn validate_user_payload(payload: &HashMap<String, String>) -> Result<HashMap<String, String>, String> {',
      '    if !payload.contains_key("email") {',
      '        return Err("email obrigatorio".to_string());',
      '    }',
      '    Ok(payload.clone())',
      '}',
      '',
      rustDocLine('Constroi um caso de uso aplicando inversao de dependencia com funcoes injetadas.'),
      'pub fn build_create_user<SaveUser, SendWelcome>(',
      '    save_user: SaveUser,',
      '    send_welcome: SendWelcome,',
      ') -> impl Fn(HashMap<String, String>) -> Result<HashMap<String, String>, String>',
      'where',
      '    SaveUser: Fn(HashMap<String, String>) -> HashMap<String, String> + Clone,',
      '    SendWelcome: Fn(String) + Clone,',
      '{',
      '    move |payload| {',
      '        let validated = validate_user_payload(&payload)?;',
      '        let user = save_user(validated);',
      '        if let Some(email) = user.get("email") {',
      '            send_welcome(email.clone());',
      '        }',
      '        Ok(user)',
      '    }',
      '}',
      '',
      rustDocLine('Aplica o principio aberto para extensao por meio de formatador injetado.'),
      'pub fn build_user_presenter<Formatter>(',
      '    formatter: Formatter,',
      ') -> impl Fn(HashMap<String, String>) -> String',
      'where',
      '    Formatter: Fn(HashMap<String, String>) -> String + Clone,',
      '{',
      '    move |user| formatter(user)',
      '}',
    ].join('\n');
  }

  return [
    `${commentPrefix(ext)} Exemplo SOLID: separe validacao, persistencia e apresentacao em responsabilidades distintas.`,
    `${commentPrefix(ext)} Injete dependencias para manter o fluxo aberto para extensao e fechado para modificacao.`,
  ].join('\n');
}
function parseCrudEntityName(instruction) {
  const text = String(instruction || '').trim();
  const patterns = [
    /\bcrud\b(?:\s+(?:completo|complete|full))?(?:\s+(?:de|do|da|para))?\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)/i,
    /\b([a-zà-ÿ_][a-zà-ÿ0-9_-]*)\s+crud\b(?:\s+(?:completo|complete|full))?/i,
    /\bcrud\b\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)\s+(?:completo|complete|full)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = sanitizeNaturalIdentifier(match[1]);
      if (candidate && !['crud', 'completo', 'complete', 'full'].includes(candidate.toLowerCase())) {
        return candidate;
      }
    }
  }
  return 'registro';
}
function crudEntityNames(entityName) {
  const singularSnake = toSnakeCaseIdentifier(entityName || 'registro');
  const pluralSnake = pluralizeIdentifier(singularSnake);
  const singularCamel = toCamelCaseIdentifier(singularSnake);
  const pluralCamel = toCamelCaseIdentifier(pluralSnake);
  const singularPascal = upperFirst(singularCamel);
  const pluralPascal = upperFirst(pluralCamel);

  return {
    singularSnake,
    pluralSnake,
    singularCamel,
    pluralCamel,
    singularPascal,
    pluralPascal,
  };
}
function pluralizeIdentifier(name) {
  const value = String(name || '').trim();
  if (!value) {
    return 'registros';
  }
  if (/s$/.test(value)) {
    return value;
  }
  return `${value}s`;
}
function upperFirst(text) {
  const value = String(text || '');
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}
function jsDocBlock(summary, paramDocs, returnDoc) {
  const params = Array.isArray(paramDocs) ? paramDocs : [];
  return [
    '/**',
    ` * ${summary}`,
    ...params.map((paramDoc) => ` * @param {*} ${paramDoc.name} ${paramDoc.description}`),
    ` * @returns {*} ${returnDoc}`,
    ' */',
  ].join('\n');
}
function pythonDocstringBlock(summary, paramDocs, returnDoc, indent = '    ') {
  const params = Array.isArray(paramDocs) ? paramDocs : [];
  return [
    `${indent}"""`,
    `${indent}${summary}`,
    '',
    `${indent}Args:`,
    ...(params.length
      ? params.map((paramDoc) => `${indent}    ${paramDoc.name}: ${paramDoc.description}`)
      : [`${indent}    Nenhum argumento recebido.`]),
    '',
    `${indent}Returns:`,
    `${indent}    ${returnDoc}`,
    `${indent}"""`,
  ].join('\n');
}
function goDocLine(functionName, summary) {
  return `// ${functionName} ${lowercaseFirst(summary)}`;
}
function rustDocLine(summary) {
  return `/// ${summary}`;
}
function generateJavaScriptCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralCamel;
  const item = names.singularCamel;
  const listName = `listar${names.pluralPascal}`;
  const findName = `buscar${names.singularPascal}PorId`;
  const createName = `criar${names.singularPascal}`;
  const updateName = `atualizar${names.singularPascal}`;
  const removeName = `remover${names.singularPascal}`;

  return [
    jsDocBlock(
      `Retorna a colecao atual de ${collection} sem mutacao.`,
      [{ name: collection, description: `Colecao atual de ${collection}.` }],
      `Colecao atual de ${collection}.`,
    ),
    `export function ${listName}(${collection}) {`,
    `  return ${collection};`,
    '}',
    '',
    jsDocBlock(
      `Busca um ${item} pelo identificador informado.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
      ],
      `${upperFirst(item)} encontrado ou null quando nao existir.`,
    ),
    `export function ${findName}(${collection}, id) {`,
    `  return ${collection}.find((${item}) => ${item}.id === id) ?? null;`,
    '}',
    '',
    jsDocBlock(
      `Cria um novo ${item} sem alterar a colecao original.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'payload', description: `Dados de entrada para ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} criado.`,
    ),
    `export function ${createName}(${collection}, payload) {`,
    '  const proximoId =',
    `    ${collection}.reduce(`,
    `      (maiorId, ${item}) => Math.max(maiorId, Number(${item}.id ?? 0)),`,
    '      0,',
    '    ) + 1;',
    `  const novo${names.singularPascal} = { ...payload, id: proximoId };`,
    '  return {',
    `    ${collection}: [...${collection}, novo${names.singularPascal}],`,
    `    ${item}: novo${names.singularPascal},`,
    '  };',
    '}',
    '',
    jsDocBlock(
      `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
        { name: 'changes', description: `Campos a serem atualizados em ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} atualizado ou null.`,
    ),
    `export function ${updateName}(${collection}, id, changes) {`,
    `  const ${item}Atual = ${findName}(${collection}, id);`,
    `  if (!${item}Atual) {`,
    `    return { ${collection}, ${item}: null };`,
    '  }',
    `  const ${item}Atualizado = { ...${item}Atual, ...changes, id: ${item}Atual.id };`,
    '  return {',
    `    ${collection}: ${collection}.map((registro) => (registro.id === id ? ${item}Atualizado : registro)),`,
    `    ${item}: ${item}Atualizado,`,
    '  };',
    '}',
    '',
    jsDocBlock(
      `Remove um ${item} da colecao de forma funcional.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'id', description: `Identificador de ${item}.` },
      ],
      `Objeto contendo a nova colecao de ${collection} e o ${item} removido ou null.`,
    ),
    `export function ${removeName}(${collection}, id) {`,
    `  const ${item}Removido = ${findName}(${collection}, id);`,
    '  return {',
    `    ${collection}: ${collection}.filter((registro) => registro.id !== id),`,
    `    ${item}: ${item}Removido,`,
    '  };',
    '}',
  ].join('\n');
}
function generatePythonCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName = `listar_${collection}`;
  const findName = `buscar_${item}_por_id`;
  const createName = `criar_${item}`;
  const updateName = `atualizar_${item}`;
  const removeName = `remover_${item}`;

  return [
    `def ${listName}(${collection}):`,
    pythonDocstringBlock(
      `Retorna a colecao atual de ${collection} sem mutacao.`,
      [{ name: collection, description: `Colecao atual de ${collection}.` }],
      `Colecao atual de ${collection}.`,
    ),
    `    return ${collection}`,
    '',
    `def ${findName}(${collection}, identificador):`,
    pythonDocstringBlock(
      `Busca um ${item} pelo identificador informado.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
      ],
      `${upperFirst(item)} encontrado ou None quando nao existir.`,
    ),
    `    return next((registro for registro in ${collection} if registro.get("id") == identificador), None)`,
    '',
    `def ${createName}(${collection}, payload):`,
    pythonDocstringBlock(
      `Cria um novo ${item} sem alterar a colecao original.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'payload', description: `Dados de entrada para ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} criado.`,
    ),
    `    proximo_id = max((int(registro.get("id", 0)) for registro in ${collection}), default=0) + 1`,
    `    novo_${item} = {"id": proximo_id, **payload}`,
    `    return {"${collection}": [*${collection}, novo_${item}], "${item}": novo_${item}}`,
    '',
    `def ${updateName}(${collection}, identificador, changes):`,
    pythonDocstringBlock(
      `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
        { name: 'changes', description: `Campos a serem atualizados em ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} atualizado ou None.`,
    ),
    `    ${item}_atual = ${findName}(${collection}, identificador)`,
    `    if ${item}_atual is None:`,
    `        return {"${collection}": ${collection}, "${item}": None}`,
    `    ${item}_atualizado = {**${item}_atual, **changes, "id": ${item}_atual.get("id")}`,
    `    return {`,
    `        "${collection}": [${item}_atualizado if registro.get("id") == identificador else registro for registro in ${collection}],`,
    `        "${item}": ${item}_atualizado,`,
    '    }',
    '',
    `def ${removeName}(${collection}, identificador):`,
    pythonDocstringBlock(
      `Remove um ${item} da colecao de forma funcional.`,
      [
        { name: collection, description: `Colecao atual de ${collection}.` },
        { name: 'identificador', description: `Identificador de ${item}.` },
      ],
      `Dicionario contendo a nova colecao de ${collection} e o ${item} removido ou None.`,
    ),
    `    ${item}_removido = ${findName}(${collection}, identificador)`,
    '    return {',
    `        "${collection}": [registro for registro in ${collection} if registro.get("id") != identificador],`,
    `        "${item}": ${item}_removido,`,
    '    }',
  ].join('\n');
}
function generateElixirCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName = `listar_${collection}`;
  const findName = `buscar_${item}_por_id`;
  const createName = `criar_${item}`;
  const updateName = `atualizar_${item}`;
  const removeName = `remover_${item}`;

  return [
    '@doc """',
    `Retorna a colecao atual de ${collection} sem mutacao.`,
    '"""',
    `@spec ${listName}(list(map())) :: list(map())`,
    `def ${listName}(${collection}), do: ${collection}`,
    '',
    '@doc """',
    `Busca um ${item} pelo identificador informado.`,
    '"""',
    `@spec ${findName}(list(map()), term()) :: map() | nil`,
    `def ${findName}(${collection}, id) do`,
    `  Enum.find(${collection}, fn registro ->`,
    '    Map.get(registro, :id, Map.get(registro, "id")) == id',
    '  end)',
    'end',
    '',
    '@doc """',
    `Cria um novo ${item} sem alterar a colecao original.`,
    '"""',
    `@spec ${createName}(list(map()), map()) :: %{${collection}: list(map()), ${item}: map()}`,
    `def ${createName}(${collection}, payload) do`,
    '  proximo_id =',
    `    ${collection}`,
    '    |> Enum.map(fn registro -> Map.get(registro, :id, Map.get(registro, "id", 0)) end)',
    '    |> Enum.map(fn valor -> if is_integer(valor), do: valor, else: 0 end)',
    '    |> Enum.max(fn -> 0 end)',
    '    |> Kernel.+(1)',
    '',
    `  novo_${item} = Map.put(payload, :id, proximo_id)`,
    `%{${collection}: ${collection} ++ [novo_${item}], ${item}: novo_${item}}`,
    'end',
    '',
    '@doc """',
    `Atualiza um ${item} existente preservando a imutabilidade da colecao.`,
    '"""',
    `@spec ${updateName}(list(map()), term(), map()) :: %{${collection}: list(map()), ${item}: map() | nil}`,
    `def ${updateName}(${collection}, id, changes) do`,
    `  ${item}_atual = ${findName}(${collection}, id)`,
    '',
    `  if is_nil(${item}_atual) do`,
    `    %{${collection}: ${collection}, ${item}: nil}`,
    '  else',
    `    ${item}_atualizado = Map.merge(${item}_atual, changes) |> Map.put(:id, Map.get(${item}_atual, :id, Map.get(${item}_atual, "id")))`,
    '',
    '    %{',
    `      ${collection}: Enum.map(${collection}, fn registro -> if Map.get(registro, :id, Map.get(registro, "id")) == id, do: ${item}_atualizado, else: registro end),`,
    `      ${item}: ${item}_atualizado`,
    '    }',
    '  end',
    'end',
    '',
    '@doc """',
    `Remove um ${item} da colecao de forma funcional.`,
    '"""',
    `@spec ${removeName}(list(map()), term()) :: %{${collection}: list(map()), ${item}: map() | nil}`,
    `def ${removeName}(${collection}, id) do`,
    `  ${item}_removido = ${findName}(${collection}, id)`,
    '',
    '  %{',
    `    ${collection}: Enum.reject(${collection}, fn registro -> Map.get(registro, :id, Map.get(registro, "id")) == id end),`,
    `    ${item}: ${item}_removido`,
    '  }',
    'end',
  ].join('\n');
}
function generateGoCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const singularPascal = names.singularPascal;
  const pluralPascal = names.pluralPascal;
  const listName = `Listar${pluralPascal}`;
  const findName = `Buscar${singularPascal}PorID`;
  const createName = `Criar${singularPascal}`;
  const updateName = `Atualizar${singularPascal}`;
  const removeName = `Remover${singularPascal}`;

  return [
    `type ${singularPascal} map[string]any`,
    '',
    `type ${singularPascal}MutationResult struct {`,
    `  ${pluralPascal} []${singularPascal}`,
    `  ${singularPascal} ${singularPascal}`,
    '}',
    '',
    goDocLine(listName, `retorna a colecao atual de ${names.pluralSnake} sem mutacao.`),
    `func ${listName}(${names.pluralCamel} []${singularPascal}) []${singularPascal} {`,
    `  return ${names.pluralCamel}`,
    '}',
    '',
    goDocLine(findName, `busca um ${names.singularSnake} pelo identificador informado.`),
    `func ${findName}(${names.pluralCamel} []${singularPascal}, id int) (${singularPascal}, bool) {`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    '      return registro, true',
    '    }',
    '  }',
    `  return ${singularPascal}{}, false`,
    '}',
    '',
    goDocLine(createName, `cria um novo ${names.singularSnake} sem alterar a colecao original.`),
    `func ${createName}(${names.pluralCamel} []${singularPascal}, payload ${singularPascal}) ${singularPascal}MutationResult {`,
    '  proximoID := 1',
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor >= proximoID {',
    '      proximoID = valor + 1',
    '    }',
    '  }',
    `  novo${singularPascal} := clone${singularPascal}(payload)`,
    `  novo${singularPascal}["id"] = proximoID`,
    `  novos${pluralPascal} := append(append([]${singularPascal}{}, ${names.pluralCamel}...), novo${singularPascal})`,
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: novo${singularPascal}}`,
    '}',
    '',
    goDocLine(updateName, `atualiza um ${names.singularSnake} existente preservando a imutabilidade da colecao.`),
    `func ${updateName}(${names.pluralCamel} []${singularPascal}, id int, changes ${singularPascal}) ${singularPascal}MutationResult {`,
    `  ${names.singularCamel}Atual, ok := ${findName}(${names.pluralCamel}, id)`,
    '  if !ok {',
    `    return ${singularPascal}MutationResult{${pluralPascal}: ${names.pluralCamel}, ${singularPascal}: ${singularPascal}{}}`,
    '  }',
    `  ${names.singularCamel}Atualizado := clone${singularPascal}(${names.singularCamel}Atual)`,
    '  for chave, valor := range changes {',
    '    if chave != "id" {',
    `      ${names.singularCamel}Atualizado[chave] = valor`,
    '    }',
    '  }',
    `  novos${pluralPascal} := make([]${singularPascal}, 0, len(${names.pluralCamel}))`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    `      novos${pluralPascal} = append(novos${pluralPascal}, ${names.singularCamel}Atualizado)`,
    '      continue',
    '    }',
    `    novos${pluralPascal} = append(novos${pluralPascal}, registro)`,
    '  }',
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: ${names.singularCamel}Atualizado}`,
    '}',
    '',
    goDocLine(removeName, `remove um ${names.singularSnake} da colecao de forma funcional.`),
    `func ${removeName}(${names.pluralCamel} []${singularPascal}, id int) ${singularPascal}MutationResult {`,
    `  ${names.singularCamel}Removido, _ := ${findName}(${names.pluralCamel}, id)`,
    `  novos${pluralPascal} := make([]${singularPascal}, 0, len(${names.pluralCamel}))`,
    `  for _, registro := range ${names.pluralCamel} {`,
    '    valor, ok := registro["id"].(int)',
    '    if ok && valor == id {',
    '      continue',
    '    }',
    `    novos${pluralPascal} = append(novos${pluralPascal}, registro)`,
    '  }',
    `  return ${singularPascal}MutationResult{${pluralPascal}: novos${pluralPascal}, ${singularPascal}: ${names.singularCamel}Removido}`,
    '}',
    '',
    goDocLine(`clone${singularPascal}`, `cria uma copia rasa de ${names.singularSnake} para preservar imutabilidade.`),
    `func clone${singularPascal}(origem ${singularPascal}) ${singularPascal} {`,
    `  copia := make(${singularPascal}, len(origem))`,
    '  for chave, valor := range origem {',
    '    copia[chave] = valor',
    '  }',
    '  return copia',
    '}',
  ].join('\n');
}
function generateRustCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const singularPascal = names.singularPascal;
  const pluralSnake = names.pluralSnake;
  const item = names.singularSnake;

  return [
    'pub type Registro = std::collections::HashMap<String, String>;',
    '',
    `pub struct ${singularPascal}MutationResult {`,
    `    pub ${pluralSnake}: Vec<Registro>,`,
    `    pub ${item}: Option<Registro>,`,
    '}',
    '',
    rustDocLine(`Retorna a colecao atual de ${pluralSnake} sem mutacao.`),
    `pub fn listar_${pluralSnake}(${pluralSnake}: &[Registro]) -> Vec<Registro> {`,
    `    ${pluralSnake}.to_vec()`,
    '}',
    '',
    rustDocLine(`Busca um ${item} pelo identificador informado.`),
    `pub fn buscar_${item}_por_id(${pluralSnake}: &[Registro], id: &str) -> Option<Registro> {`,
    `    ${pluralSnake}`,
    '        .iter()',
    '        .find(|registro| registro.get("id").map(String::as_str) == Some(id))',
    '        .cloned()',
    '}',
    '',
    rustDocLine(`Cria um novo ${item} sem alterar a colecao original.`),
    `pub fn criar_${item}(${pluralSnake}: &[Registro], payload: &Registro) -> ${singularPascal}MutationResult {`,
    '    let proximo_id =',
    `        ${pluralSnake}`,
    '            .iter()',
    '            .filter_map(|registro| registro.get("id").and_then(|valor| valor.parse::<usize>().ok()))',
    '            .max()',
    '            .unwrap_or(0)',
    '            + 1;',
    `    let mut novo_${item} = payload.clone();`,
    `    novo_${item}.insert("id".to_string(), proximo_id.to_string());`,
    `    let mut novos_${pluralSnake} = ${pluralSnake}.to_vec();`,
    `    novos_${pluralSnake}.push(novo_${item}.clone());`,
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: Some(novo_${item}) }`,
    '}',
    '',
    rustDocLine(`Atualiza um ${item} existente preservando a imutabilidade da colecao.`),
    `pub fn atualizar_${item}(${pluralSnake}: &[Registro], id: &str, changes: &Registro) -> ${singularPascal}MutationResult {`,
    `    let ${item}_atual = buscar_${item}_por_id(${pluralSnake}, id);`,
    `    let Some(base_${item}) = ${item}_atual.clone() else {`,
    `        return ${singularPascal}MutationResult { ${pluralSnake}: ${pluralSnake}.to_vec(), ${item}: None };`,
    '    };',
    `    let mut ${item}_atualizado = base_${item}.clone();`,
    '    for (chave, valor) in changes.iter() {',
    '        if chave != "id" {',
    `            ${item}_atualizado.insert(chave.clone(), valor.clone());`,
    '        }',
    '    }',
    `    let novos_${pluralSnake} = ${pluralSnake}`,
    '        .iter()',
    `        .map(|registro| if registro.get("id").map(String::as_str) == Some(id) { ${item}_atualizado.clone() } else { registro.clone() })`,
    '        .collect::<Vec<_>>();',
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: Some(${item}_atualizado) }`,
    '}',
    '',
    rustDocLine(`Remove um ${item} da colecao de forma funcional.`),
    `pub fn remover_${item}(${pluralSnake}: &[Registro], id: &str) -> ${singularPascal}MutationResult {`,
    `    let ${item}_removido = buscar_${item}_por_id(${pluralSnake}, id);`,
    `    let novos_${pluralSnake} = ${pluralSnake}`,
    '        .iter()',
    '        .filter(|registro| registro.get("id").map(String::as_str) != Some(id))',
    '        .cloned()',
    '        .collect::<Vec<_>>();',
    `    ${singularPascal}MutationResult { ${pluralSnake}: novos_${pluralSnake}, ${item}: ${item}_removido }`,
    '}',
  ].join('\n');
}
function generateLuaCrudSnippet(entityName) {
  const names = crudEntityNames(entityName);
  const collection = names.pluralSnake;
  const item = names.singularSnake;
  const listName =     `listar_${collection}`;
  const findName =     `buscar_${item}_por_id`;
  const createName =     `criar_${item}`;
  const updateName =     `atualizar_${item}`;
  const removeName =     `remover_${item}`;
  const cloneItemName =     `clone_${item}`;
  const cloneCollectionName =     `clone_${collection}`;

  return [
    `-- Funcao ${cloneItemName}: cria uma copia rasa de ${item} para evitar mutacao compartilhada.`,
    `local function ${cloneItemName}(origem)`,
    '  local copia = {}',
    '  for chave, valor in pairs(origem or {}) do',
    '    copia[chave] = valor',
    '  end',
    '  return copia',
    'end',
    '',
    `-- Funcao ${cloneCollectionName}: duplica a colecao preservando o contrato funcional do fluxo.`,
    `local function ${cloneCollectionName}(origem)`,
    '  local copia = {}',
    '  for indice, registro in ipairs(origem or {}) do',
    `    copia[indice] = ${cloneItemName}(registro)`,
    '  end',
    '  return copia',
    'end',
    '',
    `-- Funcao ${listName}: retorna a colecao atual de ${collection} sem mutacao.`,
    `function ${listName}(${collection})`,
    `  return ${cloneCollectionName}(${collection})`,
    'end',
    '',
    `-- Funcao ${findName}: busca um ${item} pelo identificador informado.`,
    `function ${findName}(${collection}, id)`,
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    if registro.id == id then',
    `      return ${cloneItemName}(registro)`,
    '    end',
    '  end',
    '  return nil',
    'end',
    '',
    `-- Funcao ${createName}: cria um novo ${item} preservando a imutabilidade da colecao.`,
    `function ${createName}(${collection}, payload)`,
    '  local proximo_id = 1',
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    local id_atual = tonumber(registro.id) or 0',
    '    if id_atual >= proximo_id then',
    '      proximo_id = id_atual + 1',
    '    end',
    '  end',
    `  local novo_${item} = ${cloneItemName}(payload or {})`,
    `  novo_${item}.id = proximo_id`,
    `  local novos_${collection} = ${cloneCollectionName}(${collection})`,
    `  table.insert(novos_${collection}, ${cloneItemName}(novo_${item}))`,
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${cloneItemName}(novo_${item}),`,
    '  }',
    'end',
    '',
    `-- Funcao ${updateName}: atualiza um ${item} existente preservando a imutabilidade da colecao.`,
    `function ${updateName}(${collection}, id, changes)`,
    `  local ${item}_atual = ${findName}(${collection}, id)`,
    `  if ${item}_atual == nil then`,
    '    return {',
    `      ${collection} = ${cloneCollectionName}(${collection}),`,
    `      ${item} = nil,`,
    '    }',
    '  end',
    `  local ${item}_atualizado = ${cloneItemName}(${item}_atual)`,
    '  for chave, valor in pairs(changes or {}) do',
    '    if chave ~= "id" then',
    `      ${item}_atualizado[chave] = valor`,
    '    end',
    '  end',
    `  local novos_${collection} = {}`,
    `  for indice, registro in ipairs(${collection} or {}) do`,
    '    if registro.id == id then',
    `      novos_${collection}[indice] = ${cloneItemName}(${item}_atualizado)`,
    '    else',
    `      novos_${collection}[indice] = ${cloneItemName}(registro)`,
    '    end',
    '  end',
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${cloneItemName}(${item}_atualizado),`,
    '  }',
    'end',
    '',
    `-- Funcao ${removeName}: remove um ${item} da colecao de forma funcional.`,
    `function ${removeName}(${collection}, id)`,
    `  local ${item}_removido = ${findName}(${collection}, id)`,
    `  local novos_${collection} = {}`,
    '  local proximo_indice = 1',
    `  for _, registro in ipairs(${collection} or {}) do`,
    '    if registro.id ~= id then',
    `      novos_${collection}[proximo_indice] = ${cloneItemName}(registro)`,
    '      proximo_indice = proximo_indice + 1',
    '    end',
    '  end',
    '  return {',
    `    ${collection} = novos_${collection},`,
    `    ${item} = ${item}_removido,`,
    '  }',
    'end',
  ].join('\n');
}
function generateGenericCrudSnippet(entityName, ext) {
  const prefix = commentPrefix(ext);
  const names = crudEntityNames(entityName);
  return [
    `${prefix} CRUD completo para ${names.singularSnake}:`,
    `${prefix} - listar_${names.pluralSnake}`,
    `${prefix} - buscar_${names.singularSnake}_por_id`,
    `${prefix} - criar_${names.singularSnake}`,
    `${prefix} - atualizar_${names.singularSnake}`,
    `${prefix} - remover_${names.singularSnake}`,
  ].join('\n');
}
function generateMarkdownSnippet(instruction) {
  const normalized = safeComment(instruction).replace(/[.:]+$/, '');
  const title = normalized
    ? normalized.charAt(0).toUpperCase() + normalized.slice(1)
    : 'Nova secao';

  if (/\b(checklist|check list|lista|todo)\b/i.test(instruction)) {
    return [
      '## ' + title,
      '',
      '- [ ] Item 1',
      '- [ ] Item 2',
    ].join('\n');
  }

  if (/\b(tabela|table)\b/i.test(instruction)) {
    return [
      '## ' + title,
      '',
      '| Campo | Valor |',
      '| --- | --- |',
      '| Exemplo | Descreva aqui |',
    ].join('\n');
  }

  return [
    '## ' + title,
    '',
    'Descreva aqui o objetivo, o contexto e os passos relevantes.',
  ].join('\n');
}
function generateCommentSnippet(instruction, ext) {
  const prefix = commentPrefix(ext);
  if (prefix === '#') {
    return `# ${instruction}`;
  }
  if (prefix === '//') {
    return `// ${instruction}`;
  }
  if (prefix === '"') {
    return `" ${instruction}`;
  }
  return `-- ${instruction}`;
}
function fallbackImplementationMessage(instruction) {
  return safeComment(instruction) || 'implementar fluxo solicitado';
}
function vimStringLiteral(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}
function executablePlaceholderStatement(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const message = `implementar: ${fallbackImplementationMessage(instruction)}`;

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return `throw new Error(${JSON.stringify(message)});`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `raise NotImplementedError(${JSON.stringify(message)})`;
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `raise ${JSON.stringify(message)}`;
  }
  if (lowerExt === '.go') {
    return `panic(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.rs') {
    return `unimplemented!(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.rb') {
    return `raise NotImplementedError, ${JSON.stringify(message)}`;
  }
  if (lowerExt === '.lua') {
    return `error(${JSON.stringify(message)})`;
  }
  if (lowerExt === '.vim') {
    return `throw ${vimStringLiteral(message)}`;
  }
  if (isShellExtension(lowerExt)) {
    return `printf '%s\\n' ${JSON.stringify(message)} >&2; return 1`;
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return 'return;';
  }
  return `${commentPrefix(ext)} ${message}`;
}
function executablePlaceholderSnippet(instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const message = fallbackImplementationMessage(instruction);

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return `throw new Error(${JSON.stringify(`Implementacao pendente: ${message}`)});`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `raise NotImplementedError(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `raise ${JSON.stringify(`implementacao pendente: ${message}`)}`;
  }
  if (lowerExt === '.go') {
    return `panic(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.rs') {
    return `unimplemented!(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.rb') {
    return `raise NotImplementedError, ${JSON.stringify(`implementacao pendente: ${message}`)}`;
  }
  if (lowerExt === '.lua') {
    return `error(${JSON.stringify(`implementacao pendente: ${message}`)})`;
  }
  if (lowerExt === '.vim') {
    return `throw ${vimStringLiteral(`implementacao pendente: ${message}`)}`;
  }
  if (isShellExtension(lowerExt)) {
    return [
      'set -eu',
      '',
      'main() {',
      `  printf '%s\\n' ${JSON.stringify(message)} >&2`,
      '  return 1',
      '}',
      '',
      'main "$@"',
    ].join('\n');
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return [
      'void executar_fluxo_pendente(void) {',
      '  return;',
      '}',
    ].join('\n');
  }
  return `${commentPrefix(ext)} Implementacao pendente: ${message}`;
}
function generateTestSnippet(instruction, ext) {
  const lowerExt = ext.toLowerCase();
  const testTitle = fallbackImplementationMessage(instruction);
  const testName = toSnakeCaseIdentifier(testTitle) || 'validacao_basica';
  const pascalTestName = upperFirst(toCamelCaseIdentifier(testTitle) || 'ValidacaoBasica');

  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    return [
      `test(${JSON.stringify(testTitle)}, () => {`,
      '  expect(true).toBe(true);',
      '});',
    ].join('\n');
  }
  if (['.ex', '.exs'].includes(lowerExt)) {
    return [
      `test "validacao: ${testTitle}" do`,
      '  assert true',
      'end',
    ].join('\n');
  }
  if (isPythonLikeExtension(lowerExt)) {
    return [
      `def test_${testName}():`,
      '    assert True',
    ].join('\n');
  }
  if (lowerExt === '.go') {
    return [
      `func Test${pascalTestName}(t *testing.T) {`,
      '  if !true {',
      '    t.Fatal("expected true")',
      '  }',
      '}',
    ].join('\n');
  }
  if (lowerExt === '.rs') {
    return [
      '#[test]',
      `fn ${testName}() {`,
      '    assert!(true);',
      '}',
    ].join('\n');
  }
  if (lowerExt === '.rb') {
    return [
      `def test_${testName}`,
      '  assert true',
      'end',
    ].join('\n');
  }
  if (lowerExt === '.lua') {
    return [
      `local function test_${testName}()`,
      '  assert(true)',
      'end',
    ].join('\n');
  }
  if (lowerExt === '.vim') {
    return [
      `function! Test_${pascalTestName}() abort`,
      '  call assert_true(v:true)',
      'endfunction',
    ].join('\n');
  }
  if (isShellExtension(lowerExt)) {
    return [
      `test_${testName}() {`,
      '  [ 1 -eq 1 ]',
      '}',
    ].join('\n');
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return [
      '#include <assert.h>',
      '',
      `static void test_${testName}(void) {`,
      '  assert(1);',
      '}',
    ].join('\n');
  }

  return `${commentPrefix(ext)} validacao: ${testTitle}`;
}
function generateShellScriptSnippet(instruction) {
  const explicitLiteral = extractLiteralFromInstruction(String(instruction || ''));
  const shellMessage = explicitLiteral || JSON.stringify(fallbackImplementationMessage(instruction));

  return [
    'set -eu',
    '',
    'main() {',
    `  printf '%s\\n' ${shellMessage}`,
    '}',
    '',
    'main "$@"',
  ].join('\n');
}
function generateGenericSnippet(instruction, ext, lines = [], sourceFile = '', options = {}) {
  const prefix = commentPrefix(ext);
  const down = instruction.toLowerCase();
  const structuredConfigSnippet = generateStructuredConfigSnippet(instruction, ext);
  if (structuredConfigSnippet) {
    return structuredConfigSnippet;
  }
  const structureSnippet = generateStructureSnippet(instruction, ext);
  if (structureSnippet) {
    return structureSnippet;
  }
  if (/\b(debug|dbg|registr|log(?:ar|ado)?|temporario|temporaria)\b/i.test(down)) {
    if (['.ex', '.exs'].includes(ext.toLowerCase())) {
      return 'Logger.debug("revisar log temporario antes do deploy")';
    }
    if (['.js', '.jsx', '.ts', '.tsx'].includes(ext.toLowerCase())) {
      return "console.debug('revisar log temporario antes do deploy');";
    }
    return `${prefix} revisar log temporario antes do merge`;
  }

  const replacementPair = parseVariableCorrectionRequest(instruction);
  if (replacementPair && replacementPair[0] && replacementPair[1]) {
    return [
      `${prefix} Corrige variavel ${replacementPair[0]} para ${replacementPair[1]}.`,
      `${prefix} Ajuste o trecho atual para manter o contrato da funcao.`,
    ].join('\n');
  }

  if (isContextualCorrectionInstruction(down)) {
    return generateContextualCorrectionSnippet(instruction, ext, lines, sourceFile, options);
  }

  if (/\b(adiciona|adicionar|cria|criar|implementa|implementar|monta|montar|gera|gerar|executa|executar|add|implement)\b/i.test(down)) {
    return generateFunctionSnippet(instruction, ext);
  }
  if (isShellExtension(ext)) {
    return generateShellScriptSnippet(instruction);
  }
  return generateCommentSnippet(instruction, ext);
}
function generateContextualCorrectionSnippet(instruction, ext, lines = [], sourceFile = '', options = {}) {
  const normalizedExt = String(ext || '').toLowerCase();
  const down = String(instruction || '').toLowerCase();

  const contextualFunctionUpdate = buildContextualFunctionUpdateAiFailure(instruction, normalizedExt, lines, options);
  if (contextualFunctionUpdate) {
    return contextualFunctionUpdate;
  }

  if (['.ex', '.exs'].includes(normalizedExt) && /\b(refator|nested condition|nested if|aninhamento)\b/i.test(down)) {
    const nestedConditionRewrite = rewriteElixirNestedConditionFromContext(lines, sourceFile, options);
    if (nestedConditionRewrite) {
      return nestedConditionRewrite;
    }
  }

  return null;
}
function rewriteElixirNestedConditionFromContext(lines, sourceFile = '', options = {}) {
  if (!Array.isArray(lines) || lines.length === 0 || !sourceFile) {
    return null;
  }

  const lineIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const functionRange = findElixirFunctionRangeBelow(lines, lineIndex);
  if (!functionRange) {
    return null;
  }

  const parsedFunction = parseElixirFunction(lines, functionRange.start, functionRange.end);
  if (!parsedFunction) {
    return null;
  }

  const flattened = flattenLinearElixirIfTree(parsedFunction.tree);
  if (!flattened || flattened.length < 2) {
    return null;
  }

  const renderedFunction = renderElixirCondFunction(parsedFunction.signature, flattened);
  const nextLines = lines
    .filter((_, index) => index !== lineIndex)
    .slice();
  const adjustedRange = {
    start: functionRange.start > lineIndex && lineIndex >= 0 ? functionRange.start - 1 : functionRange.start,
    end: functionRange.end > lineIndex && lineIndex >= 0 ? functionRange.end - 1 : functionRange.end,
  };
  const rewrittenLines = [
    ...nextLines.slice(0, adjustedRange.start),
    ...renderedFunction,
    ...nextLines.slice(adjustedRange.end + 1),
  ];

  return {
    snippet: rewrittenLines.join('\n'),
    disableMaintenanceComments: true,
    action: {
      op: 'write_file',
      target_file: sourceFile,
      remove_trigger: false,
      mkdir_p: true,
    },
  };
}
function findElixirFunctionRangeBelow(lines, lineIndex) {
  const startSearchIndex = Number.isInteger(lineIndex) && lineIndex >= 0 ? lineIndex + 1 : 0;
  let functionStart = -1;

  for (let index = startSearchIndex; index < lines.length; index += 1) {
    if (/^\s*defp?\b.*\bdo\s*$/.test(String(lines[index] || ''))) {
      functionStart = index;
      break;
    }
  }
  if (functionStart < 0) {
    return null;
  }

  let depth = 0;
  for (let index = functionStart; index < lines.length; index += 1) {
    const trimmed = String(lines[index] || '').trim();
    if (!trimmed) {
      continue;
    }
    if (/\bdo\s*$/.test(trimmed)) {
      depth += 1;
    }
    if (/^end\b/.test(trimmed)) {
      depth -= 1;
      if (depth === 0) {
        return { start: functionStart, end: index };
      }
    }
  }

  return null;
}
function parseElixirFunction(lines, start, end) {
  const signature = String(lines[start] || '');
  const bodyLines = lines.slice(start + 1, end);
  const tree = parseElixirIfNode(bodyLines);
  if (!tree) {
    return null;
  }

  return {
    signature,
    tree,
  };
}
function parseElixirIfNode(lines) {
  const normalized = trimEmptyEdges(lines);
  if (!normalized.length) {
    return null;
  }

  const header = String(normalized[0] || '');
  const headerMatch = header.match(/^(\s*)if\s+(.+?)\s+do\s*$/);
  if (!headerMatch) {
    return null;
  }

  let depth = 0;
  let elseIndex = -1;
  let endIndex = -1;

  for (let index = 0; index < normalized.length; index += 1) {
    const trimmed = String(normalized[index] || '').trim();
    if (/\bdo\s*$/.test(trimmed)) {
      depth += 1;
    }
    if (trimmed === 'else' && depth === 1) {
      elseIndex = index;
    }
    if (/^end\b/.test(trimmed)) {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
    }
  }

  if (elseIndex < 0 || endIndex < 0) {
    return null;
  }

  const thenLines = normalized.slice(1, elseIndex);
  const elseLines = normalized.slice(elseIndex + 1, endIndex);

  return {
    condition: String(headerMatch[2] || '').trim(),
    thenBranch: parseElixirBranch(thenLines),
    elseBranch: parseElixirBranch(elseLines),
  };
}
function parseElixirBranch(lines) {
  const normalized = trimEmptyEdges(lines);
  if (!normalized.length) {
    return null;
  }

  if (/^\s*if\s+.+\s+do\s*$/.test(String(normalized[0] || ''))) {
    return parseElixirIfNode(normalized);
  }

  if (normalized.length === 1) {
    return String(normalized[0] || '').trim();
  }

  return normalized.map((line) => String(line || '').trim()).join('\n');
}
function trimEmptyEdges(lines) {
  let start = 0;
  let end = lines.length;

  while (start < end && !String(lines[start] || '').trim()) {
    start += 1;
  }
  while (end > start && !String(lines[end - 1] || '').trim()) {
    end -= 1;
  }

  return lines.slice(start, end);
}
function isElixirIfNode(node) {
  return Boolean(node && typeof node === 'object' && node.condition && Object.prototype.hasOwnProperty.call(node, 'thenBranch'));
}
function flattenLinearElixirIfTree(node) {
  if (!isElixirIfNode(node)) {
    return null;
  }

  if (isElixirIfNode(node.thenBranch) && isElixirIfNode(node.elseBranch)) {
    return null;
  }

  if (!isElixirIfNode(node.thenBranch) && !isElixirIfNode(node.elseBranch)) {
    return [
      { condition: String(node.condition || '').trim(), expression: String(node.thenBranch || '').trim() },
      { condition: 'true', expression: String(node.elseBranch || '').trim() },
    ];
  }

  if (isElixirIfNode(node.thenBranch)) {
    const nested = flattenLinearElixirIfTree(node.thenBranch);
    const inverted = invertElixirCondition(node.condition);
    if (!nested || !inverted || !node.elseBranch) {
      return null;
    }
    return [
      { condition: inverted, expression: String(node.elseBranch || '').trim() },
      ...nested,
    ];
  }

  const nested = flattenLinearElixirIfTree(node.elseBranch);
  if (!nested || !node.thenBranch) {
    return null;
  }
  return [
    { condition: String(node.condition || '').trim(), expression: String(node.thenBranch || '').trim() },
    ...nested,
  ];
}
function invertElixirCondition(condition) {
  const text = String(condition || '').trim();
  const matcher = text.match(/^(.+?)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
  if (!matcher) {
    return `not (${text})`;
  }

  const left = String(matcher[1] || '').trim();
  const operator = String(matcher[2] || '').trim();
  const right = String(matcher[3] || '').trim();
  const inverseByOperator = {
    '>=': '<',
    '<=': '>',
    '==': '!=',
    '!=': '==',
    '>': '<=',
    '<': '>=',
  };
  return `${left} ${inverseByOperator[operator] || '!='} ${right}`;
}
function renderElixirCondFunction(signature, clauses) {
  const signatureIndent = (String(signature || '').match(/^\s*/) || [''])[0];
  const bodyIndent = `${signatureIndent}  `;
  const clauseIndent = `${signatureIndent}    `;

  return [
    signature,
    `${bodyIndent}cond do`,
    ...clauses.map((entry) => `${clauseIndent}${entry.condition} -> ${entry.expression}`),
    `${bodyIndent}end`,
    `${signatureIndent}end`,
  ];
}
function instructionRequestsDirectedGraph(instruction) {
  const text = String(instruction || '').toLowerCase();
  return /\b(grafo|graph)\b/.test(text) && /\b(direcionado|directed|aresta|edge|add_edge)\b/.test(text);
}
function inferDirectedGraphMethods(instruction) {
  const text = String(instruction || '').toLowerCase();
  const methodMatchers = [
    ['add_node', /\b(add[_\s-]?node|adicionar[_\s-]?(?:no|nó)|adicionar\s+(?:no|nó))\b/],
    ['add_edge', /\b(add[_\s-]?edge|adicionar[_\s-]?aresta|adicionar\s+aresta)\b/],
    ['bfs', /\b(bfs|busca\s+em\s+largura)\b/],
    ['dfs', /\b(dfs|busca\s+em\s+profundidade)\b/],
  ];

  const methods = methodMatchers
    .filter((entry) => entry[1].test(text))
    .map((entry) => entry[0]);

  return methods.length > 0
    ? methods
    : ['add_node', 'add_edge', 'bfs', 'dfs'];
}
function generateDirectedGraphSnippet(instruction, ext) {
  if (!instructionRequestsDirectedGraph(instruction)) {
    return '';
  }

  const methods = inferDirectedGraphMethods(instruction);
  const lowerExt = String(ext || '').toLowerCase();
  const hasAddNode = methods.includes('add_node');
  const hasAddEdge = methods.includes('add_edge');
  const hasBfs = methods.includes('bfs');
  const hasDfs = methods.includes('dfs');

  if (['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'].includes(lowerExt)) {
    return [
      'export class GrafoDirecionado {',
      '  constructor({ adjacencia = new Map() } = {}) {',
      '    this.adjacencia = cloneAdjacencia(adjacencia);',
      '  }',
      ...(hasAddNode ? [
        '',
        '  add_node(no) {',
        '    const proximaAdjacencia = cloneAdjacencia(this.adjacencia);',
        '    if (!proximaAdjacencia.has(no)) {',
        '      proximaAdjacencia.set(no, new Set());',
        '    }',
        '    return new GrafoDirecionado({ adjacencia: proximaAdjacencia });',
        '  }',
      ] : []),
      ...(hasAddEdge ? [
        '',
        '  add_edge(origem, destino) {',
        `    const comOrigem = ${hasAddNode ? 'this.add_node(origem)' : 'this'};`,
        `    const comDestino = ${hasAddNode ? 'comOrigem.add_node(destino)' : 'comOrigem'};`,
        '    const proximaAdjacencia = cloneAdjacencia(comDestino.adjacencia);',
        '    const vizinhos = new Set(proximaAdjacencia.get(origem) ?? []);',
        '    vizinhos.add(destino);',
        '    proximaAdjacencia.set(origem, vizinhos);',
        '    return new GrafoDirecionado({ adjacencia: proximaAdjacencia });',
        '  }',
      ] : []),
      ...(hasBfs ? [
        '',
        '  bfs(inicio) {',
        '    if (!this.adjacencia.has(inicio)) {',
        '      return [];',
        '    }',
        '    let fila = [inicio];',
        '    const visitados = new Set([inicio]);',
        '    const ordem = [];',
        '',
        '    while (fila.length > 0) {',
        '      const atual = fila[0];',
        '      fila = fila.slice(1);',
        '      ordem.push(atual);',
        '',
        '      const vizinhos = Array.from(this.adjacencia.get(atual) ?? []).sort();',
        '      for (const vizinho of vizinhos) {',
        '        if (!visitados.has(vizinho)) {',
        '          visitados.add(vizinho);',
        '          fila.push(vizinho);',
        '        }',
        '      }',
        '    }',
        '',
        '    return ordem;',
        '  }',
      ] : []),
      ...(hasDfs ? [
        '',
        '  dfs(inicio) {',
        '    if (!this.adjacencia.has(inicio)) {',
        '      return [];',
        '    }',
        '    const pilha = [inicio];',
        '    const visitados = new Set();',
        '    const ordem = [];',
        '',
        '    while (pilha.length > 0) {',
        '      const atual = pilha.pop();',
        '      if (visitados.has(atual)) {',
        '        continue;',
        '      }',
        '',
        '      visitados.add(atual);',
        '      ordem.push(atual);',
        '',
        '      const vizinhos = Array.from(this.adjacencia.get(atual) ?? []).sort().reverse();',
        '      for (const vizinho of vizinhos) {',
        '        if (!visitados.has(vizinho)) {',
        '          pilha.push(vizinho);',
        '        }',
        '      }',
        '    }',
        '',
        '    return ordem;',
        '  }',
      ] : []),
      '}',
      '',
      'function cloneAdjacencia(adjacencia) {',
      '  const origem = adjacencia instanceof Map ? adjacencia : new Map();',
      '  return new Map(Array.from(origem.entries(), ([no, vizinhos]) => [no, new Set(vizinhos ?? [])]));',
      '}',
    ].join('\n');
  }

  if (isPythonLikeExtension(lowerExt)) {
    return [
      ...(hasBfs ? ['from collections import deque', ''] : []),
      'class GrafoDirecionado:',
      '    def __init__(self, adjacencia=None):',
      '        self.adjacencia = _clone_adjacencia(adjacencia or {})',
      ...(hasAddNode ? [
        '',
        '    def add_node(self, no):',
        '        proxima_adjacencia = _clone_adjacencia(self.adjacencia)',
        '        proxima_adjacencia.setdefault(no, set())',
        '        return GrafoDirecionado(proxima_adjacencia)',
      ] : []),
      ...(hasAddEdge ? [
        '',
        '    def add_edge(self, origem, destino):',
        `        com_origem = ${hasAddNode ? 'self.add_node(origem)' : 'self'}`,
        `        com_destino = ${hasAddNode ? 'com_origem.add_node(destino)' : 'com_origem'}`,
        '        proxima_adjacencia = _clone_adjacencia(com_destino.adjacencia)',
        '        proxima_adjacencia.setdefault(origem, set()).add(destino)',
        '        return GrafoDirecionado(proxima_adjacencia)',
      ] : []),
      ...(hasBfs ? [
        '',
        '    def bfs(self, inicio):',
        '        if inicio not in self.adjacencia:',
        '            return []',
        '',
        '        fila = deque([inicio])',
        '        visitados = {inicio}',
        '        ordem = []',
        '',
        '        while fila:',
        '            atual = fila.popleft()',
        '            ordem.append(atual)',
        '',
        '            for vizinho in sorted(self.adjacencia.get(atual, set())):',
        '                if vizinho not in visitados:',
        '                    visitados.add(vizinho)',
        '                    fila.append(vizinho)',
        '',
        '        return ordem',
      ] : []),
      ...(hasDfs ? [
        '',
        '    def dfs(self, inicio):',
        '        if inicio not in self.adjacencia:',
        '            return []',
        '',
        '        pilha = [inicio]',
        '        visitados = set()',
        '        ordem = []',
        '',
        '        while pilha:',
        '            atual = pilha.pop()',
        '            if atual in visitados:',
        '                continue',
        '',
        '            visitados.add(atual)',
        '            ordem.append(atual)',
        '',
        '            vizinhos = sorted(self.adjacencia.get(atual, set()), reverse=True)',
        '            for vizinho in vizinhos:',
        '                if vizinho not in visitados:',
        '                    pilha.append(vizinho)',
        '',
        '        return ordem',
      ] : []),
      '',
      'def _clone_adjacencia(adjacencia):',
      '    return {no: set(vizinhos) for no, vizinhos in (adjacencia or {}).items()}',
    ].join('\n');
  }

  if (['.ex', '.exs'].includes(lowerExt)) {
    return [
      'defmodule GrafoDirecionado do',
      '  defstruct adjacencia: %{}',
      ...(hasAddNode ? [
        '',
        '  def add_node(%__MODULE__{adjacencia: adjacencia} = grafo, no) do',
        '    %__MODULE__{grafo | adjacencia: Map.put_new(adjacencia, no, MapSet.new())}',
        '  end',
      ] : []),
      ...(hasAddEdge ? [
        '',
        '  def add_edge(%__MODULE__{} = grafo, origem, destino) do',
        `    com_origem = ${hasAddNode ? 'add_node(grafo, origem)' : 'grafo'}`,
        `    com_destino = ${hasAddNode ? 'add_node(com_origem, destino)' : 'com_origem'}`,
        '    vizinhos = com_destino.adjacencia |> Map.get(origem, MapSet.new()) |> MapSet.put(destino)',
        '    %__MODULE__{com_destino | adjacencia: Map.put(com_destino.adjacencia, origem, vizinhos)}',
        '  end',
      ] : []),
      ...(hasBfs ? [
        '',
        '  def bfs(%__MODULE__{adjacencia: adjacencia}, inicio) do',
        '    if Map.has_key?(adjacencia, inicio) do',
        '      bfs_loop(adjacencia, :queue.from_list([inicio]), MapSet.new([inicio]), [])',
        '    else',
        '      []',
        '    end',
        '  end',
      ] : []),
      ...(hasDfs ? [
        '',
        '  def dfs(%__MODULE__{adjacencia: adjacencia}, inicio) do',
        '    if Map.has_key?(adjacencia, inicio) do',
        '      dfs_loop(adjacencia, [inicio], MapSet.new(), [])',
        '    else',
        '      []',
        '    end',
        '  end',
      ] : []),
      ...(hasBfs ? [
        '',
        '  defp bfs_loop(adjacencia, fila, visitados, ordem_reversa) do',
        '    case :queue.out(fila) do',
        '      {{:value, atual}, restante} ->',
        '        vizinhos =',
        '          adjacencia',
        '          |> Map.get(atual, MapSet.new())',
        '          |> MapSet.to_list()',
        '          |> Enum.sort()',
        '',
        '        {proxima_fila, proximos_visitados} =',
        '          Enum.reduce(vizinhos, {restante, visitados}, fn vizinho, {fila_acc, visitados_acc} ->',
        '            if MapSet.member?(visitados_acc, vizinho) do',
        '              {fila_acc, visitados_acc}',
        '            else',
        '              {:queue.in(vizinho, fila_acc), MapSet.put(visitados_acc, vizinho)}',
        '            end',
        '          end)',
        '',
        '        bfs_loop(adjacencia, proxima_fila, proximos_visitados, [atual | ordem_reversa])',
        '',
        '      {:empty, _} ->',
        '        Enum.reverse(ordem_reversa)',
        '    end',
        '  end',
      ] : []),
      ...(hasDfs ? [
        '',
        '  defp dfs_loop(_adjacencia, [], _visitados, ordem_reversa), do: Enum.reverse(ordem_reversa)',
        '',
        '  defp dfs_loop(adjacencia, [atual | restante], visitados, ordem_reversa) do',
        '    if MapSet.member?(visitados, atual) do',
        '      dfs_loop(adjacencia, restante, visitados, ordem_reversa)',
        '    else',
        '      proximos_visitados = MapSet.put(visitados, atual)',
        '',
        '      vizinhos =',
        '        adjacencia',
        '        |> Map.get(atual, MapSet.new())',
        '        |> MapSet.to_list()',
        '        |> Enum.sort(:desc)',
        '',
        '      dfs_loop(adjacencia, vizinhos ++ restante, proximos_visitados, [atual | ordem_reversa])',
        '    end',
        '  end',
      ] : []),
      'end',
    ].join('\n');
  }

  return '';
}
function parseFunctionRequest(instruction) {
  const lower = instruction.toLowerCase();
  const tupleMatch = lower.match(/([a-z_][a-zA-Z0-9_?!]*)\s*\(([^)]*)\)/);
  if (tupleMatch) {
    return [sanitizeIdentifier(tupleMatch[1]), parseParams(tupleMatch[2])];
  }

  const namedFunctionMatch = instruction.match(
    /\b(?:funcao|função|function|metodo|método)\b(?:\s+(?:chamada|chamado|nomeada|nomeado|com\s+nome))?\s+([a-z_][a-zA-Z0-9_?!]*)/i,
  );
  if (namedFunctionMatch && namedFunctionMatch[1] && !isInstructionNoiseToken(namedFunctionMatch[1])) {
    const functionName = sanitizeIdentifier(namedFunctionMatch[1]);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  const explicitMatch = instruction.match(
    /\b(?:crie|cria|criar|faça|faca|implemente|implementar|implementa|implementacao|escreva|escrever|monta|montar)\b.*?\b(?:funcao|função|function|metodo|método)\b(?:\s+(?:chamada|chamado|chama|nome|nomeada|com)\s+)?([a-z_][a-zA-Z0-9_?!]*)?/i,
  );
  if (explicitMatch && explicitMatch[1] && !isInstructionNoiseToken(explicitMatch[1])) {
    const functionName = sanitizeIdentifier(explicitMatch[1]);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  if (/\b(funcao|função|function|metodo|método)\b/i.test(instruction)) {
    const functionName = inferFunctionNameFromInstruction(instruction);
    return [functionName, inferImplicitFunctionParams(functionName, instruction)];
  }

  const fnMatch = lower.match(
    /\b(?:implementa|implementar|implementacao|cria|criar|adiciona|adicionar|monta|montar|gera|gerar|faz|fazer|calcula|calcular|valida|validar|processa|processar)\s+([a-z_][a-zA-Z0-9_?!]*)/i,
  );
  if (fnMatch) {
    return [sanitizeIdentifier(fnMatch[1]), ['arg']];
  }

  const anyMatch = lower.match(/\b([a-z_][a-zA-Z0-9_?!]*)\b/);
  if (anyMatch) {
    return [sanitizeIdentifier(anyMatch[1]), ['arg']];
  }
  return ['agent_task', ['arg']];
}
function inferImplicitFunctionParams(name, instruction) {
  const normalizedName = sanitizeIdentifier(name);
  const normalizedInstruction = String(instruction || '').toLowerCase();
  const arithmeticContext = `${normalizedName} ${normalizedInstruction}`;
  const requestedParamCount = inferRequestedParamCount(arithmeticContext);
  const arithmeticOperator = inferArithmeticOperator(arithmeticContext);
  const arithmeticLiteral = extractArithmeticLiteral(arithmeticContext, arithmeticOperator);

  if (requestedParamCount === 1 && arithmeticOperator) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (requestedParamCount === 1) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (requestedParamCount >= 2) {
    return ['a', 'b'];
  }

  if (arithmeticLiteral && arithmeticOperator) {
    return [inferSingleParamName(arithmeticContext)];
  }

  if (arithmeticOperator) {
    return ['a', 'b'];
  }

  return [];
}
function inferRequestedParamCount(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\b(?:recebe|receber|receive|receives)\s+(?:um|uma|one|1)\s+(?:numero|número|valor|parametro|parâmetro|argumento)\b/.test(text)) {
    return 1;
  }
  if (/\b(?:recebe|receber|receive|receives)\s+(?:dois|duas|two|2)\s+(?:numeros|números|valores|parametros|parâmetros|argumentos)\b/.test(text)) {
    return 2;
  }
  return 0;
}
function inferSingleParamName(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\bnumero|número\b/.test(text)) {
    return 'numero';
  }
  if (/\btexto|string\b/.test(text)) {
    return 'texto';
  }
  if (/\bvalor\b/.test(text)) {
    return 'valor';
  }
  return 'valor';
}
function isInstructionNoiseToken(token) {
  return ['que', 'quea', 'para', 'com', 'uma', 'um', 'uma', 'de', 'do', 'da', 'das', 'dos', 'seja', 'deve', 'vai'].includes(String(token).toLowerCase());
}
function inferFunctionNameFromInstruction(instruction) {
  const lower = instruction.toLowerCase();
  const arithmeticOperator = inferArithmeticOperator(lower);
  const arithmeticLiteral = extractArithmeticLiteral(lower, arithmeticOperator);
  if (arithmeticOperator === '+' && arithmeticLiteral) {
    return `somar_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}`;
  }
  if (arithmeticOperator === '-') {
    return arithmeticLiteral ? `subtrair_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'subtrair';
  }
  if (arithmeticOperator === '*') {
    return arithmeticLiteral ? `multiplicar_por_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'multiplicar';
  }
  if (arithmeticOperator === '/') {
    return arithmeticLiteral ? `dividir_por_${arithmeticLiteral.replace('.', '_').replace('-', 'menos_')}` : 'dividir';
  }
  if (/\bsoma\b/.test(lower)) {
    return 'soma';
  }
  if (/\bretorn(?:a|e|ar)?\b/.test(lower)) {
    const numeric = lower.match(/\b(?:retorna|retorne|retornar|resultado|valor|devolve|devolver)\b[^0-9a-zA-Z_\\-]*([+-]?\d+(?:\.\d+)?)\b/);
    if (numeric && numeric[1]) {
      return `retornar_valor_${numeric[1].replace('.', '_')}`;
    }
    return 'retornar_valor';
  }
  if (/\bcalcula|calcular\b/.test(lower)) {
    return 'calculo';
  }
  return 'funcao_gerada';
}
function parseParams(rawParams) {
  return rawParams
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => (token === 'arg' ? 'arg' : sanitizeIdentifier(token)))
    .map((token) => (token.length === 0 ? 'arg' : token))
    .concat();
}
function inferArithmeticContract(name, params, instruction, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (!Array.isArray(params) || params.length < 1) {
    return null;
  }

  const arithmeticContext = `${sanitizeIdentifier(name)} ${String(instruction || '').toLowerCase()}`;
  const operator = inferArithmeticOperator(arithmeticContext);
  if (!operator) {
    return null;
  }
  const literal = extractArithmeticLiteral(arithmeticContext, operator);

  if (lowerExt === '.go') {
    return {
      params: params.map((param) => `${sanitizeIdentifier(param)} float64`).join(', '),
      returnType: ' float64',
    };
  }

  if (lowerExt === '.rs') {
    return {
      params: params.map((param) => `${toSnakeCaseIdentifier(param)}: f64`).join(', '),
      returnType: ' -> f64',
    };
  }

  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return {
      params: params.map((param) => `double ${sanitizeIdentifier(param)}`).join(', '),
      returnType: 'double',
    };
  }

  if (literal && params.length >= 1) {
    return {
      params: params.join(', '),
      returnType: '',
    };
  }

  return null;
}
function resolveFunctionRenderingOptions(instruction, ext, lines = [], options = {}) {
  const lowerExt = String(ext || '').toLowerCase();
  const requestedMethod = instructionRequestsMethod(instruction);
  const lineIndex = Number.isInteger(options.lineIndex) ? options.lineIndex : -1;
  const insideClassScope = lineIndex >= 0
    ? isInsideClassScope(lines, lineIndex, lowerExt)
    : false;

  return {
    asMethod: requestedMethod && insideClassScope && (isJavaScriptLikeExtension(lowerExt) || isPythonLikeExtension(lowerExt)),
  };
}
function instructionRequestsMethod(instruction) {
  return /\b(metodo|método|method)\b/i.test(String(instruction || ''));
}
function isInsideClassScope(lines, lineIndex, ext) {
  if (!Array.isArray(lines) || lines.length === 0 || lineIndex < 0 || lineIndex >= lines.length) {
    return false;
  }

  if (isJavaScriptLikeExtension(ext)) {
    return isInsideJavaScriptClassScope(lines, lineIndex);
  }
  if (isPythonLikeExtension(ext)) {
    return isInsidePythonClassScope(lines, lineIndex);
  }
  return false;
}
function isInsideJavaScriptClassScope(lines, lineIndex) {
  let braceDepth = 0;
  const classStack = [];

  for (let cursor = 0; cursor <= lineIndex; cursor += 1) {
    const rawLine = String(lines[cursor] || '');
    const sanitizedLine = rawLine.replace(/\/\/.*$/g, '');
    const openingBraces = (sanitizedLine.match(/\{/g) || []).length;
    const closingBraces = (sanitizedLine.match(/\}/g) || []).length;

    if (/\bclass\s+[A-Za-z_][A-Za-z0-9_]*\b/.test(sanitizedLine) && openingBraces > 0) {
      classStack.push(braceDepth + openingBraces);
    }

    braceDepth += openingBraces - closingBraces;
    while (classStack.length > 0 && classStack[classStack.length - 1] > braceDepth) {
      classStack.pop();
    }
  }

  return classStack.length > 0;
}
function isInsidePythonClassScope(lines, lineIndex) {
  let activeClassIndent = null;

  for (let cursor = 0; cursor <= lineIndex; cursor += 1) {
    const rawLine = String(lines[cursor] || '');
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const indent = (rawLine.match(/^\s*/) || [''])[0].length;
    if (/^\s*class\s+[A-Za-z_][A-Za-z0-9_]*\s*:/.test(rawLine)) {
      activeClassIndent = indent;
      continue;
    }

    if (activeClassIndent === null) {
      continue;
    }

    if (indent <= activeClassIndent && !/^\s*#/.test(rawLine)) {
      activeClassIndent = null;
    }
  }

  const markerIndent = (String(lines[lineIndex] || '').match(/^\s*/) || [''])[0].length;
  return activeClassIndent !== null && markerIndent > activeClassIndent;
}
function ensurePythonMethodParams(params) {
  const normalized = Array.isArray(params) ? params.map((param) => sanitizeIdentifier(param)).filter(Boolean) : [];
  if (normalized[0] === 'self') {
    return normalized;
  }
  return ['self', ...normalized];
}
function functionSignature(name, params, instruction, ext, options = {}) {
  const lowerExt = ext.toLowerCase();
  const paramsText = params.join(', ');
  const asMethod = Boolean(options.asMethod);
  if (['.ex', '.exs'].includes(lowerExt)) {
    return [`def ${sanitizeIdentifier(name)}(${paramsText}) do`, 'end'];
  }
  if (['.js', '.jsx', '.ts', '.tsx'].includes(lowerExt)) {
    if (asMethod) {
      return [`${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
    }
    return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
  }
  if (lowerExt === '.vim') {
    return [`function! ${sanitizeIdentifier(name)}(${paramsText})`, 'endfunction'];
  }
  if (lowerExt === '.go') {
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`func ${toCamelCaseIdentifier(name)}(${arithmeticContract.params})${arithmeticContract.returnType} {`, '}'];
    }
    const goParams = params.map((param) => `${sanitizeIdentifier(param)} any`).join(', ');
    return [`func ${toCamelCaseIdentifier(name)}(${goParams}) any {`, '}'];
  }
  if (lowerExt === '.rs') {
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`fn ${toSnakeCaseIdentifier(name)}(${arithmeticContract.params})${arithmeticContract.returnType} {`, '}'];
    }
    const rustParams = params.map((param) => `${toSnakeCaseIdentifier(param)}: &str`).join(', ');
    return [`fn ${toSnakeCaseIdentifier(name)}(${rustParams}) {`, '}'];
  }
  if (lowerExt === '.py') {
    const pythonParams = asMethod
      ? ensurePythonMethodParams(params)
      : params;
    return [`def ${sanitizeIdentifier(name)}(${pythonParams.join(', ')}):`, 'none'];
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    if (extractDiceSides(instruction)) {
      return [`int ${sanitizeIdentifier(name)}(void) {`, '}'];
    }
    const arithmeticContract = inferArithmeticContract(name, params, instruction, ext);
    if (arithmeticContract) {
      return [`${arithmeticContract.returnType} ${sanitizeIdentifier(name)}(${arithmeticContract.params}) {`, '}'];
    }
    const cParams = params.length > 0
      ? params.map((param) => `double ${sanitizeIdentifier(param)}`).join(', ')
      : 'void';
    return [`void ${sanitizeIdentifier(name)}(${cParams}) {`, '}'];
  }
  if (lowerExt === '.rb') {
    return [`def ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  if (lowerExt === '.lua') {
    return [`function ${sanitizeIdentifier(name)}(${paramsText})`, 'end'];
  }
  return [`function ${sanitizeIdentifier(name)}(${paramsText}) {`, '}'];
}
function functionBodyHint(instruction, params, ext) {
  const low = instruction.toLowerCase();
  const lowerExt = ext.toLowerCase();
  const inferredExpression = inferInstructionExpression(low, ext);
  if (inferredExpression) {
    return baseHint(inferredExpression, ext);
  }
  const arithmeticExpression = inferArithmeticExpression(low, params);
  if (arithmeticExpression) {
    return baseHint(arithmeticExpression, ext);
  }
  const explicitValue = extractLiteralFromInstruction(low);
  if (explicitValue) {
    return baseHint(explicitValue, ext);
  }
  return baseHint(fallbackFunctionExpression(low, params, lowerExt), ext);
}
function fallbackFunctionExpression(instruction, params, ext) {
  const text = String(instruction || '').toLowerCase();
  const normalizedParams = Array.isArray(params)
    ? params.map((param) => sanitizeIdentifier(param)).filter(Boolean)
    : [];

  if (/\b(valida|validar|bool|boolean|deve|should)\b/.test(text)) {
    return 'true';
  }
  if (/\b(lista|array|vetor|colecao|coleção|stack|queue|fila|pilha|heap)\b/.test(text)) {
    return emptyCollectionExpression(ext);
  }
  if (/\b(mapa|dicionario|dicionário|hash|objeto|graph|grafo|tree|trie)\b/.test(text)) {
    return emptyMappingExpression(ext);
  }
  if (normalizedParams.length > 0) {
    return normalizedParams[0];
  }
  return neutralExpression(ext);
}
function emptyCollectionExpression(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ex', '.exs'].includes(lowerExt)) {
    return '[]';
  }
  return '[]';
}
function emptyMappingExpression(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ex', '.exs'].includes(lowerExt)) {
    return '%{}';
  }
  if (isPythonLikeExtension(lowerExt)) {
    return '{}';
  }
  return '{}';
}
function neutralExpression(ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ex', '.exs'].includes(lowerExt)) {
    return ':ok';
  }
  if (isPythonLikeExtension(lowerExt)) {
    return 'None';
  }
  if (isGoExtension(lowerExt)) {
    return 'nil';
  }
  if (isRustExtension(lowerExt)) {
    return '()';
  }
  if (lowerExt === '.rb' || lowerExt === '.lua') {
    return 'nil';
  }
  return 'null';
}
function inferArithmeticExpression(instruction, params) {
  if (!Array.isArray(params) || params.length < 1) {
    return '';
  }

  const text = String(instruction || '').toLowerCase();
  const operator = inferArithmeticOperator(text);
  if (!operator) {
    return '';
  }
  const literal = extractArithmeticLiteral(text, operator);
  if (literal) {
    return `${params[0]} ${operator} ${literal}`;
  }
  if (params.length < 2) {
    return '';
  }
  const left = params[0];
  const right = params[1];
  return `${left} ${operator} ${right}`;
}
function inferArithmeticOperator(instruction) {
  const text = String(instruction || '').toLowerCase();
  if (/\b(soma|somar|sum|add|adicao|adição)\b/.test(text)) {
    return '+';
  }
  if (/\b(subtracao|subtração|subtrair|subtract)\b/.test(text)) {
    return '-';
  }
  if (/\b(multiplicacao|multiplicação|multiplicar|multiply)\b/.test(text)) {
    return '*';
  }
  if (/\b(divisao|divisão|dividir|divide)\b/.test(text)) {
    return '/';
  }
  return '';
}
function extractArithmeticLiteral(instruction, operator) {
  const text = String(instruction || '').toLowerCase();
  if (emptyString(operator)) {
    return '';
  }
  const escapedOperator = escapeRegExp(operator);
  const operatorMatch = text.match(new RegExp(`${escapedOperator}\\s*([+-]?\\d+(?:\\.\\d+)?)\\b`));
  if (operatorMatch && operatorMatch[1]) {
    return operatorMatch[1];
  }

  if (operator === '+') {
    const keywordMatch = text.match(/\b(?:soma|somar|add|adiciona|adicionar)\s+([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '-') {
    const keywordMatch = text.match(/\b(?:subtrai|subtrair|subtract|remove|remover)\s+([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '*') {
    const keywordMatch = text.match(/\b(?:multiplica|multiplicar|multiply)\s+(?:por\s+)?([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  if (operator === '/') {
    const keywordMatch = text.match(/\b(?:divide|dividir)\s+(?:por\s+)?([+-]?\d+(?:\.\d+)?)\b/);
    if (keywordMatch && keywordMatch[1]) {
      return keywordMatch[1];
    }
  }
  return '';
}
function emptyString(value) {
  return String(value || '') === '';
}
function inferInstructionExpression(instruction, ext) {
  const diceSides = extractDiceSides(instruction);
  if (!diceSides) {
    return '';
  }
  return diceExpressionForLanguage(diceSides, ext);
}
function extractDiceSides(instruction) {
  const text = String(instruction || '').toLowerCase();
  const explicitDice = text.match(/\bd(\d+)\b/);
  if (explicitDice && explicitDice[1]) {
    return Number.parseInt(explicitDice[1], 10);
  }

  const describedDice = text.match(/\b(?:dado|dice)\s+(?:de\s+)?(\d+)\s+(?:lados?|faces?|sides?)\b/);
  if (describedDice && describedDice[1]) {
    return Number.parseInt(describedDice[1], 10);
  }

  const sidedRoll = text.match(/\b(\d+)\s+(?:lados?|faces?|sides?)\b/);
  if (sidedRoll && sidedRoll[1] && /\b(?:dado|dice|rolagem|random|aleatorio|aleatório)\b/.test(text)) {
    return Number.parseInt(sidedRoll[1], 10);
  }

  if (/\bdado\b|\bdice\b/.test(text)) {
    if (/\brpg\b/.test(text)) {
      return 20;
    }
    return 6;
  }

  return 0;
}
function diceExpressionForLanguage(sides, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  if (['.ex', '.exs'].includes(lowerExt)) {
    return `Enum.random(1..${sides})`;
  }
  if (isJavaScriptLikeExtension(lowerExt)) {
    return `Math.floor(Math.random() * ${sides}) + 1`;
  }
  if (isPythonLikeExtension(lowerExt)) {
    return `random.randint(1, ${sides})`;
  }
  if (isGoExtension(lowerExt)) {
    return `rand.Intn(${sides}) + 1`;
  }
  if (lowerExt === '.rb') {
    return `rand(1..${sides})`;
  }
  if (lowerExt === '.lua') {
    return `math.random(1, ${sides})`;
  }
  if (['.c', '.cpp', '.h', '.hpp'].includes(lowerExt)) {
    return `(rand() % ${sides}) + 1`;
  }
  return '';
}
function extractLiteralFromInstruction(instruction) {
  const numeric = instruction.match(
    /\b(?:retorna|retorne|retornar|devolve|devolver|resultado|valor)\b[^0-9a-zA-Z\-_]*([+-]?\d+(?:\.\d+)?)\b/,
  );
  if (numeric && numeric[1]) {
    return numeric[1];
  }

  const boolMatch = instruction.match(/\b(verdadeiro|falso|true|false)\b/);
  if (boolMatch && boolMatch[1]) {
    return /^(verdadeiro|true)$/i.test(boolMatch[1]) ? 'true' : 'false';
  }

  const quoted = instruction.match(/"([^"]+)"|'([^']+)'/);
  if (quoted) {
    return `"${quoted[1] || quoted[2]}"`;
  }

  return '';
}
function baseHint(expr, ext) {
  if (ext.toLowerCase() === '.py') {
    const normalized = String(expr || '').trim().toLowerCase();
    if (normalized === 'true') {
      return 'return True';
    }
    if (normalized === 'false') {
      return 'return False';
    }
  }
  if (['.c', '.cpp', '.h', '.hpp', '.java', '.cs'].includes(ext.toLowerCase())) {
    return `return ${expr};`;
  }
  if (['.py', '.js', '.jsx', '.ts', '.tsx', '.go', '.kts', '.kt', '.lua', '.vim'].includes(ext.toLowerCase())) {
    return `return ${expr}`;
  }
  return expr;
}

const NON_AI_CONTEXT_CONTRACT_EXTENSIONS = new Set(['.go', '.rs', '.c', '.h', '.cpp', '.hpp', '.rb', '.lua', '.vim', '.sh', '.bash', '.zsh']);
const NON_AI_AUTOMATIC_FIX_KINDS = new Set([
  'ai_required',
  'comment_task',
  'context_file',
  'large_file',
  'terminal_task',
  'unit_test',
  'unit_test_signature',
]);
const AUTOMATIC_AI_COMMENT_KINDS = new Set([
  'class_doc',
  'flow_comment',
  'function_comment',
  'function_doc',
  'moduledoc',
  'variable_doc',
]);
const DEFAULT_AUTOMATIC_AI_COMMENT_MAX_ISSUES = 8;
const DEBUG_AUTOMATIC_AI = /^(?:1|true|yes|on)$/i.test(String(process.env.PINGU_DEBUG_AUTOMATIC_AI || ''));

function shouldResolveAutomaticIssueWithAi(issue) {
  const kind = String(issue && issue.kind || '').trim();
  if (!kind) {
    return false;
  }
  if (NON_AI_AUTOMATIC_FIX_KINDS.has(kind)) {
    return false;
  }
  return true;
}

function readAutomaticAiCommentMaxIssues(env = process.env) {
  const parsed = Number.parseInt(
    String(env.PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES || DEFAULT_AUTOMATIC_AI_COMMENT_MAX_ISSUES),
    10,
  );
  if (!Number.isFinite(parsed)) {
    return DEFAULT_AUTOMATIC_AI_COMMENT_MAX_ISSUES;
  }
  return parsed <= 0 ? 0 : parsed;
}

function aiComparableLines(linesOrText) {
  if (Array.isArray(linesOrText)) {
    return linesOrText
      .map((line) => String(line || '').trim())
      .filter(Boolean);
  }
  return String(linesOrText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => String(line || '').trim())
    .filter(Boolean);
}

function aiLooksLikeWholeBuffer(snippet, sourceLines) {
  const source = aiComparableLines(sourceLines);
  const candidate = aiComparableLines(snippet);
  if (source.length < 6 || candidate.length < 6) {
    return false;
  }

  const sourceSet = new Set(source);
  const overlapCount = candidate.reduce((count, line) =>
    count + (sourceSet.has(line) ? 1 : 0), 0);
  const overlapRatio = overlapCount / source.length;
  const sizeRatio = candidate.length / source.length;
  return overlapRatio >= 0.6 && sizeRatio >= 0.7;
}

function isAutomaticAiSnippetCompatible(issue, action, snippet, sourceLines = []) {
  if (!action || typeof action !== 'object') {
    return false;
  }
  const op = String(action.op || '').trim();
  const text = String(snippet || '');

  if (!op) {
    return false;
  }
  if (op === 'write_file') {
    return text.trim().length > 0;
  }
  if (op === 'insert_before' || op === 'insert_after') {
    if (aiLooksLikeWholeBuffer(text, sourceLines)) {
      return false;
    }
    return text.trim().length > 0;
  }
  if (op === 'replace_line') {
    const hasExplicitRange = Boolean(action.range && typeof action.range === 'object');
    if (!hasExplicitRange && /\n/.test(text)) {
      return false;
    }
    return text.trim().length > 0;
  }

  return text.trim().length > 0;
}

function resolveAutomaticIssuesWithAi(lines, file, issues = [], options = {}) {
  const normalizedExt = analysisExtension(file);
  const allowAiCalls = options.allowAiCalls !== false;
  const env = options.env || process.env;
  const hasAiConfiguration = hasOpenAiConfiguration();
  const automaticCommentPolicy = resolveAiFeaturePolicy('automatic_comment', env, {
    hasOpenAiConfiguration: hasAiConfiguration,
  });
  const automaticFixPolicy = resolveAiFeaturePolicy('automatic_fix', env, {
    hasOpenAiConfiguration: hasAiConfiguration,
  });
  const automaticAiCommentMaxIssues = readAutomaticAiCommentMaxIssues(options.env || process.env);
  let automaticAiCommentIssuesResolved = 0;
  let contextIssues = [];
  if (DEBUG_AUTOMATIC_AI) {
    process.stderr.write(`[PINGU_DEBUG_AI] start ext=${normalizedExt} issues=${Array.isArray(issues) ? issues.length : 0}\n`);
  }
  if (['.ex', '.exs'].includes(normalizedExt)) {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write('[PINGU_DEBUG_AI] detect context elixir\n');
    }
    contextIssues = detectElixirContextContractIssues(lines, file, issues);
  } else if (isJavaScriptLikeExtension(normalizedExt)) {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write('[PINGU_DEBUG_AI] detect context javascript\n');
    }
    contextIssues = detectJavaScriptContextContractIssues(lines, file, issues);
  } else if (isPythonLikeExtension(normalizedExt)) {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write('[PINGU_DEBUG_AI] detect context python\n');
    }
    contextIssues = detectPythonContextContractIssues(lines, file, issues);
  } else if (NON_AI_CONTEXT_CONTRACT_EXTENSIONS.has(normalizedExt)) {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write(`[PINGU_DEBUG_AI] detect context non_ai ${normalizedExt}\n`);
    }
    contextIssues = detectCurlyLanguageContextContractIssues(lines, file, issues, normalizedExt);
  }
  if (DEBUG_AUTOMATIC_AI) {
    process.stderr.write(`[PINGU_DEBUG_AI] context issues=${contextIssues.length}\n`);
  }
  const mergedIssues = [...issues, ...contextIssues];
  if (!automaticCommentPolicy.shouldUseAi && !automaticCommentPolicy.mustUseAi && !automaticFixPolicy.shouldUseAi && !automaticFixPolicy.mustUseAi) {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write(`[PINGU_DEBUG_AI] automatic ai disabled merged=${mergedIssues.length}\n`);
    }
    return mergedIssues;
  }

  const resolved = mergedIssues.map((issue, index) => {
    if (DEBUG_AUTOMATIC_AI) {
      process.stderr.write(`[PINGU_DEBUG_AI] issue[${index}] kind=${String(issue && issue.kind || '')}\n`);
    }
    if (!issue || !shouldResolveAutomaticIssueWithAi(issue)) {
      return issue;
    }
    const issueKind = String(issue.kind || '').trim();
    const issuePolicy = AUTOMATIC_AI_COMMENT_KINDS.has(issueKind)
      ? automaticCommentPolicy
      : automaticFixPolicy;
    if (
      AUTOMATIC_AI_COMMENT_KINDS.has(issueKind)
      && automaticAiCommentMaxIssues > 0
      && automaticAiCommentIssuesResolved >= automaticAiCommentMaxIssues
    ) {
      return issue;
    }
    if (AUTOMATIC_AI_COMMENT_KINDS.has(issueKind)) {
      automaticAiCommentIssuesResolved += 1;
    }
    if (!issuePolicy.shouldUseAi) {
      if (issuePolicy.mustUseAi && !hasAiConfiguration) {
        return buildAutomaticAiRequiredIssue(file, issue);
      }
      return issue;
    }
    if (!allowAiCalls) {
      if (!issuePolicy.mustUseAi) {
        return issue;
      }
      return buildAutomaticAiRequiredIssue(
        file,
        issue,
        `Correcao no modo offline para ${issue.kind} em ${normalizedExt} ainda sem cobertura de fluxo automatico.`,
      );
    }

    if (!hasAiConfiguration) {
      if (!issuePolicy.mustUseAi) {
        return issue;
      }
      return buildAutomaticAiRequiredIssue(file, issue);
    }

    const aiResolution = resolveAiIssueFix({
      ext: normalizedExt,
      lines,
      sourceFile: file,
      activeBlueprint: loadActiveBlueprintContext(file),
      issue,
      issueInstruction: buildFollowUpInstruction(issue),
      issueContext: buildAutomaticIssueContext(lines, issue),
      instruction: buildFollowUpInstruction(issue),
      effectiveInstruction: buildFollowUpInstruction(issue),
    });

    if (!aiResolution || !String(aiResolution.snippet || '').trim()) {
      if (!issuePolicy.mustUseAi) {
        return issue;
      }
      return buildAutomaticAiRequiredIssue(
        file,
        issue,
        `Implementacao offline indisponível para ${issue.kind} em ${normalizedExt}.`,
      );
    }

    const resolvedAction = normalizeAutomaticAiAction(issue, file, aiResolution.action);
    if (!isAutomaticAiSnippetCompatible(issue, resolvedAction, aiResolution.snippet, lines)) {
      if (!issuePolicy.mustUseAi) {
        return issue;
      }
      return buildAutomaticAiRequiredIssue(
        file,
        issue,
        `Resultado offline invalido para ${issue.kind} em ${normalizedExt}; recarregue e aplique plano manual.`,
      );
    }

    return {
      ...issue,
      message: aiResolution.message || issue.message,
      suggestion: aiResolution.suggestion || issue.suggestion,
      snippet: String(aiResolution.snippet || ''),
      action: resolvedAction,
    };
  });
  if (DEBUG_AUTOMATIC_AI) {
    process.stderr.write(`[PINGU_DEBUG_AI] done resolved=${resolved.length}\n`);
  }
  return resolved;
}

function buildAutomaticAiRequiredIssue(file, issue, message = '') {
  return {
    file,
    line: issue && issue.line ? issue.line : 1,
    severity: 'error',
    kind: 'ai_required',
    message: message || `Correcao offline de ${issue && issue.kind ? issue.kind : 'issue'} em ${analysisExtension(file)} ainda sem cobertura automatizada.`,
    suggestion: 'Aja por plano manual local ou estenda o mapa offline para esse fluxo.',
    snippet: '',
    action: { op: 'insert_before' },
  };
}

function normalizeAutomaticAiAction(issue, file, action) {
  if (action && typeof action === 'object' && String(action.op || '').trim()) {
    return {
      ...action,
      target_file: action.target_file || (action.op === 'write_file' ? file : action.target_file),
      mkdir_p: action.op === 'write_file'
        ? action.mkdir_p !== false
        : action.mkdir_p,
    };
  }

  if (issue && issue.action && typeof issue.action === 'object' && String(issue.action.op || '').trim()) {
    return issue.action;
  }

  if (['context_contract', 'nested_condition', 'todo_fixme', 'functional_reassignment'].includes(String(issue && issue.kind || ''))) {
    return {
      op: 'write_file',
      target_file: file,
      mkdir_p: true,
    };
  }

  if (['undefined_variable', 'debug_output'].includes(String(issue && issue.kind || ''))) {
    return { op: 'replace_line' };
  }

  const issueKind = String(issue && issue.kind || '').trim();
  if (issueKind) {
    return defaultActionForKind(issueKind);
  }
  return { op: 'insert_before' };
}

function buildAutomaticIssueContext(lines, issue) {
  const focusLine = Math.max(1, Number(issue && issue.line || 1));
  const start = Math.max(0, focusLine - 6);
  const end = Math.min(lines.length, focusLine + 5);
  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
  const previousNonEmpty = findAutomaticIssueNeighbor(lines, focusLine - 1, -1);
  const nextNonEmpty = findAutomaticIssueNeighbor(lines, focusLine - 1, 1);

  return {
    extension: analysisExtension(issue && issue.file || ''),
    issueKind: String(issue && issue.kind || ''),
    issueMessage: String(issue && issue.message || ''),
    issueSuggestion: String(issue && issue.suggestion || ''),
    bufferContext: {
      policy: 'full_buffer',
      lineCount: lines.length,
    },
    focusLine,
    lineText: String(lines[focusLine - 1] || ''),
    surroundingLines: lines.slice(start, end).map((line, index) => ({
      line: start + index + 1,
      text: String(line || ''),
    })),
    previousNonEmptyLine: previousNonEmpty,
    nextNonEmptyLine: nextNonEmpty,
    projectMemory: loadProjectMemory(issue && issue.file || ''),
    domainTerms: collectAutomaticIssueDomainTerms(lines, issue),
    metadata: {
      symbolName: String(metadata.symbolName || ''),
      declarationStartLine: Number(metadata.declarationStartLine || 0) || undefined,
      declarationEndLine: Number(metadata.declarationEndLine || 0) || undefined,
      declarationLine: Number(metadata.declarationLine || 0) || undefined,
      enclosingClassName: String(metadata.enclosingClassName || metadata.containerClassName || ''),
      annotation: String(metadata.annotation || ''),
      rhs: String(metadata.rhs || ''),
      style: String(metadata.style || ''),
      insideClass: Boolean(metadata.insideClass),
      currentStep: String(metadata.currentStep || ''),
      previousStep: String(metadata.previousStep || ''),
      nextStep: String(metadata.nextStep || ''),
      params: Array.isArray(metadata.params) ? metadata.params : [],
      paramDescriptors: Array.isArray(metadata.paramDescriptors) ? metadata.paramDescriptors : [],
      returnAnnotation: String(metadata.returnAnnotation || ''),
      returnExpression: String(metadata.returnExpression || ''),
      signaturePreview: Array.isArray(metadata.signaturePreview) ? metadata.signaturePreview : [],
      bodyPreview: Array.isArray(metadata.bodyPreview) ? metadata.bodyPreview : [],
    },
  };
}

function collectAutomaticIssueDomainTerms(lines, issue) {
  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
  const projectMemory = loadProjectMemory(issue && issue.file || '');
  const pool = [
    String(metadata.symbolName || ''),
    String(metadata.enclosingClassName || metadata.containerClassName || ''),
    String(metadata.annotation || ''),
    String(metadata.rhs || ''),
    String(metadata.currentStep || ''),
    String(metadata.previousStep || ''),
    String(metadata.nextStep || ''),
    String(metadata.returnExpression || ''),
    String(projectMemory.entity || ''),
    String(projectMemory.contextSummary || ''),
    ...(Array.isArray(metadata.signaturePreview) ? metadata.signaturePreview : []),
    ...(Array.isArray(metadata.bodyPreview) ? metadata.bodyPreview : []),
    ...(Array.isArray(lines) ? lines.slice(
      Math.max(0, Number(issue && issue.line || 1) - 6),
      Math.min(lines.length, Number(issue && issue.line || 1) + 5),
    ) : []),
  ].join(' ');

  return Array.from(new Set(
    String(pool || '')
      .match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) || [],
  ))
    .map((term) => String(term || '').trim())
    .filter((term) => {
      const normalized = term.toLowerCase();
      if (!normalized) {
        return false;
      }
      if (/^(?:async|await|class|const|def|do|else|end|false|for|from|function|if|import|let|nil|none|null|pass|return|self|static|then|true|use|var|while)$/.test(normalized)) {
        return false;
      }
      if (/^(?:value|name|label|title|count|total|status|input|output|result|data|info|item|items|list|type)$/.test(normalized)) {
        return false;
      }
      return true;
    })
    .slice(0, 12);
}

function findAutomaticIssueNeighbor(lines, focusIdx, direction) {
  const step = direction >= 0 ? 1 : -1;
  for (let idx = focusIdx + step; idx >= 0 && idx < lines.length; idx += step) {
    const text = String(lines[idx] || '').trim();
    if (!text) {
      continue;
    }
    return {
      line: idx + 1,
      text,
    };
  }
  return null;
}

function detectElixirContextContractIssues(lines, file, existingIssues = []) {
  return detectContextContractIssues(lines, file, existingIssues, {
    language: 'elixir',
    parseHeader: parseElixirPublicFunctionHeader,
    collectBlock: collectElixirFunctionBlock,
    commentPrefix: '#',
    booleanPattern: /^\s*(true|false)\s*$/,
  });
}

function detectJavaScriptContextContractIssues(lines, file, existingIssues = []) {
  return detectContextContractIssues(lines, file, existingIssues, {
    language: 'javascript',
    parseHeader: parseJavaScriptPublicFunctionHeader,
    collectBlock: collectJavaScriptFunctionBlock,
    commentPrefix: '//',
    booleanPattern: /^\s*(?:return\s+)?(?:true|false)\s*;?\s*$/,
  });
}

function detectPythonContextContractIssues(lines, file, existingIssues = []) {
  return detectContextContractIssues(lines, file, existingIssues, {
    language: 'python',
    parseHeader: parsePythonPublicFunctionHeader,
    collectBlock: collectPythonFunctionBlock,
    commentPrefix: '#',
    booleanPattern: /^\s*return\s+(?:True|False)\s*$/,
  });
}

function detectContextContractIssues(lines, file, existingIssues = [], options = {}) {
  if (hasBlockingContextContractIssue(existingIssues)) {
    return [];
  }

  const issues = [];
  const parseHeader = typeof options.parseHeader === 'function'
    ? options.parseHeader
    : () => null;
  const collectBlock = typeof options.collectBlock === 'function'
    ? options.collectBlock
    : () => null;
  const commentPrefix = String(options.commentPrefix || '#');
  const booleanPattern = options.booleanPattern instanceof RegExp
    ? options.booleanPattern
    : /^\s*(?:return\s+)?(?:true|false|True|False)\s*;?\s*$/;
  const language = String(options.language || '').trim();

  for (let index = 0; index < lines.length; index += 1) {
    const header = String(lines[index] || '');
    const declaration = parseHeader(header);
    if (!declaration || !declaration.name) {
      continue;
    }

    const expectedContractKind = inferExpectedReturnContractKind(declaration.name, file);
    if (!expectedContractKind) {
      continue;
    }

    const block = collectBlock(lines, index);
    if (!block || block.body.length === 0) {
      continue;
    }

    const lastMeaningful = lastMeaningfulBodyEntry(block.body, commentPrefix);
    if (!lastMeaningful || !booleanPattern.test(String(lastMeaningful.text || ''))) {
      continue;
    }

    const preferredReturnExpression = inferPreferredContextReturnExpression(
      block.body,
      expectedContractKind,
      language,
    );
    if (!preferredReturnExpression) {
      continue;
    }

    issues.push(buildContextContractIssue(file, lastMeaningful.line, preferredReturnExpression, {
      expectedContractKind,
      language,
      functionName: declaration.name,
    }));
  }

  return issues;
}

function hasBlockingContextContractIssue(existingIssues = []) {
  const hasBlockingSyntaxIssue = existingIssues.some((issue) => String(issue.kind || '').startsWith('syntax_'));
  if (hasBlockingSyntaxIssue) {
    return true;
  }
  return existingIssues.some((issue) => issue.kind === 'context_contract');
}

function inferExpectedReturnContractKind(functionName, file) {
  const activeBlueprint = loadActiveBlueprintContext(file);
  const projectMemory = loadProjectMemory(file);
  const signal = [
    normalizeSemanticSignal(functionName || ''),
    normalizeSemanticSignal(projectMemory.entity || ''),
    normalizeSemanticSignal(projectMemory.contextSummary || ''),
    normalizeSemanticSignal(activeBlueprint && activeBlueprint.entity || ''),
    normalizeSemanticSignal(activeBlueprint && activeBlueprint.summary || ''),
    normalizeSemanticSignal(activeBlueprint && activeBlueprint.body || ''),
    normalizeSemanticSignal(activeBlueprint && activeBlueprint.document || ''),
  ].join(' ');

  if (/\b(list|listar|all|items|entries|records|users|rooms|messages|participants|errors|warnings|lines|roles|permissions|usuarios|salas|mensagens|participantes|eventos)\b/.test(signal)) {
    return 'collection';
  }
  if (/\b(render|format|formatted|title|label|message|messagestr|text|slug|path|url|name|descricao|descricao_|nome|mensagem|texto|html|markdown)\b/.test(signal)) {
    return 'string';
  }
  if (/\b(payload|state|config|context|snapshot|record|response|request|details|summary|metadata|serialize|serialized|build|create|load|fetch|hydrate|parse|struct|data|room|invite|usuario|sala|convite)\b/.test(signal)) {
    return 'object';
  }
  if (/\b(total|sum|count|calculate|calcular|soma|somar|valor|saldo|quantidade|price|amount|score|length|size|duration|average|media|rate|percent)\b/.test(signal)) {
    return 'numeric';
  }

  return '';
}

function normalizeSemanticSignal(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildContextContractIssue(file, line, preferredReturnExpression, options = {}) {
  const expectedContractKind = String(options.expectedContractKind || '').trim();
  const normalizedExpression = normalizeContextContractExpression(preferredReturnExpression);
  const ext = analysisExtension(file);
  return {
    file,
    line,
    severity: 'warning',
    kind: 'context_contract',
    message: `Retorno booleano conflita com o contrato ${describeContextContractKind(expectedContractKind)} inferido para a funcao`,
    suggestion: `Retorne ${describeContextContractReturn(expectedContractKind)} usando a expressao local mais coerente com o fluxo.`,
    snippet: buildContextContractReplacement(normalizedExpression, ext),
    action: {
      op: 'replace_line',
    },
    contextHint: {
      preferredReturnExpression: normalizedExpression,
    },
    metadata: {
      returnExpression: normalizedExpression,
      expectedContractKind,
      symbolName: String(options.functionName || ''),
    },
  };
}

function describeContextContractKind(kind) {
  switch (String(kind || '').trim()) {
    case 'numeric':
      return 'numerico';
    case 'collection':
      return 'de colecao';
    case 'object':
      return 'de objeto';
    case 'string':
      return 'textual';
    default:
      return 'esperado';
  }
}

function describeContextContractReturn(kind) {
  switch (String(kind || '').trim()) {
    case 'numeric':
      return 'o valor numerico calculado';
    case 'collection':
      return 'a colecao montada pela funcao';
    case 'object':
      return 'o objeto consolidado pela funcao';
    case 'string':
      return 'o texto formatado pela funcao';
    default:
      return 'o valor coerente com o contrato da funcao';
  }
}

function buildContextContractReplacement(expression, ext) {
  const normalizedExt = analysisExtension(ext);
  const normalizedExpression = normalizeContextContractExpression(expression);
  if (!normalizedExpression) {
    return '';
  }
  if (['.ex', '.exs'].includes(normalizedExt)) {
    return normalizedExpression;
  }
  if (isPythonLikeExtension(normalizedExt)) {
    return `return ${normalizedExpression}`;
  }
  if (['.rb', '.lua', '.vim'].includes(normalizedExt)) {
    return `return ${normalizedExpression}`;
  }
  if (['.sh', '.bash', '.zsh'].includes(normalizedExt)) {
    return buildShellContextContractReplacement(normalizedExpression);
  }
  return `return ${normalizedExpression};`;
}

function normalizeContextContractExpression(expression) {
  return String(expression || '')
    .trim()
    .replace(/^return\s+/i, '')
    .replace(/;$/, '')
    .trim();
}

function buildShellContextContractReplacement(expression) {
  const normalizedExpression = normalizeContextContractExpression(expression);
  if (!normalizedExpression) {
    return '';
  }
  if (/^(?:["'`].*["'`]|\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*)$/.test(normalizedExpression)) {
    return `printf '%s\\n' ${normalizedExpression}`;
  }
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalizedExpression)) {
    return `printf '%s\\n' "\${${normalizedExpression}}"`;
  }
  return `printf '%s\\n' ${normalizedExpression}`;
}

function parseElixirPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*defp?\s+([a-z_][a-zA-Z0-9_?!]*)\s*(?:\(([^)]*)\))?\s+do\b/);
  if (!match) {
    return null;
  }
  return {
    name: match[1],
    params: String(match[2] || '').split(',').map((token) => String(token || '').trim()).filter(Boolean),
  };
}

function parseJavaScriptPublicFunctionHeader(line) {
  const source = String(line || '');
  let match = source.match(/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/);
  if (!match) {
    match = source.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/);
  }
  if (!match) {
    match = source.match(/^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/);
  }
  if (!match) {
    const methodMatch = source.match(/^\s*(?:(?:public|private|protected|readonly|static|abstract|override)\s+)*(?:async\s+)?(?:(?:get|set)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/);
    if (methodMatch && !new Set(['if', 'for', 'while', 'switch', 'catch', 'with']).has(String(methodMatch[1] || '').toLowerCase())) {
      match = methodMatch;
    }
  }
  if (!match || !match[1]) {
    return null;
  }
  return { name: String(match[1]) };
}

function parsePythonPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*(?:async\s+)?def\s+([a-z_][a-zA-Z0-9_]*)\s*\(([^)]*)\)\s*:/);
  if (!match) {
    return null;
  }
  return {
    name: String(match[1] || ''),
  };
}

function parseGoPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*func\s+(?:\([^)]*\)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
  if (!match) {
    return null;
  }
  return { name: String(match[1] || '') };
}

function parseRustPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
  if (!match) {
    return null;
  }
  return { name: String(match[1] || '') };
}

function parseCPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*((?:static|inline|extern|const|unsigned|signed|volatile|register|long|short)\s+)*(?:struct\s+\w+\s+|enum\s+\w+\s+|union\s+\w+\s+)?([A-Za-z_][A-Za-z0-9_]*(?:\s*\*)*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{/);
  if (!match) {
    return null;
  }
  return { name: String(match[3] || '') };
}

function parseRubyPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*def\s+(?:self\.)?([a-z_][a-zA-Z0-9_?!]*)\b/);
  if (!match) {
    return null;
  }
  return { name: String(match[1] || '') };
}

function parseLuaPublicFunctionHeader(line) {
  let match = String(line || '').match(/^\s*function\s+(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  if (!match) {
    match = String(line || '').match(/^\s*local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/);
  }
  if (!match) {
    return null;
  }
  return { name: String(match[1] || '') };
}

function parseVimPublicFunctionHeader(line) {
  const match = String(line || '').match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(/i);
  if (!match || !match[1] || /^s:/i.test(String(match[1] || ''))) {
    return null;
  }
  return { name: String(match[1] || '').trim() };
}

function parseShellPublicFunctionHeader(line) {
  let match = String(line || '').match(/^\s*function\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(\))?\s*\{/);
  if (!match) {
    match = String(line || '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/);
  }
  if (!match) {
    return null;
  }
  return { name: String(match[1] || '') };
}

function detectCurlyLanguageContextContractIssues(lines, file, existingIssues = [], ext = '') {
  const normalizedExt = String(ext || analysisExtension(file) || '').toLowerCase();
  if (normalizedExt === '.go') {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'curly',
      parseHeader: parseGoPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
      commentPrefix: '//',
      booleanPattern: /^\s*return\s+(?:true|false)\s*;?\s*$/,
    });
  }
  if (normalizedExt === '.rs') {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'curly',
      parseHeader: parseRustPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
      commentPrefix: '//',
      booleanPattern: /^\s*(?:return\s+)?(?:true|false)\s*;?\s*$/,
    });
  }
  if (['.c', '.h', '.cpp', '.hpp'].includes(normalizedExt)) {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'curly',
      parseHeader: parseCPublicFunctionHeader,
      collectBlock: collectJavaScriptFunctionBlock,
      commentPrefix: '//',
      booleanPattern: /^\s*return\s+(?:true|false|0|1)\s*;?\s*$/,
    });
  }
  if (normalizedExt === '.rb') {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'ruby',
      parseHeader: parseRubyPublicFunctionHeader,
      collectBlock: collectRubyFunctionBlock,
      commentPrefix: '#',
      booleanPattern: /^\s*(?:return\s+)?(?:true|false)\s*$/,
    });
  }
  if (normalizedExt === '.lua') {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'lua',
      parseHeader: parseLuaPublicFunctionHeader,
      collectBlock: collectLuaFunctionBlock,
      commentPrefix: '--',
      booleanPattern: /^\s*return\s+(?:true|false)\s*$/,
    });
  }
  if (normalizedExt === '.vim') {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'vim',
      parseHeader: parseVimPublicFunctionHeader,
      collectBlock: collectVimFunctionBlock,
      commentPrefix: '"',
      booleanPattern: /^\s*return\s+(?:v:true|v:false|0|1)\s*$/,
    });
  }
  if (['.sh', '.bash', '.zsh'].includes(normalizedExt)) {
    return detectContextContractIssues(lines, file, existingIssues, {
      language: 'shell',
      parseHeader: parseShellPublicFunctionHeader,
      collectBlock: collectShellFunctionBlock,
      commentPrefix: '#',
      booleanPattern: /^\s*return\s+(?:0|1)\s*$/,
    });
  }
  return [];
}

function collectElixirFunctionBlock(lines, startIndex) {
  const header = String(lines[startIndex] || '');
  let depth = countBlockDelta(header);
  if (depth <= 0) {
    if (/\bdo\b/.test(header) && /\bend\b/.test(header)) {
      return {
        body: [],
        end: startIndex,
      };
    }
    return null;
  }
  const body = [];
  for (let index = startIndex + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const delta = countBlockDelta(line);
    const closesCurrentBlock = depth === 1 && delta < 0 && /^end\b/.test(trimmed);
    if (!closesCurrentBlock) {
      body.push({
        line: index + 1,
        text: line,
      });
    }
    depth += delta;
    if (depth === 0) {
      return {
        body,
        end: index,
      };
    }
  }
  return null;
}

function collectJavaScriptFunctionBlock(lines, startIndex) {
  const header = String(lines[startIndex] || '');
  let depth = countJavaScriptCurlyDelta(header);
  if (depth <= 0) {
    if (/{/.test(header) && /}/.test(header)) {
      return {
        body: [],
        end: startIndex,
      };
    }
    return null;
  }
  const body = [];
  for (let index = startIndex + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const delta = countJavaScriptCurlyDelta(line);
    const closesCurrentBlock = depth === 1 && delta < 0 && /^}\s*;?\s*$/.test(trimmed);
    if (!closesCurrentBlock) {
      body.push({
        line: index + 1,
        text: line,
      });
    }
    depth += delta;
    if (depth === 0) {
      return {
        body,
        end: index,
      };
    }
  }
  return null;
}

function collectPythonFunctionBlock(lines, startIndex) {
  const header = String(lines[startIndex] || '');
  const headerIndent = leadingIndentLength(header);
  if (!/:\s*$/.test(header.trim())) {
    return null;
  }

  const body = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (!trimmed) {
      if (body.length > 0) {
        body.push({ line: index + 1, text: line });
      }
      continue;
    }
    if (/^\s*#/.test(line)) {
      if (body.length > 0) {
        body.push({ line: index + 1, text: line });
      }
      continue;
    }

    const indent = leadingIndentLength(line);
    if (indent <= headerIndent) {
      break;
    }

    body.push({
      line: index + 1,
      text: line,
    });
  }

  return {
    body,
    end: body.length > 0 ? body[body.length - 1].line - 1 : startIndex,
  };
}

function collectRubyFunctionBlock(lines, startIndex) {
  return collectEndDelimitedFunctionBlock(lines, startIndex, {
    openPattern: /^(?:class|module|def|if|unless|case|begin|for|while|until)\b|\bdo\b(?:\s*\|[^|]*\|)?\s*$/,
    closePattern: /^end\b/,
    commentPattern: /^#/,
  });
}

function collectLuaFunctionBlock(lines, startIndex) {
  return collectEndDelimitedFunctionBlock(lines, startIndex, {
    openPattern: /^(?:function|if\b.+\bthen|for\b.+\bdo|while\b.+\bdo|do\b|repeat\b)/,
    closePattern: /^(?:end|until\b)/,
    commentPattern: /^--/,
  });
}

function collectVimFunctionBlock(lines, startIndex) {
  const body = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (/^endfunction\b/i.test(trimmed)) {
      return {
        body,
        end: index,
      };
    }
    body.push({
      line: index + 1,
      text: line,
    });
  }
  return null;
}

function collectShellFunctionBlock(lines, startIndex) {
  const body = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    if (/^\}\s*;?\s*$/.test(trimmed)) {
      return {
        body,
        end: index,
      };
    }
    body.push({
      line: index + 1,
      text: line,
    });
  }
  return null;
}

function collectEndDelimitedFunctionBlock(lines, startIndex, options = {}) {
  const openPattern = options.openPattern instanceof RegExp ? options.openPattern : /^\s*do\b/;
  const closePattern = options.closePattern instanceof RegExp ? options.closePattern : /^\s*end\b/;
  const commentPattern = options.commentPattern instanceof RegExp ? options.commentPattern : /^\s*#/;
  let depth = 1;
  const body = [];

  for (let index = startIndex + 1; index < lines.length && depth > 0; index += 1) {
    const line = String(lines[index] || '');
    const trimmed = line.trim();
    const opens = trimmed && !commentPattern.test(trimmed) && openPattern.test(trimmed) ? 1 : 0;
    const closes = trimmed && closePattern.test(trimmed) ? 1 : 0;
    const closesCurrentBlock = depth === 1 && closes > 0;
    if (!closesCurrentBlock) {
      body.push({
        line: index + 1,
        text: line,
      });
    }
    depth += opens - closes;
    if (depth === 0) {
      return {
        body,
        end: index,
      };
    }
  }

  return null;
}

function countBlockDelta(line) {
  const source = String(line || '');
  const opens = [...source.matchAll(/\b(do|fn)\b/g)].length;
  const closes = [...source.matchAll(/\bend\b/g)].length;
  return opens - closes;
}

function countJavaScriptCurlyDelta(line) {
  const source = String(line || '')
    .replace(/\/\/.*$/, '')
    .replace(/"(?:\\.|[^"\\])*"/g, '')
    .replace(/'(?:\\.|[^'\\])*'/g, '')
    .replace(/`(?:\\.|[^`\\])*`/g, '');
  return [...source.matchAll(/\{/g)].length - [...source.matchAll(/\}/g)].length;
}

function leadingIndentLength(line) {
  const match = String(line || '').match(/^\s*/);
  return match ? match[0].length : 0;
}

function lastMeaningfulBodyEntry(bodyEntries, commentPrefix = '#') {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const entry = bodyEntries[index];
    const trimmed = String(entry && entry.text || '').trim();
    if (!trimmed || trimmed.startsWith(commentPrefix)) {
      continue;
    }
    return entry;
  }
  return null;
}

function inferPreferredContextReturnExpression(bodyEntries, expectedContractKind, language) {
  if (language === 'elixir') {
    return inferPreferredReturnExpressionFromElixir(bodyEntries, expectedContractKind);
  }
  if (language === 'python') {
    return inferPreferredReturnExpressionFromPython(bodyEntries, expectedContractKind);
  }
  if (language === 'ruby') {
    return inferPreferredReturnExpressionFromRuby(bodyEntries, expectedContractKind);
  }
  if (language === 'lua') {
    return inferPreferredReturnExpressionFromLua(bodyEntries, expectedContractKind);
  }
  if (language === 'vim') {
    return inferPreferredReturnExpressionFromVim(bodyEntries, expectedContractKind);
  }
  if (language === 'shell') {
    return inferPreferredReturnExpressionFromShell(bodyEntries, expectedContractKind);
  }
  return inferPreferredReturnExpressionFromCurlyLanguage(bodyEntries, expectedContractKind);
}

function inferPreferredReturnExpressionFromElixir(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseElixirContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromCurlyLanguage(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseCurlyContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromPython(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parsePythonContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromRuby(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseRubyContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromLua(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseLuaContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromVim(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseVimContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function inferPreferredReturnExpressionFromShell(bodyEntries, expectedContractKind) {
  for (let index = bodyEntries.length - 1; index >= 0; index -= 1) {
    const text = String(bodyEntries[index] && bodyEntries[index].text || '').trim();
    const candidate = parseShellContextContractCandidate(text);
    if (contextContractCandidateMatchesKind(candidate, expectedContractKind)) {
      return candidate.preferredExpression;
    }
  }
  return '';
}

function parseElixirContextContractCandidate(text) {
  const assignment = String(text || '').match(/^([a-z_][a-zA-Z0-9_?!]*)\s*=\s*(.+)$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const expression = String(text || '').trim();
  if (!expression || /^(?:if|case|cond|with|fn|->|end)\b/.test(expression)) {
    return null;
  }
  return {
    name: '',
    expression,
    preferredExpression: expression,
  };
}

function parseCurlyContextContractCandidate(text) {
  const assignment = String(text || '').match(/^(?:(?:const|let|var|let\s+mut)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*(.+?);?$/)
    || String(text || '').match(/^(?:[A-Za-z_][A-Za-z0-9_\s\*]*?\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);?$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const returnExpression = String(text || '').match(/^return\s+(.+?);?\s*$/);
  if (returnExpression) {
    const expression = String(returnExpression[1] || '').trim();
    return {
      name: '',
      expression,
      preferredExpression: expression,
    };
  }
  const bareExpression = String(text || '').trim().replace(/;$/, '');
  if (bareExpression && !/^(?:if|for|while|switch|match|else|case|break|continue|\{|\})\b/.test(bareExpression)) {
    return {
      name: '',
      expression: bareExpression,
      preferredExpression: bareExpression,
    };
  }
  return null;
}

function parsePythonContextContractCandidate(text) {
  const assignment = String(text || '').match(/^([a-z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const returnExpression = String(text || '').match(/^return\s+(.+?)\s*$/);
  if (returnExpression) {
    const expression = String(returnExpression[1] || '').trim();
    return {
      name: '',
      expression,
      preferredExpression: expression,
    };
  }
  return null;
}

function parseRubyContextContractCandidate(text) {
  const assignment = String(text || '').match(/^(@@?[a-z_][a-zA-Z0-9_]*|[A-Z][A-Za-z0-9_]*|[a-z_][a-zA-Z0-9_]*)\s*=\s*(.+)$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim().replace(/^@+/, ''),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const returnExpression = String(text || '').match(/^return\s+(.+?)\s*$/);
  if (returnExpression) {
    const expression = String(returnExpression[1] || '').trim();
    return {
      name: '',
      expression,
      preferredExpression: expression,
    };
  }
  const bareExpression = String(text || '').trim();
  if (bareExpression && !/^(?:if|unless|case|when|else|elsif|begin|rescue|ensure|end)\b/.test(bareExpression)) {
    return {
      name: '',
      expression: bareExpression,
      preferredExpression: bareExpression,
    };
  }
  return null;
}

function parseLuaContextContractCandidate(text) {
  const assignment = String(text || '').match(/^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const returnExpression = String(text || '').match(/^return\s+(.+?)\s*$/);
  if (returnExpression) {
    const expression = String(returnExpression[1] || '').trim();
    return {
      name: '',
      expression,
      preferredExpression: expression,
    };
  }
  return null;
}

function parseVimContextContractCandidate(text) {
  const assignment = String(text || '').match(/^(?:let\s+)?(?:(?:[bgstvwla]:)?)([A-Za-z_#][A-Za-z0-9_#]*)\s*=\s*(.+)$/i);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  const returnExpression = String(text || '').match(/^return\s+(.+?)\s*$/i);
  if (returnExpression) {
    const expression = String(returnExpression[1] || '').trim();
    return {
      name: '',
      expression,
      preferredExpression: expression,
    };
  }
  return null;
}

function parseShellContextContractCandidate(text) {
  const assignment = String(text || '').match(/^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
  if (assignment) {
    return {
      name: String(assignment[1] || '').trim(),
      expression: String(assignment[2] || '').trim(),
      preferredExpression: String(assignment[1] || '').trim(),
    };
  }
  return null;
}

function contextContractCandidateMatchesKind(candidate, expectedContractKind) {
  if (!candidate || !candidate.preferredExpression) {
    return false;
  }

  const name = String(candidate.name || '').trim();
  const expression = normalizeContextContractExpression(candidate.expression || '');
  if (!expression || /^(?:true|false|True|False)$/.test(expression)) {
    return false;
  }

  const signal = normalizeSemanticSignal(`${name} ${expression}`);
  switch (String(expectedContractKind || '').trim()) {
    case 'numeric':
      return /[+\-*/%]/.test(expression)
        || /^\d+(?:\.\d+)?$/.test(expression)
        || /\b(?:sum|total|count|size|length|amount|price|score|duration|valor|saldo|quantidade|media|average|rate|percent|len|enum\.count)\b/.test(signal);
    case 'collection':
      return /^\[/.test(expression)
        || /\b(?:array\.from|object\.(?:keys|values|entries)|enum\.(?:map|filter|reject|flat_map|sort|uniq)|map\(|filter\(|collect\(|list\(|values\(|keys\()/.test(signal)
        || /\b(?:items|list|users|rooms|messages|participants|entries|records|roles|permissions|usuarios|salas|mensagens|participantes|eventos)\b/.test(signal);
    case 'object':
      return /^(?:\{|\%\{)/.test(expression)
        || /\b(?:map\.(?:put|merge)|dict\(|json\.parse|struct\(|payload|state|config|context|snapshot|response|request|details|summary|metadata|record|room|invite|usuario|sala|convite|serialize|build|create|load|fetch|hydrate|parse)\b/.test(signal);
    case 'string':
      return /^(?:["'`]|f["'])/.test(expression)
        || /(?:<>|\.join\(|\.concat\(|string\(|to_string\()/.test(expression)
        || /\b(?:text|message|title|label|slug|path|url|name|descricao|nome|mensagem|texto|html|markdown)\b/.test(signal);
    default:
      return false;
  }
}

module.exports = {
  analysisExtension,
  bestPracticesFor,
  checkCommentTask,
  checkUnitTestCoverage,
  checkMissingDependencies,
  buildLeadingFunctionDocumentation,
  isJavaScriptLikeExtension,
  isReactLikeExtension,
  isPythonLikeExtension,
  isGoExtension,
  isRustExtension,
  isRubyExtension,
  resolveAutomaticIssuesWithAi,
};
