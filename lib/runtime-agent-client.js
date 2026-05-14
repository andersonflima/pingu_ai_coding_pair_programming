'use strict';

const crypto = require('crypto');
const readline = require('readline');
const { isBooleanEnabledValue } = require('./ai-resolution-policy');

function fingerprintRuntimeEnvironment(env = {}) {
  const relevant = {
    NODE_ENV: String(env.NODE_ENV || '').trim(),
    PINGU_AI_MODE: String(env.PINGU_AI_MODE || '').trim(),
    PINGU_ACTIVE_LANGUAGE_IDS: String(env.PINGU_ACTIVE_LANGUAGE_IDS || '').trim(),
  };
  return crypto.createHash('sha1').update(JSON.stringify(relevant)).digest('hex');
}

function createRuntimeError(message, details = {}) {
  const error = new Error(String(message || 'Falha no runtime do agente'));
  error.code = 'PINGU_RUNTIME_ERROR';
  if (Object.prototype.hasOwnProperty.call(details, 'requestId')) {
    error.requestId = details.requestId;
  }
  if (Object.prototype.hasOwnProperty.call(details, 'cause')) {
    error.cause = details.cause;
  }
  if (Object.prototype.hasOwnProperty.call(details, 'operation')) {
    error.operation = details.operation;
  }
  return error;
}

function createRuntimeAgentClient(options = {}) {
  const spawn = options.spawn;
  const nodePath = String(options.nodePath || 'node').trim() || 'node';
  const scriptPath = String(options.scriptPath || '').trim();
  const cwd = String(options.cwd || '').trim() || process.cwd();
  const env = options.env || process.env;
  const onStderr = typeof options.onStderr === 'function' ? options.onStderr : null;
  const requestTimeoutMs = Number.isFinite(Number(options.requestTimeoutMs))
    ? Number(options.requestTimeoutMs)
    : 30000;
  const debug = isBooleanEnabledValue(options.debugRuntime, false);

  let child = null;
  let lineReader = null;
  let nextRequestId = 1;
  let disposed = false;
  let pending = new Map();

  function assertStartedInputs() {
    if (!scriptPath) {
      throw createRuntimeError('Caminho do script do runtime não informado', { operation: 'bootstrap' });
    }
    if (typeof spawn !== 'function') {
      throw createRuntimeError('Factory spawn do runtime indisponível', { operation: 'bootstrap' });
    }
  }

  function closeRuntime() {
    if (lineReader) {
      lineReader.close();
      lineReader = null;
    }
    if (child && !child.killed && typeof child.kill === 'function') {
      child.kill();
    }
    child = null;
  }

  function handleResponseLine(line) {
    let message = null;
    try {
      message = JSON.parse(String(line || '').trim());
    } catch (_error) {
      if (debug && onStderr) {
        onStderr(`[PINGU_RUNTIME] resposta inválida recebida: ${String(line || '').slice(0, 200)}\n`);
      }
      return;
    }

    const requestId = Number(message && message.id);
    if (!Number.isFinite(requestId) || !pending.has(requestId)) {
      return;
    }

    const resolver = pending.get(requestId);
    pending.delete(requestId);
    if (resolver.timeoutId) {
      clearTimeout(resolver.timeoutId);
    }

    if (message && message.ok === false) {
      resolver.reject(createRuntimeError(
        String(message.error || 'Falha ao executar request no runtime'),
        { requestId, cause: message, operation: 'request' },
      ));
      return;
    }

    resolver.resolve(message);
  }

  function handleClientFailure(error) {
    const failure = error instanceof Error
      ? error
      : createRuntimeError(String(error || 'Falha no runtime do agente'), { operation: 'client_failure' });
    const pendingResolvers = Array.from(pending.values());
    pending = new Map();
    closeRuntime();
    if (onStderr && failure.message) {
      onStderr(`[PINGU_RUNTIME] ${failure.message}\n`);
    }
    pendingResolvers.forEach((resolver) => {
      if (resolver.timeoutId) {
        clearTimeout(resolver.timeoutId);
      }
      resolver.reject(failure);
    });
  }

  function scheduleRequestTimeout(requestId) {
    if (requestTimeoutMs <= 0) {
      return null;
    }
    return setTimeout(() => {
      if (!pending.has(requestId)) {
        return;
      }
      const resolver = pending.get(requestId);
      pending.delete(requestId);
      if (resolver && resolver.timeoutId) {
        resolver.timeoutId = null;
      }
      if (resolver) {
        resolver.reject(createRuntimeError(`Timeout ${requestTimeoutMs}ms na chamada ao runtime`, {
          requestId,
          operation: 'request_timeout',
        }));
      }
    }, requestTimeoutMs);
  }

  function ensureStarted() {
    if (disposed) {
      throw createRuntimeError('Runtime client descartado', { operation: 'request' });
    }

    if (child && !child.killed) {
      return child;
    }

    assertStartedInputs();

    try {
      child = spawn(nodePath, [scriptPath, '--serve'], {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw createRuntimeError('Falha ao iniciar o runtime', {
        cause: error,
        operation: 'spawn',
      });
    }
    if (!child || typeof child.stdout?.on !== 'function') {
      throw createRuntimeError('Processo de runtime sem stdout utilizável', { operation: 'runtime_bootstrap' });
    }

    lineReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    lineReader.on('line', handleResponseLine);
    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', (chunk) => {
        if (onStderr) {
          onStderr(String(chunk || ''));
        }
      });
    }
    child.on('error', (error) => {
      handleClientFailure(createRuntimeError(
        String(error && error.message || 'Erro no runtime'),
        { cause: error, operation: 'runtime_error' },
      ));
    });
    child.on('close', (code, signal) => {
      const pendingResolvers = Array.from(pending.keys());
      if (pendingResolvers.length > 0 || debug) {
        handleClientFailure(createRuntimeError(
          `Runtime do agente encerrou a conexao (code=${String(code || 'n/a')}, signal=${String(signal || 'n/a')})`,
          { operation: 'runtime_close', cause: { code, signal } },
        ));
      } else {
        closeRuntime();
      }
    });

    return child;
  }

  function normalizeRequestInput(message) {
    if (!message || typeof message !== 'object') {
      return {};
    }
    return Object.keys(message).reduce((normalized, key) => {
      const value = message[key];
      if (value === undefined) {
        return normalized;
      }
      normalized[key] = value;
      return normalized;
    }, {});
  }

  function request(message) {
    const runtime = ensureStarted();
    const requestId = nextRequestId;
    nextRequestId += 1;

    return new Promise((resolve, reject) => {
      const timeoutId = scheduleRequestTimeout(requestId);
      const payload = {
        ...normalizeRequestInput(message),
        id: requestId,
      };

      pending.set(requestId, { resolve, reject, timeoutId });
      try {
        runtime.stdin.write(`${JSON.stringify(payload)}\n`);
      } catch (error) {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        pending.delete(requestId);
        reject(createRuntimeError('Falha ao enviar request para runtime', {
          requestId,
          cause: error,
          operation: 'request_write',
        }));
      }
    });
  }

  function requestAnalysis(payload) {
    return request({
      command: 'analyze',
      ...normalizeRequestInput(payload),
    }).then((response) => (Array.isArray(response && response.issues) ? response.issues : []));
  }

  function dispose() {
    disposed = true;
    const pendingResolvers = Array.from(pending.values());
    pending = new Map();
    closeRuntime();
    pendingResolvers.forEach((resolver) => {
      if (resolver.timeoutId) {
        clearTimeout(resolver.timeoutId);
      }
      resolver.reject(createRuntimeError('Runtime client descartado', { operation: 'dispose' }));
    });
  }

  return {
    dispose,
    request,
    requestAnalysis,
  };
}

module.exports = {
  createRuntimeError,
  createRuntimeAgentClient,
  fingerprintRuntimeEnvironment,
};
