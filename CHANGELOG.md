# Changelog

Todas as mudancas relevantes deste projeto devem registrar antes, depois, motivo tecnico e impacto esperado.

## Unreleased - Importacao circular tambem em Python

### Antes

- A deteccao de importacao circular (analise multi-arquivo) cobria so JS/TS; ciclos entre modulos Python passavam despercebidos.

### Depois

- O grafo de imports passa a incluir imports relativos de Python: `from .mod import x`, `from . import mod` (irmaos do pacote) e `from ..pkg import y` (niveis com pontos), resolvendo para `<mod>.py` ou `<mod>/__init__.py`. Imports absolutos (`import os`) continuam ignorados, como no JS so contam arestas relativas dentro do conjunto analisado. O grafo, o Tarjan e o reporte sao compartilhados entre as linguagens.

### Motivo

- Ciclos de import em Python tem o mesmo custo de inicializacao fragil e acoplamento; estender a deteccao multi-arquivo amplia o alcance sem novo mecanismo.

### Impacto

- `circular_import` agora vale para `.py`/`.pyi` no `pingu analyze` de diretorio. 616 testes verdes.

## Unreleased - Provider assistido configuravel no `.pingurc.json`

### Antes

- A escolha do provider assistido (executavel, modelo, tipo de CLI) so podia ser feita por variavel de ambiente (`PINGU_COPILOT_COMMAND`, `PINGU_COPILOT_MODEL`, `PINGU_CLI_PROVIDER_KIND`), entao nao dava para versionar a escolha do time junto do repositorio.

### Depois

- Um bloco `provider` no `.pingurc.json` define `command`, `model` e `kind`, resolvido a partir do diretorio de trabalho. Precedencia env > config > default (ou inferencia pelo nome do binario, no caso do `kind`). `lib/pingu-config.js` ganha `resolveProviderCommand/Model/Kind`; `lib/ai-provider-copilot.js` passa a consultar esses resolvers.

### Motivo

- Permitir que a escolha de provider/modelo seja versionada por repositorio (consistente com `disabledKinds`/`analyzeAi`/`maxLineLength`), preservando o override por env.

### Impacto

- Sem o bloco `provider` (ou variaveis), comportamento inalterado: continua usando o `copilot` por default. 614 testes verdes.

## Unreleased - Supressao inline por comentario

### Antes

- So era possivel silenciar um diagnostico globalmente (via `PINGU_DISABLED_ISSUE_KINDS` ou `.pingurc.json`). Nao havia escape hatch por linha: para um caso pontual intencional, era preciso desligar o kind no projeto inteiro.

### Depois

- Diretivas em comentario, no estilo de linters maduros, aplicadas no fim do pipeline de `analyzeText` (valem para CLI e editor/LSP): `pingu-disable-line`, `pingu-disable-next-line` e `pingu-disable-file`, cada uma com lista opcional de `kind`s (sem lista = todos). Sao casadas como substring (vivem em comentario), entao funcionam em qualquer linguagem. Prosa explicativa pode ser separada com ` -- texto`.

### Motivo

- Dar ao dev um escape hatch local e versionado no proprio codigo para casos intencionais, sem abrir mao do diagnostico no resto do projeto — padrao consolidado de adocao de linters.

### Impacto

- Novo modulo `lib/inline-suppressions.js`; `analyzeText` filtra os diagnosticos suprimidos por ultimo. Sem diretivas, comportamento inalterado. 611 testes verdes.

## Unreleased - Deteccao de importacao circular (analise multi-arquivo)

### Antes

- Todas as deteccoes operavam por arquivo isolado. Nao havia visao do grafo de modulos do projeto, entao ciclos de importacao (`a` importa `b` que importa `a`) passavam despercebidos.

### Depois

- `pingu analyze <diretorio>` (ou multiplos arquivos) constroi um grafo dirigido de imports/requires relativos entre os arquivos analisados e reporta cada ciclo uma unica vez via componentes fortemente conexos (Tarjan, iterativo). Suporta `import/export ... from`, `import './x'`, `require('./x')` e `import('./x')` dinamico, resolvendo extensoes e `index.<ext>`. So arestas dentro do conjunto analisado viram ciclo (nao toca `node_modules`). A mensagem mostra o caminho do ciclo relativo ao diretorio base comum.

### Motivo

- Importacao circular indica acoplamento que torna a ordem de inicializacao fragil (exports parcialmente indefinidos na carga) e dificulta testes. E uma analise inerentemente multi-arquivo, entao fica no modo diretorio do CLI e nao no caminho por buffer do editor (que tem so um arquivo).

### Impacto

- Novo kind `circular_import` (suggest-only) no `pingu analyze` de diretorio, em `pingu explain` e em `issue-kinds.json`. A analise por arquivo (editor/LSP) nao muda. 601 testes verdes; `lib/` do proprio projeto nao tem ciclos.

## Unreleased - Detectores de seguranca: path traversal, XSS e SSRF

### Antes

- A analise cobria injecao de comando, injecao de SQL, desserializacao insegura e hash fraco, mas nao sinalizava caminhos de arquivo, escrita de HTML no DOM nem requisicoes HTTP construidas a partir de entrada do usuario.

### Depois

- Tres detectores suggest-only, conservadores (exigem o sink e o marcador de entrada do usuario na mesma linha para manter o falso-positivo baixo): `path_traversal` (`fs.*`/`open` com caminho derivado de request), `xss` (`innerHTML`/`outerHTML`/`document.write` com valor dinamico e `dangerouslySetInnerHTML` nao literal) e `ssrf` (`fetch`/`axios`/`requests`/`urlopen` com URL de entrada do usuario). Cada um entra na tabela de deteccoes, em `pingu explain` e em `config/issue-kinds.json`.

### Motivo

- Cobrir tres das vulnerabilidades web mais comuns (OWASP) sem gerar ruido: o sink sozinho e ambiguo, entao exige-se tambem o marcador de input. O sink e detectado na linha mascarada (so codigo real); composicao dinamica e marcador de input sao testados na linha crua para sobreviver a interpolacao em template literal.

### Impacto

- Sinaliza vulnerabilidades de path traversal, XSS e SSRF com orientacao de correcao; nenhuma reescrita automatica. 593 testes verdes, guard de ruido preservado.

## Unreleased - Micro-otimizacao de hotspots da analise

### Antes

- `checkAsyncArrayMethods` recompilava um `new RegExp(...)` com grupo de captura por linha analisada e ainda fazia um teste redundante com um segundo padrao equivalente. `suggestSimilarIdentifier` recalculava `collapseRepeatedChars(unknown)` (invariante) dentro do `.map` por candidato e deduplicava candidatos com `arr.indexOf` O(n^2). `applyTypoCorrections` construia o mesmo regex global duas vezes por correcao (um para `test`, outro para `replace`).

### Depois

- O padrao de array async vira um literal compilado uma unica vez no modulo, com um unico `match`. `suggestSimilarIdentifier` calcula `collapsedUnknown` uma vez e deduplica candidatos com um `Set` (O(n)). `applyTypoCorrections` reusa o mesmo regex global para teste e replace.

### Motivo

- Reduzir alocacao e CPU no caminho quente da analise, que roda a cada mudanca de buffer no LSP. O custo cresce com o tamanho do arquivo (regex por linha) e com a quantidade de candidatos (dedup O(n^2)).

### Impacto

- Comportamento identico (586 testes verdes, mesma saida de diagnosticos); ganho de performance proporcional ao tamanho do arquivo e ao numero de candidatos de identificador.

## Unreleased - Configuracao por repositorio via `.pingurc.json`

### Antes

- As preferencias de analise (kinds desabilitados, higiene de formatter, resolucao por IA durante a analise, limite de linha) so podiam ser ajustadas por variavel de ambiente (`PINGU_DISABLED_ISSUE_KINDS`, `PINGU_ENABLE_FORMATTING_HYGIENE`, `PINGU_ANALYZE_AI`). Isso exigia exportar envs em cada shell/editor e nao versionava o padrao do time junto do repositorio.

### Depois

- Um arquivo `.pingurc.json` (ou `pingu.config.json`) na raiz do projeto declara `disabledKinds`, `formattingHygiene`, `analyzeAi` e `maxLineLength`. O Pingu procura o arquivo subindo a arvore a partir do arquivo analisado (funciona em monorepos), com cache por diretorio. A resolucao segue a precedencia env > config > default; `disabledKinds` da env e do config sao unidos. Config malformado e tratado como ausente, sem quebrar a analise.

### Motivo

- Permitir que o padrao de analise do time seja versionado junto do codigo, sem depender do ambiente de cada dev, preservando o override pontual por variavel de ambiente.

### Impacto

- Nenhuma mudanca de comportamento por default (sem arquivo de config, tudo continua como antes). `lib/pingu-config.js` centraliza a resolucao; `analyzeText` e o detector de cobertura de testes passam a consultar o config alem da env.

## Unreleased - Performance: analise sem spawn de processo (0 chamadas externas)

### Antes

- Mesmo apos a primeira correcao (que parou o resolveAutomaticIssuesWithAi), a analise passiva ainda invocava o Copilot: o detector unit_test (checkUnitTestCoverage) gerava o teste via IA durante a analise, e o passo de IA ainda sondava a disponibilidade do provider (copilot --version). No profile, o caso JS levava ~878ms para 180 linhas, e a probe de versao sozinha custava ~500ms nesta maquina.

### Depois

- checkUnitTestCoverage so usa IA quando PINGU_ANALYZE_AI esta ligado (caindo para a geracao offline por default) e nem sonda a disponibilidade do provider quando nao vai usa-lo. resolveAutomaticIssuesWithAi tambem deixa de sondar quando allowAiCalls e false. Resultado: zero spawnSync durante a analise por default. O profile do caso JS caiu de ~5929ms (original) para ~37ms (cerca de 160x no total), e a analise de um arquivo de 2831 linhas roda em ~118ms.

### Motivo

- Analise (e diagnostico em tempo real no LSP, que roda a cada mudanca do buffer) tem de ser puramente local; qualquer spawn de processo por analise trava o editor.

### Impacto

- Comportamento por default mais rapido e deterministico, sem chamada externa. Os testes do fluxo de IA de testes unitarios (test/unit-test-copilot-flow.test.js) passaram a ligar PINGU_ANALYZE_AI explicitamente, ja que exercitam o caminho com IA.

## Unreleased - Performance: analise passiva nao invoca a IA por default

### Antes

- analyzeText chamava resolveAutomaticIssuesWithAi com allowAiCalls: true. Numa maquina com o Copilot instalado, a analise passiva invocava a IA (spawnSync) por issue gerável — no profile, 5929ms para 180 linhas (97% do tempo em spawnSync), o que travaria o editor a cada tecla (e o servidor LSP a cada change).

### Depois

- A analise passa a rodar a resolucao por IA so quando PINGU_ANALYZE_AI esta ligado (off por default); por padrao usa a geracao offline. O enriquecimento por IA continua disponivel sob demanda no fluxo de fix/pingu prompts. No profile: 5929ms -> ~529ms para 180 linhas (cerca de 11x), e a primeira analise de 60 linhas caiu de ~6000ms para ~700ms.

### Motivo

- Analise (e diagnostico em tempo real no LSP) tem de ser local e barata; chamadas de IA bloqueantes por issue sao incompativeis com cada tecla. A geracao offline ja cobre o caso comum, e a IA fica para acoes explicitas.

### Impacto

- Comportamento por default mais rapido e deterministico; quem quiser a resolucao por IA durante a analise liga PINGU_ANALYZE_AI=1. Os testes (que ja rodam com Copilot desligado) seguem verdes.

## Unreleased - Complexidade: cobertura de Python (indentacao)

### Antes

- O high_complexity so cobria linguagens com chaves (JS/TS, Go, Rust, C, Java, C#); funcoes Python densas nao eram avaliadas.

### Depois

- checkCyclomaticComplexity passou a ter um scanner por indentacao para Python: detecta def/async def, conta pontos de decisao do corpo (if/elif/for/while/except/and/or) e atribui a complexidade a funcao correta, inclusive funcoes aninhadas. Mesmo threshold conservador (30). A construcao do issue foi unificada entre os dois caminhos.

### Motivo

- Python e uma linguagem central do Pingu; a metrica de complexidade que orienta refatoracao para seniors deve valer ali tambem.

### Impacto

- Aditivo, suggest-only, mesmo threshold conservador. Coberto por novos casos em test/analyzer-cyclomatic.test.js (funcao densa, aninhada atribuida a funcao interna, funcao simples ignorada).

## Unreleased - Seguranca: injecao de SQL e hash fraco

### Antes

- A familia de seguranca cobria segredo hardcoded, injecao de comando e desserializacao insegura, mas faltavam duas classes muito comuns: injecao de SQL e uso de hash fraco (MD5/SHA-1) para senha.

### Depois

- sql_injection: sinaliza query montada por concatenacao/template — exige uma forma de query inequivoca (SELECT...FROM, INSERT INTO, UPDATE...SET, DELETE FROM) com composicao dinamica, ignorando placeholders parametrizados (%s, ?, :nome) e o "from" de imports. weak_crypto: sinaliza createHash('md5'/'sha1') (JS) e hashlib.md5/sha1 (Python) apenas quando ha termo de seguranca na linha (password/secret/token...), para nao acusar cache key/etag/checksum. Ambos suggest-only, com explicacao via pingu explain.

### Motivo

- Injecao de SQL e hash fraco de senha sao dois dos erros de seguranca mais frequentes e caros; sinaliza-los cedo, com a alternativa segura (consulta parametrizada, bcrypt/argon2), fecha as lacunas obvias da familia de seguranca.

### Impacto

- Aditivos, suggest-only e conservadores: zero falso positivo no proprio lib/ (apos endurecer as guardas que inicialmente pegavam "from" de import e sha1 de cache). Cobertos por test/analyzer-security.test.js e pelo invariante de taxonomia.

## Unreleased - Deteccao: callback async em array e complexidade alta

### Antes

- Faltavam dois sinais por nivel: callback async em metodo de array que depende do retorno sincrono (.forEach/.filter/...), um bug de pleno; e funcao com complexidade ciclomatica alta, uma observacao de senior.

### Depois

- async_array_method (JS/TS, em lib/analyzer-async.js): sinaliza callback async em .forEach/.filter/.some/.every/.find/.findIndex/.sort (a promise e ignorada / sempre truthy); .map fica de fora por ser correto com await Promise.all. high_complexity (linguagens com chaves, em lib/analyzer-complexity.js): conta pontos de decisao por funcao e sinaliza acima de 30 — threshold alto e deliberado para flagar so as funcoes realmente densas e nao reintroduzir ruido. Ambos suggest-only, com explicacao via pingu explain.

### Motivo

- O callback async em array e um bug silencioso comum; a complexidade alta orienta refatoracao onde mais importa. Sao sinais de alto valor por nivel sem competir com o foco em baixo ruido.

### Impacto

- Aditivos e suggest-only. async_array_method: zero no proprio lib/. high_complexity: 12 funcoes no proprio lib/ (as mais densas), abaixo do teto do guard de regressao. Cobertos por test/analyzer-async-array.test.js e test/analyzer-cyclomatic.test.js e pelo invariante de taxonomia.

## Unreleased - Publicacao: preparo para npm e VS Code marketplace

### Antes

- A descricao e as keywords do package.json so citavam Vim/Neovim, apesar do servidor LSP e da extensao VS Code; e nao havia um guia de publicacao para os dois artefatos.

### Depois

- package.json com descricao e keywords atualizadas (lsp, language-server, linter, static-analysis, security, vscode) para refletir o suporte multi-IDE. Extensao do VS Code recebeu sua propria LICENSE. Novo docs/publishing.md com o passo a passo de pre-voo e publicacao do pacote npm (npm run check/pack:check/release:check, npm publish) e da extensao (vsce package/publish), incluindo pre-requisitos de credenciais.

### Motivo

- Deixar os dois artefatos prontos para publicar; a publicacao final depende de tokens/contas e fica a cargo do mantenedor.

### Impacto

- So metadados e documentacao; nenhuma mudanca de runtime. O tarball do npm segue limpo (sem test/).

## Unreleased - Qualidade: guard de regressao de ruido

### Antes

- A auditoria de falso-positivo reduziu o ruido sobre o proprio lib/ de ~9300 para ~1030 issues, mas nada impedia uma mudanca futura (p.ex. no scanner) de reintroduzir milhares de avisos sem ser notado.

### Depois

- Novo test/noise-regression.test.js roda o Pingu sobre o proprio lib/ e falha se o falso positivo estrutural (undefined_variable, sintaxe, seguranca, auto-comparacao...) ou o total de issues subir alem de um teto com folga sobre o baseline. Nao exige zero — resta um tail conhecido de casos de borda — mas trava o nivel apurado contra regressao. O relatorio e memoizado para rodar a analise uma unica vez.

### Motivo

- Transformar o resultado da auditoria num invariante de CI: qualquer regressao que volte a gerar ruido em codigo correto quebra o build.

### Impacto

- So teste. Os tetos (estrutural 150, total 1100) podem ser baixados de proposito apos uma melhora, documentando o ganho.

## Unreleased - Seguranca: injecao de comando e desserializacao insegura

### Antes

- A familia de seguranca tinha so o hardcoded_secret. Execucao de comando/codigo com entrada dinamica e desserializacao de dados nao confiaveis — duas das classes de vulnerabilidade mais comuns — nao eram cobertas.

### Depois

- Novo modulo lib/analyzer-security.js com dois kinds suggest-only: command_injection (eval/exec com entrada dinamica, exec/execSync com concatenacao em JS, os.system com concatenacao e subprocess shell=True em Python) e unsafe_deserialization (pickle/marshal.loads e yaml.load sem loader seguro em Python). Registrados na familia security da taxonomia, com explicacao via pingu explain.

### Motivo

- Injecao de comando e desserializacao insegura sao vetores criticos e frequentes; sinaliza-los cedo, com a alternativa segura, tem impacto transversal a todos os niveis.

### Impacto

- Aditivos, suggest-only, conservadores: zero falso positivo no proprio lib/ e nas formas seguras (execFile/spawn com lista, subprocess.run([...]), yaml.safe_load, json.loads). Cobertos por test/analyzer-security.test.js e pelo invariante de taxonomia.

## Unreleased - LSP: hover com a explicacao da issue

### Antes

- O servidor LSP publicava diagnosticos e code actions, mas para entender uma issue o dev precisava sair do editor (rodar `pingu explain`) ou ler a doc.

### Depois

- O servidor passa a anunciar `hoverProvider` e a responder `textDocument/hover`: ao passar o mouse sobre um diagnostico, retorna markdown com o que e, por que importa e como corrigir, reusando as explicacoes do `issue-explainer` (as mesmas do `pingu explain`). Sem explicacao curada para o kind, cai para a sugestao da propria issue. As helpers `issueHoverMarkdown`/`hoverResponse` ficam no modulo de protocolo (puras) e o servidor faz o lookup do kind na linha do cursor.

### Motivo

- Levar o contexto do erro para dentro do editor, em qualquer IDE com LSP — entender o porque inline ajuda especialmente quem esta aprendendo, sem trocar de janela.

### Impacto

- Aditivo, sem mudar diagnosticos nem code actions. Coberto por tres casos novos em `test/lsp-server.test.js` (capability, hover com explicacao na linha do diagnostico, e null fora de diagnostico).

## Unreleased - Deteccao: igualdade de float e recurso aberto sem with

### Antes

- Duas armadilhas comuns nao eram cobertas: igualdade exata com literal de ponto flutuante (== / === com 0.1, 0.3...) e abrir um arquivo com open() sem o context manager with em Python.

### Depois

- float_equality (JS/TS e Python, em lib/analyzer-logic-errors.js): sinaliza == / != / === / !== adjacente a um literal com parte fracionaria; sugere comparar com tolerancia (math.isclose / Math.abs(a - b) < eps). Conservador: ignora atribuicao, inteiros, operadores relacionais (<= / >=) e strings.
- resource_leak (Python, em lib/analyzer-developer-errors.js): sinaliza a atribuicao direta f = open(...) fora de with; sugere o context manager. Ambos suggest-only, com explicacao via pingu explain.

### Motivo

- Igualdade de float e uma armadilha classica de nivel jr; recurso sem with e um vazamento real de nivel pleno. Sao bugs que o compilador aceita em silencio.

### Impacto

- Aditivos e suggest-only, zero falso positivo no proprio lib/. Cobertos por test/analyzer-float-resource.test.js, pelo invariante de taxonomia (familias comparison_logic e nova resource_safety) e pelas explicacoes.

## Unreleased - Ruido: higiene redundante com formatter fica off por default

### Antes

- trailing_whitespace, tabs, long_line e large_file rodavam por default. Sao exatamente o que prettier/black/gofmt/rustfmt ja resolvem em todo projeto, entao competiam com o formatter e adicionavam ruido (sobretudo para quem ja usa um).

### Depois

- Esses quatro kinds ficam off por default. PINGU_ENABLE_FORMATTING_HYGIENE=1 reativa todos; PINGU_DISABLED_ISSUE_KINDS continua podendo subtrair um individualmente depois de reativar. Os detectores e a aplicacao de fix seguem existindo — apenas nao aparecem sem o opt-in.

### Motivo

- Formatter e a ferramenta certa para layout; duplicar isso no Pingu so gera ruido e contraria o foco em sinal de alto valor (bugs, seguranca, contrato).

### Impacto

- Comportamento mudado de forma reversivel e documentada. O teste de resiliencia que usava trailing_whitespace como check estavel passou a usar debug_output (default-on); novo test/formatting-hygiene-optin.test.js cobre o default-off e o opt-in.

## Unreleased - Deteccao: segredo hardcoded

### Antes

- O Pingu nao detectava credenciais hardcoded no codigo (API keys, tokens, senhas, chaves privadas) — um dos erros mais caros e comuns em todos os niveis, e a primeira classe de seguranca coberta.

### Depois

- Novo modulo `lib/analyzer-secrets.js` e kind `hardcoded_secret` (suggest-only), com nova familia `security` na taxonomia. Sinaliza padroes de provedor conhecidos (AWS `AKIA`, GitHub `ghp_`/`github_pat_`, Stripe `sk_live_`, Google `AIza`, Slack `xox`, blocos de chave privada) e atribuicoes a nomes sensiveis (`password`/`secret`/`token`/`api_key`/...) com literal de string. Conservador: ignora placeholders (`changeme`, `your-api-key`, `<...>`, `${...}`), leitura de ambiente (`process.env`/`os.environ`) e valores de baixa entropia (palavra minuscula como `postgres`, ou so digitos). Explicacao via `pingu explain hardcoded_secret`.

### Motivo

- Vazamento de credenciais versionadas e um erro caro (rotacao, exposicao em historico/forks/logs) e ate entao nao coberto; e a deteccao de maior impacto entre os niveis jr/pleno/senior.

### Impacto

- Aditivo e suggest-only, sem auto-fix (a correcao depende de mover o valor para ambiente/cofre). Zero falso positivo no proprio `lib/`. Coberto por `test/analyzer-secrets.test.js` (provedores, atribuicao, placeholders, env, baixa entropia, focusRange), pelo invariante de taxonomia e por um caso novo no corpus anti-falso-positivo.

## Unreleased - LSP: code actions para todas as operacoes de correcao

### Antes

- As code actions do servidor LSP cobriam apenas `replace_line` e `insert_before`. As demais operacoes que os detectores produzem — `insert_after`, `delete_line`, `replace_range` e `write_file` — nao viravam quickfix, entao varias correcoes ficavam disponiveis no CLI/Neovim mas nao nos editores LSP.

### Depois

- `issueToTextEdit` passou a cobrir, espelhando a semantica baseada em linha do aplicador do CLI: `delete_line` (remove a linha inteira), `insert_after` (insere apos a linha), `replace_range` (substitui um intervalo de linhas) alem de `replace_line`/`insert_before`. `write_file` (gerar teste/documento de contexto) vira um WorkspaceEdit com `documentChanges` (CreateFile do alvo resolvido relativo ao arquivo + insercao do conteudo). `run_command` continua sem edit (nao e WorkspaceEdit). As helpers de URI (`uriToPath`/`pathToUri`) foram centralizadas no modulo de protocolo.

### Motivo

- Levar todas as correcoes do Pingu para qualquer editor LSP, com a mesma cobertura ja disponivel no CLI e no Neovim — inclusive a geracao de arquivos de teste a partir do editor.

### Impacto

- Aditivo: mais operacoes mapeadas, sem mudar diagnosticos nem o restante do servidor. Coberto por seis casos novos em `test/lsp-protocol.test.js` (delete_line, insert_after, replace_range, write_file relativo/absoluto e run_command ignorado).

## Unreleased - VS Code: extensao dedicada sobre o servidor LSP

### Antes

- Com o servidor LSP, o Pingu ja rodava em editores com cliente LSP generico (Neovim nativo, Helix, Emacs), mas o VS Code nao tem cliente LSP embutido: exigia configuracao manual e nao era instalavel como extensao.

### Depois

- Nova extensao em `editors/vscode/`: um wrapper fino que inicia o `pingu lsp` via `vscode-languageclient` e delega tudo ao servidor (diagnosticos e quick fixes). Inclui o manifesto (`package.json` com `activationEvents` e settings `pingu.serverCommand`/`pingu.serverArgs`), o `extension.js` de fiacao do cliente e um README com os passos de dev (`F5`) e de empacotamento (`vsce package` -> `.vsix`).

### Motivo

- Fechar a cobertura de IDEs: o VS Code e o editor mais usado e o unico dos alvos sem cliente LSP nativo. Uma extensao fina sobre o servidor ja existente entrega a integracao com a menor superficie de codigo possivel.

### Impacto

- Isolado em `editors/vscode/` (fora do `npm run check`, do lint custom e do sync do runtime de Vim): o core do Pingu segue zero-dependencia; a unica dependencia (`vscode-languageclient`) e o cliente LSP padrao do VS Code e vive so nesse subpacote. Validado o manifesto (JSON bem-formado, `activationEvents` consistentes com o `documentSelector`) e a sintaxe do `extension.js`; o comportamento dentro do VS Code precisa ser exercitado num Extension Development Host (nao executavel neste ambiente).

## Unreleased - Outras IDEs: servidor LSP

### Antes

- O Pingu so era usavel no editor pelo plugin de Vim/Neovim (e pelo CLI). Outros editores nao tinham como consumir a analise sem uma integracao dedicada.

### Depois

- Novo servidor Language Server Protocol (`pingu lsp` / `pingu_dev_agent.js --lsp`), implementado em `lib/lsp-server.js` (I/O stdio + document store) sobre o protocolo puro `lib/lsp-protocol.js` (framing JSON-RPC com Content-Length, parsing incremental byte-accurate, mapeamento issue -> Diagnostic e issue -> CodeAction). Anuncia `textDocumentSync` completo e `codeActionProvider`; em `didOpen`/`didChange`/`didSave` roda `analyzeText` e publica diagnosticos, e responde quickfixes (`replace_line`/`insert_before`) a partir dos snippets das issues. Reusa o mesmo motor de analise, sem dependencias externas. Uma unica implementacao atende VS Code, Helix, Zed, Emacs, Sublime e o LSP nativo do Neovim.

### Motivo

- Estender o Pingu para alem do Neovim com a menor superficie possivel: o LSP e o protocolo padrao de editores, entao um servidor cobre praticamente todos de uma vez, mantendo a filosofia zero-dependencia.

### Impacto

- Aditivo: novos subcomando/flag e modulos, sem alterar a analise nem o plugin existente. Coberto por `test/lsp-protocol.test.js` e `test/lsp-server.test.js` (framing, mapeamento de diagnostics/code actions, ciclo open/change/close, shutdown/exit e resiliencia a excecao na analise). README documenta a configuracao em Neovim nativo, Helix e Emacs.

## Unreleased - Falso positivo em Rust: parametros de closure

### Antes

- A analise de escopo de Rust nao coletava os parametros de closure (`|item|`, `|x, y|`, `move |x: T|`), entao um uso como `items.iter().map(|item| item * 2)` acusava `item` como variavel indefinida. C e Elixir foram auditados no mesmo lote e estavam limpos (sem FP de undefined/sintaxe; em Elixir o gate de contrato publico ja distingue `def`/`defp` corretamente).

### Depois

- O coletor de variaveis de escopo de Rust passa a extrair os parametros de closure delimitados por `|...|` (respeitando `mut`/`ref` e listas). `item` e os demais entram no escopo e nao sao mais acusados.

### Motivo

- Closures com `iter().map(|x| ...)`/`filter(|x| ...)` sao onipresentes em Rust idiomatico; nao reconhecer seus parametros gerava falso positivo de alto volume em codigo correto.

### Impacto

- Um caso novo no corpus anti-falso-positivo cobre o parametro de closure Rust. O over-flag de `function_doc`/`function_comment` em funcoes privadas de Rust (sem `pub`) permanece — e opiniao, nao falso positivo, e consistente com C/Ruby/Lua/Vim.

## Unreleased - Falsos positivos em Go: tabs idiomaticos e contrato publico

### Antes

- Auditando codigo realista fora do `lib/`, dois falsos positivos apareciam em Go: (1) o detector `tabs` sinalizava cada linha indentada com tab, mas Go usa tabs por padrao do gofmt; (2) o gate de contrato publico de `function_doc`/`function_comment` so conhecia JS/TS/Python/Elixir — em Go, todas as funcoes (publicas e privadas) eram tratadas igual, e o gate de `function_doc` por nomes exportados de JS zerava qualquer funcao Go.

### Depois

- `checkTabs` ignora Go (e Makefiles), onde tab e idiomatico/exigido. `isPublicFunctionContract` passou a reconhecer Go (identificador exportado comeca com maiuscula) e e usado tambem pelo `checkCrossLanguageFunctionDocs`, unificando a regra de contrato publico entre `function_doc` e `function_comment`. Num arquivo Go de exemplo: `tabs` 7 -> 0, e `function_doc`/`function_comment` passam a marcar apenas a funcao exportada (`Total`), restaurando a deteccao em funcoes publicas de Go.

### Motivo

- A auditoria de falso positivo so havia coberto o `lib/` (todo JS); estender a checagem a Python/Go/Ruby revelou que os ajustes de contrato publico nao alcancavam Go e que `tabs` era cego a convencao da linguagem.

### Impacto

- Quatro casos novos no corpus anti-falso-positivo cobrem tabs idiomaticos em Go e o gating publico/privado de Go. Python e Ruby ja estavam limpos na auditoria (sem FP de undefined/sintaxe; contrato publico correto).

## Unreleased - Ruido: `function_comment` so cobra o contrato publico

### Antes

- O `function_comment` (sugestao de comentario de manutencao acima de uma funcao) sinalizava toda funcao sem comentario, inclusive helpers internos. Sobre o proprio `lib/` eram 451 sugestoes.

### Depois

- Espelhando o `function_doc`, a sugestao agora vale so para o contrato publico: funcoes exportadas em JS/TS (via `collectJavaScriptExportNames`), nao-privadas em Python (sem prefixo `_`, exceto dunder) e publicas em Elixir (`def`, nao `defp`). Outras linguagens mantem o comportamento anterior. No `lib/`, os `function_comment` cairam de 451 para 211; o total de issues caiu para 1467.

### Motivo

- Consistencia com o `function_doc` e com a diretriz do projeto de documentar o contrato publico; cobrar comentario de cada helper interno era ruido.

### Impacto

- Coberto por `isPublicFunctionContract` e tres casos novos no corpus anti-falso-positivo (helper interno JS, `defp` em Elixir, `_privado` em Python). Comportamento para funcoes publicas preservado.

## Unreleased - Ruido: `function_doc` so cobra documentacao do contrato publico

### Antes

- O `function_doc` sugeria documentacao para toda funcao sem doc, incluindo helpers internos. Sobre o proprio `lib/` isso gerava 451 sugestoes, a maioria em funcoes que nunca aparecem no contrato exportado do modulo.

### Depois

- A sugestao de doc faltante so vale para o contrato publico: em JavaScript/TypeScript, funcoes exportadas (via `export` ou `module.exports`, detectadas por `collectJavaScriptExportNames`); em Python, funcoes que nao sao privadas por convencao (prefixo `_` que nao seja um dunder do protocolo). Documentacao desatualizada continua sinalizada para qualquer funcao. No `lib/`, os `function_doc` cairam de 451 para 211.

### Motivo

- Documentar o contrato publico e a pratica recomendada do proprio projeto; cobrar doc de cada helper interno so gerava ruido e contrariava essa diretriz.

### Impacto

- Deteccao do contrato publico preservada (funcao exportada sem doc ainda e sinalizada, e o ciclo gerar/aplicar doc continua estavel). Dois casos novos no corpus anti-falso-positivo garantem que helpers internos (JS nao exportado, Python `_privado`) nao geram sugestao. Corrige tambem um bug introduzido na primeira versao: `collectJavaScriptExportNames` devolve array, e usar `.has` direto fazia o check estourar e zerar todos os `function_doc`.

## Unreleased - Ruido: `flow_comment` so dispara em passos genuinamente complexos

### Antes

- O `flow_comment` (sugestao de comentario de manutencao antes de um passo) considerava "digna de comentario" praticamente qualquer atribuicao com uma chamada, um acesso a propriedade, um operador ou um literal de colecao. Sobre o proprio `lib/` isso gerava 567 sugestoes — a maioria em codigo auto-explicativo (`const x = foo(a)`, `const y = obj.prop`, guardas curtos), poluindo o resultado.

### Depois

- `looksCommentWorthyAssignment` passou a exigir complexidade real: ternario, chamada aninhada, duas ou mais chamadas, duas ou mais operacoes logicas, ou expressao longa — e um piso de comprimento (45 caracteres) que dispensa guardas/coercoes curtos como `Array.isArray(x) ? x : []` ou `String(x).trim()`. No `lib/`, os `flow_comment` cairam de 567 para 107 (~81%). A mudanca vale tambem para os fallbacks de `variable_doc` e para os comentarios de manutencao gerados, que ficam menos ruidosos.

### Motivo

- O detector e uma opiniao util, mas exigir um comentario antes de cada linha trivial mais atrapalhava do que ajudava. Restringir a passos nao-obvios preserva o valor e remove o ruido.

### Impacto

- Comportamento ajustado e coberto: o teste de comentario automatico de fluxo passou a exigir um passo complexo (ternario/composicao) e ganhou um caso afirmando que uma atribuicao simples nao gera comentario. Demais golden-fixtures de manutencao inalterados.

## Unreleased - Robustez: corrige falsos positivos de sintaxe (regex e template literals)

### Antes

- O scanner de sintaxe (`scanSyntaxStructure`) nao reconhecia literais de regex nem template literals em JavaScript/TypeScript. Os delimitadores no corpo deles — `[A-Za-z]`, `(?:...)`, `\)` em regex e `${...}` em template — eram contados na pilha de delimitadores e a corrompiam. Alem disso, `collectionContexts` procurava o contexto de colecao mais proximo ignorando blocos no meio, tratando statements no corpo de uma funcao definida dentro de um objeto como itens do objeto. Resultado: sobre o proprio `lib/`, 1544 `syntax_missing_comma` e 660 `syntax_extra_delimiter` falsos, em codigo que compila.

### Depois

- O scanner passa a pular literais de regex (heuristica de posicao para nao confundir com divisao, cobrindo tambem `/` apos palavras-chave como `return`/`typeof`) e a tratar template literals com estado entre linhas, reentrando em codigo apenas nas interpolacoes `${...}` (empilhadas e restauradas no `}` correspondente). O contexto de colecao passa a considerar apenas o delimitador imediato (topo da pilha), entao um bloco sombreia um objeto/array externo. No `lib/`: `syntax_missing_comma` 1544 -> 40, `syntax_extra_delimiter` 660 -> 51, `syntax_missing_quote` 103 -> 36, e o total de issues 9292 -> 2407 (o restante e majoritariamente sugestao de doc/comentario/linha longa, nao falso positivo).

### Motivo

- Erros de sintaxe so fazem sentido em codigo que nao compila; emiti-los a milhares sobre codigo correto destruia a confianca na ferramenta. As duas causas eram estruturais no scanner.

### Impacto

- Deteccao legitima preservada: os golden-fixtures de sintaxe (aspas, delimitadores e virgulas realmente ausentes) continuam validando. Quatro casos novos no corpus anti-falso-positivo (`test/false-positive-corpus.test.js`) travam os padroes corrigidos: delimitadores em regex, interpolacao de template, e metodos com corpo dentro de objeto.

## Unreleased - Robustez: corrige falsos positivos de `undefined_variable`

### Antes

- Apontando o Pingu para o proprio `lib/` (codigo correto, testado), o detector `undefined_variable` emitia 4693 avisos — quase todos falsos positivos, varios com correcao confiante e absurda (p.ex. acusar `error` de um `catch (error)` e sugerir trocar por uma funcao longa nao relacionada). As causas: (1) a sugestao por similaridade aceitava casamento por subsequencia, tratando qualquer palavra curta contida num identificador longo como typo; (2) o escopo nao reconhecia bindings de `catch`, consts/`require` de nivel de modulo, parametros de funcao aninhada nem desestruturacao em arrow; (3) conteudo de literais de regex (`/\bprisma\b/`) vazava como identificador; (4) nomes de 1-2 caracteres geravam ruido.

### Depois

- A sugestao de undefined-variable so e aceita quando e um typo plausivel: distancia de edicao pequena e proporcional ao tamanho e comprimento parecido (`isGenuineTypoSuggestion`), eliminando os casamentos por subsequencia. O escopo brace passou a coletar bindings de `catch`, o escopo de modulo (const/let/var/require, funcao e classe via `collectBraceModuleScopeVariables`), parametros de funcao aninhada e desestruturacao em arrow; `sanitizeScopedAnalysisLine` remove literais de regex que contenham escape; e nomes com menos de 3 caracteres nao sao sinalizados. No `lib/`, os `undefined_variable` cairam de 4693 para 2 (~99,96%), e o total de issues de 9292 para 4616.

### Motivo

- Para uma ferramenta suggest-only que roda ao vivo no editor, um falso positivo custa mais confianca do que um bug nao detectado. A auditoria sobre o proprio codigo expos que o detector estava estruturalmente barulhento; o ajuste preserva a deteccao de typos reais e remove o ruido.

### Impacto

- Deteccao legitima preservada: os golden-fixtures de undefined-variable continuam validando (typo real como `amont` -> `amount` ainda e sinalizado). Cinco casos novos no corpus anti-falso-positivo (`test/false-positive-corpus.test.js`) travam os padroes corrigidos (catch, const de modulo, funcao aninhada, desestruturacao, regex), mais um caso de ruido de nome curto no smoke test do modulo.

## Unreleased - Modularizacao: cluster de analise de variaveis indefinidas

### Antes

- Mesmo apos o desacoplamento dos helpers compartilhados, o `analyzer.js` ainda concentrava o cluster de analise de variaveis indefinidas (escopo): 40 funcoes (~1090 linhas) cobrindo Python, Elixir e linguagens brace-scoped (JS/TS/Go/Rust), mais o cache bounded de resultados e de exports de modulo local. Era o maior nucleo acoplado restante.

### Depois

- As 40 funcoes e os dois caches (`globalUndefinedVariableCache`, `globalLocalModuleExportCache`, com seus limites) foram extraidos para `lib/analyzer-undefined-variables.js`, cluster fechado sob os modulos ja isolados (support, language-profiles, analyzer-options, analyzer-import-bindings, identifier-similarity, analyzer-undefined-correction, function-signature, syntax-issues, python-scope-utils, python-signature, analyzer-module-resolution). `analyzer.js` importa apenas a entrada `checkUndefinedVariables`, remove dezenove imports orfaos que so serviam ao cluster e cai de 3870 para 2762 linhas — abaixo de tres mil pela primeira vez (6657 no inicio da serie, ~58% menor).

### Motivo

- Concluir o untangle do nucleo de escopo: a maior teia de acoplamento interna agora vive em modulo proprio, deixando o `analyzer.js` como orquestrador enxuto que delega para os modulos de check.

### Impacto

- Comportamento preservado: os golden-fixtures de undefined-variable (Python/Elixir/brace-scoped, correcao por similaridade e cache) continuam validando o resultado, mais um smoke test direto do novo modulo (`test/analyzer-undefined-variables.test.js`).

## Unreleased - Modularizacao: desacopla helpers compartilhados do nucleo de escopo

### Antes

- O cluster de analise de variaveis indefinidas (escopo) compartilhava quatro helpers com outros checks do `analyzer.js`: `checkSyntaxIssues` (usado tambem pelo pipeline de sintaxe e por checks de texto estruturado), `stripPythonMultilineStringContent` e `sanitizeScopedAnalysisLine` (usados tambem pelos checks de variable-docs) e `isJavaScriptControlKeyword`. Isso impedia extrair o cluster de escopo sem criar dependencia circular.

### Depois

- `checkSyntaxIssues` foi para o novo modulo `lib/syntax-issues.js` (agregador de sintaxe, importando de analyzer-syntax-scan, analyzer-structured-text e analyzer-elixir-syntax). `stripPythonMultilineStringContent`, `nextPythonTripleQuote` e `sanitizeScopedAnalysisLine` foram para `lib/python-scope-utils.js`; `isJavaScriptControlKeyword` foi para `lib/support.js`. `analyzer.js` importa todos de volta e caiu de 3944 para 3870 linhas, com os imports orfaos removidos.

### Motivo

- Desacoplar os helpers compartilhados e dar ao agregador de sintaxe um modulo proprio, preparando a extracao futura do cluster de variaveis indefinidas sem dependencia circular.

### Impacto

- Comportamento preservado: os golden-fixtures de sintaxe, undefined-variable e variable-docs continuam validando o resultado, mais smoke tests diretos (`test/syntax-issues.test.js` e novos casos em `test/python-scope-utils.test.js`).

## Unreleased - Interatividade: comando `pingu explain <kind>`

### Antes

- As issues traziam `message` e `suggestion`, mas nao havia como o desenvolvedor pedir uma explicacao mais completa de uma classe de erro (o porque, como corrigir, se reescreve sozinho, como silenciar) sem ler o codigo-fonte ou a documentacao.

### Depois

- Novo comando `pingu explain <kind>` e modulo `lib/issue-explainer.js`, apoiado em `config/issue-explanations.json` (explicacoes curadas para 18 kinds). O comando combina a explicacao curada com o contrato do kind (`autoFixDefault`) e a familia/linguagens da taxonomia, mostrando o que e, por que importa, como corrigir, se e suggest-only, e a linha `PINGU_DISABLED_ISSUE_KINDS` para silenciar. Sem argumento, lista os kinds com explicacao; `--json` devolve a forma estruturada.

### Motivo

- Tornar a experiencia mais interativa: dar ao desenvolvedor um caminho rapido para entender uma issue antes de aceitar a correcao ou silenciar a classe.

### Impacto

- Aditivo: novo subcomando read-only, sem mudanca nos detectores ou no runtime de analise. Coberto por `test/issue-explainer.test.js`, incluindo o invariante de que toda explicacao aponta para um kind real de `issue-kinds.json`.

## Unreleased - Robustez: corpus de regressao anti-falso-positivo

### Antes

- A confianca de que os detectores suggest-only nao geram ruido vinha de testes pontuais por detector. Nao havia um corpus dedicado de codigo legitimo que se parece com os gatilhos mas nao deve dispara-los, rodado pela analise completa.

### Depois

- Novo `test/false-positive-corpus.test.js` com dez trechos realistas (JS/TS e Python) que exercitam `analyzeText` de ponta a ponta e afirmam que nenhum kind proibido dispara: `a < b && b < c`, `for await...of`/`await Promise.all` em loop, atribuicao intencional com parenteses duplos, `typeof` valido/`Number.isNaN`/`parseInt(x, 10)`, encadeamento valido e `is None` em Python, variaveis de dominio que apenas usam builtins, dunders corretos, `== null`, comparacao entre chamadas distintas e import efetivamente usado.

### Motivo

- Travar o comportamento conservador dos detectores contra regressoes futuras que afrouxem as guardas, aumentando a confianca de que o Pingu nao atrapalha o fluxo do desenvolvedor.

### Impacto

- Apenas teste, sem mudanca de runtime. Serve de rede de seguranca para a evolucao dos detectores.

## Unreleased - Deteccao: shadowing de builtin, typo em dunder e await em loop

### Antes

- O Pingu nao cobria tres enganos humanos comuns que o runtime aceita em silencio: sobrescrever um builtin Python (`list = [...]`), grafar errado um metodo dunder (`def __inti__`, que nunca e chamado pelo protocolo de dados) e usar `await` direto no corpo de um loop sequencial em JS/TS.

### Depois

- Novo modulo `lib/analyzer-python-naming.js` com `shadowed_builtin` e `dunder_typo` (este usando distancia de edicao 1 mais transposicao adjacente Damerau contra o conjunto de dunders conhecidos). O `lib/analyzer-async.js` ganhou `checkAwaitInLoop` (`await_in_loop`), que usa uma pilha de blocos para distinguir o corpo do loop de funcoes aninhadas e ignora `for await...of` e `await Promise.all/allSettled/race`. Os tres sao suggest-only (`autoFixDefault: false`), registrados em `config/issue-kinds.json` e nas familias `typo_and_naming` e na nova `async_and_concurrency` da taxonomia.

### Motivo

- Ampliar a cobertura de erro humano para classes de bug frequentes em Python e em codigo assincrono, mantendo a politica conservadora (guardas explicitas contra falso positivo em cada detector).

### Impacto

- Comportamento preservado para o codigo existente: detectores aditivos, suggest-only, sem auto-fix. Cobertos por `test/analyzer-python-naming.test.js`, `test/analyzer-await-in-loop.test.js` e pelo invariante de taxonomia estendido.

## Unreleased - Modularizacao: checks de documentacao e @spec de Elixir

### Antes

- O `analyzer.js` ainda concentrava o cluster de documentacao/@spec de Elixir (~600 linhas, 17 funcoes): resolucao do range de `@doc`/`@spec` acima de uma funcao, deteccao de doc/@spec desatualizados frente a assinatura atual e inferencia do contexto de spec (tipos de parametro e retorno). Era o ultimo no acoplado do nucleo de documentacao.

### Depois

- As 17 funcoes foram extraidas para `lib/analyzer-elixir-doc-spec.js`, agora um cluster leaf fechado sob `support`, `function-body`, `function-signature`, `function-metadata`, `language-profiles` e `analyzer-options` (possivel apenas apos isolar o parsing de assinatura e os metadados de funcao). `analyzer.js` importa as seis entradas usadas externamente e caiu de 4535 para 3937 linhas — abaixo de quatro mil pela primeira vez (6657 no inicio da serie, ~41% menor).

### Motivo

- Concluir o untangle do nucleo de documentacao: o cluster de Elixir, que era a maior teia de acoplamento, agora vive em modulo proprio e importa a infraestrutura compartilhada em vez de arrasta-la.

### Impacto

- Comportamento preservado: os golden-fixtures de doc/@spec de Elixir (incluindo multiplas clausulas, idempotencia e nao-sobrescrita de spec de outra funcao) continuam validando o resultado, mais um smoke test direto do novo modulo (`test/analyzer-elixir-doc-spec.test.js`).

## Unreleased - Modularizacao: metadados cross-language de funcao

### Antes

- O `analyzer.js` mantinha o cluster de metadados cross-language de funcao (`buildFunctionIssueMetadata` e helpers: resolucao do fim da declaracao, coleta do corpo, inferencia de retorno e da classe Python envolvente, extracao de retorno inline em JavaScript). Esse era o ultimo no de acoplamento entre os checks de doc/spec e o nucleo do analyzer.

### Depois

- As seis funcoes foram extraidas para `lib/function-metadata.js`, cluster leaf fechado sob `support`, `language-profiles` e `python-signature`. `analyzer.js` importa as quatro entradas usadas externamente e caiu de 4656 para 4530 linhas.

### Motivo

- Segundo passo do untangle do nucleo de documentacao: agora os metadados de funcao consumidos pelos checks de doc/spec estao isolados, restando apenas o cluster de doc/spec de Elixir para uma extracao futura sem arrastar infraestrutura compartilhada.

### Impacto

- Comportamento preservado: os golden-fixtures de doc/spec/undefined-variable continuam validando o resultado, mais um smoke test direto do novo modulo (`test/function-metadata.test.js`).

## Unreleased - Modularizacao: parsing de assinatura Python e descritores genericos

### Antes

- O `analyzer.js` concentrava o parsing de declaracao de funcao/classe Python (incluindo decorators e assinatura multilinha) e os descritores de parametros genericos cross-language. Esse cluster era a base de acoplamento transitivo de `buildFunctionIssueMetadata`, bloqueando a futura extracao dos checks de documentacao/spec de Elixir.

### Depois

- Dez funcoes (`readPythonFunctionDeclaration`, `parsePythonFunctionDeclarationSource`, `parsePythonClassDeclaration`, `collectPythonLeadingDecorators`, `parsePythonDecoratorName`, `pythonSignatureHasTrailingColon`, `countPythonSignatureParenDelta`, `parseGenericParamDescriptors`, `isGenericFunctionParamOptional`, `isGenericFunctionParamVariadic`) foram extraidas para `lib/python-signature.js`, cluster leaf fechado sob `support`, `python-scope-utils` e `language-profiles`. `analyzer.js` importa as quatro entradas usadas externamente e caiu de 4844 para 4651 linhas.

### Motivo

- Primeiro passo do untangle do nucleo de documentacao: isolar a infraestrutura compartilhada de parsing de assinatura, abrindo caminho para extrair depois os metadados cross-language de funcao e o cluster de doc/spec de Elixir.

### Impacto

- Comportamento preservado: os golden-fixtures de doc/spec/undefined-variable continuam validando o resultado, mais um smoke test direto do novo modulo (`test/python-signature.test.js`).

## Unreleased - Offline: blueprint de contexto document-only para Java/C#/Kotlin/Swift/Scala/PHP

### Antes

- As linguagens Java, C#, Kotlin, Swift, Scala e PHP nao ofereciam `context_file` offline. Ao forcar o fluxo, o `resolveBlueprintSourceExtension` caia para `.js` (via deteccao de `package.json`/`tsconfig.json`) e o Pingu gerava um scaffold CRUD inteiro em JavaScript dentro de um projeto Java/PHP/etc. — saida enganosa.

### Depois

- Essas seis linguagens passam a declarar `context_file`/`context_blueprint` offline. O `resolveBlueprintSourceExtension` agora reconhece suas extensoes e preserva a extensao original, de modo que o blueprint fica **document-only**: gera o documento de contexto arquitetural (com `language`/`source_ext` corretos) e o `.gitignore` do agente, sem scaffold de outra linguagem. O scaffold CRUD nativo dessas stacks pode ser adicionado depois sem mudar o contrato.

### Motivo

- Estender a cobertura offline do marcador `**` para as stacks tier-2 de forma honesta, eliminando o fallback cross-language que poluia o projeto com arquivos JavaScript.

### Impacto

- Comportamento preservado para as linguagens com scaffold nativo (JS/TS, Python, Go, Rust, Elixir, Ruby, C). Coberto por `test/blueprint-document-only-languages.test.js`, que garante documento de contexto presente e ausencia de arquivos `.js`/`.ts`/`.py`/`.go`/`.rs` para essas extensoes.

## Unreleased - Deteccao: comparacao encadeada e identidade contra literal

### Antes

- O Pingu cobria erros humanos de comparacao apenas via nullability (`loose_equality`, `none_comparison`, `nil_comparison`) e auto-comparacao/`NaN`/`typeof`. Comparacoes encadeadas em linguagens C-like (`a < b < c`, que avalia `(a < b) < c`) e identidade contra literal em Python (`x is 5`, `x is "foo"`) passavam sem aviso.

### Depois

- Novo modulo `lib/analyzer-logic-errors.js` com dois detectores suggest-only: `chained_comparison` (JS/TS) e `literal_identity_comparison` (Python). Registrados em `config/issue-kinds.json` (`autoFixDefault: false`) e na nova familia `comparison_logic` da taxonomia. Cada um propoe a correcao (`a < b && b < c`; troca de `is`/`is not` por `==`/`!=`) sem reescrever sozinho.

### Motivo

- Ampliar a cobertura de erros humanos que o compilador aceita em silencio, mantendo a politica conservadora (mascara strings/comentarios, preserva `is None`/`is True`/`is False`, ignora shifts e o encadeamento valido de Python).

### Impacto

- Comportamento preservado para o codigo existente: detectores aditivos, suggest-only, sem auto-fix. Cobertos por `test/analyzer-logic-errors.test.js` e pelo invariante de taxonomia.

## Unreleased - Modularizacao: utilitarios de corpo de funcao

### Antes

- O `analyzer.js` mantinha `isFunctionDeclarationLine`, `collectFunctionBodyLines` e `lastMeaningfulBodyLine`, helpers de varredura de corpo de funcao compartilhados pelos checks de documentacao e escopo.

### Depois

- Esses tres helpers foram extraidos para `lib/function-body.js`, modulo leaf puro que faz par com `function-signature` (depende so de `support` e `function-signature`). `analyzer.js` caiu para 4842 linhas.

### Motivo

- Isolar mais um util de fronteira limpa, reduzindo o nucleo do analyzer e dando cobertura unitaria focada a infraestrutura compartilhada.

### Impacto

- Comportamento preservado: os helpers sao reimportados e exercitados pelos golden-fixtures, mais um smoke test direto (`test/function-body.test.js`).

## Unreleased - Modularizacao: parsing de assinatura de funcao

### Antes

- O `analyzer.js` mantinha o cluster compartilhado de parsing de assinatura de funcao (nomes de parametros, variaveis ligadas em padroes, declaracao de funcoes Elixir com guarda e forma `, do:`), usado pelos checks de escopo, documentacao e specs.

### Depois

- Esse cluster de nove funcoes foi extraido para `lib/function-signature.js`, fechado sob utilitarios puros do support (`sanitizeIdentifier`, `splitTopLevelParams`, `isReservedToken`). `analyzer.js` importa as tres entradas usadas (`readElixirFunctionDeclaration`, `parseFunctionDeclaration`, `extractBoundPatternVars`) e caiu para 4884 linhas — abaixo de cinco mil pela primeira vez (era 6657 no inicio da serie, ~27% menor).

### Motivo

- Promover um util de fronteira limpa que era a base de acoplamento de varios checks, abrindo caminho para isolar futuramente os detectores de escopo e de documentacao por linguagem.

### Impacto

- Comportamento preservado: os golden-fixtures de undefined-variable/doc/spec continuam validando o resultado, mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: checks de complexidade/fluxo

### Antes

- O `analyzer.js` mantinha os checks de complexidade/fluxo: reatribuicao imperativa em Elixir (`checkFunctionalReassignment`) e aninhamento alto de controle (`checkNestedConditionDepth`).

### Depois

- Esses dois checks puros foram extraidos para `lib/analyzer-complexity.js` (dependem apenas de utilitarios do support). `analyzer.js` importa-os e caiu para 5034 linhas.

### Motivo

- Continuar a reducao do God file isolando o dominio de complexidade/fluxo.

### Impacto

- Comportamento preservado: mesmos kinds e mensagens, exercitados pelos testes existentes mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: scanner de estrutura sintatica

### Antes

- O `analyzer.js` mantinha o scanner de estrutura sintatica generico (`scanSyntaxStructure`), a deteccao de virgula ausente (`checkMissingCommaIssues`) e os helpers de delimitador/entry (delimitadores de abertura/fechamento, contexto de colecao, comentario inline, entradas de objeto/array) — cerca de 290 linhas.

### Depois

- Esse cluster coeso foi extraido para `lib/analyzer-syntax-scan.js`, dependendo apenas de perfis de linguagem e de utilitarios de varredura do support. O orquestrador `checkSyntaxIssues` permanece no analyzer e importa as duas entradas. `analyzer.js` caiu para 5107 linhas (era 6657 no inicio da serie de modularizacoes, ~23% menor).

### Motivo

- Continuar a reducao do God file isolando o dominio de estrutura sintatica (balanceamento de delimitadores/strings e virgula ausente), distinto da analise de escopo.

### Impacto

- Comportamento preservado: mesmos kinds e mensagens de sintaxe, exercitados pelos golden-fixtures e demais testes, mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: checks de sintaxe Elixir

### Antes

- O `analyzer.js` mantinha os checks de sintaxe especificos de Elixir (blocos do/end pendentes, keyword `end` malformada, token isolado inesperado) e os helpers genericos de varredura de sintaxe usados por eles e por outros checks.

### Depois

- Os tres checks de sintaxe Elixir (mais o helper `looksLikeMalformedElixirEndToken`) foram extraidos para `lib/analyzer-elixir-syntax.js`. Os helpers genericos e puros de varredura (`syntaxRelevantLine`, `findNextSyntaxLine`, `findPreviousSyntaxLine`) foram para `lib/support.js`, ficando disponiveis tanto para o novo modulo quanto para os checks que permaneceram (virgula ausente). `analyzer.js` caiu para 5400 linhas.

### Motivo

- Continuar a reducao do God file isolando um dominio coeso (sintaxe Elixir) e promovendo os utilitarios de varredura compartilhados a support.

### Impacto

- Comportamento preservado: mesmos kinds e mensagens, exercitados pelos testes existentes mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: maquina de correcao de variaveis nao declaradas

### Antes

- O `analyzer.js` mantinha a maquina de correcao usada pela deteccao de variaveis nao declaradas: resolucao da sugestao (incluindo a dica explicita `pingu - correction:`), construcao de snippet/range/action de substituicao e a checagem de seguranca que bloqueia correcoes que alterariam a estrutura do codigo ou tocariam imports.

### Depois

- Esse cluster de nove funcoes foi extraido para `lib/analyzer-undefined-correction.js`, dependendo apenas de utilitarios puros (`replaceIdentifierOnce`/`countMatches` do support e `suggestSimilarIdentifier`). `analyzer.js` importa os cinco pontos de entrada e caiu para 5586 linhas (era 6657 no inicio da serie de modularizacoes).

### Motivo

- Isolar um fluxo coeso e de fronteira limpa dentro do nucleo de undefined-variables, reduzindo o God file sem mexer no detector acoplado em si.

### Impacto

- Comportamento preservado: os golden-fixtures de undefined-variable e o fluxo de dica `pingu - correction:` continuam validando o resultado, mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: checks de texto estruturado

### Antes

- O `analyzer.js` mantinha os checks de leaf para formatos de texto estruturado (titulo Markdown ausente, fence Markdown sem fechamento, Terraform sem required_version, Dockerfile sem WORKDIR).

### Depois

- Esses quatro checks puros foram extraidos para `lib/analyzer-structured-text.js`. `analyzer.js` importa-os (o orquestrador `checkStructuredTextIssues` e o `checkSyntaxIssues` permanecem no analyzer) e caiu para 5725 linhas.

### Motivo

- Continuar a reducao do God file por um dominio coeso e de fronteira limpa (varredura de formatos de texto, sem analise de escopo).

### Impacto

- Comportamento preservado: mesmos kinds e mensagens, exercitados pelos testes existentes mais um smoke test direto do novo modulo.

## Unreleased - Modularizacao: utilitarios de analise lexica de Python

### Antes

- O `analyzer.js` mantinha um cluster de helpers puros de analise lexica de Python (validacao de identificador, leitura de string inline, remocao de comentarios/strings, extracao de nomes importados), alem do utilitario generico `leadingIndentLength`.

### Depois

- Os cinco helpers Python foram extraidos para `lib/python-scope-utils.js` (puros, sem efeito colateral, dependendo apenas de `splitTopLevelParams`); `leadingIndentLength` foi movido para `lib/support.js` (utilitario generico). `analyzer.js` importa o que ainda usa diretamente (`stripPythonInlineSyntax`, `extractPythonImportVars`, `leadingIndentLength`) e caiu para 5829 linhas.

### Motivo

- Continuar a reducao do God file e isolar utilitarios puros reusaveis, abrindo caminho para futuras extracoes do subsistema de escopo.

### Impacto

- Comportamento preservado: os mesmos helpers continuam exercitados pelos testes existentes, mais um smoke test direto do novo modulo.

## Unreleased - Supressao de diagnosticos por kind

### Antes

- Nao havia como o desenvolvedor silenciar uma classe especifica de diagnostico que considerasse ruidosa; o unico controle existente era sobre o auto-fix, nao sobre a exibicao do diagnostico.

### Depois

- `analyzeText` passa a respeitar a variavel de ambiente `PINGU_DISABLED_ISSUE_KINDS` (lista de `kind`s separados por virgula): qualquer issue kind listado e suprimido do resultado, no fim do pipeline (apos confianca/ordenacao/dedup). Funciona para qualquer kind, nao so os de erro humano.

### Motivo

- Dar controle de ruido ao desenvolvedor sem precisar alterar codigo, melhorando a adocao dos novos detectores em times com preferencias diferentes.

### Impacto

- Aditivo e opt-in: sem a variavel, nada muda. No Vim/Neovim, basta `let $PINGU_DISABLED_ISSUE_KINDS = '...'` no init.

## Unreleased - Modularizacao: resolucao de modulos e exports JS

### Antes

- O `analyzer.js` concentrava a resolucao de arquivos de modulo local (caminhos relativos JS/Python, busca em disco) e a coleta de nomes exportados em JavaScript (ESM e CommonJS), passando de 5,9 mil linhas.

### Depois

- Esse cluster foi extraido para `lib/analyzer-module-resolution.js` (`resolveLocalModuleFile`, resolucao JS/Python, busca em disco, e coleta de exports JS). Depende apenas de `fs`/`path`, `language-profiles`, `analyzer-import-bindings` e `support`; o cache continua injetado por parametro. A coleta de exports Python permanece no analyzer por usar helpers de escopo compartilhados.
- `analyzer.js` importa as duas entradas (`resolveLocalModuleFile`, `collectJavaScriptExportNames`) e caiu para 5965 linhas (era 6657 no inicio da serie de modularizacoes).

### Motivo

- Continuar a reducao do God file por uma fatia de fronteira limpa, alinhado a regra de arquivos pequenos do projeto.

### Impacto

- Comportamento preservado: os golden-fixtures de undefined-variable/import continuam validando o fluxo, mais um smoke test do novo modulo.

## Unreleased - Deteccao de parseInt sem radix

### Antes

- O Pingu nao detectava `parseInt(x)` sem o argumento de base, gotcha conhecido de JavaScript (interpretacao ambigua de base, recomendacao da regra `radix` de linters).

### Depois

- `lib/analyzer-redundant.js` ganhou `hasParseIntWithoutRadix`: novo kind `parseint_no_radix` (`autoFixDefault: false`, suggest-only, JavaScript/TypeScript), mapeado na familia `control_flow_and_complexity`. So sinaliza `parseInt` com um unico argumento (sem virgula de topo), usando leitura balanceada de parenteses.
- Conservador: mascara strings antes de detectar (ignora `parseInt` em literais de string), ignora acesso a membro custom (`obj.parseInt`) e chamadas que ja informam a base.

### Motivo

- Mais um erro/gotcha de JavaScript reconhecido por linters, com baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere informar a base (`parseInt(x, 10)`).

## Unreleased - Deteccao de argumento padrao mutavel em Python

### Antes

- O Pingu nao detectava o classico footgun de Python `def f(x=[])`, onde o valor padrao mutavel e compartilhado entre chamadas.

### Depois

- `lib/analyzer-developer-errors.js` ganhou `checkPythonMutableDefaultArg`: novo kind `mutable_default_arg` (`autoFixDefault: false`, suggest-only), mapeado na familia `error_handling`. Detecta defaults `[]`, `{}`, literais nao vazios e `list()/dict()/set()` na assinatura (inclusive `async def` e com type hints).
- Conservador: nao acusa defaults imutaveis (`None`, numeros, strings, tuplas `()`), indices (`g[0]`) nem chamadas que nao sejam `def`.

### Motivo

- Mais um erro humano de altissimo sinal (bug silencioso muito comum em Python).

### Impacto

- Aditivo e seguro: apenas sugere (usar `None` e inicializar dentro da funcao).

## Unreleased - Consolidacao da documentacao de erros humanos

### Antes

- A visao geral do README ("O que o Pingu faz") nao destacava o conjunto de detectores de erro humano construido ao longo das ultimas versoes; nao havia um resumo consolidado das classes detectadas; e a consistencia entre a taxonomia e o `issue-kinds.json` nao era validada por teste.

### Depois

- README ganhou, na visao geral, a mencao explicita a deteccao de erros humanos e a documentacao passo a passo, e uma nova subsecao "Erros humanos detectados" com tabela consolidada (classe, exemplo, linguagens).
- Novo `test/taxonomy-consistency.test.js`: garante que todo kind mapeado na taxonomia existe em `issue-kinds.json`, que os 14 detectores de erro humano sao suggest-only (`autoFixDefault: false`) e que cada familia declara `safeAutoFix` e `languages`.

### Motivo

- Tornar o arsenal de deteccao de erros humanos descoberto e coerente, e travar por teste as invariantes entre configuracao e comportamento.

### Impacto

- Sem mudanca de comportamento em runtime; apenas documentacao e cobertura de invariantes.

## Unreleased - Deteccao de desvio de fluxo em finally

### Antes

- O Pingu nao detectava `return`/`break`/`continue` dentro de `finally`, que engole excecoes e sobrescreve o retorno do `try`/`catch`.

### Depois

- `lib/analyzer-control-flow.js` ganhou `checkControlFlowInFinally` (suggest-only, JavaScript/TypeScript): novo kind `control_flow_in_finally` (`autoFixDefault: false`), mapeado na familia `error_handling`.
- Usa uma pilha de tipos de bloco (`finally`/`function`/outro), entao nao confunde o desvio do `finally` com `return` de funcao aninhada dentro dele; cobre tambem `return` condicional (`if (x) return`) e finally de uma linha.

### Motivo

- Mais um erro humano de alto impacto (mascaramento de excecao) que o compilador nao acusa.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Deteccao de case duplicado em switch

### Antes

- O Pingu nao detectava `case` duplicado num mesmo `switch`, onde a segunda ocorrencia e inalcancavel.

### Depois

- `lib/analyzer-control-flow.js` ganhou `checkDuplicateSwitchCase` (suggest-only, JavaScript/TypeScript): novo kind `duplicate_case` (`autoFixDefault: false`), mapeado na familia `control_flow_and_complexity`.
- Usa uma pilha de contextos de switch com contador de chaves consciente de strings/comentarios, entao nao confunde `case` igual em switches distintos nem em switches aninhados, e ignora `case` em comentario.

### Motivo

- Mais um erro humano de alto sinal e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Deteccao de typeof invalido e comparacao com NaN

### Antes

- O Pingu nao detectava dois bugs silenciosos comuns em JavaScript: comparar `typeof` com uma string de tipo invalida/com typo (`typeof x === "fucntion"`, sempre falsa) e comparar diretamente com `NaN` (`x === NaN`, sempre falsa).

### Depois

- `checkRedundantConstructs` (`lib/analyzer-redundant.js`) ganhou `findInvalidTypeof` e `hasNaNComparison`: novos kinds `invalid_typeof` e `nan_comparison` (`autoFixDefault: false`, suggest-only, apenas JavaScript/TypeScript), mapeados na familia `control_flow_and_complexity`.
- `invalid_typeof` valida contra o conjunto de tipos validos (`undefined`, `object`, `boolean`, `number`, `bigint`, `string`, `symbol`, `function`), inclusive na forma invertida (`"x" === typeof y`). `nan_comparison` sugere `Number.isNaN()`.

### Motivo

- Mais dois erros humanos de alto sinal que o compilador nao acusa.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Vocabulario do resumo offline ampliado

### Antes

- O resumo de proposito da funcao (no fluxo de comentar codigo) reconhecia ~117 verbos no nome da funcao; nomes com verbos fora dessa lista caiam no resumo estrutural.

### Depois

- O mapa `VERB_TRANSLATIONS` em `lib/generation-inline-comments.js` foi ampliado para 278 entradas (ingles e portugues), cobrindo verbos comuns como `select`, `assign`, `subscribe`, `authenticate`, `compress`, `paginate`, `compare`, `classify`, `list` e equivalentes em portugues. Removida tambem uma chave `remove` duplicada pre-existente.

### Motivo

- Melhorar a precisao do resumo "o que a funcao faz" para mais nomes de funcao, em todas as 16 linguagens suportadas pelo fluxo de comentar codigo.

### Impacto

- Aditivo: apenas melhora os resumos; nomes sem verbo conhecido continuam no resumo estrutural.

## Unreleased - Cobertura de typos estendida para 15 linguagens

### Antes

- A deteccao de erros de digitacao cobria apenas JavaScript/TypeScript, Python, Ruby, Go e Rust (5 familias, ~102 entradas).

### Depois

- `config/common-typos.json` ganhou familias para Java, C#, Kotlin, Swift, Scala, PHP, C/C++, Elixir, Lua e Shell, totalizando 15 familias e 261 entradas curadas (todas grafias claramente incorretas de palavras-chave/builtins, sem auto-referencia). A familia `typo_and_naming` da taxonomia passa a listar essas linguagens.

### Motivo

- Levar a deteccao de typos ao mesmo conjunto de linguagens ja suportado para documentacao/geracao, aumentando a cobertura de um erro humano comum.

### Impacto

- Aditivo e seguro: dicionario curado (zero falso-positivo por construcao), suggest-only, sem mudanca de comportamento para as linguagens ja cobertas.

## Unreleased - Deteccao de chave duplicada em objeto/dict

### Antes

- O Pingu detectava auto-comparacao e auto-atribuicao, mas nao chave duplicada em literal de objeto/dict, onde a ultima ocorrencia sobrescreve silenciosamente as anteriores.

### Depois

- `checkRedundantConstructs` (`lib/analyzer-redundant.js`) ganhou `findDuplicateKey`: novo kind `duplicate_key` (`autoFixDefault: false`, suggest-only) para JS/TS e Python, mapeado na familia `control_flow_and_complexity`.
- Conservador: apenas literais de uma linha sem chaves aninhadas, exigindo ao menos dois pares chave:valor com chaves simples; aborta diante de spread/chave computada/shorthand e nao confunde blocos de codigo com objetos.

### Motivo

- Mais um erro humano de alto sinal e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Limpeza de codigo morto (segunda passada)

### Antes

- Restavam funcoes mortas: um cluster de helpers de descricao de instrucao nunca conectado em `lib/support.js` (`matchConditionalStatement`, `looksEarlyExitLine`, `describeConditionalGuard`, `matchReturnStatement`, `looksCommentWorthyReturn`, `describeReturnExpression`, `matchCallStatement`, `describeCallStatement`) e `vimStringLiteral` em `lib/generation.js` (orfa apos a remocao de `executablePlaceholderStatement`), alem do import nao usado `getCapabilityProfile`.

### Depois

- Removidas as nove funcoes mortas (verificadas sem nenhuma referencia) e o import nao usado.

### Motivo

- Reduzir ruido e peso dos arquivos sem alterar comportamento.

### Impacto

- Sem mudanca de comportamento em runtime.

## Unreleased - Deteccao de auto-comparacao e auto-atribuicao

### Antes

- O Pingu nao detectava construcoes redundantes que quase sempre sao bug: `x === x` (sempre verdadeiro/falso) e `x = x` (sem efeito).

### Depois

- Novo modulo `lib/analyzer-redundant.js` com `checkRedundantConstructs` suggest-only (JS/TS e Python): novos kinds `self_comparison` e `self_assignment` (`autoFixDefault: false`), mapeados na familia `control_flow_and_complexity`.
- Conservador: nao acusa `this.x = x`, `const x = x` (referencia a escopo externo), `x = x.next`, comparacao entre chamadas (`f() === f()`) nem ocorrencias em comentario.

### Motivo

- Ampliar a deteccao de erros humanos com mais dois casos de alto sinal e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere.

## Unreleased - Geracao offline de funcao para PHP

### Antes

- PHP ficou de fora da geracao offline de funcao porque o corpo gerado usava nomes nus (`a + b`), invalidos em PHP, e a assinatura caia no fallback sem `$`.

### Depois

- `functionSignature` emite `function nome($a, $b) {` para PHP e `buildRenderedFunctionSnippet` aplica `phpVariableizeBody`, prefixando com `$` as referencias aos parametros no corpo (preservando as ja prefixadas). `baseHint` cobre o retorno PHP com ponto e virgula. Resultado: `function soma($a, $b) { return $a + $b; }`.

### Motivo

- Completar a geracao offline de esqueleto de funcao para as seis linguagens recém-adicionadas (Java, C#, Kotlin, Swift, Scala e agora PHP).

### Impacto

- Aditivo: apenas melhora a saida de `code` para PHP.

## Unreleased - Geracao offline de funcao para Java, C#, Kotlin, Swift e Scala

### Antes

- Para Java, C#, Kotlin, Swift e Scala, a geracao offline de codigo (`@pingu code funcao ...`) caia no fallback estilo JavaScript (`function nome(a, b) { ... }`), produzindo assinatura nao idiomatica.

### Depois

- `functionSignature` em `lib/generation.js` passa a renderizar assinaturas idiomaticas para essas linguagens: `public Object nome(Object a, ...)` (Java), `public object nome(object a, ...)` (C#), `fun nome(a: Any, ...): Any` (Kotlin), `func nome(_ a: Any, ...) -> Any` (Swift) e `def nome(a: Any, ...): Any =` (Scala). `baseHint` cobre o retorno de Swift/Scala (sem ponto e virgula).
- Nenhuma mudanca de capacidade foi necessaria: o runtime ja roda essa geracao offline; o fix corrige apenas a assinatura emitida.

### Motivo

- Completar a geracao offline de esqueleto de funcao para as linguagens JVM/.NET que ja eram suportadas para documentacao, entregando codigo idiomatico em vez do fallback.

### Impacto

- Aditivo: somente melhora a saida de `code` para essas cinco linguagens. PHP fica de fora por ora (variaveis `$` exigem transformar o corpo gerado, nao so a assinatura).

## Unreleased - Modularizacao: parsers de import bindings

### Antes

- O `analyzer.js` concentrava os parsers de import bindings (JS/TS e Python) usados na validacao de bindings inexistentes, alem do util generico `splitTopLevelParams`.

### Depois

- `splitTopLevelParams` foi movido para `lib/support.js` (util de string generico, ao lado de `escapeRegExp` e afins).
- Os parsers puros de import bindings foram extraidos para `lib/analyzer-import-bindings.js` (`supportsLocalImportBindingValidation`, `parseLocalImportBindings`, leitura de import ESM/CommonJS multilinha, `from import` Python, `isRelativeModuleSpecifier`). Sao funcoes sem efeito colateral; a resolucao de arquivos/exports e o cache permanecem no analyzer por dependerem de IO e de helpers de escopo.
- `analyzer.js` importa as entradas do novo modulo e caiu ~180 linhas.

### Motivo

- Continuar a reducao do God file `analyzer.js` por uma fatia de fronteira limpa (parsers puros), sem mover o subsistema acoplado de resolucao/escopo (que exigiria refactor maior e mais arriscado).

### Impacto

- Comportamento preservado: os mesmos checks de bindings inexistentes continuam validados pelos golden-fixtures e demais testes, mais um smoke test do novo modulo.

## Unreleased - Deteccao de await ausente

### Antes

- O Pingu nao detectava chamadas a funcoes async deixadas sem await (fire-and-forget), uma fonte comum de bug de ordem de execucao e rejeicao nao tratada.

### Depois

- Novo modulo `lib/analyzer-async.js` com `checkMissingAwait` suggest-only para JavaScript/TypeScript: coleta funcoes async definidas no arquivo (`async function`, `const x = async`, metodo `async nome`) e sinaliza chamadas a elas usadas como instrucao isolada sem `await`/`return`/`void` e sem `.then`/`.catch`. Novo issue kind `missing_await` (`autoFixDefault: false`), mapeado na familia `error_handling`.
- Conservador: nao acusa quando a promise e consumida (await/return/.then/void) ou atribuida, nem chamadas a funcoes sincronas.

### Motivo

- Ampliar a deteccao de erros humanos com um caso de alto impacto (promises nao aguardadas) e baixo falso-positivo.

### Impacto

- Aditivo e seguro: apenas sugere; adicionar await muda semantica e exige funcao async no escopo, por isso nunca e automatico.

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
