'use strict';

const { buildAnalyzerProfileReport } = require('../lib/analyzer-profile');

function parseLineCount(args) {
  const index = args.indexOf('--lines');
  if (index === -1 || !args[index + 1]) {
    return undefined;
  }
  const parsed = Number.parseInt(args[index + 1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function renderText(report) {
  process.stdout.write('Pingu analyzer profile\n');
  process.stdout.write(`- modo: ${report.aiMode}\n`);
  process.stdout.write(`- casos: ${report.caseCount}\n`);
  process.stdout.write(`- duracao total: ${report.totalDurationMs}ms\n`);
  report.results.forEach((result) => {
    process.stdout.write(
      `- ${result.name}: ${result.durationMs}ms, ${result.lineCount} linhas, ${result.issueCount} issue(s)\n`,
    );
  });
}

function run() {
  const args = process.argv.slice(2);
  const report = buildAnalyzerProfileReport({
    lineCount: parseLineCount(args),
  });

  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  renderText(report);
}

run();
