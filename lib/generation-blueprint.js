'use strict';

const fs = require('fs');
const path = require('path');
const { resolveAiFeaturePolicy: defaultResolveAiFeaturePolicy } = require('./ai-resolution-policy');

// Entrada: dependencias do motor (análise, escrita, persistencia) | Saida: ferramentas de blueprint injetaveis.
function createBlueprintTools(deps) {
  const {
    analysisExtension,
    buildOfflineLanguageGuidance,
    crudEntityNames,
    escapeRegExp,
    generateCrudSnippet,
    hasOpenAiConfiguration,
    isJavaScriptLikeExtension,
    jsDocBlock,
    mustUseAiForContextBlueprint,
    parseCrudEntityName,
    pathExists,
    resolveAiContextResolution,
    resolveAiFeaturePolicy: resolveAiFeaturePolicyFromDeps,
    resolveProjectRoot,
    sanitizeNaturalIdentifier,
    toImportPath,
    toPosixPath,
    upperFirst,
  } = deps;
  const resolveAiFeaturePolicy = typeof resolveAiFeaturePolicyFromDeps === 'function'
    ? resolveAiFeaturePolicyFromDeps
    : defaultResolveAiFeaturePolicy;

  function buildContextBlueprintTasks(_lines, file, lineNumber, instruction) {
    // Entrada: linhas + arquivo + instrucao ** | Saida: lista de tarefas de blueprint para contexto.
    const blueprint = parseContextBlueprintInstruction(file, instruction);
    if (!blueprint) {
      return [];
    }

    const strictAiContextBlueprint = typeof mustUseAiForContextBlueprint === 'function'
      ? mustUseAiForContextBlueprint(file, instruction, blueprint)
      : false;
    const canUseAiContextResolution = hasOpenAiConfiguration && hasOpenAiConfiguration();
    const aiPolicy = resolveAiFeaturePolicy('context_file', process.env, {
      hasOpenAiConfiguration: canUseAiContextResolution,
    });
    const mustUseAiContextResolution = strictAiContextBlueprint || aiPolicy.mustUseAi;
    const shouldUseAiContextResolution = mustUseAiContextResolution || aiPolicy.shouldUseAi;
    if (mustUseAiContextResolution && !canUseAiContextResolution) {
      return [
        buildAiContextFailureIssue(
          file,
          lineNumber,
          'Cobertura offline ativa não inclui o modo estrito atual para este blueprint.',
          'Adicione regra contextual local equivalente no mapa offline de contexto.',
        ),
      ];
    }

    const projectRoot = resolveProjectRoot(file);
    const tasks = [];
    const contextTargetFile = resolveActiveContextTargetFile(file, blueprint);
    const currentContext = loadActiveBlueprintContext(file);
    const gitignoreIssue = buildAgentGitignoreIssue(file, lineNumber, projectRoot);

    if (gitignoreIssue) {
      tasks.push(gitignoreIssue);
    }

    const shouldResolveAiContext = canUseAiContextResolution
      && shouldUseAiContextResolution;
    let aiContextResolved = false;
    if (shouldResolveAiContext) {
      const aiContext = resolveAiContextResolution
        ? resolveAiContextResolution({
          instruction,
          effectiveInstruction: instruction,
          ext: analysisExtension(file),
          lines: _lines,
          sourceFile: file,
          lineIndex: Math.max(0, lineNumber - 1),
          marker: '**',
          activeBlueprint: currentContext,
          blueprintHint: blueprint,
          targetFile: contextTargetFile,
          existingContextDocument: currentContext && currentContext.document ? currentContext.document : '',
        })
        : null;

      if (!aiContext || !String(aiContext.snippet || '').trim()) {
        if (!mustUseAiContextResolution) {
          aiContextResolved = false;
        } else {
          const failureIssue = buildAiContextFailureIssue(
            file,
            lineNumber,
            'Cobertura offline ativa não concluiu consolidacao de contexto do blueprint.',
            'Adicione regra contextual local equivalente no mapa offline da linguagem.',
          );
          return [
            failureIssue,
          ];
        }
      } else {
        tasks.push(buildAiContextBlueprintIssue(file, lineNumber, aiContext, currentContext, contextTargetFile));
        aiContextResolved = true;
      }
    }

    if (!aiContextResolved && !pathExists(contextTargetFile)) {
      tasks.push(buildContextBlueprintIssue(
        file,
        lineNumber,
        'Documento de contexto arquitetural ausente',
        `Documente o blueprint ${blueprint.displayName} para o agente seguir no projeto.`,
        buildContextBlueprintDocument(blueprint),
        contextTargetFile,
      ));
    }

    for (const scaffoldFile of buildContextBlueprintScaffoldFiles(projectRoot, blueprint)) {
      if (pathExists(scaffoldFile.targetFile)) {
        continue;
      }
      tasks.push(buildContextBlueprintIssue(
        file,
        lineNumber,
        `Estrutura ${scaffoldFile.role} ausente`,
        `Crie ${toPosixPath(path.relative(projectRoot, scaffoldFile.targetFile))} seguindo a Onion Architecture.`,
        scaffoldFile.contents,
        scaffoldFile.targetFile,
      ));
    }

    tasks.forEach((task) => {
      task.action.remove_trigger = true;
    });

    return tasks;
  }

  function isElixirBlueprintFile(file) {
    return ['.ex', '.exs'].includes(String(analysisExtension(file) || '').toLowerCase());
  }

  function resolveActiveContextTargetFile(file, blueprint) {
    const projectRoot = resolveProjectRoot(file);
    if (isElixirBlueprintFile(file)) {
      return path.join(projectRoot, '.pingu-dev-agent', 'contexts', 'elixir-active.md');
    }
    return path.join(projectRoot, '.pingu-dev-agent', 'contexts', `${blueprint.slug}.md`);
  }

  function buildAgentGitignoreIssue(file, lineNumber, projectRoot) {
    const targetFile = path.join(projectRoot, '.gitignore');
    const snippet = buildAgentGitignoreContents(targetFile);
    if (!snippet) {
      return null;
    }

    return buildContextBlueprintIssue(
      file,
      lineNumber,
      'Ignorar arquivos de contexto do agente no Git',
      'Atualize o .gitignore para nao versionar a pasta .pingu-dev-agent/.',
      snippet,
      targetFile,
    );
  }

  function buildAgentGitignoreContents(targetFile) {
    const currentContent = pathExists(targetFile)
      ? fs.readFileSync(targetFile, 'utf8')
      : '';

    if (gitignoreCoversAgentDirectory(currentContent)) {
      return '';
    }

    const currentLines = splitLines(currentContent);
    const nextLines = trimTrailingEmptyLines(currentLines);
    if (nextLines.length > 0) {
      nextLines.push('');
    }
    nextLines.push('.pingu-dev-agent/');
    return nextLines.join('\n');
  }

  function gitignoreCoversAgentDirectory(content) {
    return splitLines(content).some((line) => {
      const trimmed = String(line || '').trim();
      if (!trimmed || trimmed.startsWith('#')) {
        return false;
      }
      return /^\.pingu-dev-agent(?:\/.*)?$/.test(trimmed);
    });
  }

  function splitLines(content) {
    return String(content || '').replace(/\r\n/g, '\n').split('\n');
  }

  function trimTrailingEmptyLines(lines) {
    const normalized = Array.isArray(lines) ? [...lines] : [];
    while (normalized.length > 0 && normalized[normalized.length - 1] === '') {
      normalized.pop();
    }
    return normalized;
  }

  function buildContextBlueprintIssue(file, lineNumber, message, suggestion, snippet, targetFile) {
    return {
      file,
      line: lineNumber,
      severity: 'info',
      kind: 'context_file',
      message,
      suggestion,
      snippet,
      action: {
        op: 'write_file',
        target_file: targetFile,
        mkdir_p: true,
        remove_trigger: false,
      },
    };
  }

  function buildAiContextFailureIssue(file, lineNumber, message, suggestion) {
    return {
      file,
      line: lineNumber,
      severity: 'error',
      kind: 'ai_required',
      message,
      suggestion,
      snippet: '',
      action: { op: 'insert_before' },
    };
  }

  function buildAiContextBlueprintIssue(file, lineNumber, aiContext, currentContext, contextTargetFile) {
    return {
      file,
      line: lineNumber,
      severity: 'info',
      kind: 'context_file',
      message: currentContext
        ? 'Contexto ativo do agente atualizado com merge ou sobreposicao'
        : 'Contexto ativo do agente criado',
      suggestion: currentContext
        ? 'Consolide o contexto ativo sem duplicar arquivos de contexto no projeto.'
        : 'Crie o contexto ativo inicial do agente para orientar as proximas geracoes.',
      snippet: String(aiContext.snippet || ''),
      action: {
        op: 'write_file',
        target_file: aiContext.action && aiContext.action.target_file
          ? aiContext.action.target_file
          : contextTargetFile,
        mkdir_p: true,
        remove_trigger: true,
      },
    };
  }

  function parseContextBlueprintInstruction(file, instruction) {
    const normalizedInstruction = String(instruction || '').trim();
    if (!normalizedInstruction) {
      return null;
    }

    const lowerInstruction = normalizedInstruction.toLowerCase();
    const projectRoot = resolveProjectRoot(file);
    const sourceExt = resolveBlueprintSourceExtension(projectRoot, file);
    const sourceRoot = resolveBlueprintSourceRoot(projectRoot, file, sourceExt);
    const sourceLanguage = blueprintLanguageLabel(sourceExt);
    const blueprintType = /\bbff\b/.test(lowerInstruction) && /\bcrud\b/.test(lowerInstruction)
      ? 'bff_crud'
      : 'project_context';
    const entity = blueprintType === 'bff_crud'
      ? parseCrudEntityName(normalizedInstruction)
      : inferBlueprintSubject(normalizedInstruction);
    const names = crudEntityNames(entity);
    const slugBase = blueprintType === 'bff_crud'
      ? `bff-crud-${names.singularSnake}`
      : sanitizeNaturalIdentifier(normalizedInstruction).replace(/_/g, '-');

    return {
      architecture: 'onion',
      blueprintType,
      displayName: blueprintType === 'bff_crud'
        ? `BFF para CRUD de ${names.singularSnake}`
        : `Contexto de projeto: ${normalizedInstruction}`,
      entity: names.singularSnake,
      generatedAt: new Date().toISOString().slice(0, 10),
      language: sourceLanguage,
      names,
      projectRoot,
      slug: slugBase || 'project-context',
      sourceExt,
      sourceRoot,
      summary: normalizedInstruction,
    };
  }

  function resolveBlueprintSourceRoot(projectRoot, file, sourceExt) {
    const relativeDir = path.relative(projectRoot, path.dirname(path.resolve(file)));
    const topLevelDir = String(relativeDir || '')
      .split(path.sep)
      .filter(Boolean)[0] || '';
    if (
      topLevelDir
      && !topLevelDir.startsWith('.')
      && !topLevelDir.startsWith('__')
      && !['test', 'tests'].includes(topLevelDir)
    ) {
      return topLevelDir;
    }

    const candidatesByExtension = {
      '.py': ['app', 'src'],
      '.go': ['internal', 'pkg', 'src'],
      '.rs': ['src'],
      '.rb': ['lib', 'app'],
      '.ex': ['lib'],
      '.exs': ['lib'],
      '.lua': ['lua'],
      '.vim': ['autoload'],
      '.sh': ['scripts'],
      '.c': ['src'],
      '.cpp': ['src'],
      '.h': ['src'],
      '.hpp': ['src'],
      '.js': ['src'],
      '.jsx': ['src'],
      '.ts': ['src'],
      '.tsx': ['src'],
      '.mjs': ['src'],
      '.cjs': ['src'],
    };

    const candidates = candidatesByExtension[sourceExt] || ['src'];
    const existing = candidates.find((candidate) => pathExists(path.join(projectRoot, candidate)));
    return existing || candidates[0] || 'src';
  }

  function inferBlueprintSubject(instruction) {
    const match = String(instruction || '').match(/\b(?:para|de|do|da)\s+([a-zà-ÿ_][a-zà-ÿ0-9_-]*)/i);
    if (match && match[1]) {
      return sanitizeNaturalIdentifier(match[1]);
    }
    return 'contexto';
  }

  function resolveBlueprintSourceExtension(projectRoot, file) {
    const currentExt = analysisExtension(file);
    if (
      [
        '.ts', '.tsx', '.js', '.jsx',
        '.py', '.go', '.rs', '.rb',
        '.ex', '.exs', '.lua', '.vim',
        '.c', '.cpp', '.h', '.hpp',
        '.sh',
      ].includes(currentExt)
    ) {
      if (currentExt === '.tsx') {
        return '.ts';
      }
      if (currentExt === '.jsx') {
        return '.js';
      }
      if (['.cpp', '.hpp', '.h'].includes(currentExt)) {
        return '.c';
      }
      return currentExt;
    }
    if (pathExists(path.join(projectRoot, 'tsconfig.json'))) {
      return '.ts';
    }
    if (pathExists(path.join(projectRoot, 'package.json'))) {
      return '.js';
    }
    if (pathExists(path.join(projectRoot, 'go.mod'))) {
      return '.go';
    }
    if (pathExists(path.join(projectRoot, 'pyproject.toml')) || pathExists(path.join(projectRoot, 'requirements.txt'))) {
      return '.py';
    }
    return '.js';
  }

  function blueprintLanguageLabel(ext) {
    if (['.ts', '.tsx'].includes(ext)) {
      return 'typescript';
    }
    if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return 'javascript';
    }
    if (ext === '.go') {
      return 'go';
    }
    if (ext === '.py') {
      return 'python';
    }
    if (ext === '.lua') {
      return 'lua';
    }
    return ext.replace(/^\./, '') || 'text';
  }

  function buildContextBlueprintDocument(blueprint) {
    const names = blueprint.names;
    const scaffoldFiles = buildContextBlueprintScaffoldFiles(blueprint.projectRoot, blueprint);
    const languageGuidance = buildOfflineLanguageGuidance(blueprint.sourceExt);
    return [
      '<!-- pingu-dev-agent-context -->',
      `slug: ${blueprint.slug}`,
      `blueprint_type: ${blueprint.blueprintType}`,
      `architecture: ${blueprint.architecture}`,
      `entity: ${names.singularSnake}`,
      `collection: ${names.pluralSnake}`,
      `language: ${blueprint.language}`,
      `source_ext: ${blueprint.sourceExt}`,
      `source_root: ${blueprint.sourceRoot}`,
      `generated_at: ${blueprint.generatedAt}`,
      '',
      `# Contexto do agente: ${blueprint.displayName}`,
      '',
      '## Objetivo',
      `- Guiar a implementacao do projeto a partir da intencao: ${blueprint.summary}.`,
      `- Manter o fluxo de desenvolvimento alinhado a uma ${upperFirst(blueprint.architecture)} Architecture com separacao explicita entre dominio, aplicacao, infraestrutura, interfaces e composicao.`,
      '',
      '## Regras de arquitetura',
      '- Dominio: regras puras, sem dependencia de IO ou framework.',
      '- Aplicacao: orquestra casos de uso por funcoes que recebem dependencias.',
      '- Infraestrutura: implementacoes concretas de repositorios e gateways.',
      '- Interfaces: controllers e rotas adaptando entrada e saida.',
      '- Main: composicao das dependencias do fluxo.',
      '',
      '## Entidade principal',
      `- Entidade: ${names.singularSnake}`,
      `- Colecao: ${names.pluralSnake}`,
      `- Escopo inicial: listar, detalhar, criar, atualizar e remover ${names.singularSnake}.`,
      '',
      '## Cobertura offline da linguagem',
      `- Perfil: ${languageGuidance.profileId}`,
      ...languageGuidance.offlineCapabilityDescriptions.map((description) => `- ${description}`),
      '',
      '## Boas praticas da linguagem',
      ...languageGuidance.bestPractices.map((practice) => `- ${practice}`),
      '',
      '## Estrutura sugerida',
      ...scaffoldFiles.map((scaffoldFile) => `- ${toPosixPath(path.relative(blueprint.projectRoot, scaffoldFile.targetFile))}`),
      '',
      '## Como o agente deve usar este contexto',
      `- Ao gerar codigo para ${names.singularSnake}, priorize os arquivos em ${blueprint.sourceRoot}/domain, ${blueprint.sourceRoot}/application, ${blueprint.sourceRoot}/infrastructure, ${blueprint.sourceRoot}/interfaces e ${blueprint.sourceRoot}/main.`,
      '- Preserve composicao funcional e injecao explicita de dependencias.',
      '- Evite acoplar controller, regra de negocio e persistencia no mesmo arquivo.',
      '',
      '## Passos seguintes sugeridos',
      `- Implementar os casos de uso de ${names.pluralSnake} respeitando o contrato do repositorio.`,
      `- Substituir o repositorio em memoria por uma implementacao concreta quando a persistencia real for definida.`,
      `- Conectar as rotas de ${names.pluralSnake} ao servidor HTTP da aplicacao.`,
    ].join('\n');
  }

  function buildContextBlueprintScaffoldFiles(projectRoot, blueprint) {
    if (blueprint.blueprintType !== 'bff_crud') {
      return [];
    }

    if (isJavaScriptLikeExtension(blueprint.sourceExt)) {
      return buildJavaScriptBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (blueprint.sourceExt === '.py') {
      return buildPythonBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (blueprint.sourceExt === '.go') {
      return buildGoBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (blueprint.sourceExt === '.rs') {
      return buildRustBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (['.ex', '.exs'].includes(blueprint.sourceExt)) {
      return buildElixirBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (blueprint.sourceExt === '.rb') {
      return buildRubyBlueprintScaffoldFiles(projectRoot, blueprint);
    }
    if (['.c', '.cpp', '.h', '.hpp'].includes(blueprint.sourceExt)) {
      return buildCBlueprintScaffoldFiles(projectRoot, blueprint);
    }

    return [];
  }

  function buildJavaScriptBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const extension = blueprint.sourceExt;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', 'entities', `${names.singularSnake}${extension}`),
      repositoryFile: path.join(sourceRoot, 'domain', 'repositories', `${names.singularSnake}-repository${extension}`),
      listUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `list-${names.pluralSnake}${extension}`),
      getUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `get-${names.singularSnake}-by-id${extension}`),
      createUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `create-${names.singularSnake}${extension}`),
      updateUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `update-${names.singularSnake}${extension}`),
      deleteUseCaseFile: path.join(sourceRoot, 'application', 'use-cases', `delete-${names.singularSnake}${extension}`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', 'repositories', `in-memory-${names.singularSnake}-repository${extension}`),
      controllerFile: path.join(sourceRoot, 'interfaces', 'http', 'controllers', `${names.singularSnake}-controller${extension}`),
      routesFile: path.join(sourceRoot, 'interfaces', 'http', 'routes', `${names.singularSnake}-routes${extension}`),
      factoryFile: path.join(sourceRoot, 'main', 'factories', `${names.singularSnake}-crud-factory${extension}`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildOnionEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildOnionRepositoryContractFile(blueprint) },
      { role: 'caso de uso de listagem', targetFile: files.listUseCaseFile, contents: buildOnionListUseCaseFile(blueprint, files) },
      { role: 'caso de uso de consulta', targetFile: files.getUseCaseFile, contents: buildOnionGetUseCaseFile(blueprint, files) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildOnionCreateUseCaseFile(blueprint, files) },
      { role: 'caso de uso de atualizacao', targetFile: files.updateUseCaseFile, contents: buildOnionUpdateUseCaseFile(blueprint, files) },
      { role: 'caso de uso de remocao', targetFile: files.deleteUseCaseFile, contents: buildOnionDeleteUseCaseFile(blueprint, files) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildOnionInMemoryRepositoryFile(blueprint, files) },
      { role: 'controller HTTP', targetFile: files.controllerFile, contents: buildOnionControllerFile(blueprint, files) },
      { role: 'rotas HTTP', targetFile: files.routesFile, contents: buildOnionRoutesFile(blueprint, files) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildOnionFactoryFile(blueprint, files) },
    ];
  }

  function buildPythonBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.py`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.py`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.py`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.py`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.py`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildPythonEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildPythonRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildPythonCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildPythonInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildPythonFactoryFile(blueprint) },
    ];
  }

  function buildGoBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.go`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.go`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.go`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.go`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.go`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildGoEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildGoRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildGoCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildGoInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildGoFactoryFile(blueprint) },
    ];
  }

  function buildRustBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.rs`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.rs`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.rs`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.rs`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.rs`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildRustEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildRustRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildRustCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildRustInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildRustFactoryFile(blueprint) },
    ];
  }

  function buildElixirBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.ex`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.ex`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.ex`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.ex`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.ex`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildElixirEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildElixirRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildElixirCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildElixirInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildElixirFactoryFile(blueprint) },
    ];
  }

  function buildRubyBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.rb`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.rb`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.rb`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.rb`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.rb`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildRubyEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildRubyRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildRubyCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildRubyInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildRubyFactoryFile(blueprint) },
    ];
  }

  function buildCBlueprintScaffoldFiles(projectRoot, blueprint) {
    const names = blueprint.names;
    const sourceRoot = path.join(projectRoot, blueprint.sourceRoot);
    const files = {
      entityFile: path.join(sourceRoot, 'domain', `${names.singularSnake}.h`),
      repositoryFile: path.join(sourceRoot, 'domain', `${names.singularSnake}_repository.h`),
      createUseCaseFile: path.join(sourceRoot, 'application', `create_${names.singularSnake}.c`),
      inMemoryRepositoryFile: path.join(sourceRoot, 'infrastructure', `in_memory_${names.singularSnake}_repository.c`),
      factoryFile: path.join(sourceRoot, 'main', `build_${names.singularSnake}_crud.c`),
    };

    return [
      { role: 'entidade de dominio', targetFile: files.entityFile, contents: buildCEntityFile(blueprint) },
      { role: 'porta de repositorio', targetFile: files.repositoryFile, contents: buildCRepositoryContractFile(blueprint) },
      { role: 'caso de uso de criacao', targetFile: files.createUseCaseFile, contents: buildCCreateUseCaseFile(blueprint) },
      { role: 'repositorio em memoria', targetFile: files.inMemoryRepositoryFile, contents: buildCInMemoryRepositoryFile(blueprint) },
      { role: 'fabrica de composicao', targetFile: files.factoryFile, contents: buildCFactoryFile(blueprint) },
    ];
  }

  function blueprintImportPath(fromFile, toFile) {
    const relative = path.relative(path.dirname(fromFile), toFile);
    return toImportPath(relative).replace(/\.(js|jsx|ts|tsx|mjs|cjs)$/i, '');
  }

  function loadActiveBlueprintContext(file) {
    const projectRoot = resolveProjectRoot(file);
    const contextDir = path.join(projectRoot, '.pingu-dev-agent', 'contexts');
    if (!pathExists(contextDir)) {
      return null;
    }

    const canonicalContextFile = path.join(contextDir, 'elixir-active.md');
    if (pathExists(canonicalContextFile)) {
      const parsedCanonical = parseBlueprintContextDocument(fs.readFileSync(canonicalContextFile, 'utf8'));
      if (parsedCanonical) {
        parsedCanonical.projectRoot = projectRoot;
        parsedCanonical.entry = canonicalContextFile;
        return parsedCanonical;
      }
    }

    const candidates = fs.readdirSync(contextDir)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => path.join(contextDir, entry))
      .filter((entry) => pathExists(entry))
      .map((entry) => ({
        entry,
        stats: fs.statSync(entry),
      }))
      .sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);

    for (const candidate of candidates) {
      const parsed = parseBlueprintContextDocument(fs.readFileSync(candidate.entry, 'utf8'));
      if (parsed) {
        parsed.projectRoot = projectRoot;
        return parsed;
      }
    }

    return null;
  }

  function parseBlueprintContextDocument(text) {
    const lines = String(text || '').split(/\r?\n/);
    if (String(lines[0] || '').trim() !== '<!-- pingu-dev-agent-context -->') {
      return null;
    }

    const metadata = {};
    for (const line of lines.slice(1)) {
      const trimmed = String(line || '').trim();
      if (!trimmed) {
        break;
      }
      const match = trimmed.match(/^([a-z_]+):\s*(.+)$/);
      if (!match) {
        continue;
      }
      metadata[match[1]] = match[2];
    }

    if (!metadata.blueprint_type) {
      return null;
    }

    return {
      architecture: metadata.architecture || '',
      body: lines.slice(Object.keys(metadata).length + 2).join('\n').trim(),
      blueprintType: metadata.blueprint_type,
      document: String(text || ''),
      entity: metadata.entity || '',
      language: metadata.language || '',
      slug: metadata.slug || '',
      summary: metadata.summary || '',
      sourceExt: metadata.source_ext || '.js',
      sourceRoot: metadata.source_root || 'src',
      names: crudEntityNames(metadata.entity || 'registro'),
    };
  }

  function generateBlueprintAwareSnippet(instruction, ext, sourceFile) {
    const blueprint = loadActiveBlueprintContext(sourceFile);
    if (!blueprint || blueprint.blueprintType !== 'bff_crud' || blueprint.architecture !== 'onion') {
      return '';
    }

    const scaffoldFiles = buildContextBlueprintScaffoldFiles(resolveProjectRoot(sourceFile), blueprint);
    const matchingFile = scaffoldFiles.find((scaffoldFile) => path.resolve(scaffoldFile.targetFile) === path.resolve(sourceFile));
    if (matchingFile) {
      return matchingFile.contents;
    }

    if (/\bcrud\b/i.test(instruction) && !new RegExp(`\\b${escapeRegExp(blueprint.entity)}\\b`, 'i').test(instruction)) {
      return generateCrudSnippet(`${instruction} ${blueprint.entity}`, ext);
    }

    return '';
  }

  function buildOnionEntityFile(blueprint) {
    const names = blueprint.names;
    const entityCamel = names.singularCamel;
    const entityPascal = names.singularPascal;
    return [
      jsDocBlock(
        `Normaliza os dados de ${names.singularSnake} para o contrato interno do dominio.`,
        [{ name: entityCamel, description: `Dados recebidos para ${names.singularSnake}.` }],
        `${entityPascal} normalizado para o restante da arquitetura.`,
      ),
      `export function normalize${entityPascal}(${entityCamel} = {}) {`,
      '  return {',
      `    id: ${entityCamel}.id ?? null,`,
      `    name: ${entityCamel}.name ?? '',`,
      `    email: ${entityCamel}.email ?? '',`,
      `    active: ${entityCamel}.active !== false,`,
      '  };',
      '}',
      '',
      jsDocBlock(
        `Aplica alteracoes de ${names.singularSnake} preservando o contrato do dominio.`,
        [
          { name: `current${entityPascal}`, description: `Estado atual de ${names.singularSnake}.` },
          { name: 'changes', description: `Alteracoes desejadas para ${names.singularSnake}.` },
        ],
        `${entityPascal} resultante apos a combinacao do estado atual com as alteracoes.`,
      ),
      `export function merge${entityPascal}Changes(current${entityPascal} = {}, changes = {}) {`,
      `  return normalize${entityPascal}({`,
      `    ...current${entityPascal},`,
      '    ...changes,',
      `    id: current${entityPascal}.id ?? changes.id ?? null,`,
      '  });',
      '}',
    ].join('\n');
  }

  function buildOnionRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const entityPascal = names.singularPascal;
    const repositoryMethods = [
      `list${names.pluralPascal}`,
      `get${entityPascal}ById`,
      `create${entityPascal}`,
      `update${entityPascal}`,
      `delete${entityPascal}`,
    ];
    return [
      'function assertRepositoryMethod(repository, methodName) {',
      '  if (!repository || typeof repository[methodName] !== "function") {',
      '    throw new Error(`Repositorio invalido: metodo ${methodName} nao encontrado`);',
      '  }',
      '  return repository;',
      '}',
      '',
      jsDocBlock(
        `Valida o contrato minimo do repositorio de ${names.singularSnake}.`,
        [{ name: `${names.singularCamel}Repository`, description: `Implementacao concreta do repositorio de ${names.singularSnake}.` }],
        `Repositorio validado para os casos de uso de ${names.pluralSnake}.`,
      ),
      `export function assert${entityPascal}Repository(${names.singularCamel}Repository) {`,
      `  ${JSON.stringify(repositoryMethods)}.forEach((methodName) => {`,
      `    assertRepositoryMethod(${names.singularCamel}Repository, methodName);`,
      '  });',
      `  return ${names.singularCamel}Repository;`,
      '}',
    ].join('\n');
  }

  function buildOnionListUseCaseFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.listUseCaseFile, files.repositoryFile);
    return [
      `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      '',
      jsDocBlock(
        `Constroi o caso de uso responsavel por listar ${names.pluralSnake}.`,
        [{ name: 'dependencies', description: `Dependencias necessarias para a listagem de ${names.pluralSnake}.` }],
        `Funcao que lista ${names.pluralSnake} a partir do repositorio injetado.`,
      ),
      'export function buildListUsers(dependencies) {'.replace('Users', names.pluralPascal),
      `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
      `  return async function list${names.pluralPascal}(filters = {}) {`,
      `    return ${names.singularCamel}Repository.list${names.pluralPascal}(filters);`,
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionGetUseCaseFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.getUseCaseFile, files.repositoryFile);
    return [
      `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      '',
      jsDocBlock(
        `Constroi o caso de uso responsavel por consultar ${names.singularSnake} por identificador.`,
        [{ name: 'dependencies', description: `Dependencias necessarias para buscar ${names.singularSnake}.` }],
        `Funcao que retorna ${names.singularSnake} ou null quando nao existir.`,
      ),
      `export function buildGet${names.singularPascal}ById(dependencies) {`,
      `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
      `  return async function get${names.singularPascal}ById(id) {`,
      `    return ${names.singularCamel}Repository.get${names.singularPascal}ById(id);`,
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionCreateUseCaseFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.createUseCaseFile, files.repositoryFile);
    const entityImport = blueprintImportPath(files.createUseCaseFile, files.entityFile);
    return [
      `import { normalize${names.singularPascal} } from ${JSON.stringify(entityImport)};`,
      `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      '',
      jsDocBlock(
        `Constroi o caso de uso responsavel por criar ${names.singularSnake}.`,
        [{ name: 'dependencies', description: `Dependencias necessarias para criar ${names.singularSnake}.` }],
        `Funcao que persiste ${names.singularSnake} validado no repositorio.`,
      ),
      `export function buildCreate${names.singularPascal}(dependencies) {`,
      `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
      `  return async function create${names.singularPascal}(payload) {`,
      `    const normalized${names.singularPascal} = normalize${names.singularPascal}(payload);`,
      `    return ${names.singularCamel}Repository.create${names.singularPascal}(normalized${names.singularPascal});`,
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionUpdateUseCaseFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.updateUseCaseFile, files.repositoryFile);
    const entityImport = blueprintImportPath(files.updateUseCaseFile, files.entityFile);
    return [
      `import { merge${names.singularPascal}Changes } from ${JSON.stringify(entityImport)};`,
      `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      '',
      jsDocBlock(
        `Constroi o caso de uso responsavel por atualizar ${names.singularSnake}.`,
        [{ name: 'dependencies', description: `Dependencias necessarias para atualizar ${names.singularSnake}.` }],
        `Funcao que busca o estado atual, aplica alteracoes e persiste o resultado.`,
      ),
      `export function buildUpdate${names.singularPascal}(dependencies) {`,
      `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
      `  return async function update${names.singularPascal}(id, changes) {`,
      `    const current${names.singularPascal} = await ${names.singularCamel}Repository.get${names.singularPascal}ById(id);`,
      `    if (!current${names.singularPascal}) {`,
      '      return null;',
      '    }',
      `    const merged${names.singularPascal} = merge${names.singularPascal}Changes(current${names.singularPascal}, changes);`,
      `    return ${names.singularCamel}Repository.update${names.singularPascal}(id, merged${names.singularPascal});`,
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionDeleteUseCaseFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.deleteUseCaseFile, files.repositoryFile);
    return [
      `import { assert${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      '',
      jsDocBlock(
        `Constroi o caso de uso responsavel por remover ${names.singularSnake}.`,
        [{ name: 'dependencies', description: `Dependencias necessarias para remover ${names.singularSnake}.` }],
        `Funcao que remove ${names.singularSnake} e retorna o registro excluido quando existir.`,
      ),
      `export function buildDelete${names.singularPascal}(dependencies) {`,
      `  const ${names.singularCamel}Repository = assert${names.singularPascal}Repository(dependencies.${names.singularCamel}Repository);`,
      `  return async function delete${names.singularPascal}(id) {`,
      `    return ${names.singularCamel}Repository.delete${names.singularPascal}(id);`,
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionInMemoryRepositoryFile(blueprint, files) {
    const names = blueprint.names;
    const entityImport = blueprintImportPath(files.inMemoryRepositoryFile, files.entityFile);
    return [
      `import { merge${names.singularPascal}Changes, normalize${names.singularPascal} } from ${JSON.stringify(entityImport)};`,
      '',
      `function clone${names.singularPascal}(${names.singularCamel}) {`,
      `  return normalize${names.singularPascal}(${names.singularCamel});`,
      '}',
      '',
      jsDocBlock(
        `Cria um repositorio em memoria para ${names.pluralSnake}, util para bootstrap e testes de fluxo.`,
        [{ name: 'seed', description: `Colecao inicial de ${names.pluralSnake}.` }],
        `Repositorio funcional com operacoes CRUD de ${names.singularSnake}.`,
      ),
      `export function buildInMemory${names.singularPascal}Repository(seed = []) {`,
      `  let state = seed.map((item) => normalize${names.singularPascal}(item));`,
      '',
      '  return {',
      `    async list${names.pluralPascal}() {`,
      `      return state.map((item) => clone${names.singularPascal}(item));`,
      '    },',
      `    async get${names.singularPascal}ById(id) {`,
      `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
      `      return current${names.singularPascal} ? clone${names.singularPascal}(current${names.singularPascal}) : null;`,
      '    },',
      `    async create${names.singularPascal}(payload) {`,
      `      const nextId = state.reduce((maxId, item) => Math.max(maxId, Number(item.id ?? 0)), 0) + 1;`,
      `      const created${names.singularPascal} = normalize${names.singularPascal}({ ...payload, id: nextId });`,
      `      state = [...state, created${names.singularPascal}];`,
      `      return clone${names.singularPascal}(created${names.singularPascal});`,
      '    },',
      `    async update${names.singularPascal}(id, payload) {`,
      `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
      `      if (!current${names.singularPascal}) {`,
      '        return null;',
      '      }',
      `      const updated${names.singularPascal} = merge${names.singularPascal}Changes(current${names.singularPascal}, payload);`,
      '      state = state.map((item) => (item.id === id ? updatedUser : item));'.replace('updatedUser', `updated${names.singularPascal}`),
      `      return clone${names.singularPascal}(updated${names.singularPascal});`,
      '    },',
      `    async delete${names.singularPascal}(id) {`,
      `      const current${names.singularPascal} = state.find((item) => item.id === id) || null;`,
      `      state = state.filter((item) => item.id !== id);`,
      `      return current${names.singularPascal} ? clone${names.singularPascal}(current${names.singularPascal}) : null;`,
      '    },',
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionControllerFile(blueprint, files) {
    const names = blueprint.names;
    const listImport = blueprintImportPath(files.controllerFile, files.listUseCaseFile);
    const getImport = blueprintImportPath(files.controllerFile, files.getUseCaseFile);
    const createImport = blueprintImportPath(files.controllerFile, files.createUseCaseFile);
    const updateImport = blueprintImportPath(files.controllerFile, files.updateUseCaseFile);
    const deleteImport = blueprintImportPath(files.controllerFile, files.deleteUseCaseFile);
    return [
      `import { buildCreate${names.singularPascal} } from ${JSON.stringify(createImport)};`,
      `import { buildDelete${names.singularPascal} } from ${JSON.stringify(deleteImport)};`,
      `import { buildGet${names.singularPascal}ById } from ${JSON.stringify(getImport)};`,
      `import { buildList${names.pluralPascal} } from ${JSON.stringify(listImport)};`,
      `import { buildUpdate${names.singularPascal} } from ${JSON.stringify(updateImport)};`,
      '',
      jsDocBlock(
        `Adapta os casos de uso de ${names.pluralSnake} para um contrato HTTP simples.`,
        [{ name: 'dependencies', description: `Dependencias compartilhadas entre os casos de uso de ${names.pluralSnake}.` }],
        `Controller funcional com handlers para ${names.pluralSnake}.`,
      ),
      `export function build${names.singularPascal}Controller(dependencies) {`,
      `  const list${names.pluralPascal} = buildList${names.pluralPascal}(dependencies);`,
      `  const get${names.singularPascal}ById = buildGet${names.singularPascal}ById(dependencies);`,
      `  const create${names.singularPascal} = buildCreate${names.singularPascal}(dependencies);`,
      `  const update${names.singularPascal} = buildUpdate${names.singularPascal}(dependencies);`,
      `  const delete${names.singularPascal} = buildDelete${names.singularPascal}(dependencies);`,
      '',
      '  return {',
      '    async list(request = {}) {',
      `      const ${names.pluralSnake} = await list${names.pluralPascal}(request.query ?? {});`,
      `      return { statusCode: 200, body: { ${names.pluralSnake} } };`,
      '    },',
      '    async getById(request = {}) {',
      `      const ${names.singularSnake} = await get${names.singularPascal}ById(request.params?.id);`,
      `      return ${names.singularSnake}`,
      `        ? { statusCode: 200, body: ${names.singularSnake} }`,
      "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
      '    },',
      '    async create(request = {}) {',
      `      const ${names.singularSnake} = await create${names.singularPascal}(request.body ?? {});`,
      `      return { statusCode: 201, body: ${names.singularSnake} };`,
      '    },',
      '    async update(request = {}) {',
      `      const ${names.singularSnake} = await update${names.singularPascal}(request.params?.id, request.body ?? {});`,
      `      return ${names.singularSnake}`,
      `        ? { statusCode: 200, body: ${names.singularSnake} }`,
      "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
      '    },',
      '    async remove(request = {}) {',
      `      const ${names.singularSnake} = await delete${names.singularPascal}(request.params?.id);`,
      `      return ${names.singularSnake}`,
      `        ? { statusCode: 200, body: ${names.singularSnake} }`,
      "        : { statusCode: 404, body: { message: 'registro nao encontrado' } };",
      '    },',
      '  };',
      '}',
    ].join('\n');
  }

  function buildOnionRoutesFile(blueprint, files) {
    const names = blueprint.names;
    const controllerImport = blueprintImportPath(files.routesFile, files.controllerFile);
    return [
      `import { build${names.singularPascal}Controller } from ${JSON.stringify(controllerImport)};`,
      '',
      jsDocBlock(
        `Cria a tabela de rotas HTTP para o CRUD de ${names.pluralSnake}.`,
        [{ name: 'dependencies', description: `Dependencias compartilhadas entre controller e casos de uso.` }],
        `Colecao de rotas HTTP pronta para adaptacao no servidor da aplicacao.`,
      ),
      `export function build${names.singularPascal}Routes(dependencies) {`,
      `  const ${names.singularCamel}Controller = build${names.singularPascal}Controller(dependencies);`,
      '  return [',
      `    { method: 'GET', path: '/${names.pluralSnake}', handler: ${names.singularCamel}Controller.list },`,
      `    { method: 'GET', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.getById },`,
      `    { method: 'POST', path: '/${names.pluralSnake}', handler: ${names.singularCamel}Controller.create },`,
      `    { method: 'PUT', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.update },`,
      `    { method: 'DELETE', path: '/${names.pluralSnake}/:id', handler: ${names.singularCamel}Controller.remove },`,
      '  ];',
      '}',
    ].join('\n');
  }

  function buildOnionFactoryFile(blueprint, files) {
    const names = blueprint.names;
    const repositoryImport = blueprintImportPath(files.factoryFile, files.inMemoryRepositoryFile);
    const routesImport = blueprintImportPath(files.factoryFile, files.routesFile);
    return [
      `import { buildInMemory${names.singularPascal}Repository } from ${JSON.stringify(repositoryImport)};`,
      `import { build${names.singularPascal}Routes } from ${JSON.stringify(routesImport)};`,
      '',
      jsDocBlock(
        `Compoe o BFF funcional de ${names.pluralSnake} usando Onion Architecture.`,
        [{ name: 'seed', description: `Colecao inicial opcional de ${names.pluralSnake}.` }],
        `Objeto de composicao com repositorio, dependencias e rotas de ${names.pluralSnake}.`,
      ),
      `export function build${names.singularPascal}CrudBff(seed = []) {`,
      `  const ${names.singularCamel}Repository = buildInMemory${names.singularPascal}Repository(seed);`,
      `  const dependencies = { ${names.singularCamel}Repository };`,
      `  const routes = build${names.singularPascal}Routes(dependencies);`,
      '  return {',
      `    ${names.singularCamel}Repository,`,
      '    dependencies,',
      '    routes,',
      '  };',
      '}',
    ].join('\n');
  }

  function pythonBlueprintModulePrefix(blueprint) {
    return toPosixPath(blueprint.sourceRoot)
      .split('/')
      .filter(Boolean)
      .map((segment) => sanitizeNaturalIdentifier(segment))
      .filter(Boolean)
      .join('.');
  }

  function goBlueprintImportPrefix(blueprint) {
    return ['your/module/path', toPosixPath(blueprint.sourceRoot)]
      .filter(Boolean)
      .join('/');
  }

  function elixirBlueprintNamespace(blueprint) {
    return `${blueprint.names.singularPascal}Crud`;
  }

  function rubyBlueprintNamespace(blueprint) {
    return `${blueprint.names.singularPascal}Crud`;
  }

  function cHeaderGuard(name) {
    return String(name || '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase();
  }

  function buildPythonEntityFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      'from dataclasses import dataclass, replace',
      '',
      `@dataclass(frozen=True)`,
      `class ${entityType}:`,
      '    id: str | None = None',
      '    name: str = ""',
      '    email: str = ""',
      '    active: bool = True',
      '',
      `def normalize_${names.singularSnake}(payload: dict | None = None) -> ${entityType}:`,
      '    source = payload or {}',
      `    return ${entityType}(`,
      '        id=source.get("id"),',
      '        name=source.get("name", ""),',
      '        email=source.get("email", ""),',
      '        active=source.get("active", True),',
      '    )',
      '',
      `def merge_${names.singularSnake}_changes(current_${names.singularSnake}: ${entityType}, changes: dict | None = None) -> ${entityType}:`,
      '    change_set = changes or {}',
      '    return replace(',
      `        current_${names.singularSnake},`,
      `        id=current_${names.singularSnake}.id if current_${names.singularSnake}.id is not None else change_set.get("id"),`,
      `        name=change_set.get("name", current_${names.singularSnake}.name),`,
      `        email=change_set.get("email", current_${names.singularSnake}.email),`,
      `        active=change_set.get("active", current_${names.singularSnake}.active),`,
      '    )',
    ].join('\n');
  }

  function buildPythonRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const prefix = pythonBlueprintModulePrefix(blueprint);
    const entityType = names.singularPascal;
    return [
      'from typing import Protocol',
      '',
      `from ${prefix}.domain.${names.singularSnake} import ${entityType}`,
      '',
      `class ${entityType}Repository(Protocol):`,
      `    def list_${names.pluralSnake}(self, filters: dict | None = None) -> list[${entityType}]: ...`,
      '',
      `    def get_${names.singularSnake}_by_id(self, entity_id: str) -> ${entityType} | None: ...`,
      '',
      `    def create_${names.singularSnake}(self, entity: ${entityType}) -> ${entityType}: ...`,
      '',
      `    def update_${names.singularSnake}(self, entity_id: str, changes: dict | None = None) -> ${entityType} | None: ...`,
      '',
      `    def delete_${names.singularSnake}(self, entity_id: str) -> ${entityType} | None: ...`,
    ].join('\n');
  }

  function buildPythonCreateUseCaseFile(blueprint) {
    const names = blueprint.names;
    const prefix = pythonBlueprintModulePrefix(blueprint);
    const entityType = names.singularPascal;
    return [
      `from ${prefix}.domain.${names.singularSnake} import ${entityType}, normalize_${names.singularSnake}`,
      `from ${prefix}.domain.${names.singularSnake}_repository import ${entityType}Repository`,
      '',
      `def build_create_${names.singularSnake}(${names.singularSnake}_repository: ${entityType}Repository):`,
      `    def create_${names.singularSnake}(payload: dict | None = None) -> ${entityType}:`,
      `        normalized_${names.singularSnake} = normalize_${names.singularSnake}(payload)`,
      `        return ${names.singularSnake}_repository.create_${names.singularSnake}(normalized_${names.singularSnake})`,
      '',
      `    return create_${names.singularSnake}`,
    ].join('\n');
  }

  function buildPythonInMemoryRepositoryFile(blueprint) {
    const names = blueprint.names;
    const prefix = pythonBlueprintModulePrefix(blueprint);
    const entityType = names.singularPascal;
    return [
      `from ${prefix}.domain.${names.singularSnake} import ${entityType}, merge_${names.singularSnake}_changes, normalize_${names.singularSnake}`,
      '',
      `class InMemory${entityType}Repository:`,
      '    def __init__(self, seed: list[dict] | None = None):',
      `        self._state = [normalize_${names.singularSnake}(item) for item in (seed or [])]`,
      '',
      `    def list_${names.pluralSnake}(self, _filters: dict | None = None) -> list[${entityType}]:`,
      '        return list(self._state)',
      '',
      `    def get_${names.singularSnake}_by_id(self, entity_id: str) -> ${entityType} | None:`,
      `        return next((item for item in self._state if item.id == entity_id), None)`,
      '',
      `    def create_${names.singularSnake}(self, entity: ${entityType}) -> ${entityType}:`,
      '        self._state.append(entity)',
      '        return entity',
      '',
      `    def update_${names.singularSnake}(self, entity_id: str, changes: dict | None = None) -> ${entityType} | None:`,
      `        current_${names.singularSnake} = self.get_${names.singularSnake}_by_id(entity_id)`,
      `        if current_${names.singularSnake} is None:`,
      '            return None',
      `        updated_${names.singularSnake} = merge_${names.singularSnake}_changes(current_${names.singularSnake}, changes)`,
      '        self._state = [',
      `            updated_${names.singularSnake} if item.id == entity_id else item`,
      '            for item in self._state',
      '        ]',
      `        return updated_${names.singularSnake}`,
      '',
      `    def delete_${names.singularSnake}(self, entity_id: str) -> ${entityType} | None:`,
      `        current_${names.singularSnake} = self.get_${names.singularSnake}_by_id(entity_id)`,
      `        if current_${names.singularSnake} is None:`,
      '            return None',
      '        self._state = [item for item in self._state if item.id != entity_id]',
      `        return current_${names.singularSnake}`,
    ].join('\n');
  }

  function buildPythonFactoryFile(blueprint) {
    const names = blueprint.names;
    const prefix = pythonBlueprintModulePrefix(blueprint);
    const entityType = names.singularPascal;
    return [
      `from ${prefix}.application.create_${names.singularSnake} import build_create_${names.singularSnake}`,
      `from ${prefix}.infrastructure.in_memory_${names.singularSnake}_repository import InMemory${entityType}Repository`,
      '',
      `def build_${names.singularSnake}_crud(seed: list[dict] | None = None) -> dict:`,
      `    ${names.singularSnake}_repository = InMemory${entityType}Repository(seed or [])`,
      `    create_${names.singularSnake} = build_create_${names.singularSnake}(${names.singularSnake}_repository)`,
      '    return {',
      `        "${names.singularSnake}_repository": ${names.singularSnake}_repository,`,
      `        "create_${names.singularSnake}": create_${names.singularSnake},`,
      '    }',
    ].join('\n');
  }

  function buildGoEntityFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      'package domain',
      '',
      `type ${entityType} struct {`,
      '  ID string',
      '  Name string',
      '  Email string',
      '  Active bool',
      '}',
      '',
      `func Normalize${entityType}(input map[string]any) ${entityType} {`,
      `  normalized := ${entityType}{Active: true}`,
      '  if rawID, ok := input["id"].(string); ok {',
      '    normalized.ID = rawID',
      '  }',
      '  if rawName, ok := input["name"].(string); ok {',
      '    normalized.Name = rawName',
      '  }',
      '  if rawEmail, ok := input["email"].(string); ok {',
      '    normalized.Email = rawEmail',
      '  }',
      '  if rawActive, ok := input["active"].(bool); ok {',
      '    normalized.Active = rawActive',
      '  }',
      '  return normalized',
      '}',
    ].join('\n');
  }

  function buildGoRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      'package domain',
      '',
      `type ${entityType}Repository interface {`,
      `  List${names.pluralPascal}(filters map[string]any) []${entityType}`,
      `  Get${entityType}ByID(id string) (${entityType}, bool)`,
      `  Create${entityType}(entity ${entityType}) ${entityType}`,
      `  Update${entityType}(id string, changes map[string]any) (${entityType}, bool)`,
      `  Delete${entityType}(id string) (${entityType}, bool)`,
      '}',
    ].join('\n');
  }

  function buildGoCreateUseCaseFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    const importPrefix = goBlueprintImportPrefix(blueprint);
    return [
      'package application',
      '',
      'import (',
      `  domain "${importPrefix}/domain"`,
      ')',
      '',
      `func BuildCreate${entityType}(repository domain.${entityType}Repository) func(map[string]any) domain.${entityType} {`,
      `  return func(payload map[string]any) domain.${entityType} {`,
      `    normalized${entityType} := domain.Normalize${entityType}(payload)`,
      `    return repository.Create${entityType}(normalized${entityType})`,
      '  }',
      '}',
    ].join('\n');
  }

  function buildGoInMemoryRepositoryFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    const importPrefix = goBlueprintImportPrefix(blueprint);
    return [
      'package infrastructure',
      '',
      'import (',
      `  domain "${importPrefix}/domain"`,
      ')',
      '',
      `type InMemory${entityType}Repository struct {`,
      `  state []domain.${entityType}`,
      '}',
      '',
      `func BuildInMemory${entityType}Repository(seed []map[string]any) *InMemory${entityType}Repository {`,
      `  repository := &InMemory${entityType}Repository{state: make([]domain.${entityType}, 0, len(seed))}`,
      '  for _, item := range seed {',
      `    repository.state = append(repository.state, domain.Normalize${entityType}(item))`,
      '  }',
      '  return repository',
      '}',
      '',
      `func (repository *InMemory${entityType}Repository) List${names.pluralPascal}(_ map[string]any) []domain.${entityType} {`,
      '  return append([]domain.' + entityType + '(nil), repository.state...)',
      '}',
      '',
      `func (repository *InMemory${entityType}Repository) Get${entityType}ByID(id string) (domain.${entityType}, bool) {`,
      '  for _, item := range repository.state {',
      '    if item.ID == id {',
      '      return item, true',
      '    }',
      '  }',
      `  return domain.${entityType}{}, false`,
      '}',
      '',
      `func (repository *InMemory${entityType}Repository) Create${entityType}(entity domain.${entityType}) domain.${entityType} {`,
      '  repository.state = append(repository.state, entity)',
      '  return entity',
      '}',
    ].join('\n');
  }

  function buildGoFactoryFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    const importPrefix = goBlueprintImportPrefix(blueprint);
    return [
      'package main',
      '',
      'import (',
      `  application "${importPrefix}/application"`,
      `  infrastructure "${importPrefix}/infrastructure"`,
      ')',
      '',
      `type ${entityType}Crud struct {`,
      `  Repository *infrastructure.InMemory${entityType}Repository`,
      `  Create${entityType} func(map[string]any) any`,
      '}',
      '',
      `func Build${entityType}Crud(seed []map[string]any) ${entityType}Crud {`,
      `  ${names.singularSnake}Repository := infrastructure.BuildInMemory${entityType}Repository(seed)`,
      `  create${entityType} := application.BuildCreate${entityType}(${names.singularSnake}Repository)`,
      `  return ${entityType}Crud{`,
      `    Repository: ${names.singularSnake}Repository,`,
      `    Create${entityType}: func(payload map[string]any) any {`,
      `      return create${entityType}(payload)`,
      '    },',
      '  }',
      '}',
    ].join('\n');
  }

  function buildRustEntityFile(blueprint) {
    const entityType = blueprint.names.singularPascal;
    const names = blueprint.names;
    return [
      'use std::collections::HashMap;',
      '',
      '#[derive(Debug, Clone, PartialEq, Eq)]',
      `pub struct ${entityType} {`,
      '    pub id: Option<String>,',
      '    pub name: String,',
      '    pub email: String,',
      '    pub active: bool,',
      '}',
      '',
      `pub fn normalize_${names.singularSnake}(payload: &HashMap<String, String>) -> ${entityType} {`,
      `    ${entityType} {`,
      '        id: payload.get("id").cloned(),',
      '        name: payload.get("name").cloned().unwrap_or_default(),',
      '        email: payload.get("email").cloned().unwrap_or_default(),',
      '        active: payload.get("active").map(|value| value == "true").unwrap_or(true),',
      '    }',
      '}',
    ].join('\n');
  }

  function buildRustRepositoryContractFile(blueprint) {
    const entityType = blueprint.names.singularPascal;
    const names = blueprint.names;
    return [
      `use crate::domain::${names.singularSnake}::${entityType};`,
      '',
      `pub trait ${entityType}Repository {`,
      `    fn list_${names.pluralSnake}(&self) -> Vec<${entityType}>;`,
      `    fn get_${names.singularSnake}_by_id(&self, entity_id: &str) -> Option<${entityType}>;`,
      `    fn create_${names.singularSnake}(&mut self, entity: ${entityType}) -> ${entityType};`,
      '}',
    ].join('\n');
  }

  function buildRustCreateUseCaseFile(blueprint) {
    const entityType = blueprint.names.singularPascal;
    const names = blueprint.names;
    return [
      'use std::collections::HashMap;',
      '',
      `use crate::domain::${names.singularSnake}::{normalize_${names.singularSnake}, ${entityType}};`,
      `use crate::domain::${names.singularSnake}_repository::${entityType}Repository;`,
      '',
      `pub fn build_create_${names.singularSnake}<'a, Repository>(`,
      "    repository: &'a mut Repository,",
      `) -> impl FnMut(HashMap<String, String>) -> ${entityType} + 'a`,
      'where',
      `    Repository: ${entityType}Repository,`,
      '{',
      '    move |payload| {',
      `        let normalized_${names.singularSnake} = normalize_${names.singularSnake}(&payload);`,
      `        repository.create_${names.singularSnake}(normalized_${names.singularSnake})`,
      '    }',
      '}',
    ].join('\n');
  }

  function buildRustInMemoryRepositoryFile(blueprint) {
    const entityType = blueprint.names.singularPascal;
    const names = blueprint.names;
    return [
      `use crate::domain::${names.singularSnake}::${entityType};`,
      `use crate::domain::${names.singularSnake}_repository::${entityType}Repository;`,
      '',
      `pub struct InMemory${entityType}Repository {`,
      `    state: Vec<${entityType}>,`,
      '}',
      '',
      `impl InMemory${entityType}Repository {`,
      `    pub fn new(seed: Vec<${entityType}>) -> Self {`,
      '        Self { state: seed }',
      '    }',
      '}',
      '',
      `impl ${entityType}Repository for InMemory${entityType}Repository {`,
      `    fn list_${names.pluralSnake}(&self) -> Vec<${entityType}> {`,
      '        self.state.clone()',
      '    }',
      '',
      `    fn get_${names.singularSnake}_by_id(&self, entity_id: &str) -> Option<${entityType}> {`,
      '        self.state.iter().find(|item| item.id.as_deref() == Some(entity_id)).cloned()',
      '    }',
      '',
      `    fn create_${names.singularSnake}(&mut self, entity: ${entityType}) -> ${entityType} {`,
      '        self.state.push(entity.clone());',
      '        entity',
      '    }',
      '}',
    ].join('\n');
  }

  function buildRustFactoryFile(blueprint) {
    const entityType = blueprint.names.singularPascal;
    const names = blueprint.names;
    return [
      `use crate::application::create_${names.singularSnake}::build_create_${names.singularSnake};`,
      `use crate::domain::${names.singularSnake}::${entityType};`,
      `use crate::infrastructure::in_memory_${names.singularSnake}_repository::InMemory${entityType}Repository;`,
      '',
      `pub fn build_${names.singularSnake}_crud(seed: Vec<${entityType}>) -> InMemory${entityType}Repository {`,
      `    let mut ${names.singularSnake}_repository = InMemory${entityType}Repository::new(seed);`,
      `    let _create_${names.singularSnake} = build_create_${names.singularSnake}(&mut ${names.singularSnake}_repository);`,
      `    ${names.singularSnake}_repository`,
      '}',
    ].join('\n');
  }

  function buildElixirEntityFile(blueprint) {
    const names = blueprint.names;
    const root = elixirBlueprintNamespace(blueprint);
    const entityModule = `${root}.Domain.${names.singularPascal}`;
    const typeName = names.singularSnake;
    return [
      `defmodule ${entityModule} do`,
      `  @type ${typeName} :: %__MODULE__{`,
      '          id: String.t() | nil,',
      '          name: String.t(),',
      '          email: String.t(),',
      '          active: boolean()',
      '        }',
      '',
      '  defstruct id: nil, name: "", email: "", active: true',
      '',
      `  def normalize_${names.singularSnake}(attrs \\\\ %{}) do`,
      '    %__MODULE__{',
      '      id: Map.get(attrs, :id) || Map.get(attrs, "id"),',
      '      name: Map.get(attrs, :name) || Map.get(attrs, "name") || "",',
      '      email: Map.get(attrs, :email) || Map.get(attrs, "email") || "",',
      '      active: Map.get(attrs, :active) || Map.get(attrs, "active") || true',
      '    }',
      '  end',
      'end',
    ].join('\n');
  }

  function buildElixirRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const root = elixirBlueprintNamespace(blueprint);
    const entityModule = `${root}.Domain.${names.singularPascal}`;
    const repositoryModule = `${root}.Domain.${names.singularPascal}Repository`;
    return [
      `defmodule ${repositoryModule} do`,
      `  alias ${entityModule}`,
      '',
      `  @callback list_${names.pluralSnake}(map()) :: [${entityModule}.t()]`,
      `  @callback get_${names.singularSnake}_by_id(String.t()) :: ${entityModule}.t() | nil`,
      `  @callback create_${names.singularSnake}(${entityModule}.t()) :: ${entityModule}.t()`,
      'end',
    ].join('\n');
  }

  function buildElixirCreateUseCaseFile(blueprint) {
    const names = blueprint.names;
    const root = elixirBlueprintNamespace(blueprint);
    const entityModule = `${root}.Domain.${names.singularPascal}`;
    const repositoryModule = `${root}.Domain.${names.singularPascal}Repository`;
    const useCaseModule = `${root}.Application.Create${names.singularPascal}`;
    return [
      `defmodule ${useCaseModule} do`,
      `  alias ${entityModule}`,
      '',
      `  @spec build(module()) :: (map() -> ${entityModule}.t())`,
      '  def build(repository_module) do',
      `    fn payload ->`,
      `      normalized_${names.singularSnake} = ${entityModule}.normalize_${names.singularSnake}(payload)`,
      `      repository_module.create_${names.singularSnake}(normalized_${names.singularSnake})`,
      '    end',
      '  end',
      'end',
      '',
      `@behaviour ${repositoryModule}`,
    ].join('\n');
  }

  function buildElixirInMemoryRepositoryFile(blueprint) {
    const names = blueprint.names;
    const root = elixirBlueprintNamespace(blueprint);
    const entityModule = `${root}.Domain.${names.singularPascal}`;
    const repositoryModule = `${root}.Domain.${names.singularPascal}Repository`;
    const implementationModule = `${root}.Infrastructure.InMemory${names.singularPascal}Repository`;
    return [
      `defmodule ${implementationModule} do`,
      `  @behaviour ${repositoryModule}`,
      `  alias ${entityModule}`,
      '',
      `  def list_${names.pluralSnake}(_filters), do: []`,
      '',
      `  def get_${names.singularSnake}_by_id(_entity_id), do: nil`,
      '',
      `  def create_${names.singularSnake}(%${entityModule}{} = entity), do: entity`,
      'end',
    ].join('\n');
  }

  function buildElixirFactoryFile(blueprint) {
    const names = blueprint.names;
    const root = elixirBlueprintNamespace(blueprint);
    const createModule = `${root}.Application.Create${names.singularPascal}`;
    const repositoryModule = `${root}.Infrastructure.InMemory${names.singularPascal}Repository`;
    return [
      `defmodule ${root}.Main.Build${names.singularPascal}Crud do`,
      `  alias ${createModule}`,
      `  alias ${repositoryModule}`,
      '',
      '  def build do',
      '    %{' ,
      `      ${names.singularSnake}_repository: ${repositoryModule},`,
      `      create_${names.singularSnake}: ${createModule}.build(${repositoryModule})`,
      '    }',
      '  end',
      'end',
    ].join('\n');
  }

  function buildRubyEntityFile(blueprint) {
    const names = blueprint.names;
    const namespace = rubyBlueprintNamespace(blueprint);
    const entityType = names.singularPascal;
    return [
      `module ${namespace}`,
      '  module Domain',
      `    ${entityType} = Struct.new(:id, :name, :email, :active, keyword_init: true)`,
      '',
      `    def self.normalize_${names.singularSnake}(payload = {})`,
      `      ${entityType}.new(`,
      '        id: payload.fetch(:id, nil),',
      '        name: payload.fetch(:name, ""),',
      '        email: payload.fetch(:email, ""),',
      '        active: payload.fetch(:active, true)',
      '      )',
      '    end',
      '  end',
      'end',
    ].join('\n');
  }

  function buildRubyRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const namespace = rubyBlueprintNamespace(blueprint);
    return [
      `module ${namespace}`,
      '  module Domain',
      `    module ${names.singularPascal}Repository`,
      `      def list_${names.pluralSnake}(_filters = {})`,
      "        raise NotImplementedError, 'implemente listagem no repositorio concreto'",
      '      end',
      '',
      `      def create_${names.singularSnake}(_entity)`,
      "        raise NotImplementedError, 'implemente criacao no repositorio concreto'",
      '      end',
      '    end',
      '  end',
      'end',
    ].join('\n');
  }

  function buildRubyCreateUseCaseFile(blueprint) {
    const names = blueprint.names;
    const namespace = rubyBlueprintNamespace(blueprint);
    return [
      `require_relative '../domain/${names.singularSnake}'`,
      `require_relative '../domain/${names.singularSnake}_repository'`,
      '',
      `module ${namespace}`,
      '  module Application',
      `    def self.build_create_${names.singularSnake}(${names.singularSnake}_repository)`,
      `      lambda do |payload = {}|`,
      `        normalized_${names.singularSnake} = Domain.normalize_${names.singularSnake}(payload)`,
      `        ${names.singularSnake}_repository.create_${names.singularSnake}(normalized_${names.singularSnake})`,
      '      end',
      '    end',
      '  end',
      'end',
    ].join('\n');
  }

  function buildRubyInMemoryRepositoryFile(blueprint) {
    const names = blueprint.names;
    const namespace = rubyBlueprintNamespace(blueprint);
    return [
      `require_relative '../domain/${names.singularSnake}'`,
      `require_relative '../domain/${names.singularSnake}_repository'`,
      '',
      `module ${namespace}`,
      '  module Infrastructure',
      `    class InMemory${names.singularPascal}Repository`,
      `      include Domain::${names.singularPascal}Repository`,
      '',
      '      def initialize(seed = [])',
      '        @state = seed.map { |item| Domain.normalize_' + names.singularSnake + '(item) }',
      '      end',
      '',
      `      def list_${names.pluralSnake}(_filters = {})`,
      '        @state.dup',
      '      end',
      '',
      `      def create_${names.singularSnake}(entity)`,
      '        @state << entity',
      '        entity',
      '      end',
      '    end',
      '  end',
      'end',
    ].join('\n');
  }

  function buildRubyFactoryFile(blueprint) {
    const names = blueprint.names;
    const namespace = rubyBlueprintNamespace(blueprint);
    return [
      `require_relative '../application/create_${names.singularSnake}'`,
      `require_relative '../infrastructure/in_memory_${names.singularSnake}_repository'`,
      '',
      `module ${namespace}`,
      '  module Main',
      `    def self.build_${names.singularSnake}_crud(seed = [])`,
      `      ${names.singularSnake}_repository = Infrastructure::InMemory${names.singularPascal}Repository.new(seed)`,
      '      {',
      `        ${names.singularSnake}_repository: ${names.singularSnake}_repository,`,
      `        create_${names.singularSnake}: Application.build_create_${names.singularSnake}(${names.singularSnake}_repository)`,
      '      }',
      '    end',
      '  end',
      'end',
    ].join('\n');
  }

  function buildCEntityFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    const guard = cHeaderGuard(`${names.singularSnake}.h`);
    return [
      `#ifndef ${guard}`,
      `#define ${guard}`,
      '',
      `typedef struct ${entityType} {`,
      '  const char *id;',
      '  const char *name;',
      '  const char *email;',
      '  int active;',
      `} ${entityType};`,
      '',
      `static inline ${entityType} normalize_${names.singularSnake}(${entityType} input) {`,
      `  ${entityType} normalized = input;`,
      '  if (!normalized.name) normalized.name = "";',
      '  if (!normalized.email) normalized.email = "";',
      '  if (normalized.active != 0) normalized.active = 1;',
      '  return normalized;',
      '}',
      '',
      `static inline ${entityType} merge_${names.singularSnake}_changes(${entityType} current_${names.singularSnake}, ${entityType} changes) {`,
      '  if (changes.id) current_' + names.singularSnake + '.id = changes.id;',
      '  if (changes.name) current_' + names.singularSnake + '.name = changes.name;',
      '  if (changes.email) current_' + names.singularSnake + '.email = changes.email;',
      '  if (changes.active != 0) current_' + names.singularSnake + '.active = changes.active;',
      '  return current_' + names.singularSnake + ';',
      '}',
      '',
      `#endif /* ${guard} */`,
    ].join('\n');
  }

  function buildCRepositoryContractFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    const guard = cHeaderGuard(`${names.singularSnake}_repository.h`);
    return [
      `#ifndef ${guard}`,
      `#define ${guard}`,
      '',
      `#include "${names.singularSnake}.h"`,
      '',
      `typedef struct ${entityType}Repository ${entityType}Repository;`,
      '',
      `struct ${entityType}Repository {`,
      `  ${entityType} *state;`,
      '  int count;',
      `  ${entityType} (*create_${names.singularSnake})(${entityType}Repository *repository, ${entityType} entity);`,
      `  int (*list_${names.pluralSnake})(${entityType}Repository *repository, ${entityType} *output, int limit);`,
      '};',
      '',
      `#endif /* ${guard} */`,
    ].join('\n');
  }

  function buildCCreateUseCaseFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      `#include "../domain/${names.singularSnake}.h"`,
      `#include "../domain/${names.singularSnake}_repository.h"`,
      '',
      `${entityType} create_${names.singularSnake}(${entityType}Repository *repository, ${entityType} payload) {`,
      `  ${entityType} normalized_${names.singularSnake} = normalize_${names.singularSnake}(payload);`,
      `  return repository->create_${names.singularSnake}(repository, normalized_${names.singularSnake});`,
      '}',
    ].join('\n');
  }

  function buildCInMemoryRepositoryFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      `#include "../domain/${names.singularSnake}.h"`,
      `#include "../domain/${names.singularSnake}_repository.h"`,
      '',
      `static ${entityType} in_memory_create_${names.singularSnake}(${entityType}Repository *repository, ${entityType} entity) {`,
      '  repository->state[repository->count] = entity;',
      '  repository->count += 1;',
      '  return entity;',
      '}',
      '',
      `static int in_memory_list_${names.pluralSnake}(${entityType}Repository *repository, ${entityType} *output, int limit) {`,
      '  int copied = repository->count < limit ? repository->count : limit;',
      '  for (int index = 0; index < copied; index += 1) {',
      '    output[index] = repository->state[index];',
      '  }',
      '  return copied;',
      '}',
      '',
      `${entityType}Repository build_in_memory_${names.singularSnake}_repository(${entityType} *seed, int count) {`,
      `  ${entityType}Repository repository;`,
      '  repository.state = seed;',
      '  repository.count = count;',
      `  repository.create_${names.singularSnake} = in_memory_create_${names.singularSnake};`,
      `  repository.list_${names.pluralSnake} = in_memory_list_${names.pluralSnake};`,
      '  return repository;',
      '}',
    ].join('\n');
  }

  function buildCFactoryFile(blueprint) {
    const names = blueprint.names;
    const entityType = names.singularPascal;
    return [
      `#include "../domain/${names.singularSnake}.h"`,
      `#include "../domain/${names.singularSnake}_repository.h"`,
      `#include "../infrastructure/in_memory_${names.singularSnake}_repository.c"`,
      '',
      `typedef struct ${entityType}Crud {`,
      `  ${entityType}Repository ${names.singularSnake}_repository;`,
      `} ${entityType}Crud;`,
      '',
      `${entityType}Crud build_${names.singularSnake}_crud(${entityType} *seed, int count) {`,
      `  ${entityType}Crud crud;`,
      `  crud.${names.singularSnake}_repository = build_in_memory_${names.singularSnake}_repository(seed, count);`,
      '  return crud;',
      '}',
    ].join('\n');
  }

  return {
    buildContextBlueprintTasks,
    generateBlueprintAwareSnippet,
    loadActiveBlueprintContext,
    resolveActiveContextTargetFile,
  };
}

module.exports = {
  createBlueprintTools,
};
