if exists('g:loaded_pingu_dev_agent')
  finish
endif
let g:loaded_pingu_dev_agent = 1

if !exists('g:pingu_script')
  " Mantem o caminho do script de agente automaticamente para os cenarios
  " de repo local ou plugin instalado no packpath.
  let s:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let s:candidates = [
    \ fnamemodify(s:plugin_dir . '/../../pingu_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../pingu_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../../../pingu_dev_agent.js', ':p')
  \ ]
  let s:found = ''
  for s:candidate in s:candidates
    if filereadable(s:candidate)
      let s:found = s:candidate
      break
    endif
  endfor

  if s:found !=# ''
    let g:pingu_script = s:found
  else
    let g:pingu_script = 'pingu_dev_agent.js'
  endif

  unlet s:plugin_dir s:candidates s:found s:candidate
endif

let s:js_candidate = substitute(g:pingu_script, '\.exs$', '.js', '')
if g:pingu_script =~? '\.exs$' && filereadable(s:js_candidate)
  let g:pingu_script = s:js_candidate
elseif g:pingu_script =~? '\.js$'
  if !filereadable(expand(g:pingu_script))
    let g:pingu_script = 'pingu_dev_agent.js'
  endif
elseif !executable('node')
  let g:pingu_script = 'pingu_dev_agent.js'
endif
unlet s:js_candidate

function! s:issue_kind_registry_file() abort
  let l:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let l:candidates = [
        \ fnamemodify(l:plugin_dir . '/../../config/issue-kinds.json', ':p'),
        \ fnamemodify(l:plugin_dir . '/../config/issue-kinds.json', ':p'),
        \ fnamemodify(l:plugin_dir . '/../../../config/issue-kinds.json', ':p')
        \ ]
  for l:candidate in l:candidates
    if filereadable(l:candidate)
      return l:candidate
    endif
  endfor
  return ''
endfunction

function! s:read_issue_kind_registry() abort
  let l:file = s:issue_kind_registry_file()
  if empty(l:file) || !exists('*json_decode')
    return {}
  endif

  try
    let l:payload = join(readfile(l:file), "\n")
    let l:decoded = json_decode(l:payload)
    return type(l:decoded) == v:t_dict ? l:decoded : {}
  catch
    return {}
  endtry
endfunction

function! s:default_auto_fix_kinds_from_registry(registry) abort
  if type(a:registry) != v:t_dict || empty(a:registry)
    return []
  endif

  let l:kinds = []
  for l:kind in sort(keys(a:registry))
    let l:entry = get(a:registry, l:kind, {})
    if !s:is_safe_default_auto_fix_kind(l:kind, l:entry)
      continue
    endif
    call add(l:kinds, [get(l:entry, 'autoFixPriority', 999), l:kind])
  endfor
  call sort(l:kinds, {left, right -> left[0] == right[0] ? (left[1] ># right[1] ? 1 : -1) : (left[0] > right[0] ? 1 : -1)})
  return map(l:kinds, 'v:val[1]')
endfunction

function! s:is_safe_default_auto_fix_kind(kind, entry) abort
  if type(a:entry) != v:t_dict || !get(a:entry, 'autoFixDefault', v:false)
    return v:false
  endif

  let l:action = get(a:entry, 'defaultAction', {})
  if type(l:action) != v:t_dict
    let l:action = {}
  endif

  let l:op = get(l:action, 'op', '')
  if index(['context_file', 'unit_test'], a:kind) != -1 && l:op ==# 'write_file'
    return v:true
  endif
  if a:kind ==# 'terminal_task' && l:op ==# 'run_command'
    return v:true
  endif
  if l:op ==# 'write_file' || l:op ==# 'run_command'
    return v:false
  endif

  return v:true
endfunction

if !exists('g:pingu_issue_kind_registry')
  let g:pingu_issue_kind_registry = s:read_issue_kind_registry()
endif

if !exists('g:pingu_extensions')
  " Lista de extensoes em branco significa qualquer arquivo rastreavel.
  " Exemplo: ['.ex', '.exs', '.js', '.tsx']
  let g:pingu_extensions = []
endif

if !exists('g:pingu_strict_code_only')
  " Ativa filtro estrito para somente arquivos de codigo de extensoes conhecidas.
  " 0 (padrao): respeita a regra existente de g:pingu_extensions.
  " 1: analisa somente extensoes em g:pingu_code_extensions.
  let g:pingu_strict_code_only = 0
endif

if !exists('g:pingu_code_extensions')
  " Lista base para modo estrito de produtividade, alinhada com as linguagens mapeadas no runtime.
  let g:pingu_code_extensions = [
    \ '.bash',
    \ '.c',
    \ '.cjs',
    \ '.clj',
    \ '.cpp',
    \ '.cs',
    \ '.ex',
    \ '.exs',
    \ '.go',
    \ '.gohtml',
    \ '.h',
    \ '.hpp',
    \ '.java',
    \ '.js',
    \ '.jsx',
    \ '.kt',
    \ '.lua',
    \ '.md',
    \ '.mermaid',
    \ '.mmd',
    \ '.mjs',
    \ '.php',
    \ '.pl',
    \ '.py',
    \ '.rb',
    \ '.rs',
    \ '.scala',
    \ '.sh',
    \ '.swift',
    \ '.tf',
    \ '.toml',
    \ '.ts',
    \ '.tsx',
    \ '.vim',
    \ '.yaml',
    \ '.yml',
    \ '.zsh',
    \ '.dockerfile',
    \ '.vue'
  \ ]
endif

if !exists('g:pingu_node_path')
  let g:pingu_node_path = ''
endif

if !exists('g:pingu_ignore_patterns')
  " Lista de trechos de caminho para ignorar no fluxo do agente.
  " Ex.: ['.git/', 'node_modules/', 'dist/', 'build/', '.next/', 'coverage/']
  let g:pingu_ignore_patterns = [
    \ '.git/',
    \ '.hg/',
    \ '.svn/',
    \ '.venv/',
    \ 'venv/',
    \ '__pycache__/',
    \ 'site-packages/',
    \ 'node_modules/',
    \ 'vendor/',
    \ 'dist/',
    \ 'build/',
    \ 'coverage/',
    \ '.next/',
    \ '.nuxt/',
    \ '.cache/',
    \ '.mypy_cache/',
    \ '.pytest_cache/',
    \ '.turbo/',
    \ 'tmp/',
    \ 'temp/',
    \ 'log/'
  \ ]
endif

if !exists('g:pingu_auto_on_save')
  " Consolida correcoes e comentarios automaticamente no save.
  let g:pingu_auto_on_save = 1
endif

if !exists('g:pingu_realtime_on_change')
  " Executa analise automaticamente durante digitacao (com debounce).
  " 1 ativa, 0 desativa.
  let g:pingu_realtime_on_change = 1
endif

if !exists('g:pingu_realtime_analysis_mode')
  " light reduz custo no loop automatico; full mantem a mesma profundidade da analise manual.
  let g:pingu_realtime_analysis_mode = 'light'
endif

if !exists('g:pingu_realtime_on_cursor_hold')
  " Desligado por padrao para evitar reanalises enquanto o usuario apenas navega pelo arquivo.
  let g:pingu_realtime_on_cursor_hold = 0
endif

if !exists('g:pingu_realtime_on_buf_enter')
  " Desligado por padrao para evitar trabalho repetido ao alternar buffers no LazyVim.
  let g:pingu_realtime_on_buf_enter = 0
endif

if !exists('g:pingu_realtime_on_buffer_load')
  " Dispara analise assim que o buffer e carregado (arquivo aberto/criado).
  let g:pingu_realtime_on_buffer_load = 1
endif

if !exists('g:pingu_realtime_insert_mode')
  " 0 concentra a checagem ao sair da insercao para preservar responsividade durante digitacao.
  let g:pingu_realtime_insert_mode = 0
endif

if !exists('g:pingu_review_on_open')
  " Ligado por padrao para o agente revisar o arquivo assim que ele entra no fluxo.
  let g:pingu_review_on_open = 1
endif

if !exists('g:pingu_start_on_editor_enter')
  " Inicia o agente automaticamente no primeiro buffer suportado da sessao.
  let g:pingu_start_on_editor_enter = 1
endif

if !exists('g:pingu_open_window_on_start')
  " Mantem o painel fechado no startup automatico para reduzir ruido e custo visual.
  let g:pingu_open_window_on_start = 0
endif

if !exists('g:pingu_auto_check_max_lines')
  " Limite de linhas para checks automaticos no editor.
  " 0 desliga o limite.
  let g:pingu_auto_check_max_lines = 600
endif

if !exists('g:pingu_realtime_delay')
  " Milisegundos de espera apos a ultima mudanca para disparar a checagem.
  let g:pingu_realtime_delay = 900
endif

if !exists('g:pingu_realtime_async')
  " No Neovim, roda o loop automatico em job assincrono para evitar travar a UI.
  let g:pingu_realtime_async = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_non_blocking_mode')
  " Prioriza execucao em background e evita caminhos sincronos pesados no editor.
  let g:pingu_non_blocking_mode = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_allow_sync_fallback')
  " Em modo non-blocking, evita fallback sincrono quando o job async nao inicia.
  let g:pingu_allow_sync_fallback = has('nvim') ? 0 : 1
endif

if !exists('g:pingu_realtime_use_daemon')
  " Reaproveita um runtime residente no Neovim para reduzir spawn por analise realtime.
  let g:pingu_realtime_use_daemon = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_realtime_focus_scope_enabled')
  " Limita a analise leve realtime ao bloco atual do cursor para reduzir custo fora do contexto imediato.
  let g:pingu_realtime_focus_scope_enabled = 1
endif

if !exists('g:pingu_analysis_cache_max_entries')
  " Mantem um cache pequeno por changedtick para evitar relancar o agente no mesmo texto.
  let g:pingu_analysis_cache_max_entries = 24
endif

if !exists('g:pingu_latency_metrics_enabled')
  " Mantem telemetria local desligada por padrao; habilite para diagnosticar latencia do runtime.
  let g:pingu_latency_metrics_enabled = 0
endif

if !exists('g:pingu_latency_metrics_max_entries')
  " Quantidade maxima de amostras mantidas em memoria na sessao do editor.
  let g:pingu_latency_metrics_max_entries = 50
endif

if !exists('g:pingu_logs_max_entries')
  " Quantidade maxima de eventos operacionais mantidos para :PinguLogs.
  let g:pingu_logs_max_entries = 200
endif

if !exists('g:pingu_statusline_enabled')
  let g:pingu_statusline_enabled = 1
endif

if !exists('g:pingu_statusline_icon')
  let g:pingu_statusline_icon = ''
endif

if !exists('g:pingu_statusline_show_when_idle')
  let g:pingu_statusline_show_when_idle = 1
endif

if !exists('g:pingu_statusline_auto')
  let g:pingu_statusline_auto = 0
endif

if !exists('g:pingu_realtime_open_qf')
  " Mantem quickfix fechado no fluxo em tempo real para evitar ruido.
  let g:pingu_realtime_open_qf = 0
endif

if !exists('g:pingu_open_qf')
  " No fluxo de janela (pairing), manter quickfix fechado.
  let g:pingu_open_qf = 0
endif

if !exists('g:pingu_map_key')
  " Atalho de analise rapida do arquivo atual no namespace <leader>pi.
  let g:pingu_map_key = '<leader>pic'
endif

if !exists('g:pingu_window_key')
  " Mapeamento para abrir e fechar a janela de interacao em tempo real.
  let g:pingu_window_key = '<leader>pia'
endif

if !exists('g:pingu_help_key')
  " Atalho para abrir ajuda rapida dos comandos e comentarios acionaveis.
  let g:pingu_help_key = '<leader>pi?'
endif

if !exists('g:pingu_prompt_key')
  " Atalho para prompt manual assistido no cursor ou selecao visual.
  let g:pingu_prompt_key = '<leader>pip'
endif

if !exists('g:pingu_prompt_terminal_command')
  " Comando interativo aberto por :PinguPrompt sem argumento.
  let g:pingu_prompt_terminal_command = empty($PINGU_PROMPT_TERMINAL_COMMAND) ? '' : $PINGU_PROMPT_TERMINAL_COMMAND
endif

if !exists('g:pingu_model_key')
  " Atalho para escolher provider/modelo assistido da sessao.
  let g:pingu_model_key = '<leader>pim'
endif

if !exists('g:pingu_model_key_alias')
  " Alias opcional para o seletor provider/modelo quando nao houver conflito local.
  let g:pingu_model_key_alias = '<leader>pmi'
endif

if !exists('g:pingu_ai_provider')
  " Provider assistido da sessao: copilot, codex, claude, openai ou auto.
  let g:pingu_ai_provider = empty($PINGU_AI_PROVIDER) ? 'codex' : $PINGU_AI_PROVIDER
endif

if !exists('g:pingu_ai_model')
  " Modelo assistido da sessao; vazio preserva o padrao do provider.
  let g:pingu_ai_model = empty($PINGU_AI_MODEL) ? '' : $PINGU_AI_MODEL
endif

if !exists('g:pingu_codex_models')
  let g:pingu_codex_models = ['gpt-5', 'gpt-5-codex', 'o3', 'o4-mini']
endif

if !exists('g:pingu_openai_models')
  let g:pingu_openai_models = ['gpt-4o-mini', 'gpt-4o', 'o3', 'o4-mini']
endif

if !exists('g:pingu_claude_models')
  let g:pingu_claude_models = ['sonnet', 'opus']
endif

if !exists('g:pingu_copilot_models')
  let g:pingu_copilot_models = []
endif

if !exists('g:pingu_prompt_context_radius')
  " Linhas de contexto em volta do cursor/selecao enviadas ao provider no prompt manual.
  let g:pingu_prompt_context_radius = 80
endif

if !exists('g:pingu_prompt_chat_history_max')
  " Numero maximo de entradas de conversa mantidas por arquivo para o prompt.
  let g:pingu_prompt_chat_history_max = 12
endif

if !exists('g:pingu_prompt_chat_entry_max_chars')
  " Limite em caracteres de cada entrada da historia de prompt.
  let g:pingu_prompt_chat_entry_max_chars = 320
endif

if !exists('g:pingu_next_issue_key')
  " Atalho para navegar os diagnosticos do Pingu no buffer atual (proximo).
  let g:pingu_next_issue_key = '<C-j>'
endif

if !exists('g:pingu_prev_issue_key')
  " Atalho para navegar os diagnosticos do Pingu no buffer atual (anterior).
  let g:pingu_prev_issue_key = '<C-k>'
endif

if !exists('g:pingu_issue_qf_open')
  " Abre quickfix ao navegar diagnósticos do Pingu.
  let g:pingu_issue_qf_open = 1
endif

if !exists('g:pingu_lsp_ui')
  " UI padrao para finder/references/outline: float ou quickfix.
  let g:pingu_lsp_ui = 'float'
endif

if !exists('g:pingu_fix_current_key')
  " Atalho para aplicar a correcao disponivel na linha atual.
  let g:pingu_fix_current_key = '<leader>pif'
endif

if !exists('g:pingu_stop_key')
  " Atalho para interromper jobs e timers ativos do Pingu.
  let g:pingu_stop_key = '<leader>pis'
endif

if !exists('g:pingu_hints_enabled')
  " 1 mostra hints inline para comentarios acionaveis do Pingu no Neovim.
  let g:pingu_hints_enabled = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_hints_max_lines')
  " Limite de linhas para procurar hints sem impactar buffers grandes.
  let g:pingu_hints_max_lines = 1200
endif

if !exists('g:pingu_issue_hints_enabled')
  " 1 mostra virtual text para diagnosticos encontrados pelo Pingu no Neovim.
  let g:pingu_issue_hints_enabled = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_issue_hints_prefix')
  " Prefixo curto no shadow text de diagnosticos do Pingu.
  let g:pingu_issue_hints_prefix = ''
endif

if !exists('g:pingu_issue_hints_priority')
  " Prioridade alta para o shadow text do Pingu aparecer acima de outros virtual texts.
  let g:pingu_issue_hints_priority = 10000
endif

if !exists('g:pingu_issue_hints_position')
  " Posicao do shadow text: eol, right_align, overlay ou inline conforme suporte do Neovim.
  let g:pingu_issue_hints_position = 'eol'
endif

if !exists('g:pingu_issue_hover_hint')
  " 1 mostra uma mensagem de acao do Pingu quando o cursor esta sobre linha com issue aplicavel.
  let g:pingu_issue_hover_hint = 1
endif

if !exists('g:pingu_issue_hover_delay_ms')
  " Tempo para abrir o menu de acoes apos o cursor parar sobre uma linha com hint.
  let g:pingu_issue_hover_delay_ms = 30
endif

if !exists('g:pingu_diagnostic_takeover')
  " 1 centraliza virtual text de LSP/linters no Pingu e desliga virtual_text nativo do vim.diagnostic.
  let g:pingu_diagnostic_takeover = has('nvim') ? 1 : 0
endif

if !exists('g:pingu_diagnostic_takeover_max_items')
  " Limite de diagnosticos externos agregados por buffer; -1 mostra o arquivo inteiro.
  let g:pingu_diagnostic_takeover_max_items = -1
endif

if !exists('g:pingu_diagnostic_source_labels')
  " Rótulos opcionais para diagnósticos LSP em takeover; a origem real é preservada quando não houver mapeamento.
  let g:pingu_diagnostic_source_labels = {
        \ 'default': 'Pingu',
        \ }
endif

if !exists('g:pingu_show_window')
  " Mantem a janela visivel apenas quando o usuario pede modo painel.
  let g:pingu_show_window = 0
endif

if !exists('g:pingu_window_height')
  let g:pingu_window_height = 12
endif

if !exists('g:pingu_window_name')
  let g:pingu_window_name = '__Pingu__'
endif

if !exists('g:pingu_auto_fix_enabled')
  " 0 mostra diagnosticos primeiro; use :PinguAutoFixNow ou :PinguAutoFixEnable para aplicar.
  let g:pingu_auto_fix_enabled = 0
endif

if !exists('g:pingu_undo_fix_history_max')
  " Quantidade maxima de snapshots de correcao mantidos por arquivo para rollback manual.
  let g:pingu_undo_fix_history_max = 30
endif

if !exists('g:pingu_lsp_auto_fix_enabled')
  " 0 evita code actions automaticas do LSP por padrao.
  let g:pingu_lsp_auto_fix_enabled = 0
endif

if !exists('g:pingu_lsp_auto_fix_max_per_check')
  " Limita quantos diagnosticos do LSP entram por ciclo de analise.
  let g:pingu_lsp_auto_fix_max_per_check = 3
endif

if !exists('g:pingu_lsp_auto_fix_timeout_ms')
  " Timeout da busca de code actions no LSP (ms).
  let g:pingu_lsp_auto_fix_timeout_ms = 400
endif

if !exists('g:pingu_lsp_auto_fix_max_severity')
  " Severidade maxima elegivel: error(1), warning(2), info(3), hint(4).
  let g:pingu_lsp_auto_fix_max_severity = 'warning'
endif

if !exists('g:pingu_lsp_auto_fix_only')
  " Ordem de prioridade para code actions do LSP no lote automatico.
  let g:pingu_lsp_auto_fix_only = ['source.fixAll', 'source.organizeImports', 'quickfix']
endif

if !exists('g:pingu_lsp_auto_fix_prefer_global')
  " 1 tenta fixAll/organizeImports no escopo do arquivo antes do quickfix local.
  let g:pingu_lsp_auto_fix_prefer_global = 1
endif

if !exists('g:pingu_lsp_ai_fix_enabled')
  " 0 evita fallback assistido automatico para warnings do LSP por padrao.
  let g:pingu_lsp_ai_fix_enabled = 0
endif

if !exists('g:pingu_lsp_ai_fix_max_per_check')
  " Limita quantos warnings do LSP podem chamar o provider externo por ciclo.
  let g:pingu_lsp_ai_fix_max_per_check = 1
endif

if !exists('g:pingu_lsp_ai_fix_severities')
  let g:pingu_lsp_ai_fix_severities = ['warning']
endif

if !exists('g:pingu_terminal_actions_enabled')
  " 1 permite executar acoes de terminal inferidas a partir de comentarios com *.
  let g:pingu_terminal_actions_enabled = 1
endif

if !exists('g:pingu_terminal_risk_mode')
  " safe: somente leitura; workspace_write: permite escrita local; all: libera tudo.
  let g:pingu_terminal_risk_mode = 'safe'
endif

if !exists('g:pingu_terminal_height')
  " Altura da split usada para exibir a execucao de comandos do terminal.
  let g:pingu_terminal_height = 12
endif

if !exists('g:pingu_terminal_strategy')
  " background: mantem foco no codigo; auto usa ToggleTerm quando houver TermExec e terminal nativa como fallback.
  " background: abre o terminal, inicia a execucao e devolve o foco ao codigo mantendo o output visivel em tempo real.
  let g:pingu_terminal_strategy = 'background'
endif

if !exists('g:pingu_auto_fix_kinds')
  " Pair mode: revisar e corrigir boas praticas automaticamente sem pausa.
  let s:registry_auto_fix_kinds = s:default_auto_fix_kinds_from_registry(g:pingu_issue_kind_registry)
  if !empty(s:registry_auto_fix_kinds)
    let g:pingu_auto_fix_kinds = s:registry_auto_fix_kinds
  else
    let g:pingu_auto_fix_kinds = [
          \ 'syntax_missing_quote',
          \ 'syntax_extra_delimiter',
          \ 'syntax_missing_delimiter',
          \ 'syntax_missing_comma',
          \ 'syntax_malformed_keyword',
          \ 'undefined_variable',
          \ 'comment_task',
          \ 'context_file',
          \ 'context_contract',
          \ 'moduledoc',
          \ 'function_spec',
          \ 'function_doc',
          \ 'class_doc',
          \ 'duplicate_line',
          \ 'variable_doc',
        \ 'flow_comment',
        \ 'function_comment',
        \ 'functional_reassignment',
        \ 'debug_output',
        \ 'missing_dependency',
        \ 'nested_condition',
        \ 'todo_fixme',
        \ 'unit_test',
        \ 'trailing_whitespace',
        \ 'tabs',
          \ 'markdown_title',
          \ 'terraform_required_version',
          \ 'dockerfile_workdir'
          \ ]
  endif
  unlet! s:registry_auto_fix_kinds
endif

if !exists('g:pingu_auto_fix_max_per_check')
  " 0 ou negativo significa sem limite por ciclo.
  let g:pingu_auto_fix_max_per_check = 0
endif

if !exists('g:pingu_realtime_auto_fix_max_per_check')
  " Limita o lote automatico por ciclo realtime para reduzir congelamentos perceptiveis.
  let g:pingu_realtime_auto_fix_max_per_check = 2
endif

if !exists('g:pingu_auto_fix_non_blocking_max_per_check')
  " Limita lote de autofix em modo non-blocking para reduzir impacto por ciclo.
  let g:pingu_auto_fix_non_blocking_max_per_check = 2
endif

if !exists('g:pingu_auto_fix_strict_validation')
  " 1 reanalisa e valida guard de forma sincrona apos autofix; 0 prioriza fluxo non-blocking.
  let g:pingu_auto_fix_strict_validation = has('nvim') ? 0 : 1
endif

if !exists('g:pingu_auto_fix_cursor_only')
  " Compatibilidade: 1 forca modo cursor_only; 0 respeita pingu_auto_fix_scope.
  let g:pingu_auto_fix_cursor_only = 0
endif

if !exists('g:pingu_auto_fix_scope')
  " near_cursor: aplica apenas o trecho mais proximo do cursor; file: aplica o arquivo inteiro; cursor_only: aplica somente no cursor.
  let g:pingu_auto_fix_scope = 'near_cursor'
endif

if !exists('g:pingu_auto_fix_near_cursor_radius')
  " Numero maximo de linhas entre o cursor e o bloco elegivel para auto-fix.
  let g:pingu_auto_fix_near_cursor_radius = 24
endif

if !exists('g:pingu_auto_fix_large_file_line_threshold')
  " Acima deste tamanho o agente encolhe o raio automatico e limita comentarios por lote.
  let g:pingu_auto_fix_large_file_line_threshold = 260
endif

if !exists('g:pingu_auto_fix_large_file_radius')
  " Raio reduzido usado em arquivos grandes para manter o lote perto do cursor.
  let g:pingu_auto_fix_large_file_radius = 12
endif

if !exists('g:pingu_auto_fix_cluster_gap')
  " Distancia maxima entre issues consecutivos para pertencerem ao mesmo trecho.
  let g:pingu_auto_fix_cluster_gap = 8
endif

if !exists('g:pingu_auto_fix_doc_max_per_check')
  " Limite global de issues documentais por ciclo; 0 remove o corte.
  let g:pingu_auto_fix_doc_max_per_check = 0
endif

if !exists('g:pingu_auto_fix_doc_max_per_check_large_file')
  " Em arquivo grande, limita comentarios/docstrings por ciclo para reduzir custo visual.
  let g:pingu_auto_fix_doc_max_per_check_large_file = 4
endif

if !exists('g:pingu_auto_fix_doc_cursor_context_only')
  " Mantem comentarios automaticos elegiveis no arquivo inteiro.
  let g:pingu_auto_fix_doc_cursor_context_only = 0
endif

if !exists('g:pingu_realtime_doc_cursor_context_only')
  " No realtime, comentarios automaticos ficam no bloco do cursor para evitar edicao fora de foco.
  let g:pingu_realtime_doc_cursor_context_only = 1
endif

if !exists('g:pingu_auto_fix_local_cursor_context_only')
  " Restringe syntax/debug/higiene/specs leves ao bloco textual atual do cursor.
  let g:pingu_auto_fix_local_cursor_context_only = 1
endif

if !exists('g:pingu_auto_fix_doc_cursor_context_max_lines')
  " Numero maximo de linhas contiguousas consideradas como contexto documental do cursor.
  let g:pingu_auto_fix_doc_cursor_context_max_lines = 80
endif

if !exists('g:pingu_auto_fix_visual_mode')
  " preserve: aplica o lote inteiro e redesenha uma vez ao final; step: mantem atualizacao incremental.
  let g:pingu_auto_fix_visual_mode = 'preserve'
endif

if !exists('g:pingu_target_scope')
  " current_file: limita analise exibida e auto-fix ao arquivo atual; workspace: permite acoes multi-arquivo.
  let g:pingu_target_scope = 'current_file'
endif


let s:internal_script = fnamemodify(resolve(expand('<sfile>:p')), ':h:h') . '/autoload/pingu_dev_agent/internal.vim'
if filereadable(s:internal_script)
  execute 'source ' . fnameescape(s:internal_script)
endif
unlet s:internal_script
