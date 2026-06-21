# Pingu para VS Code

Extensao fina que roda o Pingu dentro do VS Code falando com o servidor LSP do
proprio Pingu (`pingu lsp`). Os diagnosticos e os quick fixes vem do mesmo motor
de analise usado pelo CLI e pelo plugin de Neovim — esta extensao apenas faz a
fiacao do cliente LSP.

> O **core** do Pingu continua zero-dependencia. A unica dependencia
> (`vscode-languageclient`) vive isolada neste subpacote e e o cliente LSP
> padrao de qualquer extensao do VS Code.

## Pre-requisito

O comando `pingu` precisa estar acessivel (no `PATH`):

```bash
npm install -g github:andersonflima/pingu_ai_coding_pair_programming
pingu lsp   # deve abrir e ficar aguardando (Ctrl+C para sair)
```

Se preferir nao instalar globalmente, aponte a extensao para o binario local em
**Settings → Pingu → Server Command** (`pingu.serverCommand`), por exemplo
`/caminho/para/pingu_dev_agent.js` com `pingu.serverArgs` = `["--lsp"]`, ou
`node` com args `["/caminho/para/pingu_dev_agent.js", "--lsp"]`.

## Rodar em desenvolvimento

```bash
cd editors/vscode
npm install
```

No VS Code, abra a pasta `editors/vscode` e pressione `F5` para iniciar o
**Extension Development Host**; abra um arquivo de uma linguagem suportada e os
diagnosticos do Pingu devem aparecer, com quick fixes (lampada) onde houver
correcao sugerida.

## Empacotar e instalar (.vsix)

```bash
cd editors/vscode
npm install
npx @vscode/vsce package
code --install-extension pingu-vscode-*.vsix
```

## Configuracao

| Setting | Padrao | Descricao |
| --- | --- | --- |
| `pingu.serverCommand` | `pingu` | Comando que inicia o servidor LSP. |
| `pingu.serverArgs` | `["lsp"]` | Argumentos passados ao comando. |

## Linguagens

JavaScript/TypeScript (e React), Python, Go, Rust, Ruby, Elixir, Lua, C/C++,
Shell, PHP, Java e C#. A lista de gatilho esta em `activationEvents` no
`package.json`.
