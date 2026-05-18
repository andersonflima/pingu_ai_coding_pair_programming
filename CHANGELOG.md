# Changelog

Todas as mudancas relevantes deste projeto devem registrar antes, depois, motivo tecnico e impacto esperado.

## 0.1.37 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.36 já estava publicada.

### Depois

- A versão foi avançada para `0.1.37` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.36 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.35 já estava publicada.

### Depois

- A versão foi avançada para `0.1.36` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.35 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.34 já estava publicada.

### Depois

- A versão foi avançada para `0.1.35` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.34 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.33 já estava publicada.

### Depois

- A versão foi avançada para `0.1.34` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.33 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.32 já estava publicada.

### Depois

- A versão foi avançada para `0.1.33` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.32 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.31 já estava publicada.

### Depois

- A versão foi avançada para `0.1.32` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.31 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.30 já estava publicada.

### Depois

- A versão foi avançada para `0.1.31` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.30 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.29 já estava publicada.
- o loop realtime dependia de entrada no buffer ou edicao para disparar analise, sem gatilho dedicado de carga do arquivo.

### Depois

- A versão foi avançada para `0.1.30` com bump patch.
- o runtime agora pode disparar analise no carregamento do buffer via `BufReadPost/BufNewFile` com `g:realtime_dev_agent_realtime_on_buffer_load=1` (default).

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.
- reduzir janela sem cobertura automatica ao abrir arquivos com erro antes da primeira edicao manual.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.
- o pingu passa a iniciar analise mais cedo no arquivo aberto, melhorando chance de correção automática imediata.


## 0.1.29 - Em desenvolvimento

### Antes

- erros de sintaxe isolados podiam ficar presos em heuristica local por linguagem e nem sempre escalavam para reparo consolidado assistido.

### Depois

- o runtime passou a consolidar reparo de sintaxe por arquivo com provider assistido mesmo com uma unica issue `syntax_*` (default), mantendo fallback local quando o provider nao estiver operacional.
- Elixir ganhou deteccao dedicada para keyword `end` malformada (`eend`, `ennd`, `endd`) com auto-fix `replace_line`.

### Motivo

- reduzir lacunas de correcao automatica em pair programming e tornar a recuperacao de erros sintaticos mais resiliente em linguagens mapeadas.

### Impacto

- maior cobertura de auto-correcao para syntax errors com prioridade ao provider assistido e fallback offline preservado.


## 0.1.28 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.27 já estava publicada.

### Depois

- A versão foi avançada para `0.1.28` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.27 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.26 já estava publicada.

### Depois

- A versão foi avançada para `0.1.27` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.26 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.25 já estava publicada.

### Depois

- A versão foi avançada para `0.1.26` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.25 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.24 já estava publicada.

### Depois

- A versão foi avançada para `0.1.25` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.24 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.23 já estava publicada.

### Depois

- A versão foi avançada para `0.1.24` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.23 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.22 já estava publicada.

### Depois

- A versão foi avançada para `0.1.23` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.22 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.21 já estava publicada.

### Depois

- A versão foi avançada para `0.1.22` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.21 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.20 já estava publicada.

### Depois

- A versão foi avançada para `0.1.21` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.20 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.19 já estava publicada.

### Depois

- A versão foi avançada para `0.1.20` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.19 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.18 já estava publicada.

### Depois

- A versão foi avançada para `0.1.19` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.18 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.17 já estava publicada.

### Depois

- A versão foi avançada para `0.1.18` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.17 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.16 já estava publicada.

### Depois

- A versão foi avançada para `0.1.17` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.16 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.15 já estava publicada.

### Depois

- A versão foi avançada para `0.1.16` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.15 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.14 já estava publicada.

### Depois

- A versão foi avançada para `0.1.15` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.14 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.13 já estava publicada.

### Depois

- A versão foi avançada para `0.1.14` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.13 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.12 já estava publicada.

### Depois

- A versão foi avançada para `0.1.13` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.12 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.11 já estava publicada.

### Depois

- A versão foi avançada para `0.1.12` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.11 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.10 já estava publicada.

### Depois

- A versão foi avançada para `0.1.11` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.10 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.9 já estava publicada.

### Depois

- A versão foi avançada para `0.1.10` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.9 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.7 já estava publicada.

### Depois

- A versão foi avançada para `0.1.9` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


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
