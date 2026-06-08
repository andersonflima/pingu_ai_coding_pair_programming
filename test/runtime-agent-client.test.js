'use strict';

const EventEmitter = require('events');
const { PassThrough } = require('stream');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const {
  createRuntimeAgentClient,
  createRuntimeError,
  fingerprintRuntimeEnvironment,
} = require('../lib/runtime-agent-client');

function createMockRuntime(onPayload) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('close', 0, null);
  };

  child.stdin.on('data', (chunk) => {
    const lines = String(chunk || '').split('\n').filter(Boolean);
    lines.forEach((line) => {
      let payload;
      try {
        payload = JSON.parse(line);
      } catch (_error) {
        return;
      }

      if (typeof onPayload === 'function') {
        onPayload(payload, child);
      }
    });
  });

  return child;
}

test('runtime client processa resposta de analise', async () => {
  const spawnCalls = [];
  const spawn = () => {
    const child = createMockRuntime((payload, runtime) => {
      if (String(payload && payload.command || '') !== 'analyze') {
        return;
      }
      const response = JSON.stringify({
        id: payload.id,
        ok: true,
        issues: [{ kind: 'ok', file: 'a.js' }],
      });
      runtime.stdout.write(`${response}\n`);
    });
    spawnCalls.push(child);
    return child;
  };

  const client = createRuntimeAgentClient({
    spawn,
    scriptPath: 'pingu_dev_agent.js',
    requestTimeoutMs: 120,
  });

  const issues = await client.requestAnalysis({ file: 'a.js', text: 'console.log(1);' });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'ok');
  assert.equal(spawnCalls.length, 1);
  assert.ok(fingerprintRuntimeEnvironment({ NODE_ENV: 'test', PINGU_AI_MODE: 'off', PINGU_ACTIVE_LANGUAGE_IDS: 'js' }).length > 0);
  client.dispose();
});

test('runtime client rejeita resposta com ok=false', async () => {
  const spawn = () => createMockRuntime((payload, runtime) => {
    const response = JSON.stringify({
      id: payload.id,
      ok: false,
      error: 'validation failed',
    });
    runtime.stdout.write(`${response}\n`);
  });

  const client = createRuntimeAgentClient({
    spawn,
    scriptPath: 'pingu_dev_agent.js',
    requestTimeoutMs: 120,
  });

  await assert.rejects(
    client.request({ command: 'analyze', file: 'a.js' }),
    (error) => error.code === 'PINGU_RUNTIME_ERROR' && /validation failed/.test(error.message),
  );
  client.dispose();
});

test('runtime client falha com timeout e erro estruturado', async () => {
  const spawn = () => createMockRuntime((_payload) => {});
  const client = createRuntimeAgentClient({
    spawn,
    scriptPath: 'pingu_dev_agent.js',
    requestTimeoutMs: 10,
  });

  await assert.rejects(
    client.request({ command: 'analyze', file: 'a.js' }),
    (error) => error.code === 'PINGU_RUNTIME_ERROR' && /Timeout/.test(error.message),
  );
  client.dispose();
});

test('runtime client expõe erro estruturado em createRuntimeError', () => {
  const error = createRuntimeError('boom', {
    requestId: 10,
    operation: 'timeout',
  });
  assert.equal(error.code, 'PINGU_RUNTIME_ERROR');
  assert.equal(error.requestId, 10);
  assert.equal(error.operation, 'timeout');
  assert.equal(error.message, 'boom');
});

test('runtime client roda fluxo real contra pingu_dev_agent.js --serve', async () => {
  const client = createRuntimeAgentClient({
    spawn,
    nodePath: process.execPath,
    scriptPath: path.join(__dirname, '..', 'pingu_dev_agent.js'),
    requestTimeoutMs: 3000,
    env: {
      ...process.env,
      PINGU_AI_MODE: 'off',
      NODE_ENV: 'test',
    },
  });

  const issues = await client.requestAnalysis({
    sourcePath: 'sample.js',
    text: 'if (total == expected) {\n  return total\n}\n',
  });
  assert.ok(Array.isArray(issues));
  assert.equal(issues.length > 0, true);
  assert.equal(issues.some((issue) => issue.kind === 'loose_equality'), true);
  client.dispose();
});
