# Changelog

Todas as mudancas relevantes deste projeto devem registrar antes, depois, motivo tecnico e impacto esperado.

## Unreleased - Deteccao de variavel local nao utilizada

### Antes

- O Pingu detectava imports nao usados, mas nao variaveis locais declaradas e nunca lidas.

### Depois

- Novo `checkUnusedVariables` em `lib/analyzer-unused.js` (suggest-only, JavaScript/TypeScript): sinaliza variaveis locais `const`/`let` indentadas, com lado direito puro (sem chamada de funcao, `await`, `new` ou arrow) e nome nunca referenciado. Novo issue kind `unused_variable` (`autoFixDefault: false`), mapeado na familia `control_flow_and_complexity`.
- Conservador para evitar falso positivo e mudanca de comportamento: ignora declaracoes de modulo (possivelmente exportadas), nomes `_`-prefixados e qualquer lado direito com possivel efeito colateral. Python fica de fora por ora (atributos de classe exigiriam analise de escopo).

### Motivo

- Ampliar a deteccao de erros humanos com mais um check de alto sinal e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Deteccao de import nao utilizado

### Antes

- O Pingu nao detectava imports declarados e nunca usados, um erro humano comum que polui o arquivo e mantem dependencias mortas.

### Depois

- Novo modulo `lib/analyzer-unused.js` com `checkUnusedImports` suggest-only para JavaScript/TypeScript e Python: cobre named, default, namespace `* as`, `require` desestruturado e `import`/`from import`. Novo issue kind `unused_import` (`autoFixDefault: false`), mapeado na familia `imports_and_dependencies`.
- Conservador para evitar falso positivo: imports por efeito colateral (`import 'polyfill'`) sao ignorados e qualquer ocorrencia do nome (JSX, acesso a propriedade, anotacao de tipo) conta como uso.

### Motivo

- Ampliar a deteccao de erros humanos com um check de alto sinal, sem remover nada automaticamente (imports podem ter efeito colateral).

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Modularizacao: checks de higiene fora do analyzer

### Antes

- `lib/analyzer.js` concentrava tambem os checks de higiene de workspace (moduledoc ausente, linhas longas, saidas de debug, TODO/FIXME, linhas duplicadas, espaco final, tabs e arquivo grande), contribuindo para um arquivo grande demais.

### Depois

- Esses oito checks foram extraidos para `lib/analyzer-hygiene.js`, um modulo coeso com responsabilidade unica. `analyzer.js` passa a importa-los; os imports de snippet que so eram usados por eles foram removidos do arquivo principal. Comportamento preservado (mesmos kinds, mensagens e acoes).

### Motivo

- Reduzir o God file `analyzer.js` em fatia segura e isolar um dominio coeso, alinhado a filosofia de arquivos pequenos do projeto.

### Impacto

- Sem mudanca de comportamento em runtime; os checks continuam sendo exercitados pelos testes existentes, mais um smoke test direto do novo modulo.

## Unreleased - Deteccao de codigo inalcancavel e erros engolidos

### Antes

- O Pingu nao detectava dois erros humanos comuns que o compilador costuma deixar passar: codigo inalcancavel apos uma instrucao terminal e erros capturados e ignorados silenciosamente.

### Depois

- Novo modulo `lib/analyzer-control-flow.js` com dois checks suggest-only para JavaScript/TypeScript e Python:
  - `unreachable_code`: instrucao no mesmo bloco logo apos `return`/`throw`/`raise`/`break`/`continue`. Ignora terminais dentro de `if` (proxima linha com indentacao menor e alcancavel) e fronteiras de bloco (`else`/`elif`/`except`/`case`/fechamento).
  - `swallowed_error`: `catch {}` vazio em JS (inline ou multilinha) e `except ...: pass` em Python. Nao acusa quando o bloco trata ou registra o erro.
- Novos issue kinds `unreachable_code` e `swallowed_error` (`autoFixDefault: false`, sem auto-fix), mapeados nas familias `control_flow_and_complexity` e `error_handling` da taxonomia.

### Motivo

- Ampliar a deteccao de erros humanos alem do compilador, com alto sinal e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere; nenhum auto-fix novo.

## Unreleased - Lint de funcao duplicada e limpeza de codigo morto

### Antes

- O lint (`scripts/check-syntax.js`) so validava sintaxe; nada impedia a reintroducao de uma definicao de funcao duplicada no nivel do arquivo (que vira codigo morto silencioso por hoisting, como foi o caso de `levenshteinDistance`).
- Havia funcoes mortas (nunca referenciadas) em `analyzer.js`, `generation.js` e `generation-unit-tests.js`.

### Depois

- `scripts/check-syntax.js` passa a falhar quando ha funcao top-level duplicada no mesmo arquivo, com mensagem apontando as duas linhas. Check deterministico e sem dependencias, alinhado a filosofia de zero-dependencia do projeto. A funcao e exportada e coberta por testes.
- Removidas dez funcoes mortas e seus helpers exclusivos: `extractFunctionParams`, `parseGenericFunctionParams`, `hasFunctionSpecAbove` (analyzer), `executablePlaceholderStatement`, `executablePlaceholderSnippet` (generation), `collectUnitTestCallArityOperations`, `collectUnitTestInvocations`, `resolveMatchingParenRange`, `applyLineRewriteOperations`, `serializePythonLiteral` (generation-unit-tests).

### Motivo

- Prevenir uma classe de bug ja observada (definicao duplicada) e reduzir ruido/peso dos arquivos sem alterar comportamento.

### Impacto

- Sem mudanca de comportamento em runtime. Suite de testes ampliada com cobertura do novo check.

## Unreleased - Comentar codigo: Java, C#, Kotlin, Swift, Scala e PHP

### Antes

- O fluxo de comentar codigo cobria Python, JS/TS, Go, Rust, C/C++, Ruby, Elixir, Lua, Vim e Shell, mas nao Java, C#, Kotlin, Swift, Scala e PHP — essas linguagens nao estavam no registry de capacidades, entao nem geravam `comment_task`.

### Depois

- `lib/language-capabilities.js` passa a registrar Java, C#, Kotlin, Swift, Scala e PHP como linguagens ativas com `comment_task` offline (via `document_generation`), sem habilitar geracao de codigo/teste offline que essas linguagens ainda nao tem.
- `lib/generation-inline-comments.js` ganhou familias para essas seis linguagens (bloco por chaves) e um gerador de doc de fallback embutido: Javadoc/KDoc/Scaladoc/PHPDoc no estilo `/** */` e doc `///` para C# e Swift, derivado do mesmo resumo de proposito. O classificador C-style passou a reconhecer `val`/`var`/`fun`/`def` e variaveis PHP (`$x`).

### Motivo

- Completar a cobertura do recurso de comentar/documentar codigo para todas as linguagens de funcao relevantes do runtime.

### Impacto

- Aditivo: seis linguagens novas geram `comment_task` offline com doc e comentarios passo a passo; nenhuma linha de codigo e modificada pela acao. Para um arquivo dessas linguagens, apenas `comment_task` e emitido (sem ruido de outras features).

## Unreleased - Comentar codigo: todas as linguagens e melhor resumo offline

### Antes

- O fluxo de comentar codigo passo a passo so existia para Python e JavaScript/TypeScript.
- O resumo do doc descrevia o proposito a partir apenas da estrutura do corpo (defs/chamadas/atribuicoes/retorno), sem considerar a intencao expressa no nome da funcao.

### Depois

- `lib/generation-inline-comments.js` foi generalizado para um registry de linguagens com tres estrategias de bloco (chaves, indentacao e palavra-chave de fechamento `end`/`endfunction`). Passa a cobrir, offline, Python, JavaScript/TypeScript, Go, Rust, C/C++, Ruby, Elixir, Lua, Vim e Shell, cada uma com seu prefixo de comentario e convencao de doc.
- O resumo do doc agora infere a intencao pelo nome da funcao (mapa de verbos pt/en: `calcula_frete` -> "Calcula frete", `fetchUser` -> "Busca user") combinada com o retorno do corpo, caindo para o resumo estrutural quando o nome nao e um verbo conhecido.
- Seguranca preservada: o snippet reproduz o bloco verbatim e a acao continua sendo um `replace_range` local que cobre o gatilho e a funcao; deteccao de bloco imperfeita nao corrompe codigo (no pior caso comenta de menos/mais).

### Motivo

- Atender ao pedido de estender o recurso para todas as linguagens mapeadas e tornar o detalhamento da funcao mais preciso sobre o que ela faz no cenario offline.

### Impacto

- Aditivo: mais linguagens cobertas e resumos mais informativos; nenhuma linha de codigo e modificada pela acao.

## Unreleased - Comentar codigo existente passo a passo

### Antes

- O comentario acionavel `# : comment this code` era detectado, mas o gerador offline apenas ecoava a instrucao (snippet `# comment this code`), sem documentar a funcao seguinte. Na pratica o pedido nao era executado.
- Nao havia intent `comment`/`doc`/`document` no contrato de comentarios acionaveis; `@pingu comment ...` nem virava tarefa.

### Depois

- Novo modulo `lib/generation-inline-comments.js`: para um pedido de "comentar/documentar este codigo", o Pingu reconstroi a funcao seguinte ao gatilho inserindo um docstring idiomatico (docstring Python apos a assinatura, JSDoc acima da funcao em JS/TS) e um comentario factual antes de cada instrucao relevante (`# Chama use_item.`, `# Retorna planta.`). Os comentarios descrevem a sintaxe real da linha, sem inventar semantica.
- Toda linha de codigo original e preservada verbatim; a acao e um `replace_range` local que cobre o gatilho e o bloco da funcao, removendo o gatilho. O fluxo e idempotente: se a funcao ja tiver docstring e comentarios, nada e sugerido.
- Novo intent explicito `comment`/`comente`/`doc`/`document`/`documenta` no parser de `@pingu`/`pingu:`; o marcador `:` continua funcionando (`# : comment this code`, `#: comment this code`).
- Disponivel offline para Python e JavaScript/TypeScript.

### Motivo

- Corrigir o caso reportado em que o Pingu nao respeitava/executava `# : comment this code`, entregando o resultado esperado: comentar o codigo passo a passo sem altera-lo.

### Impacto

- Aditivo e seguro: o kind `comment_task` ja existia; a geracao agora produz comentarios uteis em vez de eco. Nenhuma linha de codigo e modificada pela acao.

## Unreleased - Deteccao de atribuicao acidental em condicao

### Antes

- O Pingu nao detectava o erro humano classico `if (x = y)` em JavaScript/TypeScript, que compila sem erro mas costuma ser uma comparacao pretendida.

### Depois

- Novo check `checkAssignmentInCondition` em `lib/analyzer-developer-errors.js` e novo issue kind `assignment_in_condition` (`autoFixDefault: false`, suggest-only) mapeado na familia `control_flow_and_complexity`.
- Sinaliza atribuicao de identificador/acesso dentro de `if`/`while` e sugere `===`, sem reescrever automaticamente.
- Evita falsos positivos: ignora comparacoes (`==`, `===`, `<=`, `>=`, `!=`), operadores compostos (`+=` etc.), arrow functions (`=>`), `=` dentro de strings/comentarios e o idioma de atribuicao intencional com parenteses duplos.

### Motivo

- Ampliar a cobertura de erros humanos que o compilador nao acusa, alinhado ao objetivo de o Pingu encontrar erros alem dos de compilacao.

### Impacto

- Aditivo e seguro: apenas sugere; nenhum auto-fix novo.

## Unreleased - Cobertura e atualizacao de testes opt-in

### Antes

- Os kinds `unit_test` (criar cobertura) e `unit_test_signature` (atualizar teste apos mudanca de assinatura) tinham `autoFixDefault: true` e entravam no auto-fix padrao, podendo criar ou reescrever testes sem aprovacao explicita do desenvolvedor.
- A mensagem de drift de assinatura nao identificava qual teste estava desatualizado.
- A deduplicacao de issues por `replace_range` nao considerava `target_file`, entao quando o mesmo metodo era coberto por mais de um teste apenas um aviso sobrevivia.

### Depois

- `unit_test` e `unit_test_signature` passam a `autoFixDefault: false`: o Pingu sugere, mas so cria ou atualiza o teste quando o desenvolvedor aplica a sugestao. `unit_test` tambem foi removido da whitelist de `write_file` auto-seguro no runtime Vim e da lista fallback de auto-fix.
- A mensagem de drift agora aponta o teste existente pelo nome (`Teste existente <arquivo> referencia <metodo> com assinatura antiga.`) e pergunta se o desenvolvedor quer aplicar o ajuste.
- A chave de deduplicacao de issues passou a incluir `target_file` para acoes baseadas em range, de modo que cada teste relacionado a um metodo alterado gera seu proprio aviso acionavel, mesmo quando o metodo tem mais de um teste.

### Motivo

- Atender ao pedido de tornar a criacao e a atualizacao de testes uma decisao do desenvolvedor (sugerir e perguntar, em vez de agir automaticamente), inclusive apontando os testes existentes relacionados a um metodo alterado.

### Impacto

- Mudanca de comportamento (nao breaking de API): testes deixam de ser criados/atualizados automaticamente no loop de auto-fix; a acao continua disponivel manualmente via quick-fix. Quem dependia do comportamento automatico pode reativar adicionando `unit_test`/`unit_test_signature` a `g:pingu_auto_fix_kinds`.

## Unreleased - Deteccao conservadora de erros de digitacao

### Antes

- O Pingu detectava erros humanos por um conjunto pequeno de checks (`==`/`!=` em JS, `== None`/`except:` em Python, `nil` em Ruby/Elixir). Nao havia nenhuma deteccao de erro de digitacao em palavras-chave ou builtins.
- As primitivas de similaridade (`levenshteinDistance`, `suggestSimilarIdentifier`, `collapseRepeatedChars`, `isSubsequence`) viviam dentro de `lib/analyzer.js`, com `levenshteinDistance` declarada duas vezes (a primeira definicao era codigo morto por hoisting).

### Depois

- Novo modulo `lib/identifier-similarity.js` concentra as primitivas de similaridade; `lib/analyzer.js` passa a importa-las e a definicao duplicada de `levenshteinDistance` foi removida. Comportamento preservado.
- Novo modulo `lib/analyzer-typos.js` detecta erros de digitacao em palavras-chave e builtins a partir do dicionario versionado `config/common-typos.json` (JavaScript/TypeScript, Python, Ruby, Go, Rust).
- Novo issue kind `typo` com `autoFixDefault: false`: o Pingu sugere `Voce quis dizer 'X'?`, mas nunca reescreve sozinho. A correcao so e aplicada quando o desenvolvedor aceita no editor.
- Nova familia `typo_and_naming` na taxonomia versionada de erros (`safeAutoFix: false`).
- Deteccao ignora strings e comentarios e nunca casa um typo como substring de identificador maior.

### Motivo

- Atender ao pedido de ajudar a encontrar nao so erros de compilador, mas tambem erros humanos comuns como erros de digitacao.
- Reduzir o God file `lib/analyzer.js` extraindo um modulo coeso e remover a duplicacao de `levenshteinDistance`.

### Impacto

- Aditivo e seguro: nenhum auto-fix novo: o kind `typo` apenas sugere. Cobertura de testes ampliada (modulo de similaridade e detector de typos).

## Unreleased - Simplificacao para Copilot-only (breaking)

### Antes

- O runtime suportava providers `copilot`, `codex`, `claude` e `openai`, com selector `:PinguModel` / `<leader>pim`, env vars dedicadas (`PINGU_AI_PROVIDER`, `PINGU_AI_MODEL`, `PINGU_OPENAI_*`, `PINGU_CODEX_*`, `PINGU_CLAUDE_*`, `OPENAI_API_KEY`) e prompt terminal flutuante interativo via `:PinguPrompt` sem argumento, `:PinguPromptTerminal`, `:PinguPromptClose` e `<leader>pip`.

### Depois

- Restou apenas a integracao com o GitHub Copilot CLI; o Pingu detecta automaticamente o login do `copilot` no PATH, sem variaveis obrigatorias.
- Removidos `lib/ai-provider-codex.js`, `lib/ai-provider-claude.js`, `lib/ai-provider-openai.js` e respectivos testes.
- Removidos `:PinguModel`, `:PinguPromptTerminal`, `:PinguPromptClose`, `<leader>pim`, `<leader>pip` e as funcoes/variaveis associadas no plugin Vim.
- Removidas variaveis de ambiente `PINGU_AI_PROVIDER`, `PINGU_AI_MODEL`, `PINGU_OPENAI_*`, `PINGU_CODEX_*`, `PINGU_CLAUDE_*`, `PINGU_ANTHROPIC_*`, `OPENAI_API_KEY` (do Pingu) e `PINGU_PROMPT_TERMINAL_COMMAND`.
- Mantido `:PinguPrompt <texto>` como patch direto via Copilot; sem argumento agora orienta o usuario.
- Mantidas `PINGU_COPILOT_COMMAND`, `PINGU_COPILOT_MODEL`, `PINGU_COPILOT_TIMEOUT_MS`, `PINGU_COPILOT_FAILURE_COOLDOWN_MS`, `PINGU_COPILOT_DISABLED` como alavancas de debug/CI.
- `pingu doctor` reporta apenas o estado do Copilot.
- Cobertura de testes ampliada: 258 testes (era 184), incluindo 63 cenarios multilingue para o parser de action comments e 11 cenarios cobrindo o fluxo automatico de geracao de testes via Copilot e seus modos de falha (PINGU_COPILOT_DISABLED, exit code != 0, JSON invalido, spawnSync throw, override de PINGU_COPILOT_COMMAND).

### Motivo

- Alinhar o Pingu com a intencao operacional do usuario: agente integrado nativamente ao Copilot quando ele estiver autenticado na IDE, sem exigir nenhuma configuracao extra.
- Reduzir complexidade arquitetural removendo a abstracao multi-provider que nao agregava valor pratico.
- Reduzir surface area de bugs e simplificar contratos de configuracao.

### Impacto

- Breaking change: usuarios que dependiam de `:PinguModel`, `<leader>pim`/`<leader>pip`, `:PinguPromptTerminal`, `:PinguPromptClose` ou das variaveis `PINGU_AI_PROVIDER`, `PINGU_AI_MODEL`, `PINGU_OPENAI_*`, `PINGU_CODEX_*`, `PINGU_CLAUDE_*` ou `OPENAI_API_KEY` devem migrar para o Copilot CLI autenticado.
- O fluxo automatico de geracao de testes (`unit_test`) continua disparando sem action comment quando o Copilot estiver disponivel; sem Copilot, cai para template offline.
- Diff: -1372 / +25 no runtime Vim, -958 / +39 no runtime Node, +499 linhas de novos testes.

## 0.1.44 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.43 já estava publicada.

### Depois

- A versão foi avançada para `0.1.44` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.43 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.42 já estava publicada.
- Auto-fixes calculados durante insert mode podiam ficar pendentes ate o `InsertLeave` e ainda serem aplicados mesmo quando o buffer mudava antes do `Esc`.

### Depois

- A versão foi avançada para `0.1.43` com bump patch.
- O runtime guarda `bufnr`, arquivo, opcoes e `changedtick` junto do lote pendente e descarta o lote no `InsertLeave` se o buffer mudou.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.
- Evitar que LazyVim/Neovim aplique uma correcao antiga sobre texto digitado pelo usuario enquanto ainda estava em insert mode.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.
- Texto digitado antes de apertar `Esc` deixa de ser sobrescrito por auto-fix stale; lotes pendentes ainda sao aplicados quando o buffer permanece exatamente no mesmo estado.


## 0.1.42 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.41 já estava publicada.
- Warnings do LSP dependiam apenas de `codeAction`; quando o servidor nao oferecia acao aplicavel, o runtime nao tinha fallback assistido para gerar uma edicao local.

### Depois

- A versão foi avançada para `0.1.42` com bump patch.
- Warnings do LSP no Neovim podem entrar como `lsp_ai_fix` depois do `lsp_code_action`, usando Copilot para propor uma correcao local quando o LSP nao aplicar a acao.
- O fallback assistido fica limitado por ciclo, severidade e operacoes locais de edicao.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.
- Cobrir warnings reais do LSP que nao possuem quickfix deterministico, sem bloquear o fluxo quando o provider externo nao estiver disponivel.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.
- O auto-fix continua priorizando code actions deterministicas e usa Copilot apenas como fallback controlado para warnings elegiveis.


## 0.1.41 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.40 já estava publicada.

### Depois

- A versão foi avançada para `0.1.41` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.40 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.39 já estava publicada.

### Depois

- A versão foi avançada para `0.1.40` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.39 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.38 já estava publicada.

### Depois

- A versão foi avançada para `0.1.39` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


## 0.1.38 - Em desenvolvimento

### Antes

- pingu-dev-agent@0.1.37 já estava publicada.

### Depois

- A versão foi avançada para `0.1.38` com bump patch.

### Motivo

- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.

### Impacto

- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.


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
- o runtime agora pode disparar analise no carregamento do buffer via `BufReadPost/BufNewFile` com `g:pingu_dev_agent_realtime_on_buffer_load=1` (default).

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
