'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { analyzeText } = require('./analyzer');
const { evaluateAutofixGuard } = require('./autofix-guard');
const { fixFile } = require('./cli-fix');
const { promptFile } = require('./cli-prompts');
const { resolveCliTargetFiles } = require('./cli-targets');
const { renderVim, renderText, renderSuccessOrText, renderJson } = require('./support');
const { developerErrorFamilies } = require('./developer-error-taxonomy');
const { activeLanguageIds, languageCapabilityRegistry } = require('./language-capabilities');
const { offlineCoverageReport } = require('./offline-coverage');
const { buildAnalyzerProfileReport } = require('./analyzer-profile');
const { initProjectConfig } = require('./project-config');

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
  if (!args.guardMode && !args.analyze && !args.stdin && !args.serveMode) {
    process.exit(1);
  }

  if (args.serveMode) {
    startServer();
  } else if (args.guardMode) {
    const rawPayload = fs.readFileSync(0, 'utf8');
    const payload = String(rawPayload || '').trim() ? JSON.parse(rawPayload) : {};
    renderJson(evaluateAutofixGuard(payload));
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
    const args = parseArgs(commandArgs);
    const positionals = positionalArgs(commandArgs);
    if (!args.stdin && !args.analyze && positionals.length > 0) {
      runAnalyzeTargets(positionals, args);
      return;
    }
    if (!args.analyze && !args.stdin && positionals.length === 0) {
      process.stderr.write('Uso: pingu analyze <arquivo...> [--json|--format text]\n');
      process.exit(1);
    }
    runAnalyze(args);
    return;
  }
  if (command === 'fix' || command === 'f') {
    const args = parseArgs(commandArgs);
    const targets = args.analyze ? [args.analyze] : positionalArgs(commandArgs);
    if (targets.length === 0) {
      process.stderr.write('Uso: pingu fix <arquivo...> [--write|--check] [--json]\n');
      process.exit(1);
    }
    runFixTargets(targets, args);
    return;
  }
  if (command === 'prompts' || command === 'prompt' || command === 'comments' || command === 'comment' || command === 'p') {
    const args = parseArgs(commandArgs);
    const targets = args.analyze ? [args.analyze] : positionalArgs(commandArgs);
    if (targets.length === 0) {
      process.stderr.write('Uso: pingu prompts <arquivo...> [--write|--check] [--json]\n');
      process.exit(1);
    }
    runPromptTargets(targets, args);
    return;
  }
  if (command === 'taxonomy') {
    renderTaxonomy(parseArgs(commandArgs));
    return;
  }
  if (command === 'offline') {
    renderOfflineCoverage(parseArgs(commandArgs));
    return;
  }
  if (command === 'profile') {
    renderProfile(parseArgs(commandArgs));
    return;
  }
  if (command === 'init') {
    renderInit(parseArgs(commandArgs));
    return;
  }
  if (command === 'doctor') {
    renderDoctor(parseArgs(commandArgs));
    return;
  }

  renderHelp();
}

function parseArgs(rawArgs) {
  const options = {
    output: 'text',
    maxLineLength: DEFAULT_MAX_LINE_LENGTH,
    stdin: false,
    guardMode: false,
    serveMode: false,
  };
  for (let i = 0; i < rawArgs.length; i += 1) {
    const current = rawArgs[i];
    if (current === '--analyze') {
      options.analyze = rawArgs[i + 1];
      i += 1;
    } else if (current === '--source-path') {
      options.sourcePath = rawArgs[i + 1];
      i += 1;
    } else if (current === '--stdin') {
      options.stdin = true;
    } else if (current === '--vim') {
      options.output = 'vim';
    } else if (current === '--json') {
      options.output = 'json';
    } else if (current === '--max-line-length' && rawArgs[i + 1]) {
      options.maxLineLength = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    } else if (current === '--format' && rawArgs[i + 1]) {
      options.output = rawArgs[i + 1];
      i += 1;
    } else if (current === '--analysis-mode' && rawArgs[i + 1]) {
      options.analysisMode = rawArgs[i + 1];
      i += 1;
    } else if (current === '--focus-start-line' && rawArgs[i + 1]) {
      options.focusStartLine = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    } else if (current === '--focus-end-line' && rawArgs[i + 1]) {
      options.focusEndLine = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    } else if (current === '--autofix-guard') {
      options.guardMode = true;
      options.output = 'json';
    } else if (current === '--serve') {
      options.serveMode = true;
    } else if (current === '--help' || current === '-h') {
      options.help = true;
    } else if (current === '--write') {
      options.write = true;
    } else if (current === '--force') {
      options.force = true;
    } else if (current === '--with-ai') {
      options.withAi = true;
    } else if (current === '--dry-run') {
      options.write = false;
    } else if (current === '--check') {
      options.check = true;
      options.write = false;
    } else if ((current === '--kind' || current === '--kinds') && rawArgs[i + 1]) {
      options.kinds = String(rawArgs[i + 1] || '').split(',').map((item) => item.trim()).filter(Boolean);
      i += 1;
    } else if (current === '--min-confidence' && rawArgs[i + 1]) {
      options.minConfidence = Number.parseFloat(rawArgs[i + 1]);
      i += 1;
    } else if (current === '--lines' && rawArgs[i + 1]) {
      options.profileLines = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    }
  }
  return options;
}

function firstPositionalArg(rawArgs) {
  const positionals = positionalArgs(rawArgs);
  return positionals[0] || '';
}

function positionalArgs(rawArgs) {
  const args = [];
  for (let index = 0; index < rawArgs.length; index += 1) {
    const current = String(rawArgs[index] || '');
    if (!current || current.startsWith('-')) {
      if (optionConsumesNextValue(current)) {
        index += 1;
      }
      continue;
    }
    args.push(current);
  }
  return args;
}

function optionConsumesNextValue(option) {
  return [
    '--analyze',
    '--source-path',
    '--max-line-length',
    '--format',
    '--analysis-mode',
    '--focus-start-line',
    '--focus-end-line',
    '--kind',
    '--kinds',
    '--min-confidence',
    '--lines',
  ].includes(option);
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
    withAi: args.withAi === true,
  });

  if (args.output === 'json') {
    renderJson(payload);
    return;
  }

  console.log('Pingu analyzer profile');
  console.log(`- ia: ${payload.aiMode}`);
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
  const supportedLanguageCount = languageCapabilityRegistry()
    .filter((entry) => entry.id !== 'default')
    .length;
  const openAiConfigured = String(process.env.OPENAI_API_KEY || '').trim().length > 0;
  return [
    {
      name: 'node',
      ok: true,
      message: process.version,
    },
    {
      name: 'runtime',
      ok: fs.existsSync(path.join(__dirname, '..', 'realtime_dev_agent.js')),
      message: path.join(__dirname, '..', 'realtime_dev_agent.js'),
    },
    {
      name: 'openai',
      ok: true,
      message: openAiConfigured ? 'OPENAI_API_KEY configurada' : 'OPENAI_API_KEY ausente; fluxos offline continuam disponiveis',
    },
    {
      name: 'languages',
      ok: supportedLanguageCount > 0,
      message: `${supportedLanguageCount} linguagem(ns) mapeada(s)`,
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
    '  pingu profile [--lines 180] [--with-ai] [--json]',
    '  pingu init [--force] [--json]',
    '  pingu doctor [--json]',
    '',
    'Compatibilidade do runtime da IDE:',
    '  realtime_dev_agent.js --analyze <arquivo> --json',
    '  realtime_dev_agent.js --stdin --source-path <arquivo> --json',
    '  realtime_dev_agent.js --serve',
    '  realtime_dev_agent.js --autofix-guard',
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
