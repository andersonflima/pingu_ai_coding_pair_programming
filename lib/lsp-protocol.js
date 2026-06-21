'use strict';

// Funcoes puras do protocolo LSP (JSON-RPC 2.0 sobre stdio): framing de
// mensagens com Content-Length, parsing incremental e mapeamento de uma issue
// do Pingu para um Diagnostic/CodeAction do LSP. Sem efeito colateral nem I/O,
// para serem testaveis isoladamente; o loop de I/O vive no lsp-server.

const path = require('path');

const SERVER_NAME = 'pingu';

// Converte um file:// URI em caminho de sistema, e vice-versa.
function uriToPath(uri) {
  const source = String(uri || '');
  if (!source.startsWith('file://')) {
    return source;
  }
  const withoutScheme = source.replace(/^file:\/\//, '');
  try {
    return decodeURIComponent(withoutScheme);
  } catch (_error) {
    return withoutScheme;
  }
}

function pathToUri(filePath) {
  const resolved = path.resolve(String(filePath || ''));
  const encoded = resolved.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  return `file://${encoded}`;
}

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
      hoverProvider: true,
    },
    serverInfo: {
      name: SERVER_NAME,
      version: String(version || ''),
    },
  };
}

// Markdown do hover de uma issue: a mensagem, e — quando houver explicacao
// curada do kind — o porque e o como corrigir. Da ao dev o contexto inline.
function issueHoverMarkdown(issue, explanation) {
  const kind = String((issue && issue.kind) || '');
  const message = String((issue && issue.message) || '').trim();
  const lines = [`**Pingu — \`${kind}\`**`, '', message];
  if (explanation) {
    if (explanation.why) {
      lines.push('', `**Por que:** ${explanation.why}`);
    }
    if (explanation.fix) {
      lines.push('', `**Como corrigir:** ${explanation.fix}`);
    }
  } else {
    const suggestion = String((issue && issue.suggestion) || '').trim();
    if (suggestion) {
      lines.push('', `**Como corrigir:** ${suggestion}`);
    }
  }
  return lines.join('\n');
}

// Resposta textDocument/hover com conteudo em markdown e range opcional.
function hoverResponse(id, markdown, range) {
  const hover = { contents: { kind: 'markdown', value: String(markdown || '') } };
  if (range) {
    hover.range = range;
  }
  return responseMessage(id, hover);
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

// Converte a acao in-document de uma issue num TextEdit do LSP, espelhando a
// semantica (baseada em linha) do aplicador do CLI. Cobre delete_line,
// replace_line, insert_before, insert_after e replace_range. write_file e tratado
// a parte (cria/sobrescreve outro arquivo); run_command nao vira edit.
function issueToTextEdit(issue, lines) {
  const action = (issue && issue.action) || {};
  const op = String(action.op || '');
  const snippet = String((issue && issue.snippet) || '');
  const safeLines = Array.isArray(lines) ? lines : [];
  const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);
  const currentLine = typeof safeLines[lineNumber] === 'string' ? safeLines[lineNumber] : '';

  if (op === 'delete_line') {
    // Remove a linha inteira, incluindo a quebra: [linha,0] -> [linha+1,0].
    return {
      range: {
        start: { line: lineNumber, character: 0 },
        end: { line: lineNumber + 1, character: 0 },
      },
      newText: '',
    };
  }
  if (!snippet) {
    return null;
  }
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
  if (op === 'insert_after') {
    return {
      range: {
        start: { line: lineNumber, character: currentLine.length },
        end: { line: lineNumber, character: currentLine.length },
      },
      newText: `\n${snippet}`,
    };
  }
  if (op === 'replace_range') {
    const range = action.range || {};
    const rawStart = Number(range.start && range.start.line);
    const rawEnd = Number(range.end && range.end.line);
    const startLine = Number.isFinite(rawStart) ? Math.max(0, Math.floor(rawStart)) : lineNumber;
    const endLine = Number.isFinite(rawEnd) ? Math.max(startLine + 1, Math.floor(rawEnd)) : lineNumber + 1;
    return {
      range: {
        start: { line: startLine, character: 0 },
        end: { line: endLine, character: 0 },
      },
      newText: `${snippet}\n`,
    };
  }
  return null;
}

// WorkspaceEdit para write_file: cria (ou sobrescreve) o arquivo alvo com o
// conteudo do snippet — usado para gerar testes/documentos de contexto.
function writeFileWorkspaceEdit(issue, sourceUri) {
  const action = (issue && issue.action) || {};
  const snippet = String((issue && issue.snippet) || '');
  const targetFile = String(action.target_file || '').trim();
  if (!targetFile) {
    return null;
  }
  const targetUri = targetFile.startsWith('file://')
    ? targetFile
    : (path.isAbsolute(targetFile)
      ? pathToUri(targetFile)
      : pathToUri(path.join(path.dirname(uriToPath(sourceUri)), targetFile)));

  return {
    documentChanges: [
      { kind: 'create', uri: targetUri, options: { overwrite: true, ignoreIfExists: false } },
      {
        textDocument: { uri: targetUri, version: null },
        edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: snippet }],
      },
    ],
  };
}

// Constroi uma CodeAction (quickfix) com WorkspaceEdit a partir de uma issue.
function issueToCodeAction(issue, uri, lines) {
  const op = String((issue && issue.action && issue.action.op) || '');
  const safeLines = Array.isArray(lines) ? lines : [];
  const lineNumber = Math.max(0, (Number(issue && issue.line) || 1) - 1);

  let edit = null;
  if (op === 'write_file') {
    edit = writeFileWorkspaceEdit(issue, uri);
  } else {
    const textEdit = issueToTextEdit(issue, lines);
    if (textEdit) {
      edit = { changes: { [uri]: [textEdit] } };
    }
  }
  if (!edit) {
    return null;
  }

  return {
    title: `Pingu: ${String((issue && issue.message) || 'corrigir')}`,
    kind: 'quickfix',
    diagnostics: [issueToDiagnostic(issue, safeLines[lineNumber])],
    edit,
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
  uriToPath,
  pathToUri,
  severityToLsp,
  encodeMessage,
  extractMessages,
  buildInitializeResult,
  issueToDiagnostic,
  issuesToDiagnostics,
  issueToTextEdit,
  writeFileWorkspaceEdit,
  issueToCodeAction,
  issuesToCodeActions,
  issueHoverMarkdown,
  hoverResponse,
  publishDiagnosticsNotification,
  responseMessage,
  errorResponse,
};
