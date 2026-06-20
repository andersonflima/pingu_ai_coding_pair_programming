# Changelog

Todas as mudancas relevantes deste projeto devem registrar antes, depois, motivo tecnico e impacto esperado.

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
