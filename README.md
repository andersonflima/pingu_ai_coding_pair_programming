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
- Gera ou complementa testes automaticamente e cria `tests/` ou `test/` quando necessario, seguindo o convenio da linguagem.
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
npm install -g pingu-dev-agent
pingu doctor
```

Enquanto o primeiro publish no npm nao estiver concluido, instale direto do GitHub:

```bash
npm install -g github:andersonflima/pingu_ai_codding_pair_programming
pingu doctor
```

Para desenvolvimento local:

```bash
git clone git@github.com:andersonflima/pingu_ai_codding_pair_programming.git
cd pingu_ai_codding_pair_programming
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

- atualiza `.gitignore` para ignorar `.realtime-dev-agent/`
- cria `.realtime-dev-agent/contexts/bff-crud-usuario.md`
- cria scaffold inicial seguindo Onion Architecture e o source root da stack atual

Arquivos tipicos gerados:

```text
.realtime-dev-agent/contexts/bff-crud-usuario.md
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
.realtime-dev-agent/contexts/bff-crud-usuario.md
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
[RealtimeDevAgent] command: npm test
...
[RealtimeDevAgent] exit code: 0
[RealtimeDevAgent] terminal pronto para o proximo comando.
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
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  snippets estruturados, `required_version`, blueprint de contexto e testes de contrato
- YAML:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  configuracao estruturada e testes de contrato
- Markdown:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  documentos, terminal acionavel por comentario e testes de contrato
- Mermaid:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  diagramas, terminal acionavel por comentario e testes de contrato
- Dockerfile:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  contrato de `WORKDIR`, contexto persistente, snippets operacionais e testes
- TOML:
  `comment_task`, `context_file`, `unit_test`, `terminal_task`
  configuracao, secoes estruturadas, testes de contrato e terminal por comentario

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

- `<leader>i`: analisa o arquivo atual
- `<leader>ia`: abre ou fecha o painel
- `<Tab>`, `i` ou `a`: aplica a sugestao selecionada
- `f`: insere follow-up acionavel
- `r`: reanalisa
- `q`: fecha o painel

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
node realtime_dev_agent.js analyze src/app.js --json
node realtime_dev_agent.js fix src/app.js --write --json
node realtime_dev_agent.js prompts src/app.js --write --json
node realtime_dev_agent.js init --json
node realtime_dev_agent.js profile --json
node realtime_dev_agent.js taxonomy --json
node realtime_dev_agent.js doctor --json
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
  "andersonflima/pingu_ai_codding_pair_programming",
  config = function()
    vim.g.realtime_dev_agent_start_on_editor_enter = 1
    vim.g.realtime_dev_agent_open_window_on_start = 0
    vim.g.realtime_dev_agent_auto_fix_enabled = 1
    vim.g.realtime_dev_agent_target_scope = "current_file"
    vim.g.realtime_dev_agent_auto_fix_scope = "near_cursor"
    vim.g.realtime_dev_agent_auto_fix_near_cursor_radius = 24
    vim.g.realtime_dev_agent_auto_fix_cluster_gap = 8
    vim.g.realtime_dev_agent_auto_fix_visual_mode = "preserve"
    vim.g.realtime_dev_agent_review_on_open = 1
    vim.g.realtime_dev_agent_realtime_on_change = 1
    vim.g.realtime_dev_agent_realtime_on_cursor_hold = 0
    vim.g.realtime_dev_agent_realtime_on_buf_enter = 0
    vim.g.realtime_dev_agent_realtime_on_buffer_load = 1
    vim.g.realtime_dev_agent_realtime_insert_mode = 0
    vim.g.realtime_dev_agent_realtime_async = 1
    vim.g.realtime_dev_agent_realtime_use_daemon = 1
    vim.g.realtime_dev_agent_realtime_focus_scope_enabled = 1
    vim.g.realtime_dev_agent_auto_on_save = 1
    vim.g.realtime_dev_agent_auto_check_max_lines = 600
    vim.g.realtime_dev_agent_analysis_cache_max_entries = 24
    vim.g.realtime_dev_agent_realtime_auto_fix_max_per_check = 2
    vim.g.realtime_dev_agent_auto_fix_doc_cursor_context_only = 0
    vim.g.realtime_dev_agent_realtime_doc_cursor_context_only = 1
    vim.g.realtime_dev_agent_auto_fix_local_cursor_context_only = 1
  end,
}
```

### `vim-plug`

```vim
Plug 'andersonflima/pingu_ai_codding_pair_programming'
```

### Startup automatico no Vim

- inicia no primeiro buffer suportado
- mantem o painel fechado por padrao
- por padrao usa `let g:realtime_dev_agent_target_scope = 'current_file'`; use `workspace` apenas com opt-in explicito
- `let g:realtime_dev_agent_open_window_on_start = 0` mantem o agente ativo sem abrir painel
- `let g:realtime_dev_agent_open_window_on_start = 1` reabre o painel no startup automatico
- `let g:realtime_dev_agent_start_on_editor_enter = 0` desliga o startup automatico
- `let g:realtime_dev_agent_review_on_open = 1` mantem revisao automatica ao abrir arquivos
- `let g:realtime_dev_agent_target_scope = 'current_file'` mantem analise e correcoes no arquivo aberto, mas ainda permite `unit_test` adjacente seguro e `context_file` para `.realtime-dev-agent/` e `.gitignore`
- `let g:realtime_dev_agent_target_scope = 'workspace'` mantem acoes multi-arquivo amplas fora desse conjunto seguro
- por padrao, o runtime ignora diretorios de dependencia e cache como `.venv/`, `venv/`, `site-packages/`, `__pycache__/`, `node_modules/`, `vendor/`, `dist/`, `build/` e caches de ferramentas
- `let g:realtime_dev_agent_auto_fix_scope = 'near_cursor'` aplica apenas o trecho mais proximo do cursor
- `let g:realtime_dev_agent_auto_fix_scope = 'file'` volta para o comportamento de arquivo inteiro por ciclo
- `let g:realtime_dev_agent_auto_fix_scope = 'cursor_only'` restringe ao cursor imediato
- `let g:realtime_dev_agent_auto_fix_near_cursor_radius = 24` controla a distancia maxima entre cursor e trecho elegivel
- `let g:realtime_dev_agent_auto_fix_cluster_gap = 8` controla a distancia maxima entre issues do mesmo trecho
- `let g:realtime_dev_agent_realtime_on_cursor_hold = 0` evita reanalise enquanto o cursor fica parado; use `1` apenas se quiser checagem por pausa de cursor
- `let g:realtime_dev_agent_realtime_on_buf_enter = 0` evita reanalise ao alternar buffers; use `1` apenas se quiser checagem a cada entrada no arquivo
- `let g:realtime_dev_agent_realtime_on_buffer_load = 1` dispara analise assim que o buffer e carregado (arquivo aberto/criado)
- `let g:realtime_dev_agent_auto_on_save = 1` consolida comentarios, fixes locais, blueprint seguro e testes adjacentes automaticamente no save
- `let g:realtime_dev_agent_auto_fix_visual_mode = 'preserve'` reduz ruido visual durante o batch
- `let g:realtime_dev_agent_realtime_insert_mode = 0` concentra a analise ao sair do insert mode para reduzir travamentos durante digitacao
- `let g:realtime_dev_agent_realtime_async = 1` usa job assincrono no Neovim para evitar congelar a UI durante o loop automatico
- `let g:realtime_dev_agent_realtime_use_daemon = 1` reaproveita um runtime residente no Neovim para reduzir spawn por analise realtime
- `let g:realtime_dev_agent_realtime_focus_scope_enabled = 1` limita a analise leve realtime ao bloco atual do cursor
- `let g:realtime_dev_agent_node_path = '/caminho/absoluto/para/node'` fixa o runtime quando o PATH do Neovim difere do shell
- `let g:realtime_dev_agent_auto_check_max_lines = 600` limita checks automaticos a arquivos menores
- `let g:realtime_dev_agent_analysis_cache_max_entries = 24` reaproveita a ultima analise do mesmo texto e reduz relancamento do agente
- `let g:realtime_dev_agent_realtime_auto_fix_max_per_check = 2` reduz o lote automatico por ciclo realtime para manter o editor fluido
- `let g:realtime_dev_agent_auto_fix_strict_validation = 0` no Neovim evita reanalise e guard sincronos apos cada lote automatico; use `1` quando preferir validacao estrita mesmo com maior latencia
- `let g:realtime_dev_agent_auto_fix_doc_cursor_context_only = 0` deixa `function_doc`, `class_doc`, `variable_doc` e `flow_comment` elegiveis no arquivo inteiro
- `let g:realtime_dev_agent_realtime_doc_cursor_context_only = 1` restringe esses comentarios ao bloco atual durante realtime, evitando edicoes longe do cursor enquanto voce navega ou digita
- `let g:realtime_dev_agent_auto_fix_local_cursor_context_only = 1` restringe `debug_output`, syntax local, `trailing_whitespace`, `function_spec`, `markdown_title`, `terraform_required_version` e `dockerfile_workdir` ao bloco textual atual
- `let g:realtime_dev_agent_auto_fix_doc_cursor_context_max_lines = 80` controla o tamanho maximo desse bloco automatico
- no LazyVim/Neovim, auto-fixes pendentes calculados durante insert mode sao descartados no `InsertLeave` quando o `changedtick` do buffer muda, evitando que uma correcao antiga sobrescreva texto digitado antes de apertar `Esc`
- com os defaults atuais no Vim, o auto-fix realtime continua priorizando correcoes locais para syntax, higiene e comentarios no contexto do cursor, valida o lote antes de concluir e mantem o escopo no arquivo atual; no `save`, o agente pode incluir `unit_test` adjacente seguro e `context_file` para `.realtime-dev-agent/` e `.gitignore`, enquanto `terminal_task` continua fora do auto-fix padrao e sob controle explicito do runtime de terminal

### Terminal no Vim / Neovim

- `let g:realtime_dev_agent_terminal_actions_enabled = 0` desliga `terminal_task`
- `let g:realtime_dev_agent_terminal_risk_mode = 'safe'` (default)
- `let g:realtime_dev_agent_terminal_risk_mode = 'workspace_write'`
- `let g:realtime_dev_agent_terminal_risk_mode = 'all'`
- comandos como teste, build, install e scripts locais exigem `workspace_write`
- `let g:realtime_dev_agent_terminal_strategy = 'background'` (default)
- `let g:realtime_dev_agent_terminal_strategy = 'auto'`
- `let g:realtime_dev_agent_terminal_strategy = 'toggleterm'`
- `let g:realtime_dev_agent_terminal_strategy = 'native'`

## Variáveis de ambiente

O runtime opera com fallback offline e pode usar provider externo quando disponível, sem exigir configuração obrigatória para os fluxos mapeados.

Linguagens ativas por padrao no runtime:

- todas as linguagens mapeadas no registry, exceto o fallback `default`
- hoje isso inclui `javascript`, `python`, `elixir`, `go`, `rust`, `ruby`, `lua`, `vim`, `c`, `terraform`, `yaml`, `markdown`, `mermaid`, `dockerfile`, `shell` e `toml`

Variáveis comuns:

- `PINGU_AUTOMATIC_AI_COMMENT_MAX_ISSUES`
- `PINGU_FLOW_COMMENT_MAX_LINES`
- `PINGU_LIGHT_ANALYSIS_DEEP_PASS_MAX_LINES`

Importante:

- Vim e Neovim herdam variaveis de ambiente no momento em que sao iniciados
- se a chave mudar depois que o editor ja estiver aberto, reinicie o editor
- se o comando `copilot` estiver disponível no ambiente, o runtime pode usar geração assistida automaticamente
- para `comment_task`, `context_file`, `unit_test` e correcoes automaticas, o runtime prioriza provider assistido quando operacional
- se o provider externo não estiver disponível ou falhar, o fluxo segue com fallback local sem interrupção
- quando o provider falha em runtime (ex.: CLI sem autenticacao), o agente entra em cooldown automatico curto e evita novas tentativas ate expirar, reduzindo impacto de latencia no loop automatico
- no Neovim, diagnosticos ativos do LSP agora entram no lote automatico como `lsp_code_action` e tentam aplicar `source.fixAll`, `source.organizeImports` e `quickfix` sem abrir prompt
- no Neovim, warnings do LSP sem `codeAction` aplicavel entram como `lsp_ai_fix` e podem usar Copilot para gerar uma edicao local minima; se o provider estiver indisponivel, o fluxo continua sem bloquear o editor
- no Neovim, o loop realtime tambem observa `DiagnosticChanged` e agenda nova rodada automaticamente quando o LSP atualiza lint/syntax sem edicao manual no buffer
- quando houver `syntax_*` no arquivo e provider assistido estiver operacional, o runtime tenta consolidar um reparo unico de sintaxe no arquivo antes do fallback por item
- quando o servidor exigir `codeAction/resolve`, o runtime resolve e executa a acao automaticamente antes de aplicar edits/comandos
- se a busca com `context.only` vier vazia, o runtime faz fallback automatico para nova tentativa sem `only`
- quando o `kind` do code action vier fora dos padroes esperados, o runtime ainda pode aplicar a melhor acao habilitada (priorizando `isPreferred`)
- quando uma correcao automatica (snippet local ou `lsp_code_action`) eh aplicada com sucesso, o buffer alvo eh salvo automaticamente no disco
- `:RealtimeDevAgentWindowCheck` (e o atalho `g:realtime_dev_agent_window_key`) mantem o painel aberto durante e apos a analise assincrona
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
- no LazyVim, os equivalentes sao `g:realtime_dev_agent_auto_fix_large_file_line_threshold`, `g:realtime_dev_agent_auto_fix_large_file_radius` e `g:realtime_dev_agent_auto_fix_doc_max_per_check_large_file`
- no LazyVim, `debug_output` e `function_spec` cursor-local entram no lote automatico seguro sem depender da trilha live
- `g:realtime_dev_agent_lsp_auto_fix_enabled=1` habilita aplicacao automatica de code action do LSP (default no Neovim)
- `g:realtime_dev_agent_lsp_auto_fix_max_per_check=3` limita quantos diagnosticos do LSP entram por ciclo
- `g:realtime_dev_agent_lsp_auto_fix_timeout_ms=400` define timeout da busca `textDocument/codeAction` por item
- `g:realtime_dev_agent_lsp_auto_fix_max_severity='warning'` limita severidade elegivel (`error`, `warning`, `info`, `hint` ou `1..4`)
- `g:realtime_dev_agent_lsp_auto_fix_only=['source.fixAll','source.organizeImports','quickfix']` controla a ordem/tipos de code action elegiveis
- `g:realtime_dev_agent_lsp_auto_fix_prefer_global=1` prioriza tentativa de `fixAll`/`organizeImports` no escopo do arquivo antes do quickfix local
- `g:realtime_dev_agent_lsp_ai_fix_enabled=1` habilita fallback com Copilot para warnings do LSP sem code action aplicavel (default no Neovim)
- `g:realtime_dev_agent_lsp_ai_fix_max_per_check=1` limita chamadas ao provider externo por ciclo
- `g:realtime_dev_agent_lsp_ai_fix_severities=['warning']` restringe quais severidades podem acionar o fallback assistido

## Como funciona internamente

- `realtime_dev_agent.js`: entrypoint executavel do runtime
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

- `realtime_dev_agent.js`: entrada executavel do agente
- `lib/`: analise, geracao e suporte
- `vim/`: implementacao principal do plugin Vim
- `plugin/` e `autoload/`: wrappers para instalacao direta no Vim
