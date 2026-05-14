# Release do Pingu

## Antes

O publish calculava a proxima versao dentro do workflow e executava `npm version --no-git-tag-version`. Isso publicava no npm uma versao que podia nao existir no Git.

## Depois

A versao publicada precisa estar commitada em:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

O fluxo atual é:

1. `npm run release:check`
2. `npm run ci:release` (quando usado no pipeline de publicação)

## Comandos

```bash
npm run check
npm run pack:check
npm run release:check
npm run ci:release
```

## Como o `release:check` se comporta hoje

- valida se a versão atual de `package.json` já existe no npm;
- se já existe, calcula a próxima versão com `patch` por padrão;
- o modo de bump pode ser alterado com `--bump patch|minor|major` (ou variável `RELEASE_BUMP`);
- `npm run release:prepare` mostra a versão sugerida sem persistir alterações;
- em modo de execução real (`release:check`), o script persiste atualização em:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md` (somente quando houve bump)
- `--safe-mode` troca consulta remota por fallback local quando houver falha de rede/consulta do npm.
- No workflow atual (`.github/workflows/npm-publish.yml`), a validação de release acontece no branch `main`; o passo de persistência registra se houve bump localmente, com proteção para cenários de branch protegida no fluxo de publicação.

## Criterio de Aceite

- `npm run release:check` falha se a versao local ja existir no npm.
- `npm run pack:check` mostra o pacote sem gerar artefato persistente.
- O changelog inclui entrada de bump com resumo do motivo.
