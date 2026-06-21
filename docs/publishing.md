# Publicacao

Dois artefatos sao publicados de forma independente: o pacote npm (CLI + servidor
LSP) e a extensao do VS Code. A publicacao final exige credenciais suas (token do
npm, conta de publisher do marketplace) e nao e feita automaticamente.

## 1. Pacote npm (`@andersonflima/pingu-dev-agent`)

O pacote ja esta pronto: `bin.pingu`, whitelist em `files` (sem `test/`),
`repository`/`homepage`/`bugs`, e `publishConfig.access`.

```bash
# pre-voo: lint + sync de runtime + testes, e checagem de versao/tarball
npm run check
npm run pack:check          # mostra o conteudo do tarball (dry-run)
npm run release:check       # valida a versao vs CHANGELOG/tag

# autenticar e publicar (precisa do seu token/conta npm)
npm login
npm publish                 # respeita publishConfig.access
```

Depois do publish, o install global passa a funcionar e habilita o `pingu lsp`
em qualquer editor:

```bash
npm install -g @andersonflima/pingu-dev-agent
pingu doctor
pingu lsp
```

> `publishConfig.access` esta como `restricted`. Para um pacote scoped publico,
> troque para `public` antes do primeiro publish.

## 2. Extensao do VS Code (`editors/vscode`)

A extensao e um wrapper fino sobre `pingu lsp` (ver
[editors/vscode/README.md](../editors/vscode/README.md)).

```bash
cd editors/vscode
npm install                 # instala vscode-languageclient + @vscode/vsce
npx @vscode/vsce package    # gera pingu-vscode-<versao>.vsix

# testar local antes de publicar
code --install-extension pingu-vscode-*.vsix

# publicar no marketplace (precisa de publisher + Personal Access Token)
npx @vscode/vsce login andersonflima
npx @vscode/vsce publish
```

Pre-requisitos do marketplace:

- conta de **publisher** criada (o `publisher` no `package.json` deve bater);
- um **Personal Access Token** do Azure DevOps com escopo *Marketplace > Manage*;
- opcional: um `icon` (PNG 128x128) no `package.json` da extensao para a vitrine.

## Versionamento

Mantenha a versao do pacote npm e a da extensao alinhadas com o `CHANGELOG.md`.
O `npm run release:check` (e `release:prepare`) ajuda a validar a versao do pacote
principal antes de taguear.
