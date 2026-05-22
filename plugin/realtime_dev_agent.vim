if exists('g:loaded_realtime_dev_agent')
  finish
endif
let g:loaded_realtime_dev_agent = 1

let s:pingu_config_names = [
  \ 'allow_sync_fallback',
  \ 'analysis_cache_max_entries',
  \ 'auto_check_max_lines',
  \ 'auto_fix_cluster_gap',
  \ 'auto_fix_cursor_only',
  \ 'auto_fix_doc_cursor_context_max_lines',
  \ 'auto_fix_doc_cursor_context_only',
  \ 'auto_fix_doc_max_per_check',
  \ 'auto_fix_doc_max_per_check_large_file',
  \ 'auto_fix_enabled',
  \ 'auto_fix_kinds',
  \ 'auto_fix_large_file_line_threshold',
  \ 'auto_fix_large_file_radius',
  \ 'auto_fix_local_cursor_context_only',
  \ 'auto_fix_max_per_check',
  \ 'auto_fix_near_cursor_radius',
  \ 'auto_fix_non_blocking_max_per_check',
  \ 'auto_fix_scope',
  \ 'auto_fix_strict_validation',
  \ 'auto_fix_visual_mode',
  \ 'auto_on_save',
  \ 'code_extensions',
  \ 'extensions',
  \ 'ignore_patterns',
  \ 'issue_kind_registry',
  \ 'latency_metrics_enabled',
  \ 'latency_metrics_max_entries',
  \ 'lsp_ai_fix_enabled',
  \ 'lsp_ai_fix_max_per_check',
  \ 'lsp_ai_fix_severities',
  \ 'lsp_auto_fix_enabled',
  \ 'lsp_auto_fix_max_per_check',
  \ 'lsp_auto_fix_max_severity',
  \ 'lsp_auto_fix_only',
  \ 'lsp_auto_fix_prefer_global',
  \ 'lsp_auto_fix_timeout_ms',
  \ 'map_key',
  \ 'node_path',
  \ 'non_blocking_mode',
  \ 'open_qf',
  \ 'open_window_on_start',
  \ 'realtime_analysis_mode',
  \ 'realtime_async',
  \ 'realtime_auto_fix_max_per_check',
  \ 'realtime_delay',
  \ 'realtime_doc_cursor_context_only',
  \ 'realtime_focus_scope_enabled',
  \ 'realtime_insert_mode',
  \ 'realtime_on_buf_enter',
  \ 'realtime_on_buffer_load',
  \ 'realtime_on_change',
  \ 'realtime_on_cursor_hold',
  \ 'realtime_open_qf',
  \ 'realtime_use_daemon',
  \ 'review_on_open',
  \ 'script',
  \ 'show_window',
  \ 'start_on_editor_enter',
  \ 'strict_code_only',
  \ 'target_scope',
  \ 'terminal_actions_enabled',
  \ 'terminal_height',
  \ 'terminal_risk_mode',
  \ 'terminal_strategy',
  \ 'window_height',
  \ 'window_key',
  \ 'window_name'
\ ]

function! s:set_global_value(name, value) abort
  let g:[a:name] = deepcopy(a:value)
endfunction

function! s:sync_pingu_config_aliases(prefer_pingu_only) abort
  for l:name in s:pingu_config_names
    let l:pingu_name = 'pingu_' . l:name
    let l:legacy_name = 'realtime_dev_agent_' . l:name
    let l:has_pingu = exists('g:' . l:pingu_name)
    let l:has_legacy = exists('g:' . l:legacy_name)

    if l:has_pingu && (!a:prefer_pingu_only || !l:has_legacy)
      call s:set_global_value(l:legacy_name, get(g:, l:pingu_name))
    elseif !l:has_pingu && l:has_legacy
      call s:set_global_value(l:pingu_name, get(g:, l:legacy_name))
    endif
  endfor
endfunction

call s:sync_pingu_config_aliases(v:true)

if !exists('g:realtime_dev_agent_script')
  " Mantem o caminho do script de agente automaticamente para os cenarios
  " de repo local ou plugin instalado no packpath.
  let s:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  let s:candidates = [
    \ fnamemodify(s:plugin_dir . '/../../realtime_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../realtime_dev_agent.js', ':p'),
    \ fnamemodify(s:plugin_dir . '/../../../realtime_dev_agent.js', ':p')
  \ ]
  let s:found = ''
  for s:candidate in s:candidates
    if filereadable(s:candidate)
      let s:found = s:candidate
      break
    endif
  endfor

  if s:found !=# ''
    let g:realtime_dev_agent_script = s:found
  else
    let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
  endif

  unlet s:plugin_dir s:candidates s:found s:candidate
endif

let s:js_candidate = substitute(g:realtime_dev_agent_script, '\.exs$', '.js', '')
if g:realtime_dev_agent_script =~? '\.exs$' && filereadable(s:js_candidate)
  let g:realtime_dev_agent_script = s:js_candidate
elseif g:realtime_dev_agent_script =~? '\.js$'
  if !filereadable(expand(g:realtime_dev_agent_script))
    let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
  endif
elseif !executable('node')
  let g:realtime_dev_agent_script = 'realtime_dev_agent.js'
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

if !exists('g:realtime_dev_agent_issue_kind_registry')
  let g:realtime_dev_agent_issue_kind_registry = s:read_issue_kind_registry()
endif

if !exists('g:realtime_dev_agent_extensions')
  " Lista de extensoes em branco significa qualquer arquivo rastreavel.
  " Exemplo: ['.ex', '.exs', '.js', '.tsx']
  let g:realtime_dev_agent_extensions = []
endif

if !exists('g:realtime_dev_agent_strict_code_only')
  " Ativa filtro estrito para somente arquivos de codigo de extensoes conhecidas.
  " 0 (padrao): respeita a regra existente de g:realtime_dev_agent_extensions.
  " 1: analisa somente extensoes em g:realtime_dev_agent_code_extensions.
  let g:realtime_dev_agent_strict_code_only = 0
endif

if !exists('g:realtime_dev_agent_code_extensions')
  " Lista base para modo estrito de produtividade, alinhada com as linguagens mapeadas no runtime.
  let g:realtime_dev_agent_code_extensions = [
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

if !exists('g:realtime_dev_agent_node_path')
  let g:realtime_dev_agent_node_path = ''
endif

if !exists('g:realtime_dev_agent_ignore_patterns')
  " Lista de trechos de caminho para ignorar no fluxo do agente.
  " Ex.: ['.git/', 'node_modules/', 'dist/', 'build/', '.next/', 'coverage/']
  let g:realtime_dev_agent_ignore_patterns = [
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

if !exists('g:realtime_dev_agent_auto_on_save')
  " Consolida correcoes e comentarios automaticamente no save.
  let g:realtime_dev_agent_auto_on_save = 1
endif

if !exists('g:realtime_dev_agent_realtime_on_change')
  " Executa analise automaticamente durante digitacao (com debounce).
  " 1 ativa, 0 desativa.
  let g:realtime_dev_agent_realtime_on_change = 1
endif

if !exists('g:realtime_dev_agent_realtime_analysis_mode')
  " light reduz custo no loop automatico; full mantem a mesma profundidade da analise manual.
  let g:realtime_dev_agent_realtime_analysis_mode = 'light'
endif

if !exists('g:realtime_dev_agent_realtime_on_cursor_hold')
  " Desligado por padrao para evitar reanalises enquanto o usuario apenas navega pelo arquivo.
  let g:realtime_dev_agent_realtime_on_cursor_hold = 0
endif

if !exists('g:realtime_dev_agent_realtime_on_buf_enter')
  " Desligado por padrao para evitar trabalho repetido ao alternar buffers no LazyVim.
  let g:realtime_dev_agent_realtime_on_buf_enter = 0
endif

if !exists('g:realtime_dev_agent_realtime_on_buffer_load')
  " Dispara analise assim que o buffer e carregado (arquivo aberto/criado).
  let g:realtime_dev_agent_realtime_on_buffer_load = 1
endif

if !exists('g:realtime_dev_agent_realtime_insert_mode')
  " 0 concentra a checagem ao sair da insercao para preservar responsividade durante digitacao.
  let g:realtime_dev_agent_realtime_insert_mode = 0
endif

if !exists('g:realtime_dev_agent_review_on_open')
  " Ligado por padrao para o agente revisar o arquivo assim que ele entra no fluxo.
  let g:realtime_dev_agent_review_on_open = 1
endif

if !exists('g:realtime_dev_agent_start_on_editor_enter')
  " Inicia o agente automaticamente no primeiro buffer suportado da sessao.
  let g:realtime_dev_agent_start_on_editor_enter = 1
endif

if !exists('g:realtime_dev_agent_open_window_on_start')
  " Mantem o painel fechado no startup automatico para reduzir ruido e custo visual.
  let g:realtime_dev_agent_open_window_on_start = 0
endif

if !exists('g:realtime_dev_agent_auto_check_max_lines')
  " Limite de linhas para checks automaticos no editor.
  " 0 desliga o limite.
  let g:realtime_dev_agent_auto_check_max_lines = 600
endif

if !exists('g:realtime_dev_agent_realtime_delay')
  " Milisegundos de espera apos a ultima mudanca para disparar a checagem.
  let g:realtime_dev_agent_realtime_delay = 900
endif

if !exists('g:realtime_dev_agent_realtime_async')
  " No Neovim, roda o loop automatico em job assincrono para evitar travar a UI.
  let g:realtime_dev_agent_realtime_async = has('nvim') ? 1 : 0
endif

if !exists('g:realtime_dev_agent_non_blocking_mode')
  " Prioriza execucao em background e evita caminhos sincronos pesados no editor.
  let g:realtime_dev_agent_non_blocking_mode = has('nvim') ? 1 : 0
endif

if !exists('g:realtime_dev_agent_allow_sync_fallback')
  " Em modo non-blocking, evita fallback sincrono quando o job async nao inicia.
  let g:realtime_dev_agent_allow_sync_fallback = has('nvim') ? 0 : 1
endif

if !exists('g:realtime_dev_agent_realtime_use_daemon')
  " Reaproveita um runtime residente no Neovim para reduzir spawn por analise realtime.
  let g:realtime_dev_agent_realtime_use_daemon = has('nvim') ? 1 : 0
endif

if !exists('g:realtime_dev_agent_realtime_focus_scope_enabled')
  " Limita a analise leve realtime ao bloco atual do cursor para reduzir custo fora do contexto imediato.
  let g:realtime_dev_agent_realtime_focus_scope_enabled = 1
endif

if !exists('g:realtime_dev_agent_analysis_cache_max_entries')
  " Mantem um cache pequeno por changedtick para evitar relancar o agente no mesmo texto.
  let g:realtime_dev_agent_analysis_cache_max_entries = 24
endif

if !exists('g:realtime_dev_agent_latency_metrics_enabled')
  " Mantem telemetria local desligada por padrao; habilite para diagnosticar latencia do runtime.
  let g:realtime_dev_agent_latency_metrics_enabled = 0
endif

if !exists('g:realtime_dev_agent_latency_metrics_max_entries')
  " Quantidade maxima de amostras mantidas em memoria na sessao do editor.
  let g:realtime_dev_agent_latency_metrics_max_entries = 50
endif

if !exists('g:realtime_dev_agent_realtime_open_qf')
  " Mantem quickfix fechado no fluxo em tempo real para evitar ruido.
  let g:realtime_dev_agent_realtime_open_qf = 0
endif

if !exists('g:realtime_dev_agent_open_qf')
  " No fluxo de janela (pairing), manter quickfix fechado.
  let g:realtime_dev_agent_open_qf = 0
endif

if !exists('g:realtime_dev_agent_map_key')
  " Atalho de analise rapida do arquivo atual: <leader>i.
  let g:realtime_dev_agent_map_key = '<leader>i'
endif

if !exists('g:realtime_dev_agent_window_key')
  " Mapeamento para abrir e fechar a janela de interacao em tempo real.
  let g:realtime_dev_agent_window_key = '<leader>ia'
endif

if !exists('g:realtime_dev_agent_show_window')
  " Mantem a janela visivel apenas quando o usuario pede modo painel.
  let g:realtime_dev_agent_show_window = 0
endif

if !exists('g:realtime_dev_agent_window_height')
  let g:realtime_dev_agent_window_height = 12
endif

if !exists('g:realtime_dev_agent_window_name')
  let g:realtime_dev_agent_window_name = '__Pingu__'
endif

if !exists('g:realtime_dev_agent_auto_fix_enabled')
  " 1 aplica snippets automaticamente; 0 exige aceitação com <Tab>.
  let g:realtime_dev_agent_auto_fix_enabled = 1
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_enabled')
  " 1 tenta aplicar code actions de diagnosticos do LSP durante o lote automatico.
  let g:realtime_dev_agent_lsp_auto_fix_enabled = has('nvim') ? 1 : 0
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_max_per_check')
  " Limita quantos diagnosticos do LSP entram por ciclo de analise.
  let g:realtime_dev_agent_lsp_auto_fix_max_per_check = 3
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_timeout_ms')
  " Timeout da busca de code actions no LSP (ms).
  let g:realtime_dev_agent_lsp_auto_fix_timeout_ms = 400
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_max_severity')
  " Severidade maxima elegivel: error(1), warning(2), info(3), hint(4).
  let g:realtime_dev_agent_lsp_auto_fix_max_severity = 'warning'
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_only')
  " Ordem de prioridade para code actions do LSP no lote automatico.
  let g:realtime_dev_agent_lsp_auto_fix_only = ['source.fixAll', 'source.organizeImports', 'quickfix']
endif

if !exists('g:realtime_dev_agent_lsp_auto_fix_prefer_global')
  " 1 tenta fixAll/organizeImports no escopo do arquivo antes do quickfix local.
  let g:realtime_dev_agent_lsp_auto_fix_prefer_global = 1
endif

if !exists('g:realtime_dev_agent_lsp_ai_fix_enabled')
  " 1 permite fallback com Copilot para warnings do LSP sem code action aplicavel.
  let g:realtime_dev_agent_lsp_ai_fix_enabled = has('nvim') ? 1 : 0
endif

if !exists('g:realtime_dev_agent_lsp_ai_fix_max_per_check')
  " Limita quantos warnings do LSP podem chamar o provider externo por ciclo.
  let g:realtime_dev_agent_lsp_ai_fix_max_per_check = 1
endif

if !exists('g:realtime_dev_agent_lsp_ai_fix_severities')
  let g:realtime_dev_agent_lsp_ai_fix_severities = ['warning']
endif

if !exists('g:realtime_dev_agent_terminal_actions_enabled')
  " 1 permite executar acoes de terminal inferidas a partir de comentarios com *.
  let g:realtime_dev_agent_terminal_actions_enabled = 1
endif

if !exists('g:realtime_dev_agent_terminal_risk_mode')
  " safe: somente leitura; workspace_write: permite escrita local; all: libera tudo.
  let g:realtime_dev_agent_terminal_risk_mode = 'safe'
endif

if !exists('g:realtime_dev_agent_terminal_height')
  " Altura da split usada para exibir a execucao de comandos do terminal.
  let g:realtime_dev_agent_terminal_height = 12
endif

if !exists('g:realtime_dev_agent_terminal_strategy')
  " background: mantem foco no codigo; auto usa ToggleTerm quando houver TermExec e terminal nativa como fallback.
  " background: abre o terminal, inicia a execucao e devolve o foco ao codigo mantendo o output visivel em tempo real.
  let g:realtime_dev_agent_terminal_strategy = 'background'
endif

if !exists('g:realtime_dev_agent_auto_fix_kinds')
  " Pair mode: revisar e corrigir boas praticas automaticamente sem pausa.
  let s:registry_auto_fix_kinds = s:default_auto_fix_kinds_from_registry(g:realtime_dev_agent_issue_kind_registry)
  if !empty(s:registry_auto_fix_kinds)
    let g:realtime_dev_agent_auto_fix_kinds = s:registry_auto_fix_kinds
  else
    let g:realtime_dev_agent_auto_fix_kinds = [
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

if !exists('g:realtime_dev_agent_auto_fix_max_per_check')
  " 0 ou negativo significa sem limite por ciclo.
  let g:realtime_dev_agent_auto_fix_max_per_check = 0
endif

if !exists('g:realtime_dev_agent_realtime_auto_fix_max_per_check')
  " Limita o lote automatico por ciclo realtime para reduzir congelamentos perceptiveis.
  let g:realtime_dev_agent_realtime_auto_fix_max_per_check = 2
endif

if !exists('g:realtime_dev_agent_auto_fix_non_blocking_max_per_check')
  " Limita lote de autofix em modo non-blocking para reduzir impacto por ciclo.
  let g:realtime_dev_agent_auto_fix_non_blocking_max_per_check = 2
endif

if !exists('g:realtime_dev_agent_auto_fix_strict_validation')
  " 1 reanalisa e valida guard de forma sincrona apos autofix; 0 prioriza fluxo non-blocking.
  let g:realtime_dev_agent_auto_fix_strict_validation = has('nvim') ? 0 : 1
endif

if !exists('g:realtime_dev_agent_auto_fix_cursor_only')
  " Compatibilidade: 1 forca modo cursor_only; 0 respeita realtime_dev_agent_auto_fix_scope.
  let g:realtime_dev_agent_auto_fix_cursor_only = 0
endif

if !exists('g:realtime_dev_agent_auto_fix_scope')
  " near_cursor: aplica apenas o trecho mais proximo do cursor; file: aplica o arquivo inteiro; cursor_only: aplica somente no cursor.
  let g:realtime_dev_agent_auto_fix_scope = 'near_cursor'
endif

if !exists('g:realtime_dev_agent_auto_fix_near_cursor_radius')
  " Numero maximo de linhas entre o cursor e o bloco elegivel para auto-fix.
  let g:realtime_dev_agent_auto_fix_near_cursor_radius = 24
endif

if !exists('g:realtime_dev_agent_auto_fix_large_file_line_threshold')
  " Acima deste tamanho o agente encolhe o raio automatico e limita comentarios por lote.
  let g:realtime_dev_agent_auto_fix_large_file_line_threshold = 260
endif

if !exists('g:realtime_dev_agent_auto_fix_large_file_radius')
  " Raio reduzido usado em arquivos grandes para manter o lote perto do cursor.
  let g:realtime_dev_agent_auto_fix_large_file_radius = 12
endif

if !exists('g:realtime_dev_agent_auto_fix_cluster_gap')
  " Distancia maxima entre issues consecutivos para pertencerem ao mesmo trecho.
  let g:realtime_dev_agent_auto_fix_cluster_gap = 8
endif

if !exists('g:realtime_dev_agent_auto_fix_doc_max_per_check')
  " Limite global de issues documentais por ciclo; 0 remove o corte.
  let g:realtime_dev_agent_auto_fix_doc_max_per_check = 0
endif

if !exists('g:realtime_dev_agent_auto_fix_doc_max_per_check_large_file')
  " Em arquivo grande, limita comentarios/docstrings por ciclo para reduzir custo visual.
  let g:realtime_dev_agent_auto_fix_doc_max_per_check_large_file = 4
endif

if !exists('g:realtime_dev_agent_auto_fix_doc_cursor_context_only')
  " Mantem comentarios automaticos elegiveis no arquivo inteiro.
  let g:realtime_dev_agent_auto_fix_doc_cursor_context_only = 0
endif

if !exists('g:realtime_dev_agent_realtime_doc_cursor_context_only')
  " No realtime, comentarios automaticos ficam no bloco do cursor para evitar edicao fora de foco.
  let g:realtime_dev_agent_realtime_doc_cursor_context_only = 1
endif

if !exists('g:realtime_dev_agent_auto_fix_local_cursor_context_only')
  " Restringe syntax/debug/higiene/specs leves ao bloco textual atual do cursor.
  let g:realtime_dev_agent_auto_fix_local_cursor_context_only = 1
endif

if !exists('g:realtime_dev_agent_auto_fix_doc_cursor_context_max_lines')
  " Numero maximo de linhas contiguousas consideradas como contexto documental do cursor.
  let g:realtime_dev_agent_auto_fix_doc_cursor_context_max_lines = 80
endif

if !exists('g:realtime_dev_agent_auto_fix_visual_mode')
  " preserve: aplica o lote inteiro e redesenha uma vez ao final; step: mantem atualizacao incremental.
  let g:realtime_dev_agent_auto_fix_visual_mode = 'preserve'
endif

if !exists('g:realtime_dev_agent_target_scope')
  " current_file: limita analise exibida e auto-fix ao arquivo atual; workspace: permite acoes multi-arquivo.
  let g:realtime_dev_agent_target_scope = 'current_file'
endif

call s:sync_pingu_config_aliases(v:false)

let s:internal_script = fnamemodify(resolve(expand('<sfile>:p')), ':h:h') . '/autoload/realtime_dev_agent/internal.vim'
if filereadable(s:internal_script)
  execute 'source ' . fnameescape(s:internal_script)
endif
unlet s:internal_script
