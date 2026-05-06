# Contributing

## Fluxo

O repositorio atual usa `main` como branch base. Quando `develop` nao existir, abra branch de feature a partir de `main` e envie PR de volta para `main`.

Use Conventional Commits:

```bash
git commit -m "feat: adiciona perfil de analise"
```

## Validacao Local

```bash
npm ci --ignore-scripts
npm run check
npm run smoke:vim
npm run pack:check
```

## Release

1. Atualize `package.json`, `package-lock.json` e `CHANGELOG.md`.
2. Rode `npm run ci:release`.
3. Faça merge da feature.
4. O workflow publica a versao commitada, sem auto-bump no CI.

## Runtime Vim

`vim/` e a fonte canonica. Depois de alterar o runtime do editor, rode:

```bash
npm run sync:vim-runtime
npm run check:vim-runtime
```
