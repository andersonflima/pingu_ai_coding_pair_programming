'use strict';

const path = require('path');

const LANGUAGE_CAPABILITY_REGISTRY = Object.freeze([
  {
    id: 'javascript',
    extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'ui', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira funções pequenas, puras e previsíveis com contratos explícitos de entrada e saída.',
      'Mantenha efeitos colaterais encapsulados nos limites da arquitetura (IO, rede, estado global).',
      'Evite mutação compartilhada; prefira transformação imutável com cópia controlada.',
      'Valide invariantes no nível do domínio antes de integrar com frameworks.',
      'No React, priorize componentes orientados por propriedades, composição e responsabilidades reduzidas.',
      'Use tipos e nomes de função que expressem intenção clara, sem abstrações genéricas.',
    ],
  },
  {
    id: 'python',
    extensions: ['.py'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira funções pequenas, com entradas e saídas explícitas e sem dependências implícitas.',
      'Isole I/O, tempo e aleatoriedade para manter lógica determinística.',
      'Mantenha contratos de domínio em funções coesas com nomes que descrevam intenção.',
      'Evite estado global; prefira parâmetros explícitos e composição de chamadas.',
      'Valide entradas e falhas esperadas na borda para reduzir comportamento indefinido.',
      'Escreva testes de sucesso, falha e borda para funções críticas.',
    ],
  },
  {
    id: 'elixir',
    extensions: ['.ex', '.exs'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task', 'module_wrap'],
    bestPractices: [
      'Prefira pattern matching e pipelines curtas para reduzir ramificações não necessárias.',
      'Mantenha dados imutáveis e efeitos sob controle de fronteira.',
      'Modele invariantes e regras em funções puras, deixando efeitos para wrappers explícitos.',
      'Use módulos pequenos e contratos claros de responsabilidade por contexto.',
      'Padronize nomes de funções e resultados para reduzir ruído semântico.',
      'Quando necessário, exponha contratos com `@spec` e tipos de retorno explícitos.',
    ],
  },
  {
    id: 'go',
    extensions: ['.go'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Mantenha pacotes pequenos com interfaces simples no consumidor.',
      'Trate erros de forma explícita; evite mascarar falhas de negócio.',
      'Prefira composição e injeção de dependência por parâmetros em vez de estado global.',
      'Evite otimizações prematuras; prefira legibilidade e previsibilidade.',
      'Padronize nomes e ordem de argumentos para reduzir ambiguidade em APIs internas.',
      'Escreva contratos de função com propósito e validação clara de precondições.',
    ],
  },
  {
    id: 'rust',
    extensions: ['.rs'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Modele ownership e lifetimes com clareza antes de micro-otimizar.',
      'Prefira tipos expressivos e retornos de erro explícitos (`Result`, `Option`).',
      'Separe pure functions de operações de IO e estado.',
      'Evite clones desnecessários quando referência/emprestimo for suficiente.',
      'Mantenha módulos pequenos, com fronteiras de erro consistentes.',
      'Teste falhas e panics esperados para evitar regressão em caminhos excepcionais.',
    ],
  },
  {
    id: 'ruby',
    extensions: ['.rb'],
    commentPrefix: '#',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira classes e funções curtas com responsabilidades isoladas.',
      'Mantenha regras de negócio separadas de detalhes de framework.',
      'Prefira composição e duck typing para reduzir acoplamento.',
      'Teste comportamento público, incluindo cenários de exceção e contratos de retorno.',
      'Evite estado global e efeitos silenciosos em código compartilhado.',
      'Padronize nomenclatura de métodos para facilitar manutenção em equipe.',
    ],
  },
  {
    id: 'lua',
    extensions: ['.lua'],
    commentPrefix: '--',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'crud', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'dice_roll', 'crud_scaffold', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira funções locais e evite poluir o escopo global.',
      'Mantenha tabelas pequenas e contratos de retorno estáveis.',
      'Separe montagem de dados de chamadas com efeitos colaterais.',
      'Evite metaprogramação excessiva em rotinas de manutenção.',
      'Valide tipos e nulidade antes de transformar dados recebidos.',
      'Use nomes de função que expressem transformação de domínio, não estrutura interna.',
    ],
  },
  {
    id: 'vim',
    extensions: ['.vim'],
    commentPrefix: '"',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira funções pequenas e script-local para lidar com estado de edição.',
      'Isole side effects de buffer, janela e editor em pontos explícitos.',
      'Mantenha transformações de dados independentes de APIs de runtime.',
      'Evite variáveis globais mutáveis; prefira closures de escopo curto.',
      'Valide mapeamentos de evento antes de executar comandos no editor.',
      'Mantenha handlers previsíveis para reduzir risco de regressão em runtime persistente.',
    ],
  },
  {
    id: 'c',
    extensions: ['.c', '.h', '.cpp', '.hpp'],
    commentPrefix: '//',
    unitTestStyle: 'native',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'interface', 'struct', 'object', 'collection', 'variable'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'unit_test_generation', 'terminal_task'],
    bestPractices: [
      'Modele propriedade e tempo de vida de dados com clareza em headers e structs.',
      'Prefira funções pequenas com contratos explícitos e nomes sem ambiguidade.',
      'Evite estado global e efeitos implícitos; explicite contexto de inicialização.',
      'Mantenha inicializações e liberações simétricas para reduzir leaks.',
      'Valide erros esperados com códigos claros e caminhos de retorno previsíveis.',
      'Aplique tratamento de erro próximo às camadas de abstração, com logs objetivos.',
    ],
  },
  {
    id: 'terraform',
    extensions: ['.tf'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'required_version', 'context_blueprint'],
    offlineCapabilities: ['required_version_fix', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
    bestPractices: [
      'Declare versões e providers explicitamente para reduzir drift operacional.',
      'Separe módulos por responsabilidade de infraestrutura e domínio.',
      'Evite configurações implícitas que escondem risco de drift.',
      'Use nomes de recursos consistentes com o contrato de arquitetura.',
      'Versione estado e política de backend antes de alterações de produção.',
      'Valide plano com checkpoints de segurança para mudanças destrutivas.',
    ],
  },
  {
    id: 'yaml',
    extensions: ['.yaml', '.yml'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'collection', 'context_blueprint'],
    offlineCapabilities: ['comment_task', 'contract_test_generation', 'context_blueprint', 'terminal_task'],
    bestPractices: [
      'Mantenha estrutura pequena e consistente por responsabilidade funcional.',
      'Evite valores ambíguos; prefira chaves explícitas e tipagem de contrato.',
      'Em compose, modele serviços com contratos de operação e limites claros.',
      'Padronize formatação para reduzir diffs ruidosos em revisão.',
      'Documente dependências e suposições de ambiente no próprio arquivo.',
      'Valide chaves obrigatórias antes de merges para evitar runtime ambíguo.',
    ],
  },
  {
    id: 'markdown',
    extensions: ['.md'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['document', 'context_blueprint'],
    offlineCapabilities: ['document_generation', 'contract_test_generation', 'context_blueprint', 'terminal_task'],
    bestPractices: [
      'Defina título, objetivo e escopo antes do conteúdo técnico.',
      'Documente contratos, premissas e riscos de forma objetiva e verificável.',
      'Evite textos genéricos; prefira instruções com critério de aceitação.',
      'Use exemplos e critérios de validação quando orientar implementação.',
      'Padronize seção de decisões e pontos de não-retorno para leitura incremental.',
      'Evite duplicação de conteúdo mantendo fontes únicas e rastreáveis.',
    ],
  },
  {
    id: 'mermaid',
    extensions: ['.mmd', '.mermaid'],
    commentPrefix: '%%',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['diagram', 'context_blueprint'],
    offlineCapabilities: ['diagram_generation', 'contract_test_generation', 'context_blueprint', 'terminal_task'],
    bestPractices: [
      'Modele fluxo com nomes explícitos e direção consistente.',
      'Evite excesso de detalhes visuais quando o objetivo for contrato.',
      'Mantenha nós e transições refletindo regras reais de domínio.',
      'Valide caminhos de falha e condições de cancelamento no diagrama.',
      'Prefira composição por subdiagramas em vez de grafo achatado.',
      'Padronize estilos para manter legibilidade entre arquivos.',
    ],
  },
  {
    id: 'dockerfile',
    extensions: ['.dockerfile'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'workdir'],
    offlineCapabilities: ['workdir_generation', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
    bestPractices: [
      'Declare WORKDIR, imagem base e cópia de arquivos de forma explícita.',
      'Mantenha camadas previsíveis e minimizadas por objetivo.',
      'Evite efeitos implícitos no diretório de execução.',
      'Padronize política de cache e limpeza para builds reproduzíveis.',
      'Versão imagens e ferramentas para reduzir risco de mudança transitória.',
      'Valide usuário, permissões e superfície de ataque no passo de runtime.',
    ],
  },
  {
    id: 'shell',
    extensions: ['.sh', '.bash', '.zsh'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: false,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['function', 'test', 'comment', 'enum', 'class', 'interface', 'struct', 'module', 'object', 'collection', 'variable', 'script'],
    offlineCapabilities: ['simple_function', 'arithmetic_function', 'literal_return', 'context_blueprint', 'contract_test_generation', 'terminal_task', 'simple_script'],
    bestPractices: [
      'Use `set -euo pipefail` quando o contrato exigir falha determinística.',
      'Mantenha comandos pequenos, idempotentes e com mensagens estáveis.',
      'Valide parâmetros obrigatórios antes de executar ações destrutivas.',
      'Separe parsing de dados de execução com validação e sanitização explícita.',
      'Evite dependência de formatação frágil de saída de terceiros.',
      'Padronize códigos de saída e logs para melhor observabilidade.',
    ],
  },
  {
    id: 'toml',
    extensions: ['.toml'],
    commentPrefix: '#',
    unitTestStyle: 'contract',
    structured: true,
    editorFeatures: ['comment_task', 'context_file', 'unit_test', 'terminal_task'],
    commentTaskIntents: ['config', 'section', 'context_blueprint'],
    offlineCapabilities: ['comment_task', 'context_blueprint', 'contract_test_generation', 'terminal_task'],
    bestPractices: [
      'Prefira chaves explícitas e seções pequenas por contexto.',
      'Evite sobrecarregar um arquivo com contextos heterogêneos.',
      'Declare defaults e overrides de forma visível para evitar comportamento implícito.',
      'Mantenha comentários curtos e úteis para operação e manutenção.',
      'Versione mudança de contrato e documente impacto de compatibilidade.',
      'Use ordenação estável para facilitar revisão e diffs determinísticos.',
    ],
  },
  {
    id: 'default',
    extensions: [],
    commentPrefix: '#',
    unitTestStyle: 'none',
    structured: false,
    editorFeatures: ['comment_task', 'terminal_task'],
    commentTaskIntents: ['function', 'comment'],
    offlineCapabilities: ['comment_task', 'terminal_task'],
    bestPractices: [
      'Prefira contratos pequenos, nomes claros e efeitos isolados.',
      'Use validação mínima antes de aplicar transformações em linguagem não mapeada.',
      'Aplique comportamento conservador com fallback determinístico.',
      'Evite inferências agressivas em texto sem semântica de linguagem conhecida.',
      'Prefira mensagens de orientação e não ações automáticas em caso de ambiguidade.',
    ],
  },
]);

const DEFAULT_ACTIVE_LANGUAGE_IDS = Object.freeze(
  LANGUAGE_CAPABILITY_REGISTRY
    .map((entry) => entry.id)
    .filter((id) => id && id !== 'default'),
);

function parseActiveLanguageIdsFromEnv(rawValue) {
  // Entrada: string com ids separados por vírgula | Saida: lista normalizada e sem duplicados.
  const normalized = String(rawValue || '')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter(Boolean);
  if (normalized.length === 0) {
    return [...DEFAULT_ACTIVE_LANGUAGE_IDS];
  }
  return Array.from(new Set(normalized));
}

const ACTIVE_LANGUAGE_IDS = Object.freeze(
  new Set(parseActiveLanguageIdsFromEnv(process.env.PINGU_ACTIVE_LANGUAGE_IDS)),
);

const EXTENSION_TO_CAPABILITY = new Map();
LANGUAGE_CAPABILITY_REGISTRY.forEach((entry) => {
  entry.extensions.forEach((extension) => {
    EXTENSION_TO_CAPABILITY.set(extension, entry);
  });
});
const DEFAULT_CAPABILITY_ENTRY = LANGUAGE_CAPABILITY_REGISTRY[LANGUAGE_CAPABILITY_REGISTRY.length - 1];
const OFFLINE_FEATURE_CAPABILITY_MAP = Object.freeze({
  comment_task: [
    'comment_task',
    'simple_function',
    'arithmetic_function',
    'literal_return',
    'dice_roll',
    'crud_scaffold',
    'document_generation',
    'diagram_generation',
    'required_version_fix',
    'workdir_generation',
    'simple_script',
  ],
  context_file: [
    'context_blueprint',
  ],
  unit_test: [
    'unit_test_generation',
    'contract_test_generation',
  ],
  terminal_task: [
    'terminal_task',
  ],
});

function isProductionRuntime(env = process.env) {
  const normalizedMode = String(env.NODE_ENV || '').trim().toLowerCase();
  return normalizedMode === 'production';
}

function isOfflineFirstRuntimeEnv(env = process.env) {
  return String(env.PINGU_OFFLINE_MODE || '').trim().toLowerCase() === 'true';
}

function analysisExtension(fileOrExt) {
  const source = String(fileOrExt || '');
  if (!source) {
    return '';
  }
  if (source.startsWith('.')) {
    return source.toLowerCase();
  }
  const base = path.basename(source).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) {
    return '.dockerfile';
  }
  return path.extname(source).toLowerCase();
}

function getCapabilityProfile(fileOrExt) {
  const extension = analysisExtension(fileOrExt);
  const resolved = EXTENSION_TO_CAPABILITY.get(extension) || DEFAULT_CAPABILITY_ENTRY;
  if (resolved.id === 'default') {
    return DEFAULT_CAPABILITY_ENTRY;
  }
  return ACTIVE_LANGUAGE_IDS.has(resolved.id) ? resolved : DEFAULT_CAPABILITY_ENTRY;
}

function cloneList(value) {
  // Entrada: valor possivel-lista | Saida: cópia rasa ou array vazio.
  return Array.isArray(value) ? [...value] : [];
}

function declaredCommentTaskIntentsFor(fileOrExt) {
  // Entrada: caminho ou extensão | Saida: intents suportadas para esse arquivo.
  return cloneList(getCapabilityProfile(fileOrExt).commentTaskIntents);
}

function declaredEditorFeaturesFor(fileOrExt) {
  // Entrada: caminho ou extensão | Saida: recursos habilitados no editor para o perfil.
  return cloneList(getCapabilityProfile(fileOrExt).editorFeatures);
}

function declaredOfflineCapabilitiesFor(fileOrExt) {
  // Entrada: caminho ou extensão | Saida: capacidades cobertas por fallback local.
  return cloneList(getCapabilityProfile(fileOrExt).offlineCapabilities);
}

function supportsCommentTaskIntent(fileOrExt, intent) {
  // Entrada: arquivo + intent | Saida: true quando intent é conhecida no perfil ativo.
  const normalizedIntent = String(intent || '').trim().toLowerCase();
  if (!normalizedIntent || !isLanguageActive(fileOrExt)) {
    return false;
  }
  return declaredCommentTaskIntentsFor(fileOrExt).includes(normalizedIntent);
}
function supportsEditorFeature(fileOrExt, feature) {
  // Entrada: arquivo + feature | Saida: true quando feature está ativa para esse arquivo.
  const normalizedFeature = String(feature || '').trim();
  if (!normalizedFeature || !isLanguageActive(fileOrExt)) {
    return false;
  }
  return declaredEditorFeaturesFor(fileOrExt).includes(normalizedFeature);
}
function isLanguageActive(fileOrExt) {
  // Entrada: caminho ou extensão | Saida: true se linguagem está no set ativo.
  const extension = analysisExtension(fileOrExt);
  const resolved = EXTENSION_TO_CAPABILITY.get(extension);
  return Boolean(resolved && ACTIVE_LANGUAGE_IDS.has(resolved.id));
}
function requiresAiForFeature(fileOrExt, feature) {
  // Entrada: arquivo + feature | Saida: true quando o fluxo ainda depende de IA (fora do mapa offline).
  if (isProductionRuntime(process.env) || isOfflineFirstRuntimeEnv(process.env)) {
    return false;
  }

  if (!isLanguageActive(fileOrExt)) {
    return false;
  }

  const normalizedFeature = String(feature || '').trim();
  const offlineCapabilities = declaredOfflineCapabilitiesFor(fileOrExt);
  const matchingOfflineCapabilities = OFFLINE_FEATURE_CAPABILITY_MAP[normalizedFeature] || [];
  if (matchingOfflineCapabilities.some((capability) => offlineCapabilities.includes(capability))) {
    return false;
  }

  return ['comment_task', 'context_file', 'unit_test'].includes(normalizedFeature);
}
function activeLanguageIds() {
  // Saida: lista dos ids de linguagem ativos no runtime atual.
  return Array.from(ACTIVE_LANGUAGE_IDS);
}

function languageCapabilityRegistry() {
  // Saida: snapshot congelado do registry filtrado pelas linguagens ativas.
  return LANGUAGE_CAPABILITY_REGISTRY
    .filter((entry) => entry.id === 'default' || ACTIVE_LANGUAGE_IDS.has(entry.id))
    .map((entry) => ({
    ...entry,
    extensions: cloneList(entry.extensions),
    editorFeatures: cloneList(entry.editorFeatures),
    commentTaskIntents: cloneList(entry.commentTaskIntents),
    offlineCapabilities: cloneList(entry.offlineCapabilities),
    bestPractices: cloneList(entry.bestPractices),
    }));
}

module.exports = {
  ACTIVE_LANGUAGE_IDS,
  DEFAULT_ACTIVE_LANGUAGE_IDS,
  LANGUAGE_CAPABILITY_REGISTRY,
  activeLanguageIds,
  analysisExtension,
  declaredCommentTaskIntentsFor,
  declaredEditorFeaturesFor,
  declaredOfflineCapabilitiesFor,
  getCapabilityProfile,
  isLanguageActive,
  languageCapabilityRegistry,
  requiresAiForFeature,
  supportsCommentTaskIntent,
  supportsEditorFeature,
};
