'use strict';

// Servidor Language Server Protocol do Pingu: mantem o texto dos documentos
// abertos, roda a analise (analyzeText) a cada open/change/save e publica
// Diagnostics; tambem responde code actions (quickfix) a partir das issues. O
// roteamento de mensagens (`handle`) e isolado do I/O para ser testavel; o loop
// de stdin/stdout fica em startLspServer. Um servidor LSP atende qualquer editor
// compativel (VS Code, Helix, Zed, Emacs, Sublime, Neovim nativo).

const { analyzeText } = require('./analyzer');
const { explainIssueKind } = require('./issue-explainer');
const lsp = require('./lsp-protocol');

const uriToPath = lsp.uriToPath;

function createLspServer(deps = {}) {
  const analyze = typeof deps.analyzeText === 'function' ? deps.analyzeText : analyzeText;
  const version = deps.version || '';
  const documents = new Map();

  function analyzeDocument(uri, text) {
    const source = String(text || '');
    let issues = [];
    try {
      issues = analyze(uriToPath(uri), source);
    } catch (_error) {
      issues = [];
    }
    documents.set(uri, { text: source, issues: Array.isArray(issues) ? issues : [] });
    return documents.get(uri);
  }

  function publishFor(uri) {
    const document = documents.get(uri);
    const diagnostics = document
      ? lsp.issuesToDiagnostics(document.issues, document.text.split('\n'))
      : [];
    return lsp.publishDiagnosticsNotification(uri, diagnostics);
  }

  function handle(message) {
    const method = message && message.method;
    const id = message && message.id;
    const params = (message && message.params) || {};
    const textDocument = params.textDocument || {};

    switch (method) {
      case 'initialize':
        return [lsp.responseMessage(id, lsp.buildInitializeResult(version))];
      case 'initialized':
        return [];
      case 'shutdown':
        return [lsp.responseMessage(id, null)];
      case 'exit':
        return [{ __exit: true }];
      case 'textDocument/didOpen':
        analyzeDocument(textDocument.uri, textDocument.text);
        return [publishFor(textDocument.uri)];
      case 'textDocument/didChange': {
        const changes = Array.isArray(params.contentChanges) ? params.contentChanges : [];
        const fullText = changes.length > 0 ? changes[changes.length - 1].text : '';
        analyzeDocument(textDocument.uri, fullText);
        return [publishFor(textDocument.uri)];
      }
      case 'textDocument/didSave': {
        const existing = documents.get(textDocument.uri);
        const text = typeof params.text === 'string'
          ? params.text
          : (existing ? existing.text : '');
        analyzeDocument(textDocument.uri, text);
        return [publishFor(textDocument.uri)];
      }
      case 'textDocument/didClose':
        documents.delete(textDocument.uri);
        return [lsp.publishDiagnosticsNotification(textDocument.uri, [])];
      case 'textDocument/codeAction': {
        const document = documents.get(textDocument.uri);
        const lines = document ? document.text.split('\n') : [];
        const issues = document ? document.issues : [];
        return [lsp.responseMessage(id, lsp.issuesToCodeActions(issues, textDocument.uri, lines, params.range))];
      }
      case 'textDocument/hover': {
        const document = documents.get(textDocument.uri);
        const position = params.position || {};
        const issue = document ? findIssueAtLine(document.issues, Number(position.line)) : null;
        if (!issue) {
          return [lsp.responseMessage(id, null)];
        }
        const markdown = lsp.issueHoverMarkdown(issue, explainIssueKind(issue.kind));
        return [lsp.hoverResponse(id, markdown)];
      }
      default:
        if (id !== undefined && id !== null) {
          return [lsp.responseMessage(id, null)];
        }
        return [];
    }
  }

  return { handle, analyzeDocument, documents };
}

// Primeira issue cuja linha (1-based) corresponde a linha do hover (0-based).
function findIssueAtLine(issues, zeroBasedLine) {
  if (!Number.isFinite(zeroBasedLine)) {
    return null;
  }
  return (Array.isArray(issues) ? issues : []).find((issue) => Number(issue && issue.line) - 1 === zeroBasedLine) || null;
}

function startLspServer(deps = {}) {
  const server = createLspServer(deps);
  const input = deps.input || process.stdin;
  const output = deps.output || process.stdout;
  const exit = typeof deps.exit === 'function' ? deps.exit : (code) => process.exit(code);
  let buffer = Buffer.alloc(0);

  input.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')]);
    const { messages, rest } = lsp.extractMessages(buffer);
    buffer = rest;
    for (const message of messages) {
      for (const outgoing of server.handle(message)) {
        if (outgoing && outgoing.__exit) {
          exit(0);
          return;
        }
        output.write(lsp.encodeMessage(outgoing));
      }
    }
  });

  // Encerramento gracioso quando o cliente fecha o stdin sem enviar `exit`.
  input.on('end', () => exit(0));

  return server;
}

module.exports = {
  createLspServer,
  startLspServer,
  uriToPath,
};
