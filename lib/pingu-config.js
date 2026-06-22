'use strict';

// Configuracao declarativa por repositorio: um arquivo `.pingurc.json` (ou
// `pingu.config.json`) na raiz do projeto define preferencias de analise sem
// depender de variaveis de ambiente. Precedencia: variavel de ambiente (override
// de sessao) > arquivo de config (intencao do projeto) > default.
//
// Campos suportados:
//   { "disabledKinds": ["tabs", "long_line"],
//     "formattingHygiene": true,
//     "analyzeAi": false,
//     "maxLineLength": 100 }

const fs = require('fs');
const path = require('path');

const CONFIG_NAMES = ['.pingurc.json', 'pingu.config.json'];
const dirConfigCache = new Map();

function readConfigInDir(dir) {
  if (dirConfigCache.has(dir)) {
    return dirConfigCache.get(dir);
  }
  let found = null;
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    try {
      if (fs.existsSync(candidate)) {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          found = parsed;
        }
        break;
      }
    } catch (_error) {
      // arquivo malformado: trata como ausente para nao quebrar a analise.
      break;
    }
  }
  dirConfigCache.set(dir, found);
  return found;
}

// Procura o config subindo do diretorio do arquivo ate a raiz do sistema.
function loadPinguConfig(file) {
  const start = file ? path.dirname(path.resolve(String(file))) : process.cwd();
  let dir = start;
  while (true) {
    const config = readConfigInDir(dir);
    if (config) {
      return config;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function isTruthyEnv(value) {
  return /^(?:1|true|on|yes)$/i.test(String(value || '').trim());
}

function envIsSet(value) {
  return value !== undefined && String(value).trim() !== '';
}

// Conjunto de kinds desabilitados: une a lista da env (override) com a do config.
function resolveDisabledKinds(file, env = process.env) {
  const fromEnv = String(env.PINGU_DISABLED_ISSUE_KINDS || '')
    .split(',')
    .map((kind) => kind.trim())
    .filter(Boolean);
  const config = loadPinguConfig(file);
  const fromConfig = Array.isArray(config && config.disabledKinds)
    ? config.disabledKinds.map((kind) => String(kind || '').trim()).filter(Boolean)
    : [];
  return new Set([...fromEnv, ...fromConfig]);
}

// Higiene de formatter (off por default). Env vence o config quando definida.
function isFormattingHygieneEnabled(file, env = process.env) {
  if (envIsSet(env.PINGU_ENABLE_FORMATTING_HYGIENE)) {
    return isTruthyEnv(env.PINGU_ENABLE_FORMATTING_HYGIENE);
  }
  const config = loadPinguConfig(file);
  return Boolean(config && config.formattingHygiene === true);
}

// Resolucao por IA durante a analise (off por default).
function isAnalyzeAiEnabled(file, env = process.env) {
  if (envIsSet(env.PINGU_ANALYZE_AI)) {
    return isTruthyEnv(env.PINGU_ANALYZE_AI);
  }
  const config = loadPinguConfig(file);
  return Boolean(config && config.analyzeAi === true);
}

// Limite de comprimento de linha: opcao explicita > config > fallback.
function resolveMaxLineLength(file, explicit, fallback, env = process.env) {
  if (Number.isFinite(explicit)) {
    return explicit;
  }
  const config = loadPinguConfig(file);
  if (config && Number.isFinite(Number(config.maxLineLength))) {
    return Number(config.maxLineLength);
  }
  return fallback;
}

// Bloco provider do config: { "provider": { "command", "model", "kind" } }.
// Resolvido a partir do diretorio de trabalho (escolha de provider e por repo).
function providerConfigField(file, field, env, envName) {
  const fromEnv = env ? env[envName] : undefined;
  if (envIsSet(fromEnv)) {
    return String(fromEnv).trim();
  }
  const config = loadPinguConfig(file);
  const provider = config && config.provider;
  if (provider && typeof provider === 'object' && envIsSet(provider[field])) {
    return String(provider[field]).trim();
  }
  return '';
}

function resolveProviderCommand(file, env = process.env) {
  return providerConfigField(file, 'command', env, 'PINGU_COPILOT_COMMAND');
}

function resolveProviderModel(file, env = process.env) {
  return providerConfigField(file, 'model', env, 'PINGU_COPILOT_MODEL');
}

function resolveProviderKind(file, env = process.env) {
  return providerConfigField(file, 'kind', env, 'PINGU_CLI_PROVIDER_KIND');
}

function clearPinguConfigCache() {
  dirConfigCache.clear();
}

module.exports = {
  loadPinguConfig,
  resolveDisabledKinds,
  isFormattingHygieneEnabled,
  isAnalyzeAiEnabled,
  resolveMaxLineLength,
  resolveProviderCommand,
  resolveProviderModel,
  resolveProviderKind,
  clearPinguConfigCache,
};
