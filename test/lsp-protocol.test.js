'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const lsp = require('../lib/lsp-protocol');

test('encodeMessage usa Content-Length em bytes', () => {
  const framed = lsp.encodeMessage({ ok: true });
  assert.match(framed, /^Content-Length: 11\r\n\r\n/);
  assert.ok(framed.endsWith('{"ok":true}'));
});

test('extractMessages separa multiplas mensagens e devolve o resto', () => {
  const frame = (m) => lsp.encodeMessage(m);
  const buffer = Buffer.from(frame({ id: 1 }) + frame({ id: 2 }) + 'Content-Length: 50\r\n\r\n{partial', 'utf8');
  const { messages, rest } = lsp.extractMessages(buffer);
  assert.deepEqual(messages.map((m) => m.id), [1, 2]);
  assert.ok(rest.length > 0, 'a mensagem incompleta deve ficar no resto');
});

test('extractMessages e byte-accurate com UTF-8 multibyte', () => {
  const buffer = Buffer.from(lsp.encodeMessage({ msg: 'acentuacao çãé' }), 'utf8');
  const { messages } = lsp.extractMessages(buffer);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].msg, 'acentuacao çãé');
});

test('severityToLsp mapeia as severidades do Pingu', () => {
  assert.equal(lsp.severityToLsp('error'), 1);
  assert.equal(lsp.severityToLsp('warning'), 2);
  assert.equal(lsp.severityToLsp('info'), 3);
});

test('issueToDiagnostic converte linha 1-based e combina message+suggestion', () => {
  const diag = lsp.issueToDiagnostic(
    { line: 3, kind: 'chained_comparison', severity: 'warning', message: 'Comparacao encadeada', suggestion: 'Use &&' },
    'return a < b < c;',
  );
  assert.equal(diag.range.start.line, 2);
  assert.equal(diag.severity, 2);
  assert.equal(diag.source, 'pingu');
  assert.equal(diag.code, 'chained_comparison');
  assert.match(diag.message, /Comparacao encadeada — Use &&/);
});

test('buildInitializeResult anuncia sync completo e code actions', () => {
  const result = lsp.buildInitializeResult('1.2.3');
  assert.equal(result.capabilities.textDocumentSync.change, 1);
  assert.equal(result.capabilities.codeActionProvider, true);
  assert.equal(result.serverInfo.version, '1.2.3');
});

test('issueToCodeAction gera quickfix com WorkspaceEdit para replace_line', () => {
  const action = lsp.issueToCodeAction(
    { line: 2, kind: 'chained_comparison', message: 'Comparacao encadeada', snippet: '  return a < b && b < c;', action: { op: 'replace_line' } },
    'file:///x.js',
    ['function f(){', '  return a < b < c;', '}'],
  );
  assert.equal(action.kind, 'quickfix');
  const edit = action.edit.changes['file:///x.js'][0];
  assert.equal(edit.newText, '  return a < b && b < c;');
  assert.equal(edit.range.start.line, 1);
});

test('issueToCodeAction usa insert_before para snippet inserido acima', () => {
  const action = lsp.issueToCodeAction(
    { line: 1, kind: 'function_doc', message: 'Funcao sem doc', snippet: '// doc', action: { op: 'insert_before' } },
    'file:///x.js',
    ['function f(){}'],
  );
  const edit = action.edit.changes['file:///x.js'][0];
  assert.equal(edit.newText, '// doc\n');
  assert.deepEqual(edit.range.start, { line: 0, character: 0 });
  assert.deepEqual(edit.range.end, { line: 0, character: 0 });
});

test('issueToCodeAction retorna null sem snippet aplicavel', () => {
  assert.equal(
    lsp.issueToCodeAction({ line: 1, snippet: '', action: { op: 'insert_before' } }, 'file:///x.js', []),
    null,
  );
});

test('issueToTextEdit cobre delete_line removendo a linha inteira', () => {
  const edit = lsp.issueToTextEdit({ line: 3, action: { op: 'delete_line' } }, ['a', 'b', 'c', 'd']);
  assert.deepEqual(edit.range, { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } });
  assert.equal(edit.newText, '');
});

test('issueToTextEdit cobre insert_after no fim da linha', () => {
  const edit = lsp.issueToTextEdit({ line: 1, snippet: '// nota', action: { op: 'insert_after' } }, ['const x = 1;']);
  assert.deepEqual(edit.range.start, { line: 0, character: 12 });
  assert.equal(edit.newText, '\n// nota');
});

test('issueToTextEdit cobre replace_range por intervalo de linhas', () => {
  const edit = lsp.issueToTextEdit(
    { line: 2, snippet: 'novo', action: { op: 'replace_range', range: { start: { line: 1 }, end: { line: 3 } } } },
    ['a', 'b', 'c', 'd'],
  );
  assert.deepEqual(edit.range, { start: { line: 1, character: 0 }, end: { line: 3, character: 0 } });
  assert.equal(edit.newText, 'novo\n');
});

test('issueToCodeAction cobre write_file criando o arquivo alvo relativo', () => {
  const action = lsp.issueToCodeAction(
    { line: 1, message: 'Gerar teste', snippet: 'test("x", () => {})\n', action: { op: 'write_file', target_file: '__tests__/x.test.js' } },
    'file:///proj/src/x.js',
    ['export const x = 1;'],
  );
  const changes = action.edit.documentChanges;
  assert.equal(changes[0].kind, 'create');
  assert.equal(changes[0].uri, 'file:///proj/src/__tests__/x.test.js');
  assert.equal(changes[1].edits[0].newText, 'test("x", () => {})\n');
});

test('issueToCodeAction ignora run_command (sem WorkspaceEdit possivel)', () => {
  assert.equal(
    lsp.issueToCodeAction({ line: 1, snippet: 'npm test', action: { op: 'run_command' } }, 'file:///x.js', ['x']),
    null,
  );
});

test('writeFileWorkspaceEdit resolve target absoluto e file:// direto', () => {
  const abs = lsp.writeFileWorkspaceEdit({ snippet: 'a', action: { op: 'write_file', target_file: '/tmp/t.txt' } }, 'file:///proj/x.js');
  assert.equal(abs.documentChanges[0].uri, 'file:///tmp/t.txt');
  assert.equal(lsp.writeFileWorkspaceEdit({ snippet: 'a', action: { op: 'write_file' } }, 'file:///proj/x.js'), null);
});
