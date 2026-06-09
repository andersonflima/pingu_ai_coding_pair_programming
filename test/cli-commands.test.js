'use strict';

const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const cliPath = path.join(__dirname, '..', 'pingu_dev_agent.js');
const cliEnv = {
  ...process.env,
  PINGU_AI_MODE: 'off',
  PINGU_CODEX_DISABLED: '1',
  PINGU_CLAUDE_DISABLED: '1',
  PINGU_COPILOT_DISABLED: '1',
  PINGU_OPENAI_DISABLED: '1',
};

function runCli(args, input = '') {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: cliEnv,
    input,
  });
}

function runCliInCwd(args, cwd, input = '') {
  return execFileSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: 'utf8',
    env: cliEnv,
    input,
  });
}

function spawnCli(args, input = '') {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    env: cliEnv,
    input,
  });
}

test('CLI analyze subcommand reads stdin and returns analyzer JSON', () => {
  const output = runCli(
    ['analyze', '--stdin', '--source-path', 'sample.js', '--json', '--analysis-mode', 'light'],
    'if (total == expected) {\n  return total\n}\n',
  );
  const issues = JSON.parse(output);

  assert.ok(issues.some((issue) => issue.kind === 'loose_equality'));
});

test('legacy stdin flags continue to work for editor runtime compatibility', () => {
  const output = runCli(
    ['--stdin', '--source-path', 'sample.py', '--json', '--analysis-mode', 'light'],
    'if value == None:\n    return value\n',
  );
  const issues = JSON.parse(output);

  assert.ok(issues.some((issue) => issue.kind === 'none_comparison'));
});

test('CLI taxonomy exposes mapped developer error families', () => {
  const output = runCli(['taxonomy', '--json']);
  const payload = JSON.parse(output);

  assert.ok(Array.isArray(payload.families));
  assert.ok(payload.families.some((family) => family.id === 'nullability_and_equality'));
});

test('CLI doctor reports runtime status without requiring OpenAI configuration', () => {
  const output = runCli(['doctor', '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.ok, true);
  assert.ok(payload.checks.some((check) => check.name === 'node'));
  assert.ok(payload.context);
  assert.ok(payload.context.file.endsWith(path.join('.pingu', 'context.md')));
  assert.equal(payload.offlineCoverage.percent, 100);
  assert.ok(payload.activeLanguages.includes('javascript'));
});

test('CLI context creates project context document', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-context-'));
  fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
    name: 'sample-app',
    scripts: {
      check: 'node --check index.js',
      test: 'node --test',
    },
  }));

  const output = runCliInCwd(['context', '--write', '--json'], tempDir);
  const payload = JSON.parse(output);
  const contextFile = path.join(fs.realpathSync(tempDir), '.pingu', 'context.md');

  assert.equal(payload.created, true);
  assert.equal(payload.file, contextFile);
  assert.equal(payload.suggestions.checkCommand, 'npm run check');
  assert.match(fs.readFileSync(contextFile, 'utf8'), /check_command: npm run check/);
});

test('CLI offline reports full offline coverage for active languages', () => {
  const output = runCli(['offline', '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.ok, true);
  assert.equal(payload.percent, 100);
  assert.ok(payload.languages.some((language) => language.id === 'elixir'));
});

test('CLI profile reports analyzer timing cases', () => {
  const output = runCli(['profile', '--lines', '12', '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.ok, true);
  assert.equal(payload.caseCount, 2);
  assert.ok(payload.results.every((result) => result.durationMs >= 0));
});

test('CLI init writes conservative project configuration', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-init-'));
  const output = runCliInCwd(['init', '--json'], tempDir);
  const payload = JSON.parse(output);
  const configFile = path.join(fs.realpathSync(tempDir), '.pingu', 'config.json');
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

  assert.equal(payload.created, true);
  assert.equal(payload.file, configFile);
  assert.equal(config.targetScope, 'current_file');
  assert.equal(config.terminal.riskMode, 'safe');
});

test('CLI fix previews candidates without writing by default', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-plan-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, 'function compare(total, expected) {\n  return total == expected;\n}\n');

  const output = runCli(['fix', sourceFile, '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.mode, 'plan');
  assert.equal(payload.written, false);
  assert.equal(payload.candidateCount, 1);
  assert.equal(fs.readFileSync(sourceFile, 'utf8').includes('total == expected'), true);
});

test('CLI fix writes applicable high-confidence local fixes with --write', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-write-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, 'function compare(total, expected) {\n  return total == expected;\n}\n');

  const output = runCli(['fix', sourceFile, '--write', '--json']);
  const payload = JSON.parse(output);
  const updated = fs.readFileSync(sourceFile, 'utf8');

  assert.equal(payload.mode, 'write');
  assert.equal(payload.written, true);
  assert.equal(payload.appliedCount, 1);
  assert.equal(updated.includes('total === expected'), true);
});

test('CLI fix does not apply comment_task generation by default', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-comment-task-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, '//:: funcao soma\n');

  const output = runCli(['fix', sourceFile, '--write', '--json']);
  const payload = JSON.parse(output);
  const updated = fs.readFileSync(sourceFile, 'utf8');

  assert.equal(payload.candidateCount, 0);
  assert.equal(payload.appliedCount, 0);
  assert.equal(updated, '//:: funcao soma\n');
});

test('CLI prompts applies actionable comment prompts only when --write is present', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-prompts-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, '//:: funcao soma\n');

  const planOutput = runCli(['prompts', sourceFile, '--json']);
  const planPayload = JSON.parse(planOutput);

  assert.equal(planPayload.mode, 'plan');
  assert.equal(planPayload.candidateCount, 1);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), '//:: funcao soma\n');

  const writeOutput = runCli(['prompts', sourceFile, '--write', '--json']);
  const writePayload = JSON.parse(writeOutput);
  const updated = fs.readFileSync(sourceFile, 'utf8');

  assert.equal(writePayload.mode, 'write');
  assert.equal(writePayload.appliedCount, 1);
  assert.equal(updated.includes('function soma'), true);
  assert.equal(updated.includes('//:: funcao soma'), false);
});

test('CLI prompts --check returns 1 when actionable prompts exist and does not write', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-prompts-check-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, '//:: funcao soma\n');

  const result = spawnCli(['prompts', sourceFile, '--check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.check, true);
  assert.equal(payload.candidateCount, 1);
  assert.equal(fs.readFileSync(sourceFile, 'utf8'), '//:: funcao soma\n');
});

test('CLI comments alias maps to prompts command', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-comments-alias-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, '//:: funcao soma\n');

  const output = runCli(['comments', sourceFile, '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.mode, 'plan');
  assert.equal(payload.candidateCount, 1);
});

test('CLI prompts supports Elixir comment prompts', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-elixir-prompts-'));
  const sourceFile = path.join(tempDir, 'calculator.ex');
  fs.writeFileSync(sourceFile, '#:: funcao soma\n');

  const output = runCli(['prompts', sourceFile, '--write', '--json']);
  const payload = JSON.parse(output);
  const updated = fs.readFileSync(sourceFile, 'utf8');

  assert.equal(payload.mode, 'write');
  assert.equal(payload.appliedCount, 1);
  assert.equal(updated.includes('defmodule Calculator do'), true);
  assert.equal(updated.includes('@spec soma'), true);
  assert.equal(updated.includes('def soma'), true);
  assert.equal(updated.includes('#:: funcao soma'), false);
});

test('CLI analyze accepts multiple files and directories', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-analyze-many-'));
  const firstFile = path.join(tempDir, 'first.js');
  const nestedDir = path.join(tempDir, 'nested');
  const secondFile = path.join(nestedDir, 'second.py');
  fs.mkdirSync(nestedDir, { recursive: true });
  fs.writeFileSync(firstFile, 'if (total == expected) {\n  return total\n}\n');
  fs.writeFileSync(secondFile, 'if value == None:\n    return value\n');

  const output = runCli(['analyze', tempDir, '--json', '--analysis-mode', 'light']);
  const issues = JSON.parse(output);

  assert.ok(issues.some((issue) => issue.file === firstFile && issue.kind === 'loose_equality'));
  assert.ok(issues.some((issue) => issue.file === secondFile && issue.kind === 'none_comparison'));
});

test('CLI fix writes multiple files from a directory target', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-many-'));
  const firstFile = path.join(tempDir, 'first.js');
  const secondFile = path.join(tempDir, 'second.py');
  fs.writeFileSync(firstFile, 'if (total == expected) {\n  return total\n}\n');
  fs.writeFileSync(secondFile, 'def normalize(value):\n    if value == None:\n        return value\n    return value\n');

  const output = runCli(['fix', tempDir, '--write', '--json']);
  const payload = JSON.parse(output);

  assert.equal(payload.fileCount, 2);
  assert.equal(payload.appliedCount, 2);
  assert.equal(fs.readFileSync(firstFile, 'utf8').includes('total === expected'), true);
  assert.equal(fs.readFileSync(secondFile, 'utf8').includes('value is None'), true);
});

test('CLI fix --check returns 1 when applicable fixes exist and does not write', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-check-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, 'if (total == expected) {\n  return total\n}\n');

  const result = spawnCli(['fix', sourceFile, '--check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(payload.check, true);
  assert.equal(payload.candidateCount, 1);
  assert.equal(fs.readFileSync(sourceFile, 'utf8').includes('total == expected'), true);
});

test('CLI fix --check returns 0 when no applicable fixes exist', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-fix-check-clean-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  fs.writeFileSync(sourceFile, 'if (total === expected) {\n  return total\n}\n');

  const result = spawnCli(['fix', sourceFile, '--check', '--json']);
  const payload = JSON.parse(result.stdout);

  assert.equal(result.status, 0);
  assert.equal(payload.check, true);
  assert.equal(payload.candidateCount, 0);
});
