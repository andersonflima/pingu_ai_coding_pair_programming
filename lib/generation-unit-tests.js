'use strict';

const fs = require('fs');
const path = require('path');
const { resolveAiFeaturePolicy: defaultResolveAiFeaturePolicy } = require('./ai-resolution-policy');
const {
  LANGUAGE_PROFILES,
  analysisExtension,
  unitTestStyle,
  isElixirExtension,
  isMermaidExtension,
} = require('./language-profiles');

function createUnitTestCoverageChecker(helpers = {}) {
  const {
    hasOpenAiConfiguration,
    loadActiveBlueprintContext,
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
    resolveAiFeaturePolicy: resolveAiFeaturePolicyFromHelpers,
    toPosixPath,
    toImportPath,
    upwardDepth,
    upperFirst,
  } = helpers;
  const resolveAiFeaturePolicy = typeof resolveAiFeaturePolicyFromHelpers === 'function'
    ? resolveAiFeaturePolicyFromHelpers
    : defaultResolveAiFeaturePolicy;
  const pathStatCache = new Map();
  const textFileCache = new Map();
  const directoryEntriesCache = new Map();
  const preferredTestsDirCache = new Map();
  const blueprintContextCache = new Map();

  function isCExtension(ext) {
    return ['.c'].includes(String(ext || '').toLowerCase());
  }

  function analysisExtensionForTests(file) {
    return analysisExtension(file);
  }

  function readPathStatCached(targetPath) {
    const normalizedPath = String(targetPath || '');
    if (!normalizedPath) {
      return null;
    }

    try {
      const stat = fs.statSync(normalizedPath);
      const signature = `${stat.isDirectory() ? 'dir' : 'file'}:${stat.size}:${stat.mtimeMs}`;
      const cached = pathStatCache.get(normalizedPath);
      if (cached && cached.signature === signature) {
        return cached.stat;
      }
      pathStatCache.set(normalizedPath, { signature, stat });
      return stat;
    } catch (_error) {
      pathStatCache.set(normalizedPath, { signature: 'missing', stat: null });
      return null;
    }
  }

  function isDirectoryCached(targetPath) {
    const stat = readPathStatCached(targetPath);
    return Boolean(stat && stat.isDirectory());
  }

  function pathExistsCached(targetPath) {
    return Boolean(readPathStatCached(targetPath));
  }

  function readTextFileCached(targetPath) {
    const normalizedPath = String(targetPath || '');
    const stat = readPathStatCached(normalizedPath);
    if (!stat || !stat.isFile()) {
      return '';
    }

    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = textFileCache.get(normalizedPath);
    if (cached && cached.signature === signature) {
      return cached.content;
    }

    const content = fs.readFileSync(normalizedPath, 'utf8');
    textFileCache.set(normalizedPath, {
      signature,
      content,
    });
    return content;
  }

  function readDirectoryEntriesCached(targetPath) {
    const normalizedPath = String(targetPath || '');
    const stat = readPathStatCached(normalizedPath);
    if (!stat || !stat.isDirectory()) {
      return [];
    }

    const signature = `${stat.size}:${stat.mtimeMs}`;
    const cached = directoryEntriesCache.get(normalizedPath);
    if (cached && cached.signature === signature) {
      return cached.entries;
    }

    const entries = fs.readdirSync(normalizedPath);
    directoryEntriesCache.set(normalizedPath, {
      signature,
      entries,
    });
    return entries;
  }

  function loadCachedBlueprintContext(file) {
    if (typeof loadActiveBlueprintContext !== 'function') {
      return null;
    }

    const normalizedPath = String(file || '');
    const sourceStat = readPathStatCached(normalizedPath);
    const signature = sourceStat
      ? `${sourceStat.size}:${sourceStat.mtimeMs}`
      : 'missing';
    const cached = blueprintContextCache.get(normalizedPath);
    if (cached && cached.signature === signature) {
      return cached.value;
    }

    const value = loadActiveBlueprintContext(file);
    blueprintContextCache.set(normalizedPath, { signature, value });
    return value;
  }

  function isComposeFile(file) {
    const base = path.basename(String(file || '')).toLowerCase();
    return base === 'docker-compose.yml'
      || base === 'docker-compose.yaml'
      || base === 'compose.yml'
      || base === 'compose.yaml';
  }

  function isFileContractKind(file, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    return isComposeFile(file) || unitTestStyle(lowerExt) === 'contract';
  }

  function firstContractLine(lines, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const commentPattern = lowerExt === '.md'
      ? /^\s*<!--.*-->\s*$/
      : lowerExt === '.dockerfile' || ['.yaml', '.yml'].includes(lowerExt)
        ? /^\s*#/
        : isMermaidExtension(lowerExt)
          ? /^\s*%%/
          : /^\s*$/;

    const firstIndex = lines.findIndex((line) => {
      const current = String(line || '');
      if (!current.trim()) {
        return false;
      }
      return !commentPattern.test(current);
    });

    return firstIndex >= 0 ? firstIndex + 1 : 1;
  }

  function extractFileContractCandidate(lines, file, ext, fallbackName) {
    const hasSignificantContent = lines.some((line) => String(line || '').trim().length > 0);
    if (!hasSignificantContent) {
      return [];
    }

    return [{
      name: sanitizeNaturalIdentifier(fallbackName || path.parse(String(file || '')).name || 'contract'),
      arity: 0,
      line: firstContractLine(lines, ext),
    }];
  }

  function defaultTestsDirectoryName(ext) {
    const lowerExt = String(ext || '').toLowerCase();
    if (isPythonLikeExtension(lowerExt) || unitTestStyle(lowerExt) === 'contract') {
      return 'tests';
    }
    return 'test';
  }

  function resolvePreferredTestsDir(projectRoot, sourceExt = '') {
    const normalizedRoot = String(projectRoot || '');
    if (!normalizedRoot) {
      return '';
    }

    const testsDir = path.join(normalizedRoot, 'tests');
    const testDir = path.join(normalizedRoot, 'test');
    const signature = [
      readPathStatCached(testsDir),
      readPathStatCached(testDir),
    ].map((stat) => !stat ? 'missing' : `${stat.isDirectory() ? 'dir' : 'file'}:${stat.size}:${stat.mtimeMs}`).join('|');
    const cached = preferredTestsDirCache.get(normalizedRoot);
    if (cached && cached.signature === signature) {
      return cached.value;
    }

    const value = isDirectoryCached(testsDir)
      ? testsDir
      : isDirectoryCached(testDir)
        ? testDir
        : path.join(normalizedRoot, defaultTestsDirectoryName(sourceExt));
    preferredTestsDirCache.set(normalizedRoot, { signature, value });
    return value;
  }

  function checkUnitTestCoverage(lines, file) {
    const ext = analysisExtensionForTests(file);
    if (shouldSkipUnitTestCoverage(file, ext)) {
      return [];
    }
    const canUseAiForUnitTests = hasOpenAiConfiguration && hasOpenAiConfiguration();
    const aiPolicy = resolveAiFeaturePolicy('unit_test', process.env, {
      hasOpenAiConfiguration: canUseAiForUnitTests,
    });
    const mustUseAiForUnitTests = Boolean(requiresAiForFeature && requiresAiForFeature(file, 'unit_test')) || aiPolicy.mustUseAi;
    const shouldUseAiForUnitTests = mustUseAiForUnitTests || aiPolicy.shouldUseAi;

    if (mustUseAiForUnitTests && !canUseAiForUnitTests) {
      return [{
        file,
        line: 1,
        severity: 'error',
        kind: 'ai_required',
        message: 'Cobertura offline indisponivel para geração de testes unitários neste arquivo.',
        suggestion: 'Adicione o plano de teste offline para essa linguagem ou use implementação manual.',
        snippet: '',
        action: { op: 'insert_before' },
      }];
    }

    const candidates = extractTestCandidates(lines, file);
    if (!candidates.length) {
      return [];
    }

    const targetFile = resolveUnitTestTargetFile(file, ext);
    if (!targetFile) {
      return [];
    }

    const relatedFiles = normalizeRelatedUnitTestFiles([
      ...resolveRelatedUnitTestFiles(file, ext, targetFile),
      targetFile,
    ]);
    const uncoveredCandidates = findUntestedUnitTestCandidates(file, ext, targetFile, candidates);
    const signatureDriftIssues = findUnitTestSignatureDriftIssues(file, ext, relatedFiles, candidates);
    if (!uncoveredCandidates.length && !signatureDriftIssues.length) {
      return [];
    }

    if (shouldUseAiForUnitTests && uncoveredCandidates.length > 0) {
      const aiGeneratedUnitTests = resolveAiGeneratedUnitTests
        ? resolveAiGeneratedUnitTests({
          ext,
          lines,
          sourceFile: file,
          targetFile,
          focusLine: uncoveredCandidates[0].line || 1,
          testCandidates: uncoveredCandidates,
          activeBlueprint: loadCachedBlueprintContext(file),
          existingTestContent: pathExistsCached(targetFile) ? readTextFileCached(targetFile) : '',
          instruction: `gerar testes unitarios para ${path.basename(file)}`,
          effectiveInstruction: `gerar testes unitarios completos para ${uncoveredCandidates.map((candidate) => `${candidate.name}/${candidate.arity}`).join(', ')}`,
        })
        : null;

        if (!aiGeneratedUnitTests || !String(aiGeneratedUnitTests.snippet || '').trim()) {
          if (mustUseAiForUnitTests) {
            return [{
              file,
              line: uncoveredCandidates[0].line || 1,
              severity: 'error',
              kind: 'ai_required',
              message: 'Cobertura offline para testes unitários completos ainda não disponível.',
              suggestion: 'Implemente o template de teste offline para os candidatos existentes.',
              snippet: '',
              action: { op: 'insert_before' },
            }];
          }
      } else {
        return [
          buildUnitTestIssue(
            file,
            uncoveredCandidates[0].line || 1,
            aiGeneratedUnitTests.action && aiGeneratedUnitTests.action.target_file
              ? aiGeneratedUnitTests.action.target_file
              : targetFile,
            'Cobertura automatica de testes unitarios ausente',
            'Gere testes unitarios cobrindo o contrato publico identificado no arquivo.',
            String(aiGeneratedUnitTests.snippet || ''),
            aiGeneratedUnitTests.action,
          ),
        ];
      }
    }

    if (!pathExistsCached(targetFile)) {
      const snippet = buildUnitTestSnippet(lines, file, targetFile, uncoveredCandidates, ext);
      if (!snippet) {
        return signatureDriftIssues;
      }
      return [
        buildUnitTestIssue(
          file,
          uncoveredCandidates[0].line || 1,
          targetFile,
          'Cobertura basica de testes unitarios ausente',
          'Crie testes unitarios na pasta de testes do projeto para validar o contrato publico do codigo.',
          snippet,
        ),
      ];
    }

    const issues = [];
    for (const candidate of uncoveredCandidates) {
      const candidateTargetFile = resolveSupplementalUnitTestTargetFile(file, ext, candidate.name);
      if (!candidateTargetFile || pathExistsCached(candidateTargetFile)) {
        continue;
      }

      const snippet = buildUnitTestSnippet(lines, file, candidateTargetFile, [candidate], ext);
      if (!snippet) {
        continue;
      }

      issues.push(buildUnitTestIssue(
        file,
        candidate.line || 1,
        candidateTargetFile,
        `Cobertura basica de teste unitario ausente para ${candidate.name}`,
        `Crie um teste na pasta de testes do projeto para validar o contrato publico de ${candidate.name}.`,
        snippet,
      ));
    }

    return [...issues, ...signatureDriftIssues];
  }

  function normalizeUnitTestAction(targetFile, actionOverride = null) {
    if (!actionOverride || typeof actionOverride !== 'object') {
      return {
        op: 'write_file',
        target_file: targetFile,
        mkdir_p: true,
      };
    }

    const normalizedOp = String(actionOverride.op || '').trim() || 'write_file';
    return {
      ...actionOverride,
      op: normalizedOp,
      target_file: actionOverride.target_file || targetFile,
      mkdir_p: actionOverride.mkdir_p !== false,
    };
  }

  function buildUnitTestIssue(file, line, targetFile, message, suggestion, snippet, actionOverride = null) {
    return {
      file,
      line,
      severity: 'info',
      kind: 'unit_test',
      message,
      suggestion,
      snippet,
      action: normalizeUnitTestAction(targetFile, actionOverride),
    };
  }

  function shouldSkipUnitTestCoverage(file, ext) {
    const normalized = toPosixPath(file).toLowerCase();
    if (
      normalized.includes('/tests/')
      || normalized.includes('/test/')
      || normalized.endsWith('_test.go')
      || normalized.endsWith('_test.py')
      || normalized.endsWith('_test.exs')
      || normalized.endsWith('_spec.lua')
      || normalized.endsWith('_test.vim')
      || normalized.endsWith('.test.js')
      || normalized.endsWith('.test.jsx')
      || normalized.endsWith('.test.ts')
      || normalized.endsWith('.test.tsx')
      || normalized.endsWith('.test.mjs')
      || normalized.endsWith('.test.cjs')
      || normalized.endsWith('.spec.js')
      || normalized.endsWith('.spec.jsx')
      || normalized.endsWith('.spec.ts')
      || normalized.endsWith('.spec.tsx')
      || normalized.endsWith('.spec.mjs')
      || normalized.endsWith('.spec.cjs')
      || normalized.endsWith('_test.rs')
      || normalized.endsWith('_test.rb')
      || normalized.endsWith('_test.c')
      || normalized.endsWith('_test.sh')
    ) {
      return true;
    }

    return !supportedUnitTestExtensions().includes(ext);
  }

  function supportedUnitTestExtensions() {
    return LANGUAGE_PROFILES
      .filter((profile) => !profile.structured && (profile.unitTestStyle === 'native' || profile.unitTestStyle === 'contract'))
      .flatMap((profile) => profile.extensions);
  }

  function findUntestedUnitTestCandidates(file, ext, targetFile, candidates) {
    const relatedFiles = normalizeRelatedUnitTestFiles([
      ...resolveRelatedUnitTestFiles(file, ext, targetFile),
      targetFile,
    ]);
    if (!relatedFiles.length) {
      return candidates;
    }

    const relatedContents = relatedFiles
      .filter((relatedFile) => pathExistsCached(relatedFile))
      .map((relatedFile) => readTextFileCached(relatedFile));

    if (!relatedContents.length) {
      return candidates;
    }

    return candidates.filter((candidate) =>
      !relatedContents.some((content) => unitTestCandidateCovered(candidate, content, ext)));
  }

  function normalizeRelatedUnitTestFiles(files) {
    return [...new Set((Array.isArray(files) ? files : [])
      .map((file) => String(file || '').trim())
      .filter(Boolean))];
  }

  function findUnitTestSignatureDriftIssues(file, ext, relatedFiles, candidates) {
    const signatureAwareCandidates = Array.isArray(candidates)
      ? candidates.filter((candidate) => isSignatureAwareUnitTestCandidate(candidate))
      : [];
    if (!signatureAwareCandidates.length || !Array.isArray(relatedFiles) || relatedFiles.length === 0) {
      return [];
    }

    return relatedFiles
      .filter((relatedFile) => pathExistsCached(relatedFile))
      .flatMap((relatedFile) => findUnitTestSignatureDriftIssuesInFile(file, relatedFile, ext, signatureAwareCandidates));
  }

  function isSignatureAwareUnitTestCandidate(candidate) {
    const candidateName = String(candidate && candidate.name || '').trim();
    const arityRange = resolveCandidateArityRange(candidate);
    if (!candidateName || arityRange.min < 0 || arityRange.max < 0) {
      return false;
    }
    if (candidate.symbolKind === 'type' || candidate.symbolKind === 'class') {
      return false;
    }
    return true;
  }

  function findUnitTestSignatureDriftIssuesInFile(file, relatedFile, ext, candidates) {
    const issues = [];
    const lines = readTextFileCached(relatedFile).replace(/\r\n/g, '\n').split('\n');

    for (const candidate of candidates) {
      const candidateName = sanitizeIdentifier(candidate && candidate.name || '').trim();
      if (!candidateName) {
        continue;
      }
      const expectedArity = resolveCandidateArityRange(candidate);
      if (expectedArity.min < 0 || expectedArity.max < 0) {
        continue;
      }

      const operations = collectUnitTestCallArityOperationsInFile(
        lines,
        ext,
        candidateName,
        expectedArity,
        candidate,
      );
      for (const operation of operations) {
        issues.push(buildUnitTestSignatureIssue(
          file,
          operation.range.start.line + 1,
          relatedFile,
          candidate,
          operation.currentArity,
          operation.updatedArity,
          operation.replacement,
          operation.range,
        ));
      }
    }

    return issues;
  }

  function collectUnitTestCallArityOperationsInFile(lines, ext, candidateName, expectedArity, candidate) {
    const expectedRange = expectedArity && typeof expectedArity === 'object'
      ? expectedArity
      : resolveCandidateArityRange(candidate);
    if (!candidateName || expectedRange.min < 0 || expectedRange.max < 0) {
      return [];
    }

    const lowerExt = String(ext || '').toLowerCase();
    const operations = [];
    const invocations = collectUnitTestInvocationsInLines(lines, candidateName);

    for (const invocation of invocations) {
      if (isInvocationArityWithinRange(invocation.arity, expectedRange)) {
        continue;
      }

      const nextArity = resolveTargetArityForInvocation(invocation.arity, expectedRange);
      const nextArguments = buildTargetArityArguments(invocation.arguments, nextArity, candidate, lowerExt);
      operations.push({
        currentArity: invocation.arity,
        updatedArity: nextArity,
        replacement: nextArguments,
        range: {
          start: {
            line: invocation.argumentsStart.line,
            character: invocation.argumentsStart.character,
          },
          end: {
            line: invocation.argumentsEnd.line,
            character: invocation.argumentsEnd.character,
          },
        },
      });
    }

    return operations;
  }

  function collectUnitTestCallArityOperations(line, ext, candidateName, expectedArity, candidate) {
    const operations = [];
    const invocations = collectUnitTestInvocations(line, candidateName);
    if (!invocations.length) {
      return operations;
    }

    invocations.forEach((invocation) => {
      const expectedRange = expectedArity && typeof expectedArity === 'object'
        ? expectedArity
        : resolveCandidateArityRange(candidate || { arity: expectedArity });
      if (isInvocationArityWithinRange(invocation.arity, expectedRange)) {
        return;
      }

      const nextArity = resolveTargetArityForInvocation(invocation.arity, expectedRange);
      const nextArguments = buildTargetArityArguments(invocation.arguments, nextArity, candidate, ext);
      operations.push({
        start: invocation.argumentsStart,
        end: invocation.argumentsEnd,
        replacement: nextArguments,
        currentArity: invocation.arity,
        updatedArity: nextArity,
      });
    });

    return operations;
  }

  function buildUnitTestSignatureIssue(file, line, targetFile, candidate, currentArity, targetArity, updatedLine, rangeOverride) {
    const normalizedCandidate = String(candidate && candidate.name || '').trim() || 'contrato';
    const declarationContract = buildUnitTestDeclarationContract(candidate);
    const replacementRange = rangeOverride && rangeOverride.start && rangeOverride.end
      ? {
        start: {
          line: Math.max(0, Number(rangeOverride.start.line || 0)),
          character: Math.max(0, Number(rangeOverride.start.character || 0)),
        },
        end: {
          line: Math.max(rangeOverride.start.line || 0, Number(rangeOverride.end.line || 0)),
          character: Math.max(0, Number(rangeOverride.end.character || 0)),
        },
      }
      : null;

    return {
      file,
      line,
      severity: 'warning',
      kind: 'unit_test_signature',
      message: `Contrato de teste desatualizado para ${normalizedCandidate}.`,
      suggestion: `Ajuste a chamada para a nova assinatura ${normalizedCandidate}/${targetArity}.`,
      snippet: updatedLine,
      metadata: {
        ...declarationContract,
        symbolName: normalizedCandidate,
        symbolArity: targetArity,
        symbolKind: candidate && candidate.symbolKind || 'function',
        previousArity: currentArity,
        targetFile,
      },
      action: {
        op: 'replace_range',
        target_file: targetFile,
        range: {
          start: replacementRange ? replacementRange.start : {
            line: Math.max(1, Number(line || 1)) - 1,
            character: 0,
          },
          end: replacementRange ? replacementRange.end : {
            line: Math.max(1, Number(line || 1)),
            character: 0,
          },
        },
      },
    };
  }

  function buildUnitTestDeclarationContract(candidate) {
    const normalizedCandidate = candidate && typeof candidate === 'object' ? candidate : {};
    const name = String(normalizedCandidate.name || '').trim();
    const symbolKind = String(normalizedCandidate.symbolKind || 'function').trim() || 'function';
    const containerName = String(normalizedCandidate.containerName || '').trim();
    const arityRange = resolveCandidateArityRange(normalizedCandidate);
    const params = Array.isArray(normalizedCandidate.params)
      ? normalizedCandidate.params.map((param) => String(param || '').trim()).filter(Boolean)
      : [];
    const declarationLine = Math.max(0, Math.floor(Number(normalizedCandidate.line || 0)));
    const minArity = Math.max(0, Math.floor(Number(arityRange.min || 0)));
    const maxArity = Number.isFinite(arityRange.max)
      ? Math.max(0, Math.floor(Number(arityRange.max || 0)))
      : Number.MAX_SAFE_INTEGER;
    const qualifiedName = containerName ? `${containerName}.${name}` : name;

    return {
      declarationLine,
      declarationName: name,
      declarationQualifiedName: qualifiedName,
      declarationKind: symbolKind,
      declarationContainerName: containerName,
      declarationParams: params,
      declarationArityRange: {
        min: minArity,
        max: maxArity,
      },
      declarationSignatureKey: [
        symbolKind,
        qualifiedName,
        `${minArity}-${maxArity}`,
        params.join(','),
      ].join('|'),
    };
  }

  function resolveCandidateArityRange(candidate) {
    const explicitRange = candidate && candidate.arityRange;
    if (explicitRange && Number.isFinite(explicitRange.min) && Number.isFinite(explicitRange.max)) {
      return {
        min: Math.max(0, Math.floor(explicitRange.min)),
        max: Math.max(0, Math.floor(explicitRange.max)),
      };
    }

    const descriptors = Array.isArray(candidate && candidate.paramDescriptors)
      ? candidate.paramDescriptors
      : [];
    if (descriptors.length > 0) {
      const hasVariadic = descriptors.some((descriptor) => descriptor.isVariadic);
      const requiredCount = descriptors.filter((descriptor) => !descriptor.isOptional && !descriptor.isVariadic).length;
      return {
        min: requiredCount,
        max: hasVariadic ? Number.MAX_SAFE_INTEGER : descriptors.length,
      };
    }

    const arity = Number(candidate && candidate.arity);
    if (!Number.isFinite(arity)) {
      return { min: -1, max: -1 };
    }
    const normalizedArity = Math.max(0, Math.floor(arity));
    return { min: normalizedArity, max: normalizedArity };
  }

  function isInvocationArityWithinRange(arity, range) {
    const current = Number(arity);
    if (!Number.isFinite(current) || !range) {
      return false;
    }
    return current >= range.min && current <= range.max;
  }

  function resolveTargetArityForInvocation(arity, range) {
    const current = Number(arity);
    if (!Number.isFinite(current)) {
      return Math.max(0, Math.floor(Number(range && range.min || 0)));
    }
    if (current < range.min) {
      return range.min;
    }
    if (current > range.max) {
      return range.max;
    }
    return current;
  }

  function collectUnitTestInvocations(line, candidateName) {
    const normalizedLine = String(line || '');
    const candidate = String(candidateName || '').trim();
    if (!candidate) {
      return [];
    }

    const invocations = [];
    let cursor = 0;
    const scannerState = createInvocationScanState();

    while (cursor < normalizedLine.length) {
      const index = findInvocationCandidateIndex(normalizedLine, candidate, cursor, scannerState);
      if (index < 0) {
        break;
      }
      scannerState.inLineComment = false;

      let openIndex = index + candidate.length;
      while (openIndex < normalizedLine.length && /\s/.test(normalizedLine.charAt(openIndex))) {
        openIndex += 1;
      }
      if (normalizedLine.charAt(openIndex) !== '(') {
        cursor = openIndex + 1;
        continue;
      }

      const range = resolveMatchingParenRange(normalizedLine, openIndex);
      if (!range) {
        cursor = openIndex + 1;
        continue;
      }

      const argsText = normalizedLine.slice(openIndex + 1, range.close);
      const args = splitFunctionArguments(argsText);
      invocations.push({
        openParen: openIndex,
        closeParen: range.close,
        argumentsStart: openIndex + 1,
        argumentsEnd: range.close,
        arguments: args,
        arity: args.length,
      });
      cursor = range.close + 1;
    }

    return invocations;
  }

  function collectUnitTestInvocationsInLines(lines, candidateName) {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const candidate = String(candidateName || '').trim();
    if (!candidate) {
      return [];
    }

    const invocations = [];
    const scanState = createInvocationScanState();

    for (let lineIdx = 0; lineIdx < normalizedLines.length; lineIdx += 1) {
      const currentLine = String(normalizedLines[lineIdx] || '');
      let cursor = 0;
      scanState.inLineComment = false;

      while (cursor < currentLine.length) {
        const index = findInvocationCandidateIndex(currentLine, candidate, cursor, scanState);
        if (index < 0) {
          break;
        }
        scanState.inLineComment = false;

        const openParen = resolveInvocationOpenParenInLines(normalizedLines, lineIdx, index + candidate.length);
        if (!openParen) {
          cursor = index + candidate.length + 1;
          continue;
        }

        const range = resolveMatchingParenRangeInLines(normalizedLines, openParen.line, openParen.character);
        if (!range) {
          cursor = openParen.line === lineIdx
            ? openParen.character + 1
            : currentLine.length;
          continue;
        }

        const argsText = extractInvokedArgumentsText(
          normalizedLines,
          range.openLine,
          range.openColumn,
          range.closeLine,
          range.closeColumn,
        );
        const args = splitFunctionArguments(argsText);
        invocations.push({
          argumentsStart: {
            line: range.openLine,
            character: range.openColumn + 1,
          },
          argumentsEnd: {
            line: range.closeLine,
            character: range.closeColumn,
          },
          arguments: args,
          arity: args.length,
        });
        cursor = range.closeLine === lineIdx
          ? range.closeColumn + 1
          : currentLine.length;
      }
    }

    return invocations;
  }

  function resolveInvocationOpenParenInLines(lines, lineIdx, startColumn) {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const firstLine = Math.max(0, Math.floor(Number(lineIdx || 0)));
    const firstColumn = Math.max(0, Math.floor(Number(startColumn || 0)));

    for (let currentLine = firstLine; currentLine < normalizedLines.length; currentLine += 1) {
      const sourceLine = String(normalizedLines[currentLine] || '');
      const start = currentLine === firstLine ? firstColumn : 0;
      for (let column = start; column < sourceLine.length; column += 1) {
        const char = sourceLine.charAt(column);
        if (char === '(') {
          return { line: currentLine, character: column };
        }
        if (!/\s/.test(char)) {
          return null;
        }
      }
    }

    return null;
  }

  function createInvocationScanState() {
    return {
      inSingle: false,
      inDouble: false,
      inBacktick: false,
      inBlockComment: false,
      inLineComment: false,
      escaped: false,
    };
  }

  function findInvocationCandidateIndex(line, candidateName, cursor, scanState) {
    const normalizedLine = String(line || '');
    const state = scanState || createInvocationScanState();
    const target = String(candidateName || '');
    const targetLength = target.length;
    if (!target) {
      return -1;
    }
    state.inLineComment = false;

    for (let index = Math.max(0, Number(cursor || 0)); index < normalizedLine.length; index += 1) {
      const current = normalizedLine.charAt(index);

      if (state.inLineComment) {
        break;
      }

      if (state.inSingle) {
        if (state.escaped) {
          state.escaped = false;
          continue;
        }
        if (current === '\\') {
          state.escaped = true;
          continue;
        }
        if (current === '\'') {
          state.inSingle = false;
        }
        continue;
      }

      if (state.inDouble) {
        if (state.escaped) {
          state.escaped = false;
          continue;
        }
        if (current === '\\') {
          state.escaped = true;
          continue;
        }
        if (current === '"') {
          state.inDouble = false;
        }
        continue;
      }

      if (state.inBacktick) {
        if (state.escaped) {
          state.escaped = false;
          continue;
        }
        if (current === '\\') {
          state.escaped = true;
          continue;
        }
        if (current === '`') {
          state.inBacktick = false;
        }
        continue;
      }

      if (state.inBlockComment) {
        if (current === '*' && normalizedLine.charAt(index + 1) === '/') {
          state.inBlockComment = false;
          index += 1;
        }
        continue;
      }

      if (current === '/') {
        const next = normalizedLine.charAt(index + 1);
        if (next === '/') {
          state.inLineComment = true;
          break;
        }
        if (next === '*') {
          state.inBlockComment = true;
          index += 1;
          continue;
        }
      }

      if (current === '\'') {
        state.inSingle = true;
        continue;
      }
      if (current === '"') {
        state.inDouble = true;
        continue;
      }
      if (current === '`') {
        state.inBacktick = true;
        continue;
      }

      if (normalizedLine.indexOf(target, index) === index) {
        const before = index > 0 ? normalizedLine.charAt(index - 1) : '';
        const after = index + targetLength < normalizedLine.length
          ? normalizedLine.charAt(index + targetLength)
          : '';
        if (!isIdentifierCharacter(before) && !isIdentifierCharacter(after)) {
          return index;
        }
      }
    }

    return -1;
  }

  function resolveMatchingParenRangeInLines(lines, openLine, openColumn) {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const resolvedOpenLine = Number.isFinite(openLine) ? Math.floor(openLine) : -1;
    const resolvedOpenColumn = Number.isFinite(openColumn) ? Math.floor(openColumn) : -1;
    if (resolvedOpenLine < 0 || resolvedOpenLine >= normalizedLines.length || resolvedOpenColumn < 0) {
      return null;
    }

    let depth = 1;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;

    for (let currentLine = resolvedOpenLine; currentLine < normalizedLines.length; currentLine += 1) {
      const sourceLine = String(normalizedLines[currentLine] || '');
      const startOffset = currentLine === resolvedOpenLine ? resolvedOpenColumn + 1 : 0;

      for (let charIndex = startOffset; charIndex < sourceLine.length; charIndex += 1) {
        const currentChar = sourceLine.charAt(charIndex);

        if (escaped) {
          escaped = false;
          continue;
        }

        if (inSingle) {
          if (currentChar === '\\') {
            escaped = true;
            continue;
          }
          if (currentChar === "'") {
            inSingle = false;
          }
          continue;
        }
        if (inDouble) {
          if (currentChar === '\\') {
            escaped = true;
            continue;
          }
          if (currentChar === '"') {
            inDouble = false;
          }
          continue;
        }
        if (inBacktick) {
          if (currentChar === '\\') {
            escaped = true;
            continue;
          }
          if (currentChar === '`') {
            inBacktick = false;
          }
          continue;
        }

        if (currentChar === "'") {
          inSingle = true;
          continue;
        }
        if (currentChar === '"') {
          inDouble = true;
          continue;
        }
        if (currentChar === '`') {
          inBacktick = true;
          continue;
        }

        if (currentChar === '(') {
          depth += 1;
          continue;
        }
        if (currentChar === ')') {
          depth -= 1;
          if (depth === 0) {
            return {
              openLine: resolvedOpenLine,
              openColumn: resolvedOpenColumn,
              closeLine: currentLine,
              closeColumn: charIndex,
            };
          }
        }
      }
    }

    return null;
  }

  function extractInvokedArgumentsText(lines, openLine, openColumn, closeLine, closeColumn) {
    const normalizedLines = Array.isArray(lines) ? lines : [];
    const startLine = Number.isFinite(openLine) ? Math.floor(openLine) : 0;
    const endLine = Number.isFinite(closeLine) ? Math.floor(closeLine) : startLine;
    const openCol = Number.isFinite(openColumn) ? Math.floor(openColumn) : -1;
    const closeCol = Number.isFinite(closeColumn) ? Math.floor(closeColumn) : 0;

    if (startLine === endLine) {
      return String(normalizedLines[startLine] || '').slice(openCol + 1, closeCol);
    }

    const chunks = [String(normalizedLines[startLine] || '').slice(openCol + 1)];
    for (let idx = startLine + 1; idx < endLine; idx += 1) {
      chunks.push(String(normalizedLines[idx] || ''));
    }
    chunks.push(String(normalizedLines[endLine] || '').slice(0, closeCol));
    return chunks.join('\n');
  }

  function resolveMatchingParenRange(line, openIndex) {
    let depth = 0;
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;

    for (let index = Number(openIndex || 0); index < line.length; index += 1) {
      const currentChar = line.charAt(index);

      if (escaped) {
        escaped = false;
        continue;
      }

      if (inSingle) {
        if (currentChar === "\\") {
          escaped = true;
          continue;
        }
        if (currentChar === "'") {
          inSingle = false;
        }
        continue;
      }
      if (inDouble) {
        if (currentChar === "\\") {
          escaped = true;
          continue;
        }
        if (currentChar === '"') {
          inDouble = false;
        }
        continue;
      }
      if (inBacktick) {
        if (currentChar === "\\") {
          escaped = true;
          continue;
        }
        if (currentChar === '`') {
          inBacktick = false;
        }
        continue;
      }

      if (currentChar === "'") {
        inSingle = true;
        continue;
      }
      if (currentChar === '"') {
        inDouble = true;
        continue;
      }
      if (currentChar === '`') {
        inBacktick = true;
        continue;
      }

      if (currentChar === '(') {
        depth += 1;
        continue;
      }
      if (currentChar === ')') {
        depth -= 1;
        if (depth === 0) {
          return {
            open: openIndex,
            close: index,
          };
        }
      }
    }

    return null;
  }

  function isIdentifierCharacter(character) {
    return /[A-Za-z0-9_]/.test(String(character || ''));
  }

  function splitFunctionArguments(rawArguments) {
    const argumentText = String(rawArguments || '');
    if (!argumentText.trim()) {
      return [];
    }

    const args = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let inBacktick = false;
    let escaped = false;
    let depth = 0;

    for (let index = 0; index < argumentText.length; index += 1) {
      const currentChar = argumentText.charAt(index);

      if (escaped) {
        current += currentChar;
        escaped = false;
        continue;
      }
      if (currentChar === "\\") {
        current += currentChar;
        escaped = true;
        continue;
      }

      if (inSingle) {
        current += currentChar;
        if (currentChar === "'") {
          inSingle = false;
        }
        continue;
      }
      if (inDouble) {
        current += currentChar;
        if (currentChar === '"') {
          inDouble = false;
        }
        continue;
      }
      if (inBacktick) {
        current += currentChar;
        if (currentChar === '`') {
          inBacktick = false;
        }
        continue;
      }

      if (currentChar === "'") {
        inSingle = true;
        current += currentChar;
        continue;
      }
      if (currentChar === '"') {
        inDouble = true;
        current += currentChar;
        continue;
      }
      if (currentChar === '`') {
        inBacktick = true;
        current += currentChar;
        continue;
      }

      if (currentChar === '(' || currentChar === '{' || currentChar === '[') {
        depth += 1;
      } else if (currentChar === ')' || currentChar === '}' || currentChar === ']') {
        depth = Math.max(0, depth - 1);
      }

      if (currentChar === ',' && depth === 0) {
        const pending = current.trim();
        if (pending) {
          args.push(pending);
        }
        current = '';
        continue;
      }

      current += currentChar;
    }

    const final = current.trim();
    if (final) {
      args.push(final);
    }

    return args;
  }

  function buildTargetArityArguments(currentArguments, targetArity, candidate, _ext) {
    const current = Array.isArray(currentArguments) ? currentArguments : [];
    const normalizedTargetArity = Math.max(0, Math.floor(Number(targetArity || 0)));
    if (normalizedTargetArity <= 0) {
      return '';
    }

    const declarationParameters = Array.isArray(candidate && candidate.params)
      ? candidate.params.map((param) => String(param || '').trim()).filter(Boolean)
      : [];

    const next = current.slice(0, normalizedTargetArity);
    for (let index = next.length; index < normalizedTargetArity; index += 1) {
      const declarationArg = String(declarationParameters[index] || '').trim();
      next.push(declarationArg || `${index + 1}`);
    }

    return next.join(', ');
  }

  function applyLineRewriteOperations(line, operations) {
    if (!operations.length) {
      return String(line || '');
    }

    const ordered = [...operations].sort((left, right) => right.start - left.start);
    let updatedLine = String(line || '');
    ordered.forEach((operation) => {
      const start = Number.isFinite(operation.start) ? Math.max(0, Math.floor(operation.start)) : 0;
      const end = Number.isFinite(operation.end) ? Math.max(start, Math.floor(operation.end)) : start;
      const replacement = String(operation.replacement || '');
      updatedLine = `${updatedLine.slice(0, start)}${replacement}${updatedLine.slice(end)}`;
    });

    return updatedLine;
  }

  function resolveRelatedUnitTestFiles(file, ext, targetFile) {
    const testsDir = path.dirname(targetFile);
    if (!isDirectoryCached(testsDir)) {
      return [];
    }

    const baseName = path.parse(file).name;
    const targetExt = path.extname(String(targetFile || '')).toLowerCase();
    const relatedPattern = targetExt === '.sh'
      ? new RegExp(`^${escapeRegExp(baseName)}(?:_[a-z0-9_]+)?_test\\.sh$`, 'i')
      : resolveRelatedUnitTestPattern(baseName, ext);
    if (!relatedPattern) {
      return [];
    }

    return readDirectoryEntriesCached(testsDir)
      .filter((entry) => relatedPattern.test(entry))
      .map((entry) => path.join(testsDir, entry));
  }

  function resolveRelatedUnitTestPattern(baseName, ext) {
    const safeBaseName = escapeRegExp(baseName);
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:\\.[a-z0-9_]+)?\\.(?:test|spec)${escapeRegExp(lowerExt)}$`, 'i');
    }
    if (isPythonLikeExtension(lowerExt)) {
      return new RegExp(`^test_${safeBaseName}(?:_[a-z0-9_]+)?\\.py$`, 'i');
    }
    if (isElixirExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.exs$`, 'i');
    }
    if (isGoExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.go$`, 'i');
    }
    if (isRustExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.rs$`, 'i');
    }
    if (isRubyExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.rb$`, 'i');
    }
    if (isCExtension(lowerExt)) {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.c$`, 'i');
    }
    if (lowerExt === '.lua') {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_spec\\.lua$`, 'i');
    }
    if (lowerExt === '.vim') {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.vim$`, 'i');
    }
    if (unitTestStyle(lowerExt) === 'contract') {
      return new RegExp(`^${safeBaseName}(?:_[a-z0-9_]+)?_test\\.sh$`, 'i');
    }

    return null;
  }

  function unitTestCandidateCovered(candidate, content, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    const candidateName = escapeRegExp(candidate.name);
    const testName = escapeRegExp(String(candidate.name || '').replace(/[^A-Za-z0-9]+/g, '_'));
    const patterns = [];

    if (isJavaScriptLikeExtension(lowerExt)) {
      patterns.push(new RegExp(`\\bsubject\\.${candidateName}\\b`));
      patterns.push(new RegExp(`${candidateName} permanece disponivel`));
    } else if (isPythonLikeExtension(lowerExt)) {
      patterns.push(new RegExp(`test_${candidateName}_continua_disponivel`));
      patterns.push(new RegExp(`test_${candidateName}_executa_o_contrato_principal`));
      patterns.push(new RegExp(`(?:module_under_test|subject)\\.${candidateName}\\b`));
    } else if (isElixirExtension(lowerExt)) {
      patterns.push(new RegExp(`${candidateName}\\/${candidate.arity}`));
      patterns.push(new RegExp(`:${candidateName},\\s*${candidate.arity}`));
    } else if (isGoExtension(lowerExt)) {
      patterns.push(new RegExp(`Test${candidateName}IsAvailable`));
      patterns.push(new RegExp(`subject\\.${candidateName}\\b`));
    } else if (isRustExtension(lowerExt)) {
      patterns.push(new RegExp(`fn\\s+${candidateName}_is_available\\b`));
      patterns.push(new RegExp(`::${candidateName}\\s*;`));
    } else if (isRubyExtension(lowerExt)) {
      patterns.push(new RegExp(`def\\s+test_${candidateName}_continua_disponivel\\b`));
      patterns.push(new RegExp(`(?:private_)?method_defined\\?\\(:${candidateName}\\)`));
    } else if (isCExtension(lowerExt)) {
      patterns.push(new RegExp(`test_${candidateName}_is_available\\b`));
      patterns.push(new RegExp(`&${candidateName}\\b`));
    } else if (lowerExt === '.lua') {
      patterns.push(new RegExp(`${candidateName}_ref\\b`));
      patterns.push(new RegExp(`\\[["']${candidateName}["']\\]`));
    } else if (lowerExt === '.vim') {
      patterns.push(new RegExp(`function!?\\s+Test_${testName}_exists\\b`));
      patterns.push(new RegExp(`exists\\('\\*'\\s*\\.\\s*["']${candidateName}["']\\)`));
    } else if (unitTestStyle(lowerExt) === 'contract') {
      patterns.push(new RegExp(candidateName));
      patterns.push(/SOURCE_FILE=/);
    }

    patterns.push(new RegExp(`\\b${candidateName}\\b`));
    return patterns.some((pattern) => pattern.test(String(content || '')));
  }

  function resolveUnitTestTargetFile(file, ext) {
    const projectRoot = resolveProjectRoot(file);
    const testsRoot = resolvePreferredTestsDir(projectRoot, ext);
    if (!testsRoot) {
      return '';
    }

    const relativeSource = path.relative(projectRoot, file);
    if (!relativeSource || relativeSource.startsWith('..')) {
      return '';
    }

    const parsed = path.parse(relativeSource);
    const sourceDir = parsed.dir && parsed.dir !== '.' ? parsed.dir : '';
    const baseName = parsed.name;
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}.test${lowerExt}`);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `test_${baseName}.py`);
    }
    if (isElixirExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_test.exs`);
    }
    if (isGoExtension(lowerExt)) {
      return resolveGoImportPath(file)
        ? path.join(testsRoot, sourceDir, `${baseName}_test.go`)
        : path.join(testsRoot, sourceDir, `${baseName}_test.sh`);
    }
    if (isRustExtension(lowerExt)) {
      return resolveCargoPackageName(file)
        ? path.join(testsRoot, sourceDir, `${baseName}_test.rs`)
        : path.join(testsRoot, sourceDir, `${baseName}_test.sh`);
    }
    if (isRubyExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_test.rb`);
    }
    if (isCExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_test.c`);
    }
    if (lowerExt === '.lua') {
      return path.join(testsRoot, sourceDir, `${baseName}_spec.lua`);
    }
    if (lowerExt === '.vim') {
      return path.join(testsRoot, sourceDir, `${baseName}_test.vim`);
    }
    if (isFileContractKind(file, lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_test.sh`);
    }

    return '';
  }

  function resolveSupplementalUnitTestTargetFile(file, ext, candidateName) {
    const projectRoot = resolveProjectRoot(file);
    const testsRoot = resolvePreferredTestsDir(projectRoot, ext);
    if (!testsRoot) {
      return '';
    }

    const relativeSource = path.relative(projectRoot, file);
    if (!relativeSource || relativeSource.startsWith('..')) {
      return '';
    }

    const parsed = path.parse(relativeSource);
    const sourceDir = parsed.dir && parsed.dir !== '.' ? parsed.dir : '';
    const baseName = parsed.name;
    const safeCandidateName = sanitizeNaturalIdentifier(candidateName);
    const lowerExt = String(ext || '').toLowerCase();

    if (isJavaScriptLikeExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}.${safeCandidateName}.test${lowerExt}`);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `test_${baseName}_${safeCandidateName}.py`);
    }
    if (isElixirExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.exs`);
    }
    if (isGoExtension(lowerExt)) {
      return resolveGoImportPath(file)
        ? path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.go`)
        : '';
    }
    if (isRustExtension(lowerExt)) {
      return resolveCargoPackageName(file)
        ? path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.rs`)
        : '';
    }
    if (isRubyExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.rb`);
    }
    if (isCExtension(lowerExt)) {
      return path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.c`);
    }
    if (lowerExt === '.lua') {
      return path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_spec.lua`);
    }
    if (lowerExt === '.vim') {
      return path.join(testsRoot, sourceDir, `${baseName}_${safeCandidateName}_test.vim`);
    }
    if (isFileContractKind(file, lowerExt)) {
      return '';
    }

    return '';
  }

  function extractTestCandidates(lines, file) {
    const ext = analysisExtensionForTests(file);
    if (isJavaScriptLikeExtension(ext)) {
      return extractJavaScriptTestCandidates(lines);
    }
    if (isPythonLikeExtension(ext)) {
      return extractPythonTestCandidates(lines);
    }
    if (isElixirExtension(ext)) {
      return extractElixirTestCandidates(lines);
    }
    if (isGoExtension(ext)) {
      return extractGoTestCandidates(lines);
    }
    if (isRustExtension(ext)) {
      return extractRustTestCandidates(lines);
    }
    if (isRubyExtension(ext)) {
      return extractRubyTestCandidates(lines);
    }
    if (isCExtension(ext)) {
      return extractCTestCandidates(lines);
    }
    if (ext === '.lua') {
      return extractLuaTestCandidates(lines);
    }
    if (ext === '.vim') {
      return extractVimTestCandidates(lines);
    }
    if (isFileContractKind(file, ext)) {
      const fallbackName = ext === '.dockerfile'
        ? 'dockerfile_contract'
        : isComposeFile(file)
          ? 'docker_compose_contract'
          : ext === '.md'
            ? 'markdown_contract'
            : isMermaidExtension(ext)
              ? 'mermaid_contract'
              : 'file_contract';
      return extractFileContractCandidate(lines, file, ext, fallbackName);
    }
    return [];
  }

  function extractCTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = String(line || '').match(/^\s*(?:[A-Za-z_][A-Za-z0-9_\s\*]*?\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(([^;{}]*)\)\s*\{/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || ['if', 'for', 'while', 'switch', 'return', 'sizeof', 'main'].includes(name) || seen.has(name)) {
        return;
      }

      const paramsText = String(match[2] || '').trim() === 'void' ? '' : match[2];
      seen.add(name);
      candidates.push(buildFunctionTestCandidate(name, paramsText, '.c', index + 1));
    });

    return candidates;
  }

  function extractJavaScriptTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const exportNames = extractJavaScriptExportNames(lines);
    const patterns = [
      /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*export\s+const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
      /^\s*const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) {
          continue;
        }

        const name = sanitizeIdentifier(match[1]);
        const candidateKey = `function:${name}`;
        if (!name || seen.has(candidateKey)) {
          break;
        }

        seen.add(candidateKey);
        candidates.push({
          name,
          arity: countParams(match[2]),
          params: parseJavaScriptParams(match[2]),
          paramDescriptors: parseFunctionParamDescriptors(match[2], '.js'),
          arityRange: resolveParamDescriptorArityRange(parseFunctionParamDescriptors(match[2], '.js')),
          symbolKind: 'function',
          line: index + 1,
        });
        break;
      }

      const classMatch = String(line || '').match(/^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
      if (!classMatch || !classMatch[1]) {
        return;
      }

      const className = sanitizeIdentifier(classMatch[1]);
      const classKey = `class:${className}`;
      if (!className || seen.has(classKey)) {
        return;
      }

      seen.add(classKey);
      candidates.push({
        name: className,
        arity: 0,
        params: [],
        symbolKind: 'class',
        line: index + 1,
      });
      extractJavaScriptClassMethodTestCandidates(lines, index, className).forEach((candidate) => {
        const methodKey = `${candidate.symbolKind}:${candidate.containerName}.${candidate.name}`;
        if (seen.has(methodKey)) {
          return;
        }
        seen.add(methodKey);
        candidates.push(candidate);
      });
    });

    return exportNames.size > 0
      ? candidates.filter((candidate) => (
        exportNames.has(candidate.name)
        || exportNames.has(String(candidate.containerName || ''))
      ))
      : candidates;
  }

  function extractJavaScriptClassMethodTestCandidates(lines, classStartIndex, className) {
    const methodCandidates = [];
    let depth = 0;

    for (let index = classStartIndex; index < lines.length; index += 1) {
      const line = String(lines[index] || '');
      if (index === classStartIndex) {
        depth += countJavaScriptBraceDelta(line);
        continue;
      }
      if (depth <= 0) {
        break;
      }
      if (/^\s*(?:private|protected)\s+/.test(line)) {
        depth += countJavaScriptBraceDelta(line);
        continue;
      }

      const methodMatch = line.match(/^\s*(?:public\s+|private\s+|protected\s+|static\s+|async\s+|override\s+|readonly\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(([^)]*)\)\s*(?::\s*[^ {]+)?\s*\{/);
      if (methodMatch && methodMatch[1] && methodMatch[1] !== 'constructor') {
        const name = sanitizeIdentifier(methodMatch[1]);
        const paramDescriptors = parseFunctionParamDescriptors(methodMatch[2], '.js');
        if (name) {
          methodCandidates.push({
            name,
            arity: paramDescriptors.length,
            params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
            paramDescriptors,
            arityRange: resolveParamDescriptorArityRange(paramDescriptors),
            symbolKind: 'method',
            containerName: className,
            line: index + 1,
          });
        }
      }

      depth += countJavaScriptBraceDelta(line);
    }

    return methodCandidates;
  }

  function extractJavaScriptExportNames(lines) {
    const exportNames = new Set();

    lines.forEach((line) => {
      const source = String(line || '');
      let match = source.match(/^\s*export\s+(?:default\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
      if (match && match[1]) {
        exportNames.add(sanitizeIdentifier(match[1]));
      }

      match = source.match(/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (match && match[1]) {
        exportNames.add(sanitizeIdentifier(match[1]));
      }

      match = source.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (match && match[1]) {
        exportNames.add(sanitizeIdentifier(match[1]));
      }

      match = source.match(/^\s*(?:module\.)?exports\.([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match && match[1]) {
        exportNames.add(sanitizeIdentifier(match[1]));
      }

      match = source.match(/^\s*module\.exports\s*=\s*\{([^}]*)\}/);
      if (match && match[1]) {
        match[1]
          .split(',')
          .map((token) => String(token || '').trim())
          .filter(Boolean)
          .forEach((token) => {
            const mapped = token.match(/^(?:[A-Za-z_][A-Za-z0-9_]*\s*:\s*)?([A-Za-z_][A-Za-z0-9_]*)$/);
            if (mapped && mapped[1]) {
              exportNames.add(sanitizeIdentifier(mapped[1]));
            }
          });
      }

      match = source.match(/^\s*export\s*\{([^}]*)\}/);
      if (match && match[1]) {
        match[1]
          .split(',')
          .map((token) => String(token || '').trim())
          .filter(Boolean)
          .forEach((token) => {
            const mapped = token.match(/^(?:([A-Za-z_$][A-Za-z0-9_$]*)\s+as\s+)?([A-Za-z_$][A-Za-z0-9_$]*)$/);
            if (mapped && mapped[2]) {
              exportNames.add(sanitizeIdentifier(mapped[2]));
            } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token)) {
              exportNames.add(sanitizeIdentifier(token));
            }
          });
      }
    });

    return exportNames;
  }

  function parseJavaScriptParams(rawParams) {
    return String(rawParams || '')
      .split(',')
      .map((token) => String(token || '').trim())
      .filter(Boolean)
      .map((token) => sanitizeIdentifier(token.replace(/=.*/, '').replace(/^\.\.\./, '')))
      .filter(Boolean);
  }

  function extractPythonTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*:/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || name.startsWith('__') || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({
        name,
        arity: countParams(match[2]),
        params: parsePythonFunctionParams(match[2]),
        paramDescriptors: parseFunctionParamDescriptors(match[2], '.py'),
        arityRange: resolveParamDescriptorArityRange(parseFunctionParamDescriptors(match[2], '.py')),
        symbolKind: 'function',
        line: index + 1,
      });

      return;
    });

    lines.forEach((line, index) => {
      const match = line.match(/^\s*class\s+([A-Z][A-Za-z0-9_]*)\b/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({
        name,
        arity: 0,
        params: [],
        symbolKind: 'class',
        line: index + 1,
      });
    });

    return candidates;
  }

  function parsePythonFunctionParams(rawParams) {
    return String(rawParams || '')
      .split(',')
      .map((token) => String(token || '').trim())
      .filter(Boolean)
      .map((token) => sanitizeIdentifier(token.replace(/=.*/, '').replace(/\s*:\s*.+$/, '')))
      .filter((token) => token && token !== 'self' && token !== 'cls');
  }

  function extractElixirTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const moduleName = extractElixirModuleName(lines);

    lines.forEach((line, index) => {
      let match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*\(([^)]*)\)/);
      if (!match) {
        match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)\s*do\b/);
      }
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({
        ...buildFunctionTestCandidate(name, match[2] || '', '.ex', index + 1),
        moduleName,
      });
    });

    return candidates.filter((candidate) => candidate.moduleName);
  }

  function extractGoTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*func(?:\s*\([^)]*\))?\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || !/^[A-Z]/.test(name) || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push(buildFunctionTestCandidate(name, match[2], '.go', index + 1));
    });

    lines.forEach((line, index) => {
      const match = line.match(/^\s*type\s+([A-Z][A-Za-z0-9_]*)\s+(?:struct|interface)\b/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: 0, line: index + 1, symbolKind: 'type' });
    });

    return candidates;
  }

  function extractRustTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*pub\s+fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push(buildFunctionTestCandidate(name, match[2], '.rs', index + 1));
    });

    lines.forEach((line, index) => {
      const match = line.match(/^\s*pub\s+(?:struct|enum)\s+([A-Z][A-Za-z0-9_]*)\b/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push({ name, arity: 0, line: index + 1, symbolKind: 'type' });
    });

    return candidates;
  }

  function extractRubyTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*def\s+([a-z_][a-zA-Z0-9_?!]*)(?:\(([^)]*)\))?/);
      if (!match) {
        return;
      }

      const name = sanitizeIdentifier(match[1]);
      if (!name || name === 'initialize' || seen.has(name)) {
        return;
      }

      seen.add(name);
      candidates.push(buildFunctionTestCandidate(name, match[2] || '', '.rb', index + 1));
    });

    lines.forEach((line, index) => {
      const match = line.match(/^\s*class\s+([A-Z][A-Za-z0-9_:]*)\b/);
      if (!match) {
        return;
      }

      const rawName = String(match[1] || '').trim();
      const name = rawName.split('::').pop();
      if (!name || seen.has(rawName)) {
        return;
      }

      seen.add(rawName);
      candidates.push({ name, arity: 0, line: index + 1, symbolKind: 'class' });
    });

    return candidates;
  }

  function extractLuaTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();
    const patterns = [
      /^\s*local\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/,
      /^\s*function\s+([A-Za-z_][A-Za-z0-9_.:]*)\s*\(([^)]*)\)/,
    ];

    lines.forEach((line, index) => {
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) {
          continue;
        }

        const rawName = String(match[1] || '').split(/[.:]/).pop();
        const name = sanitizeIdentifier(rawName);
        if (!name || seen.has(name)) {
          break;
        }

        seen.add(name);
      candidates.push(buildFunctionTestCandidate(name, match[2], '.lua', index + 1));
      break;
    }
  });

    return candidates;
  }

  function extractVimTestCandidates(lines) {
    const candidates = [];
    const seen = new Set();

    lines.forEach((line, index) => {
      const match = line.match(/^\s*function!?\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*\(([^)]*)\)/);
      if (!match) {
        return;
      }

      const rawName = String(match[1] || '').trim();
      if (!rawName || /^s:/.test(rawName) || seen.has(rawName)) {
        return;
      }

      seen.add(rawName);
      candidates.push(buildFunctionTestCandidate(rawName, match[2], '.vim', index + 1));
    });

    return candidates;
  }

  function extractElixirModuleName(lines) {
    for (const line of lines) {
      const match = String(line || '').match(/^\s*defmodule\s+([A-Za-z0-9_.]+)\s+do/);
      if (match && match[1]) {
        return match[1];
      }
    }
    return '';
  }

  function countParams(paramsText) {
    const normalized = String(paramsText || '').trim();
    if (!normalized) {
      return 0;
    }
    return splitFunctionArguments(normalized).length;
  }

  function buildFunctionTestCandidate(name, rawParams, ext, line) {
    const paramDescriptors = parseFunctionParamDescriptors(rawParams, ext);
    return {
      name,
      arity: paramDescriptors.length,
      params: paramDescriptors.map((descriptor) => descriptor.name).filter(Boolean),
      paramDescriptors,
      arityRange: resolveParamDescriptorArityRange(paramDescriptors),
      line,
      symbolKind: 'function',
    };
  }

  function parseFunctionParamDescriptors(rawParams, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    return splitFunctionArguments(String(rawParams || ''))
      .map((token) => String(token || '').trim())
      .filter(Boolean)
      .map((token) => {
        const withoutDefault = token.replace(/=.*/, '').replace(/\\\\.*$/, '').trim();
        const source = isJavaScriptLikeExtension(lowerExt)
          ? withoutDefault.replace(/^\.\.\./, '')
          : withoutDefault.replace(/^\*{1,2}/, '');
        const rawName = resolveParamDescriptorName(source, lowerExt);
        return {
          name: sanitizeIdentifier(rawName),
          isOptional: isParamDescriptorOptional(token, lowerExt),
          isVariadic: isParamDescriptorVariadic(token, lowerExt),
        };
      })
      .filter((descriptor) => descriptor.name && !['self', 'cls'].includes(descriptor.name));
  }

  function resolveParamDescriptorName(token, ext) {
    const source = String(token || '').trim();
    const lowerExt = String(ext || '').toLowerCase();
    if (!source) {
      return '';
    }
    if (isGoExtension(lowerExt)) {
      return source.split(/\s+/)[0] || '';
    }
    if (isRustExtension(lowerExt) || isPythonLikeExtension(lowerExt) || isJavaScriptLikeExtension(lowerExt)) {
      return source.split(':')[0].replace(/\?$/, '').trim();
    }
    if (['.c', '.h'].includes(lowerExt)) {
      const compact = source.replace(/\s+/g, ' ').trim();
      if (compact === 'void') {
        return '';
      }
      const parts = compact.split(/\s+/).filter(Boolean);
      return parts[parts.length - 1] || '';
    }
    return source;
  }

  function isParamDescriptorOptional(token, ext) {
    const source = String(token || '');
    const lowerExt = String(ext || '').toLowerCase();
    if (isJavaScriptLikeExtension(lowerExt) || isPythonLikeExtension(lowerExt) || ['.rb', '.lua', '.vim', '.ex', '.exs'].includes(lowerExt)) {
      return /=/.test(source) || /\\\\/.test(source) || /\?\s*(?::|=|$)/.test(source);
    }
    return false;
  }

  function isParamDescriptorVariadic(token, ext) {
    const source = String(token || '').trim();
    const lowerExt = String(ext || '').toLowerCase();
    if (isJavaScriptLikeExtension(lowerExt) || lowerExt === '.lua') {
      return source.startsWith('...') || source === '...';
    }
    if (isPythonLikeExtension(lowerExt)) {
      return /^\*{1,2}/.test(source);
    }
    if (isGoExtension(lowerExt)) {
      return source.includes('...');
    }
    return source.includes('...');
  }

  function resolveParamDescriptorArityRange(paramDescriptors) {
    const descriptors = Array.isArray(paramDescriptors) ? paramDescriptors : [];
    const hasVariadic = descriptors.some((descriptor) => descriptor.isVariadic);
    const min = descriptors.filter((descriptor) => !descriptor.isOptional && !descriptor.isVariadic).length;
    return {
      min,
      max: hasVariadic ? Number.MAX_SAFE_INTEGER : descriptors.length,
    };
  }

  function buildUnitTestSnippet(lines, file, targetFile, candidates, ext) {
    const lowerExt = String(ext || '').toLowerCase();
    if (isJavaScriptLikeExtension(lowerExt)) {
      return buildJavaScriptUnitTestSnippet(file, targetFile, candidates, lowerExt, lines);
    }
    if (isPythonLikeExtension(lowerExt)) {
      return buildPythonUnitTestSnippet(file, targetFile, candidates);
    }
    if (isElixirExtension(lowerExt)) {
      return buildElixirUnitTestSnippet(file, targetFile, candidates);
    }
    if (isGoExtension(lowerExt)) {
      return buildGoUnitTestSnippet(file, candidates);
    }
    if (isRustExtension(lowerExt)) {
      return buildRustUnitTestSnippet(file, candidates);
    }
    if (isRubyExtension(lowerExt)) {
      return buildRubyUnitTestSnippet(file, targetFile, candidates);
    }
    if (isCExtension(lowerExt)) {
      return buildCUnitTestSnippet(file, targetFile, candidates);
    }
    if (lowerExt === '.lua') {
      return buildLuaUnitTestSnippet(file, targetFile, candidates);
    }
    if (lowerExt === '.vim') {
      return buildVimUnitTestSnippet(file, targetFile, candidates);
    }
    if (isFileContractKind(file, lowerExt)) {
      return buildFileContractTestSnippet(file, targetFile, candidates, lowerExt);
    }
    return '';
  }

  function buildCUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lines = [
      '#include <assert.h>',
      `#include ${JSON.stringify(relativeSource)}`,
      '',
      'int main(void) {',
    ];

    candidates.forEach((candidate) => {
      lines.push(`  /* Garante que ${candidate.name} continua disponivel no contrato publico. */`);
      lines.push(`  void *test_${candidate.name}_is_available = (void *) &${candidate.name};`);
      lines.push(`  assert(test_${candidate.name}_is_available != 0);`);
    });

    lines.push('  return 0;');
    lines.push('}');
    return lines.join('\n');
  }

  function buildJavaScriptUnitTestSnippet(file, targetFile, candidates, ext, sourceLines) {
    const importPath = toImportPath(path.relative(path.dirname(targetFile), file));
    const moduleStyle = detectNodeModuleStyle(file, ext);
    const output = [];

    if (moduleStyle === 'require') {
      output.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
      output.push("const test = require('node:test');");
      output.push("const assert = require('node:assert/strict');");
      output.push(`const subject = require(${JSON.stringify(importPath)});`);
    } else {
      output.push('// Valida o contrato publico do modulo sem acoplar o teste aos detalhes internos.');
      output.push("import test from 'node:test';");
      output.push("import assert from 'node:assert/strict';");
      output.push(`import * as subject from ${JSON.stringify(importPath)};`);
    }

    output.push('');
    candidates.forEach((candidate, index) => {
      const behaviorTest = inferJavaScriptBehaviorTest(sourceLines, candidate);
      if (index > 0) {
        output.push('');
      }
      output.push(`// Garante que ${candidate.name} continua exposta como parte do contrato em foco.`);
      output.push(`test(${JSON.stringify(`${candidate.name} permanece disponivel`)}, () => {`);
      output.push(`  assert.equal(typeof subject.${candidate.name}, 'function');`);
      output.push('});');
      if (behaviorTest && candidate.symbolKind !== 'class') {
        output.push('');
        output.push(`// Executa ${candidate.name} com amostra controlada para validar o comportamento observado no modulo.`);
        output.push(`test(${JSON.stringify(`${candidate.name} executa o contrato principal`)}, () => {`);
        output.push(`  assert.equal(subject.${candidate.name}(${behaviorTest.args.join(', ')}), ${behaviorTest.expected});`);
        output.push('});');
      }
    });

    return output.join('\n');
  }
  function inferJavaScriptBehaviorTest(lines, candidate) {
    const descriptor = extractJavaScriptFunctionDescriptor(lines, candidate);
    if (!descriptor) {
      return null;
    }

    const sampleValues = descriptor.params.reduce((acc, param, index) => ({
      ...acc,
      [param]: [5, 3, 2, 1][index] ?? (index + 2),
    }), {});
    const localValues = descriptor.bodyLines.reduce((acc, line) => {
      const match = String(line || '').match(/^\s*(?:(?:const|let|var)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*;?\s*$/);
      if (!match || !match[1]) {
        return acc;
      }
      return {
        ...acc,
        [sanitizeIdentifier(match[1])]: Number(match[2]),
      };
    }, {});

    const returnExpression = resolveJavaScriptReturnExpression(descriptor);
    if (!returnExpression) {
      return null;
    }

    const expected = resolveJavaScriptExpectedValue(returnExpression, sampleValues, localValues);
    if (typeof expected === 'undefined') {
      return null;
    }

    return {
      args: descriptor.params.map((param) => serializeJavaScriptLiteral(sampleValues[param])),
      expected: serializeJavaScriptLiteral(expected),
    };
  }

  function extractJavaScriptFunctionDescriptor(lines, candidate) {
    const startIndex = Math.max(0, Number(candidate && candidate.line || 1) - 1);
    const declarationLine = String(lines[startIndex] || '');
    const params = Array.isArray(candidate && candidate.params) ? candidate.params : [];

    if (!declarationLine) {
      return null;
    }

    if (declarationLine.includes('=>') && !declarationLine.includes('{')) {
      const expression = declarationLine.split('=>').slice(1).join('=>').trim().replace(/;$/, '');
      return {
        params,
        bodyLines: [],
        expression,
      };
    }

    const bodyLines = [];
    let depth = countJavaScriptBraceDelta(declarationLine);

    for (let index = startIndex + 1; index < lines.length && depth > 0; index += 1) {
      const currentLine = String(lines[index] || '');
      bodyLines.push(currentLine);
      depth += countJavaScriptBraceDelta(currentLine);
    }

    return {
      params,
      bodyLines,
      expression: '',
    };
  }

  function countJavaScriptBraceDelta(line) {
    const sanitized = String(line || '')
      .replace(/\/\/.*$/, '')
      .replace(/"(?:\\.|[^"\\])*"/g, '')
      .replace(/'(?:\\.|[^'\\])*'/g, '')
      .replace(/`(?:\\.|[^`\\])*`/g, '');
    return (sanitized.match(/\{/g) || []).length - (sanitized.match(/\}/g) || []).length;
  }

  function resolveJavaScriptReturnExpression(descriptor) {
    if (descriptor.expression) {
      return descriptor.expression.trim();
    }

    const returnLine = descriptor.bodyLines.find((line) => /\breturn\b/.test(String(line || '')));
    if (!returnLine) {
      return '';
    }
    const match = String(returnLine).match(/\breturn\s+([^;]+);?/);
    return match && match[1] ? match[1].trim() : '';
  }

  function resolveJavaScriptExpectedValue(expression, sampleValues, localValues) {
    const normalized = String(expression || '').trim();
    if (!normalized) {
      return undefined;
    }

    const direct = resolveJavaScriptValueToken(normalized, sampleValues, localValues);
    if (typeof direct !== 'undefined') {
      return direct;
    }

    const binaryMatch = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$/);
    if (!binaryMatch) {
      return undefined;
    }

    const left = resolveJavaScriptValueToken(binaryMatch[1], sampleValues, localValues);
    const right = resolveJavaScriptValueToken(binaryMatch[3], sampleValues, localValues);
    if (typeof left !== 'number' || typeof right !== 'number') {
      return undefined;
    }

    switch (binaryMatch[2]) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right === 0 ? undefined : left / right;
      case '%':
        return right === 0 ? undefined : left % right;
      default:
        return undefined;
    }
  }

  function resolveJavaScriptValueToken(token, sampleValues, localValues) {
    const normalized = String(token || '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return Number(normalized);
    }
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
    if (/^"(?:\\.|[^"\\])*"$/.test(normalized) || /^'(?:\\.|[^'\\])*'$/.test(normalized)) {
      return normalized.slice(1, -1);
    }
    if (Object.prototype.hasOwnProperty.call(localValues, normalized)) {
      return localValues[normalized];
    }
    if (Object.prototype.hasOwnProperty.call(sampleValues, normalized)) {
      return sampleValues[normalized];
    }
    return undefined;
  }

  function detectNodeModuleStyle(file, ext) {
    if (ext === '.cjs') {
      return 'require';
    }
    if (ext === '.mjs') {
      return 'import';
    }
    if (['.ts', '.tsx'].includes(ext)) {
      return 'import';
    }

    const packageDir = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'package.json')));
    if (!packageDir) {
      return ext === '.js' ? 'require' : 'import';
    }

    const packageJsonPath = path.join(packageDir, 'package.json');
    try {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      return packageJson.type === 'module' ? 'import' : 'require';
    } catch (_error) {
      return ext === '.js' ? 'require' : 'import';
    }
  }

  function buildPythonUnitTestSnippet(file, targetFile, candidates) {
    const projectRoot = resolveProjectRoot(file);
    const rootDepth = upwardDepth(path.dirname(targetFile), projectRoot);
    const sourceRelative = toPosixPath(path.relative(projectRoot, file));
    const suiteBaseName = sanitizeNaturalIdentifier(path.parse(file).name || 'module');
    const suiteName = `${normalizePythonTypeIdentifier(suiteBaseName)}ContractTest`;
    const moduleName = `subject_${sanitizeNaturalIdentifier(path.parse(file).name || 'module')}`;
    const importModulePath = resolvePythonImportModulePath(file, projectRoot);
    const lines = [
      '"""Valida o contrato publico do modulo em foco sem acoplar o teste ao detalhe interno."""',
      '',
      ...(importModulePath
        ? ['import importlib', 'import sys']
        : ['import importlib.util']),
      'import unittest',
      'from pathlib import Path',
      '',
      `PROJECT_ROOT = Path(__file__).resolve().parents[${rootDepth}]`,
      ...(importModulePath
        ? [
          'if str(PROJECT_ROOT) not in sys.path:',
          '    sys.path.insert(0, str(PROJECT_ROOT))',
          '',
          `subject = importlib.import_module(${JSON.stringify(importModulePath)})`,
        ]
        : [
          `SOURCE_FILE = PROJECT_ROOT / ${JSON.stringify(sourceRelative)}`,
          '',
          'def load_subject():',
          '    """Carrega o modulo em foco preservando o teste desacoplado da estrutura do pacote."""',
          `    spec = importlib.util.spec_from_file_location(${JSON.stringify(moduleName)}, SOURCE_FILE)`,
          '    if spec is None or spec.loader is None:',
          '        raise RuntimeError(f"Nao foi possivel carregar o modulo de {SOURCE_FILE}")',
          '    module = importlib.util.module_from_spec(spec)',
          '    spec.loader.exec_module(module)',
          '    return module',
          '',
          'subject = load_subject()',
        ]),
      '',
      `class ${suiteName}(unittest.TestCase):`,
      '    """Confirma disponibilidade e comportamento observado do contrato publico."""',
    ];

    candidates.forEach((candidate) => {
      const behaviorTest = inferPythonBehaviorTest(file, candidates, candidate);
      lines.push('');
      lines.push(`    def test_${candidate.name}_continua_disponivel(self):`);
      if (candidate.symbolKind === 'class') {
        lines.push(`        """Garante que ${candidate.name} permanece acessivel como classe publica."""`);
        lines.push(`        self.assertTrue(hasattr(subject, ${JSON.stringify(candidate.name)}))`);
        lines.push(`        self.assertTrue(isinstance(getattr(subject, ${JSON.stringify(candidate.name)}), type))`);
      } else {
        lines.push(`        """Garante que ${candidate.name} permanece acessivel como funcao publica."""`);
        lines.push(`        self.assertTrue(callable(subject.${candidate.name}))`);
      }
      if (behaviorTest && candidate.symbolKind !== 'class') {
        lines.push('');
        lines.push(`    def test_${candidate.name}_executa_o_contrato_principal(self):`);
        lines.push(`        """Executa ${candidate.name} com amostra controlada para validar o comportamento atual."""`);
        lines.push(`        self.assertEqual(subject.${candidate.name}(${behaviorTest.args.join(', ')}), ${behaviorTest.expected})`);
      }
    });

    lines.push('');
    lines.push('if __name__ == "__main__":');
    lines.push('    unittest.main()');
    return lines.join('\n');
  }

  function resolvePythonImportModulePath(file, projectRoot) {
    const relativeSource = toPosixPath(path.relative(projectRoot, file));
    if (!relativeSource || relativeSource.startsWith('..') || !relativeSource.endsWith('.py')) {
      return '';
    }

    const moduleSegments = relativeSource
      .replace(/\.py$/, '')
      .split('/')
      .filter(Boolean);

    if (moduleSegments[moduleSegments.length - 1] === '__init__') {
      moduleSegments.pop();
    }

    if (moduleSegments.length === 0) {
      return '';
    }

    const hasOnlyImportableSegments = moduleSegments.every((segment) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment));
    return hasOnlyImportableSegments ? moduleSegments.join('.') : '';
  }

  function inferPythonBehaviorTest(file, candidates, candidate) {
    const source = fs.readFileSync(file, 'utf8');
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    const descriptor = extractPythonFunctionDescriptor(lines, candidate);
    if (!descriptor) {
      return null;
    }

    const sampleValues = descriptor.params.reduce((acc, param, index) => ({
      ...acc,
      [param]: [5, 3, 2, 1][index] ?? (index + 2),
    }), {});
    const localValues = descriptor.bodyLines.reduce((acc, line) => {
      const match = String(line || '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (!match || !match[1]) {
        return acc;
      }
      return {
        ...acc,
        [sanitizeIdentifier(match[1])]: Number(match[2]),
      };
    }, {});
    const returnExpression = resolvePythonReturnExpression(descriptor);
    if (!returnExpression) {
      return null;
    }

    const expected = resolvePythonExpectedValue(returnExpression, sampleValues, localValues);
    if (typeof expected === 'undefined') {
      return null;
    }

    return {
      args: descriptor.params.map((param) => JSON.stringify(sampleValues[param])),
      expected: JSON.stringify(expected),
    };
  }

  function extractPythonFunctionDescriptor(lines, candidate) {
    const startIndex = Math.max(0, Number(candidate && candidate.line || 1) - 1);
    const declarationLine = String(lines[startIndex] || '');
    if (!declarationLine) {
      return null;
    }

    const indentation = declarationLine.match(/^\s*/);
    const baseIndent = indentation ? indentation[0].length : 0;
    const bodyLines = [];

    for (let index = startIndex + 1; index < lines.length; index += 1) {
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

    return {
      params: Array.isArray(candidate && candidate.params) ? candidate.params : [],
      bodyLines,
    };
  }

  function resolvePythonReturnExpression(descriptor) {
    const returnLine = descriptor.bodyLines.find((line) => /^\s*return\b/.test(String(line || '')));
    if (!returnLine) {
      return '';
    }
    const match = String(returnLine).match(/^\s*return\s+(.+?)\s*$/);
    return match && match[1] ? match[1].trim() : '';
  }

  function resolvePythonExpectedValue(expression, sampleValues, localValues) {
    const normalized = String(expression || '').trim();
    if (!normalized) {
      return undefined;
    }

    const direct = resolvePythonValueToken(normalized, sampleValues, localValues);
    if (typeof direct !== 'undefined') {
      return direct;
    }

    const binaryMatch = normalized.match(/^([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)\s*([+\-*/%])\s*([A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)$/);
    if (!binaryMatch) {
      return undefined;
    }

    const left = resolvePythonValueToken(binaryMatch[1], sampleValues, localValues);
    const right = resolvePythonValueToken(binaryMatch[3], sampleValues, localValues);
    if (typeof left !== 'number' || typeof right !== 'number') {
      return undefined;
    }

    switch (binaryMatch[2]) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right === 0 ? undefined : left / right;
      case '%':
        return right === 0 ? undefined : left % right;
      default:
        return undefined;
    }
  }

  function resolvePythonValueToken(token, sampleValues, localValues) {
    const normalized = String(token || '').trim();
    if (/^-?\d+(?:\.\d+)?$/.test(normalized)) {
      return Number(normalized);
    }
    if (normalized === 'True') {
      return true;
    }
    if (normalized === 'False') {
      return false;
    }
    if (/^"(?:\\.|[^"\\])*"$/.test(normalized) || /^'(?:\\.|[^'\\])*'$/.test(normalized)) {
      return normalized.slice(1, -1);
    }
    if (Object.prototype.hasOwnProperty.call(localValues, normalized)) {
      return localValues[normalized];
    }
    if (Object.prototype.hasOwnProperty.call(sampleValues, normalized)) {
      return sampleValues[normalized];
    }
    return undefined;
  }

  function serializePythonLiteral(value) {
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '0';
    }
    if (typeof value === 'boolean') {
      return value ? 'True' : 'False';
    }
    if (value === null || typeof value === 'undefined') {
      return 'None';
    }
    return JSON.stringify(value);
  }

  function serializeJavaScriptLiteral(value) {
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (typeof value === 'number') {
      return Number.isFinite(value) ? String(value) : '0';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (value === null) {
      return 'null';
    }
    if (typeof value === 'undefined') {
      return 'undefined';
    }
    return JSON.stringify(value);
  }

  function normalizePythonTypeIdentifier(value) {
    const normalized = String(sanitizeNaturalIdentifier(value || 'module'))
      .split('_')
      .filter(Boolean)
      .map((segment) => upperFirst(segment))
      .join('');
    if (!normalized) {
      return 'Module';
    }
    if (/^[0-9]/.test(normalized)) {
      return `Module${normalized}`;
    }
    return normalized;
  }

  function buildElixirUnitTestSnippet(file, targetFile, candidates) {
    const moduleName = normalizeElixirAlias(candidates[0] && candidates[0].moduleName ? candidates[0].moduleName : '');
    if (!moduleName) {
      return '';
    }

    const sourceRelative = toPosixPath(path.relative(path.dirname(targetFile), file));
    const testModuleName = `${moduleName}Test`;
    const lines = [
      'ExUnit.start()',
      '',
      '# Carrega o modulo em foco para validar o contrato publico sem acoplamento ao restante da aplicacao.',
      `Code.require_file(Path.expand(${JSON.stringify(sourceRelative)}, __DIR__))`,
      '',
      `defmodule ${testModuleName} do`,
      '  use ExUnit.Case, async: true',
      '',
      '  @moduletag :unit',
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`  test ${JSON.stringify(`${candidate.name}/${candidate.arity} permanece disponivel`)} do`);
      lines.push(`    assert function_exported?(${moduleName}, :${candidate.name}, ${candidate.arity})`);
      lines.push('  end');
    });

    lines.push('end');
    return lines.join('\n');
  }

  function buildGoUnitTestSnippet(file, candidates) {
    const importPath = resolveGoImportPath(file);
    if (!importPath) {
      return buildFileContractTestSnippet(file, resolveUnitTestTargetFile(file, '.go'), candidates, '.go');
    }

    const hasFunctionCandidate = candidates.some((candidate) => candidate.symbolKind !== 'type');
    const lines = [
      'package tests',
      '',
      'import (',
      ...(hasFunctionCandidate ? ['    "reflect"'] : []),
      '    "testing"',
      '',
      `    subject ${JSON.stringify(importPath)}`,
      ')',
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`// Test${candidate.name}IsAvailable garante que ${candidate.name} continua exposta para o fluxo publico.`);
      lines.push(`func Test${candidate.name}IsAvailable(t *testing.T) {`);
      if (candidate.symbolKind === 'type') {
        lines.push(`    var symbol subject.${candidate.name}`);
        lines.push('    _ = symbol');
      } else {
        lines.push(`    if reflect.ValueOf(subject.${candidate.name}).Kind() != reflect.Func {`);
        lines.push(`        t.Fatalf(${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao exportada`)})`);
        lines.push('    }');
      }
      lines.push('}');
    });

    return lines.join('\n');
  }

  function resolveGoImportPath(file) {
    const moduleRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'go.mod')));
    if (!moduleRoot) {
      return '';
    }

    const goModPath = path.join(moduleRoot, 'go.mod');
    const goModContent = fs.readFileSync(goModPath, 'utf8');
    const moduleMatch = goModContent.match(/^module\s+(.+)$/m);
    if (!moduleMatch || !moduleMatch[1]) {
      return '';
    }

    const relativeDir = toPosixPath(path.dirname(path.relative(moduleRoot, file)));
    if (!relativeDir || relativeDir === '.') {
      return moduleMatch[1].trim();
    }

    return `${moduleMatch[1].trim()}/${relativeDir}`;
  }

  function buildRustUnitTestSnippet(file, candidates) {
    const crateName = resolveCargoPackageName(file);
    if (!crateName) {
      return buildFileContractTestSnippet(file, resolveUnitTestTargetFile(file, '.rs'), candidates, '.rs');
    }

    const sourcePath = path.resolve(file);
    const cargoRoot = findUpwards(path.dirname(sourcePath), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
    if (!cargoRoot) {
      return '';
    }

    const relativeSource = toPosixPath(path.relative(path.join(cargoRoot, 'src'), sourcePath));
    if (!relativeSource || relativeSource.startsWith('..') || relativeSource === 'main.rs') {
      return '';
    }

    const moduleSegments = relativeSource.replace(/\.rs$/, '').split('/').filter(Boolean);
    if (moduleSegments[moduleSegments.length - 1] === 'mod') {
      moduleSegments.pop();
    }

    const lines = ['// Valida o contrato publico do modulo em foco sem acoplamento ao detalhe interno.'];
    candidates.forEach((candidate, index) => {
      const importPath = [crateName, ...moduleSegments, candidate.name].join('::');
      lines.push(`use ${importPath};`);
      if (index === candidates.length - 1) {
        lines.push('');
      }
    });

    candidates.forEach((candidate, index) => {
      if (index > 0) {
        lines.push('');
      }
      lines.push(`// Garante que ${candidate.name} permanece disponivel no contrato publico.`);
      lines.push('#[test]');
      lines.push(`fn ${candidate.name}_is_available() {`);
      if (candidate.symbolKind === 'type') {
        lines.push(`    let size = core::mem::size_of::<${candidate.name}>();`);
        lines.push('    let _ = size;');
      } else {
        lines.push(`    let function_reference = ${candidate.name};`);
        lines.push('    let _ = function_reference;');
      }
      lines.push('}');
    });

    return lines.join('\n');
  }

  function buildRubyUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file)).replace(/\.rb$/i, '');
    const suiteName = `${safeTypeIdentifier(path.parse(file).name || 'source')}ContractTest`;
    const lines = [
      '# Valida o contrato publico do arquivo em foco sem acoplamento ao detalhe interno.',
      "require 'minitest/autorun'",
      `require_relative ${JSON.stringify(relativeSource)}`,
      '',
      `class ${suiteName} < Minitest::Test`,
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`  def test_${candidate.name}_continua_disponivel`);
      if (candidate.symbolKind === 'class') {
        lines.push(`    assert(Object.const_defined?(:${candidate.name}), ${JSON.stringify(`${candidate.name} deve continuar disponivel como classe`)})`);
      } else {
        lines.push(`    assert(Object.method_defined?(:${candidate.name}) || Object.private_method_defined?(:${candidate.name}), ${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao`)})`);
      }
      lines.push('  end');
    });

    lines.push('end');
    return lines.join('\n');
  }

  function resolveCargoPackageName(file) {
    const cargoRoot = findUpwards(path.dirname(path.resolve(file)), (currentDir) => pathExists(path.join(currentDir, 'Cargo.toml')));
    if (!cargoRoot) {
      return '';
    }

    const cargoToml = fs.readFileSync(path.join(cargoRoot, 'Cargo.toml'), 'utf8');
    const packageMatch = cargoToml.match(/^name\s*=\s*"([^"]+)"/m);
    if (!packageMatch || !packageMatch[1]) {
      return '';
    }

    return packageMatch[1].replace(/-/g, '_');
  }

  function buildLuaUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lines = [
      '-- Valida o contrato publico do modulo em foco sem acoplamento aos detalhes internos.',
      'local current_dir = debug.getinfo(1, "S").source:sub(2):match("(.*/)") or "./"',
      `local module_under_test = dofile(current_dir .. ${JSON.stringify(relativeSource)})`,
    ];

    candidates.forEach((candidate) => {
      lines.push('');
      lines.push(`-- Garante que ${candidate.name} continua disponivel para consumo do restante da base.`);
      lines.push(`local ${candidate.name}_ref = _G[${JSON.stringify(candidate.name)}]`);
      lines.push(`if type(${candidate.name}_ref) ~= 'function' and type(module_under_test) == 'table' then`);
      lines.push(`  ${candidate.name}_ref = module_under_test[${JSON.stringify(candidate.name)}]`);
      lines.push('end');
      lines.push(`assert(type(${candidate.name}_ref) == 'function', ${JSON.stringify(`${candidate.name} deve continuar disponivel como funcao`)})`);
    });

    return lines.join('\n');
  }

  function buildVimUnitTestSnippet(file, targetFile, candidates) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lines = [
      `let s:test_dir = fnamemodify(expand(${JSON.stringify('<sfile>:p')}), ${JSON.stringify(':h')})`,
      `execute ${JSON.stringify('source ')} . fnameescape(fnamemodify(s:test_dir . ${JSON.stringify('/' + relativeSource)}, ${JSON.stringify(':p')}))`,
      '',
    ];

    candidates.forEach((candidate, index) => {
      const testName = candidate.name.replace(/[^A-Za-z0-9]+/g, '_');
      lines.push('" Garante que a funcao continua disponivel para o contrato publico.');
      lines.push(`function! Test_${testName}_exists() abort`);
      lines.push(`  call assert_true(exists('*' . ${JSON.stringify(candidate.name)}))`);
      lines.push('endfunction');
      if (index !== candidates.length - 1) {
        lines.push('');
      }
    });

    return lines.join('\n');
  }

  function buildFileContractTestSnippet(file, targetFile, candidates, ext) {
    const relativeSource = toPosixPath(path.relative(path.dirname(targetFile), file));
    const lowerExt = String(ext || '').toLowerCase();
    const contractName = candidates[0] ? candidates[0].name : 'file_contract';
    const assertions = resolveFileContractAssertions(file, lowerExt);
    const lines = [
      '#!/bin/sh',
      'set -eu',
      `# contract: ${contractName}`,
      ...candidates.map((candidate) => `# candidate: ${candidate.name}`),
      'SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)',
      `SOURCE_FILE="$SCRIPT_DIR/${relativeSource}"`,
      'test -f "$SOURCE_FILE"',
      ...assertions,
    ];

    return lines.join('\n');
  }

  function resolveFileContractAssertions(file, ext) {
    if (ext === '.sh') {
      return [
        'sh -n "$SOURCE_FILE"',
        'grep -Eq \'^(#!|[[:space:]]*[A-Za-z_][A-Za-z0-9_]*\\(\\)|[[:space:]]*(set|if|for|while|case|printf|echo)[[:space:]])\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.tf') {
      return [
        'if command -v terraform >/dev/null 2>&1; then terraform fmt -check "$SOURCE_FILE" >/dev/null; fi',
        'grep -Eq \'^(terraform|resource|module|provider|variable|output|data)[[:space:]]\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.toml') {
      return [
        'if command -v python3 >/dev/null 2>&1; then python3 - <<\'PY\' "$SOURCE_FILE"\nimport sys\nimport tomllib\nwith open(sys.argv[1], "rb") as handle:\n    tomllib.load(handle)\nPY\nfi',
        'grep -Eq \'^(\\[[^]]+\\]|[A-Za-z0-9_.-]+[[:space:]]*=)\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.dockerfile') {
      return [
        'grep -Eq \'^FROM[[:space:]]+\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.go') {
      return [
        'grep -Eq \'^package[[:space:]]+\' "$SOURCE_FILE"',
        'grep -Eq \'^func[[:space:]]+\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.rs') {
      return [
        'grep -Eq \'^(pub[[:space:]]+)?fn[[:space:]]+\' "$SOURCE_FILE"',
      ];
    }

    if (isComposeFile(file)) {
      return [
        'grep -Eq \'^services:\\s*$\' "$SOURCE_FILE"',
        'grep -Eq \'^[[:space:]]+(image|build):\' "$SOURCE_FILE"',
      ];
    }

    if (ext === '.md') {
      return [
        'grep -Eq \'^#\' "$SOURCE_FILE"',
        'grep -Eq \'^#{1,6}[[:space:]]+\' "$SOURCE_FILE"',
      ];
    }

    if (isMermaidExtension(ext)) {
      return [
        'grep -Eq \'^(graph|flowchart|sequenceDiagram|stateDiagram|stateDiagram-v2|gantt)\\b\' "$SOURCE_FILE"',
        'grep -Eq \'(-->|->>)\' "$SOURCE_FILE"',
      ];
    }

    return [
      'test -s "$SOURCE_FILE"',
    ];
  }

  function normalizeElixirAlias(alias) {
    return String(alias || '')
      .split('.')
      .map((segment, index) => safeTypeIdentifier(segment, index === 0 ? 'Generated' : 'Part'))
      .filter(Boolean)
      .join('.');
  }

  function safeTypeIdentifier(value, leadingPrefix = 'Generated') {
    const sanitized = sanitizeNaturalIdentifier(value || '')
      .split('_')
      .filter(Boolean)
      .map((segment) => upperFirst(segment.toLowerCase()))
      .join('');
    if (!sanitized) {
      return `${leadingPrefix}Type`;
    }
    if (/^[0-9]/.test(sanitized)) {
      return `${leadingPrefix}${sanitized}`;
    }
    return sanitized;
  }

  return checkUnitTestCoverage;
}

module.exports = {
  createUnitTestCoverageChecker,
};
