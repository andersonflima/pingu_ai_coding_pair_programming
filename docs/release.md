# Release do Pingu

## Antes

O publish calculava a proxima versao dentro do workflow e executava `npm version --no-git-tag-version`. Isso publicava no npm uma versao que podia nao existir no Git.

## Depois

A versao publicada precisa estar commitada em:

- `package.json`
- `package-lock.json`
- `CHANGELOG.md`

O workflow roda `npm run ci:release`, que valida testes, pacote e colisao de versao no npm antes de publicar.

## Comandos

```bash
npm run check
npm run pack:check
npm run release:check
npm run ci:release
```

## Criterio de Aceite

- `npm run release:check` falha se a versao local ja existir no npm.
- `npm run pack:check` mostra o pacote sem gerar artefato persistente.
- O changelog explica antes, depois, motivo e comportamento alterado.
