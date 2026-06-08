'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { analyzeText } = require('./analyzer');
const { evaluateAutofixGuard } = require('./autofix-guard');
const { fixFile } = require('./cli-fix');
const { promptFile } = require('./cli-prompts');
const { resolveCliTargetFiles } = require('./cli-targets');
const { resolveLspDiagnosticFix } = require('./lsp-ai-fix');
const { resolvePromptTask } = require('./prompt-task');
const { renderVim, renderText, renderSuccessOrText, renderJson } = require('./support');
const { developerErrorFamilies } = require('./developer-error-taxonomy');
const { activeLanguageIds, languageCapabilityRegistry } = require('./language-capabilities');
const { offlineCoverageReport } = require('./offline-coverage');
const { buildAnalyzerProfileReport } = require('./analyzer-profile');
const { initProjectConfig } = require('./project-config');
const { createAiProvider } = require('./ai-provider');
const {
  parseArgs,
  positionalArgs,
} = require('./cli-args');

const DEFAULT_MAX_LINE_LENGTH = 120;

function main(rawArgs = process.argv.slice(2)) {
  const cliCommand = resolveCliCommand(rawArgs);

  if (cliCommand) {
    runCliCommand(cliCommand, rawArgs.slice(1));
  } else {
    runLegacyRuntime(rawArgs);
  }
}

function runLegacyRuntime(rawRuntimeArgs) {
  const args = parseArgs(rawRuntimeArgs);
  if (args.help) {
    renderHelp();
    return;
  }
  if (!args.guardMode && !args.lspAiFixMode && !args.promptTaskMode && !args.analyze && !args.stdin && !args.serveMode) {
    process.exit(1);
  }

  if (args.serveMode) {
    startServer();
  } else if (args.guardMode) {
    const rawPayload = fs.readFileSync(0, 'utf8');
    const payload = String(rawPayload || '').trim() ? JSON.parse(rawPayload) : {};
    renderJson(evaluateAutofixGuard(payload));
  } else if (args.lspAiFixMode) {
    const rawPayload = fs.readFileSync(0, 'utf8');
    const payload = String(rawPayload || '').trim() ? JSON.parse(rawPayload) : {};
    renderJson(resolveLspDiagnosticFix(payload));
  } else if (args.promptTaskMode) {
    const rawPayload = fs.readFileSync(0, 'utf8');
    const payload = String(rawPayload || '').trim() ? JSON.parse(rawPayload) : {};
    renderJson(resolvePromptTask(payload));
  } else {
    runAnalyze(args);
  }
}

function runAnalyze(args) {
  const sourcePath = args.sourcePath || args.analyze || args.file || 'stdin';
  const content = args.stdin || sourcePath === 'stdin'
    ? fs.readFileSync(0, 'utf8')
    : fs.readFileSync(sourcePath, 'utf8');
  const issues = analyzeText(sourcePath, content, {
    maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
    analysisMode: args.analysisMode,
    focusStartLine: args.focusStartLine,
    focusEndLine: args.focusEndLine,
  });

  if (args.output === 'vim') {
    renderVim(issues);
  } else if (args.output === 'json') {
    renderJson(issues);
  } else if (args.output === 'text') {
    renderText(issues);
  } else {
    renderSuccessOrText(issues);
  }
}

function resolveCliCommand(rawArgs) {
  const first = String(rawArgs && rawArgs[0] || '').trim();
  if (!first || first.startsWith('-')) {
    return '';
  }
  const normalized = first.toLowerCase();
  if (['analyze', 'a', 'fix', 'f', 'prompts', 'prompt', 'comments', 'comment', 'p', 'taxonomy', 'offline', 'profile', 'init', 'doctor', 'help'].includes(normalized)) {
    return normalized === 'a' ? 'analyze' : normalized;
  }
  return '';
}

function runCliCommand(command, commandArgs) {
  if (command === 'help') {
    renderHelp();
    return;
  }
  if (command === 'analyze') {
    const commandInput = resolveCliCommandInputs(commandArgs);
    if (!commandInput.args.stdin && !commandInput.args.analyze && commandInput.positionals.length > 0) {
      runAnalyzeTargets(commandInput.positionals, commandInput.args);
      return;
    }
    if (!commandInput.args.analyze && !commandInput.args.stdin && commandInput.positionals.length === 0) {
      process.stderr.write('Uso: pingu analyze <arquivo...> [--json|--format text]\n');
      process.exit(1);
    }
    runAnalyze(commandInput.args);
    return;
  }
  if (command === 'fix' || command === 'f') {
    const commandInput = resolveCliCommandInputs(commandArgs);
    const targets = commandInput.targets;
    if (targets.length === 0) {
      process.stderr.write('Uso: pingu fix <arquivo...> [--write|--check] [--json]\n');
      process.exit(1);
    }
    runFixTargets(targets, commandInput.args);
    return;
  }
  if (command === 'prompts' || command === 'prompt' || command === 'comments' || command === 'comment' || command === 'p') {
    const commandInput = resolveCliCommandInputs(commandArgs);
    const targets = commandInput.targets;
    if (targets.length === 0) {
      process.stderr.write('Uso: pingu prompts <arquivo...> [--write|--check] [--json]\n');
      process.exit(1);
    }
    runPromptTargets(targets, commandInput.args);
    return;
  }
  if (command === 'taxonomy') {
    renderTaxonomy(resolveCliCommandInputs(commandArgs).args);
    return;
  }
  if (command === 'offline') {
    renderOfflineCoverage(resolveCliCommandInputs(commandArgs).args);
    return;
  }
  if (command === 'profile') {
    renderProfile(resolveCliCommandInputs(commandArgs).args);
    return;
  }
  if (command === 'init') {
    renderInit(resolveCliCommandInputs(commandArgs).args);
    return;
  }
  if (command === 'doctor') {
    renderDoctor(resolveCliCommandInputs(commandArgs).args);
    return;
  }

  renderHelp();
}

function firstPositionalArg(rawArgs) {
  const positionals = positionalArgs(rawArgs);
  return positionals[0] || '';
}

function resolveCliCommandInputs(rawArgs) {
  const args = parseArgs(rawArgs);
  const positionals = positionalArgs(rawArgs);
  const targets = args.analyze ? [args.analyze] : positionals;
  return {
    args,
    positionals,
    targets,
  };
}

function runFix(targetFile, args) {
  const result = fixFile(targetFile, {
    analysisMode: args.analysisMode || 'light',
    focusStartLine: args.focusStartLine,
    focusEndLine: args.focusEndLine,
    kinds: args.kinds,
    maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
    minConfidence: args.minConfidence,
    write: args.write === true,
  });

  if (args.output === 'json') {
    renderJson(formatFixResult(result));
    return;
  }

  renderFixText(result);
}

function runFixTargets(targets, args) {
  const targetFiles = resolveCliTargetFiles(targets);
  if (targetFiles.length === 0) {
    process.stderr.write('Nenhum arquivo suportado encontrado para fix.\n');
    process.exit(1);
  }

  const results = targetFiles.map((targetFile) => fixFile(targetFile, {
    analysisMode: args.analysisMode || 'light',
    focusStartLine: targetFiles.length === 1 ? args.focusStartLine : undefined,
    focusEndLine: targetFiles.length === 1 ? args.focusEndLine : undefined,
    kinds: args.kinds,
    maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
    minConfidence: args.minConfidence,
    write: args.write === true,
  }));
  renderFixResults(results, args);

  if (args.check && results.some((result) => result.plan.candidates.length > 0)) {
    process.exitCode = 1;
    return;
  }
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

function runAnalyzeTargets(targets, args) {
  const targetFiles = resolveCliTargetFiles(targets);
  if (targetFiles.length === 0) {
    process.stderr.write('Nenhum arquivo suportado encontrado para analyze.\n');
    process.exit(1);
  }

  const issues = targetFiles.flatMap((targetFile) => {
    const content = fs.readFileSync(targetFile, 'utf8');
    return analyzeText(targetFile, content, {
      maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
      analysisMode: args.analysisMode,
    });
  });

  if (args.output === 'json') {
    renderJson(issues);
  } else if (args.output === 'text') {
    renderText(issues);
  } else {
    renderSuccessOrText(issues);
  }
}

function runPromptTargets(targets, args) {
  const targetFiles = resolveCliTargetFiles(targets);
  if (targetFiles.length === 0) {
    process.stderr.write('Nenhum arquivo suportado encontrado para prompts.\n');
    process.exit(1);
  }

  const results = targetFiles.map((targetFile) => promptFile(targetFile, {
    analysisMode: args.analysisMode || 'full',
    focusStartLine: targetFiles.length === 1 ? args.focusStartLine : undefined,
    focusEndLine: targetFiles.length === 1 ? args.focusEndLine : undefined,
    maxLineLength: Number.isFinite(args.maxLineLength) ? args.maxLineLength : DEFAULT_MAX_LINE_LENGTH,
    write: args.write === true,
  }));
  renderPromptResults(results, args);

  if (args.check && results.some((result) => result.plan.candidates.length > 0)) {
    process.exitCode = 1;
    return;
  }
  if (results.some((result) => !result.ok)) {
    process.exitCode = 1;
  }
}

function renderFixResults(results, args) {
  if (args.output === 'json') {
    if (results.length === 1) {
      renderJson({
        ...formatFixResult(results[0]),
        check: Boolean(args.check),
      });
      return;
    }
    renderJson({
      ok: results.every((result) => result.ok),
      mode: args.write ? 'write' : 'plan',
      check: Boolean(args.check),
      fileCount: results.length,
      candidateCount: results.reduce((total, result) => total + result.plan.candidates.length, 0),
      appliedCount: results.reduce((total, result) => total + result.appliedIssues.length, 0),
      writtenCount: results.filter((result) => result.written).length,
      results: results.map(formatFixResult),
    });
    return;
  }

  console.log(`Pingu fix ${args.write ? 'write' : 'plan'}`);
  console.log(`- arquivos: ${results.length}`);
  console.log(`- candidatos: ${results.reduce((total, result) => total + result.plan.candidates.length, 0)}`);
  console.log(`- aplicados: ${results.reduce((total, result) => total + result.appliedIssues.length, 0)}`);
  if (args.check) {
    console.log('- modo check: falha quando houver candidato aplicavel');
  } else if (!args.write) {
    console.log('- escrita: desativada; use --write para aplicar');
  }
  if (results.length === 1) {
    renderFixText(results[0]);
    return;
  }
  results
    .filter((result) => result.plan.candidates.length > 0 || result.appliedIssues.length > 0 || !result.ok)
    .forEach((result) => {
      renderFixText(result);
    });
}

function renderPromptResults(results, args) {
  if (args.output === 'json') {
    const payload = {
      ok: results.every((result) => result.ok),
      mode: args.write ? 'write' : 'plan',
      check: Boolean(args.check),
      fileCount: results.length,
      candidateCount: results.reduce((total, result) => total + result.plan.candidates.length, 0),
      appliedCount: results.reduce((total, result) => total + result.appliedIssues.length, 0),
      writtenFiles: Array.from(new Set(results.flatMap((result) => result.writtenFiles || []))),
      results: results.map(formatPromptResult),
    };
    renderJson(results.length === 1 ? { ...formatPromptResult(results[0]), check: Boolean(args.check) } : payload);
    return;
  }

  console.log(`Pingu prompts ${args.write ? 'write' : 'plan'}`);
  console.log(`- arquivos: ${results.length}`);
  console.log(`- prompts: ${results.reduce((total, result) => total + result.plan.candidates.length, 0)}`);
  console.log(`- aplicados: ${results.reduce((total, result) => total + result.appliedIssues.length, 0)}`);
  if (args.check) {
    console.log('- modo check: falha quando houver prompt aplicavel');
  } else if (!args.write) {
    console.log('- escrita: desativada; use --write para aplicar');
  }
  results
    .filter((result) => result.plan.candidates.length > 0 || result.appliedIssues.length > 0 || !result.ok)
    .forEach(renderPromptText);
}

function formatPromptResult(result) {
  return {
    ok: result.ok,
    file: result.file,
    mode: result.mode,
    candidateCount: result.plan.candidates.length,
    appliedCount: result.appliedIssues.length,
    writtenFiles: result.writtenFiles || [],
    candidates: result.plan.candidates.map((candidate) => summarizeIssue(candidate.issue)),
    applied: result.appliedIssues.map(summarizeIssue),
    rejected: (result.rejectedIssues || []).map(summarizeIssue),
    guard: result.guard,
  };
}

function renderPromptText(result) {
  console.log(`Pingu prompts: ${result.file}`);
  console.log(`- prompts: ${result.plan.candidates.length}`);
  console.log(`- aplicados: ${result.appliedIssues.length}`);
  (result.writtenFiles || []).forEach((file) => {
    console.log(`  - escrito: ${file}`);
  });
  result.plan.candidates.forEach((candidate) => {
    const issue = candidate.issue;
    console.log(`  - ${issue.line} ${issue.kind}: ${issue.suggestion || issue.message}`);
  });
  if (result.guard && !result.guard.ok) {
    console.log('- guard: falhou; alteracoes revertidas');
  }
}

function formatFixResult(result) {
  return {
    ok: result.ok,
    file: result.file,
    mode: result.mode,
    written: result.written,
    writtenFiles: result.writtenFiles || [],
    candidateCount: result.plan.candidates.length,
    appliedCount: result.appliedIssues.length,
    candidates: result.plan.candidates.map((candidate) => summarizeIssue(candidate.issue)),
    applied: result.appliedIssues.map(summarizeIssue),
    rejected: (result.rejectedIssues || []).map(summarizeIssue),
    guard: result.guard,
  };
}

function summarizeIssue(issue) {
  return {
    file: issue.file,
    line: issue.line,
    kind: issue.kind,
    severity: issue.severity,
    message: issue.message,
    suggestion: issue.suggestion,
    snippet: issue.snippet || '',
    action: issue.action || {},
    confidence: issue.confidence || null,
  };
}

function renderFixText(result) {
  const prefix = result.mode === 'write' ? 'fix' : 'fix plan';
  console.log(`Pingu ${prefix}: ${result.file}`);
  console.log(`- candidatos: ${result.plan.candidates.length}`);
  console.log(`- aplicados: ${result.appliedIssues.length}`);
  if (result.mode !== 'write') {
    console.log('- escrita: desativada; use --write para aplicar');
  } else {
    console.log(`- escrita: ${result.written ? 'arquivo atualizado' : 'sem mudancas gravadas'}`);
  }
  (result.writtenFiles || []).forEach((file) => {
    console.log(`  - arquivo gravado: ${file}`);
  });
  result.plan.candidates.forEach((candidate) => {
    const issue = candidate.issue;
    console.log(`  - ${issue.line} ${issue.kind}: ${issue.message}`);
  });
  if (result.guard && !result.guard.ok) {
    console.log('- guard: falhou; alteracoes revertidas');
  }
}

function renderTaxonomy(args) {
  const payload = {
    families: developerErrorFamilies(),
  };

  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu developer error taxonomy');
  payload.families.forEach((family) => {
    const autoFix = family.safeAutoFix ? 'auto-fix seguro' : 'assistido/consultivo';
    console.log(`- ${family.id}: ${autoFix}`);
    console.log(`  kinds: ${family.mappedIssueKinds.join(', ')}`);
    console.log(`  linguagens: ${family.languages.join(', ')}`);
  });
}

function renderDoctor(args) {
  const checks = buildDoctorChecks();
  const offlineCoverage = offlineCoverageReport();
  const payload = {
    ok: checks.every((check) => check.ok) && offlineCoverage.ok,
    checks,
    offlineCoverage,
    activeLanguages: activeLanguageIds(),
  };

  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu doctor');
  checks.forEach((check) => {
    console.log(`- ${check.ok ? 'ok' : 'erro'} ${check.name}: ${check.message}`);
  });
  console.log(`- cobertura offline: ${offlineCoverage.percent}%`);
  console.log(`- linguagens ativas: ${payload.activeLanguages.join(', ')}`);
}

function renderOfflineCoverage(args) {
  const payload = offlineCoverageReport();
  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu offline coverage');
  console.log(`- cobertura: ${payload.percent}%`);
  payload.languages.forEach((language) => {
    const missing = language.features
      .filter((feature) => !feature.offline)
      .map((feature) => feature.feature);
    console.log(`- ${language.id}: ${language.ok ? 'offline' : `faltando ${missing.join(', ')}`}`);
  });
}

function renderProfile(args) {
  const payload = buildAnalyzerProfileReport({
    lineCount: args.profileLines,
  });

  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu analyzer profile');
  console.log('- mode: local-fallback');
  console.log(`- casos: ${payload.caseCount}`);
  console.log(`- duracao total: ${payload.totalDurationMs}ms`);
  payload.results.forEach((result) => {
    console.log(`- ${result.name}: ${result.durationMs}ms, ${result.lineCount} linhas, ${result.issueCount} issue(s)`);
  });
}

function renderInit(args) {
  const payload = initProjectConfig({
    cwd: process.cwd(),
    force: args.force === true,
  });

  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu init');
  if (payload.created) {
    console.log(`- config criada: ${payload.file}`);
  } else if (payload.overwritten) {
    console.log(`- config sobrescrita: ${payload.file}`);
  } else {
    console.log(`- config existente: ${payload.file}`);
    console.log('- use --force para recriar');
  }
}

function buildDoctorChecks() {
  const aiProvider = createAiProvider();
  const providerMode = aiProvider.readProviderMode(process.env);
  const providerName = aiProvider.activeProviderName(process.env);
  const providerAvailable = aiProvider.hasOpenAiConfiguration(process.env);
  const supportedLanguageCount = languageCapabilityRegistry()
    .filter((entry) => entry.id !== 'default')
    .length;
  return [
    {
      name: 'node',
      ok: true,
      message: process.version,
    },
    {
      name: 'runtime',
      ok: fs.existsSync(path.join(__dirname, '..', 'pingu_dev_agent.js')),
      message: path.join(__dirname, '..', 'pingu_dev_agent.js'),
    },
    {
      name: 'languages',
      ok: supportedLanguageCount > 0,
      message: `${supportedLanguageCount} linguagem(ns) mapeada(s)`,
    },
    {
      name: 'ai_provider_mode',
      ok: ['auto', 'openai', 'copilot', 'codex'].includes(providerMode),
      message: providerMode,
    },
    {
      name: 'ai_provider',
      ok: true,
      message: providerAvailable ? providerName : `${providerName} (indisponivel)`,
    },
  ];
}

function renderHelp() {
  console.log([
    'Pingu CLI',
    '',
    'Uso:',
    '  pingu analyze <arquivo...> [--json|--format text|--format vim]',
    '  pingu analyze --stdin --source-path <arquivo> [--json]',
    '  pingu fix <arquivo...> [--write|--check] [--json]',
    '  pingu prompts <arquivo...> [--write|--check] [--json]',
    '  pingu taxonomy [--json]',
    '  pingu offline [--json]',
    '  pingu profile [--lines 180] [--json]',
    '  pingu init [--force] [--json]',
    '  pingu doctor [--json]',
    '',
    'Compatibilidade do runtime da IDE:',
    '  pingu_dev_agent.js --analyze <arquivo> --json',
    '  pingu_dev_agent.js --stdin --source-path <arquivo> --json',
    '  pingu_dev_agent.js --serve',
    '  pingu_dev_agent.js --autofix-guard',
    '  pingu_dev_agent.js --lsp-ai-fix',
  ].join('\n'));
}

function startServer() {
  const lineReader = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  lineReader.on('line', (line) => {
    const trimmed = String(line || '').trim();
    if (!trimmed) {
      return;
    }

    let request = null;
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      writeServerResponse({
        id: null,
        ok: false,
        error: String(error && error.message || error || 'Falha ao interpretar request'),
      });
      return;
    }

    handleServerRequest(request);
  });
}

function handleServerRequest(request) {
  const responseId = request && Object.prototype.hasOwnProperty.call(request, 'id')
    ? request.id
    : null;

  try {
    const command = String(request && request.command || 'analyze').trim();
    if (command === 'guard') {
      writeServerResponse({
        id: responseId,
        ok: true,
        result: evaluateAutofixGuard(request && request.payload ? request.payload : {}),
      });
      return;
    }
    if (command === 'lsp_ai_fix') {
      writeServerResponse({
        id: responseId,
        ok: true,
        result: resolveLspDiagnosticFix(request && request.payload ? request.payload : {}),
      });
      return;
    }
    if (command === 'prompt_task') {
      writeServerResponse({
        id: responseId,
        ok: true,
        result: resolvePromptTask(request && request.payload ? request.payload : {}),
      });
      return;
    }

    const sourcePath = String(request && request.sourcePath || request && request.filePath || 'stdin');
    const text = String(request && request.text || '');
    const issues = analyzeText(sourcePath, text, {
      maxLineLength: Number.isFinite(request && request.maxLineLength)
        ? request.maxLineLength
        : DEFAULT_MAX_LINE_LENGTH,
      analysisMode: request && request.analysisMode,
      focusStartLine: request && request.focusStartLine,
      focusEndLine: request && request.focusEndLine,
    });

    writeServerResponse({
      id: responseId,
      ok: true,
      issues,
    });
  } catch (error) {
    writeServerResponse({
      id: responseId,
      ok: false,
      error: String(error && error.stack || error && error.message || error || 'Falha inesperada'),
    });
  }
}

function writeServerResponse(response) {
  process.stdout.write(`${JSON.stringify(response)}\n`);
}

module.exports = {
  buildDoctorChecks,
  main,
  parseArgs,
  positionalArgs,
  resolveCliCommand,
};
