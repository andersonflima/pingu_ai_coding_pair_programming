'use strict';

const path = require('path');
const { fixPriorityForKind, resolveIssueAction } = require('./issue-kinds');
const { loadProjectMemory } = require('./project-memory');

const DOCUMENTATION_KINDS = new Set([
  'class_doc',
  'flow_comment',
  'function_comment',
  'function_doc',
  'moduledoc',
  'variable_doc',
]);
const COMMENT_NOISE_SYMBOLS = new Set([
  'id',
  'name',
  'title',
  'label',
  'value',
  'count',
  'total',
  'status',
  'host',
  'port',
]);
const DEFAULT_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE = 0.6;

function readDocumentationAutoFixMinConfidence(env = process.env) {
  // Entrada: mapa env | Saida: limiar numerico para auto-fix de docs.
  const raw = Number.parseFloat(
    String(env.PINGU_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE || DEFAULT_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE),
  );
  if (!Number.isFinite(raw)) {
    return DEFAULT_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE;
  }
  return Math.max(0, Math.min(0.99, raw));
}

function severityRank(severity) {
  switch (String(severity || '').trim()) {
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
    default:
      return 0;
  }
}

function issueConfidence(issue) {
  // Entrada: issue | Saida: objeto com score de confiança e motivos.
  const kind = String(issue && issue.kind || '').trim();
  const action = resolveIssueAction(issue);
  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
  const message = String(issue && issue.message || '');
  const suggestion = String(issue && issue.suggestion || '');
  const snippet = String(issue && issue.snippet || '').trim();
  const reasons = [];
  let score = 0.55;

  switch (kind) {
    case 'syntax_missing_quote':
    case 'syntax_missing_delimiter':
    case 'syntax_missing_comma':
    case 'syntax_extra_delimiter':
    case 'syntax_malformed_keyword':
    case 'loose_equality':
    case 'none_comparison':
    case 'nil_comparison':
    case 'bare_except':
    case 'tabs':
    case 'trailing_whitespace':
      score = 0.98;
      reasons.push('padrao sintatico objetivo');
      break;
    case 'undefined_variable':
      if (/^(?:undefined_variable:\s*)?Import '([^']+)' nao exportado por /.test(message)) {
        score = 0.97;
        reasons.push('binding validado pela origem do import');
      } else if (suggestion && String(action.op || '') === 'replace_line') {
        score = 0.88;
        reasons.push('substituicao derivada do escopo local');
      } else {
        score = 0.62;
        reasons.push('correcao depende de heuristica local');
      }
      break;
    case 'missing_dependency':
      score = 0.9;
      reasons.push('dependencia inferida a partir do snippet gerado');
      break;
    case 'debug_output':
    case 'duplicate_line':
    case 'todo_fixme':
      score = 0.86;
      reasons.push('sinal textual direto no codigo');
      break;
    case 'comment_task':
      score = snippet ? 0.88 : 0.64;
      reasons.push('pedido acionavel explicito com snippet aplicavel no arquivo atual');
      break;
    case 'context_file':
    case 'unit_test':
      score = snippet && (String(action.op || '') === 'write_file' || String(action.op || '') === 'replace_line')
        ? 0.84
        : 0.64;
      reasons.push('saida gerada explicitamente para o pedido acionavel');
      break;
    case 'context_contract':
      score = snippet && metadata.returnExpression
        ? 0.84
        : snippet
          ? 0.74
          : 0.58;
      reasons.push('contrato de retorno inferido a partir do corpo local');
      break;
    case 'functional_reassignment':
    case 'nested_condition':
      score = snippet ? 0.72 : 0.58;
      reasons.push('refactor semantico depende do contexto local');
      break;
    case 'function_spec':
    case 'moduledoc':
      score = 0.78;
      reasons.push('contrato documental idiomatico');
      break;
    case 'function_doc':
    case 'class_doc':
      score = metadata.declarationStartLine || metadata.signaturePreview || metadata.bodyPreview
        ? 0.76
        : 0.64;
      reasons.push('documentacao baseada na declaracao do simbolo');
      break;
    case 'unit_test_signature':
      score = 0.9;
      reasons.push('chamada de teste deriva diretamente do texto da funcao de teste');
      break;
    case 'variable_doc':
      score = metadata.symbolName && (metadata.annotation || metadata.rhs || metadata.insideClass)
        ? 0.71
        : 0.56;
      reasons.push('documentacao guiada por nome e contexto do atributo');
      break;
    case 'flow_comment':
      score = metadata.currentStep && (metadata.previousStep || metadata.nextStep)
        ? 0.68
        : 0.54;
      reasons.push('comentario guiado pelo passo do fluxo');
      break;
    case 'terminal_task':
      score = String(action.command || '').trim() ? 0.8 : 0.45;
      reasons.push('acao derivada de comando explicitado');
      break;
    case 'large_file':
      score = 0.95;
      reasons.push('diagnostico consultivo por tamanho');
      break;
    default:
      score = 0.6;
      reasons.push('heuristica geral');
      break;
  }

  if (severityRank(issue && issue.severity) >= 3) {
    score += 0.04;
  } else if (severityRank(issue && issue.severity) === 2) {
    score += 0.02;
  }

  if (DOCUMENTATION_KINDS.has(kind) && metadata.symbolName) {
    reasons.push(`simbolo ${metadata.symbolName}`);
  }

  const normalizedScore = Math.max(0, Math.min(0.99, Number(score.toFixed(2))));
  return {
    score: normalizedScore,
    label: normalizedScore >= 0.85 ? 'high' : normalizedScore >= 0.65 ? 'medium' : 'low',
    reasons,
  };
}

function annotateIssuesWithConfidence(issues = []) {
  // Entrada: lista de issues | Saida: mesma lista com confidence e prioridade calculada.
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    if (!issue || typeof issue !== 'object') {
      return issue;
    }
    const confidence = issueConfidence(issue);
    return {
      ...issue,
      confidence,
      autofixPriority: semanticPriorityForIssue({
        ...issue,
        confidence,
      }),
    };
  });
}

function semanticPriorityForIssue(issue) {
  const kind = String(issue && issue.kind || '').trim();
  const action = resolveIssueAction(issue);
  const confidence = issue && issue.confidence && typeof issue.confidence === 'object'
    ? issue.confidence
    : issueConfidence(issue);
  const message = String(issue && issue.message || '');
  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};

  let priority = fixPriorityForKind(kind);
  priority -= severityRank(issue && issue.severity) * 18;

  if (String(action.op || '') === 'replace_line') {
    priority -= 3;
  } else if (String(action.op || '') === 'write_file') {
    priority += 4;
  } else if (String(action.op || '') === 'run_command') {
    priority += 10;
  }

  if (kind === 'undefined_variable' && /^(?:undefined_variable:\s*)?Import '([^']+)' nao exportado por /.test(message)) {
    priority -= 7;
  }
  if (kind === 'missing_dependency') {
    priority -= 4;
  }
  if (kind === 'context_contract' && metadata.returnExpression) {
    priority -= 3;
  }
  if (kind === 'flow_comment') {
    priority += 6;
  }
  if (kind === 'variable_doc' && metadata.insideClass) {
    priority -= 2;
  }

  if (confidence.label === 'low') {
    priority += 18;
  } else if (confidence.label === 'medium') {
    priority += 6;
  }

  return priority;
}

function semanticCommentPriorityForIssue(issue) {
  const basePriority = semanticPriorityForIssue(issue);
  const kind = String(issue && issue.kind || '').trim();
  if (!DOCUMENTATION_KINDS.has(kind)) {
    return basePriority;
  }

  const metadata = issue && issue.metadata && typeof issue.metadata === 'object'
    ? issue.metadata
    : {};
  const projectMemory = loadProjectMemory(issue && issue.file || '');
  const symbolName = String(metadata.symbolName || '').trim().toLowerCase();
  const contextText = [
    symbolName,
    String(metadata.enclosingClassName || metadata.containerClassName || ''),
    String(metadata.annotation || ''),
    String(metadata.rhs || ''),
    String(metadata.currentStep || ''),
    String(metadata.previousStep || ''),
    String(metadata.nextStep || ''),
    String(metadata.returnExpression || ''),
    ...(Array.isArray(metadata.bodyPreview) ? metadata.bodyPreview : []),
    ...(Array.isArray(metadata.signaturePreview) ? metadata.signaturePreview : []),
  ].join(' ').toLowerCase();
  const projectTerms = extractProjectTerms(projectMemory);

  let priority = basePriority;
  if (kind === 'function_doc') {
    priority -= 6;
  } else if (kind === 'class_doc') {
    priority -= 5;
  } else if (kind === 'variable_doc') {
    priority -= metadata.insideClass ? 3 : 1;
  } else if (kind === 'flow_comment') {
    priority += 3;
  }

  if (contextTouchesProjectTerms(contextText, projectTerms)) {
    priority -= 7;
  }
  if (/room|invite|chat|session|payload|socket|client|participant|message|runtime|state/.test(contextText)) {
    priority -= 4;
  }
  if (COMMENT_NOISE_SYMBOLS.has(symbolName) || /_(?:id|name|label|value|count|status)$/.test(symbolName)) {
    priority += 10;
  }
  if (kind === 'flow_comment' && /^(?:return|pass|continue|break)\b/.test(String(metadata.currentStep || '').trim().toLowerCase())) {
    priority += 8;
  }

  return priority;
}

function autoFixNoOpReason(issue, options = {}) {
  // Entrada: issue + opcoes | Saida: string com razao de bloqueio, vazia quando aplicavel.
  const kind = String(issue && issue.kind || '').trim();
  const confidence = issue && issue.confidence && typeof issue.confidence === 'object'
    ? issue.confidence
    : issueConfidence(issue);
  const action = resolveIssueAction(issue);

  if (kind === 'ai_required') {
    return 'Cobertura offline ainda nao inclui resolucao automatica para este fluxo';
  }
  if (kind === 'large_file') {
    return 'diagnostico consultivo sem auto-fix';
  }
  if (String(action.op || '') === 'run_command' && options.autoMode && kind !== 'terminal_task') {
    return 'execucao de terminal exige confirmacao explicita do fluxo do editor';
  }

  if (kind === 'undefined_variable' && confidence.score < 0.8) {
    return 'evidencia insuficiente para renomear simbolo automaticamente';
  }

  if (DOCUMENTATION_KINDS.has(kind) && confidence.score < readDocumentationAutoFixMinConfidence()) {
    return 'contexto insuficiente para comentario automatico confiavel';
  }

  if (['context_contract', 'functional_reassignment', 'nested_condition'].includes(kind) && confidence.score < 0.7) {
    return 'refactor semantico com confianca insuficiente para auto-fix';
  }

  if (['context_file', 'unit_test', 'unit_test_signature'].includes(kind) && confidence.score < 0.6) {
    return 'geracao estrutural com confianca insuficiente para aplicar automaticamente';
  }

  return '';
}

function shouldAutoFixIssue(issue, options = {}) {
  return autoFixNoOpReason(issue, options) === '';
}

function buildIssueConfidenceReport(issues = []) {
  const report = {
    total: 0,
    labels: {
      high: 0,
      medium: 0,
      low: 0,
    },
    kinds: {},
    languages: {},
  };

  (Array.isArray(issues) ? issues : []).forEach((issue) => {
    if (!issue || typeof issue !== 'object') {
      return;
    }
    const confidence = issue && issue.confidence && typeof issue.confidence === 'object'
      ? issue.confidence
      : issueConfidence(issue);
    const kind = String(issue.kind || '').trim() || 'unknown';

    report.total += 1;
    report.labels[confidence.label] = Number(report.labels[confidence.label] || 0) + 1;
    if (!report.kinds[kind]) {
      report.kinds[kind] = {
        count: 0,
        averageScore: 0,
        labels: { high: 0, medium: 0, low: 0 },
      };
    }
    report.kinds[kind].count += 1;
    report.kinds[kind].averageScore += confidence.score;
    report.kinds[kind].labels[confidence.label] += 1;

    const language = languageKeyForIssue(issue);
    if (!report.languages[language]) {
      report.languages[language] = {
        count: 0,
        averageScore: 0,
        labels: { high: 0, medium: 0, low: 0 },
      };
    }
    report.languages[language].count += 1;
    report.languages[language].averageScore += confidence.score;
    report.languages[language].labels[confidence.label] += 1;
  });

  Object.keys(report.kinds).forEach((kind) => {
    const entry = report.kinds[kind];
    entry.averageScore = entry.count > 0
      ? Number((entry.averageScore / entry.count).toFixed(2))
      : 0;
  });

  Object.keys(report.languages).forEach((language) => {
    const entry = report.languages[language];
    entry.averageScore = entry.count > 0
      ? Number((entry.averageScore / entry.count).toFixed(2))
      : 0;
  });

  return report;
}

function languageKeyForIssue(issue) {
  const extension = path.extname(String(issue && issue.file || '')).toLowerCase();
  switch (extension) {
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.ex':
    case '.exs':
      return 'elixir';
    case '.go':
      return 'go';
    case '.rs':
      return 'rust';
    case '.rb':
      return 'ruby';
    case '.lua':
      return 'lua';
    case '.vim':
      return 'vim';
    case '.c':
    case '.h':
      return 'c';
    case '.md':
      return 'markdown';
    case '.tf':
      return 'terraform';
    case '.yaml':
    case '.yml':
      return 'yaml';
    case '.toml':
      return 'toml';
    case '.mmd':
      return 'mermaid';
    case '.sh':
      return 'shell';
    default:
      return extension ? extension.replace(/^\./, '') : 'unknown';
  }
}

function extractProjectTerms(projectMemory) {
  const source = [
    String(projectMemory && projectMemory.entity || ''),
    String(projectMemory && projectMemory.readmeSummary || ''),
    String(projectMemory && projectMemory.contextSummary || ''),
    String(projectMemory && projectMemory.projectName || ''),
  ]
    .join(' ')
    .toLowerCase();
  const stopwords = new Set([
    'with',
    'this',
    'that',
    'from',
    'para',
    'com',
    'sem',
    'and',
    'the',
    'flow',
    'fluxo',
    'principal',
    'projeto',
    'module',
    'modulo',
  ]);

  return Array.from(new Set(
    source
      .split(/[^a-z0-9_]+/)
      .map((token) => String(token || '').trim())
      .filter((token) => token.length >= 4 && !stopwords.has(token)),
  ));
}

function contextTouchesProjectTerms(contextText, projectTerms) {
  const normalized = String(contextText || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return (Array.isArray(projectTerms) ? projectTerms : []).some((term) => normalized.includes(term));
}

module.exports = {
  annotateIssuesWithConfidence,
  autoFixNoOpReason,
  buildIssueConfidenceReport,
  issueConfidence,
  semanticCommentPriorityForIssue,
  semanticPriorityForIssue,
  shouldAutoFixIssue,
};
