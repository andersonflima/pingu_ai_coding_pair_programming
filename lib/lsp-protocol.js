'use strict';

// Funcoes puras do protocolo LSP (JSON-RPC 2.0 sobre stdio): framing de
// mensagens com Content-Length, parsing incremental e mapeamento de uma issue
// do Pingu para um Diagnostic do LSP. Sem efeito colateral nem I/O, para serem
// testaveis isoladamente; o loop de I/O vive no lsp-server.

const SERVER_NAME = 'pingu';

// LSP DiagnosticSeverity: 1 Error, 2 Warning, 3 Information, 4 Hint.
function severityToLsp(severity) {
  switch (String(severity || '').toLowerCase()) {
    case 'error':
      return 1;
    case 'warning':
      return 2;
    case 'hint':
      return 4;
    default:
      return 3;
  }
}

// Serializa uma mensagem JSON-RPC com o cabecalho Content-Length (em bytes).
function encodeMessage(message) {
  const json = JSON.stringify(message);
  const length = Buffer.byteLength(json, 'utf8');
  return `Content-Length: ${length}\r\n\r\n${json}`;
}

// Extrai as mensagens completas de um Buffer acumulado, devolvendo as mensagens
// parseadas e o restante ainda nao consumido. Content-Length e contado em bytes,
// por isso o fatiamento usa o Buffer diretamente.
function extractMessages(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ''), 'utf8');
  const messages = [];
  let offset = 0;

  while (offset < input.length) {
    const headerEnd = input.indexOf('\r\n\r\n', offset);
    if (headerEnd < 0) {
      break;
    }
    const header = input.toString('utf8', offset, headerEnd);
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      offset = headerEnd + 4;
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (input.length < bodyStart + length) {
      break;
    }
    const body = input.toString('utf8', bodyStart, bodyStart + length);
    try {
      messages.push(JSON.parse(body));
    } catch (_error) {
      // mensagem malformada: ignora e segue para a proxima.
    }
    offset = bodyStart + length;
  }

  return { messages, rest: input.slice(offset) };
}

// Capabilities anunciadas no initialize: sincronizacao de documento completa
// (1 = Full), notificacao de save com texto, e suporte a code actions.
function buildInitializeResult(version) {
  return {
    capabilities: {
      textDocumentSync: {
        openClose: true,
        change: 1,
        save: { includeText: true },
      },
      codeActionProvider: true,
    },
    serverInfo: {
      name: SERVER_NAME,
      version: String(version || ''),
    },
  };
}

// Converte uma issue do Pingu num Diagnostic do LSP. `lineText` (opcional) ajusta
// o fim do range para o tamanho real da linha quando a issue nao informa coluna.
function issueToDiagnostic(issue, lineText) {
  const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);
  const hasCol = Number.isInteger(issue && issue.col) && issue.col > 0;
  const startChar = hasCol ? issue.col - 1 : 0;
  const lineLength = typeof lineText === 'string' ? lineText.length : 0;
  const endChar = Math.max(startChar + 1, lineLength);

  const baseMessage = String((issue && issue.message) || '').trim();
  const suggestion = String((issue && issue.suggestion) || '').trim();
  const message = suggestion ? `${baseMessage} — ${suggestion}` : baseMessage;

  return {
    range: {
      start: { line: lineNumber, character: startChar },
      end: { line: lineNumber, character: endChar },
    },
    severity: severityToLsp(issue && issue.severity),
    source: SERVER_NAME,
    code: String((issue && issue.kind) || ''),
    message,
  };
}

// Monta o array de Diagnostics do LSP a partir das issues e das linhas do texto.
function issuesToDiagnostics(issues, lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  return (Array.isArray(issues) ? issues : []).map((issue) => {
    const idx = Math.max(0, (Number(issue && issue.line) || 1) - 1);
    return issueToDiagnostic(issue, safeLines[idx]);
  });
}

// Notificacao textDocument/publishDiagnostics.
function publishDiagnosticsNotification(uri, diagnostics) {
  return {
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri,
      diagnostics: Array.isArray(diagnostics) ? diagnostics : [],
    },
  };
}

// Converte a acao de uma issue (replace_line/insert_before com snippet) num
// TextEdit do LSP. Outras operacoes ou snippet vazio nao geram edit.
function issueToTextEdit(issue, lines) {
  const op = issue && issue.action && issue.action.op;
  const snippet = String((issue && issue.snippet) || '');
  if (!snippet) {
    return null;
  }
  const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);
  const safeLines = Array.isArray(lines) ? lines : [];
  const currentLine = typeof safeLines[lineNumber] === 'string' ? safeLines[lineNumber] : '';

  if (op === 'replace_line') {
    return {
      range: {
        start: { line: lineNumber, character: 0 },
        end: { line: lineNumber, character: currentLine.length },
      },
      newText: snippet,
    };
  }
  if (op === 'insert_before') {
    return {
      range: {
        start: { line: lineNumber, character: 0 },
        end: { line: lineNumber, character: 0 },
      },
      newText: `${snippet}\n`,
    };
  }
  return null;
}

// Constroi uma CodeAction (quickfix) com WorkspaceEdit a partir de uma issue.
function issueToCodeAction(issue, uri, lines) {
  const edit = issueToTextEdit(issue, lines);
  if (!edit) {
    return null;
  }
  const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);
  const safeLines = Array.isArray(lines) ? lines : [];
  return {
    title: `Pingu: ${String((issue && issue.message) || 'corrigir')}`,
    kind: 'quickfix',
    diagnostics: [issueToDiagnostic(issue, safeLines[lineNumber])],
    edit: { changes: { [uri]: [edit] } },
  };
}

// CodeActions para as issues cuja linha cai dentro do range solicitado.
function issuesToCodeActions(issues, uri, lines, range) {
  const startLine = range && range.start ? Number(range.start.line) : 0;
  const endLine = range && range.end ? Number(range.end.line) : Number.MAX_SAFE_INTEGER;
  return (Array.isArray(issues) ? issues : [])
    .filter((issue) => {
      const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);
      return lineNumber >= startLine && lineNumber <= endLine;
    })
    .map((issue) => issueToCodeAction(issue, uri, lines))
    .filter(Boolean);
}

function responseMessage(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, errorMessage) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message: String(errorMessage || 'Erro interno') },
  };
}

module.exports = {
  SERVER_NAME,
  severityToLsp,
  encodeMessage,
  extractMessages,
  buildInitializeResult,
  issueToDiagnostic,
  issuesToDiagnostics,
  issueToTextEdit,
  issueToCodeAction,
  issuesToCodeActions,
  publishDiagnosticsNotification,
  responseMessage,
  errorResponse,
};
