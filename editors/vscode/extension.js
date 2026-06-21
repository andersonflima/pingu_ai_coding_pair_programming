'use strict';

// Extensao fina do VS Code: inicia o servidor LSP do Pingu (`pingu lsp`) e
// delega tudo a ele — diagnosticos e quick fixes vem do mesmo motor de analise
// usado pelo CLI e pelo plugin de Neovim. Toda a logica vive no servidor; aqui
// so fazemos a fiacao do cliente LSP.

const { workspace, window } = require('vscode');
const { LanguageClient, TransportKind } = require('vscode-languageclient/node');

// Linguagens em que o Pingu publica diagnosticos.
const DOCUMENT_LANGUAGES = [
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
  'python',
  'go',
  'rust',
  'ruby',
  'elixir',
  'lua',
  'c',
  'cpp',
  'shellscript',
  'php',
  'java',
  'csharp',
];

let client;

function activate() {
  const config = workspace.getConfiguration('pingu');
  const command = config.get('serverCommand') || 'pingu';
  const args = config.get('serverArgs') || ['lsp'];

  const serverOptions = {
    run: { command, args, transport: TransportKind.stdio },
    debug: { command, args, transport: TransportKind.stdio },
  };

  const clientOptions = {
    documentSelector: DOCUMENT_LANGUAGES.map((language) => ({ scheme: 'file', language })),
    outputChannelName: 'Pingu',
  };

  client = new LanguageClient('pingu', 'Pingu', serverOptions, clientOptions);
  client.start().catch((error) => {
    const detail = error && error.message ? error.message : String(error);
    window.showErrorMessage(`Pingu: falha ao iniciar o servidor LSP ("${command} ${args.join(' ')}"). ${detail}`);
  });
}

function deactivate() {
  return client ? client.stop() : undefined;
}

module.exports = { activate, deactivate };
