'use strict';

const {
  commentPrefix: resolveCommentPrefix,
  isJavaScriptLikeExtension,
  isPythonLikeExtension,
  isRubyExtension,
  isGoExtension,
  isRustExtension,
  isElixirExtension,
  supportsSlashComments,
  supportsHashComments,
} = require('./language-profiles');

function sanitizeAnalysisLine(line) {
  return String(line || '')
    .replace(/".*?"/g, '')
    .replace(/'.*?'/g, '')
    .replace(/#.*/, '')
    .trim();
}
function sanitizeIdentifier(value) {
  const normalized = String(value).replace(/[^a-zA-Z0-9_?!]/g, '');
  return normalized || 'agent_task';
}
function sanitizeNaturalIdentifier(value) {
  const ascii = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_?!]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return sanitizeIdentifier(ascii || 'valor');
}
function safeComment(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}
function commentPrefix(ext) {
  return resolveCommentPrefix(ext);
}
function replaceIdentifierOnce(line, oldValue, newValue) {
  const pattern = new RegExp(`\\b${escapeRegExp(oldValue)}\\b`);
  return line.replace(pattern, newValue);
}
function countBlockDelta(line) {
  const opens = countMatches(/\bdo\b/g, line);
  const anonymousFnOpens = countMatches(/\bfn\b/g, line);
  const closes = countMatches(/\bend\b/g, line);
  return opens + anonymousFnOpens - closes;
}
function countMatches(regex, text) {
  return [...String(text).matchAll(regex)].length;
}
function removeInlineComment(line) {
  const parts = String(line).split('#');
  return parts[0];
}
function isReservedToken(candidate) {
  return [
    'and', 'or', 'not', 'when', 'else', 'end', 'do', 'after', 'case', 'for', 'with', 'try', 'catch', 'raise',
    'rescue', 'receive', 'cond', 'if', 'unless', 'fn', 'def', 'defp', 'defmodule', 'defstruct', 'defimpl', 'defdelegate',
  ].includes(candidate);
}
function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function lineIndentation(line) {
  const match = String(line).match(/^\s*/);
  return match ? match[0] : '';
}
function isCommentLine(line, ext) {
  const trimmed = String(line || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (!trimmed) {
    return false;
  }
  if (/^(?:\/\*\*|\/\*|\*\/|\*|@doc\b|@moduledoc\b|@spec\b|"""|''')/.test(trimmed)) {
    return true;
  }
  if (lowerExt === '.md' && /^<!--.*-->$/.test(trimmed)) {
    return true;
  }
  if (trimmed.startsWith('///') || trimmed.startsWith('//')) {
    return supportsSlashComments(lowerExt);
  }
  if (trimmed.startsWith('--')) {
    return lowerExt === '.lua';
  }
  if (trimmed.startsWith('"')) {
    return lowerExt === '.vim';
  }
  if (trimmed.startsWith('#')) {
    return supportsHashComments(lowerExt) || lowerExt === '.md';
  }
  return false;
}
function stripInlineComment(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const source = String(line || '');
  if (supportsSlashComments(lowerExt)) {
    return source.replace(/\s*\/\/.*$/, '');
  }
  if (lowerExt === '.lua') {
    return source.replace(/\s*--.*$/, '');
  }
  if (lowerExt === '.vim') {
    return source;
  }
  if (supportsHashComments(lowerExt)) {
    return source.replace(/\s*#.*$/, '');
  }
  return source;
}
function matchAssignmentStatement(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const cleaned = stripInlineComment(line, ext).trim();
  let match = null;

  if (isJavaScriptLikeExtension(lowerExt)) {
    match = cleaned.match(/^(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);?$/);
  } else if (isPythonLikeExtension(lowerExt) || isRubyExtension(lowerExt) || isElixirExtension(lowerExt)) {
    match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_?!]*)\s*=\s*(.+)$/);
  } else if (lowerExt === '.tf') {
    match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_\-]*)\s*=\s*(.+)$/);
  } else if (['.yaml', '.yml'].includes(lowerExt)) {
    match = cleaned.match(/^([A-Za-z0-9_.-]+):\s+(.+)$/);
  } else if (lowerExt === '.lua') {
    match = cleaned.match(/^(?:local\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  } else if (lowerExt === '.go') {
    match = cleaned.match(/^([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*:?=\s*(.+)$/);
  } else if (lowerExt === '.rs') {
    match = cleaned.match(/^let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?);?$/);
  } else if (lowerExt === '.vim') {
    match = cleaned.match(/^let\s+((?:[gswbtlav]:)?[A-Za-z_#][A-Za-z0-9_:#]*)\s*=\s*(.+)$/);
  }

  if (!match || !match[1] || !match[2]) {
    return null;
  }

  return {
    name: sanitizeIdentifier(String(match[1]).split(',')[0].trim()),
    rhs: match[2].trim(),
  };
}
function looksCommentWorthyAssignment(rhs) {
  const normalized = String(rhs || '').trim();
  if (!normalized) {
    return false;
  }
  if (/^(?:[+-]?\d+(?:\.\d+)?|true|false|nil|null|None|"[^"]*"|'[^']*')$/.test(normalized)) {
    return false;
  }
  return (
    /\w+\s*\(/.test(normalized)
    || /\.|\|\||&&|\?\?|\|>/.test(normalized)
    || /\[[^\]]*\]|\{[^}]*\}|%\{[^}]*\}/.test(normalized)
    || /[-+*/<>]=?|===?|!==?/.test(normalized)
  );
}
function humanizeIdentifier(name) {
  return String(name || 'valor')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[:#]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function describeAssignmentRhs(name, rhs) {
  const normalized = String(rhs || '').trim();
  const normalizedName = String(name || '').trim().toLowerCase();
  const combined = `${normalizedName} ${normalized}`.toLowerCase();
  if (/\b(runtime_?state|chat_?state|state)\b/.test(combined)) {
    return 'Mantem o estado compartilhado usado para coordenar o fluxo atual.';
  }
  if (/\b(payload|message|event)\b/.test(combined)) {
    return 'Agrupa os dados recebidos para validar e despachar a proxima etapa.';
  }
  if (/\b(room|sala)\b/.test(combined) && /\b(snapshot|serializ|serialize|struct|dict|\{|\[)/.test(combined)) {
    return 'Registra a visao atual da room para responder sem recalcular o estado novamente.';
  }
  if (/\binvite(_code)?\b/.test(combined)) {
    return 'Mantem a referencia de convite usada para autorizar a proxima etapa do fluxo.';
  }
  if (/\b(participant|participante|client_ids?|cliente)_?ids?\b/.test(combined)) {
    return 'Congela os participantes relevantes antes de disparar notificacoes para o restante do fluxo.';
  }
  if (/\b(socket|connection|websocket)\b/.test(combined)) {
    return 'Relaciona a conexao ativa usada para responder ou propagar eventos.';
  }
  if (/parseArgs|process\.argv|ARGV/.test(normalized)) {
    return 'Extrai os argumentos recebidos para decidir o modo de execucao.';
  }
  if (/readFile|File\.read|fs\.|Path\.read|os\.ReadFile/.test(normalized)) {
    return 'Carrega o conteudo necessario para a etapa atual.';
  }
  if (/analyzeText|analisar|analyze/.test(normalized)) {
    return 'Executa a analise principal com o contexto reunido.';
  }
  if (/getenv|environ|process\.env|System\.get_env/.test(normalized)) {
    return 'Le a configuracao externa antes de seguir para a proxima etapa.';
  }
  if (/\.find\(|Enum\.find|next\(/.test(normalized)) {
    return 'Localiza ' + humanizeIdentifier(name) + ' para sustentar a regra principal.';
  }
  if (/\.map\(|\.reduce\(|\.filter\(|Enum\.|stream\.|collect\(/i.test(normalized)) {
    return 'Transforma os dados intermediarios antes da proxima etapa.';
  }
  if (/random|randint|Enum\.random|Math\.random|rand\.Intn|math\.random/.test(normalized)) {
    return 'Gera um valor dinamico conforme a regra definida para este fluxo.';
  }
  if (/\|\||\?\?|&&/.test(normalized)) {
    return 'Resolve ' + humanizeIdentifier(name) + ' priorizando o valor mais confiavel para o fluxo.';
  }
  if (/\[[^\]]*\]|\{[^}]*\}|%\{[^}]*\}/.test(normalized)) {
    return 'Organiza a estrutura de dados usada na etapa atual.';
  }
  if (/[-+*/<>]=?|===?|!==?/.test(normalized)) {
    return 'Calcula ' + humanizeIdentifier(name) + ' para suportar o restante do fluxo.';
  }
  return 'Prepara ' + humanizeIdentifier(name) + ' para a proxima etapa do fluxo.';
}
function matchConditionalStatement(line, ext) {
  const lowerExt = String(ext || '').toLowerCase();
  const cleaned = stripInlineComment(line, ext).trim();

  if ((isJavaScriptLikeExtension(lowerExt) || isGoExtension(lowerExt) || isRustExtension(lowerExt) || ['.c', '.cpp'].includes(lowerExt)) && /^if\s*\(.+\)\s*\{?$/.test(cleaned)) {
    return cleaned;
  }
  if ((isPythonLikeExtension(lowerExt) || isRubyExtension(lowerExt)) && /^if\s+.+:?$/.test(cleaned)) {
    return cleaned;
  }
  if (isElixirExtension(lowerExt) && /^(if|unless)\s+.+\s+do\b/.test(cleaned)) {
    return cleaned;
  }
  if (lowerExt === '.lua' && /^if\s+.+\s+then$/.test(cleaned)) {
    return cleaned;
  }
  if (lowerExt === '.vim' && /^if\s+.+$/.test(cleaned)) {
    return cleaned;
  }
  return '';
}
function looksEarlyExitLine(line) {
  const normalized = String(line || '').trim();
  return /\b(?:return|throw|raise|process\.exit|exit\(|fail\b)\b/.test(normalized);
}
function describeConditionalGuard(condition, nextLines) {
  const nearby = (Array.isArray(nextLines) ? nextLines : []).map((line) => String(line || '')).join('\n');
  if (/\b(?:return|throw|raise|process\.exit|exit\(|fail\b)\b/.test(nearby)) {
    return 'Interrompe cedo quando a pre-condicao obrigatoria nao for atendida.';
  }
  if (/!|nil|None|null|undefined|false/.test(String(condition || ''))) {
    return 'Protege o fluxo contra dados ausentes antes de continuar.';
  }
  return 'Valida a pre-condicao antes de seguir para a proxima etapa.';
}
function matchReturnStatement(line, ext) {
  const cleaned = stripInlineComment(line, ext).trim().replace(/;$/, '');
  if (!/^return\b/.test(cleaned)) {
    return '';
  }
  return cleaned.replace(/^return\b/, '').trim();
}
function looksCommentWorthyReturn(expr) {
  const normalized = String(expr || '').trim();
  if (!normalized) {
    return false;
  }
  return looksCommentWorthyAssignment(normalized) || /^(?:ok|error)$/i.test(normalized);
}
function describeReturnExpression(expr) {
  const normalized = String(expr || '').trim();
  const lower = normalized.toLowerCase();
  if (/\b(room|sala)\b/.test(lower) && /\b(snapshot|serializ|serialize|dict|\{|\[)/.test(lower)) {
    return 'Retorna a representacao atual da room pronta para resposta ou broadcast.';
  }
  if (/\b(participant|participante|client_ids?|cliente)_?ids?\b/.test(lower)) {
    return 'Entrega a lista consolidada de participantes afetados por esta etapa.';
  }
  if (/\b(chat_?state|runtime_?state|state)\b/.test(lower)) {
    return 'Retorna o estado consolidado para a proxima etapa do fluxo.';
  }
  if (/\b(message|payload|event)\b/.test(lower)) {
    return 'Entrega a carga final pronta para o contrato desta operacao.';
  }
  if (/random|randint|Enum\.random|Math\.random|rand\.Intn|math\.random/.test(normalized)) {
    return 'Entrega o valor calculado dinamicamente para o contrato da funcao.';
  }
  if (/\.find\(|Enum\.find|next\(/.test(normalized)) {
    return 'Devolve o registro localizado para a chamada atual.';
  }
  if (/\.map\(|\.reduce\(|\.filter\(|Enum\.|stream\.|collect\(/i.test(normalized)) {
    return 'Retorna a colecao transformada ao final desta etapa.';
  }
  if (/\[[^\]]*\]|\{[^}]*\}|%\{[^}]*\}/.test(normalized)) {
    return 'Entrega a estrutura final montada para o contrato atual.';
  }
  return 'Retorna o resultado consolidado desta funcao.';
}
function matchCallStatement(line, ext) {
  const cleaned = stripInlineComment(line, ext).trim().replace(/;$/, '');
  if (!cleaned) {
    return '';
  }
  if (/^(?:if\b|return\b|throw\b|raise\b|switch\b|case\b|when\b|for\b|while\b|function!?\b|function\b|def\b|defp\b|defmodule\b|func\b|fn\b|local\s+function\b|let\b|const\b|var\b|import\b|from\b|use\b|package\b|@doc\b|@spec\b|@moduledoc\b)/.test(cleaned)) {
    return '';
  }
  if (/^(?:call\s+|await\s+)?[A-Za-z_][A-Za-z0-9_:.#]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*\s*\(.+\)$/.test(cleaned)) {
    return cleaned;
  }
  return '';
}
function describeCallStatement(expr) {
  const normalized = String(expr || '').trim();
  const lower = normalized.toLowerCase();
  if (/\b(send_event|broadcast_to_clients|emit|publish|notify|dispatch)\b/.test(lower)) {
    return 'Dispara o evento necessario para propagar a mudanca observavel deste fluxo.';
  }
  if (/\b(join_room|leave_room|create_invite|create_public_room|create_private_room)\b/.test(lower)) {
    return 'Executa a transicao principal de room antes de responder aos clientes envolvidos.';
  }
  if (/process\.exit|\bexit\(/.test(normalized)) {
    return 'Encerra a execucao quando o fluxo nao deve continuar.';
  }
  if (/Logger\.|console\.|print\(|puts\(|IO\.puts|IO\.inspect/.test(normalized)) {
    return 'Registra o estado atual para observabilidade ou diagnostico.';
  }
  if (/dispatch\(|set[A-Z][A-Za-z0-9_]*\(/.test(normalized)) {
    return 'Atualiza o estado compartilhado antes da proxima renderizacao.';
  }
  if (/save|write|insert|create|publish|send|emit/.test(normalized)) {
    return 'Persiste ou publica o efeito esperado para esta etapa.';
  }
  if (/validate|assert|check/.test(normalized)) {
    return 'Executa a validacao necessaria antes de seguir com o fluxo.';
  }
  return 'Executa a etapa de efeito colateral necessaria para este fluxo.';
}
const JAVASCRIPT_DEPENDENCY_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx']);

function isDependencyDeclarationLine(line, ext = '') {
  const trimmed = String(line || '').trim().replace(/;$/, '');
  const lowerExt = String(ext || '').toLowerCase();
  const isJavaScriptLike = JAVASCRIPT_DEPENDENCY_EXTENSIONS.has(lowerExt);
  if (!trimmed) {
    return false;
  }
  if (/^(?:import\b|from\b.+\s+import\b|alias\b|use\b|package\b|require\b|require_relative\b|module\.exports\b)/.test(trimmed)) {
    return true;
  }
  if (/^(?:#include\b|extern\s+crate\b|mod\s+[A-Za-z_][A-Za-z0-9_]*\b|using\s+[A-Za-z_][A-Za-z0-9_.]*\b)/.test(trimmed)) {
    return true;
  }
  if (/^(?:source\b|\.\s+\S+)/.test(trimmed)) {
    return true;
  }
  if (/^export\s+(?:\{|\*)/.test(trimmed) || /^export\s+[^;]+?\s+from\s+['"`]/.test(trimmed)) {
    return true;
  }
  if (lowerExt === '.lua' && /^local\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*require(?:\s*\(|\s+['"])/.test(trimmed)) {
    return true;
  }
  return isJavaScriptLike && (
    /^(?:const|let|var)\s+(?:\{[^}]+\}|[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\s*\(/.test(trimmed)
    || /^(?:const|let|var)\s+(?:\{[^}]+\}|[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*await\s+import\s*\(/.test(trimmed)
  );
}
function buildMaintenanceComment(line, ext, nextLines = []) {
  const trimmed = String(line || '').trim();
  const lowerExt = String(ext || '').toLowerCase();
  if (lowerExt === '.md') {
    return '';
  }
  if (!trimmed || isCommentLine(line, ext)) {
    return '';
  }
  if (isDependencyDeclarationLine(line, ext)) {
    return '';
  }
  if (/^(?:function!?\b|function\b|def\b|defp\b|defmodule\b|func\b|fn\b|local\s+function\b|@doc\b|@spec\b|@moduledoc\b)/.test(trimmed)) {
    return '';
  }

  const assignment = matchAssignmentStatement(line, ext);
  if (assignment && looksCommentWorthyAssignment(assignment.rhs)) {
    return lineIndentation(line) + commentPrefix(ext) + ' ' + describeAssignmentRhs(assignment.name, assignment.rhs);
  }

  return '';
}
function snippetModuledoc() {
  return ['  @moduledoc """', '  Descreva o objetivo principal deste modulo.', '  """'].join('\n');
}
function snippetLongLine(line) {
  const indent = lineIndentation(line);
  return [
    `${indent}# Extraia responsabilidades para variaveis intermediarias`,
    `${indent}# exemplo:`,
    `${indent}# parte = ...`,
    `${indent}# parte2 = ...`,
    `${indent}# retorno = parte + parte2`,
  ].join('\n');
}
function snippetDebugOutput(line) {
  const indent = lineIndentation(line);
  const trimmed = line.trim();
  if (/\bconsole\.(?:log|debug|info|warn|error)\(/.test(trimmed)) {
    return transformDebugCall(trimmed, indent, /\bconsole\.(?:log|debug|info|warn|error)\((.*)\);?/);
  }
  if (/\bprint\(/.test(trimmed)) {
    return transformDebugCall(trimmed, indent, /\bprint\((.*)\)\s*$/);
  }
  if (/\bIO\.puts\(/.test(trimmed)) {
    return transformDebugCall(trimmed, indent, /\bIO\.puts\((.*)\)/);
  }
  if (/\bIO\.inspect\(/.test(trimmed)) {
    return transformDebugCall(trimmed, indent, /\bIO\.inspect\((.*)\)/);
  }
  if (/\bdbg\(/.test(trimmed)) {
    return transformDebugCall(trimmed, indent, /\bdbg\((.*)\)/);
  }
  return `${indent}# TODO: substituir debug temporario antes do merge`;
}
function transformDebugCall(line, indent, pattern) {
  const match = line.match(pattern);
  if (!match) {
    return `${indent}# TODO: substituir debug por Logger.debug`;
  }
  if (/\bconsole\.(?:log|debug|info|warn|error)\(/.test(line)) {
    return `${indent}return ${match[1].trim()};`;
  }
  if (/\bprint\(/.test(line)) {
    return `${indent}return ${match[1].trim()}`;
  }
  return `${indent}Logger.debug(${match[1].trim()})`;
}
function snippetTodoFixme() {
  return '# TODO: registrar impacto desta pendencia (id ou contexto)';
}
function snippetTrailingWhitespace(line) {
  return line.trimEnd();
}
function snippetTabs(line = '') {
  return String(line || '').replace(/\t/g, '  ');
}
function snippetFunctionDoc(name, params, context = {}) {
  const functionName = sanitizeIdentifier(name);
  const args = Array.isArray(params) ? params : [];
  const hasArgs = args.length > 0;
  const argLines = hasArgs
    ? args.map((arg) => `  - ${arg}: entrada utilizada nesta etapa.`)
    : ['  - Nenhum argumento recebido.'];
  const summary = context.summary || `${functionDescriptionFromName(functionName)}.`;
  const action = context.action || 'Executa a regra de dominio descrita nesta funcao.';
  const returnDescription = context.returnDescription || 'Retorna um resultado alinhado com o contrato da funcao.';
  return [
    '  @doc """',
    `  ${summary}`,
    '',
    '  ## Argumentos',
    ...argLines,
    '',
    '  ## Ação',
    `  ${action}`,
    '',
    '  ## Retorno',
    `  ${returnDescription}`,
    '  """',
  ].join('\n');
}
function snippetFunctionComment(name, params, ext = '') {
  const paramsText = params.length > 0 ? params.join(', ') : 'sem parametros';
  const prefix = String(commentPrefix(ext) || '#').trim();
  return [
    `  ${prefix} Funcao ${name}: ${functionDescriptionFromName(name)}.`,
    `  ${prefix} Argumentos: ${paramsText}.`,
    `  ${prefix} Retorno: resultado transformado para o fluxo atual.`,
  ].join('\n');
}
function snippetFunctionSpec(name, params, ext, context = {}) {
  const normalized = sanitizeIdentifier(name);
  const paramTypes = Array.isArray(context.paramTypes) ? context.paramTypes : [];
  const paramsText = params.length > 0
    ? params.map((_, index) => paramTypes[index] || 'any()').join(', ')
    : '';
  const returnType = context.returnType || 'any()';
  if (!isElixirExtension(ext)) {
    return `# TODO: adicionar espec do contrato para ${normalized}`;
  }
  return `@spec ${normalized}(${paramsText}) :: ${returnType}`;
}
function functionDescriptionFromName(name) {
  const normalized = String(name || '').toLowerCase();
  const subject = humanizeIdentifier(name || 'valor');
  if (normalized.includes('handle') || normalized.includes('tratar')) {
    return `Coordena o tratamento principal de ${subject}`.trim();
  }
  if (normalized.includes('broadcast') || normalized.includes('notify') || normalized.includes('notificar')) {
    return `Propaga o evento principal relacionado a ${subject}`.trim();
  }
  if (normalized.includes('send') || normalized.includes('enviar')) {
    return `Envia o resultado esperado para ${subject}`.trim();
  }
  if (normalized.includes('join') || normalized.includes('entrar')) {
    return `Adiciona participantes ao fluxo principal de ${subject}`.trim();
  }
  if (normalized.includes('leave') || normalized.includes('sair')) {
    return `Remove participantes do fluxo principal de ${subject}`.trim();
  }
  if (normalized.includes('disconnect') || normalized.includes('desconectar')) {
    return `Finaliza a conexao principal de ${subject}`.trim();
  }
  if (normalized.includes('read') || normalized.includes('ler')) {
    return `Le e normaliza os dados principais de ${subject}`.trim();
  }
  if (normalized.includes('serialize') || normalized.includes('serializ')) {
    return `Serializa os dados principais de ${subject}`.trim();
  }
  if (normalized.includes('list') || normalized.includes('listar')) {
    return `Lista os elementos principais de ${subject}`.trim();
  }
  if (normalized.includes('create') || normalized.includes('cria') || normalized.includes('criar')) {
    return `Constroi uma nova estrutura para ${subject}`.trim();
  }
  if (normalized.includes('update') || normalized.includes('atualiza') || normalized.includes('atualizar')) {
    return `Atualiza dados de ${subject}`.trim();
  }
  if (normalized.includes('delete') || normalized.includes('remove') || normalized.includes('remover')) {
    return `Remove informações associadas a ${subject}`.trim();
  }
  if (normalized.includes('find') || normalized.includes('busca') || normalized.includes('search')) {
    return `Busca informacoes relacionadas a ${subject}`.trim();
  }
  if (normalized.includes('validate') || normalized.includes('valida') || normalized.includes('validar')) {
    return `Valida entradas e regras de negocio de ${subject}`.trim();
  }
  if (normalized.includes('build') || normalized.includes('monta') || normalized.includes('montar')) {
    return `Monta o resultado esperado para ${subject}`.trim();
  }
  if (normalized.includes('parse') || normalized.includes('parseia') || normalized.includes('parsear')) {
    return `Processa e converte entrada para formato de ${subject}`.trim();
  }
  if (normalized.includes('format') || normalized.includes('fmt') || normalized.includes('formatar')) {
    return `Formata informacoes para o contrato de ${subject}`.trim();
  }
  return `Orquestra o comportamento principal de ${subject}`.trim();
}
function snippetFunctionalReassignment(variable, expression) {
  const cleanExpression = String(expression || '').replace(/\s+/g, ' ').trim();
  return [
    '# TODO: evitar mutacao implicita; use fluxo imutavel por etapas.',
    `# Exemplo para ${variable}:`,
    `# ${variable}_next = ${cleanExpression}`,
  ].join('\n');
}
function snippetNestedCondition() {
  return '  # Considere extrair funcoes auxiliares para reduzir complexidade.\n  # Isso melhora testabilidade e leitura do fluxo.';
}
function snippetLargeFile() {
  return ['# Reorganize em modulos menores por responsabilidade:', '# - Parser', '# - Validacao', '# - Formatacao de saida'].join('\n');
}
function renderVim(issues) {
  if (!issues.length) {
    return;
  }
  issues.forEach((issue) => {
    const base = `[${String(issue.severity).toUpperCase()}] ${issue.kind}: ${issue.message}`;
    const suggestion = issue.suggestion ? `${base} | ${issue.suggestion}` : base;
    const actionPayload = issue.action && typeof issue.action === 'object'
      ? ` || ACTION:${escapeAction(issue.action)}`
      : '';
    const final = issue.snippet
      ? `${suggestion}${actionPayload} || SNIPPET:${escapeSnippet(issue.snippet)}`
      : `${suggestion}${actionPayload}`;
    process.stdout.write(`${issue.file}:${issue.line}:1: ${final}\n`);
  });
}
function escapeAction(action) {
  return JSON.stringify(action);
}
function renderText(issues) {
  if (issues.length === 0) {
    console.log('');
    console.log('[OK] Sem problemas automaticos em ' + (issues[0] ? issues[0].file : 'arquivo'));
    return;
  }
  const grouped = issues.reduce((acc, issue) => {
    acc[issue.severity] = acc[issue.severity] || [];
    acc[issue.severity].push(issue);
    return acc;
  }, {});
  console.log('');
  console.log(`Total: ${issues.length} sugestao(oes)`);
  for (const severity of ['error', 'warning', 'info']) {
    const list = grouped[severity] || [];
    if (!list.length) {
      continue;
    }
    const header = {
      error: '[ERRO]',
      warning: '[ATENCAO]',
      info: '[INFO]',
    }[severity];
    console.log(`\n${header} ${list.length} item(ns)`);
    for (const issue of list) {
      console.log(`  - ${issue.file}:${issue.line} (${issue.kind})`);
      console.log(`    Problema: ${issue.message}`);
      console.log(`    Acao: ${issue.suggestion}`);
    }
  }
}
function renderJson(issues) {
  process.stdout.write(JSON.stringify(issues, null, 2));
}

function renderSuccessOrText(issues) {
  if (issues.length === 0) {
    const first = issues[0] || { file: 'arquivo' };
    console.log(`[OK] Sem problemas automaticos em ${first.file}`);
  } else {
    const byKind = issues.reduce((acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    }, {});
    console.log(`[WARN] Problemas encontrados: ${issues.length}`);
    for (const severity of ['error', 'warning', 'info']) {
      if (byKind[severity]) {
        console.log(`- ${severity}: ${byKind[severity]}`);
      }
    }
  }
}
function escapeSnippet(snippet) {
  return String(snippet).replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

module.exports = {
  sanitizeAnalysisLine,
  sanitizeIdentifier,
  sanitizeNaturalIdentifier,
  safeComment,
  commentPrefix,
  isCommentLine,
  buildMaintenanceComment,
  isDependencyDeclarationLine,
  replaceIdentifierOnce,
  countBlockDelta,
  countMatches,
  removeInlineComment,
  isReservedToken,
  escapeRegExp,
  lineIndentation,
  stripInlineComment,
  snippetModuledoc,
  snippetLongLine,
  snippetDebugOutput,
  transformDebugCall,
  snippetTodoFixme,
  snippetTrailingWhitespace,
  snippetTabs,
  snippetFunctionDoc,
  snippetFunctionComment,
  snippetFunctionSpec,
  humanizeIdentifier,
  functionDescriptionFromName,
  snippetFunctionalReassignment,
  snippetNestedCondition,
  snippetLargeFile,
  renderVim,
  escapeAction,
  renderText,
  renderSuccessOrText,
  renderJson,
  escapeSnippet,
};
