# Pingu - Dev Agent

<p align="center">
  <img src="./assets/pingu.png" alt="Pingu, a cara do Pingu - Dev Agent" width="240" />
</p>

Pingu e um agente de pair programming em tempo real orientado a arquivo e editor. Ele nao foi desenhado como um chat generico. Ele observa o buffer atual, encontra problemas e pedidos explicitos no proprio codigo, gera snippets idiomaticos por linguagem, cria contexto persistente, sugere ou cria testes, injeta dependencias faltantes e executa acoes de terminal com politica de risco.

O projeto funciona hoje em `Vim/Neovim`, com foco pratico em `LazyVim`, runtime local e cobertura offline por linguagem. Isso significa que uma parte grande do fluxo funciona sem API key.

## O que o Pingu faz

- Analisa o arquivo atual em tempo real e publica diagnosticos orientados a manutencao.
- Interpreta comentarios acionaveis para gerar codigo no proprio arquivo.
- Cria `context_file` a partir de blueprints descritos no comentario, com scaffold nativo nas stacks principais.
- Sugere cobertura de testes e atualizacao de testes existentes de forma opt-in: o Pingu aponta o que falta (ou o teste relacionado a um metodo alterado) e so cria ou ajusta quando o desenvolvedor aplica a sugestao.
- Detecta dependencias faltantes quando o snippet gerado exige imports, `use`, `require` ou `#include`.
- Consulta bibliotecas Node instaladas e importadas pelo buffer para orientar geracoes e correcoes com base na API real da dependencia.
- Tenta inserir imports e includes na fronteira correta do arquivo em vez de simplesmente despejar tudo na linha do comentario.
- Executa `terminal_task` com inferencia por stack e politica de risco configuravel.
- Expoe follow-up acionavel para continuar o pareamento sem sair do arquivo.
- Mantem um fluxo unico e consistente para `LazyVim`, `Vim` e `Neovim`.

## O que o Pingu melhora para quem usa

- Reduz troca de contexto: o pedido nasce no comentario do codigo e a resposta volta para o proprio arquivo.
- Acelera scaffolding: funcoes, estruturas, blueprints e testes saem sem interromper o fluxo.
- Diminui repeticao: imports, snippets base, comentarios de manutencao e testes complementares deixam de ser trabalho manual.
- Mantem consistencia arquitetural: o contexto `**` registra regras de stack e de arquitetura para orientar geracoes futuras.
- Torna o loop de review mais curto: o agente analisa, sugere, aplica, remove o gatilho e reanalisa.
- Funciona bem em ambiente local: boa parte das capacidades ja esta no runtime offline.

## Barra de excelencia

O backlog oficial da barra de excelencia do agente esta em [docs/agent-excellence-backlog.md](./docs/agent-excellence-backlog.md).

Esse contrato organiza o que o Pingu precisa fazer automaticamente para ser excelente:

- nao quebrar codigo nem imports
- operar no arquivo atual por padrao
- comentar e corrigir com contexto real
- validar e reverter sozinho quando piorar o estado do arquivo
- manter baixo custo no loop de edicao

## Taxonomia de erros de desenvolvimento

A taxonomia versionada fica em [config/developer-error-taxonomy.json](./config/developer-error-taxonomy.json).

Ela organiza os erros que o Pingu deve tratar por familias:

- sintaxe e estrutura
- higiene de workspace
- nulabilidade e igualdade
- erros de digitacao em palavras-chave e builtins
- imports e dependencias
- tratamento de erros
- contrato publico
- arquitetura e testes
- fluxo/complexidade
- comandos de runtime

Nem toda classe de erro tem auto-fix seguro. Quando a correcao depende de tipo, framework, contrato de dominio ou efeito colateral externo, o Pingu deve sinalizar ou pedir contexto em vez de reescrever especulativamente.

Correcoes deterministicas ja mapeadas:

- JavaScript/TypeScript: `==` e `!=` viram `===` e `!==` quando nao envolvem `null`/`undefined`.
- Python: `== None` e `!= None` viram `is None` e `is not None`.
- Python: `except:` vira `except Exception:`.
- Ruby: comparacoes diretas com `nil` viram `nil?`.
- Elixir: comparacoes diretas com `nil` viram `is_nil/1`.

### Auto-comparacao, auto-atribuicao e chave duplicada (sugestao)

Em JavaScript/TypeScript e Python, o Pingu sinaliza `x === x` / `x == x` (sempre verdadeiro/falso), `x = x` (sem efeito) e chave duplicada em literal de objeto/dict de uma linha (`{ a: 1, a: 2 }`, onde a ultima sobrescreve as anteriores). Quase sempre sao bug humano. Conservador: nao acusa `this.x = x`, `const x = x` (escopo externo), `x = x.next`, comparacao entre chamadas (`f() === f()`) nem blocos de codigo/objetos com spread ou chave computada.

Especificamente em JavaScript/TypeScript, tambem sinaliza dois bugs silenciosos comuns: `typeof x === "fucntion"` (string de tipo invalida/com typo, sempre falsa — os tipos validos sao `undefined`, `object`, `boolean`, `number`, `bigint`, `string`, `symbol`, `function`) e comparacao direta com `NaN` (`x === NaN`, sempre falsa — use `Number.isNaN()`).

### Import nao utilizado (sugestao)

Em JavaScript/TypeScript e Python, o Pingu sinaliza imports cujo nome nunca e referenciado no arquivo (named, default, namespace `* as`, `require` desestruturado, `import`/`from import`). E suggest-only e conservador: imports por efeito colateral (`import 'polyfill'`) sao ignorados, e qualquer ocorrencia do nome (inclusive em JSX, acesso a propriedade ou anotacao de tipo) conta como uso, para evitar falso positivo.

### Variavel local nao utilizada (sugestao)

Em JavaScript/TypeScript, o Pingu sinaliza variaveis locais (`const`/`let` indentadas) cujo nome nunca e referenciado e cujo lado direito e "puro" (sem chamada de funcao, `await`, `new` ou arrow), onde remover nao muda comportamento. E deliberadamente conservador: ignora declaracoes de modulo (que podem ser exportadas), nomes prefixados com `_` e qualquer atribuicao com possivel efeito colateral.

### await ausente (sugestao)

Em JavaScript/TypeScript, o Pingu sinaliza uma chamada a funcao async definida no arquivo usada como instrucao isolada (fire-and-forget) sem `await`, `return`, `void` ou encadeamento `.then`/`.catch` — padrao que costuma ser bug de ordem de execucao ou rejeicao nao tratada. Conservador: nao acusa quando a promise e consumida ou atribuida, nem chamadas a funcoes sincronas.

### Codigo inalcancavel e erros engolidos (sugestao)

O Pingu sinaliza dois erros humanos de fluxo que o compilador costuma deixar passar, em JavaScript/TypeScript e Python:

- **Codigo inalcancavel**: instrucao no mesmo bloco logo apos um `return`/`throw`/`raise`/`break`/`continue`. Ignora terminais dentro de `if` (a proxima linha com indentacao menor e alcancavel).
- **Erro engolido**: `catch {}` vazio em JS e `except ...: pass` em Python. Sugere tratar, registrar ou repropagar. Nao acusa quando o bloco trata/loga o erro.
- **`case` duplicado em `switch`** (JavaScript/TypeScript): dois `case` com o mesmo valor no mesmo switch — o segundo e inalcancavel. Usa uma pilha de contextos, entao nao confunde switches distintos nem aninhados.
- **`return`/`break`/`continue` dentro de `finally`** (JavaScript/TypeScript): desviar o fluxo no `finally` engole excecoes e sobrescreve o retorno do `try`/`catch`. Usa uma pilha de tipos de bloco, entao nao confunde com `return` de funcao aninhada dentro do `finally`.

Todos sao suggest-only (nunca reescrevem).

### Atribuicao acidental em condicao (sugestao)

Em JavaScript/TypeScript, `if (x = y)` compila sem erro mas quase sempre era para ser uma comparacao. O Pingu sinaliza esse caso e sugere `===`, ignorando comparacoes (`==`, `===`, `<=`), operadores compostos (`+=`), arrow functions (`=>`), `=` dentro de strings e o idioma de atribuicao intencional com parenteses duplos (`if ((m = regex.exec(s)))`). E suggest-only: nunca reescreve sozinho.

### Erros de digitacao (sugestao, sem reescrita automatica)

O Pingu detecta erros de digitacao em palavras-chave e builtins comuns (por exemplo `cosole.log`, `fucntion`, `retrun`, `improt`, em Python `pirnt`, `slef`, `Flase`) e responde com `Voce quis dizer 'X'?`. Cobre JavaScript/TypeScript, Python, Ruby, Go, Rust, Java, C#, Kotlin, Swift, Scala, PHP, C/C++, Elixir, Lua e Shell. Esse fluxo e deliberadamente conservador:

- so reconhece grafias claramente incorretas, versionadas em [config/common-typos.json](./config/common-typos.json);
- ignora ocorrencias dentro de strings e comentarios;
- nunca casa um typo como substring de um identificador maior;
- nunca reescreve automaticamente (`typo` tem `autoFixDefault: false`): a correcao so e aplicada quando o desenvolvedor aceita no editor.

## Operacao de issues

O fluxo de melhoria continua do Pingu via GitHub Issues esta em [docs/triage.md](./docs/triage.md).

Esse fluxo define:

- template minimo para bug e improvement
- labels sugeridas para triagem
- prioridades `P0`, `P1` e `P2`
- regra de reproducao minima e criterio de aceite
- manifesto versionado de labels em `.github/labels.json`
- workflow manual `sync-issue-labels` para sincronizar labels no GitHub

## Release, contribuicao e seguranca

- Release rastreavel: [docs/release.md](./docs/release.md)
- Instrucoes operacionais do agente: [AGENTS.md](./AGENTS.md)
- Contrato de seguranca operacional: [SECURITY.md](./SECURITY.md)
- Validacao local e sincronizacao do runtime Vim: [CONTRIBUTING.md](./CONTRIBUTING.md)

## O que o Pingu nao e

- Nao e um chat generico de perguntas soltas.
- Nao substitui decisao arquitetural do time.
- Nao promete gerar qualquer coisa em qualquer linguagem sem contrato de capacidade.
- Nao gera cobertura para arquivos que ja estao dentro de `tests/` ou `test/`, evitando loop de auto-geracao.

## Instalacao rapida

### CLI `pingu`

Quando o pacote estiver publicado no npm:

```bash
npm install -g @andersonflima/pingu-dev-agent
pingu doctor
```

Enquanto o primeiro publish no npm nao estiver concluido, instale direto do GitHub:

```bash
npm install -g github:andersonflima/pingu_ai_coding_pair_programming
pingu doctor
```

Para desenvolvimento local:

```bash
git clone git@github.com:andersonflima/pingu_ai_coding_pair_programming.git
cd pingu_ai_coding_pair_programming
npm ci --ignore-scripts
npm link
pingu doctor
```

### IDE

Para Vim, Neovim e LazyVim, instale o plugin pelo GitHub conforme a secao [Instalacao via GitHub no Vim](#instalacao-via-github-no-vim). A IDE usa o mesmo runtime do CLI, entao `pingu doctor` tambem ajuda a validar Node.js, runtime local e linguagens ativas.

Quando o runtime inicia com sucesso no editor, o plugin emite notificacao operacional com a mensagem `Noot noot!`.

## Como o loop funciona

1. Voce abre um arquivo suportado em `Vim/Neovim`.
2. O Pingu analisa o buffer em abertura, foco, edicao e `save`, conforme o fluxo do editor.
3. Quando encontra um comentario acionavel, ele transforma isso em uma issue do tipo:
   - `comment_task`
   - `context_file`
   - `unit_test`
   - `terminal_task`
4. O editor aplica a acao automaticamente ou via quick fix, dependendo do fluxo.
5. Quando a acao termina com sucesso, a linha gatilho e removida sem deixar o buffer aberto divergente do arquivo escrito em disco.
6. O arquivo e reanalisado para continuar o pareamento.

O runtime que atende a IDE e o CLI e o mesmo. Isso significa que os comentarios acionaveis sao detectados pelo mesmo analisador nos dois modos. A diferenca intencional e operacional: `pingu fix` corrige apenas erros locais seguros; `pingu prompts` executa explicitamente os prompts dos comentarios.

## Tipos de comentario acionavel

### `@pingu` declara a intencao de forma explicita

O formato recomendado para novos prompts em comentarios e `@pingu <intencao> <pedido>`:

```javascript
// @pingu code cria funcao soma
// @pingu fix refatora essa funcao para ser pura
// @pingu context bff para crud de usuario
// @pingu test cobre casos de borda da funcao soma
// @pingu terminal roda os testes unitarios
```

Tambem e aceito o formato `pingu: <intencao> <pedido>`:

```python
# pingu: code implementar funcao para calcular total do pedido
```

Intencoes suportadas:

- `code`, `fix`, `refactor`: gera ou ajusta codigo (`comment_task`). A geracao offline de esqueleto de funcao cobre as principais stacks, incluindo Java, C#, Kotlin, Swift, Scala e PHP (assinatura idiomatica com tipos `Object`/`object`/`Any`, variaveis `$` em PHP e retorno inferido).
- `comment`, `doc`, `document`: comenta a funcao seguinte passo a passo, com docstring idiomatico, sem alterar o codigo (`comment_task`)
- `context`, `ctx`, `blueprint`, `scaffold`: cria contexto persistente/scaffold (`context_file`)
- `test`, `tests`, `unit-test`: gera um prompt de codigo orientado a testes (`comment_task`)
- `terminal`, `shell`, `cmd`, `command`, `run`: prepara acao de terminal (`terminal_task`)

Para documentar/comentar o codigo existente, escreva o gatilho logo acima da funcao:

```python
# : comment this code
def helper(planta, fert):
    use_item(fert)
    return planta
```

Ao aplicar, o Pingu insere um doc idiomatico e um comentario factual antes de cada instrucao relevante (`# Chama use_item.`, `# Retorna planta.`), preservando todas as linhas de codigo originais e removendo o gatilho. O fluxo e idempotente: se a funcao ja estiver documentada e comentada, nada e sugerido.

O resumo do doc descreve **o que** a funcao faz (proposito inferido do nome e dos efeitos/retorno do corpo, p.ex. `Calcula frete, retornando total.`), enquanto os comentarios passo a passo descrevem **o como**.

Disponivel offline para Python, JavaScript/TypeScript, Go, Rust, C/C++, Ruby, Elixir, Lua, Vim, Shell, Java, C#, Kotlin, Swift, Scala e PHP. O doc segue a convencao de cada linguagem (docstring Python apos a assinatura; JSDoc/JavaDoc/KDoc/Scaladoc/PHPDoc no estilo `/** */`; `///` em Rust/C#/Swift; `@doc` em Elixir; comentario de cabecalho acima da funcao nas demais).

Os marcadores simbolicos abaixo continuam suportados como atalhos compatíveis.

### `:` ou `::` gera ou ajusta codigo

Use o prefixo de comentario da linguagem seguido de `:`:

```javascript
//: funcao soma
```

Em linguagens com comentario `//`, o formato recomendado para evitar ambiguidade com bloco e JSDoc e `//::`:

```javascript
//:: funcao soma
```

```python
#: implementar funcao para calcular total do pedido
```

```elixir
#:: funcao soma
```

```lua
--: cria modulo billing com funcoes listar e criar
```

Para comentario de bloco, use marcador explicito dentro do bloco (`/*::`), em vez de texto livre:

```c
/*:: funcao dice que retorna um numero random de um dado de 20 lados */
```

### `**` ou `:::` cria contexto persistente e pode gerar scaffold

```javascript
// ** bff para crud de usuario
```

Formato recomendado em comentarios com `//`:

```javascript
//::: bff para crud de usuario
```

```lua
-- ** projeto existente usa onion architecture, controllers finos e casos de uso puros
```

```elixir
#::: contexto Phoenix usa contexts por dominio, funcoes puras no core e Ecto apenas na fronteira
```

Quando o blueprint descreve um fluxo de BFF CRUD, o scaffold nativo hoje e mais forte em:

- `JavaScript` e `TypeScript`
- `Python`
- `Go`
- `Rust`
- `Elixir`
- `Ruby`
- `C`

### `*` executa acao de terminal

```javascript
//* rodar testes
```

```python
# * listar arquivos do projeto
```

```elixir
# * rodar testes
```

```lua
-- * executar este arquivo
```

### Marcadores escapados

Se voce quiser manter o comentario literal e impedir a acao do agente, use as variantes escapadas:

- `\s:`
- `\s::`
- `\s*`
- `\s**`
- `\s:::`
- `\s@pingu`

## Exemplos reais de uso e output

### 1. Geracao simples de funcao em JavaScript

Entrada:

```javascript
//: funcao soma
```

Output gerado:

```javascript
/**
 * Orquestra o comportamento principal de soma
 * @param {*} a Parametro de entrada do fluxo.
 * @param {*} b Parametro de entrada do fluxo.
 * @returns {*} Valor calculado conforme a regra principal da funcao.
 */
function soma(a, b) {
  // Retorna o resultado consolidado desta funcao.
  return a + b
}
```

O que melhora aqui:

- a funcao ja nasce com nome util
- a assinatura vem coerente com a intencao
- a documentacao minima de manutencao ja entra junto

### 2. Funcao com marcador explicito em C

Entrada:

```c
//:: funcao dice que retorna um numero random de um dado de 20 lados
```

Output gerado no arquivo:

```c
int dice(void) {
  // Retorna o resultado consolidado desta funcao.
  return (rand() % 20) + 1;
}
```

Output complementar de dependencia:

```c
#include <stdlib.h>
```

O que melhora aqui:

- o gatilho fica explicito e menos sujeito a falso positivo em comentario livre
- o retorno fica consistente com a semantica de `d20`
- o agente detecta o `#include` faltante

### 3. Blueprint de contexto com scaffold inicial

Entrada:

```javascript
//::: bff para crud de usuario
```

Outputs tipicos:

- atualiza `.gitignore` para ignorar `.pingu-dev-agent/`
- cria `.pingu-dev-agent/contexts/bff-crud-usuario.md`
- cria scaffold inicial seguindo Onion Architecture e o source root da stack atual

Arquivos tipicos gerados:

```text
.pingu-dev-agent/contexts/bff-crud-usuario.md
src/domain/entities/usuario.js
src/domain/repositories/usuario-repository.js
src/application/use-cases/list-usuarios.js
src/application/use-cases/get-usuario-by-id.js
src/application/use-cases/create-usuario.js
src/application/use-cases/update-usuario.js
src/application/use-cases/delete-usuario.js
src/infrastructure/repositories/in-memory-usuario-repository.js
src/interfaces/http/controllers/usuario-controller.js
src/interfaces/http/routes/usuario-routes.js
src/main/factories/usuario-crud-factory.js
```

Exemplo equivalente em Python:

```text
.pingu-dev-agent/contexts/bff-crud-usuario.md
app/domain/usuario.py
app/domain/usuario_repository.py
app/application/create_usuario.py
app/infrastructure/in_memory_usuario_repository.py
app/main/build_usuario_crud.py
```

O que melhora aqui:

- o time registra contexto arquitetural duravel
- o agente passa a usar esse contrato nas proximas geracoes
- o bootstrap de um BFF CRUD deixa de ser trabalho repetitivo

### 4. Acao de terminal no Vim / Neovim

Entrada:

```javascript
//* rodar testes
```

Output esperado no terminal:

```text
[Pingu] command: npm test
...
[Pingu] exit code: 0
[Pingu] terminal pronto para o proximo comando.
```

Comportamento esperado:

- o terminal do editor abre
- o comando e inferido pelo contexto do projeto
- a linha gatilho e removida quando o processo termina com sucesso

### 5. Follow-up acionavel

Quando o editor encontra um problema elegivel, o Pingu pode inserir um follow-up logo abaixo do trecho atual.

Exemplo de output:

```javascript
// : Use um ticket ou comentario estruturado para pedir a proxima alteracao aqui
```

O que melhora aqui:

- o pareamento continua no proprio arquivo
- o desenvolvedor nao precisa lembrar a sintaxe do marcador
- o editor vira a superficie principal de colaboracao com o agente

### 6. Diagnosticos de manutencao

Mesmo sem comentario acionavel, o Pingu pode propor manutencao.

Exemplo em Python:

Entrada:

```python
def soma(a, b):
    return a + b
```

Output tipico:

- `function_doc`
- `flow_comment`

Snippets esperados:

```python
# Orquestra o comportamento principal de soma
# a: parametro de entrada do fluxo.
# b: parametro de entrada do fluxo.
# Retorno: Valor calculado conforme a regra principal da funcao.
```

```python
    # Retorna o resultado consolidado desta funcao.
```

## O que o `:` consegue construir

O parser do `:` ja entende intencao explicita e tenta gerar estrutura idiomatica por linguagem.

Categorias suportadas:

- `function`
- `crud`
- `ui`
- `test`
- `comment`
- `enum`
- `class`
- `interface` ou `type`
- `struct`
- `module` ou `namespace`
- `object`
- `collection`
- `variable`
- `script` (principalmente em Shell)

Quando uma estrutura equivalente ja existir no arquivo, o agente tenta evitar duplicacao.

## Cobertura por linguagem

O contrato declarativo canonico fica em `lib/language-capabilities.js`. Esse arquivo define extensoes, `editorFeatures`, `commentTaskIntents`, capacidades offline e boas praticas da linguagem.

Resumo pratico:

- JavaScript, TypeScript e React:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, CRUD, UI, enum, class, interface/type, module, objeto, colecao e variavel
- Python:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, Enum, class, module, object, collection e variable
- Elixir:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `defmodule`, contratos com `@type`, enums por atoms e CRUD inicial
- Go:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `interface`, enum tipado, module e object
- Rust:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `trait`, `enum`, `mod`, object e collection
- Ruby:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `class`, `module`, `Struct`, hash e enum equivalente
- C:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, `struct`, `enum` e contratos simples
- Lua:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, modulos, tabelas, enums equivalentes e CRUD inicial
- Vimscript:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, namespace local, dicionarios e helpers de automacao
- Shell (`.sh`, `.bash`, `.zsh`):
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  funcoes, scripts, colecoes simples e enums equivalentes
- Terraform:
  `comment_task`, `context_file`, `terminal_task`
  snippets estruturados, `required_version` e blueprint de contexto; nao gera `unit_test`
- YAML:
  `comment_task`, `context_file`, `terminal_task`
  configuracao estruturada; nao gera `unit_test`
- Markdown:
  `comment_task`, `context_file`, `terminal_task`
  documentos e terminal acionavel por comentario; nao gera `unit_test`
- Mermaid:
  `comment_task`, `context_file`, `terminal_task`
  diagramas e terminal acionavel por comentario; nao gera `unit_test`
- Dockerfile:
  `comment_task`, `context_file`, `terminal_task`
  contrato de `WORKDIR`, contexto persistente e snippets operacionais; nao gera `unit_test`
- TOML:
  `comment_task`, `context_file`, `terminal_task`
  configuracao, secoes estruturadas e terminal por comentario; nao gera `unit_test`

Maturidade automatica atual do core:

| Linguagem | Comentarios e docs | Correcoes de codigo | Testes automaticos | Observacao |
| --- | --- | --- | --- | --- |
| JavaScript / TypeScript | forte | forte | forte | cobre `function_doc`, `class_doc`, `variable_doc`, `context_contract` e testes para funcoes e classes exportadas |
| Python | forte | forte | forte | cobre `function_doc`, `class_doc`, `variable_doc`, `context_contract` e testes para funcoes e classes |
| Elixir | forte | forte | forte | cobre `@moduledoc`, `@doc`, `@spec`, `context_contract` e testes publicos do modulo |
| Go | forte | forte | forte | cobre `function_doc`, `context_contract` e testes para funcoes e tipos publicos |
| Rust | forte | forte | forte | cobre `function_doc`, `context_contract` e testes para funcoes e tipos publicos |
| Ruby | forte | forte | forte | cobre `function_doc`, `class_doc`, `variable_doc`, `context_contract` e testes para funcoes e classes |
| C | forte | forte | forte | cobre `function_doc`, `context_contract` e testes de contrato nativos |
| Lua | forte | parcial | forte | cobre `function_doc`, `variable_doc`, `context_contract` e testes de disponibilidade do modulo |
| Vimscript | forte | parcial | forte | cobre `function_doc`, `context_contract` e testes de disponibilidade por funcao |
| Shell | forte | parcial | forte | cobre `function_doc`, `context_contract` textual e testes de contrato em shell |
| Terraform / YAML / Markdown / Mermaid / Dockerfile / TOML | forte | estrutural | forte | foco em `comment_task`, `context_file`, testes de contrato e terminal acionavel |

## Sincronismo automático em alteração de assinatura

- O Pingu trata mudança de assinatura como um contrato de manutenção, não apenas como mudança de texto.
- Para funções/métodos públicos detectáveis, ele pode:
  - ajustar `function_doc` para refletir a assinatura atual;
  - ajustar `function_spec` em Elixir quando a aridade diverge;
  - registrar `unit_test_signature` quando chamadas em testes não combinam mais com a nova aridade.
- Para documentacao automatica de classes, variaveis e comentarios de fluxo, o runtime tambem valida o simbolo atual da declaracao antes de aplicar uma acao antiga.
- Para `unit_test_signature`, a validacao usa um contrato estrutural da declaracao: tipo do simbolo, nome qualificado, faixa de aridade, parametros e linha de origem.
- Em Elixir, comentarios automaticos redundantes entre `@doc` e `@spec` entram na mesma faixa de atualizacao do `@doc`, evitando restos como `# Funcao start:` apos renomear a funcao para `sstart`.
- Esse comportamento ocorre em modo offline e por heurística de linguagem já mapeada; quando não há confiança suficiente, não altera e mantém a ação para revisão.

## Regras de testes automaticos

- O agente cria automaticamente `tests/` ou `test/` pelo convenio da linguagem quando a pasta ainda nao existir.
- Quando o arquivo ainda nao tem teste correspondente, ele cria o teste base.
- Quando o arquivo ja tem teste base, ele tenta gerar testes complementares para simbolos publicos ainda sem cobertura.
- Em linguagens com classe ou tipo publico, o agente tambem gera teste de disponibilidade para essas estruturas, nao so para funcoes.
- Para `Dockerfile`, `compose`, `Markdown` e `Mermaid`, o agente gera testes de contrato em shell dentro de `tests/`.
- Em `function_doc` e `unit_test_signature`, a revisão automática é aplicada a partir da assinatura atual detectada: se a função muda de parâmetros, chamadas de teste e documentação mínima de contrato podem ser atualizadas no mesmo ciclo.

## Como o terminal e inferido

O Pingu tenta escolher o comando mais natural para o projeto e para a linguagem:

- Node.js: `npm test`, `npm run dev`, `npm run build`, `npm run lint`, `npm run format`
- Elixir: `mix test`, `mix run`, `mix compile`, `mix format`
- Go: `go test ./...`, `go run`, `go build ./...`, `gofmt -w`
- Rust: `cargo test`, `cargo run`, `cargo build`, `cargo fmt`, `cargo clippy`
- Python: `python -m pytest`, `python3 -m pytest`, `python arquivo.py`, `python3 arquivo.py`, `python -m py_compile`, `python3 -m py_compile`
- Ruby: `ruby arquivo.rb` ou testes quando `test/` existir
- Vimscript: `nvim --headless -u NONE -i NONE -S arquivo +qa!`
- Comandos genericos de leitura: `pwd`, `ls -la`, `git status`, `git diff`

## Como o Pingu aparece em cada editor

### Vim / Neovim

- analise continua
- painel do agente
- auto-fix
- `terminal_task`
- follow-up no painel

Atalhos principais:

- `<leader>pic`: analisa o arquivo atual
- `<leader>pia`: abre o menu interativo de actions da issue atual
- `<leader>piw`: abre ou fecha o painel
- `<leader>pif`: aplica a correcao disponivel na linha atual
- `<leader>pis`: interrompe jobs/timers ativos do Pingu
- em uma linha com hint do Pingu, o hover automatico mostra problema, explicacao e diff sem actions; use `<leader>pia` para abrir o popup interativo com actions
- `<Tab>`, `i` ou `a`: aplica a sugestao selecionada
- `f`: insere follow-up acionavel
- `r`: reanalisa
- `q`: fecha o painel

Comandos principais no editor:

- `:PinguCheck`
- `:PinguWindowCheck`
- `:PinguWindowClose`
- `:PinguWindowToggle`
- `:PinguPrompt`
- `:PinguHintsRefresh`
- `:PinguAutoFixNow`
- `:PinguFixCurrent`
- `:PinguFixCurrentAI`
- `:PinguPreviewFix`
- `:PinguIssueActions`
- `:PinguIssueApply`
- `:PinguIssuePreview`
- `:PinguIssueAI`
- `:PinguIssueExplain`
- `:PinguIssueCheck`
- `:PinguIssueUndo`
- `:PinguIssueHistory`
- `:PinguIssuePanel`
- `:PinguIssueQueue`
- `:PinguActionHistory`
- `:PinguQfNext`
- `:PinguQfPrev`
- `:PinguUndoFix`
- `:PinguLatencyMetrics`
- `:PinguAutoFixEnable`
- `:PinguAutoFixDisable`

Indicador de status:

- o runtime expõe `PinguStatusline()` para statusline Vim/Neovim e `_G.PinguStatusline()` para componentes Lua
- por padrao, `g:pingu_statusline_enabled = 1` e `g:pingu_statusline_icon = ''`
- quando uma analise ou auto-fix esta rodando, o indicador mostra ` Pingu...`
- quando a ultima analise encontrou sugestoes, o indicador mostra a contagem, por exemplo ` Pingu 3`
- para adicionar automaticamente o indicador na statusline nativa, use `let g:pingu_statusline_auto = 1`

Exemplo com `lualine.nvim` no LazyVim:

```lua
{
  "nvim-lualine/lualine.nvim",
  opts = function(_, opts)
    table.insert(opts.sections.lualine_x, 1, function()
      return _G.PinguStatusline and _G.PinguStatusline() or ""
    end)
  end,
}
```

## CLI de terminal

O Pingu tambem pode ser usado fora do editor como CLI, mantendo os flags legados que o Vim/Neovim ja usam.

Comandos principais:

```bash
pingu analyze src/app.js --json
pingu analyze src/app.js src/domain/user.py --json
pingu analyze src --json
pingu analyze --stdin --source-path src/app.js --json
pingu fix src/app.js
pingu fix src/app.js --write
pingu fix src --check
pingu fix src --write
pingu prompts src/app.js
pingu prompts src/app.js --write
pingu prompts src --check
pingu comments src/app.js --write
pingu prompts lib/calculator.ex --write
pingu analyze lib/calculator.ex test/calculator_test.exs --json
pingu init --json
pingu profile --lines 180 --json
pingu offline --json
pingu taxonomy
pingu doctor
```

Equivalentes pelo entrypoint direto:

```bash
node pingu_dev_agent.js analyze src/app.js --json
node pingu_dev_agent.js fix src/app.js --write --json
node pingu_dev_agent.js prompts src/app.js --write --json
node pingu_dev_agent.js init --json
node pingu_dev_agent.js profile --json
node pingu_dev_agent.js taxonomy --json
node pingu_dev_agent.js doctor --json
```

Contratos:

- `analyze` usa o mesmo motor do editor, aceita arquivos/diretorios e nao escreve arquivos.
- `fix` mostra um plano por padrao e so escreve com `--write`.
- `fix --write` aplica apenas correcoes locais de erro/higiene com alta confianca no proprio arquivo.
- `fix --check` nao escreve e retorna exit code `1` quando houver correcao aplicavel; use em CI/pre-commit.
- geracao estrutural, `comment_task`, testes, arquivos adjacentes e terminal continuam fora do `fix` padrao.
- `prompts` mostra os comentarios acionaveis encontrados e nao escreve por padrao.
- `prompts --write` executa `comment_task` e `context_file` de forma explicita, usando o mesmo motor da IDE e validando o resultado antes de concluir.
- `prompts --check` nao escreve e retorna exit code `1` quando existir prompt acionavel pendente; use em CI/pre-commit quando quiser bloquear comentarios `//::`, `#:` ou equivalentes nao aplicados.
- `comments` e alias de `prompts`.
- `offline` mostra a cobertura offline das linguagens ativas para `comment_task`, `context_file`, `unit_test` e `terminal_task`.
- `init` cria `.pingu/config.json` com defaults conservadores para o projeto.
- `profile` mede latencia de analise em fixtures sinteticas no modo local padrão.
- `taxonomy` lista as familias de erro e os `issue kinds` mapeados.
- `doctor` valida ambiente local, runtime, linguagens ativas e cobertura offline.
- `--serve`, `--stdin`, `--analyze` e `--autofix-guard` continuam preservados para a integracao da IDE.

## Contrato de execução offline

Quando uma acao e gerada no fluxo local com fallback offline, o contexto interno inclui:

- buffer completo do arquivo atual
- janela de foco em torno do comentario ou issue
- comentario acionavel com marcador, papel, linha gatilho e texto original
- memoria persistente do projeto, quando existir
- perfil da linguagem e boas praticas ativas
- mapa de simbolos do arquivo, incluindo funcoes, metodos, classes, tipos e modulos ja existentes

Esse contrato existe para reduzir variacao e evitar regressao. No CLI, prompts e fixes so escrevem com `--write`; na IDE, o auto-fix reanalisa e passa pelo guard antes de considerar o lote concluido.

## Cobertura Offline

O Pingu opera sem dependencias online e sem IA externa. O contrato offline versionado cobre todas as linguagens ativas do registry para:

- comentarios acionaveis: `comment_task`
- contexto persistente: `context_file`
- testes: `unit_test`
- terminal seguro/manual: `terminal_task`

Para verificar:

```bash
pingu offline --json
```

O resultado esperado para o registry atual e `percent: 100`.

O fluxo atual prioriza cobertura local e fallback offline. Quando um provider externo compatível estiver disponível, o runtime pode aproveitá-lo para enriquecer gerações sem tornar o fluxo dependente disso.

Correcoes offline tambem rodam pelo analisador e pelo CLI:

```bash
pingu fix src --write
```

Exemplos de correcoes deterministicas:

- JavaScript/TypeScript: igualdade estrita quando seguro.
- Python: `None` com `is`/`is not` e `except Exception`.
- Ruby: `nil?`.
- Elixir: `is_nil/1`.
- higiene geral: whitespace, tabs, linhas duplicadas e sintaxe local.

## Exemplo Elixir

Arquivo `lib/calculator.ex`:

```elixir
#:: funcao soma
```

Aplicando pelo CLI:

```bash
pingu prompts lib/calculator.ex --write
```

Resultado esperado:

```elixir
defmodule Calculator do
  @doc """
    Executa a etapa principal de soma preservando o contrato esperado

    ## Parametros
    - `a`: Valor numerico usado na regra principal da funcao.
    - `b`: Valor numerico usado na regra principal da funcao.

    ## Retorno
    Valor numerico calculado conforme a regra principal da funcao.

    ## Contrato
    `@spec soma(term(), term()) :: term()`
  """
  @spec soma(term(), term()) :: term()
  def soma(a, b) do
    a + b
  end
end
```

Outros fluxos Elixir cobertos:

- `#::` gera ou ajusta codigo no arquivo atual.
- `#:::` cria contexto persistente e scaffold quando o pedido permitir.
- `# * rodar testes` infere `mix test`.
- `# * compilar projeto` infere `mix compile`.
- `# * formatar projeto` infere `mix format`.
- `unit_test` gera teste ExUnit em `test/**/*_test.exs`.

## Instalacao via GitHub no Vim

O repositorio expoe `plugin/` e `autoload/` na raiz, entao pode ser instalado direto do GitHub.

### `lazy.nvim`

```lua
{
  "andersonflima/pingu_ai_coding_pair_programming",
  lazy = false,
  priority = 10000,
  init = function()
    vim.g.pingu_diagnostic_takeover = 1
    vim.g.pingu_issue_hints_enabled = 1
  end,
  config = function()
    vim.g.pingu_start_on_editor_enter = 1
    vim.g.pingu_open_window_on_start = 0
    vim.g.pingu_auto_fix_enabled = 0
    vim.g.pingu_target_scope = "current_file"
    vim.g.pingu_auto_fix_scope = "near_cursor"
    vim.g.pingu_auto_fix_near_cursor_radius = 24
    vim.g.pingu_auto_fix_cluster_gap = 8
    vim.g.pingu_auto_fix_visual_mode = "preserve"
    vim.g.pingu_review_on_open = 1
    vim.g.pingu_realtime_on_change = 1
    vim.g.pingu_realtime_on_cursor_hold = 0
    vim.g.pingu_realtime_on_buf_enter = 0
    vim.g.pingu_realtime_on_buffer_load = 1
    vim.g.pingu_realtime_insert_mode = 0
    vim.g.pingu_realtime_async = 1
    vim.g.pingu_realtime_use_daemon = 1
    vim.g.pingu_realtime_focus_scope_enabled = 1
    vim.g.pingu_auto_on_save = 1
    vim.g.pingu_auto_check_max_lines = 600
    vim.g.pingu_analysis_cache_max_entries = 24
    vim.g.pingu_latency_metrics_enabled = 0
    vim.g.pingu_latency_metrics_max_entries = 50
    vim.g.pingu_statusline_enabled = 1
    vim.g.pingu_statusline_icon = ""
    vim.g.pingu_realtime_auto_fix_max_per_check = 2
    vim.g.pingu_auto_fix_doc_cursor_context_only = 0
    vim.g.pingu_realtime_doc_cursor_context_only = 1
    vim.g.pingu_auto_fix_local_cursor_context_only = 1
  end,
}
```

As variaveis `g:pingu_*` sao a configuracao principal do plugin. As variaveis antigas `g:pingu_dev_agent_*` nao sao mais aceitas.

### `vim-plug`

```vim
Plug 'andersonflima/pingu_ai_coding_pair_programming'
```

### Startup automatico no Vim

- inicia no primeiro buffer suportado
- mantem o painel fechado por padrao
- por padrao usa `let g:pingu_target_scope = 'current_file'`; use `workspace` apenas com opt-in explicito
- `let g:pingu_open_window_on_start = 0` mantem o agente ativo sem abrir painel
- `let g:pingu_open_window_on_start = 1` reabre o painel no startup automatico
- fechar o painel com `q`, `:PinguWindowClose` ou fechamento manual do split mantem o painel fechado ate novo `<leader>piw`/`:PinguWindowCheck`
- `let g:pingu_start_on_editor_enter = 0` desliga o startup automatico
- `let g:pingu_review_on_open = 1` mantem revisao automatica ao abrir arquivos
- `let g:pingu_target_scope = 'current_file'` mantem analise e correcoes no arquivo aberto, mas ainda permite `unit_test` adjacente seguro e `context_file` para `.pingu-dev-agent/` e `.gitignore`
- `let g:pingu_target_scope = 'workspace'` mantem acoes multi-arquivo amplas fora desse conjunto seguro
- por padrao, o runtime ignora diretorios de dependencia e cache como `.venv/`, `venv/`, `site-packages/`, `__pycache__/`, `node_modules/`, `vendor/`, `dist/`, `build/` e caches de ferramentas
- `let g:pingu_auto_fix_enabled = 0` mostra diagnosticos primeiro; use `:PinguAutoFixNow` para aplicar sob demanda ou `:PinguAutoFixEnable` para ligar auto-fix continuo
- `let g:pingu_auto_fix_scope = 'near_cursor'` aplica apenas o trecho mais proximo do cursor quando auto-fix estiver habilitado
- `let g:pingu_auto_fix_scope = 'file'` volta para o comportamento de arquivo inteiro por ciclo
- `let g:pingu_auto_fix_scope = 'cursor_only'` restringe ao cursor imediato
- `let g:pingu_auto_fix_near_cursor_radius = 24` controla a distancia maxima entre cursor e trecho elegivel
- `let g:pingu_auto_fix_cluster_gap = 8` controla a distancia maxima entre issues do mesmo trecho
- `let g:pingu_realtime_on_cursor_hold = 0` evita reanalise enquanto o cursor fica parado; use `1` apenas se quiser checagem por pausa de cursor
- `let g:pingu_realtime_on_buf_enter = 0` evita reanalise ao alternar buffers; use `1` apenas se quiser checagem a cada entrada no arquivo
- `let g:pingu_realtime_on_buffer_load = 1` dispara analise assim que o buffer e carregado (arquivo aberto/criado)
- `let g:pingu_auto_on_save = 1` consolida comentarios, fixes locais, blueprint seguro e testes adjacentes automaticamente no save
- `let g:pingu_auto_fix_visual_mode = 'preserve'` reduz ruido visual durante o batch
- `let g:pingu_realtime_insert_mode = 0` concentra a analise ao sair do insert mode para reduzir travamentos durante digitacao
- `let g:pingu_realtime_async = 1` usa job assincrono no Neovim para evitar congelar a UI durante o loop automatico
- `let g:pingu_realtime_use_daemon = 1` reaproveita um runtime residente no Neovim para reduzir spawn por analise realtime
- `let g:pingu_realtime_focus_scope_enabled = 1` limita a analise leve realtime ao bloco atual do cursor
- `let g:pingu_node_path = '/caminho/absoluto/para/node'` fixa o runtime quando o PATH do Neovim difere do shell
- `let g:pingu_auto_check_max_lines = 600` limita checks automaticos a arquivos menores
- `let g:pingu_analysis_cache_max_entries = 24` reaproveita a ultima analise do mesmo texto e reduz relancamento do agente
- `let g:pingu_latency_metrics_enabled = 1` habilita metricas locais em memoria para diagnosticar latencia do runtime
- `let g:pingu_latency_metrics_max_entries = 50` limita quantas amostras recentes ficam guardadas na sessao
- `let g:pingu_logs_max_entries = 200` limita quantos eventos operacionais recentes ficam disponiveis em `:PinguLogs`
- `let g:pingu_project_check_command = ''` define o comando usado por `:PinguRunProjectCheck`; vazio usa sugestao do contexto/projeto
- `let g:pingu_post_fix_check_command = ''` define um comando opcional executado em background apos `:PinguFixCurrent`/`:PinguFixCurrentAI`; vazio preserva o comportamento atual sem rodar testes automaticamente
- `let g:pingu_statusline_enabled = 1` habilita o indicador de status `PinguStatusline()`
- `let g:pingu_statusline_icon = ''` define o icone exibido na status bar
- `let g:pingu_statusline_auto = 1` adiciona automaticamente o indicador em statusline nativa; por padrao fica desligado para evitar duplicidade em setups com `lualine`
- `let g:pingu_undo_fix_history_max = 30` limita quantos snapshots de correcoes do Pingu ficam disponiveis por arquivo para rollback manual
- `let g:pingu_map_key = '<leader>pic'` analisa o arquivo atual
- `let g:pingu_window_key = '<leader>piw'` abre ou atualiza o painel do Pingu
- `let g:pingu_help_key = '<leader>pi?'` abre uma ajuda rapida com comandos, atalhos e formatos de comentarios acionaveis
- `let g:pingu_action_menu_key = '<leader>pia'` abre o menu explicito de actions da issue atual
- `let g:pingu_next_issue_key = '<C-j>'` ativa o atalho para ir ao proximo diagnostico/aviso do Pingu no buffer atual
- `let g:pingu_prev_issue_key = '<C-k>'` ativa o atalho para o diagnostico/aviso anterior do Pingu no buffer atual
- `let g:pingu_issue_qf_open = 1` abre quickfix ao navegar pelos diagnosticos do Pingu com `:PinguQfNext`/`:PinguQfPrev`
- `let g:pingu_lsp_ui = 'float'` usa a UI flutuante do Pingu para finder/references/outline; use `'quickfix'` quando quiser abrir somente a quickfix nativa
- `let g:pingu_prompt_context_radius = 80` limita quantas linhas em volta do cursor/selecao sao enviadas no prompt manual
- `let g:pingu_prompt_chat_history_max = 12` limita quantas trocas de mensagem por arquivo entram no histórico de :PinguPrompt
- `let g:pingu_prompt_chat_entry_max_chars = 320` limita caracteres armazenados por entrada no histórico de prompt
- `let g:pingu_fix_current_key = '<leader>pif'` aplica a correcao disponivel na linha atual
- `let g:pingu_issue_hover_hint = 1` mostra um hover automatico informativo ao passar por uma linha com hint do Pingu; o popup passivo nao muda foco, explica o problema, analisa tecnicamente a funcao sob foco do cursor quando houver contexto (declaracao, chamada ou funcao aninhada, com fluxo, chamadas internas e efeitos observaveis), mostra diff somente quando existir diff local e nao instala mappings de uma letra no buffer atual
- `let g:pingu_issue_hover_hint = 0` desliga esse hover passivo; use `<leader>pia` ou `:PinguIssueActions` para abrir o menu sob demanda
- `let g:pingu_issue_hover_delay_ms = 5000` controla o tempo para abrir o hover passivo automatico
- `let g:pingu_stop_key = '<leader>pis'` interrompe jobs assincronos, daemon e timers ativos
- `:PinguHelp` mostra um resumo rapido dos atalhos, comandos e comentarios acionaveis do Pingu
- `:PinguDoctor` mostra provider ativo, modelo, comando local, runtime, contexto do projeto, ultimo evento e checks do CLI
- `:PinguProjectContext` abre o contexto do projeto; `:PinguProjectContext!` cria `.pingu/context.md` quando ainda nao existir
- `<leader>pia`/`:PinguIssueActions` abre explicitamente o menu de acoes manuais da issue na linha atual; diff e explicacao ficam no hover automatico, enquanto aplicar, corrigir com provider, rodar checks, desfazer e historico continuam no menu; `:PinguIssueApply`, `:PinguIssuePreview`, `:PinguIssueAI`, `:PinguIssueExplain`, `:PinguIssueCheck`, `:PinguIssueUndo`, `:PinguIssueHistory` e `:PinguIssuePanel` seguem disponiveis como comandos diretos
- `:PinguPreviewFix` mostra um diff flutuante antes de aplicar a correcao da issue atual
- `:PinguIssueQueue` mostra a fila de issues agrupada por severidade e origem, com `Enter` para navegar e `a` para abrir acoes
- `:PinguActionHistory` mostra as acoes recentes da sessao e lembra `:PinguUndoFix`
- `:PinguExplainCurrent` explica o diagnostico atual, origem, acao sugerida e comandos uteis
- `:PinguRunProjectCheck [comando]` roda check/testes em background; sem argumento usa `g:pingu_project_check_command`, `.pingu/context.md` ou inferencia do projeto
- `:PinguPrompt <texto>` aplica o prompt como patch direto no buffer via Copilot: sem selecao visual usa a linha do cursor e contexto ao redor; com selecao visual envia o texto selecionado e aplica a substituicao somente naquele range.
- o prompt manual sempre usa o buffer aberto como contexto primario; quando o texto citar outro arquivo ou contexto de diretorio, o Copilot tambem recebe a raiz do projeto para responder com mais precisao.
- `:PinguPromptClear [all]` limpa o histórico de conversa do `:PinguPrompt` do buffer atual; use `:PinguPromptClear all` para limpar em todos os arquivos
- no Neovim, `:PinguPrompt <texto>` executa o Copilot em background para nao bloquear o editor depois do Enter
- `:PinguPrompt` preserva a indentacao relativa do bloco selecionado e remove apenas quebras de linha externas do snippet retornado
- quando `:PinguPrompt` recebe um pedido claro para remover comentarios, o Pingu aplica fallback local seguro se o Copilot retornar vazio ou estiver indisponivel
- `let g:pingu_hints_enabled = 1` habilita virtual text no Neovim para destacar comentarios acionaveis do Pingu
- hints inline usam apenas o icone `` como marcador visual; o texto `Pingu` nao aparece no shadow text
- `let g:pingu_hints_max_lines = 1200` limita quantas linhas sao escaneadas para hints inline
- `let g:pingu_issue_hints_enabled = 1` habilita virtual text para erros/sugestoes encontrados pelo Pingu
- `let g:pingu_issue_hints_prefix = ''` controla o marcador do shadow text de diagnostico, por exemplo ` Elixir: Logger.dub/1 is undefined or private`
- `let g:pingu_issue_hints_priority = 10000` define prioridade alta para o shadow text do Pingu sobre outros virtual texts
- `let g:pingu_issue_hints_position = 'eol'` controla a posicao do shadow text (`eol`, `right_align`, `overlay` ou `inline`)
- `let g:pingu_diagnostic_takeover = 1` faz o Pingu assumir a exibicao visual de todos os LSPs/linters publicados via `vim.diagnostic`, incluindo erros de import/modulo, desligando `virtual_text`, `virtual_lines`, `signs` e `underline` nativos globais, por namespace e em chamadas diretas de publicacao; com `lazy.nvim`, carregue o plugin com `lazy = false` e `priority` alto para o manager `00_pingu_diagnostic_manager.lua` rodar antes de LSP/Mason/LazyVim/lspsaga renderizarem diagnostics nativos
- `let g:pingu_diagnostic_takeover_max_items = -1` mostra diagnosticos externos do arquivo inteiro; use um numero positivo para limitar ou `0` para nao agregar diagnosticos LSP/linter no shadow text do Pingu
- `g:pingu_diagnostic_source_labels` permite sobrescrever o rotulo exibido para os diagnostics de LSP agregados no takeover; por padrao preserva a origem real do diagnostico e usa `Pingu` apenas como fallback. Exemplo:
  - `{'default': 'Pingu', 'elixirls': 'Elixir', 'dialyzer': 'Dialyzer'}`
- `:PinguHintsRefresh` recalcula manualmente todos os hints inline do buffer atual, incluindo diagnosticos LSP/linter assumidos pelo Pingu
- `:PinguAutoFixNow` aplica os auto-fixes disponiveis do ultimo diagnostico sob demanda
- `:PinguFixCurrent` aplica somente a sugestao encontrada na linha do cursor
- `:PinguFixCurrentAI` pede uma correcao assistida para a sugestao da linha atual e aplica apenas uma edicao local retornada pelo provider configurado
- `:PinguPreviewFix` mostra um diff flutuante antes de aplicar a correcao resolvida para a linha atual; no preview, use `a` ou `Enter` para aplicar
- `<leader>pia`/`:PinguIssueActions` abre o menu flutuante da issue atual com actions manuais no topo; diff e explicacao aparecem automaticamente no hover, e o menu mantem aplicar, corrigir com provider, checks, undo, historico e painel
- apos aplicar uma correcao manual, o Pingu exibe automaticamente um popup com o diff aplicado quando houver diff local disponivel
- `:PinguIssueQueue` mostra uma fila flutuante das issues do arquivo atual agrupada por severidade e origem; `Enter` pula para a issue e `a` abre as acoes
- `:PinguActionHistory` mostra as acoes recentes da sessao
- apos correcoes manuais, `g:pingu_post_fix_check_command` permite rodar um check em background quando configurado
- quando `:PinguFixCurrentAI` nao altera o buffer, o Pingu repinta os hints imediatamente, registra o motivo em `:PinguLogs` e tenta fallback local seguro para diagnostics conhecidos antes de desistir
- apos `:PinguFixCurrent` ou `:PinguFixCurrentAI`, os hints sao repintados imediatamente e novamente apos os diagnostics do LSP atualizarem, evitando que outros erros desaparecam da tela
- snippets aplicados por correcoes do Pingu removem espacos/tabs no fim das linhas antes de alterar o buffer, evitando que uma correcao gere um novo hint `trailing_whitespace`
- o Pingu tambem substitui a camada operacional usada normalmente pelo lspsaga:
  - `:PinguHover` abre documentacao LSP em janela flutuante do Pingu
  - `:PinguCodeAction` tenta a correcao do Pingu na linha atual sem depender de `g:pingu_lsp_auto_fix_enabled` e usa `vim.lsp.buf.code_action()` apenas como fallback quando nao houver issue aplicavel do Pingu
  - `:PinguDiagnosticNext` e `:PinguDiagnosticPrev` navegam pelos diagnostics gerenciados pelo Pingu, equivalentes a `:PinguQfNext` e `:PinguQfPrev`
  - `:PinguFinder` agrega definicao, tipo, implementacao e referencias em um picker flutuante do Pingu, mantendo a quickfix sincronizada
  - `:PinguDefinition` navega para a primeira definicao retornada pelo LSP
  - `:PinguReferences` lista referencias no picker flutuante do Pingu, com `Enter`/`o` para abrir e `q`/`Esc` para fechar
  - `:PinguOutline` lista simbolos do documento no picker flutuante do Pingu, com destaque para tipo e nome
  - `:PinguRename [novo_nome]` executa rename LSP; sem argumento, pergunta o novo nome usando a palavra sob o cursor
- `:PinguStop` interrompe processamento ativo quando o runtime parecer preso ou estiver demorando demais
- `:PinguLogs` abre um buffer `pingu://logs` com erros/eventos operacionais recentes do Pingu, semelhante ao uso de `:LspLog`; no buffer, use `r` para atualizar e `q` para fechar
- `:PinguLogsClear` limpa o historico de logs da sessao atual
- `:PinguLatencyMetrics` imprime as amostras recentes de latencia sem gravar arquivos
- `:PinguUndoFix` reverte a ultima correcao aplicada pelo Pingu no arquivo atual
- `:PinguUndoFix!` força a reversao mesmo se o buffer tiver mudado depois da correcao
- `let g:pingu_realtime_auto_fix_max_per_check = 2` reduz o lote automatico por ciclo realtime para manter o editor fluido
- `let g:pingu_auto_fix_strict_validation = 0` no Neovim evita reanalise e guard sincronos apos cada lote automatico; use `1` quando preferir validacao estrita mesmo com maior latencia
- `let g:pingu_auto_fix_doc_cursor_context_only = 0` deixa `function_doc`, `class_doc`, `variable_doc` e `flow_comment` elegiveis no arquivo inteiro
- `let g:pingu_realtime_doc_cursor_context_only = 1` restringe esses comentarios ao bloco atual durante realtime, evitando edicoes longe do cursor enquanto voce navega ou digita
- `let g:pingu_auto_fix_local_cursor_context_only = 1` restringe `debug_output`, syntax local, `trailing_whitespace`, `function_spec`, `markdown_title`, `terraform_required_version` e `dockerfile_workdir` ao bloco textual atual
- `let g:pingu_auto_fix_doc_cursor_context_max_lines = 80` controla o tamanho maximo desse bloco automatico
- no LazyVim/Neovim, auto-fixes pendentes calculados durante insert mode sao descartados no `InsertLeave` quando o `changedtick` do buffer muda, evitando que uma correcao antiga sobrescreva texto digitado antes de apertar `Esc`
- com os defaults atuais no Vim/Neovim, o Pingu mostra diagnosticos e hints inline primeiro; o auto-fix fica sob comando explicito com `:PinguFixCurrent`, `:PinguAutoFixNow`, `:PinguAutoFixEnable` ou aplicacao pelo painel/quickfix

### Terminal no Vim / Neovim

- `let g:pingu_terminal_actions_enabled = 0` desliga `terminal_task`
- `let g:pingu_terminal_risk_mode = 'safe'` (default)
- `let g:pingu_terminal_risk_mode = 'workspace_write'`
- `let g:pingu_terminal_risk_mode = 'all'`
- comandos como teste, build, install e scripts locais exigem `workspace_write`
- `let g:pingu_terminal_strategy = 'background'` (default)
- `let g:pingu_terminal_strategy = 'auto'`
- `let g:pingu_terminal_strategy = 'toggleterm'`
- `let g:pingu_terminal_strategy = 'native'`

## Variáveis de ambiente

O runtime opera com fallback offline e pode usar provider externo quando disponível, sem exigir configuração obrigatória para os fluxos mapeados.

Linguagens ativas por padrao no runtime:

- todas as linguagens mapeadas no registry, exceto o fallback `default`
- hoje isso inclui `javascript`, `python`, `elixir`, `go`, `rust`, `ruby`, `lua`, `vim`, `c`, `terraform`, `yaml`, `markdown`, `mermaid`, `dockerfile`, `shell` e `toml`

Variáveis comuns:

- `PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES`
- `PINGU_FLOW_COMMENT_MAX_LINES`
- `PINGU_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES`

Provider de IA:

O Pingu integra exclusivamente com o GitHub Copilot CLI quando ele estiver autenticado na sua maquina. Sem configuracao adicional, o runtime detecta o binario `copilot` no PATH e usa o seu login. Quando o Copilot nao estiver disponivel, o Pingu cai para o template offline.

Variaveis opcionais do Copilot:

- `PINGU_COPILOT_COMMAND` nome do executavel do CLI (default: `copilot`)
- `PINGU_COPILOT_MODEL` modelo quando o CLI suportar selecao explicita
- `PINGU_COPILOT_TIMEOUT_MS` timeout da chamada ao Copilot
- `PINGU_COPILOT_FAILURE_COOLDOWN_MS` cooldown apos falha de runtime
- `PINGU_COPILOT_DISABLED=1` desliga a integracao para depuracao ou CI

### Doppler

O repositório já inclui `doppler.yaml` para bootstrap local do projeto/config.

Setup local:

```bash
doppler setup
doppler run -- node pingu_dev_agent.js doctor
doppler run -- nvim
```

Comandos npm prontos:

- `npm run doppler:setup`
- `npm run doppler:doctor`
- `npm run doppler:run:doctor`
- `npm run doppler:run:check`
- `npm run doppler:run:nvim`

No Doppler, normalmente nao ha o que configurar para o Pingu — ele usa o login do Copilot CLI. Sobrescritas opcionais sao `PINGU_COPILOT_COMMAND`, `PINGU_COPILOT_MODEL`, `PINGU_COPILOT_TIMEOUT_MS` e `PINGU_COPILOT_DISABLED`.

Importante:

- Vim e Neovim herdam variaveis de ambiente no momento em que sao iniciados
- se a autenticacao do Copilot mudar depois que o editor ja estiver aberto, reinicie o editor
- por default, o runtime detecta o `copilot` CLI no PATH e usa o login local; sem o CLI, o Pingu segue com o template offline
- para `comment_task`, `context_file`, `unit_test` e correcoes automaticas, o runtime aciona o Copilot quando operacional
- `prompt_task` usa o Copilot para aplicar um patch local no range selecionado por `:PinguPrompt <texto>`; comandos de terminal sugeridos pelo Copilot nao sao executados pelo patch direto
- `prompt_task` envia somente uma janela de contexto em volta do range (`g:pingu_prompt_context_radius`, padrao `80`) e preserva os espacos iniciais do snippet para nao quebrar indentacao
- `prompt_task` possui fallback deterministico para remover comentarios de codigo quando o provider retorna vazio, preservando strings e linhas em branco existentes
- se o provider externo não estiver disponível ou falhar, o fluxo segue com fallback local sem interrupção
- quando o provider falha em runtime (ex.: CLI sem autenticacao), o agente entra em cooldown automatico curto e evita novas tentativas ate expirar, reduzindo impacto de latencia no loop automatico
- no Neovim, diagnosticos ativos do LSP entram no lote automatico como `lsp_code_action`; ao aplicar a correcao da linha, o Pingu tenta primeiro uma resolucao assistida e cai para `source.fixAll`, `source.organizeImports` e `quickfix` quando a IA/provider nao aplicar edicao local segura
- no Neovim, diagnostics do LSP sem `codeAction` aplicavel podem usar `lsp_ai_fix` para gerar uma edicao local minima; para `reportUndefinedVariable`, Ruff `F821` e mensagens de simbolo indefinido, o payload assistido procura primeiro simbolos existentes no projeto para sugerir import e, quando nao houver candidato seguro, orienta a criacao da menor definicao local faltante
- no Neovim, `g:pingu_diagnostic_takeover = 1` centraliza a exibicao de qualquer diagnostico publicado em `vim.diagnostic`; o manager precoce `00_pingu_diagnostic_manager.lua` intercepta `config`, `show` e `set` antes do runtime principal, bloqueia reativacoes posteriores de `virtual_text`, `virtual_lines`, `signs` e `underline`, agrega LSPs/linters por linha no arquivo inteiro, normaliza diagnostics de imports/modulos como erro visual quando necessario, mostra o item mais severo com `+N` para extras e mantem `:PinguFixCurrent` como comando de correcao local
- no Neovim, o loop realtime tambem observa `DiagnosticChanged` e agenda nova rodada automaticamente quando o LSP atualiza lint/syntax sem edicao manual no buffer; o shadow text do Pingu usa o buffer do evento para atualizar linhas com problemas mesmo fora da janela visivel
- quando houver `syntax_*` no arquivo e provider assistido estiver operacional, o runtime tenta consolidar um reparo unico de sintaxe no arquivo antes do fallback por item
- quando o servidor exigir `codeAction/resolve`, o runtime resolve e executa a acao automaticamente antes de aplicar edits/comandos
- se a busca com `context.only` vier vazia, o runtime faz fallback automatico para nova tentativa sem `only`
- quando o `kind` do code action vier fora dos padroes esperados, o runtime ainda pode aplicar a melhor acao habilitada (priorizando `isPreferred`)
- quando o `apply` explicito de um diagnostico LSP executa uma code action que nao altera nenhum buffer carregado, o Pingu registra o no-op em `:PinguLogs` e tenta o fallback assistido da mesma linha antes de reportar falha, usando IA para escolher entre import, stub local ou edicao minima segura; se o provider retornar vazio para simbolo indefinido em Python, o Pingu aplica fallback seguro de import ou stub minimo para nao encerrar em `empty_resolution`
- code actions manuais do Pingu detectam alteracoes em qualquer buffer carregado afetado pelo LSP, salvando os buffers modificados em vez de validar somente o arquivo onde a action foi disparada
- para diagnostics LSP com chamada local obviamente incorreta, o Pingu tenta um fallback deterministico antes do provider assistido, por exemplo `Logger.dub(...)` para `Logger.debug(...)` em Elixir
- quando uma correcao automatica (snippet local ou `lsp_code_action`) eh aplicada com sucesso, o buffer alvo eh salvo automaticamente no disco
- `:PinguWindowCheck` (e o atalho `g:pingu_window_key`) abre o painel e o mantem aberto durante e apos a analise assincrona ate ele ser fechado explicitamente
- `lsp_code_action` e issues `syntax_*` sao tratadas como escopo agnostico no realtime (nao ficam presas ao raio do cursor), reduzindo casos em que o erro existe mas nao entra no lote
- Elixir ganhou deteccao adicional de bloco `do/end` pendente, cobrindo erros como `syntax error before: 'Logger'` quando faltam `end`s
- Elixir agora detecta keyword de fechamento malformada (`eend`, `ennd`, `endd`) como `syntax_malformed_keyword` com auto-fix por `replace_line`
- `function_doc` agora evita ciclo de atualização quando a doc já corresponde ao snippet gerado (inclusive em parametros opcionais/variadicos de TypeScript e defaults de Python)
- `function_doc` em Elixir remove comentarios automaticos obsoletos logo abaixo do `@doc` e considera qualquer referencia antiga de nome como desatualizacao
- `function_spec` em Elixir evita duplicacao em funcoes com multiplas clausulas da mesma aridade, reduzindo oscilacao de add/remove de `@spec`
- atualizacoes de `function_spec` com `replace_range` agora substituem o bloco de `@spec` corretamente no runtime Vim/Neovim, evitando insercao paralela e oscilacao
- o runtime valida a declaracao atual antes de aplicar `class_doc`, `variable_doc`, `flow_comment`, `function_comment`, `moduledoc`, `function_doc`, `function_spec` e `unit_test_signature` antigos
- `unit_test_signature` agora carrega contrato estrutural de declaracao e cobre tambem metodos JavaScript/TypeScript de classes exportadas
- `syntax_*` com acao de insercao (`insert_after`/`insert_before`) nao sao mais bloqueadas por dedupe simplista da linha ancora
- respostas assistidas para comentarios/documentacao receberam instrucoes mais restritivas para reduzir texto generico quando o provider estiver operacional
- no fallback local de `function_doc`/`function_comment`, os argumentos e contrato agora usam contexto de simbolo para evitar placeholders genericos
- `PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES=8` limita quantas issues de `comment_task` entram no ciclo automático por execução; use `0` para remover o limite
- `PINGU_AUTOMATIC_AI_SYNTAX_BUNDLE_MIN_ISSUES=1` define a partir de quantas issues `syntax_*` o runtime consolida reparo de sintaxe por arquivo quando provider assistido estiver operacional; use `0` para desabilitar esse bundle
- `PINGU_COPILOT_FAILURE_COOLDOWN_MS=30000` ajusta o cooldown de falha do provider (default: 30000ms)
- `PINGU_DOCUMENTATION_AUTO_FIX_MIN_CONFIDENCE=0.60` controla o limiar minimo de confianca para comentario automatico documental; valores menores deixam o lote mais agressivo
- `PINGU_DOCUMENTATION_MAX_LINES=420` evita `function_doc`, `class_doc`, `variable_doc` e `flow_comment` automaticos em arquivos grandes; use `0` para remover o corte
- `PINGU_FLOW_COMMENT_MAX_LINES=260` evita `flow_comment` automatico em arquivos grandes; use `0` para remover o corte
- `PINGU_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES=260` limita checks mais profundos do modo `light` a arquivos menores; use `0` para manter o deep pass mesmo em arquivo grande
- `PINGU_AUTOFIX_LARGE_FILE_LINE_THRESHOLD=260` define a partir de quantas linhas o runtime encolhe o lote automatico
- `PINGU_AUTOFIX_DOC_MAX_PER_PASS=0` limita quantas issues documentais sobem por ciclo; `0` remove o corte
- `PINGU_AUTOFIX_DOC_MAX_PER_PASS_LARGE_FILE=4` limita docstrings/comentarios por ciclo em arquivo grande
- no LazyVim, os equivalentes sao `g:pingu_auto_fix_large_file_line_threshold`, `g:pingu_auto_fix_large_file_radius` e `g:pingu_auto_fix_doc_max_per_check_large_file`
- no LazyVim, `debug_output` e `function_spec` cursor-local entram no lote automatico seguro sem depender da trilha live
- `g:pingu_lsp_auto_fix_enabled=1` habilita aplicacao automatica de code action do LSP; por padrao fica desligado
- `g:pingu_lsp_auto_fix_max_per_check=3` limita quantos diagnosticos do LSP entram por ciclo
- `g:pingu_lsp_auto_fix_timeout_ms=400` define timeout da busca `textDocument/codeAction` por item
- `g:pingu_lsp_auto_fix_max_severity='warning'` limita severidade elegivel (`error`, `warning`, `info`, `hint` ou `1..4`)
- `g:pingu_lsp_auto_fix_only=['source.fixAll','source.organizeImports','quickfix']` controla a ordem/tipos de code action elegiveis
- `g:pingu_lsp_auto_fix_prefer_global=1` prioriza tentativa de `fixAll`/`organizeImports` no escopo do arquivo antes do quickfix local
- `g:pingu_lsp_ai_fix_enabled=1` habilita fallback assistido para warnings do LSP sem code action aplicavel; por padrao fica desligado
- `g:pingu_lsp_ai_fix_max_per_check=1` limita chamadas ao provider externo por ciclo
- `g:pingu_lsp_ai_fix_severities=['warning']` restringe quais severidades podem acionar o fallback assistido

### CI/CD com Doppler (opcional)

O workflow de CI (`.github/workflows/ci.yml`) já suporta Doppler de forma opcional:

- se `DOPPLER_TOKEN` estiver definido nos secrets do repositório, a pipeline instala Doppler CLI e executa smoke/check/pack com `doppler run -- ...`
- sem `DOPPLER_TOKEN`, a pipeline continua com o fluxo normal sem Doppler

## Como funciona internamente

- `pingu_dev_agent.js`: entrypoint executavel do runtime
- `lib/cli.js`: comandos CLI, compatibilidade legada da IDE e servidor residente
- `lib/analyzer.js`: analise e emissao de issues
- `lib/analyzer-profile.js`: perfil sintetico de latencia da analise
- `lib/generation*.js`: geracao de snippets, blueprints, testes, dependencias e terminal tasks
- `lib/language-capabilities.js`: contrato declarativo de linguagem
- `vim/`, `plugin/`, `autoload/`: runtime do plugin Vim / Neovim

## Validacao de desenvolvimento

```bash
npm run check
npm run smoke:vim
npm run profile
npm run pack:check
npm run release:check
```

- `check:vim-runtime` garante que `plugin/` e `autoload/` continuam sincronizados com `vim/`.
- `sync:vim-runtime` atualiza as copias publicas depois de alterar o runtime canonico em `vim/`.
- `ci:release` combina testes, pacote e validacao de versao npm antes do publish.

## Estrutura principal

- `pingu_dev_agent.js`: entrada executavel do agente
- `lib/`: analise, geracao e suporte
- `vim/`: implementacao principal do plugin Vim
- `plugin/` e `autoload/`: wrappers para instalacao direta no Vim
