'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { createLspServer, uriToPath } = require('../lib/lsp-server');

test('uriToPath decodifica file:// e mantem caminhos simples', () => {
  assert.equal(uriToPath('file:///tmp/a%20b.js'), '/tmp/a b.js');
  assert.equal(uriToPath('/tmp/plain.js'), '/tmp/plain.js');
});

test('initialize responde com capabilities e serverInfo', () => {
  const server = createLspServer({ version: '9.9.9' });
  const out = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
  assert.equal(out[0].result.serverInfo.version, '9.9.9');
});

test('didOpen analisa e publica diagnostics', () => {
  const server = createLspServer();
  const out = server.handle({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///x.js', text: 'function f(a,b,c){\n  return a < b < c;\n}\n' } },
  });
  assert.equal(out[0].method, 'textDocument/publishDiagnostics');
  assert.ok(out[0].params.diagnostics.some((d) => d.code === 'chained_comparison'));
});

test('didChange reanalisa com o texto completo mais recente', () => {
  const server = createLspServer();
  server.handle({
    jsonrpc: '2.0',
    method: 'textDocument/didOpen',
    params: { textDocument: { uri: 'file:///x.js', text: 'const x = 1;\n' } },
  });
  const out = server.handle({
    jsonrpc: '2.0',
    method: 'textDocument/didChange',
    params: { textDocument: { uri: 'file:///x.js' }, contentChanges: [{ text: 'function f(a,b,c){\n  return a < b < c;\n}\n' }] },
  });
  assert.ok(out[0].params.diagnostics.some((d) => d.code === 'chained_comparison'));
});

test('didClose limpa os diagnostics do documento', () => {
  const server = createLspServer();
  server.handle({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.js', text: 'function f(a,b,c){\n  return a < b < c;\n}\n' } } });
  const out = server.handle({ jsonrpc: '2.0', method: 'textDocument/didClose', params: { textDocument: { uri: 'file:///x.js' } } });
  assert.deepEqual(out[0].params.diagnostics, []);
});

test('codeAction devolve quickfix para a issue no range', () => {
  const server = createLspServer();
  server.handle({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.js', text: 'function f(a,b,c){\n  return a < b < c;\n}\n' } } });
  const out = server.handle({
    jsonrpc: '2.0',
    id: 5,
    method: 'textDocument/codeAction',
    params: { textDocument: { uri: 'file:///x.js' }, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } } },
  });
  const actions = out[0].result;
  assert.ok(actions.length >= 1);
  assert.match(actions[0].edit.changes['file:///x.js'][0].newText, /a < b && b < c/);
});

test('initialize anuncia hoverProvider', () => {
  const server = createLspServer();
  const caps = server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })[0].result.capabilities;
  assert.equal(caps.hoverProvider, true);
});

test('hover devolve a explicacao do kind na linha do diagnostico', () => {
  const server = createLspServer();
  server.handle({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.js', text: 'function f(a,b,c){\n  return a < b < c;\n}\n' } } });
  const out = server.handle({ jsonrpc: '2.0', id: 7, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///x.js' }, position: { line: 1, character: 10 } } });
  assert.equal(out[0].result.contents.kind, 'markdown');
  assert.match(out[0].result.contents.value, /chained_comparison/);
  assert.match(out[0].result.contents.value, /Por que|Como corrigir/);
});

test('hover devolve null fora de qualquer diagnostico', () => {
  const server = createLspServer();
  server.handle({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.js', text: 'const x = 1;\n' } } });
  // Linha bem alem do documento: nenhum diagnostico corresponde.
  const out = server.handle({ jsonrpc: '2.0', id: 8, method: 'textDocument/hover', params: { textDocument: { uri: 'file:///x.js' }, position: { line: 99, character: 0 } } });
  assert.equal(out[0].result, null);
});

test('shutdown e exit encerram o ciclo', () => {
  const server = createLspServer();
  assert.equal(server.handle({ jsonrpc: '2.0', id: 9, method: 'shutdown' })[0].result, null);
  assert.equal(server.handle({ jsonrpc: '2.0', method: 'exit' })[0].__exit, true);
});

test('analise que lanca excecao nao derruba o servidor', () => {
  const server = createLspServer({ analyzeText: () => { throw new Error('boom'); } });
  const out = server.handle({ jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri: 'file:///x.js', text: 'x' } } });
  assert.deepEqual(out[0].params.diagnostics, []);
});
