# Changelog

Todas as mudancas relevantes deste projeto devem registrar antes, depois, motivo tecnico e impacto esperado.

## 0.1.6 - Em desenvolvimento

### Antes

- O workflow de publicacao calculava uma nova versao durante o CI e publicava sem deixar essa versao persistida no repositorio.
- O pacote publicado podia ficar a frente de `package.json`, como ocorreu com npm em `0.1.5` e fonte local em `0.1.4`.
- A validacao local nao verificava se a versao declarada ja existia no npm antes do publish.
- Marcadores escapados como `\s::` e `\s*` em comentarios `//` ainda eram tratados como prompts acionaveis.

### Depois

- `package.json` e `package-lock.json` passam a declarar `0.1.6`, a proxima versao publicavel.
- O publish deve usar a versao commitada na fonte, sem auto-bump invisivel no workflow.
- `npm run release:check` falha quando a versao local ja existe no npm.
- Marcadores escapados continuam literais e nao geram `comment_task`, `context_file` ou `terminal_task`.

### Motivo

Release precisa ser rastreavel por Git, npm e changelog. O pacote publicado deve refletir exatamente o estado versionado no repositorio.

### Comportamento Alterado

- Antes: push em `main` podia publicar uma versao calculada apenas dentro do job.
- Antes: comentarios escapados podiam gerar alteracao automatica mesmo quando a intencao era manter texto literal.
- Depois: o job publica somente uma versao previamente commitada e validada, e comentarios escapados nao disparam prompts.
