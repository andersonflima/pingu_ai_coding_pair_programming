'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createUnitTestCoverageChecker } = require('../lib/generation-unit-tests');
const { createCopilotAiProvider } = require('../lib/ai-provider-copilot');

// Este arquivo exercita o fluxo de IA da cobertura de testes. A analise passiva
// nao invoca IA por default; aqui ligamos o opt-in para testar o caminho com IA.
let previousAnalyzeAi;
test.before(() => {
  previousAnalyzeAi = process.env.PINGU_ANALYZE_AI;
  process.env.PINGU_ANALYZE_AI = '1';
});
test.after(() => {
  if (previousAnalyzeAi === undefined) {
    delete process.env.PINGU_ANALYZE_AI;
  } else {
    process.env.PINGU_ANALYZE_AI = previousAnalyzeAi;
  }
});

function sanitizeIdentifier(value) {
  return String(value || '').replace(/[^A-Za-z0-9_]/g, '').trim();
}

function sanitizeNaturalIdentifier(value) {
  return String(value || '').trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase();
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildJsChecker(projectRoot, policy, resolveAiGeneratedUnitTests) {
  return createUnitTestCoverageChecker({
    hasOpenAiConfiguration: () => policy.hasOpenAiConfiguration === true,
    loadActiveBlueprintContext: () => null,
    resolveAiGeneratedUnitTests,
    sanitizeIdentifier,
    sanitizeNaturalIdentifier,
    escapeRegExp,
    isJavaScriptLikeExtension: (ext) => ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'].includes(String(ext || '').toLowerCase()),
    isPythonLikeExtension: () => false,
    isGoExtension: () => false,
    isRustExtension: () => false,
    isRubyExtension: () => false,
    resolveProjectRoot: () => projectRoot,
    findUpwards: () => '',
    pathExists: fs.existsSync,
    requiresAiForFeature: () => false,
    resolveAiFeaturePolicy: () => policy,
    toPosixPath: (value) => String(value || '').split(path.sep).join('/'),
    toImportPath: (value) => value,
    upwardDepth: () => 0,
    upperFirst: (value) => String(value || '').charAt(0).toUpperCase() + String(value || '').slice(1),
  });
}

function setupSampleProject() {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-copilot-flow-'));
  const sourceFile = path.join(projectRoot, 'src', 'multiply.js');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export function multiply(a, b) { return a * b; }\n');
  return { projectRoot, sourceFile };
}

const PREFER_POLICY = {
  feature: 'unit_test',
  mode: 'prefer',
  hasOpenAiConfiguration: true,
  mustUseAi: false,
  shouldUseAi: true,
  canFallBack: true,
};

const FORCE_POLICY = {
  feature: 'unit_test',
  mode: 'force',
  hasOpenAiConfiguration: true,
  mustUseAi: true,
  shouldUseAi: true,
  canFallBack: false,
};

test('unit test coverage triggers Copilot automatically when policy is prefer and provider is available', () => {
  const { projectRoot, sourceFile } = setupSampleProject();
  const requests = [];
  const checkUnitTestCoverage = buildJsChecker(projectRoot, PREFER_POLICY, (request) => {
    requests.push(request);
    return {
      snippet: 'test("multiply", () => { expect(subject.multiply(2, 3)).toBe(6); });',
      action: {
        op: 'write_file',
        target_file: path.join(projectRoot, 'test', 'multiply.ai.test.js'),
        mkdir_p: true,
      },
    };
  });

  const issues = checkUnitTestCoverage(
    ['export function multiply(a, b) { return a * b; }'],
    sourceFile,
  );

  assert.equal(requests.length, 1, 'Copilot deve ser acionado quando policy=prefer e provider disponivel');
  assert.equal(requests[0].sourceFile, sourceFile);
  assert.ok(requests[0].testCandidates.some((candidate) => candidate.name === 'multiply'));
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'unit_test');
  assert.ok(issues[0].snippet.includes('expect(subject.multiply(2, 3)).toBe(6)'));
  assert.match(issues[0].action.target_file, /multiply\.ai\.test\.js$/);
});

test('unit test coverage falls back to offline template when Copilot returns empty snippet', () => {
  const { projectRoot, sourceFile } = setupSampleProject();
  const checkUnitTestCoverage = buildJsChecker(projectRoot, PREFER_POLICY, () => ({
    snippet: '',
    action: null,
  }));

  const issues = checkUnitTestCoverage(
    ['export function multiply(a, b) { return a * b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'unit_test');
  assert.notEqual(issues[0].kind, 'ai_required');
  assert.equal(issues[0].action.target_file, path.join(projectRoot, 'test', 'src', 'multiply.test.js'));
});

test('unit test coverage falls back to offline template when Copilot returns null', () => {
  const { projectRoot, sourceFile } = setupSampleProject();
  const checkUnitTestCoverage = buildJsChecker(projectRoot, PREFER_POLICY, () => null);

  const issues = checkUnitTestCoverage(
    ['export function multiply(a, b) { return a * b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'unit_test');
});

test('unit test coverage emits ai_required when Copilot fails under force policy', () => {
  const { projectRoot, sourceFile } = setupSampleProject();
  const checkUnitTestCoverage = buildJsChecker(projectRoot, FORCE_POLICY, () => null);

  const issues = checkUnitTestCoverage(
    ['export function multiply(a, b) { return a * b; }'],
    sourceFile,
  );

  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'ai_required');
  assert.equal(issues[0].severity, 'error');
});

test('unit test coverage skips Copilot call when source has no uncovered candidates', () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-copilot-flow-'));
  const sourceFile = path.join(projectRoot, 'src', 'noop.js');
  fs.mkdirSync(path.dirname(sourceFile), { recursive: true });
  fs.writeFileSync(sourceFile, 'export const ANSWER = 42;\n');

  const requests = [];
  const checkUnitTestCoverage = buildJsChecker(projectRoot, PREFER_POLICY, (request) => {
    requests.push(request);
    return { snippet: 'test', action: null };
  });

  const issues = checkUnitTestCoverage(['export const ANSWER = 42;'], sourceFile);

  assert.equal(requests.length, 0, 'Copilot nao deve ser acionado sem candidatos a teste');
  assert.deepEqual(issues, []);
});

test('Copilot provider probe returns false when PINGU_COPILOT_DISABLED is truthy', () => {
  const spawnCalls = [];
  const provider = createCopilotAiProvider({
    spawnSync: (...args) => {
      spawnCalls.push(args);
      return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
    },
  });

  for (const value of ['1', 'true', 'yes', 'on', 'enabled']) {
    assert.equal(
      provider.hasOpenAiConfiguration({ PINGU_COPILOT_DISABLED: value }),
      false,
      `PINGU_COPILOT_DISABLED=${value} deve desligar o provider`,
    );
  }
  assert.equal(spawnCalls.length, 0, 'probe nao pode chamar spawnSync quando provider esta desligado');
});

test('Copilot provider probe runs spawnSync when PINGU_COPILOT_DISABLED is empty or 0', () => {
  const spawnCalls = [];
  const provider = createCopilotAiProvider({
    spawnSync: (command, args) => {
      spawnCalls.push({ command, args });
      return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
    },
  });

  assert.equal(provider.hasOpenAiConfiguration({ PINGU_COPILOT_DISABLED: '' }), true);
  assert.equal(provider.hasOpenAiConfiguration({ PINGU_COPILOT_DISABLED: '0' }), true);
  assert.ok(spawnCalls.length >= 1);
  assert.equal(spawnCalls[0].command, 'copilot');
  assert.deepEqual(spawnCalls[0].args, ['--version']);
});

test('Copilot provider returns null when CLI exits with non-zero status', () => {
  const provider = createCopilotAiProvider({
    spawnSync: (command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      return { status: 1, stdout: '', stderr: 'auth error' };
    },
  });

  const result = provider.resolveAiGeneratedTask(
    { instruction: 'criar funcao' },
    {},
  );

  assert.equal(result, null);
});

test('Copilot provider returns null when CLI stdout is not valid JSON', () => {
  const provider = createCopilotAiProvider({
    spawnSync: (command, args) => {
      if (args[0] === '--version') {
        return { status: 0, stdout: 'copilot 1.0.0', stderr: '' };
      }
      return { status: 0, stdout: 'definitely not json {{{', stderr: '' };
    },
  });

  const result = provider.resolveAiGeneratedTask(
    { instruction: 'criar funcao' },
    {},
  );

  assert.equal(result, null);
});

test('Copilot provider returns null when spawnSync throws (CLI missing)', () => {
  const provider = createCopilotAiProvider({
    spawnSync: () => {
      throw new Error('command not found: copilot');
    },
  });

  assert.equal(provider.hasOpenAiConfiguration({}), false);
  assert.equal(provider.resolveAiGeneratedTask({ instruction: 'x' }, {}), null);
});

test('Copilot provider uses PINGU_COPILOT_COMMAND override for executable name', () => {
  const spawnCalls = [];
  const provider = createCopilotAiProvider({
    spawnSync: (command, args) => {
      spawnCalls.push(command);
      return { status: 0, stdout: 'mytool 1.0.0', stderr: '' };
    },
  });

  provider.hasOpenAiConfiguration({ PINGU_COPILOT_COMMAND: 'mytool' });
  assert.equal(spawnCalls[0], 'mytool');
});
