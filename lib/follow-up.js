'use strict';

const { safeComment } = require('./support');
const { analysisExtension, commentPrefix } = require('./language-profiles');
const { loadProjectMemory } = require('./project-memory');

function normalizeFollowUpText(text) {
  return safeComment(text || '');
}

function normalizedIssueAction(issue) {
  if (issue && issue.action && typeof issue.action === 'object') {
    return issue.action;
  }
  return {};
}

function isBlueprintContextTarget(targetFile) {
  const normalized = String(targetFile || '').replace(/\\/g, '/');
  return normalized.includes('/.pingu-dev-agent/contexts/');
}

function followUpMarker(issue) {
  const action = normalizedIssueAction(issue);
  if (String(action.op || '') === 'run_command') {
    return '*';
  }
  if (String(action.op || '') === 'write_file' && isBlueprintContextTarget(action.target_file)) {
    return '**';
  }
  return ':';
}

function followUpCommentPrefix(file, marker) {
  if (analysisExtension(file) === '.md') {
    return `<!-- ${marker} `;
  }
  return `${commentPrefix(file)} ${marker} `;
}

function extractUndefinedVariableName(message) {
  const match = String(message || '').match(/Variavel '([^']+)' nao declarada/);
  return match ? match[1] : '';
}

function extractUndefinedVariableSuggestion(suggestion) {
  const match = String(suggestion || '').match(/Substitua por '([^']+)'/);
  return match ? match[1] : '';
}

function buildFollowUpInstruction(issue) {
  const message = normalizeFollowUpText(issue && issue.message);
  const suggestion = normalizeFollowUpText(issue && issue.suggestion);
  const kind = String(issue && issue.kind || '');
  const ext = analysisExtension(issue && issue.file || '');
  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
  const projectMemory = loadProjectMemory(issue && issue.file || '');

  function withProjectContext(baseInstruction) {
    const contextHints = [];
    if (projectMemory.architecture) {
      contextHints.push(`mantenha a arquitetura ${projectMemory.architecture}`);
    }
    if (projectMemory.entity) {
      contextHints.push(`alinhe com a entidade ${projectMemory.entity}`);
    }
    if (metadata.containerClassName || metadata.enclosingClassName) {
      contextHints.push(`respeite o contrato de ${metadata.containerClassName || metadata.enclosingClassName}`);
    }
    if (metadata.symbolName && ['variable_doc', 'flow_comment'].includes(kind)) {
      contextHints.push(`explique o papel de ${metadata.symbolName}`);
    }
    if (contextHints.length === 0) {
      return baseInstruction;
    }
    return `${baseInstruction}; ${contextHints.join(' e ')}`;
  }

  if (kind === 'undefined_variable') {
    const unknown = extractUndefinedVariableName(message);
    const replacement = extractUndefinedVariableSuggestion(suggestion);
    if (unknown && replacement) {
      return `substitua ${unknown} por ${replacement} retornando apenas o trecho corrigido sem comentarios explicativos`;
    }
  }

  if (kind.startsWith('syntax_') || /\bsyntax error\b/i.test(message)) {
    const diagnostic = message || 'erro de sintaxe nao detalhado';
    const extraHint = suggestion
      ? ` ajuste esperado: ${suggestion}.`
      : '';
    return `corrija o erro de sintaxe preservando a intencao do codigo; diagnostico: ${diagnostic}.${extraHint} retorne apenas o trecho final corrigido`;
  }

  if (kind === 'moduledoc') {
    return 'adicione @moduledoc idiomatico deixando claro o contrato do modulo';
  }

  if (kind === 'function_doc') {
    if (['.ex', '.exs'].includes(ext)) {
      return withProjectContext('adicione @doc idiomatico para a funcao publica mantendo a regra de negocio');
    }
    if (ext === '.py') {
      return withProjectContext('adicione docstring Python idiomatica no formato Google explicando responsabilidade, argumentos e retorno com base no corpo da funcao, sem repetir o nome do simbolo nem inventar comportamento');
    }
    if (['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(ext)) {
      return withProjectContext('adicione JSDoc idiomatico explicando responsabilidade, parametros e retorno com base no codigo real, sem comentario tautologico');
    }
    return withProjectContext('adicione @doc idiomatico para a funcao publica mantendo a regra de negocio');
  }

  if (kind === 'class_doc') {
    if (ext === '.py') {
      return withProjectContext('adicione docstring curta e idiomatica para a classe deixando clara a responsabilidade principal e o contrato da estrutura');
    }
    return withProjectContext('adicione documentacao curta para a classe mantendo o contrato atual');
  }

  if (kind === 'variable_doc') {
    return withProjectContext('adicione comentario curto e contextual para a variavel ou atributo explicando o papel no fluxo ou contrato, sem apenas repetir nome e tipo');
  }

  if (kind === 'function_spec') {
    return 'adicione @spec coerente com os parametros e o retorno reais da funcao';
  }

  if (kind === 'debug_output') {
    return 'remova a saida de debug mantendo apenas a regra de negocio e retorne so o codigo final';
  }

  if (kind === 'todo_fixme') {
    return suggestion || 'Use um ticket ou comentario estruturado para pedir a proxima alteracao aqui';
  }

  if (kind === 'flow_comment') {
    return withProjectContext('adicione comentario curto e contextual acima deste passo explicando por que ele existe e qual efeito prepara no fluxo atual');
  }

  if (kind === 'functional_reassignment') {
    return 'refatore para fluxo funcional sem reatribuir a mesma variavel e retorne so o codigo final';
  }

  if (kind === 'nested_condition') {
    return 'refatore nested condition mantendo a regra de negocio';
  }

  if (kind === 'context_contract') {
    return withProjectContext('ajuste o contrato da funcao para respeitar o contexto ativo do projeto');
  }

  if (kind === 'context_file') {
    return withProjectContext('refine o blueprint ou contexto ativo para orientar as proximas geracoes sem espalhar regras pelo codigo');
  }

  if (kind === 'unit_test') {
    return withProjectContext('gere ou complemente testes no contrato publico observavel, sem acoplar aos detalhes internos');
  }

  if (kind === 'unit_test_signature') {
    return withProjectContext('ajuste as chamadas no teste para casar a assinatura atual da funcao, preservando o comportamento do caso de uso');
  }

  if (suggestion) {
    return suggestion;
  }

  return message;
}

function buildFollowUpComment(file, issue) {
  const instruction = buildFollowUpInstruction(issue);
  if (!instruction) {
    return '';
  }

  const marker = followUpMarker(issue);
  const prefix = followUpCommentPrefix(file, marker);
  if (analysisExtension(file) === '.md') {
    return `${prefix}${instruction} -->`;
  }
  return `${prefix}${instruction}`;
}

module.exports = {
  buildFollowUpComment,
  buildFollowUpInstruction,
  followUpCommentPrefix,
  followUpMarker,
};
