if exists('g:loaded_realtime_dev_agent_internal')
  finish
endif
let g:loaded_realtime_dev_agent_internal = 1

let s:realtime_dev_agent_realtime_timer = -1
let s:realtime_dev_agent_realtime_pending_buf = -1
let s:realtime_dev_agent_last_qf = []
let s:realtime_dev_agent_pending_issue = {}
let s:realtime_dev_agent_pending_auto_fixes = []
let s:realtime_dev_agent_auto_fix_busy = v:false
let s:realtime_dev_agent_is_realtime_check = v:false
let s:realtime_dev_agent_suppress_auto_fix_once = v:false
let s:realtime_dev_agent_file_ticks = {}
let s:realtime_dev_agent_fix_guard = {}
let s:realtime_dev_agent_last_cursor_context_key = ''
let s:realtime_dev_agent_window_source_winid = -1
let s:realtime_dev_agent_started = v:false
let s:realtime_dev_agent_visual_batch_context = {}
let s:realtime_dev_agent_analysis_cache = {}
let s:realtime_dev_agent_analysis_cache_order = []
let s:realtime_dev_agent_async_analysis_job = -1
let s:realtime_dev_agent_async_analysis_context = {}
let s:realtime_dev_agent_daemon_job = -1
let s:realtime_dev_agent_daemon_request_seq = 0
let s:realtime_dev_agent_daemon_pending = {}
let s:realtime_dev_agent_daemon_stdout_remainder = ''
let s:realtime_dev_agent_hidden_terminal_jobs = {}
let s:realtime_dev_agent_auto_fix_timer = -1
let s:realtime_dev_agent_auto_fix_state = {}

function! s:issue_kind_entry(kind) abort
  let l:registry = get(g:, 'realtime_dev_agent_issue_kind_registry', {})
  if type(l:registry) != v:t_dict || empty(l:registry)
    return {}
  endif
  return get(l:registry, a:kind, {})
endfunction

function! s:realtime_dev_agent_node_path() abort
  let l:configured = trim('' . get(g:, 'realtime_dev_agent_node_path', ''))
  if !empty(l:configured)
    if filereadable(l:configured) && executable(l:configured)
      return fnamemodify(l:configured, ':p')
    endif
    let l:resolved = exepath(l:configured)
    if !empty(l:resolved)
      return l:resolved
    endif
  endif

  let l:resolved = exepath('node')
  if !empty(l:resolved)
    return l:resolved
  endif

  return executable('node') ? 'node' : ''
endfunction

function! s:realtime_dev_agent_script_runner() abort
  let l:node = s:realtime_dev_agent_node_path()
  return empty(l:node) || empty(s:realtime_dev_agent_script_path()) ? '' : l:node
endfunction

function! s:realtime_dev_agent_script_candidates() abort
  let l:candidates = []
  let l:configured = expand(get(g:, 'realtime_dev_agent_script', ''))
  if !empty(l:configured)
    call add(l:candidates, l:configured)
    call add(l:candidates, fnamemodify(l:configured, ':p'))
  endif

  let l:plugin_dir = fnamemodify(resolve(expand('<sfile>:p')), ':h')
  call extend(l:candidates, [
        \ fnamemodify(l:plugin_dir . '/../../realtime_dev_agent.js', ':p'),
        \ fnamemodify(l:plugin_dir . '/../realtime_dev_agent.js', ':p'),
        \ fnamemodify(l:plugin_dir . '/../../../realtime_dev_agent.js', ':p'),
        \ fnamemodify('realtime_dev_agent.js', ':p')
        \ ])
  return l:candidates
endfunction

function! s:realtime_dev_agent_script_path() abort
  for l:candidate in s:realtime_dev_agent_script_candidates()
    let l:script = fnamemodify(resolve(fnamemodify(l:candidate, ':p')), ':p')
    if empty(l:script)
      continue
    endif
    if l:script =~? '\.exs$'
      let l:script = substitute(l:script, '\.exs$', '.js', '')
    endif
    if l:script =~? '\.js$' && filereadable(l:script)
      let g:realtime_dev_agent_script = l:script
      return l:script
    endif
  endfor

  return ''
endfunction

function! s:realtime_dev_agent_guard_runtime_path() abort
  let l:guard_runtime = fnamemodify(resolve(expand('<sfile>:p')), ':h') . '/guard_runtime.js'
  return filereadable(l:guard_runtime) ? fnamemodify(l:guard_runtime, ':p') : ''
endfunction

function! s:realtime_dev_agent_script_label() abort
  return 'Node.js'
endfunction

function! s:sh_binary() abort
  return executable('sh') ? exepath('sh') : 'sh'
endfunction

function! s:shell_escape_list(argv) abort
  return join(map(copy(a:argv), {_, val -> shellescape('' . val)}), ' ')
endfunction

function! s:project_command_argv(argv, cwd) abort
  let l:inner = s:shell_escape_list(a:argv)
  if !empty(a:cwd)
    let l:inner = 'cd ' . shellescape(a:cwd) . ' && ' . l:inner
  endif
  return [s:sh_binary(), '-lc', l:inner]
endfunction

function! s:run_systemlist(argv, cwd, ...) abort
  let l:command = s:project_command_argv(a:argv, a:cwd)
  try
    if a:0 > 0
      return systemlist(l:command, a:1)
    endif
    return systemlist(l:command)
  catch
    let l:fallback = s:shell_escape_list(l:command)
    if a:0 > 0
      return systemlist(l:fallback, a:1)
    endif
    return systemlist(l:fallback)
  endtry
endfunction

function! s:run_shell_systemlist(command, cwd, ...) abort
  let l:inner = !empty(a:cwd)
        \ ? 'cd ' . shellescape(a:cwd) . ' && ' . a:command
        \ : a:command
  let l:command_argv = [s:sh_binary(), '-lc', l:inner]
  try
    if a:0 > 0
      return systemlist(l:command_argv, a:1)
    endif
    return systemlist(l:command_argv)
  catch
    let l:fallback = s:shell_escape_list(l:command_argv)
    if a:0 > 0
      return systemlist(l:fallback, a:1)
    endif
    return systemlist(l:fallback)
  endtry
endfunction

function! s:realtime_async_enabled() abort
  if !has('nvim') || !exists('*jobstart')
    return v:false
  endif
  return get(g:, 'realtime_dev_agent_realtime_async', has('nvim') ? 1 : 0) ? v:true : v:false
endfunction

function! s:realtime_daemon_enabled() abort
  if !s:realtime_async_enabled()
    return v:false
  endif
  return get(g:, 'realtime_dev_agent_realtime_use_daemon', has('nvim') ? 1 : 0) ? v:true : v:false
endfunction

function! s:non_blocking_mode_enabled() abort
  return str2nr(string(get(g:, 'realtime_dev_agent_non_blocking_mode', has('nvim') ? 1 : 0))) > 0
endfunction

function! s:allow_sync_fallback() abort
  if !s:non_blocking_mode_enabled()
    return v:true
  endif
  return str2nr(string(get(g:, 'realtime_dev_agent_allow_sync_fallback', has('nvim') ? 0 : 1))) > 0
endfunction

function! s:auto_fix_strict_validation_enabled() abort
  if !s:non_blocking_mode_enabled()
    return v:true
  endif
  return str2nr(string(get(g:, 'realtime_dev_agent_auto_fix_strict_validation', 0))) > 0
endfunction

function! s:auto_fix_non_blocking_max_per_check() abort
  let l:max_to_apply = get(g:, 'realtime_dev_agent_auto_fix_non_blocking_max_per_check', 4)
  if type(l:max_to_apply) != v:t_number
    let l:max_to_apply = str2nr(string(l:max_to_apply))
  endif
  return max([1, l:max_to_apply])
endfunction

function! s:start_async_realtime_check_with_fallback(bufnr, open_qf, show_echo, analysis_mode, realtime_mode) abort
  if s:start_async_realtime_check(a:bufnr, a:open_qf, a:show_echo, a:analysis_mode, a:realtime_mode)
    return v:true
  endif

  if !s:allow_sync_fallback()
    if a:show_echo
      echomsg '[RealtimeDevAgent] Analise async indisponivel; fallback sincrono desativado em modo non-blocking'
    endif
    return v:false
  endif

  let l:previous_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let s:realtime_dev_agent_is_realtime_check = a:realtime_mode ? v:true : v:false
  try
    call s:realtime_check_from_buffer(a:bufnr, a:open_qf, a:show_echo, a:analysis_mode)
  finally
    let s:realtime_dev_agent_is_realtime_check = l:previous_mode
  endtry
  return v:true
endfunction

function! s:project_root(file) abort
  let l:start_dir = fnamemodify(a:file, ':p:h')
  let l:current_dir = l:start_dir
  let l:source_dir_names = ['src', 'app', 'lib', 'domain', 'application', 'infrastructure', 'interfaces', 'main', 'internal', 'pkg', 'cmd', 'lua', 'autoload', 'scripts']

  while v:true
    let l:git_dir = finddir('.git', l:current_dir . ';')
    if !empty(l:git_dir)
      return fnamemodify(l:git_dir . '/../', ':p:h')
    endif

    if index(l:source_dir_names, tolower(fnamemodify(l:current_dir, ':t'))) != -1
      return fnamemodify(l:current_dir, ':h')
    endif

    for l:source_dir_name in l:source_dir_names
      if isdirectory(l:current_dir . '/' . l:source_dir_name)
        return l:current_dir
      endif
    endfor

    let l:parent_dir = fnamemodify(l:current_dir, ':h')
    if empty(l:parent_dir) || l:parent_dir ==# l:current_dir
      return l:start_dir
    endif
    let l:current_dir = l:parent_dir
  endwhile
endfunction

function! s:file_type_token(file) abort
  let l:basename = tolower(fnamemodify(a:file, ':t'))
  if l:basename ==# 'dockerfile' || l:basename =~# '^dockerfile\.'
    return '.dockerfile'
  endif

  let l:ext = fnamemodify(a:file, ':e')
  if empty(l:ext)
    return ''
  endif
  return '.' . l:ext
endfunction
function! s:should_check_file(file) abort
  " Regras basicas para decidir se o buffer atual entra no fluxo do agente.
  " Se extensao estiver em branco, aceita qualquer arquivo de texto rastreavel.
  if empty(a:file) || !filereadable(a:file)
    return v:false
  endif

  let l:file_normalized = fnamemodify(a:file, ':p')
  let l:file_normalized = substitute(l:file_normalized, '\\', '/', 'g')
  for l:ignored in g:realtime_dev_agent_ignore_patterns
    if empty(l:ignored)
      continue
    endif
    let l:pattern = substitute(l:ignored, '\\', '/', 'g')
    if stridx(l:file_normalized, l:pattern) != -1
      return v:false
    endif
  endfor

  let l:ext = s:file_type_token(a:file)
  if g:realtime_dev_agent_strict_code_only
    if index(g:realtime_dev_agent_code_extensions, l:ext) == -1
      return v:false
    endif
    if empty(g:realtime_dev_agent_extensions)
      return v:true
    endif
    let l:allowed = index(g:realtime_dev_agent_extensions, l:ext) >= 0
    return l:allowed
  endif

  if empty(g:realtime_dev_agent_extensions)
    return v:true
  endif

  let l:allowed = index(g:realtime_dev_agent_extensions, l:ext) >= 0
  return l:allowed
endfunction

function! s:buffer_line_count(bufnr) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return 0
  endif

  if exists('*getbufinfo')
    let l:info = getbufinfo(a:bufnr)
    if type(l:info) == v:t_list && !empty(l:info)
      return get(l:info[0], 'linecount', 0)
    endif
  endif

  return len(getbufline(a:bufnr, 1, '$'))
endfunction

function! s:auto_check_max_lines() abort
  let l:max_lines = get(g:, 'realtime_dev_agent_auto_check_max_lines', 600)
  if type(l:max_lines) != v:t_number
    let l:max_lines = str2nr(string(l:max_lines))
  endif
  return l:max_lines > 0 ? l:max_lines : 0
endfunction

function! s:analysis_cache_max_entries() abort
  let l:max_entries = get(g:, 'realtime_dev_agent_analysis_cache_max_entries', 24)
  if type(l:max_entries) != v:t_number
    let l:max_entries = str2nr(string(l:max_entries))
  endif
  return l:max_entries > 0 ? l:max_entries : 0
endfunction

function! s:normalize_analysis_mode(mode) abort
  let l:mode = tolower(trim('' . a:mode))
  return l:mode ==# 'full' ? 'full' : 'light'
endfunction

function! s:analysis_mode_for_request(realtime_mode) abort
  if a:realtime_mode
    return s:normalize_analysis_mode(get(g:, 'realtime_dev_agent_realtime_analysis_mode', 'light'))
  endif
  return 'full'
endfunction

function! s:analysis_cache_key(file, changedtick, analysis_mode, ...) abort
  let l:focus_start_line = a:0 > 0 ? max([0, str2nr(string(a:1))]) : 0
  let l:focus_end_line = a:0 > 1 ? max([0, str2nr(string(a:2))]) : 0
  return printf(
        \ '%s|%d|%s|%d|%d',
        \ fnamemodify(a:file, ':p'),
        \ a:changedtick,
        \ s:normalize_analysis_mode(a:analysis_mode),
        \ l:focus_start_line,
        \ l:focus_end_line
        \ )
endfunction

function! s:touch_analysis_cache_key(key) abort
  let l:index = index(s:realtime_dev_agent_analysis_cache_order, a:key)
  if l:index >= 0
    call remove(s:realtime_dev_agent_analysis_cache_order, l:index)
  endif
  call add(s:realtime_dev_agent_analysis_cache_order, a:key)
endfunction

function! s:prune_analysis_cache() abort
  let l:max_entries = s:analysis_cache_max_entries()
  if l:max_entries <= 0
    let s:realtime_dev_agent_analysis_cache = {}
    let s:realtime_dev_agent_analysis_cache_order = []
    return
  endif

  while len(s:realtime_dev_agent_analysis_cache_order) > l:max_entries
    let l:stale_key = remove(s:realtime_dev_agent_analysis_cache_order, 0)
    call remove(s:realtime_dev_agent_analysis_cache, l:stale_key)
  endwhile
endfunction

function! s:drop_analysis_cache_for_file(file) abort
  let l:file = fnamemodify(a:file, ':p')
  let l:survivors = []
  for l:key in s:realtime_dev_agent_analysis_cache_order
    if stridx(l:key, l:file . '|') == 0
      call remove(s:realtime_dev_agent_analysis_cache, l:key)
      continue
    endif
    call add(l:survivors, l:key)
  endfor
  let s:realtime_dev_agent_analysis_cache_order = l:survivors
endfunction

function! s:cached_analysis_for_buffer(file, changedtick, analysis_mode, ...) abort
  let l:focus_start_line = a:0 > 0 ? a:1 : 0
  let l:focus_end_line = a:0 > 1 ? a:2 : 0
  let l:key = s:analysis_cache_key(a:file, a:changedtick, a:analysis_mode, l:focus_start_line, l:focus_end_line)
  if !has_key(s:realtime_dev_agent_analysis_cache, l:key)
    return {}
  endif

  call s:touch_analysis_cache_key(l:key)
  let l:cached = deepcopy(s:realtime_dev_agent_analysis_cache[l:key])
  let l:cached.from_cache = v:true
  return l:cached
endfunction

function! s:store_analysis_for_buffer(file, changedtick, analysis_mode, analysis, ...) abort
  let l:max_entries = s:analysis_cache_max_entries()
  if l:max_entries <= 0
    return a:analysis
  endif

  let l:focus_start_line = a:0 > 0 ? a:1 : 0
  let l:focus_end_line = a:0 > 1 ? a:2 : 0
  let l:key = s:analysis_cache_key(a:file, a:changedtick, a:analysis_mode, l:focus_start_line, l:focus_end_line)
  let l:stored = deepcopy(a:analysis)
  let l:stored.from_cache = v:false
  let s:realtime_dev_agent_analysis_cache[l:key] = l:stored
  call s:touch_analysis_cache_key(l:key)
  call s:prune_analysis_cache()
  return l:stored
endfunction

function! s:track_buffer_tick(file, changedtick) abort
  let l:file_key = fnamemodify(a:file, ':p')
  let l:last_file_tick = get(s:realtime_dev_agent_file_ticks, l:file_key, -1)
  if l:last_file_tick ==# a:changedtick
    return
  endif

  let s:realtime_dev_agent_file_ticks[l:file_key] = a:changedtick
  let s:realtime_dev_agent_fix_guard[l:file_key] = {}
  call s:drop_analysis_cache_for_file(l:file_key)
endfunction

function! s:cleanup_async_analysis_temp_file(context) abort
  let l:tmp_file = get(a:context, 'buffer_dirty_tmp', '')
  if !empty(l:tmp_file)
    silent! call delete(l:tmp_file)
  endif
endfunction

function! s:stop_async_analysis_job() abort
  let l:job = get(s:, 'realtime_dev_agent_async_analysis_job', -1)
  let l:context = get(s:, 'realtime_dev_agent_async_analysis_context', {})
  let s:realtime_dev_agent_async_analysis_job = -1
  let s:realtime_dev_agent_async_analysis_context = {}

  if l:job > 0
    silent! call jobstop(l:job)
  endif
  call s:cleanup_async_analysis_temp_file(l:context)
endfunction

function! s:prepared_analysis_request(bufnr, ...) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return {
          \ 'ok': v:false,
          \ 'file': '',
          \ 'error': 'buffer indisponivel para analise',
          \ }
  endif

  let l:file = fnamemodify(bufname(a:bufnr), ':p')
  let l:changedtick = getbufvar(a:bufnr, 'changedtick', 0)
  let l:analysis_mode = a:0 > 0 ? s:normalize_analysis_mode(a:1) : 'full'
  let [l:focus_start_line, l:focus_end_line] = s:analysis_focus_scope_for_buffer(a:bufnr, l:analysis_mode)
  call s:track_buffer_tick(l:file, l:changedtick)

  let l:cached = s:cached_analysis_for_buffer(
        \ l:file,
        \ l:changedtick,
        \ l:analysis_mode,
        \ l:focus_start_line,
        \ l:focus_end_line
        \ )
  if !empty(l:cached)
    return {
          \ 'ok': v:true,
          \ 'file': l:file,
          \ 'changedtick': l:changedtick,
          \ 'analysis_mode': l:analysis_mode,
          \ 'focus_start_line': l:focus_start_line,
          \ 'focus_end_line': l:focus_end_line,
          \ 'cached': l:cached,
          \ 'buffer_dirty_tmp': '',
          \ }
  endif

  let l:runner = s:realtime_dev_agent_script_runner()
  let l:script = s:realtime_dev_agent_script_path()
  if empty(l:runner) || empty(l:script)
    return {
          \ 'ok': v:false,
          \ 'file': l:file,
          \ 'error': 'runtime nao encontrado',
          \ }
  endif

  let l:target_file = l:file
  let l:buffer_dirty_tmp = ''
  let l:stdin_payload = ''
  let l:uses_stdin = v:false
  if getbufvar(a:bufnr, '&modified')
    let l:stdin_payload = join(getbufline(a:bufnr, 1, '$'), "\n")
    let l:uses_stdin = v:true
  endif

  let l:root = s:project_root(l:file)
  let l:argv = [l:runner, l:script]
  if l:uses_stdin
    call extend(l:argv, ['--stdin'])
  else
    call extend(l:argv, ['--analyze', l:target_file])
  endif
  call extend(l:argv, [
        \ '--source-path',
        \ l:file,
        \ '--analysis-mode',
        \ l:analysis_mode,
        \ '--json'
        \ ])
  if l:focus_start_line > 0 && l:focus_end_line >= l:focus_start_line
    call extend(l:argv, [
          \ '--focus-start-line',
          \ string(l:focus_start_line),
          \ '--focus-end-line',
          \ string(l:focus_end_line)
          \ ])
  endif
  return {
        \ 'ok': v:true,
        \ 'file': l:file,
        \ 'changedtick': l:changedtick,
        \ 'analysis_mode': l:analysis_mode,
        \ 'focus_start_line': l:focus_start_line,
        \ 'focus_end_line': l:focus_end_line,
        \ 'buffer_dirty_tmp': l:buffer_dirty_tmp,
        \ 'stdin_payload': l:stdin_payload,
        \ 'uses_stdin': l:uses_stdin,
        \ 'root': l:root,
        \ 'argv': l:argv,
        \ }
endfunction

function! s:analysis_qf_from_output(output, file, buffer_dirty_tmp) abort
  try
    let l:decoded = json_decode(join(a:output, "\n"))
    if type(l:decoded) == v:t_list
      return s:qf_items_from_issues(l:decoded, a:file)
    endif
  catch
  endtry

  return s:parse_analysis_output(a:output, a:file, a:buffer_dirty_tmp)
endfunction

function! s:should_run_auto_check(bufnr) abort
  let l:max_lines = s:auto_check_max_lines()
  if l:max_lines <= 0
    return v:true
  endif
  let l:line_count = s:buffer_line_count(a:bufnr)
  if l:line_count <= l:max_lines
    return v:true
  endif

  if !s:realtime_async_enabled() || !s:non_blocking_mode_enabled() || !get(g:, 'realtime_dev_agent_realtime_focus_scope_enabled', 1)
    return v:false
  endif

  if s:analysis_mode_for_request(v:true) !=# 'light'
    return v:false
  endif

  return l:line_count <= max([l:max_lines, 5000])
endfunction

function! s:realtime_dev_agent_open_review() abort
  if s:realtime_dev_agent_start_current_buffer()
    return
  endif

  if !g:realtime_dev_agent_review_on_open
    return
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr) || s:realtime_dev_agent_auto_fix_busy
    return
  endif
  if &l:buftype !=# ''
    return
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return
  endif
  if !s:should_run_auto_check(l:bufnr)
    return
  endif

  call s:remember_code_window(win_getid())
  let l:analysis_mode = s:analysis_mode_for_request(v:true)
  call s:start_async_realtime_check_with_fallback(l:bufnr, g:realtime_dev_agent_realtime_open_qf, 0, l:analysis_mode, v:true)
endfunction

function! s:notify_operational_noot() abort
  let l:message = 'Noot noot!'
  if has('nvim') && exists('*luaeval')
    try
      call luaeval('vim.notify(_A[1], vim.log.levels.INFO, { title = _A[2] })', [l:message, 'Pingu'])
      return
    catch
    endtry
  endif

  if exists('*popup_notification')
    call popup_notification(l:message, {'title': 'Pingu'})
    return
  endif

  echomsg '[RealtimeDevAgent] ' . l:message
endfunction

function! s:realtime_dev_agent_start_current_buffer() abort
  if s:realtime_dev_agent_started
    return v:false
  endif

  if !get(g:, 'realtime_dev_agent_start_on_editor_enter', 0)
    return v:false
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr) || s:realtime_dev_agent_auto_fix_busy
    return v:false
  endif

  if &l:buftype !=# ''
    return v:false
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return v:false
  endif
  if !s:should_run_auto_check(l:bufnr)
    return v:false
  endif

  let s:realtime_dev_agent_started = v:true
  call s:remember_code_window(win_getid())
  call s:notify_operational_noot()

  if get(g:, 'realtime_dev_agent_open_window_on_start', 1)
    let g:realtime_dev_agent_show_window = 1
    call s:window_open()
  endif

  let l:analysis_mode = s:analysis_mode_for_request(v:true)
  call s:start_async_realtime_check_with_fallback(l:bufnr, g:realtime_dev_agent_open_qf, 0, l:analysis_mode, v:true)
  return v:true
endfunction

function! s:window_buffer() abort
  return bufnr(g:realtime_dev_agent_window_name, 1)
endfunction

function! s:window_find() abort
  let l:buf = s:window_buffer()
  for l:w in range(1, winnr('$'))
    if winbufnr(l:w) == l:buf
      return l:w
    endif
  endfor
  return -1
endfunction

function! s:is_panel_window(winid) abort
  let l:winnr = win_id2win(a:winid)
  if l:winnr == 0
    return v:false
  endif
  return winbufnr(l:winnr) == s:window_buffer()
endfunction

function! s:is_code_window(winid) abort
  let l:winnr = win_id2win(a:winid)
  if l:winnr == 0 || s:is_panel_window(a:winid)
    return v:false
  endif

  let l:buf = winbufnr(l:winnr)
  if l:buf <= 0 || !bufexists(l:buf)
    return v:false
  endif

  return getbufvar(l:buf, '&buftype') ==# ''
endfunction

function! s:remember_code_window(winid) abort
  if s:is_code_window(a:winid)
    let s:realtime_dev_agent_window_source_winid = a:winid
  endif
endfunction

function! s:focus_code_window() abort
  let l:preferred = get(s:, 'realtime_dev_agent_window_source_winid', -1)
  if s:is_code_window(l:preferred)
    call win_gotoid(l:preferred)
    return v:true
  endif

  let l:current = win_getid()
  if s:is_code_window(l:current)
    call s:remember_code_window(l:current)
    return v:true
  endif

  for l:info in getwininfo()
    if s:is_code_window(l:info.winid)
      call win_gotoid(l:info.winid)
      call s:remember_code_window(l:info.winid)
      return v:true
    endif
  endfor

  execute 'aboveleft split'
  call s:remember_code_window(win_getid())
  return v:true
endfunction

function! s:focus_issue_target_file(file) abort
  if !s:focus_code_window()
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  let l:target_winid = bufwinid(l:target_buf)
  if l:target_winid > 0 && !s:is_panel_window(l:target_winid)
    call win_gotoid(l:target_winid)
    call s:remember_code_window(l:target_winid)
    return v:true
  endif

  if bufnr('%') != l:target_buf
    execute 'silent! keepalt keepjumps buffer ' . l:target_buf
    if bufnr('%') != l:target_buf
      return v:false
    endif
  endif

  call s:remember_code_window(win_getid())
  return v:true
endfunction

function! s:auto_fix_visual_mode() abort
  let l:mode = tolower(trim('' . get(g:, 'realtime_dev_agent_auto_fix_visual_mode', 'preserve')))
  if index(['preserve', 'step'], l:mode) == -1
    return 'preserve'
  endif
  return l:mode
endfunction

function! s:target_scope() abort
  let l:scope = tolower(trim('' . get(g:, 'realtime_dev_agent_target_scope', 'current_file')))
  if index(['current_file', 'workspace'], l:scope) == -1
    return 'current_file'
  endif
  return l:scope
endfunction

function! s:is_safe_unit_test_target(source_file, target_file) abort
  let l:source_file = fnamemodify(a:source_file, ':p')
  let l:target_file = fnamemodify(a:target_file, ':p')
  if empty(l:source_file) || empty(l:target_file) || l:source_file ==# l:target_file
    return v:false
  endif

  let l:source_dir = fnamemodify(l:source_file, ':h')
  let l:target_dir = fnamemodify(l:target_file, ':h')
  let l:target_name = tolower(fnamemodify(l:target_file, ':t'))
  let l:normalized_target = substitute(l:target_file, '\\', '/', 'g')
  let l:normalized_source_dir = substitute(l:source_dir, '\\', '/', 'g')
  let l:normalized_target_dir = substitute(l:target_dir, '\\', '/', 'g')

  if l:normalized_target =~# '/tests\?/'
    return v:true
  endif
  if l:normalized_target_dir ==# l:normalized_source_dir
    if l:target_name =~# '\v(^test_.*\.py$|_test\.(go|py|exs|rs|rb|c|vim|sh)$|_spec\.lua$|\.test\.(js|jsx|ts|tsx|mjs|cjs)$|\.spec\.(js|jsx|ts|tsx|mjs|cjs)$)'
      return v:true
    endif
  endif
  return v:false
endfunction

function! s:is_safe_context_file_target(source_file, target_file) abort
  let l:source_file = fnamemodify(a:source_file, ':p')
  let l:target_file = fnamemodify(a:target_file, ':p')
  if empty(l:source_file) || empty(l:target_file) || l:source_file ==# l:target_file
    return v:false
  endif

  let l:project_root = fnamemodify(s:project_root(l:source_file), ':p')
  let l:normalized_target = substitute(l:target_file, '\\', '/', 'g')
  let l:normalized_root = substitute(l:project_root, '\\', '/', 'g')
  if empty(l:normalized_root)
    return v:false
  endif

  if l:normalized_target ==# l:normalized_root . '/.gitignore'
    return v:true
  endif

  if l:normalized_target ==# l:normalized_root . '/README.md'
    return v:true
  endif

  if l:normalized_target =~# '^' . escape(l:normalized_root . '/docs/', '\')
    return v:true
  endif

  if l:normalized_target =~# '^' . escape(l:normalized_root . '/.github/', '\')
    return v:true
  endif

  if l:normalized_target =~# '^' . escape(l:normalized_root . '/\(src\|lib\|app\|domain\|application\|infrastructure\|interfaces\|main\|internal\|pkg\|cmd\)/', '\')
    return v:true
  endif

  return l:normalized_target =~# '^' . escape(l:normalized_root . '/.realtime-dev-agent/', '\')
endfunction

function! s:is_scope_safe_write_file_issue(item, current_file) abort
  let l:action = s:issue_effective_action(a:item)
  if get(l:action, 'op', '') !=# 'write_file'
    return v:false
  endif

  let l:target_file = trim(get(l:action, 'target_file', ''))
  if empty(l:target_file)
    return v:false
  endif

  let l:kind = get(a:item, 'kind', '')
  if l:kind ==# 'unit_test'
    return s:is_safe_unit_test_target(a:current_file, l:target_file)
  endif
  if l:kind ==# 'context_file'
    return s:is_safe_context_file_target(a:current_file, l:target_file)
  endif

  return v:false
endfunction

function! s:issue_targets_active_scope(item, current_file) abort
  let l:current_file = fnamemodify(a:current_file, ':p')
  if empty(l:current_file)
    return v:false
  endif

  let l:issue_file = fnamemodify(get(a:item, 'filename', ''), ':p')
  if l:issue_file !=# l:current_file
    return v:false
  endif

  let l:action = s:issue_effective_action(a:item)
  if get(l:action, 'op', '') !=# 'write_file' || s:target_scope() ==# 'workspace'
    return v:true
  endif

  if s:is_scope_safe_write_file_issue(a:item, l:current_file)
    return v:true
  endif

  let l:target_file = trim(get(l:action, 'target_file', ''))
  return !empty(l:target_file) && fnamemodify(l:target_file, ':p') ==# l:current_file
endfunction

function! s:auto_fix_scope() abort
  if str2nr(string(get(g:, 'realtime_dev_agent_auto_fix_cursor_only', 0))) > 0
    return 'cursor_only'
  endif

  let l:scope = tolower(trim('' . get(g:, 'realtime_dev_agent_auto_fix_scope', 'near_cursor')))
  if index(['near_cursor', 'file', 'cursor_only'], l:scope) == -1
    return 'near_cursor'
  endif
  return l:scope
endfunction

function! s:auto_fix_near_cursor_radius() abort
  let l:radius = get(g:, 'realtime_dev_agent_auto_fix_near_cursor_radius', 24)
  if type(l:radius) != v:t_number
    let l:radius = str2nr(string(l:radius))
  endif
  if s:is_large_auto_fix_buffer()
    let l:radius = min([l:radius, s:auto_fix_large_file_radius()])
  endif
  return max([0, l:radius])
endfunction

function! s:auto_fix_large_file_line_threshold() abort
  let l:threshold = get(g:, 'realtime_dev_agent_auto_fix_large_file_line_threshold', 260)
  if type(l:threshold) != v:t_number
    let l:threshold = str2nr(string(l:threshold))
  endif
  return max([0, l:threshold])
endfunction

function! s:auto_fix_large_file_radius() abort
  let l:radius = get(g:, 'realtime_dev_agent_auto_fix_large_file_radius', 12)
  if type(l:radius) != v:t_number
    let l:radius = str2nr(string(l:radius))
  endif
  return max([0, l:radius])
endfunction

function! s:auto_fix_cluster_gap() abort
  let l:gap = get(g:, 'realtime_dev_agent_auto_fix_cluster_gap', 8)
  if type(l:gap) != v:t_number
    let l:gap = str2nr(string(l:gap))
  endif
  return max([1, l:gap])
endfunction

function! s:auto_fix_doc_max_per_check() abort
  let l:limit = get(g:, 'realtime_dev_agent_auto_fix_doc_max_per_check', 0)
  if type(l:limit) != v:t_number
    let l:limit = str2nr(string(l:limit))
  endif
  return max([0, l:limit])
endfunction

function! s:auto_fix_doc_max_per_check_large_file() abort
  let l:limit = get(g:, 'realtime_dev_agent_auto_fix_doc_max_per_check_large_file', 4)
  if type(l:limit) != v:t_number
    let l:limit = str2nr(string(l:limit))
  endif
  return max([0, l:limit])
endfunction

function! s:auto_fix_doc_cursor_context_only() abort
  return str2nr(string(get(g:, 'realtime_dev_agent_auto_fix_doc_cursor_context_only', 1))) > 0
endfunction

function! s:realtime_doc_cursor_context_only() abort
  return str2nr(string(get(g:, 'realtime_dev_agent_realtime_doc_cursor_context_only', 1))) > 0
endfunction

function! s:auto_fix_local_cursor_context_only() abort
  return str2nr(string(get(g:, 'realtime_dev_agent_auto_fix_local_cursor_context_only', 1))) > 0
endfunction

function! s:auto_fix_doc_cursor_context_max_lines() abort
  let l:max_lines = get(g:, 'realtime_dev_agent_auto_fix_doc_cursor_context_max_lines', 80)
  if type(l:max_lines) != v:t_number
    let l:max_lines = str2nr(string(l:max_lines))
  endif
  return max([0, l:max_lines])
endfunction

function! s:is_large_auto_fix_buffer() abort
  let l:threshold = s:auto_fix_large_file_line_threshold()
  if l:threshold <= 0
    return v:false
  endif
  return line('$') > l:threshold
endfunction

function! s:is_documentation_issue(item) abort
  let l:kind = get(a:item, 'kind', '')
  return index(['class_doc', 'flow_comment', 'function_comment', 'function_doc', 'moduledoc', 'variable_doc'], l:kind) != -1
endfunction

function! s:is_local_cursor_context_issue(item) abort
  let l:kind = get(a:item, 'kind', '')
  return index([
        \ 'debug_output',
        \ 'dockerfile_workdir',
        \ 'function_spec',
        \ 'markdown_title',
        \ 'syntax_extra_delimiter',
        \ 'syntax_missing_comma',
        \ 'syntax_missing_delimiter',
        \ 'syntax_malformed_keyword',
        \ 'syntax_missing_quote',
        \ 'terraform_required_version',
        \ 'trailing_whitespace',
        \ 'lsp_ai_fix'
        \ ], l:kind) != -1
endfunction

function! s:is_scope_agnostic_issue(item) abort
  let l:kind = trim('' . get(a:item, 'kind', ''))
  if empty(l:kind)
    return v:false
  endif
  if l:kind ==# 'lsp_code_action'
    return v:true
  endif
  return l:kind =~# '^syntax_'
endfunction

function! s:should_limit_issue_to_cursor_context(item, ...) abort
  let l:force_documentation_context = a:0 > 0 ? a:1 : v:false
  if s:is_scope_agnostic_issue(a:item)
    return v:false
  endif
  if s:is_documentation_issue(a:item)
    return l:force_documentation_context || s:auto_fix_doc_cursor_context_only()
  endif
  if s:is_local_cursor_context_issue(a:item)
    return s:auto_fix_local_cursor_context_only()
  endif
  return v:false
endfunction

function! s:buffer_line_text(bufnr, lnum) abort
  let l:lines = getbufline(a:bufnr, a:lnum)
  if empty(l:lines)
    return ''
  endif
  return l:lines[0]
endfunction

function! s:is_blank_buffer_line(bufnr, lnum) abort
  return empty(trim(s:buffer_line_text(a:bufnr, a:lnum)))
endfunction

function! s:nearest_meaningful_cursor_line(bufnr, cursor_line) abort
  let l:last_line = s:buffer_line_count(a:bufnr)
  if l:last_line <= 0
    return max([1, a:cursor_line])
  endif

  let l:anchor = max([1, min([a:cursor_line, l:last_line])])
  if !s:is_blank_buffer_line(a:bufnr, l:anchor)
    return l:anchor
  endif

  let l:max_seek = min([12, l:last_line])
  for l:offset in range(1, l:max_seek)
    let l:up = l:anchor - l:offset
    if l:up >= 1 && !s:is_blank_buffer_line(a:bufnr, l:up)
      return l:up
    endif
    let l:down = l:anchor + l:offset
    if l:down <= l:last_line && !s:is_blank_buffer_line(a:bufnr, l:down)
      return l:down
    endif
  endfor

  return l:anchor
endfunction

function! s:cursor_context_bounds_for_buffer(bufnr, cursor_line) abort
  let l:last_line = s:buffer_line_count(a:bufnr)
  if l:last_line <= 0
    return [1, 1]
  endif

  let l:max_lines = s:auto_fix_doc_cursor_context_max_lines()
  let l:anchor = s:nearest_meaningful_cursor_line(a:bufnr, a:cursor_line)
  let l:start = l:anchor
  let l:end = l:anchor
  let l:consumed = 1

  while l:start > 1
    if l:max_lines > 0 && l:consumed >= l:max_lines
      break
    endif
    if s:is_blank_buffer_line(a:bufnr, l:start - 1)
      break
    endif
    let l:start -= 1
    let l:consumed += 1
  endwhile

  while l:end < l:last_line
    if l:max_lines > 0 && l:consumed >= l:max_lines
      break
    endif
    if s:is_blank_buffer_line(a:bufnr, l:end + 1)
      break
    endif
    let l:end += 1
    let l:consumed += 1
  endwhile

  return [l:start, l:end]
endfunction

function! s:current_cursor_context_key(bufnr) abort
  let l:file = fnamemodify(bufname(a:bufnr), ':p')
  let [l:start, l:end] = s:cursor_context_bounds_for_buffer(a:bufnr, line('.'))
  let l:changedtick = getbufvar(a:bufnr, 'changedtick', 0)
  return printf('%s|%d|%d|%d', l:file, l:changedtick, l:start, l:end)
endfunction

function! s:buffer_cursor_line(bufnr) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return 1
  endif

  if a:bufnr == bufnr('%')
    return max([1, line('.')])
  endif

  let l:info = getbufinfo(a:bufnr)
  if type(l:info) == v:t_list && !empty(l:info)
    return max([1, get(l:info[0], 'lnum', 1)])
  endif

  return 1
endfunction

function! s:analysis_focus_scope_for_buffer(bufnr, analysis_mode) abort
  if !get(g:, 'realtime_dev_agent_realtime_focus_scope_enabled', 1)
    return [0, 0]
  endif
  if s:normalize_analysis_mode(a:analysis_mode) !=# 'light'
    return [0, 0]
  endif
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return [0, 0]
  endif

  return s:cursor_context_bounds_for_buffer(a:bufnr, line('.'))
endfunction

function! s:limit_cursor_context_auto_fix_candidates(items, ...) abort
  let l:scope = s:auto_fix_scope()
  let l:force_documentation_context = a:0 > 1 ? a:2 : v:false
  if l:scope ==# 'file' && !l:force_documentation_context
    return a:items
  endif

  let l:bufnr = a:0 > 0 ? a:1 : bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr)
    return a:items
  endif

  let l:cursor_line = s:buffer_cursor_line(l:bufnr)
  let [l:start, l:end] = s:cursor_context_bounds_for_buffer(l:bufnr, l:cursor_line)
  let l:selected = []
  for l:item in a:items
    if !s:should_limit_issue_to_cursor_context(l:item, l:force_documentation_context)
      call add(l:selected, l:item)
      continue
    endif
    let l:item_line = get(l:item, 'lnum', 0)
    if l:item_line >= l:start && l:item_line <= l:end
      call add(l:selected, l:item)
    endif
  endfor
  return l:selected
endfunction

function! s:limit_documentation_candidates(items) abort
  let l:limit = s:auto_fix_doc_max_per_check()
  if s:is_large_auto_fix_buffer()
    let l:large_limit = s:auto_fix_doc_max_per_check_large_file()
    if l:limit <= 0 || (l:large_limit > 0 && l:large_limit < l:limit)
      let l:limit = l:large_limit
    endif
  endif

  if l:limit <= 0
    return a:items
  endif

  let l:selected = []
  let l:doc_count = 0
  for l:item in a:items
    if s:is_documentation_issue(l:item)
      if l:doc_count >= l:limit
        continue
      endif
      let l:doc_count += 1
    endif
    call add(l:selected, l:item)
  endfor
  return l:selected
endfunction

function! s:compare_issue_line_asc(entry_a, entry_b) abort
  let l:line_a = get(a:entry_a, 'lnum', 0)
  let l:line_b = get(a:entry_b, 'lnum', 0)
  if l:line_a == l:line_b
    return s:compare_fix_order(a:entry_a, a:entry_b)
  endif
  return l:line_a < l:line_b ? -1 : 1
endfunction

function! s:build_auto_fix_clusters(items) abort
  let l:ordered = copy(a:items)
  call sort(l:ordered, function('s:compare_issue_line_asc'))

  let l:clusters = []
  let l:cluster = []
  let l:last_line = -1
  let l:gap = s:auto_fix_cluster_gap()
  for l:item in l:ordered
    let l:item_line = max([1, get(l:item, 'lnum', 1)])
    if empty(l:cluster) || (l:item_line - l:last_line) <= l:gap
      call add(l:cluster, l:item)
    else
      call add(l:clusters, l:cluster)
      let l:cluster = [l:item]
    endif
    let l:last_line = l:item_line
  endfor

  if !empty(l:cluster)
    call add(l:clusters, l:cluster)
  endif
  return l:clusters
endfunction

function! s:cluster_distance_to_cursor(cluster, cursor_line) abort
  if empty(a:cluster)
    return 999999
  endif

  let l:start_line = get(a:cluster[0], 'lnum', a:cursor_line)
  let l:end_line = get(a:cluster[-1], 'lnum', a:cursor_line)
  if a:cursor_line < l:start_line
    return l:start_line - a:cursor_line
  endif
  if a:cursor_line > l:end_line
    return a:cursor_line - l:end_line
  endif
  return 0
endfunction

function! s:select_auto_fix_candidates_by_scope(items, ...) abort
  let l:scope = s:auto_fix_scope()
  let l:force_documentation_context = a:0 > 1 ? a:2 : v:false
  if l:scope ==# 'file' && !l:force_documentation_context
    return a:items
  endif

  let l:scope_agnostic_items = filter(copy(a:items), {_, item -> s:is_scope_agnostic_issue(item)})
  let l:documentation_items = []
  let l:items_to_scope = filter(copy(a:items), {_, item -> !s:is_scope_agnostic_issue(item)})
  if !l:force_documentation_context && !s:auto_fix_doc_cursor_context_only()
    let l:documentation_items = filter(copy(l:items_to_scope), {_, item -> s:is_documentation_issue(item)})
    let l:items_to_scope = filter(copy(l:items_to_scope), {_, item -> !s:is_documentation_issue(item)})
    if empty(l:items_to_scope)
      return extend(l:documentation_items, l:scope_agnostic_items)
    endif
  endif

  let l:target_buf = a:0 > 0 ? a:1 : bufnr('%')
  let l:cursor_line = s:buffer_cursor_line(l:target_buf)
  if l:scope ==# 'cursor_only'
    let l:selected_items = filter(copy(l:items_to_scope), {_, item -> abs(get(item, 'lnum', 0) - l:cursor_line) <= 1})
    let l:selected_items = extend(l:selected_items, l:scope_agnostic_items)
    return extend(l:documentation_items, l:selected_items)
  endif

  let l:radius = s:auto_fix_near_cursor_radius()
  let l:clusters = s:build_auto_fix_clusters(l:items_to_scope)
  let l:best_cluster = []
  let l:best_distance = -1
  let l:best_span = -1

  for l:cluster in l:clusters
    let l:distance = s:cluster_distance_to_cursor(l:cluster, l:cursor_line)
    if l:distance > l:radius
      continue
    endif

    let l:start_line = get(l:cluster[0], 'lnum', l:cursor_line)
    let l:end_line = get(l:cluster[-1], 'lnum', l:cursor_line)
    let l:span = max([0, l:end_line - l:start_line])
    if empty(l:best_cluster)
          \ || l:distance < l:best_distance
          \ || (l:distance == l:best_distance && l:span < l:best_span)
      let l:best_cluster = l:cluster
      let l:best_distance = l:distance
      let l:best_span = l:span
    endif
  endfor

  let l:selected = extend(l:best_cluster, l:scope_agnostic_items)
  return extend(l:documentation_items, l:selected)
endfunction

function! s:is_auto_fix_visual_batch_active() abort
  return get(s:realtime_dev_agent_visual_batch_context, 'active', v:false)
endfunction

function! s:start_auto_fix_visual_batch(bufnr) abort
  let l:context = {'active': v:false}
  if s:auto_fix_visual_mode() !=# 'preserve'
    return l:context
  endif

  let l:current_winid = win_getid()
  let l:current_buf = winbufnr(l:current_winid)
  let l:view = {}
  if l:current_buf == a:bufnr
    let l:view = winsaveview()
  endif

  let l:context = {
        \ 'active': v:true,
        \ 'winid': l:current_winid,
        \ 'bufnr': l:current_buf,
        \ 'view': l:view,
        \ 'line_adjustments': [],
        \ 'lazyredraw': &lazyredraw,
        \ }
  let &lazyredraw = 1
  let s:realtime_dev_agent_visual_batch_context = l:context
  return l:context
endfunction

function! s:shift_saved_view_for_adjustments(view, adjustments) abort
  if type(a:view) != v:t_dict || empty(a:view)
    return a:view
  endif

  let l:view = copy(a:view)
  let l:cursor_line = get(l:view, 'lnum', 0)
  if l:cursor_line > 0
    let l:view.lnum = max([1, l:cursor_line + s:cumulative_line_shift(l:cursor_line, a:adjustments)])
  endif

  let l:topline = get(l:view, 'topline', 0)
  if l:topline > 0
    let l:view.topline = max([1, l:topline + s:cumulative_line_shift(l:topline, a:adjustments)])
  endif

  return l:view
endfunction

function! s:end_auto_fix_visual_batch(context) abort
  let l:context = type(a:context) == v:t_dict ? a:context : {}
  let s:realtime_dev_agent_visual_batch_context = {}
  if !get(l:context, 'active', v:false)
    return
  endif

  let &lazyredraw = get(l:context, 'lazyredraw', 0)
  let l:target_winid = get(l:context, 'winid', -1)
  if l:target_winid > 0
    call win_gotoid(l:target_winid)
  endif

  let l:view = get(l:context, 'view', {})
  if type(l:view) == v:t_dict && !empty(l:view) && get(l:context, 'bufnr', -1) == bufnr('%')
    call winrestview(s:shift_saved_view_for_adjustments(l:view, get(l:context, 'line_adjustments', [])))
  endif
  redraw
endfunction

function! s:window_open() abort
  call s:remember_code_window(win_getid())
  let l:win = s:window_find()
  if l:win != -1
    call s:window_set_buffer_keymaps()
    return l:win
  endif

  let l:curr = winnr()
  execute 'botright ' . g:realtime_dev_agent_window_height . 'split'
  let l:win = winnr()
  execute 'buffer ' . s:window_buffer()
  setlocal buftype=nofile
  setlocal bufhidden=hide
  setlocal noswapfile
  setlocal nobuflisted
  setlocal nonumber
  setlocal norelativenumber
  setlocal nomodified
  setlocal nowrap
  setlocal nospell
  setlocal filetype=plaintext
  setlocal nomodifiable
  setlocal modifiable
  call s:window_set_buffer_keymaps()
  execute l:curr . 'wincmd w'
  return l:win
endfunction

function! s:window_set_buffer_keymaps() abort
  let l:buf = s:window_buffer()
  if !bufexists(l:buf)
    return
  endif

  let l:current = bufnr('%')
  execute 'buffer ' . l:buf
  nnoremap <buffer> <silent> <CR> :call <SID>window_jumpto_issue()<CR>
  nnoremap <buffer> <silent> r :RealtimeDevAgentWindowCheck<CR>
  nnoremap <buffer> <silent> q :RealtimeDevAgentWindowClose<CR>
  nnoremap <buffer> <silent> a :call <SID>window_apply_suggestion()<CR>
  nnoremap <buffer> <silent> i :call <SID>window_apply_suggestion()<CR>
  nnoremap <buffer> <silent> f :call <SID>window_insert_followup()<CR>
  nnoremap <buffer> <silent> <Tab> :call <SID>window_apply_suggestion()<CR>
  execute 'buffer ' . l:current
endfunction

function! s:set_code_buffer_tab_accept() abort
  if &buftype !=# ''
    return
  endif

  if g:realtime_dev_agent_auto_fix_enabled
    inoremap <buffer> <silent> <expr> <Tab> "\<Tab>"
  else
    inoremap <buffer> <silent> <expr> <Tab> <SID>realtime_dev_agent_accept_snippet_or_tab()
  endif
endfunction

function! s:realtime_dev_agent_accept_snippet_or_tab() abort
  if mode() !=# 'i'
    return "\<Tab>"
  endif

  let l:issue = s:get_buffer_issue_at_cursor()
  if empty(l:issue)
    return "\<Tab>"
  endif
  if empty(get(l:issue, 'snippet', ''))
    return "\<Tab>"
  endif

  let s:realtime_dev_agent_pending_issue = copy(l:issue)
  return "\<C-o>:call <SID>realtime_dev_agent_apply_pending_snippet_now()\<CR>"
endfunction

function! s:realtime_dev_agent_apply_pending_snippet_now() abort
  let l:issue = get(s:, 'realtime_dev_agent_pending_issue', {})
  let s:realtime_dev_agent_pending_issue = {}

  if empty(l:issue)
    return
  endif

  if s:realtime_dev_agent_auto_fix_busy
    return
  endif

  call s:apply_issue_snippet(l:issue, v:false)
endfunction

function! s:realtime_dev_agent_can_apply_auto_fixes() abort
  if s:realtime_dev_agent_auto_fix_busy
    return v:false
  endif

  if !&l:modifiable || &l:readonly
    return v:false
  endif

  return v:true
endfunction

function! s:realtime_dev_agent_can_apply_auto_fixes_for_buffer(bufnr) abort
  if s:realtime_dev_agent_auto_fix_busy
    return v:false
  endif
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return v:false
  endif
  if !getbufvar(a:bufnr, '&modifiable', 0) || getbufvar(a:bufnr, '&readonly', 0)
    return v:false
  endif
  return v:true
endfunction

function! s:realtime_dev_agent_restore_show_window(previous) abort
  if a:previous && s:window_find() != -1
    let g:realtime_dev_agent_show_window = 1
  else
    let g:realtime_dev_agent_show_window = 0
  endif
endfunction

function! s:window_jumpto_issue() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return
  endif

  let l:index = str2nr(l:match[1])
  if l:index < 1
    return
  endif

  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return
  endif

  if !s:focus_issue_target_file(l:issue.filename)
    return
  endif
  call cursor(l:issue.lnum, max([1, l:issue.col]))
  normal! zz
  redraw
endfunction

function! s:window_insert_followup() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return
  endif

  let l:index = str2nr(l:match[1])
  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return
  endif

  let l:instruction = s:build_followup_instruction(l:issue)
  let l:snippet = s:build_followup_comment(l:issue.filename, l:instruction)
  if empty(l:snippet)
    return
  endif

  if !s:focus_issue_target_file(l:issue.filename)
    return
  endif
  call cursor(l:issue.lnum, 1)
  normal! o
  call append('.', l:snippet)
  write
  call cursor(l:issue.lnum + 1, 1)
  redraw
  if g:realtime_dev_agent_realtime_on_change
    let l:analysis_mode = s:analysis_mode_for_request(v:true)
    call s:start_async_realtime_check_with_fallback(bufnr(l:issue.filename), g:realtime_dev_agent_realtime_open_qf, 0, l:analysis_mode, v:true)
  else
    call s:realtime_dev_agent_window_check()
  endif
endfunction

function! s:window_apply_suggestion() abort
  let l:issue = s:get_current_panel_issue()
  if empty(l:issue)
    return
  endif

  call s:apply_issue_snippet(l:issue, v:true)
endfunction

function! s:get_current_panel_issue() abort
  let l:line = getline('.')
  let l:match = matchlist(l:line, '^\s*\[\(\d\+\)\]')
  if empty(l:match)
    return {}
  endif

  let l:index = str2nr(l:match[1])
  let l:issue = get(s:realtime_dev_agent_last_qf, l:index - 1, {})
  if empty(l:issue)
    return {}
  endif

  return l:issue
endfunction

function! s:get_buffer_issue_at_cursor() abort
  let l:file = fnamemodify(bufname('%'), ':p')
  let l:current_line = line('.')
  let l:exact_match = {}
  let l:closest = {}
  let l:closest_distance = 1000000

  for l:item in s:realtime_dev_agent_last_qf
    if get(l:item, 'filename', '') !=# l:file
      continue
    endif
    let l:line = get(l:item, 'lnum', 0)
    if l:line == l:current_line
      let l:exact_match = l:item
      break
    endif
  endfor

  if !empty(l:exact_match)
    return l:exact_match
  endif

  for l:item in s:realtime_dev_agent_last_qf
    if get(l:item, 'filename', '') !=# l:file
      continue
    endif
    let l:line = get(l:item, 'lnum', 0)
    let l:dist = abs(l:line - l:current_line)
    if l:dist <= 2 && l:dist < l:closest_distance
      let l:closest_distance = l:dist
      let l:closest = l:item
    endif
  endfor

  if l:closest_distance <= 2
    return l:closest
  endif

  return {}
endfunction

function! s:issue_default_action(kind) abort
  let l:entry = s:issue_kind_entry(a:kind)
  let l:action = get(l:entry, 'defaultAction', {})
  if type(l:action) == v:t_dict && !empty(l:action) && has_key(l:action, 'op') && !empty(get(l:action, 'op', ''))
    return copy(l:action)
  endif
  return {'op': 'insert_before'}
endfunction

function! s:issue_fix_priority(kind) abort
  let l:entry = s:issue_kind_entry(a:kind)
  return get(l:entry, 'autoFixPriority', 999)
endfunction

function! s:issue_confidence_score(item) abort
  let l:confidence = get(a:item, 'confidence', {})
  if type(l:confidence) == v:t_dict && has_key(l:confidence, 'score')
    return float2nr(get(l:confidence, 'score', 0.0) * 100)
  endif
  return 0
endfunction

function! s:issue_auto_fix_noop_reason(item) abort
  let l:kind = get(a:item, 'kind', '')
  let l:action = s:issue_effective_action(a:item)
  let l:score = s:issue_confidence_score(a:item)

  if l:kind ==# 'ai_required'
    return 'IA obrigatoria ainda indisponivel para este fluxo'
  endif
  if l:kind ==# 'large_file'
    return 'diagnostico consultivo sem auto-fix'
  endif
  if l:kind ==# 'lsp_code_action' && !s:lsp_auto_fix_enabled()
    return 'code action do LSP indisponivel no editor atual'
  endif
  if l:kind ==# 'lsp_ai_fix' && !s:lsp_ai_fix_enabled()
    return 'fallback com Copilot para LSP indisponivel no editor atual'
  endif
  if l:kind ==# 'terminal_task' && get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
    return 'execucao automatica de terminal fica para save e checagens de consolidacao'
  endif
  if get(l:action, 'op', '') ==# 'run_command' && l:kind !=# 'terminal_task'
    return 'execucao de terminal exige confirmacao explicita'
  endif
  if l:kind ==# 'undefined_variable' && l:score > 0 && l:score < 80
    return 'evidencia insuficiente para renomear simbolo automaticamente'
  endif
  if index(['class_doc', 'flow_comment', 'function_comment', 'function_doc', 'moduledoc', 'variable_doc'], l:kind) != -1 && l:score > 0 && l:score < 55
    return 'contexto insuficiente para comentario automatico confiavel'
  endif
  if index(['context_contract', 'functional_reassignment', 'nested_condition'], l:kind) != -1 && l:score > 0 && l:score < 70
    return 'refactor semantico com confianca insuficiente para auto-fix'
  endif
  if index(['context_file', 'unit_test'], l:kind) != -1 && l:score > 0 && l:score < 60
    return 'geracao estrutural com confianca insuficiente para aplicar automaticamente'
  endif
  return ''
endfunction

function! s:issue_effective_action(item) abort
  let l:kind = get(a:item, 'kind', '')
  let l:action = get(a:item, 'action', {})
  if type(l:action) == v:t_dict && !empty(l:action) && has_key(l:action, 'op') && !empty(l:action.op)
    return l:action
  endif
  return s:issue_default_action(l:kind)
endfunction

function! s:lsp_auto_fix_enabled() abort
  if !has('nvim') || !exists('*luaeval')
    return v:false
  endif
  return str2nr(string(get(g:, 'realtime_dev_agent_lsp_auto_fix_enabled', has('nvim') ? 1 : 0))) > 0
endfunction

function! s:lsp_auto_fix_max_per_check() abort
  let l:max_items = get(g:, 'realtime_dev_agent_lsp_auto_fix_max_per_check', 3)
  if type(l:max_items) != v:t_number
    let l:max_items = str2nr(string(l:max_items))
  endif
  return max([0, l:max_items])
endfunction

function! s:lsp_auto_fix_timeout_ms() abort
  let l:timeout_ms = get(g:, 'realtime_dev_agent_lsp_auto_fix_timeout_ms', 400)
  if type(l:timeout_ms) != v:t_number
    let l:timeout_ms = str2nr(string(l:timeout_ms))
  endif
  return max([100, l:timeout_ms])
endfunction

function! s:lsp_auto_fix_max_severity() abort
  let l:raw = get(g:, 'realtime_dev_agent_lsp_auto_fix_max_severity', 'warning')
  if type(l:raw) == v:t_number
    return min([4, max([1, l:raw])])
  endif

  let l:value = tolower(trim('' . l:raw))
  if l:value ==# 'error' || l:value ==# 'err'
    return 1
  endif
  if l:value ==# 'warning' || l:value ==# 'warn'
    return 2
  endif
  if l:value ==# 'info' || l:value ==# 'information'
    return 3
  endif
  if l:value ==# 'hint'
    return 4
  endif

  let l:parsed = str2nr(l:value)
  if l:parsed <= 0
    return 2
  endif
  return min([4, max([1, l:parsed])])
endfunction

function! s:normalize_lsp_code_action_kind(kind) abort
  let l:value = trim('' . a:kind)
  if empty(l:value)
    return ''
  endif
  let l:value = substitute(l:value, '\s\+', '', 'g')
  return l:value
endfunction

function! s:lsp_auto_fix_only_kinds() abort
  let l:raw = get(g:, 'realtime_dev_agent_lsp_auto_fix_only', ['source.fixAll', 'source.organizeImports', 'quickfix'])
  let l:items = []
  if type(l:raw) == v:t_list
    let l:items = copy(l:raw)
  elseif type(l:raw) == v:t_string
    let l:items = split(l:raw, ',')
  endif

  let l:normalized = []
  let l:seen = {}
  for l:item in l:items
    let l:kind = s:normalize_lsp_code_action_kind(l:item)
    if empty(l:kind) || has_key(l:seen, l:kind)
      continue
    endif
    let l:seen[l:kind] = 1
    call add(l:normalized, l:kind)
  endfor

  if empty(l:normalized)
    return ['source.fixAll', 'source.organizeImports', 'quickfix']
  endif
  return l:normalized
endfunction

function! s:lsp_auto_fix_prefer_global() abort
  return str2nr(string(get(g:, 'realtime_dev_agent_lsp_auto_fix_prefer_global', 1))) > 0
endfunction

function! s:lsp_ai_fix_enabled() abort
  if !has('nvim') || !exists('*json_decode')
    return v:false
  endif
  return str2nr(string(get(g:, 'realtime_dev_agent_lsp_ai_fix_enabled', has('nvim') ? 1 : 0))) > 0
endfunction

function! s:lsp_ai_fix_max_per_check() abort
  let l:max_items = get(g:, 'realtime_dev_agent_lsp_ai_fix_max_per_check', 1)
  if type(l:max_items) != v:t_number
    let l:max_items = str2nr(string(l:max_items))
  endif
  return max([0, l:max_items])
endfunction

function! s:lsp_ai_fix_allowed_severity(severity) abort
  let l:raw = get(g:, 'realtime_dev_agent_lsp_ai_fix_severities', ['warning'])
  let l:items = type(l:raw) == v:t_list ? copy(l:raw) : split('' . l:raw, ',')
  let l:label = tolower(s:lsp_severity_label(a:severity))
  return index(map(l:items, {_, item -> tolower(trim('' . item))}), l:label) != -1
endfunction

function! s:lsp_source_fixall_kind(source) abort
  let l:source = tolower(trim('' . a:source))
  if empty(l:source)
    return ''
  endif
  let l:source = substitute(l:source, '[^a-z0-9._-]', '', 'g')
  if empty(l:source)
    return ''
  endif
  return 'source.fixAll.' . l:source
endfunction

function! s:lsp_only_kinds_for_diagnostic(source) abort
  let l:base = s:lsp_auto_fix_only_kinds()
  let l:source_kind = s:lsp_source_fixall_kind(a:source)
  if empty(l:source_kind)
    return l:base
  endif

  let l:result = [l:source_kind]
  for l:kind in l:base
    if l:kind ==# l:source_kind
      continue
    endif
    call add(l:result, l:kind)
  endfor
  return l:result
endfunction

function! s:lsp_severity_label(severity) abort
  if a:severity == 1
    return 'ERROR'
  endif
  if a:severity == 2
    return 'WARNING'
  endif
  if a:severity == 3
    return 'INFO'
  endif
  if a:severity == 4
    return 'HINT'
  endif
  return 'INFO'
endfunction

function! s:lsp_diagnostics_for_buffer(bufnr) abort
  if !s:lsp_auto_fix_enabled() || a:bufnr <= 0 || !bufloaded(a:bufnr)
    return []
  endif

  let l:payload = {
        \ 'bufnr': a:bufnr,
        \ 'maxSeverity': s:lsp_auto_fix_max_severity(),
        \ }
  let l:script = join([
        \ 'local input = _A or {}',
        \ 'local bufnr = tonumber(input.bufnr or 0) or 0',
        \ 'local maxSeverity = tonumber(input.maxSeverity or 2) or 2',
        \ 'if type(vim) ~= "table" or type(vim.diagnostic) ~= "table" or type(vim.diagnostic.get) ~= "function" then',
        \ '  return {}',
        \ 'end',
        \ 'local ok, diagnostics = pcall(vim.diagnostic.get, bufnr)',
        \ 'if not ok or type(diagnostics) ~= "table" then',
        \ '  return {}',
        \ 'end',
        \ 'local items = {}',
        \ 'for _, diag in ipairs(diagnostics) do',
        \ '  local sev = tonumber(diag.severity or 0) or 0',
        \ '  if sev > 0 and sev <= maxSeverity then',
        \ '    table.insert(items, {',
        \ '      lnum = (tonumber(diag.lnum or 0) or 0) + 1,',
        \ '      col = (tonumber(diag.col or 0) or 0) + 1,',
        \ '      severity = sev,',
        \ '      message = tostring(diag.message or ""),',
        \ '      code = diag.code ~= nil and tostring(diag.code) or "",',
        \ '      source = diag.source ~= nil and tostring(diag.source) or "",',
        \ '    })',
        \ '  end',
        \ 'end',
        \ 'table.sort(items, function(a, b)',
        \ '  if a.lnum == b.lnum then',
        \ '    return (a.col or 1) < (b.col or 1)',
        \ '  end',
        \ '  return (a.lnum or 1) < (b.lnum or 1)',
        \ 'end)',
        \ 'return items',
        \ ], "\n")

  try
    let l:items = luaeval(l:script, l:payload)
  catch
    return []
  endtry
  return type(l:items) == v:t_list ? l:items : []
endfunction

function! s:merge_lsp_diagnostic_auto_fix_candidates(bufnr, file, qf) abort
  if !s:lsp_auto_fix_enabled() || a:bufnr <= 0 || !bufloaded(a:bufnr)
    return a:qf
  endif

  let l:max_items = s:lsp_auto_fix_max_per_check()
  if l:max_items <= 0
    return a:qf
  endif

  let l:diagnostics = s:lsp_diagnostics_for_buffer(a:bufnr)
  if empty(l:diagnostics)
    return a:qf
  endif

  let l:target_file = fnamemodify(a:file, ':p')
  let l:synthetic = []
  let l:seen = {}
  let l:added = 0
  let l:ai_added = 0
  let l:ai_max_items = s:lsp_ai_fix_enabled() ? s:lsp_ai_fix_max_per_check() : 0
  for l:diag in l:diagnostics
    if l:added >= l:max_items
      break
    endif
    let l:lnum = max([1, str2nr(string(get(l:diag, 'lnum', 1)))])
    let l:col = max([1, str2nr(string(get(l:diag, 'col', 1)))])
    let l:message = trim('' . get(l:diag, 'message', 'Diagnostico do LSP'))
    let l:severity = str2nr(string(get(l:diag, 'severity', 2)))
    let l:source = trim('' . get(l:diag, 'source', ''))
    let l:code = trim('' . get(l:diag, 'code', ''))
    let l:key = printf('%d|%d|%s|%s|%s', l:lnum, l:col, string(l:severity), l:source, l:code)
    if has_key(l:seen, l:key)
      continue
    endif
    let l:seen[l:key] = 1

    let l:parts = [printf('[%s] lsp_code_action: %s', s:lsp_severity_label(l:severity), l:message)]
    if !empty(l:source)
      call add(l:parts, 'source=' . l:source)
    endif
    if !empty(l:code)
      call add(l:parts, 'code=' . l:code)
    endif
    call add(l:parts, 'Tenta aplicar fixAll/organizeImports/quickfix do LSP.')

    call add(l:synthetic, {
          \ 'filename': l:target_file,
          \ 'lnum': l:lnum,
          \ 'col': l:col,
          \ 'text': join(l:parts, ' | '),
          \ 'kind': 'lsp_code_action',
          \ 'autofixPriority': 25,
          \ 'lsp_source': l:source,
          \ 'lsp_code': l:code,
          \ 'lsp_message': l:message,
          \ 'lsp_severity': l:severity,
          \ 'snippet': '',
          \ 'action': {
          \   'op': 'lsp_code_action',
          \   'only': s:lsp_only_kinds_for_diagnostic(l:source),
          \   'timeout_ms': s:lsp_auto_fix_timeout_ms(),
          \   'prefer_preferred': v:true,
          \   'prefer_global': s:lsp_auto_fix_prefer_global(),
          \   'scope': 'line',
          \   'line': l:lnum,
          \ },
          \ })

    if l:ai_added < l:ai_max_items && s:lsp_ai_fix_allowed_severity(l:severity)
      let l:ai_parts = copy(l:parts)
      call add(l:ai_parts, 'Fallback: tenta resolver com Copilot quando o LSP nao aplicar code action.')
      call add(l:synthetic, {
            \ 'filename': l:target_file,
            \ 'lnum': l:lnum,
            \ 'col': l:col,
            \ 'text': join(l:ai_parts, ' | '),
            \ 'kind': 'lsp_ai_fix',
            \ 'autofixPriority': 26,
            \ 'lsp_source': l:source,
            \ 'lsp_code': l:code,
            \ 'lsp_message': l:message,
            \ 'lsp_severity': l:severity,
            \ 'snippet': '',
            \ 'action': {
            \   'op': 'lsp_ai_fix',
            \   'line': l:lnum,
            \ },
            \ })
      let l:ai_added += 1
    endif
    let l:added += 1
  endfor

  if empty(l:synthetic)
    return a:qf
  endif

  return l:synthetic + a:qf
endfunction

function! s:apply_issue_lsp_code_action(issue) abort
  if !s:lsp_auto_fix_enabled()
    return v:false
  endif

  let l:filename = fnamemodify(get(a:issue, 'filename', ''), ':p')
  let l:target_buf = s:issue_target_buffer(l:filename)
  if l:target_buf <= 0 || !bufloaded(l:target_buf)
    return v:false
  endif

  let l:action = s:issue_effective_action(a:issue)
  let l:payload = {
        \ 'bufnr': l:target_buf,
        \ 'lnum': max([1, str2nr(string(get(a:issue, 'lnum', get(l:action, 'line', 1))))]),
        \ 'timeoutMs': max([100, str2nr(string(get(l:action, 'timeout_ms', s:lsp_auto_fix_timeout_ms())))]),
        \ 'only': type(get(l:action, 'only', [])) == v:t_list ? copy(get(l:action, 'only', [])) : s:lsp_auto_fix_only_kinds(),
        \ 'preferPreferred': get(l:action, 'prefer_preferred', v:true) ? v:true : v:false,
        \ 'preferGlobal': get(l:action, 'prefer_global', s:lsp_auto_fix_prefer_global()) ? v:true : v:false,
        \ 'scope': trim('' . get(l:action, 'scope', 'line')),
        \ }
  let l:script = join([
        \ 'local input = _A or {}',
        \ 'local bufnr = tonumber(input.bufnr or 0) or 0',
        \ 'local lnum = math.max(1, tonumber(input.lnum or 1) or 1)',
        \ 'local timeoutMs = math.max(100, tonumber(input.timeoutMs or 400) or 400)',
        \ 'local only = type(input.only) == "table" and input.only or {"source.fixAll", "source.organizeImports", "quickfix"}',
        \ 'local preferPreferred = input.preferPreferred ~= false',
        \ 'local preferGlobal = input.preferGlobal ~= false',
        \ 'local scope = tostring(input.scope or "line")',
        \ 'if type(vim) ~= "table" or type(vim.lsp) ~= "table" then',
        \ '  return false',
        \ 'end',
        \ 'if type(vim.diagnostic) ~= "table" or type(vim.diagnostic.get) ~= "function" then',
        \ '  return false',
        \ 'end',
        \ 'if type(vim.lsp.buf_request_sync) ~= "function" or type(vim.lsp.util) ~= "table" then',
        \ '  return false',
        \ 'end',
        \ 'local function action_kind(action)',
        \ '  if type(action) ~= "table" then',
        \ '    return ""',
        \ '  end',
        \ '  return tostring(action.kind or (type(action.command) == "table" and action.command.command) or (type(action.command) == "string" and action.command) or "")',
        \ 'end',
        \ 'local function action_rank(action)',
        \ '  local kind = action_kind(action)',
        \ '  if kind:match("^source%.fixAll") then',
        \ '    return 1',
        \ '  end',
        \ '  if kind == "source.organizeImports" or kind:match("^source%.organizeImports") then',
        \ '    return 2',
        \ '  end',
        \ '  if kind == "quickfix" or kind:match("^quickfix%.") then',
        \ '    return 3',
        \ '  end',
        \ '  return 9',
        \ 'end',
        \ 'local function resolve_action(client, action)',
        \ '  if type(action) ~= "table" then',
        \ '    return action',
        \ '  end',
        \ '  if action.edit ~= nil or action.command ~= nil then',
        \ '    return action',
        \ '  end',
        \ '  if type(client) ~= "table" then',
        \ '    return action',
        \ '  end',
        \ '  local canResolve = false',
        \ '  if type(client.supports_method) == "function" then',
        \ '    canResolve = client.supports_method("codeAction/resolve") == true',
        \ '  elseif type(client.server_capabilities) == "table" then',
        \ '    canResolve = client.server_capabilities.codeActionProvider ~= nil',
        \ '  end',
        \ '  if not canResolve or type(client.request_sync) ~= "function" then',
        \ '    return action',
        \ '  end',
        \ '  local okResolve, resolved = pcall(client.request_sync, "codeAction/resolve", action, timeoutMs, bufnr)',
        \ '  if not okResolve or type(resolved) ~= "table" or type(resolved.result) ~= "table" then',
        \ '    return action',
        \ '  end',
        \ '  return resolved.result',
        \ 'end',
        \ 'local function execute_action(clientId, action)',
        \ '  if type(action) ~= "table" then',
        \ '    return false',
        \ '  end',
        \ '  local client = vim.lsp.get_client_by_id(clientId)',
        \ '  local resolvedAction = resolve_action(client, action)',
        \ '  if type(resolvedAction) ~= "table" then',
        \ '    resolvedAction = action',
        \ '  end',
        \ '  local encoding = (client and client.offset_encoding) or "utf-16"',
        \ '  if resolvedAction.edit then',
        \ '    pcall(vim.lsp.util.apply_workspace_edit, resolvedAction.edit, encoding)',
        \ '  end',
        \ '  local command = nil',
        \ '  if type(resolvedAction.command) == "table" and resolvedAction.command.command then',
        \ '    command = resolvedAction.command',
        \ '  elseif type(resolvedAction.command) == "string" and resolvedAction.command ~= "" then',
        \ '    command = { command = resolvedAction.command, arguments = resolvedAction.arguments }',
        \ '  end',
        \ '  if command then',
        \ '    local okExec = pcall(vim.lsp.buf.execute_command, command)',
        \ '    if not okExec and type(vim.lsp.commands) == "table" and type(vim.lsp.commands[command.command]) == "function" then',
        \ '      pcall(vim.lsp.commands[command.command], command, { client_id = clientId, bufnr = bufnr })',
        \ '    end',
        \ '  end',
        \ '  return resolvedAction.edit ~= nil or command ~= nil',
        \ 'end',
        \ 'local function pick_action(results)',
        \ '  if type(results) ~= "table" or vim.tbl_isempty(results) then',
        \ '    return nil',
        \ '  end',
        \ '  local best = nil',
        \ '  for clientId, payload in pairs(results) do',
        \ '    local actions = type(payload) == "table" and payload.result or nil',
        \ '    if type(actions) == "table" then',
        \ '      for _, action in ipairs(actions) do',
        \ '        if type(action) == "table" and action.disabled == nil then',
        \ '          local rank = action_rank(action)',
        \ '          local preferredBoost = (preferPreferred and action.isPreferred) and -1 or 0',
        \ '          local score = (rank * 10) + preferredBoost',
        \ '          if best == nil or score < best.score then',
        \ '            best = { score = score, clientId = clientId, action = action }',
        \ '          end',
        \ '        end',
        \ '      end',
        \ '    end',
        \ '  end',
        \ '  return best',
        \ 'end',
        \ 'local function request_actions(diagnostics, rangeStartLine, rangeEndLine, useOnly)',
        \ '  if type(diagnostics) ~= "table" or vim.tbl_isempty(diagnostics) then',
        \ '    return nil',
        \ '  end',
        \ '  local params = {',
        \ '    textDocument = vim.lsp.util.make_text_document_params(bufnr),',
        \ '    range = {',
        \ '      start = { line = math.max(0, rangeStartLine), character = 0 },',
        \ '      ["end"] = { line = math.max(0, rangeEndLine), character = 0 },',
        \ '    },',
        \ '    context = { diagnostics = diagnostics },',
        \ '  }',
        \ '  if useOnly ~= false and type(only) == "table" and not vim.tbl_isempty(only) then',
        \ '    params.context.only = only',
        \ '  end',
        \ '  local results = vim.lsp.buf_request_sync(bufnr, "textDocument/codeAction", params, timeoutMs)',
        \ '  return pick_action(results)',
        \ 'end',
        \ 'local function request_with_fallback(diagnostics, rangeStartLine, rangeEndLine)',
        \ '  local picked = request_actions(diagnostics, rangeStartLine, rangeEndLine, true)',
        \ '  if picked ~= nil then',
        \ '    return picked',
        \ '  end',
        \ '  return request_actions(diagnostics, rangeStartLine, rangeEndLine, false)',
        \ 'end',
        \ 'local totalLines = vim.api.nvim_buf_line_count(bufnr)',
        \ 'if totalLines <= 0 then',
        \ '  return false',
        \ 'end',
        \ 'local allDiagnostics = vim.diagnostic.get(bufnr)',
        \ 'local lineDiagnostics = vim.diagnostic.get(bufnr, { lnum = lnum - 1 })',
        \ 'local best = nil',
        \ 'if scope == "buffer" or preferGlobal then',
        \ '  best = request_with_fallback(allDiagnostics, 0, totalLines - 1)',
        \ 'end',
        \ 'if best == nil then',
        \ '  local localDiagnostics = (type(lineDiagnostics) == "table" and not vim.tbl_isempty(lineDiagnostics)) and lineDiagnostics or allDiagnostics',
        \ '  best = request_with_fallback(localDiagnostics, lnum - 1, lnum - 1)',
        \ 'end',
        \ 'if best == nil and scope ~= "buffer" and not preferGlobal then',
        \ '  best = request_with_fallback(allDiagnostics, 0, totalLines - 1)',
        \ 'end',
        \ 'if best == nil then',
        \ '  return false',
        \ 'end',
        \ 'return execute_action(best.clientId, best.action)',
        \ ], "\n")

  try
    let l:applied = luaeval(l:script, l:payload) ? v:true : v:false
  catch
    return v:false
  endtry

  if l:applied
    call s:auto_save_buffer_if_modified(l:target_buf, l:filename)
  endif
  return l:applied
endfunction

function! s:apply_issue_lsp_ai_fix(issue) abort
  if !s:lsp_ai_fix_enabled()
    return v:false
  endif

  let l:filename = fnamemodify(get(a:issue, 'filename', ''), ':p')
  let l:target_buf = s:issue_target_buffer(l:filename)
  if l:target_buf <= 0 || !bufloaded(l:target_buf)
    return v:false
  endif

  let l:runner = s:realtime_dev_agent_script_runner()
  let l:script = s:realtime_dev_agent_script_path()
  if empty(l:runner) || empty(l:script)
    return v:false
  endif

  let l:diagnostic = {
        \ 'line': max([1, str2nr(string(get(a:issue, 'lnum', 1)))]),
        \ 'col': max([1, str2nr(string(get(a:issue, 'col', 1)))]),
        \ 'severity': tolower(s:lsp_severity_label(str2nr(string(get(a:issue, 'lsp_severity', 2))))),
        \ 'message': trim('' . get(a:issue, 'lsp_message', get(a:issue, 'text', ''))),
        \ 'source': trim('' . get(a:issue, 'lsp_source', '')),
        \ 'code': trim('' . get(a:issue, 'lsp_code', '')),
        \ }
  let l:payload = {
        \ 'file': l:filename,
        \ 'lines': getbufline(l:target_buf, 1, '$'),
        \ 'diagnostic': l:diagnostic,
        \ }
  let l:argv = [l:runner, l:script, '--lsp-ai-fix']
  let l:output = s:run_systemlist(l:argv, s:project_root(l:filename), json_encode(l:payload))
  if v:shell_error != 0
    return v:false
  endif

  let l:raw = join(l:output, "\n")
  if empty(trim(l:raw))
    return v:false
  endif

  try
    let l:decoded = json_decode(l:raw)
  catch
    return v:false
  endtry
  if type(l:decoded) != v:t_dict || !get(l:decoded, 'ok', v:false)
    return v:false
  endif

  let l:resolved = get(l:decoded, 'issue', {})
  if type(l:resolved) != v:t_dict || empty(trim('' . get(l:resolved, 'snippet', '')))
    return v:false
  endif
  let l:resolved.filename = get(l:resolved, 'filename', get(l:resolved, 'file', l:filename))
  let l:resolved.lnum = max([1, str2nr(string(get(l:resolved, 'lnum', get(l:resolved, 'line', get(a:issue, 'lnum', 1)))))])
  let l:resolved.col = max([1, str2nr(string(get(l:resolved, 'col', get(a:issue, 'col', 1))))])
  let l:resolved.kind = get(l:resolved, 'kind', 'lsp_ai_fix')
  if !has_key(l:resolved, 'action') || type(get(l:resolved, 'action', {})) != v:t_dict
    let l:resolved.action = {'op': 'replace_line'}
  endif

  return s:apply_issue_snippet(l:resolved, v:false)
endfunction

function! s:extract_extra_delimiter_char(text) abort
  let l:match = matchlist(a:text, "Delimitador '\\(.\\)' sem abertura correspondente")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:issue_action_identity(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  if l:op ==# 'write_file'
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      return ''
    endif
    return fnamemodify(l:target_file, ':p')
  endif
  if l:op ==# 'run_command'
    return get(l:action, 'command', '')
  endif
  if l:op ==# 'lsp_code_action'
    let l:source = trim('' . get(a:item, 'lsp_source', ''))
    let l:code = trim('' . get(a:item, 'lsp_code', ''))
    return printf(
          \ '%d|%s|%s|%s',
          \ get(a:item, 'lnum', 0),
          \ join(type(get(l:action, 'only', [])) == v:t_list ? get(l:action, 'only', []) : [], ','),
          \ l:source,
          \ l:code
          \ )
  endif
  if l:op ==# 'lsp_ai_fix'
    return printf(
          \ '%d|%s|%s|%s',
          \ get(a:item, 'lnum', 0),
          \ trim('' . get(a:item, 'lsp_source', '')),
          \ trim('' . get(a:item, 'lsp_code', '')),
          \ trim('' . get(a:item, 'lsp_message', get(a:item, 'text', '')))
          \ )
  endif
  if index(['insert_before', 'insert_after', 'replace_line', 'delete_line'], l:op) != -1
    let l:snippet = get(a:item, 'snippet', '')
    if !empty(l:snippet)
      return join(
            \ map(copy(s:split_snippet_lines(l:snippet)), {_, val ->
            \   substitute(substitute(val, '^\s*', '', ''), '\s*$', '', '')
            \ }),
            \ "\n"
            \ )
    endif
  endif
  return get(a:item, 'text', '')
endfunction

function! s:issue_equivalence_key(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  let l:file = fnamemodify(get(a:item, 'filename', ''), ':p')
  let l:line = get(a:item, 'lnum', 0)
  let l:identity = s:issue_action_identity(a:item)

  if !empty(l:identity) && index(['insert_before', 'insert_after', 'replace_line', 'delete_line', 'write_file', 'run_command'], l:op) != -1
    return printf('%s|%d|%s|%s', l:file, l:line, l:op, l:identity)
  endif

  return printf('%s|%d|%s|%s', l:file, l:line, get(a:item, 'kind', ''), l:identity)
endfunction

function! s:uses_realtime_loop_guard(item) abort
  return s:is_documentation_issue(a:item)
endfunction

function! s:issue_realtime_loop_guard_key(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  let l:file = fnamemodify(get(a:item, 'filename', ''), ':p')
  let l:identity = s:issue_action_identity(a:item)
  if empty(l:identity)
    let l:identity = get(a:item, 'text', '')
  endif
  return printf('%s|%s|%s|%s', l:file, get(a:item, 'kind', ''), l:op, l:identity)
endfunction

function! s:normalize_line_for_insert_dedupe(text) abort
  return substitute(substitute(string(a:text), '^\s*', '', ''), '\s*$', '', '')
endfunction

function! s:find_meaningful_line_index(lines, from_end) abort
  if type(a:lines) != v:t_list || empty(a:lines)
    return -1
  endif

  if a:from_end
    let l:index = len(a:lines) - 1
    while l:index >= 0
      if !empty(s:normalize_line_for_insert_dedupe(a:lines[l:index]))
        return l:index
      endif
      let l:index -= 1
    endwhile
    return -1
  endif

  let l:index = 0
  while l:index < len(a:lines)
    if !empty(s:normalize_line_for_insert_dedupe(a:lines[l:index]))
      return l:index
    endif
    let l:index += 1
  endwhile
  return -1
endfunction

function! s:trim_insert_snippet_anchor_duplicates(snippet_lines, line_content, op) abort
  if index(['insert_before', 'insert_after'], a:op) == -1 || type(a:snippet_lines) != v:t_list || empty(a:snippet_lines)
    return a:snippet_lines
  endif

  let l:current = s:normalize_line_for_insert_dedupe(a:line_content)
  if empty(l:current)
    return a:snippet_lines
  endif

  let l:trimmed = copy(a:snippet_lines)
  let l:first_idx = s:find_meaningful_line_index(l:trimmed, v:false)
  if l:first_idx >= 0 && s:normalize_line_for_insert_dedupe(l:trimmed[l:first_idx]) ==# l:current
    call remove(l:trimmed, l:first_idx)
  endif

  let l:last_idx = s:find_meaningful_line_index(l:trimmed, v:true)
  if l:last_idx >= 0 && s:normalize_line_for_insert_dedupe(l:trimmed[l:last_idx]) ==# l:current
    call remove(l:trimmed, l:last_idx)
  endif

  return l:trimmed
endfunction

function! s:apply_issue_write_file(issue, snippet_lines) abort
  let l:issue = copy(a:issue)
  let l:action = s:issue_effective_action(a:issue)
  let l:target_file = trim(get(l:action, 'target_file', ''))
  if empty(l:target_file)
    return v:false
  endif
  let l:target_file = fnamemodify(l:target_file, ':p')
  let l:issue._trigger_line = s:issue_trigger_line_text(a:issue)
  let l:source_file = fnamemodify(get(l:issue, 'filename', ''), ':p')
  let l:snippet_lines = copy(a:snippet_lines)
  if get(l:action, 'remove_trigger', v:false) && l:target_file ==# l:source_file
    let l:snippet_lines = s:remove_trigger_from_snippet_lines(l:snippet_lines, get(l:issue, '_trigger_line', ''))
  endif

  let l:target_dir = fnamemodify(l:target_file, ':h')
  if get(l:action, 'mkdir_p', v:false) && !isdirectory(l:target_dir)
    call mkdir(l:target_dir, 'p')
  endif

  if !s:write_file_and_sync_buffer(l:target_file, l:snippet_lines)
    return v:false
  endif
  if get(l:action, 'remove_trigger', v:false) && l:target_file !=# l:source_file
    if !s:remove_issue_trigger_line(l:issue, v:false) && empty(get(l:issue, '_trigger_line', ''))
      call s:clear_issue_line(get(l:issue, 'filename', ''), get(l:issue, 'lnum', 1))
    endif
  endif
  return v:true
endfunction

function! s:remove_trigger_from_snippet_lines(snippet_lines, trigger_line) abort
  let l:trigger = trim(a:trigger_line)
  let l:lines = copy(a:snippet_lines)
  if empty(l:trigger)
    return l:lines
  endif
  for l:index in range(0, len(l:lines) - 1)
    if trim(l:lines[l:index]) ==# l:trigger
      call remove(l:lines, l:index)
      return empty(l:lines) ? [''] : l:lines
    endif
  endfor
  return l:lines
endfunction

function! s:write_file_and_sync_buffer(target_file, lines) abort
  let l:lines = empty(a:lines) ? [''] : copy(a:lines)
  let l:target_buf = bufnr(a:target_file)
  if l:target_buf > 0 && bufexists(l:target_buf)
    if !getbufvar(l:target_buf, '&modifiable', 0)
      return v:false
    endif
    noautocmd call setbufline(l:target_buf, 1, l:lines[0])
    let l:current_count = len(getbufline(l:target_buf, 1, '$'))
    if l:current_count > 1
      noautocmd call deletebufline(l:target_buf, 2, l:current_count)
    endif
    if len(l:lines) > 1
      noautocmd call appendbufline(l:target_buf, 1, l:lines[1:])
    endif
  endif
  call writefile(copy(l:lines), a:target_file, 'b')
  if l:target_buf > 0 && bufexists(l:target_buf)
    call setbufvar(l:target_buf, '&modified', 0)
  endif
  return v:true
endfunction

function! s:issue_target_buffer(file) abort
  let l:target_file = fnamemodify(a:file, ':p')
  if empty(l:target_file)
    return -1
  endif

  let l:target_buf = bufnr(l:target_file)
  if l:target_buf <= 0
    let l:target_buf = bufadd(l:target_file)
  endif
  if l:target_buf <= 0
    return -1
  endif

  call bufload(l:target_buf)
  if !bufloaded(l:target_buf)
    return -1
  endif

  return l:target_buf
endfunction

function! s:persist_buffer_contents(bufnr, file) abort
  let l:target_file = fnamemodify(a:file, ':p')
  if a:bufnr <= 0 || !bufloaded(a:bufnr) || empty(l:target_file)
    return v:false
  endif

  call mkdir(fnamemodify(l:target_file, ':h'), 'p')
  call writefile(getbufline(a:bufnr, 1, '$'), l:target_file, 'b')
  call setbufvar(a:bufnr, '&modified', 0)
  return v:true
endfunction

function! s:auto_save_buffer_if_modified(bufnr, file) abort
  if a:bufnr <= 0 || !bufexists(a:bufnr) || !bufloaded(a:bufnr)
    return v:false
  endif
  if !getbufvar(a:bufnr, '&modified', 0)
    return v:true
  endif
  if !getbufvar(a:bufnr, '&modifiable', 0) || getbufvar(a:bufnr, '&readonly', 0)
    return v:false
  endif
  if getbufvar(a:bufnr, '&buftype', '') !=# ''
    return v:false
  endif

  let l:target_file = trim('' . a:file)
  if empty(l:target_file)
    let l:target_file = bufname(a:bufnr)
  endif
  let l:target_file = fnamemodify(l:target_file, ':p')
  if empty(l:target_file)
    return v:false
  endif

  try
    return s:persist_buffer_contents(a:bufnr, l:target_file)
  catch
    echomsg '[RealtimeDevAgent] Auto-save falhou para ' . l:target_file
    return v:false
  endtry
endfunction

function! s:collect_affected_files(file, items) abort
  let l:affected = {}
  let l:current_file = fnamemodify(a:file, ':p')
  if !empty(l:current_file)
    let l:affected[l:current_file] = 1
  endif

  for l:item in a:items
    let l:action = s:issue_effective_action(l:item)
    if get(l:action, 'op', '') !=# 'write_file'
      continue
    endif
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      continue
    endif
    if s:target_scope() !=# 'workspace' && !s:is_scope_safe_write_file_issue(l:item, a:file)
      continue
    endif
    let l:affected[fnamemodify(l:target_file, ':p')] = 1
  endfor

  return keys(l:affected)
endfunction

function! s:file_lines_for_guard(file) abort
  let l:target_file = fnamemodify(a:file, ':p')
  if empty(l:target_file)
    return []
  endif

  let l:target_buf = bufnr(l:target_file)
  if l:target_buf > 0 && bufloaded(l:target_buf)
    return getbufline(l:target_buf, 1, '$')
  endif

  if filereadable(l:target_file)
    return readfile(l:target_file, 'b')
  endif

  return []
endfunction

function! s:capture_file_snapshot(file_paths) abort
  let l:snapshot = {}
  for l:file in a:file_paths
    let l:target_file = fnamemodify(l:file, ':p')
    if empty(l:target_file) || has_key(l:snapshot, l:target_file)
      continue
    endif

    let l:target_buf = bufnr(l:target_file)
    let l:buf_loaded = l:target_buf > 0 && bufloaded(l:target_buf)
    let l:exists = filereadable(l:target_file)
    let l:lines = l:buf_loaded
          \ ? getbufline(l:target_buf, 1, '$')
          \ : (l:exists ? readfile(l:target_file, 'b') : [])
    let l:snapshot[l:target_file] = {
          \ 'bufnr': l:target_buf,
          \ 'exists': l:exists,
          \ 'lines': copy(l:lines),
          \ }
  endfor

  return l:snapshot
endfunction

function! s:restore_buffer_lines(bufnr, lines) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return
  endif
  if !getbufvar(a:bufnr, '&modifiable', 0)
    return
  endif

  let l:existing = len(getbufline(a:bufnr, 1, '$'))
  if l:existing > 0
    noautocmd call deletebufline(a:bufnr, 1, '$')
  endif

  let l:lines = empty(a:lines) ? [''] : copy(a:lines)
  noautocmd call setbufline(a:bufnr, 1, l:lines[0])
  if len(l:lines) > 1
    noautocmd call appendbufline(a:bufnr, 1, l:lines[1:])
  endif
  call setbufvar(a:bufnr, '&modified', 1)
endfunction

function! s:restore_file_snapshot(snapshot) abort
  for [l:file, l:state] in items(a:snapshot)
    let l:bufnr = get(l:state, 'bufnr', -1)
    if l:bufnr > 0
      call s:restore_buffer_lines(l:bufnr, get(l:state, 'lines', []))
    endif

    if get(l:state, 'exists', v:false)
      call mkdir(fnamemodify(l:file, ':h'), 'p')
      call writefile(copy(get(l:state, 'lines', [])), l:file, 'b')
    else
      silent! call delete(l:file)
    endif
  endfor
endfunction

function! s:build_guard_file_entries(file_paths) abort
  let l:entries = []
  for l:file in a:file_paths
    call add(l:entries, {
          \ 'path': fnamemodify(l:file, ':p'),
          \ 'contents': join(s:file_lines_for_guard(l:file), "\n"),
          \ })
  endfor
  return l:entries
endfunction

function! s:run_autofix_guard(payload, file) abort
  let l:runner = s:realtime_dev_agent_script_runner()
  let l:guard_runtime = s:realtime_dev_agent_guard_runtime_path()
  let l:script = s:realtime_dev_agent_script_path()
  if empty(l:runner) || (empty(l:guard_runtime) && (empty(l:script) || !filereadable(l:script)))
    return {'ok': v:false, 'error': 'guard cli nao encontrada'}
  endif

  let l:root = s:project_root(a:file)
  let l:argv = !empty(l:guard_runtime)
        \ ? [l:runner, l:guard_runtime]
        \ : [l:runner, l:script, '--autofix-guard']
  let l:output = s:run_systemlist(l:argv, l:root, json_encode(a:payload))
  if v:shell_error != 0
    return {
          \ 'ok': v:false,
          \ 'error': join(l:output, "\n"),
          \ }
  endif

  try
    return json_decode(join(l:output, "\n"))
  catch
    return {
          \ 'ok': v:false,
          \ 'error': join(l:output, "\n"),
          \ }
  endtry
endfunction

function! s:format_guard_failure(result) abort
  let l:parts = []
  for l:failure in get(a:result, 'validationFailures', [])
    call add(
          \ l:parts,
          \ printf(
          \   '%s(%d->%d)',
          \   get(l:failure, 'kind', 'issue'),
          \   get(l:failure, 'beforeCount', 0),
          \   get(l:failure, 'afterCount', 0)
          \ ))
  endfor

  for l:failure in get(a:result, 'runtimeFailures', [])
    call add(
          \ l:parts,
          \ printf(
          \   '%s em %s',
          \   get(l:failure, 'command', 'validacao'),
          \   fnamemodify(get(l:failure, 'filePath', ''), ':t')
          \ ))
  endfor

  let l:error = trim(get(a:result, 'error', ''))
  if !empty(l:error)
    call add(l:parts, l:error)
  endif

  return join(l:parts, ' | ')
endfunction

function! s:issue_trigger_line_text(issue) abort
  let l:filename = get(a:issue, 'filename', '')
  let l:lnum = get(a:issue, 'lnum', 1)
  if l:lnum < 1
    return ''
  endif

  let l:target_buf = s:issue_target_buffer(l:filename)
  if l:target_buf <= 0
    return ''
  endif

  return get(getbufline(l:target_buf, l:lnum), 0, '')
endfunction

function! s:delete_issue_line(file, lnum, trigger_line) abort
  if a:lnum < 1
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    return v:false
  endif

  if l:last == 1
    noautocmd call setbufline(l:target_buf, 1, '')
    call setbufvar(l:target_buf, '&modified', 1)
    return v:true
  endif

  if a:lnum <= l:last
    let l:line_at_lnum = get(getbufline(l:target_buf, a:lnum), 0, '')
    if empty(a:trigger_line) || l:line_at_lnum ==# a:trigger_line
      noautocmd call deletebufline(l:target_buf, a:lnum)
      call setbufvar(l:target_buf, '&modified', 1)
      return v:true
    endif
  endif

  if empty(a:trigger_line)
    return v:false
  endif

  let l:buffer_lines = getbufline(l:target_buf, 1, '$')
  let l:index = index(l:buffer_lines, a:trigger_line)
  if l:index < 0
    return v:false
  endif

  noautocmd call deletebufline(l:target_buf, l:index + 1)
  call setbufvar(l:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:remove_issue_trigger_line(issue, keep_focus_code) abort
  if a:keep_focus_code
    call s:focus_code_window()
  endif
  return s:delete_issue_line(
        \ get(a:issue, 'filename', ''),
        \ get(a:issue, 'lnum', 1),
        \ get(a:issue, '_trigger_line', '')
        \ )
endfunction

function! s:remove_issue_trigger_residue(issue, keep_focus_code) abort
  let l:removed = 0
  while s:remove_issue_trigger_line(a:issue, a:keep_focus_code)
    let l:removed += 1
  endwhile
  return l:removed > 0
endfunction

function! s:clear_issue_line(file, lnum) abort
  if a:lnum < 1
    return v:false
  endif

  let l:target_buf = s:issue_target_buffer(a:file)
  if l:target_buf <= 0
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    return v:false
  endif

  let l:line_no = min([a:lnum, l:last])
  noautocmd call setbufline(l:target_buf, l:line_no, '')
  call setbufvar(l:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:issue_terminal_height() abort
  let l:height = get(g:, 'realtime_dev_agent_terminal_height', 12)
  if type(l:height) != v:t_number
    let l:height = str2nr(string(l:height))
  endif
  if l:height < 6
    let l:height = 6
  endif
  return l:height
endfunction

function! s:issue_terminal_strategy() abort
  let l:strategy = trim(get(g:, 'realtime_dev_agent_terminal_strategy', 'auto'))
  if empty(l:strategy)
    let l:strategy = 'auto'
  endif
  let l:strategy = tolower(l:strategy)

  if l:strategy !=# 'auto'
    return l:strategy
  endif

  if exists(':TermExec') == 2
    return 'toggleterm'
  endif

  return 'native'
endfunction

function! s:issue_terminal_risk_mode() abort
  let l:mode = trim(get(g:, 'realtime_dev_agent_terminal_risk_mode', 'safe'))
  if empty(l:mode)
    return 'safe'
  endif
  let l:mode = tolower(l:mode)
  if l:mode ==# 'destructive'
    return 'all'
  endif
  if index(['safe', 'workspace_write', 'all'], l:mode) == -1
    return 'safe'
  endif
  return l:mode
endfunction

function! s:issue_terminal_risk_rank(level) abort
  let l:normalized = tolower(trim(a:level))
  if l:normalized ==# 'safe'
    return 0
  endif
  if l:normalized ==# 'workspace_write'
    return 1
  endif
  return 2
endfunction

function! s:issue_terminal_risk(action) abort
  let l:risk = get(a:action, 'risk', {})
  if type(l:risk) != v:t_dict
    return {
          \ 'level': 'workspace_write',
          \ 'summary': 'acao de terminal local sem classificacao explicita'
          \ }
  endif

  let l:level = tolower(trim(get(l:risk, 'level', 'workspace_write')))
  if index(['safe', 'workspace_write', 'destructive'], l:level) == -1
    let l:level = 'workspace_write'
  endif

  return {
        \ 'level': l:level,
        \ 'summary': trim(get(l:risk, 'summary', 'acao de terminal inferida pelo agente'))
        \ }
endfunction

function! s:issue_terminal_refocus_code(winid) abort
  if a:winid > 0 && win_gotoid(a:winid)
    call s:remember_code_window(a:winid)
    return v:true
  endif

  return s:focus_code_window()
endfunction

function! s:issue_terminal_status_file() abort
  return tempname()
endfunction

function! s:issue_terminal_inner_command(command, cwd, status_file) abort
  let l:parts = []
  if !empty(a:cwd)
    call add(l:parts, 'cd ' . shellescape(a:cwd) . ' &&')
  endif
  call add(l:parts, a:command . ';')
  if !empty(a:status_file)
    call add(l:parts, 'rda_status=$?;')
    call add(l:parts, 'printf "%s" "$rda_status" > ' . shellescape(a:status_file) . ';')
    call add(l:parts, 'exit $rda_status')
  endif
  return join(l:parts, ' ')
endfunction

function! s:issue_terminal_shell_command(command, cwd, status_file) abort
  let l:inner = s:issue_terminal_inner_command(a:command, a:cwd, a:status_file)
  if executable('sh')
    return shellescape(exepath('sh')) . ' -lc ' . shellescape(l:inner)
  endif

  let l:shell = !empty(&shell) ? &shell : 'sh'
  let l:flag = !empty(&shellcmdflag) ? &shellcmdflag : '-c'
  return shellescape(l:shell) . ' ' . l:flag . ' ' . shellescape(l:inner)
endfunction

function! s:issue_terminal_hidden_command(command, cwd) abort
  let l:inner = s:issue_terminal_inner_command(a:command, a:cwd, '')
  if executable('sh')
    return shellescape(exepath('sh')) . ' -lc ' . shellescape(l:inner)
  endif

  let l:shell = !empty(&shell) ? &shell : 'sh'
  let l:flag = !empty(&shellcmdflag) ? &shellcmdflag : '-c'
  return shellescape(l:shell) . ' ' . l:flag . ' ' . shellescape(l:inner)
endfunction

function! s:issue_terminal_hidden_argv(command, cwd) abort
  let l:inner = s:issue_terminal_inner_command(a:command, a:cwd, '')
  return [s:sh_binary(), '-lc', l:inner]
endfunction

function! s:issue_terminal_context(issue, keep_focus_code) abort
  let l:context = copy(a:issue)
  let l:context.keep_focus_code = a:keep_focus_code ? v:true : v:false
  let l:context._trigger_line = s:issue_trigger_line_text(a:issue)
  return l:context
endfunction

function! s:issue_terminal_remove_trigger_now(context) abort
  if !get(get(a:context, 'action', {}), 'remove_trigger', v:false)
    return
  endif
  if !s:remove_issue_trigger_line(a:context, get(a:context, 'keep_focus_code', v:false))
    return
  endif

  let l:target_file = get(a:context, 'filename', '')
  let l:target_buf = s:issue_target_buffer(l:target_file)
  if l:target_buf > 0
    call s:persist_buffer_contents(l:target_buf, l:target_file)
  endif
endfunction

function! s:issue_terminal_reanalyze(context) abort
  let l:target_buf = s:issue_target_buffer(get(a:context, 'filename', ''))
  if l:target_buf <= 0
    return
  endif

  let l:analysis_mode = s:analysis_mode_for_request(v:false)
  call s:start_async_realtime_check_with_fallback(l:target_buf, g:realtime_dev_agent_realtime_open_qf, 0, l:analysis_mode, v:false)
endfunction

function! s:issue_terminal_finish(context, exit_code) abort
  if a:exit_code != 0
    echohl ErrorMsg
    echomsg printf('[RealtimeDevAgent] Acao de terminal falhou com codigo %d', a:exit_code)
    echohl None
    return
  endif

  if get(get(a:context, 'action', {}), 'remove_trigger', v:false)
    call s:remove_issue_trigger_line(a:context, get(a:context, 'keep_focus_code', v:false))
  endif
  call s:issue_terminal_reanalyze(a:context)
endfunction

function! s:nvim_terminal_action_exit(context, job_id, exit_code, event) abort
  call s:issue_terminal_finish(a:context, a:exit_code)
endfunction

function! s:vim_terminal_action_exit(context, job, status) abort
  call s:issue_terminal_finish(a:context, a:status)
endfunction

function! s:issue_terminal_status_poll(context, timer_id) abort
  let l:status_file = get(a:context, '_status_file', '')
  if empty(l:status_file) || !filereadable(l:status_file)
    return
  endif

  call timer_stop(a:timer_id)
  let l:lines = readfile(l:status_file)
  silent! call delete(l:status_file)
  let l:exit_code = str2nr(trim(join(l:lines, '')))
  call s:issue_terminal_finish(a:context, l:exit_code)
endfunction

function! s:issue_terminal_schedule_poll(context, status_file) abort
  let l:context = copy(a:context)
  let l:context._status_file = a:status_file
  call timer_start(250, function('s:issue_terminal_status_poll', [l:context]), {'repeat': 240})
endfunction

function! s:apply_issue_run_command_toggleterm(command, cwd, context, background) abort
  let l:status_file = s:issue_terminal_status_file()
  let l:wrapped_command = s:issue_terminal_shell_command(a:command, a:cwd, l:status_file)
  let l:payload = {
        \ 'cmd': l:wrapped_command,
        \ 'cwd': a:cwd,
        \ 'height': s:issue_terminal_height(),
        \ 'return_winid': win_getid(),
        \ 'background': a:background ? v:true : v:false
        \ }
  let l:ok = luaeval(
        \ '(function(payload)'
        \ . ' local ok, terminal_module = pcall(require, "toggleterm.terminal")'
        \ . ' if not ok or not terminal_module or not terminal_module.Terminal then return false end'
        \ . ' local term = terminal_module.Terminal:new({'
        \ . '   cmd = payload.cmd,'
        \ . '   dir = payload.cwd ~= "" and payload.cwd or nil,'
        \ . '   hidden = false,'
        \ . '   close_on_exit = false,'
        \ . '   direction = "horizontal",'
        \ . '   size = payload.height,'
        \ . '   on_open = function(_) '
        \ . '     if payload.background and payload.return_winid > 0 then'
        \ . '       vim.defer_fn(function() pcall(vim.fn.win_gotoid, payload.return_winid) end, 80)'
        \ . '     else'
        \ . '       vim.defer_fn(function() pcall(vim.cmd, "startinsert") end, 20)'
        \ . '     end'
        \ . '   end'
        \ . ' })'
        \ . ' term:toggle()'
        \ . ' return true'
        \ . ' end)(_A)',
        \ l:payload
        \ )
  if !l:ok
    echohl ErrorMsg
    echomsg '[RealtimeDevAgent] Falha ao controlar o ToggleTerm'
    echohl None
    return v:false
  endif
  if a:background
    call s:issue_terminal_refocus_code(get(l:payload, 'return_winid', 0))
    echomsg '[RealtimeDevAgent] Executando em background no ToggleTerm: ' . a:command
  else
    echomsg '[RealtimeDevAgent] Executando no ToggleTerm: ' . a:command
  endif
  call s:issue_terminal_remove_trigger_now(a:context)
  call s:issue_terminal_schedule_poll(a:context, l:status_file)
  return v:true
endfunction

function! s:apply_issue_run_command_native(command, cwd, context, background) abort
  let l:height = s:issue_terminal_height()
  let l:return_winid = win_getid()

  call s:remember_code_window(l:return_winid)

  if has('nvim')
    execute 'botright ' . l:height . 'split'
    enew
    call termopen(a:command, {
          \ 'cwd': a:cwd,
          \ 'on_exit': function('s:nvim_terminal_action_exit', [a:context])
          \ })
    if a:background
      call s:issue_terminal_refocus_code(l:return_winid)
      echomsg '[RealtimeDevAgent] Executando em background no terminal: ' . a:command
    else
      startinsert
      echomsg '[RealtimeDevAgent] Executando no terminal: ' . a:command
    endif
    call s:issue_terminal_remove_trigger_now(a:context)
    return v:true
  endif

  if exists('*term_start')
    execute 'botright ' . l:height . 'split'
    call term_start(a:command, {
          \ 'cwd': a:cwd,
          \ 'curwin': 1,
          \ 'exit_cb': function('s:vim_terminal_action_exit', [a:context])
          \ })
    if a:background
      call s:issue_terminal_refocus_code(l:return_winid)
      echomsg '[RealtimeDevAgent] Executando em background no terminal: ' . a:command
    else
      echomsg '[RealtimeDevAgent] Executando no terminal: ' . a:command
    endif
    call s:issue_terminal_remove_trigger_now(a:context)
    return v:true
  endif

  return v:false
endfunction

function! s:issue_terminal_hidden_job_append(job_id, data) abort
  if type(a:data) != v:t_list || !has_key(s:realtime_dev_agent_hidden_terminal_jobs, a:job_id)
    return
  endif

  let l:entry = get(s:realtime_dev_agent_hidden_terminal_jobs, a:job_id, {})
  let l:output = get(l:entry, 'output', [])
  if type(l:output) != v:t_list
    let l:output = []
  endif

  for l:line in a:data
    if type(l:line) != v:t_string || empty(l:line)
      continue
    endif
    call add(l:output, l:line)
  endfor

  let l:entry.output = l:output
  let s:realtime_dev_agent_hidden_terminal_jobs[a:job_id] = l:entry
endfunction

function! s:issue_terminal_hidden_job_on_stdout(job_id, data, event) abort
  call s:issue_terminal_hidden_job_append(a:job_id, a:data)
endfunction

function! s:issue_terminal_hidden_job_on_stderr(job_id, data, event) abort
  call s:issue_terminal_hidden_job_append(a:job_id, a:data)
endfunction

function! s:issue_terminal_hidden_job_finalize(job_id, exit_code) abort
  if !has_key(s:realtime_dev_agent_hidden_terminal_jobs, a:job_id)
    return
  endif

  let l:entry = remove(s:realtime_dev_agent_hidden_terminal_jobs, a:job_id)
  let l:context = get(l:entry, 'context', {})
  let l:output = filter(copy(get(l:entry, 'output', [])), {_, val -> type(val) == v:t_string && !empty(trim(val))})
  if a:exit_code != 0
    echohl ErrorMsg
    echomsg '[RealtimeDevAgent] Falha ao executar acao de terminal'
    if !empty(l:output)
      echomsg '[RealtimeDevAgent] ' . trim(get(l:output, -1, ''))
    endif
    echohl None
    return
  endif

  if get(get(l:context, 'action', {}), 'remove_trigger', v:false)
    call s:remove_issue_trigger_line(l:context, get(l:context, 'keep_focus_code', v:false))
  endif

  if !empty(l:output)
    let l:last_output = trim(get(l:output, -1, ''))
    if !empty(l:last_output)
      echomsg '[RealtimeDevAgent] ' . l:last_output
    endif
  endif

  call s:issue_terminal_reanalyze(l:context)
endfunction

function! s:issue_terminal_hidden_job_on_exit(job_id, code, event) abort
  call s:issue_terminal_hidden_job_finalize(a:job_id, a:code)
endfunction

function! s:issue_terminal_start_hidden_async(context, command, cwd) abort
  if !has('nvim') || !exists('*jobstart')
    return v:false
  endif

  let l:job = jobstart(s:issue_terminal_hidden_argv(a:command, a:cwd), {
        \ 'on_stdout': function('s:issue_terminal_hidden_job_on_stdout'),
        \ 'on_stderr': function('s:issue_terminal_hidden_job_on_stderr'),
        \ 'on_exit': function('s:issue_terminal_hidden_job_on_exit')
        \ })
  if l:job <= 0
    return v:false
  endif

  let s:realtime_dev_agent_hidden_terminal_jobs[l:job] = {
        \ 'context': deepcopy(a:context),
        \ 'output': []
        \ }
  echomsg '[RealtimeDevAgent] Executando comando hidden em background: ' . a:command
  return v:true
endfunction

function! s:apply_issue_run_command_hidden(issue, keep_focus_code) abort
  let l:action = s:issue_effective_action(a:issue)
  let l:command = get(l:action, 'command', '')
  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  if s:issue_terminal_start_hidden_async(a:issue, l:command, l:cwd)
    return v:true
  endif

  let l:output = s:run_shell_systemlist(l:command, l:cwd)
  if v:shell_error != 0
    echohl ErrorMsg
    echomsg '[RealtimeDevAgent] Falha ao executar acao de terminal'
    if !empty(l:output)
      echomsg '[RealtimeDevAgent] ' . trim(get(l:output, -1, ''))
    endif
    echohl None
    return v:false
  endif

  if get(l:action, 'remove_trigger', v:false)
    call s:remove_issue_trigger_line(a:issue, a:keep_focus_code)
  endif

  if !empty(l:output)
    let l:last_output = trim(get(l:output, -1, ''))
    if !empty(l:last_output)
      echomsg '[RealtimeDevAgent] ' . l:last_output
    endif
  endif

  call s:issue_terminal_reanalyze(a:issue)
  return v:true
endfunction

function! s:apply_issue_run_command(issue, keep_focus_code) abort
  if !get(g:, 'realtime_dev_agent_terminal_actions_enabled', 1)
    echomsg '[RealtimeDevAgent] Acoes de terminal estao desligadas'
    return v:false
  endif

  let l:action = s:issue_effective_action(a:issue)
  let l:command = get(l:action, 'command', '')
  if empty(l:command)
    echomsg '[RealtimeDevAgent] Comando de terminal ausente para esta sugestao'
    return v:false
  endif

  let l:risk_mode = s:issue_terminal_risk_mode()
  let l:risk = s:issue_terminal_risk(l:action)
  if s:issue_terminal_risk_rank(l:risk.level) > s:issue_terminal_risk_rank(l:risk_mode)
    echohl WarningMsg
    echomsg printf(
          \ '[RealtimeDevAgent] Comando bloqueado pelo modo de risco "%s": %s (%s - %s)',
          \ l:risk_mode,
          \ l:command,
          \ l:risk.level,
          \ l:risk.summary
          \ )
    echohl None
    return v:false
  endif

  let l:cwd = fnamemodify(get(l:action, 'cwd', ''), ':p')
  if empty(l:cwd)
    let l:cwd = s:project_root(get(a:issue, 'filename', ''))
  endif

  let l:context = s:issue_terminal_context(a:issue, a:keep_focus_code)
  let l:strategy = s:issue_terminal_strategy()
  if l:strategy ==# 'hidden'
    return s:apply_issue_run_command_hidden(l:context, a:keep_focus_code)
  endif
  let l:is_background = l:strategy ==# 'background' || s:realtime_dev_agent_auto_fix_busy || a:keep_focus_code

  if l:is_background
    if exists(':TermExec') == 2
      return s:apply_issue_run_command_toggleterm(l:command, l:cwd, l:context, v:true)
    endif

    if s:apply_issue_run_command_native(l:command, l:cwd, l:context, v:true)
      return v:true
    endif
  endif

  if l:strategy ==# 'toggleterm'
    return s:apply_issue_run_command_toggleterm(l:command, l:cwd, l:context, v:false)
  endif

  if l:strategy ==# 'native'
    if s:apply_issue_run_command_native(l:command, l:cwd, l:context, v:false)
      return v:true
    endif
  endif

  return s:apply_issue_run_command_hidden(l:context, a:keep_focus_code)
endfunction

function! s:issue_action_range(action) abort
  let l:range = get(a:action, 'range', {})
  if type(l:range) != v:t_dict
    return {}
  endif
  if type(get(l:range, 'start', {})) != v:t_dict || type(get(l:range, 'end', {})) != v:t_dict
    return {}
  endif
  return l:range
endfunction

function! s:apply_issue_range_replacement(target_buf, action, lnum, current_line, fallback_text) abort
  let l:range = s:issue_action_range(a:action)
  if empty(l:range)
    return v:false
  endif

  let l:start_line = get(get(l:range, 'start', {}), 'line', -1)
  let l:end_line = get(get(l:range, 'end', {}), 'line', -1)
  if l:start_line !=# l:end_line || l:start_line !=# (a:lnum - 1)
    return v:false
  endif

  let l:start_col = max([0, get(get(l:range, 'start', {}), 'character', 0)])
  let l:end_col = max([l:start_col, get(get(l:range, 'end', {}), 'character', l:start_col)])
  let l:replacement = has_key(a:action, 'text') ? get(a:action, 'text', '') : a:fallback_text
  let l:new_line = strpart(a:current_line, 0, l:start_col)
        \ . l:replacement
        \ . strpart(a:current_line, l:end_col)
  if l:new_line ==# a:current_line
    return v:false
  endif

  noautocmd call setbufline(a:target_buf, a:lnum, l:new_line)
  call setbufvar(a:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:apply_issue_replace_range(target_buf, action, fallback_lines) abort
  let l:range = s:issue_action_range(a:action)
  if empty(l:range)
    return v:false
  endif

  let l:start_zero = get(get(l:range, 'start', {}), 'line', -1)
  let l:end_zero = get(get(l:range, 'end', {}), 'line', -1)
  if l:start_zero < 0 || l:end_zero < 0
    return v:false
  endif

  let l:start_lnum = l:start_zero + 1
  let l:end_lnum = max([l:start_lnum, l:end_zero])
  let l:new_lines = empty(a:fallback_lines) ? [''] : copy(a:fallback_lines)
  let l:current_lines = getbufline(a:target_buf, l:start_lnum, l:end_lnum)
  if join(l:current_lines, "\n") ==# join(l:new_lines, "\n")
    return v:false
  endif

  noautocmd call setbufline(a:target_buf, l:start_lnum, l:new_lines[0])
  if l:end_lnum > l:start_lnum
    noautocmd call deletebufline(a:target_buf, l:start_lnum + 1, l:end_lnum)
  endif
  if len(l:new_lines) > 1
    noautocmd call appendbufline(a:target_buf, l:start_lnum, l:new_lines[1:])
  endif
  call setbufvar(a:target_buf, '&modified', 1)
  return v:true
endfunction

function! s:preserve_issue_snippet_indentation(issue, action) abort
  if get(a:action, 'op', '') !=# 'replace_line'
    return v:false
  endif
  return get(a:issue, 'kind', '') ==# 'tabs'
endfunction

function! s:apply_issue_snippet(issue, keep_focus_code) abort
  let l:issue = a:issue
  let l:filename = get(l:issue, 'filename', '')
  let l:lnum = get(l:issue, 'lnum', 1)
  let l:kind = get(l:issue, 'kind', '')
  let l:action = s:issue_effective_action(l:issue)
  let l:snippet_raw = get(l:issue, 'snippet', '')
  let l:op = get(l:action, 'op', '')
  let l:restore_view = {}
  let l:active_buf = bufnr('%')
  let l:active_file = fnamemodify(bufname(l:active_buf), ':p')
  let l:target_file = fnamemodify(l:filename, ':p')
  if !s:issue_targets_active_scope(l:issue, l:filename)
    echomsg '[RealtimeDevAgent] Acao descartada: fora do arquivo atual'
    return v:false
  endif
  if l:op ==# 'run_command'
    return s:apply_issue_run_command(l:issue, a:keep_focus_code)
  endif
  if l:op ==# 'lsp_code_action'
    return s:apply_issue_lsp_code_action(l:issue)
  endif
  if l:op ==# 'lsp_ai_fix'
    return s:apply_issue_lsp_ai_fix(l:issue)
  endif
  if empty(l:snippet_raw)
    if l:kind ==# 'trailing_whitespace' || l:kind ==# 'syntax_extra_delimiter' || l:op ==# 'delete_line'
      let l:snippet_lines = ['']
    else
      echohl WarningMsg
      echomsg '[RealtimeDevAgent] Sem snippet para esta sugestao'
      echohl None
      return v:false
    endif
  else
    let l:snippet_lines = s:split_snippet_lines(l:snippet_raw)
  endif
  if empty(l:snippet_lines)
    return v:false
  endif

  if l:op ==# 'write_file'
    return s:apply_issue_write_file(l:issue, l:snippet_lines)
  endif

  if a:keep_focus_code
    if !s:focus_issue_target_file(l:filename)
      return v:false
    endif
    let l:target_buf = bufnr('%')
  endif

  if !a:keep_focus_code
    if empty(l:target_file)
      let l:target_buf = l:active_buf
    elseif l:target_file ==# l:active_file
      let l:target_buf = l:active_buf
    else
      let l:target_buf = s:issue_target_buffer(l:target_file)
    endif
  endif

  if l:target_buf <= 0 || !bufexists(l:target_buf)
    if !a:keep_focus_code
      echomsg '[RealtimeDevAgent] Snippet descartado: buffer alvo nao carregado'
    endif
    return v:false
  endif

  if !getbufvar(l:target_buf, '&modifiable', 0)
    return v:false
  endif

  if !a:keep_focus_code && l:target_buf ==# l:active_buf && !s:is_auto_fix_visual_batch_active()
    let l:restore_view = winsaveview()
  endif

  if l:lnum < 1
    let l:lnum = 1
  endif

  let l:last = len(getbufline(l:target_buf, 1, '$'))
  if l:last < 1
    let l:last = 1
  endif
  if l:lnum > l:last
    let l:lnum = l:last
  endif

  let l:line_content = getbufline(l:target_buf, l:lnum)
  if empty(l:line_content)
    let l:line_content = ['']
  endif
  let l:line_content = l:line_content[0]
  if !s:realtime_issue_still_relevant(l:issue, l:target_buf, l:lnum, l:line_content)
    return v:false
  endif

  if !s:preserve_issue_snippet_indentation(l:issue, l:action)
    let l:indent = get(l:action, 'indent', matchstr(l:line_content, '^\s*'))
    let l:snippet_lines = s:normalize_snippet_lines(l:snippet_lines, l:indent)
  endif
  if empty(l:op)
    let l:op = get(s:issue_default_action(l:kind), 'op', 'insert_before')
  endif
  let l:snippet_lines = s:trim_insert_snippet_anchor_duplicates(l:snippet_lines, l:line_content, l:op)
  if empty(l:snippet_lines)
    return v:false
  endif
  let l:snippet_text = join(l:snippet_lines, "\n")

  if l:op ==# 'replace_range'
    if s:apply_issue_replace_range(l:target_buf, l:action, l:snippet_lines)
      if l:kind ==# 'comment_task' && !empty(get(l:issue, '_trigger_line', ''))
        call s:remove_issue_trigger_residue(l:issue, a:keep_focus_code)
      endif
      if !a:keep_focus_code && !empty(l:restore_view)
        call winrestview(l:restore_view)
      endif
      call s:auto_save_buffer_if_modified(l:target_buf, l:target_file)
      return v:true
    endif
    return v:false
  elseif l:op ==# 'replace_line'
    if s:apply_issue_range_replacement(l:target_buf, l:action, l:lnum, l:line_content, l:snippet_text)
      if l:kind ==# 'comment_task' && !empty(get(l:issue, '_trigger_line', ''))
        call s:remove_issue_trigger_residue(l:issue, a:keep_focus_code)
      endif
      if !a:keep_focus_code && !empty(l:restore_view)
        call winrestview(l:restore_view)
      endif
      call s:auto_save_buffer_if_modified(l:target_buf, l:target_file)
      return v:true
    endif
    let l:normalized_current = substitute(l:line_content, '^\s*', '', '')
    let l:normalized_first = substitute(l:snippet_lines[0], '^\s*', '', '')
    if len(l:snippet_lines) == 1 && (empty(l:snippet_lines[0]) || l:normalized_current ==# l:normalized_first)
      return v:false
    endif
    noautocmd call setbufline(l:target_buf, l:lnum, l:snippet_lines[0])
    if len(l:snippet_lines) > 1
      noautocmd call appendbufline(l:target_buf, l:lnum, l:snippet_lines[1:])
    endif
    if l:kind ==# 'comment_task' && !empty(get(l:issue, '_trigger_line', ''))
      call s:remove_issue_trigger_residue(l:issue, a:keep_focus_code)
    endif
  elseif l:op ==# 'delete_line'
    if line('$') <= 1
      noautocmd call setbufline(l:target_buf, l:lnum, '')
    else
      noautocmd call deletebufline(l:target_buf, l:lnum)
    endif
  elseif l:op ==# 'insert_after'
    noautocmd call appendbufline(l:target_buf, l:lnum, l:snippet_lines)
  else
    noautocmd call appendbufline(l:target_buf, l:lnum - 1, l:snippet_lines)
  endif

  if !a:keep_focus_code
    if !empty(l:restore_view)
      call winrestview(l:restore_view)
    endif
  endif
  call s:auto_save_buffer_if_modified(l:target_buf, l:target_file)
  return v:true
endfunction

function! s:normalize_snippet_lines(snippet_lines, indent) abort
  if type(a:snippet_lines) != v:t_list
    return [a:snippet_lines]
  endif

  if empty(a:snippet_lines)
    return ['']
  endif

  let l:min_indent = -1
  for l:snippet_line in a:snippet_lines
    if l:snippet_line =~# '^\s*$'
      continue
    endif
    let l:line_indent = len(matchstr(l:snippet_line, '^\s*'))
    if l:min_indent == -1 || l:line_indent < l:min_indent
      let l:min_indent = l:line_indent
    endif
  endfor

  if l:min_indent == -1
    return map(copy(a:snippet_lines), {_, val -> a:indent . val})
  endif

  return map(copy(a:snippet_lines), {_, val ->
        \ substitute(
        \   val,
        \   '^\s\{'.l:min_indent.'\}',
        \   a:indent,
        \   ''
        \ )})
endfunction

function! s:split_snippet_lines(snippet) abort
  if type(a:snippet) == v:t_list
    return copy(a:snippet)
  endif

  let l:snippet = '' . a:snippet
  if empty(l:snippet)
    return []
  endif

  return split(l:snippet, "\%x00\\|\n", 1)
endfunction

function! s:is_declaration_authority_issue(kind) abort
  return index([
        \ 'class_doc',
        \ 'flow_comment',
        \ 'function_comment',
        \ 'function_doc',
        \ 'function_spec',
        \ 'moduledoc',
        \ 'unit_test_signature',
        \ 'variable_doc',
        \ ], a:kind) != -1
endfunction

function! s:issue_metadata_symbol_name(item) abort
  let l:metadata = get(a:item, 'metadata', {})
  if type(l:metadata) != v:t_dict
    return ''
  endif

  let l:name = trim('' . get(l:metadata, 'symbolName', ''))
  if !empty(l:name)
    return l:name
  endif

  return trim('' . get(l:metadata, 'name', ''))
endfunction

function! s:extract_symbol_name_from_snippet_lines(snippet_lines) abort
  if type(a:snippet_lines) != v:t_list
    return ''
  endif

  for l:line in a:snippet_lines
    let l:source = trim('' . l:line)
    if empty(l:source)
      continue
    endif

    let l:match = matchlist(l:source, '^\s*`*\s*@spec\s\+\([A-Za-z_][A-Za-z0-9_?!:#]*\)\s*(')
    if !empty(l:match)
      return l:match[1]
    endif

    let l:match = matchlist(l:source, '\c\<\(funcao\|funcão\|function\|method\|m[eé]todo\)\>\s*[:-]\s*`*\([A-Za-z_][A-Za-z0-9_?!:#]*\)`*')
    if !empty(l:match)
      return l:match[2]
    endif

    let l:match = matchlist(l:source, '\c\<\(classe\|class\|modulo\|module\|variavel\|variable\|atributo\|attribute\|constante\|constant\)\>\s*`*\([A-Za-z_$@#][A-Za-z0-9_$@:#]*\)`*')
    if !empty(l:match)
      return substitute(l:match[2], '^[@#]\+', '', '')
    endif
  endfor

  return ''
endfunction

function! s:extract_declaration_symbol_name(line) abort
  let l:source = trim('' . a:line)
  if empty(l:source)
    return ''
  endif
  if l:source =~# '^\s*@'
    return ''
  endif

  let l:patterns = [
        \ '^\s*defp\=\s\+\([a-z_][A-Za-z0-9_?!]*\)\>',
        \ '^\s*\%(async\s\+\)\=def\s\+\([A-Za-z_][A-Za-z0-9_?!]*\)\>',
        \ '^\s*\%(export\s\+\)\=\%(default\s\+\)\=\%(async\s\+\)\=function\s\+\([A-Za-z_$][A-Za-z0-9_$]*\)\>',
        \ '^\s*\%(export\s\+\)\=\%(default\s\+\)\=\%(abstract\s\+\)\=class\s\+\([A-Za-z_$][A-Za-z0-9_$]*\)\>',
        \ '^\s*\%(export\s\+\)\=\%(const\|let\|var\|static\|readonly\)\s\+\([#A-Za-z_$][A-Za-z0-9_$]*\)\s*\%(:\|=\)',
        \ '^\s*\([A-Za-z_][A-Za-z0-9_]*\)\s*\%(:\|=\)',
        \ '^\s*\(@\{1,2}[A-Za-z_][A-Za-z0-9_]*\|[A-Z][A-Za-z0-9_]*\)\s*=',
        \ '^\s*\%(class\|module\)\s\+\([A-Za-z_][A-Za-z0-9_:]*\)\>',
        \ '^\s*\(local\s\+\)\=function\s\+\([A-Za-z_][A-Za-z0-9_]*\)\s*(',
        \ '^\s*function!\=\s\+\(\([gswbtlav]:\)\=[A-Za-z_#][A-Za-z0-9_:#]*\)\s*(',
        \ '^\s*func\s\+\([A-Za-z_][A-Za-z0-9_]*\)\s*(',
        \ '^\s*\%(pub\s\+\)\=\%(async\s\+\)\=fn\s\+\([A-Za-z_][A-Za-z0-9_]*\)\s*(',
        \ ]

  for l:pattern in l:patterns
    let l:match = matchlist(l:source, l:pattern)
    if !empty(l:match)
      let l:name = l:match[len(l:match) - 1]
      if !empty(l:name)
        return substitute(l:name, '^[@#]\+', '', '')
      endif
    endif
  endfor

  return ''
endfunction

function! s:nearest_declaration_symbol_name(target_buf, start_lnum) abort
  let l:last = len(getbufline(a:target_buf, 1, '$'))
  if l:last <= 0
    return ''
  endif

  let l:start = max([1, a:start_lnum])
  let l:end = min([l:last, l:start + 80])
  for l:lnum in range(l:start, l:end)
    let l:line = getbufline(a:target_buf, l:lnum)
    if empty(l:line)
      continue
    endif
    let l:name = s:extract_declaration_symbol_name(l:line[0])
    if !empty(l:name)
      return l:name
    endif
  endfor

  return ''
endfunction

function! s:split_declaration_params(params_source) abort
  let l:source = '' . a:params_source
  if empty(l:source)
    return []
  endif
  let l:params = []
  let l:current = ''
  let l:depth = 0
  for l:index in range(0, len(l:source) - 1)
    let l:char = l:source[l:index]
    if l:char ==# '(' || l:char ==# '[' || l:char ==# '{'
      let l:depth += 1
    elseif l:char ==# ')' || l:char ==# ']' || l:char ==# '}'
      let l:depth = max([0, l:depth - 1])
    elseif l:char ==# ',' && l:depth == 0
      let l:pending = trim(l:current)
      if !empty(l:pending)
        call add(l:params, l:pending)
      endif
      let l:current = ''
      continue
    endif
    let l:current .= l:char
  endfor

  let l:pending = trim(l:current)
  if !empty(l:pending)
    call add(l:params, l:pending)
  endif
  return l:params
endfunction

function! s:normalize_declaration_param_name(param_source) abort
  let l:param = trim('' . a:param_source)
  let l:param = substitute(l:param, '=.*$', '', '')
  let l:param = substitute(l:param, '\\\\.*$', '', '')
  let l:param = substitute(l:param, '^\.\.\.', '', '')
  let l:param = substitute(l:param, '^\*\+', '', '')
  let l:param = substitute(l:param, '\s*:\s*.*$', '', '')
  let l:param = substitute(l:param, '?$', '', '')
  let l:param = trim(l:param)
  let l:match = matchstr(l:param, '^[A-Za-z_$][A-Za-z0-9_$]*')
  return l:match
endfunction

function! s:declaration_param_contract(params_source) abort
  let l:raw_params = s:split_declaration_params(a:params_source)
  let l:names = []
  let l:required = 0
  let l:has_variadic = v:false

  for l:param in l:raw_params
    let l:name = s:normalize_declaration_param_name(l:param)
    if empty(l:name) || l:name ==# 'self' || l:name ==# 'cls'
      continue
    endif
    call add(l:names, l:name)
    let l:is_variadic = l:param =~# '\.\.\.' || l:param =~# '^\s*\*'
    let l:is_optional = l:is_variadic || l:param =~# '=' || l:param =~# '?' || l:param =~# '\\\\'
    if l:is_variadic
      let l:has_variadic = v:true
    endif
    if !l:is_optional
      let l:required += 1
    endif
  endfor

  return {
        \ 'params': l:names,
        \ 'min': l:required,
        \ 'max': l:has_variadic ? 9007199254740991 : len(l:names),
        \ }
endfunction

function! s:extract_param_source_after_symbol(line, symbol) abort
  let l:source = '' . a:line
  let l:symbol = '' . a:symbol
  if empty(l:symbol)
    return ''
  endif

  let l:start = match(l:source, '\V' . escape(l:symbol, '\'))
  if l:start < 0
    return ''
  endif

  let l:cursor = l:start + len(l:symbol)
  while l:cursor < len(l:source)
    let l:char = l:source[l:cursor]
    if l:char ==# '('
      break
    endif
    if l:char !~# '\s'
      return ''
    endif
    let l:cursor += 1
  endwhile
  if l:cursor >= len(l:source) || l:source[l:cursor] !=# '('
    return ''
  endif

  let l:depth = 1
  let l:current = ''
  let l:index = l:cursor + 1
  while l:index < len(l:source)
    let l:char = l:source[l:index]
    if l:char ==# '('
      let l:depth += 1
    elseif l:char ==# ')'
      let l:depth -= 1
      if l:depth == 0
        return l:current
      endif
    endif
    let l:current .= l:char
    let l:index += 1
  endwhile

  return ''
endfunction

function! s:unit_test_signature_current_contract_key(item) abort
  let l:metadata = get(a:item, 'metadata', {})
  if type(l:metadata) != v:t_dict
    return ''
  endif

  let l:expected = trim('' . get(l:metadata, 'declarationSignatureKey', ''))
  if empty(l:expected)
    return ''
  endif

  let l:source_file = fnamemodify(get(a:item, 'filename', ''), ':p')
  if empty(l:source_file)
    return ''
  endif

  let l:line_no = str2nr(string(get(l:metadata, 'declarationLine', 0)))
  if l:line_no <= 0
    return ''
  endif

  let l:source_lines = []
  let l:bufnr = bufnr(l:source_file)
  if l:bufnr > 0 && bufloaded(l:bufnr)
    let l:source_lines = getbufline(l:bufnr, l:line_no, l:line_no + 8)
  elseif filereadable(l:source_file)
    let l:all_lines = readfile(l:source_file, 'b')
    let l:source_lines = l:all_lines[l:line_no - 1 : min([len(l:all_lines) - 1, l:line_no + 7])]
  endif
  if empty(l:source_lines)
    return ''
  endif

  let l:name = trim('' . get(l:metadata, 'declarationName', get(l:metadata, 'symbolName', '')))
  let l:kind = trim('' . get(l:metadata, 'declarationKind', get(l:metadata, 'symbolKind', 'function')))
  let l:container = trim('' . get(l:metadata, 'declarationContainerName', ''))
  let l:qualified = empty(l:container) ? l:name : l:container . '.' . l:name
  if empty(l:name) || empty(l:kind)
    return ''
  endif

  for l:line in l:source_lines
    let l:param_source = s:extract_param_source_after_symbol(l:line, l:name)
    if empty(l:param_source) && l:line !~# '\V' . escape(l:name, '\')
      continue
    endif
    if empty(l:param_source)
      continue
    endif

    let l:contract = s:declaration_param_contract(l:param_source)
    return join([
          \ l:kind,
          \ l:qualified,
          \ string(get(l:contract, 'min', 0)) . '-' . string(get(l:contract, 'max', 0)),
          \ join(get(l:contract, 'params', []), ','),
          \ ], '|')
  endfor

  return ''
endfunction

function! s:unit_test_signature_matches_source_contract(item) abort
  let l:metadata = get(a:item, 'metadata', {})
  if type(l:metadata) != v:t_dict
    return v:true
  endif

  let l:expected = trim('' . get(l:metadata, 'declarationSignatureKey', ''))
  if empty(l:expected)
    return v:true
  endif

  let l:current = s:unit_test_signature_current_contract_key(a:item)
  return !empty(l:current) && l:current ==# l:expected
endfunction

function! s:declaration_authority_matches_current(item, target_buf, line_no, snippet_lines) abort
  let l:kind = get(a:item, 'kind', '')
  if !s:is_declaration_authority_issue(l:kind)
    return v:true
  endif
  if l:kind ==# 'unit_test_signature'
    return s:unit_test_signature_matches_source_contract(a:item)
  endif

  let l:snippet_symbol = s:issue_metadata_symbol_name(a:item)
  if empty(l:snippet_symbol)
    let l:snippet_symbol = s:extract_symbol_name_from_snippet_lines(a:snippet_lines)
  endif

  let l:decl_symbol = s:nearest_declaration_symbol_name(a:target_buf, a:line_no)
  return empty(l:snippet_symbol) || empty(l:decl_symbol) || l:snippet_symbol ==# l:decl_symbol
endfunction

function! s:replace_range_matches_buffer(action, target_buf, snippet_lines) abort
  let l:range = s:issue_action_range(a:action)
  if empty(l:range)
    return v:false
  endif

  let l:start_zero = get(get(l:range, 'start', {}), 'line', -1)
  let l:end_zero = get(get(l:range, 'end', {}), 'line', -1)
  if l:start_zero < 0 || l:end_zero < 0 || l:end_zero < l:start_zero
    return v:false
  endif

  let l:start_lnum = l:start_zero + 1
  let l:end_lnum = max([l:start_lnum, l:end_zero])
  let l:current_lines = getbufline(a:target_buf, l:start_lnum, l:end_lnum)
  let l:expected_lines = type(a:snippet_lines) == v:t_list ? copy(a:snippet_lines) : []
  if empty(l:expected_lines)
    let l:expected_lines = ['']
  endif

  return join(l:current_lines, "\n") ==# join(l:expected_lines, "\n")
endfunction

function! s:realtime_issue_still_relevant(item, target_buf, lnum, line_content) abort
  let l:kind = get(a:item, 'kind', '')
  let l:text = get(a:item, 'text', '')
  let l:action = s:issue_effective_action(a:item)
  let l:target_buf = a:target_buf
  let l:line_no = a:lnum
  let l:content = a:line_content
  let l:op = get(l:action, 'op', '')

  if l:op ==# 'write_file'
    let l:target_file = trim(get(l:action, 'target_file', ''))
    if empty(l:target_file)
      return v:false
    endif
    let l:target_file = fnamemodify(l:target_file, ':p')

    let l:snippet = get(a:item, 'snippet', '')
    if empty(l:snippet)
      return v:false
    endif

    if !filereadable(l:target_file)
      return v:true
    endif

    let l:expected_lines = s:split_snippet_lines(l:snippet)
    let l:current_lines = readfile(l:target_file, 'b')
    if join(l:current_lines, "\n") !=# join(l:expected_lines, "\n")
      return v:true
    endif

    if get(a:item, 'kind', '') ==# 'comment_task' && get(l:action, 'remove_trigger', v:false)
      " Permite aplicar write_file idempotente para remover a linha gatilho mesmo sem diff no arquivo.
      return v:true
    endif
    return v:false
  endif

  if l:op ==# 'run_command'
    return l:content =~# '^\s*\(#\|//\|--\|"\)\s*\%(\\s\)\?\s*\*\s*.\+$' || l:content =~# '^\s*<!--\s*\%(\\s\)\?\s*\*\s*.\+\s*-->\s*$'
  endif

  if l:line_no < 1
    return v:false
  endif

  if l:op ==# 'replace_range'
    let l:snippet_lines = s:split_snippet_lines(get(a:item, 'snippet', ''))
    if s:replace_range_matches_buffer(l:action, l:target_buf, l:snippet_lines)
      return v:false
    endif

    if !s:declaration_authority_matches_current(a:item, l:target_buf, l:line_no, l:snippet_lines)
      return v:false
    endif

    return v:true
  endif

  if get(a:item, 'snippet', '') ==# ''
    if l:op ==# 'replace_line'
      if l:kind ==# 'syntax_extra_delimiter'
        let l:delimiter = s:extract_extra_delimiter_char(l:text)
        return !empty(l:delimiter) && stridx(l:content, l:delimiter) >= 0
      endif
      return l:content =~# '\s$'
    endif
    return v:false
  endif

  if l:kind ==# 'undefined_variable' && s:is_import_like_line(l:content) && !s:is_validated_import_binding_issue(a:item)
    return v:false
  endif

  if l:op ==# 'replace_line'
    let l:snippet_lines = s:split_snippet_lines(get(a:item, 'snippet', ''))
    if l:kind ==# 'tabs'
      return !empty(l:snippet_lines) && l:content !=# l:snippet_lines[0]
    endif
    let l:expected = ''
    for l:snippet_line in l:snippet_lines
      let l:trimmed = substitute(l:snippet_line, '^\s*', '', '')
      if !empty(l:trimmed)
        let l:expected = l:trimmed
        break
      endif
    endfor
    if empty(l:expected)
      return v:true
    endif
    return substitute(l:content, '^\s*', '', '') !=# l:expected
  endif

  if l:op ==# 'delete_line'
    let l:snippet_lines = s:split_snippet_lines(get(a:item, 'snippet', ''))
    let l:expected = ''
    for l:snippet_line in l:snippet_lines
      let l:trimmed = substitute(l:snippet_line, '^\s*', '', '')
      if !empty(l:trimmed)
        let l:expected = l:trimmed
        break
      endif
    endfor
    if empty(l:expected)
      return !empty(trim(l:content))
    endif
    return substitute(l:content, '^\s*', '', '') ==# l:expected
  endif

  if l:kind ==# 'undefined_variable'
    return l:content =~# '\b' . escape(l:text, '\\') . '\b'
  endif

  if l:op ==# 'insert_after' || l:op ==# 'insert_before'
    let l:snippet = get(a:item, 'snippet', '')
    if empty(l:snippet)
      return v:true
    endif
    let l:snippet_lines = s:split_snippet_lines(l:snippet)
    let l:expected = ''
    for l:snippet_line in l:snippet_lines
      let l:trimmed = substitute(l:snippet_line, '^\s*', '', '')
      if !empty(l:trimmed)
        let l:expected = l:trimmed
        break
      endif
    endfor
    if empty(l:expected)
      return v:true
    endif
    if l:kind =~# '^syntax_'
      return v:true
    endif
    if !s:declaration_authority_matches_current(a:item, l:target_buf, l:line_no, l:snippet_lines)
      return v:false
    endif

    let l:lookahead = get(l:action, 'lookahead', get(l:action, 'dedupeLookahead', len(l:snippet_lines) + 4))
    let l:start = l:line_no + 1
    let l:end = l:line_no + l:lookahead
    if l:op ==# 'insert_before'
      let l:lookbehind = get(l:action, 'lookbehind', get(l:action, 'dedupeLookbehind', len(l:snippet_lines) + 4))
      let l:start = max([1, l:line_no - l:lookbehind])
      let l:end = max([l:start, l:line_no - 1])
    endif
    let l:scope = getbufline(l:target_buf, l:start, l:end)
    for l:scope_line in l:scope
      if substitute(l:scope_line, '^\s*', '', '') ==# l:expected
        return v:false
      endif
    endfor
    return v:true
  endif

  return v:true
endfunction

function! s:is_import_like_line(line) abort
  let l:content = trim(a:line)
  if empty(l:content)
    return v:false
  endif

  return l:content =~# '^\s*import\>'
        \ || l:content =~# '^\s*export\s\+\%({\|\*\s\+from\>\)'
        \ || l:content =~# '^\s*from\>.\+\s\+import\>'
        \ || l:content =~# '^\s*\%(const\|let\|var\)\>.\+=\s*require\s*('
        \ || l:content =~# '^\s*\%(alias\|use\|require\)\>'
        \ || l:content =~# '^\s*require_relative\>'
        \ || l:content =~# '^\s*#include\>'
endfunction

function! s:is_validated_import_binding_issue(item) abort
  if get(a:item, 'kind', '') !=# 'undefined_variable'
    return v:false
  endif

  let l:parts = s:issue_parse_parts(get(a:item, 'text', ''))
  let l:message = get(l:parts, 1, '')
  let l:message = substitute(l:message, '^undefined_variable:\s*', '', '')
  return l:message =~# "^Import '\\([^']\\+\\)' nao exportado por "
endfunction

function! s:extract_undefined_variable_name(text) abort
  let l:match = matchlist(a:text, "Variavel '\\([^']\\+\\)'")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:extract_undefined_variable_suggestion(text) abort
  let l:match = matchlist(a:text, "Substitua por '\\([^']\\+\\)'")
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:followup_comment_prefix(file) abort
  let l:ext = s:file_type_token(a:file)
  if l:ext ==# '.md'
    return '<!-- : '
  endif
  if index([
        \ '.c',
        \ '.cpp',
        \ '.cs',
        \ '.go',
        \ '.h',
        \ '.hpp',
        \ '.java',
        \ '.js',
        \ '.jsx',
        \ '.kt',
        \ '.kts',
        \ '.rs',
        \ '.scala',
        \ '.swift',
        \ '.ts',
        \ '.tsx'
        \ ], l:ext) >= 0
    return '// : '
  endif
  if l:ext ==# '.lua'
    return '-- : '
  endif
  if l:ext ==# '.vim'
    return '" : '
  endif
  return '# : '
endfunction

function! s:build_followup_instruction(issue) abort
  let l:parts = s:issue_parse_parts(get(a:issue, 'text', ''))
  let l:message = get(l:parts, 1, '')
  let l:suggestion = get(l:parts, 2, '')
  let l:kind = get(a:issue, 'kind', '')

  if l:kind ==# 'undefined_variable'
    let l:unknown = s:extract_undefined_variable_name(l:message)
    let l:replacement = s:extract_undefined_variable_suggestion(l:suggestion)
    if !empty(l:unknown) && !empty(l:replacement)
      return printf(
            \ 'substitua %s por %s retornando apenas o trecho corrigido sem comentarios explicativos',
            \ l:unknown,
            \ l:replacement
            \ )
    endif
  endif

  if l:kind ==# 'class_doc'
    return 'adicione documentacao curta para a classe mantendo o contrato atual'
  endif

  if !empty(l:suggestion)
    return l:suggestion
  endif

  return l:message
endfunction

function! s:build_followup_comment(file, instruction) abort
  let l:instruction = trim(a:instruction)
  if empty(l:instruction)
    return ''
  endif

  let l:prefix = s:followup_comment_prefix(a:file)
  if l:prefix ==# '<!-- : '
    return l:prefix . l:instruction . ' -->'
  endif
  return l:prefix . l:instruction
endfunction

function! s:window_close() abort
  let l:win = s:window_find()
  if l:win == -1
    return
  endif

  let l:curr = winnr()
  if l:win != l:curr
    execute l:win . 'wincmd w'
    if winnr('$') > 1
      close
    endif
    execute l:curr . 'wincmd w'
  else
    if winnr('$') > 1
      close
    endif
  endif
endfunction

function! s:window_toggle() abort
  if s:window_find() == -1
    let g:realtime_dev_agent_show_window = 1
    call s:window_open()
  else
    let g:realtime_dev_agent_show_window = 0
    call s:window_close()
  endif
endfunction

function! s:window_set_lines(lines) abort
  let l:buf = s:window_buffer()
  if !bufexists(l:buf)
    return
  endif
  if type(a:lines) != v:t_list
    return
  endif

  call setbufvar(l:buf, '&modifiable', 1)
  call deletebufline(l:buf, 1, '$')
  if empty(a:lines)
    call appendbufline(l:buf, 0, '[Realtime Dev Agent] Nenhuma informacao para exibir')
  else
    call appendbufline(l:buf, 0, a:lines)
  endif
  call setbufvar(l:buf, '&modifiable', 0)
endfunction

function! s:window_set_busy(file) abort
  " Feedback imediato enquanto o agente roda no modo interativo.
  if !g:realtime_dev_agent_show_window
    return
  endif

  let l:busy_lines = []
  call add(l:busy_lines, 'Realtime Dev Agent')
  call add(l:busy_lines, 'Arquivo: ' . a:file)
  call add(l:busy_lines, '')
  call add(l:busy_lines, 'Status: analisando...')

  call s:window_open()
  call s:window_set_lines(l:busy_lines)
endfunction

function! s:issue_parse_parts(text) abort
  let l:message = a:text
  let l:suggestion = ''
  let l:parts = matchlist(l:message, '\v^(.*)\s\|\s(.*)$')
  if !empty(l:parts)
    let l:message = l:parts[1]
    let l:suggestion = l:parts[2]
  endif

  let l:severity = ''
  let l:severity_match = matchlist(l:message, '\v^\[([A-Za-z]+)\]\s*(.*)$')
  if !empty(l:severity_match)
    let l:severity = tolower(l:severity_match[1])
    let l:message = l:severity_match[2]
  endif

  return [l:severity, trim(l:message), trim(l:suggestion)]
endfunction

function! s:parse_analysis_output(output, file, buffer_dirty_tmp) abort
  let l:qf = []
  let l:target_norm = fnamemodify(a:file, ':p')

  for l:line in a:output
    let l:match = matchlist(l:line, '\v^(.*):(\d+):(\d+): (.*)$')
    if empty(l:match)
      continue
    endif

    let l:qf_file = l:match[1]
    let l:qf_raw_text = l:match[4]
    let l:qf_text = s:extract_issue_text(l:qf_raw_text)
    let l:qf_action = s:extract_issue_action(l:qf_raw_text)
    let l:qf_snippet = s:extract_issue_snippet(l:qf_raw_text)
    let l:qf_kind = s:extract_issue_kind(l:qf_text)
    if !empty(a:buffer_dirty_tmp) && l:qf_file ==# a:buffer_dirty_tmp
      let l:qf_file = a:file
    endif
    let l:qf_file = fnamemodify(l:qf_file, ':p')
    if l:qf_file !=# l:target_norm
      continue
    endif

    let l:item = {
          \ 'filename': l:qf_file,
          \ 'lnum': str2nr(l:match[2]),
          \ 'col': str2nr(l:match[3]),
          \ 'text': l:qf_text,
          \ 'kind': l:qf_kind,
          \ 'snippet': l:qf_snippet,
          \ 'action': l:qf_action
          \ }
    if !s:issue_targets_active_scope(l:item, a:file)
      continue
    endif
    call add(l:qf, l:item)
  endfor

  return l:qf
endfunction

function! s:issue_display_text(issue) abort
  let l:severity = toupper(trim('' . get(a:issue, 'severity', 'info')))
  let l:kind = trim('' . get(a:issue, 'kind', 'issue'))
  let l:message = '' . get(a:issue, 'message', '')
  let l:base = printf('[%s] %s: %s', l:severity, l:kind, l:message)
  let l:suggestion = '' . get(a:issue, 'suggestion', '')
  return empty(l:suggestion) ? l:base : l:base . ' | ' . l:suggestion
endfunction

function! s:qf_items_from_issues(issues, file) abort
  let l:qf = []
  let l:target_norm = fnamemodify(a:file, ':p')

  for l:issue in a:issues
    if type(l:issue) != v:t_dict
      continue
    endif

    let l:item_file = fnamemodify(get(l:issue, 'file', l:target_norm), ':p')
    if l:item_file !=# l:target_norm
      continue
    endif

    let l:item = {
          \ 'filename': l:item_file,
          \ 'lnum': max([1, str2nr(string(get(l:issue, 'line', 1)))]),
          \ 'col': max([1, str2nr(string(get(l:issue, 'col', 1)))]),
          \ 'text': s:issue_display_text(l:issue),
          \ 'kind': trim('' . get(l:issue, 'kind', '')),
          \ 'snippet': type(get(l:issue, 'snippet', '')) == v:t_string ? get(l:issue, 'snippet', '') : '',
          \ 'action': type(get(l:issue, 'action', {})) == v:t_dict ? get(l:issue, 'action', {}) : {},
          \ 'metadata': type(get(l:issue, 'metadata', {})) == v:t_dict ? deepcopy(get(l:issue, 'metadata', {})) : {},
          \ 'confidence': type(get(l:issue, 'confidence', {})) == v:t_dict ? deepcopy(get(l:issue, 'confidence', {})) : {},
          \ 'autofixPriority': str2nr(string(get(l:issue, 'autofixPriority', 0))),
          \ }
    if !s:issue_targets_active_scope(l:item, a:file)
      continue
    endif
    call add(l:qf, l:item)
  endfor

  return l:qf
endfunction

function! s:analysis_for_buffer(bufnr, ...) abort
  let l:analysis_mode = a:0 > 0 ? s:normalize_analysis_mode(a:1) : 'full'
  let l:request = s:prepared_analysis_request(a:bufnr, l:analysis_mode)
  if !get(l:request, 'ok', v:false)
    return {
          \ 'ok': v:false,
          \ 'file': get(l:request, 'file', ''),
          \ 'qf': [],
          \ 'error': get(l:request, 'error', 'falha ao preparar analise'),
          \ 'from_cache': v:false,
          \ }
  endif

  let l:cached = get(l:request, 'cached', {})
  if !empty(l:cached)
    return l:cached
  endif

  let l:file = get(l:request, 'file', '')
  let l:changedtick = get(l:request, 'changedtick', 0)
  let l:buffer_dirty_tmp = get(l:request, 'buffer_dirty_tmp', '')
  let l:analysis_mode = get(l:request, 'analysis_mode', l:analysis_mode)
  let l:output = get(l:request, 'uses_stdin', v:false)
        \ ? s:run_systemlist(get(l:request, 'argv', []), get(l:request, 'root', ''), get(l:request, 'stdin_payload', ''))
        \ : s:run_systemlist(get(l:request, 'argv', []), get(l:request, 'root', ''))
  call s:cleanup_async_analysis_temp_file(l:request)

  if v:shell_error != 0
    return {
          \ 'ok': v:false,
          \ 'file': l:file,
          \ 'qf': [],
          \ 'error': join(l:output, "\n"),
          \ 'from_cache': v:false,
          \ }
  endif

  let l:analysis = {
        \ 'ok': v:true,
        \ 'file': l:file,
        \ 'qf': s:analysis_qf_from_output(l:output, l:file, l:buffer_dirty_tmp),
        \ 'error': '',
        \ 'from_cache': v:false,
        \ }
  return s:store_analysis_for_buffer(
        \ l:file,
        \ l:changedtick,
        \ l:analysis_mode,
        \ l:analysis,
        \ get(l:request, 'focus_start_line', 0),
        \ get(l:request, 'focus_end_line', 0)
        \ )
endfunction

function! s:collect_analysis_for_buffer(bufnr, ...) abort
  if a:0 > 0
    return s:analysis_for_buffer(a:bufnr, a:1)
  endif
  return s:analysis_for_buffer(a:bufnr)
endfunction

function! s:realtime_check_handle_analysis(bufnr, analysis, open_qf, show_echo, realtime_mode) abort
  let l:file = get(a:analysis, 'file', fnamemodify(bufname(a:bufnr), ':p'))
  if !get(a:analysis, 'ok', v:false)
    let l:is_missing_runtime = get(a:analysis, 'error', '') ==# 'runtime nao encontrado'
    if g:realtime_dev_agent_show_window
      if l:is_missing_runtime
        let l:error_lines = []
        call add(l:error_lines, 'Realtime Dev Agent')
        call add(l:error_lines, 'Arquivo: ' . l:file)
        call add(l:error_lines, '')
        call add(l:error_lines, 'Erro: runtime nao encontrado no PATH')
        call add(l:error_lines, 'Esperado: ' . s:realtime_dev_agent_script_label())
        call add(l:error_lines, 'Ajuste g:realtime_dev_agent_script para um arquivo .js valido')
        call s:window_set_lines(l:error_lines)
      else
        let l:error_lines = []
        call add(l:error_lines, 'Realtime Dev Agent')
        call add(l:error_lines, 'Arquivo: ' . l:file)
        call add(l:error_lines, '')
        call add(l:error_lines, 'Erro: falha ao executar o agente')
        call add(l:error_lines, 'Verifique o caminho do script em g:realtime_dev_agent_script e se o runtime esta no PATH.')
        call s:window_set_lines(l:error_lines)
      endif
    endif

    if a:show_echo
      echohl ErrorMsg
      if l:is_missing_runtime
        echomsg '[RealtimeDevAgent] Runtime nao encontrado no PATH'
      else
        echomsg '[RealtimeDevAgent] Falha ao executar o agente'
      endif
      echohl None
    endif
    return
  endif

  let l:qf = deepcopy(get(a:analysis, 'qf', []))
  let l:qf = s:merge_lsp_diagnostic_auto_fix_candidates(a:bufnr, l:file, l:qf)
  if a:open_qf || g:realtime_dev_agent_show_window || !a:realtime_mode
    call setqflist([], 'r', {'title': 'Realtime Dev Agent'})
    call setqflist(l:qf, 'a')
  endif
  let s:realtime_dev_agent_last_qf = l:qf
  let l:auto_fix_applied = 0
  let l:previous_mode = s:realtime_dev_agent_is_realtime_check
  let l:suppress_auto_fix = s:realtime_dev_agent_suppress_auto_fix_once
  let s:realtime_dev_agent_suppress_auto_fix_once = v:false
  let s:realtime_dev_agent_is_realtime_check = a:realtime_mode
  try
    if g:realtime_dev_agent_auto_fix_enabled && !l:suppress_auto_fix
      let l:auto_fix_applied = s:realtime_dev_agent_apply_auto_fixes(l:qf, l:file, {
            \ 'bufnr': a:bufnr,
            \ 'open_qf': a:open_qf,
            \ 'show_echo': a:show_echo,
            \ 'realtime_mode': a:realtime_mode ? v:true : v:false,
            \ })
    endif
  finally
    let s:realtime_dev_agent_is_realtime_check = l:previous_mode
  endtry

  if l:auto_fix_applied != 0
    return
  endif

  if empty(l:qf)
    if a:open_qf
      cclose
    endif
    call s:window_refresh(l:file, l:qf)
    if a:show_echo
      echo '[RealtimeDevAgent] Nenhuma sugestao encontrada'
    endif
  else
    if a:open_qf
      copen
    endif
    call s:window_refresh(l:file, l:qf)
    if a:show_echo
      echomsg '[RealtimeDevAgent] ' . len(l:qf) . ' sugestao(oes) encontrada(s)'
    endif
  endif
endfunction

function! s:schedule_realtime_check_handle_analysis(bufnr, analysis, open_qf, show_echo, realtime_mode) abort
  let l:bufnr = a:bufnr
  let l:analysis = deepcopy(a:analysis)
  let l:open_qf = a:open_qf
  let l:show_echo = a:show_echo
  let l:realtime_mode = a:realtime_mode

  if has('timers')
    call timer_start(0, {-> s:realtime_check_handle_analysis(l:bufnr, l:analysis, l:open_qf, l:show_echo, l:realtime_mode)})
    return
  endif

  call s:realtime_check_handle_analysis(l:bufnr, l:analysis, l:open_qf, l:show_echo, l:realtime_mode)
endfunction

function! s:stop_analysis_daemon() abort
  let l:job = get(s:, 'realtime_dev_agent_daemon_job', -1)
  let s:realtime_dev_agent_daemon_job = -1
  let s:realtime_dev_agent_daemon_pending = {}
  let s:realtime_dev_agent_daemon_stdout_remainder = ''
  if l:job > 0
    silent! call jobstop(l:job)
  endif
endfunction

function! s:analysis_daemon_handle_failure(message) abort
  let l:pending = values(get(s:, 'realtime_dev_agent_daemon_pending', {}))
  let s:realtime_dev_agent_daemon_pending = {}
  let s:realtime_dev_agent_daemon_stdout_remainder = ''

  for l:context in l:pending
    call s:schedule_realtime_check_handle_analysis(get(l:context, 'bufnr', -1), {
          \ 'ok': v:false,
          \ 'file': get(l:context, 'file', ''),
          \ 'qf': [],
          \ 'error': a:message,
          \ 'from_cache': v:false,
          \ }, get(l:context, 'open_qf', 0), get(l:context, 'show_echo', 0), get(l:context, 'realtime_mode', v:true))
  endfor
endfunction

function! s:analysis_daemon_on_stdout(job_id, data, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_daemon_job', -1)
    return
  endif
  if type(a:data) != v:t_list || empty(a:data)
    return
  endif

  let l:payload = s:realtime_dev_agent_daemon_stdout_remainder . join(a:data, "\n")
  let l:lines = split(l:payload, "\n", 1)
  let s:realtime_dev_agent_daemon_stdout_remainder = remove(l:lines, -1)

  for l:line in l:lines
    let l:line = trim(l:line)
    if empty(l:line)
      continue
    endif

    try
      let l:response = json_decode(l:line)
    catch
      continue
    endtry

    let l:request_id = str2nr(string(get(l:response, 'id', 0)))
    if l:request_id <= 0 || !has_key(s:realtime_dev_agent_daemon_pending, l:request_id)
      continue
    endif

    let l:context = remove(s:realtime_dev_agent_daemon_pending, l:request_id)
    let l:bufnr = get(l:context, 'bufnr', -1)
    if l:bufnr <= 0 || !bufloaded(l:bufnr)
      continue
    endif
    if getbufvar(l:bufnr, 'changedtick', -1) !=# get(l:context, 'changedtick', -1)
      continue
    endif

    if !get(l:response, 'ok', v:false)
      call s:schedule_realtime_check_handle_analysis(l:bufnr, {
            \ 'ok': v:false,
            \ 'file': get(l:context, 'file', ''),
            \ 'qf': [],
            \ 'error': string(get(l:response, 'error', 'falha ao analisar via daemon')),
            \ 'from_cache': v:false,
            \ }, get(l:context, 'open_qf', 0), get(l:context, 'show_echo', 0), get(l:context, 'realtime_mode', v:true))
      continue
    endif

    let l:file = get(l:context, 'file', '')
    let l:analysis = {
          \ 'ok': v:true,
          \ 'file': l:file,
          \ 'qf': s:qf_items_from_issues(get(l:response, 'issues', []), l:file),
          \ 'error': '',
          \ 'from_cache': v:false,
          \ }
    let l:analysis = s:store_analysis_for_buffer(
          \ l:file,
          \ get(l:context, 'changedtick', 0),
          \ get(l:context, 'analysis_mode', 'full'),
          \ l:analysis,
          \ get(l:context, 'focus_start_line', 0),
          \ get(l:context, 'focus_end_line', 0)
          \ )
    call s:schedule_realtime_check_handle_analysis(
          \ l:bufnr,
          \ l:analysis,
          \ get(l:context, 'open_qf', 0),
          \ get(l:context, 'show_echo', 0),
          \ get(l:context, 'realtime_mode', v:true)
          \ )
  endfor
endfunction

function! s:analysis_daemon_on_stderr(job_id, data, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_daemon_job', -1)
    return
  endif
endfunction

function! s:analysis_daemon_on_exit(job_id, code, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_daemon_job', -1)
    return
  endif
  let s:realtime_dev_agent_daemon_job = -1
  if a:code == 0
    call s:analysis_daemon_handle_failure('daemon de analise finalizado')
  else
    call s:analysis_daemon_handle_failure('falha no daemon de analise realtime')
  endif
endfunction

function! s:ensure_analysis_daemon() abort
  if !s:realtime_daemon_enabled()
    return -1
  endif

  let l:job = get(s:, 'realtime_dev_agent_daemon_job', -1)
  if l:job > 0
    return l:job
  endif

  let l:runner = s:realtime_dev_agent_script_runner()
  let l:script = s:realtime_dev_agent_script_path()
  if empty(l:runner) || empty(l:script) || !filereadable(l:script)
    return -1
  endif

  let l:job = jobstart([l:runner, l:script, '--serve'], {
        \ 'on_stdout': function('s:analysis_daemon_on_stdout'),
        \ 'on_stderr': function('s:analysis_daemon_on_stderr'),
        \ 'on_exit': function('s:analysis_daemon_on_exit')
        \ })
  if l:job <= 0
    return -1
  endif

  let s:realtime_dev_agent_daemon_job = l:job
  let s:realtime_dev_agent_daemon_stdout_remainder = ''
  let s:realtime_dev_agent_daemon_pending = {}
  return l:job
endfunction

function! s:start_daemon_realtime_check(bufnr, open_qf, show_echo, analysis_mode, realtime_mode) abort
  let l:job = s:ensure_analysis_daemon()
  if l:job <= 0
    return v:false
  endif

  let l:request = s:prepared_analysis_request(a:bufnr, a:analysis_mode)
  if !get(l:request, 'ok', v:false)
    call s:realtime_check_handle_analysis(a:bufnr, {
          \ 'ok': v:false,
          \ 'file': get(l:request, 'file', ''),
          \ 'qf': [],
          \ 'error': get(l:request, 'error', 'falha ao preparar analise'),
          \ 'from_cache': v:false,
          \ }, a:open_qf, a:show_echo, a:realtime_mode)
    return v:true
  endif

  let l:cached = get(l:request, 'cached', {})
  if !empty(l:cached)
    call s:realtime_check_handle_analysis(a:bufnr, l:cached, a:open_qf, a:show_echo, a:realtime_mode)
    return v:true
  endif

  let s:realtime_dev_agent_daemon_request_seq += 1
  let l:request_id = s:realtime_dev_agent_daemon_request_seq
  let l:payload = {
        \ 'id': l:request_id,
        \ 'command': 'analyze',
        \ 'sourcePath': get(l:request, 'file', ''),
        \ 'text': join(getbufline(a:bufnr, 1, '$'), "\n"),
        \ 'analysisMode': get(l:request, 'analysis_mode', a:analysis_mode),
        \ }
  if get(l:request, 'focus_start_line', 0) > 0 && get(l:request, 'focus_end_line', 0) >= get(l:request, 'focus_start_line', 0)
    let l:payload.focusStartLine = get(l:request, 'focus_start_line', 0)
    let l:payload.focusEndLine = get(l:request, 'focus_end_line', 0)
  endif

  let s:realtime_dev_agent_daemon_pending[l:request_id] = {
        \ 'bufnr': a:bufnr,
        \ 'file': get(l:request, 'file', ''),
        \ 'changedtick': get(l:request, 'changedtick', 0),
        \ 'open_qf': a:open_qf,
        \ 'show_echo': a:show_echo,
        \ 'realtime_mode': a:realtime_mode ? v:true : v:false,
        \ 'analysis_mode': get(l:request, 'analysis_mode', a:analysis_mode),
        \ 'focus_start_line': get(l:request, 'focus_start_line', 0),
        \ 'focus_end_line': get(l:request, 'focus_end_line', 0),
        \ }

  try
    call chansend(l:job, json_encode(l:payload) . "\n")
  catch
    call remove(s:realtime_dev_agent_daemon_pending, l:request_id)
    call s:stop_analysis_daemon()
    return v:false
  endtry

  return v:true
endfunction

function! s:async_analysis_on_stdout(job_id, data, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_async_analysis_job', -1)
    return
  endif
  if type(a:data) != v:t_list
    return
  endif
  let s:realtime_dev_agent_async_analysis_context.stdout = copy(a:data)
endfunction

function! s:async_analysis_on_stderr(job_id, data, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_async_analysis_job', -1)
    return
  endif
  if type(a:data) != v:t_list
    return
  endif
  let s:realtime_dev_agent_async_analysis_context.stderr = copy(a:data)
endfunction

function! s:async_analysis_on_exit(job_id, code, event) abort
  if a:job_id !=# get(s:, 'realtime_dev_agent_async_analysis_job', -1)
    return
  endif

  let l:context = get(s:, 'realtime_dev_agent_async_analysis_context', {})
  let s:realtime_dev_agent_async_analysis_job = -1
  let s:realtime_dev_agent_async_analysis_context = {}

  let l:bufnr = get(l:context, 'bufnr', -1)
  let l:file = get(l:context, 'file', '')
  let l:changedtick = get(l:context, 'changedtick', -1)
  let l:stdout = filter(copy(get(l:context, 'stdout', [])), {_, val -> type(val) == v:t_string && !empty(val)})
  let l:stderr = filter(copy(get(l:context, 'stderr', [])), {_, val -> type(val) == v:t_string && !empty(val)})
  let l:analysis = {}

  if l:bufnr <= 0 || !bufloaded(l:bufnr)
    call s:cleanup_async_analysis_temp_file(l:context)
    return
  endif

  if getbufvar(l:bufnr, 'changedtick', -1) !=# l:changedtick
    call s:cleanup_async_analysis_temp_file(l:context)
    return
  endif

  if a:code != 0
    let l:analysis = {
          \ 'ok': v:false,
          \ 'file': l:file,
          \ 'qf': [],
          \ 'error': join(l:stdout + l:stderr, "\n"),
          \ 'from_cache': v:false,
          \ }
  else
    let l:analysis = {
          \ 'ok': v:true,
          \ 'file': l:file,
          \ 'qf': s:analysis_qf_from_output(l:stdout, l:file, get(l:context, 'buffer_dirty_tmp', '')),
          \ 'error': '',
          \ 'from_cache': v:false,
          \ }
    let l:analysis = s:store_analysis_for_buffer(
          \ l:file,
          \ l:changedtick,
          \ get(l:context, 'analysis_mode', 'full'),
          \ l:analysis,
          \ get(l:context, 'focus_start_line', 0),
          \ get(l:context, 'focus_end_line', 0)
          \ )
  endif

  call s:cleanup_async_analysis_temp_file(l:context)
  call s:schedule_realtime_check_handle_analysis(
        \ l:bufnr,
        \ l:analysis,
        \ get(l:context, 'open_qf', 0),
        \ get(l:context, 'show_echo', 0),
        \ get(l:context, 'realtime_mode', v:true)
        \ )
endfunction

function! s:start_async_realtime_check(bufnr, open_qf, show_echo, ...) abort
  if !s:realtime_async_enabled()
    return v:false
  endif

  let l:analysis_mode = a:0 > 0 ? s:normalize_analysis_mode(a:1) : 'full'
  let l:realtime_mode = a:0 > 1 ? (a:2 ? v:true : v:false) : v:true
  if s:realtime_daemon_enabled()
    if s:start_daemon_realtime_check(a:bufnr, a:open_qf, a:show_echo, l:analysis_mode, l:realtime_mode)
      return v:true
    endif
  endif
  let l:request = s:prepared_analysis_request(a:bufnr, l:analysis_mode)
  if !get(l:request, 'ok', v:false)
    call s:realtime_check_handle_analysis(a:bufnr, {
          \ 'ok': v:false,
          \ 'file': get(l:request, 'file', ''),
          \ 'qf': [],
          \ 'error': get(l:request, 'error', 'falha ao preparar analise'),
          \ 'from_cache': v:false,
          \ }, a:open_qf, a:show_echo, l:realtime_mode)
    return v:true
  endif

  let l:cached = get(l:request, 'cached', {})
  if !empty(l:cached)
    call s:realtime_check_handle_analysis(a:bufnr, l:cached, a:open_qf, a:show_echo, l:realtime_mode)
    return v:true
  endif

  call s:stop_async_analysis_job()
  let l:command = s:project_command_argv(get(l:request, 'argv', []), get(l:request, 'root', ''))
  let s:realtime_dev_agent_async_analysis_context = {
        \ 'bufnr': a:bufnr,
        \ 'file': get(l:request, 'file', ''),
        \ 'changedtick': get(l:request, 'changedtick', 0),
        \ 'buffer_dirty_tmp': get(l:request, 'buffer_dirty_tmp', ''),
        \ 'stdin_payload': get(l:request, 'stdin_payload', ''),
        \ 'uses_stdin': get(l:request, 'uses_stdin', v:false),
        \ 'open_qf': a:open_qf,
        \ 'show_echo': a:show_echo,
        \ 'realtime_mode': l:realtime_mode,
        \ 'analysis_mode': l:analysis_mode,
        \ 'focus_start_line': get(l:request, 'focus_start_line', 0),
        \ 'focus_end_line': get(l:request, 'focus_end_line', 0),
        \ 'stdout': [],
        \ 'stderr': [],
        \ }
  let l:job = jobstart(l:command, {
        \ 'stdout_buffered': v:true,
        \ 'stderr_buffered': v:true,
        \ 'on_stdout': function('s:async_analysis_on_stdout'),
        \ 'on_stderr': function('s:async_analysis_on_stderr'),
        \ 'on_exit': function('s:async_analysis_on_exit')
        \ })

  if l:job <= 0
    let l:context = get(s:, 'realtime_dev_agent_async_analysis_context', {})
    let s:realtime_dev_agent_async_analysis_context = {}
    call s:cleanup_async_analysis_temp_file(l:context)
    return v:false
  endif

  let s:realtime_dev_agent_async_analysis_job = l:job
  if get(l:request, 'uses_stdin', v:false)
    try
      call chansend(l:job, get(l:request, 'stdin_payload', ''))
      call chanclose(l:job, 'stdin')
    catch
      call s:stop_async_analysis_job()
      return v:false
    endtry
  endif
  return v:true
endfunction

function! s:realtime_check_from_buffer(bufnr, open_qf, show_echo, ...) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return
  endif

  let l:file = fnamemodify(bufname(a:bufnr), ':p')
  if !s:should_check_file(l:file)
    return
  endif

  if bufnr('%') == a:bufnr && &buftype ==# ''
    call s:remember_code_window(win_getid())
  endif

  if g:realtime_dev_agent_show_window && !s:realtime_dev_agent_is_realtime_check
    call s:window_set_busy(l:file)
  endif

  let l:analysis_mode = a:0 > 0 ? s:normalize_analysis_mode(a:1) : 'full'
  let l:analysis = s:analysis_for_buffer(a:bufnr, l:analysis_mode)
  call s:realtime_check_handle_analysis(a:bufnr, l:analysis, a:open_qf, a:show_echo, s:realtime_dev_agent_is_realtime_check)
endfunction

function! s:auto_fix_target_available(bufnr) abort
  if a:bufnr <= 0 || !bufloaded(a:bufnr)
    return v:false
  endif
  if !getbufvar(a:bufnr, '&modifiable', 0) || getbufvar(a:bufnr, '&readonly', 0)
    return v:false
  endif
  return v:true
endfunction

function! s:stop_auto_fix_timer() abort
  if get(s:, 'realtime_dev_agent_auto_fix_timer', -1) != -1
    call timer_stop(s:realtime_dev_agent_auto_fix_timer)
    let s:realtime_dev_agent_auto_fix_timer = -1
  endif
endfunction

function! s:clear_auto_fix_runtime() abort
  call s:stop_auto_fix_timer()
  let s:realtime_dev_agent_auto_fix_state = {}
  let s:realtime_dev_agent_auto_fix_busy = v:false
endfunction

function! s:auto_fix_queue_delay() abort
  return 10
endfunction

function! s:schedule_auto_fix_queue(delay) abort
  if !has('timers')
    return
  endif
  call s:stop_auto_fix_timer()
  let l:delay = max([0, str2nr(string(a:delay))])
  let s:realtime_dev_agent_auto_fix_timer = timer_start(l:delay, function('s:auto_fix_queue_tick'))
endfunction

function! s:build_auto_fix_state(qf, file, opts) abort
  if type(a:qf) != v:t_list
    return {}
  endif

  if !g:realtime_dev_agent_auto_fix_enabled
    return {}
  endif

  let l:target_file = fnamemodify(a:file, ':p')
  let l:target_buf = s:issue_target_buffer(l:target_file)
  if !s:realtime_dev_agent_can_apply_auto_fixes_for_buffer(l:target_buf)
    return {}
  endif

  let l:kinds = get(g:, 'realtime_dev_agent_auto_fix_kinds', [])
  if type(l:kinds) != v:t_list
    let l:kinds = []
  endif
  let l:apply_all_kinds = empty(l:kinds)
  if l:apply_all_kinds
    " Lista vazia significa 'todos os tipos', com excecao segura de 'todo_fixme' para evitar ciclo.
  endif

  let l:seen = {}
  let l:auto_candidates = []
  for l:item in a:qf
    let l:item_file = get(l:item, 'filename', '')
    if fnamemodify(l:item_file, ':p') !=# fnamemodify(a:file, ':p')
      continue
    endif
    if !s:issue_targets_active_scope(l:item, a:file)
      continue
    endif
    let l:item_kind = get(l:item, 'kind', '')
    if l:item_kind ==# 'todo_fixme' && l:apply_all_kinds
      continue
    endif
    if !l:apply_all_kinds && index(l:kinds, l:item_kind) == -1 && index(['lsp_code_action', 'lsp_ai_fix'], l:item_kind) == -1
      continue
    endif
    let l:item_action = s:issue_effective_action(l:item)
    let l:item_op = get(l:item_action, 'op', '')
    if empty(get(l:item, 'snippet', ''))
          \ && l:item_kind !=# 'trailing_whitespace'
          \ && l:item_op !=# 'run_command'
          \ && l:item_op !=# 'lsp_code_action'
          \ && l:item_op !=# 'lsp_ai_fix'
      continue
    endif
    if !empty(s:issue_auto_fix_noop_reason(l:item))
      continue
    endif

    let l:item_key = s:issue_equivalence_key(l:item)
    if has_key(l:seen, l:item_key)
      continue
    endif
    let l:seen[l:item_key] = 1
    call add(l:auto_candidates, l:item)
  endfor

  if empty(l:auto_candidates)
    return {}
  endif

  let l:realtime_mode = get(a:opts, 'realtime_mode', s:realtime_dev_agent_is_realtime_check ? v:true : v:false)
  if l:realtime_mode
    let l:force_documentation_context = s:realtime_doc_cursor_context_only()
    let l:auto_candidates = s:select_auto_fix_candidates_by_scope(l:auto_candidates, l:target_buf, l:force_documentation_context)
    let l:auto_candidates = s:limit_cursor_context_auto_fix_candidates(l:auto_candidates, l:target_buf, l:force_documentation_context)
  endif

  if empty(l:auto_candidates)
    return {}
  endif

  call sort(l:auto_candidates, {entry_a, entry_b ->
        \ s:compare_fix_order(entry_a, entry_b)
        \ })
  let l:auto_candidates = s:limit_documentation_candidates(l:auto_candidates)

  if empty(l:auto_candidates)
    return {}
  endif

  if mode() =~# '^i'
    let s:realtime_dev_agent_pending_auto_fixes = l:auto_candidates
    return {}
  endif

  let l:affected_files = s:collect_affected_files(a:file, l:auto_candidates)
  let l:strict_validation = s:auto_fix_strict_validation_enabled()
  let l:file_snapshot = l:strict_validation ? s:capture_file_snapshot(l:affected_files) : {}
  let l:applied = 0
  let l:applied_items = []
  let l:max_to_apply = get(g:, 'realtime_dev_agent_auto_fix_max_per_check', 0)
  if type(l:max_to_apply) != v:t_number
    let l:max_to_apply = str2nr(string(l:max_to_apply))
  endif
  if l:realtime_mode
    let l:realtime_limit = get(g:, 'realtime_dev_agent_realtime_auto_fix_max_per_check', 2)
    if type(l:realtime_limit) != v:t_number
      let l:realtime_limit = str2nr(string(l:realtime_limit))
    endif
    if l:realtime_limit > 0 && (l:max_to_apply <= 0 || l:realtime_limit < l:max_to_apply)
      let l:max_to_apply = l:realtime_limit
    endif
  endif
  if l:max_to_apply <= 0 && s:non_blocking_mode_enabled()
    let l:max_to_apply = s:auto_fix_non_blocking_max_per_check()
  endif
  let l:file_key = fnamemodify(a:file, ':p')
  let l:fix_guard = get(s:realtime_dev_agent_fix_guard, l:file_key, {})
  let l:chunk_limit = s:non_blocking_mode_enabled() && has('timers') ? s:auto_fix_non_blocking_max_per_check() : 0

  return {
        \ 'file': l:target_file,
        \ 'target_buf': l:target_buf,
        \ 'open_qf': get(a:opts, 'open_qf', 0),
        \ 'show_echo': get(a:opts, 'show_echo', 0),
        \ 'realtime_mode': l:realtime_mode ? v:true : v:false,
        \ 'source_qf': deepcopy(a:qf),
        \ 'candidates': l:auto_candidates,
        \ 'affected_files': l:affected_files,
        \ 'strict_validation': l:strict_validation ? v:true : v:false,
        \ 'file_snapshot': l:file_snapshot,
        \ 'applied': l:applied,
        \ 'applied_items': l:applied_items,
        \ 'max_to_apply': l:max_to_apply,
        \ 'chunk_limit': l:chunk_limit,
        \ 'file_key': l:file_key,
        \ 'fix_guard': l:fix_guard,
        \ 'line_kind_applied': {},
        \ 'line_adjustments': [],
        \ }
endfunction

function! s:run_auto_fix_state(state, max_items) abort
  let l:state = a:state
  let l:processed = 0
  let l:visual_batch = s:start_auto_fix_visual_batch(get(l:state, 'target_buf', -1))
  try
    while !empty(get(l:state, 'candidates', []))
      if get(l:state, 'max_to_apply', 0) > 0 && get(l:state, 'applied', 0) >= get(l:state, 'max_to_apply', 0)
        break
      endif

      let l:item = remove(l:state.candidates, 0)
      let l:item_line = get(l:item, 'lnum', 0)
      if l:item_line <= 0
        let l:processed += 1
        if a:max_items > 0 && l:processed >= a:max_items
          break
        endif
        continue
      endif

      let l:item_kind = get(l:item, 'kind', '')
      let l:item_identity = s:issue_action_identity(l:item)
      let l:item_line_key = string(l:item_line)
      let l:line_kinds = get(l:state.line_kind_applied, l:item_line_key, [])
      if type(l:line_kinds) != v:t_list
        let l:line_kinds = []
      endif
      if index(l:line_kinds, 'undefined_variable') != -1 && l:item_kind ==# 'debug_output'
        let l:processed += 1
        if a:max_items > 0 && l:processed >= a:max_items
          break
        endif
        continue
      endif

      let l:item_apply_key = s:issue_equivalence_key(l:item)
      if !empty(l:line_kinds) && index(l:line_kinds, l:item_apply_key) != -1
        let l:processed += 1
        if a:max_items > 0 && l:processed >= a:max_items
          break
        endif
        continue
      endif

      let l:guard_key = printf(
            \ '%s|%s|%d|%s',
            \ get(l:item, 'filename', ''),
            \ l:item_apply_key,
            \ l:item_line,
            \ l:item_identity
            \ )
      if has_key(l:state.fix_guard, l:guard_key)
        let l:processed += 1
        if a:max_items > 0 && l:processed >= a:max_items
          break
        endif
        continue
      endif
      let l:loop_guard_key = ''
      if get(l:state, 'realtime_mode', v:false) && s:uses_realtime_loop_guard(l:item)
        let l:loop_guard_key = 'loop|' . s:issue_realtime_loop_guard_key(l:item)
        if has_key(l:state.fix_guard, l:loop_guard_key)
          let l:processed += 1
          if a:max_items > 0 && l:processed >= a:max_items
            break
          endif
          continue
        endif
      endif

      let l:shifted_item = s:shift_issue_for_batch(l:item, s:cumulative_line_shift(l:item_line, l:state.line_adjustments))
      if s:apply_issue_snippet(l:shifted_item, v:false)
        let l:state.fix_guard[l:guard_key] = 1
        if !empty(l:loop_guard_key)
          let l:state.fix_guard[l:loop_guard_key] = 1
        endif
        call add(l:line_kinds, l:item_apply_key)
        let l:state.line_kind_applied[l:item_line_key] = l:line_kinds
        let l:state.applied += 1
        call add(l:state.applied_items, l:shifted_item)
        let l:adjustment = s:issue_shift_adjustment(l:shifted_item)
        if !empty(l:adjustment)
          call add(l:state.line_adjustments, l:adjustment)
          if get(l:visual_batch, 'active', v:false)
            call add(l:visual_batch.line_adjustments, l:adjustment)
          endif
        endif
        let l:state = s:drop_stale_candidates_after_delete_line(l:state, l:item)
      endif

      let l:processed += 1
      if a:max_items > 0 && l:processed >= a:max_items
        break
      endif
    endwhile
  finally
    call s:end_auto_fix_visual_batch(l:visual_batch)
  endtry

  return l:state
endfunction

function! s:finalize_auto_fix_state(state) abort
  let l:state = type(a:state) == v:t_dict ? a:state : {}
  let l:applied = get(l:state, 'applied', 0)

  if !empty(get(l:state, 'file_key', ''))
    let s:realtime_dev_agent_fix_guard[l:state.file_key] = get(l:state, 'fix_guard', {})
  endif

  if l:applied > 0
    for l:affected_file in get(l:state, 'affected_files', [])
      call s:drop_analysis_cache_for_file(l:affected_file)
    endfor

    if !get(l:state, 'strict_validation', v:false)
      echo printf('[RealtimeDevAgent] Auto-fix aplicado em %d sugerenca(s) [background]', l:applied)
    else
      let l:analysis = s:collect_analysis_for_buffer(get(l:state, 'target_buf', -1))
      if !get(l:analysis, 'ok', v:false)
        call s:restore_file_snapshot(get(l:state, 'file_snapshot', {}))
        echohl WarningMsg
        echomsg '[RealtimeDevAgent] Auto-fix revertido: falha ao reanalisar o buffer'
        echohl None
        let l:applied = 0
      else
        let l:guard_payload = {
              \ 'appliedIssues': get(l:state, 'applied_items', []),
              \ 'beforeIssues': get(l:state, 'source_qf', []),
              \ 'afterIssues': get(l:analysis, 'qf', []),
              \ 'fileEntries': s:build_guard_file_entries(get(l:state, 'affected_files', [])),
              \ }
        let l:guard_result = s:run_autofix_guard(l:guard_payload, get(l:state, 'file', ''))
        if !get(l:guard_result, 'ok', v:false)
          call s:restore_file_snapshot(get(l:state, 'file_snapshot', {}))
          echohl WarningMsg
          echomsg '[RealtimeDevAgent] Auto-fix revertido: ' . s:format_guard_failure(l:guard_result)
          echohl None
          let l:applied = 0
        else
          echo printf('[RealtimeDevAgent] Auto-fix aplicado em %d sugerenca(s)', l:applied)
        endif
      endif
    endif
  endif

  call s:clear_auto_fix_runtime()

  if l:applied > 0
    let l:realtime_mode = get(l:state, 'realtime_mode', v:false) ? v:true : v:false
    let l:analysis_mode = s:analysis_mode_for_request(l:realtime_mode)
    let s:realtime_dev_agent_suppress_auto_fix_once = v:true
    call s:start_async_realtime_check_with_fallback(
          \ get(l:state, 'target_buf', -1),
          \ get(l:state, 'open_qf', 0),
          \ get(l:state, 'show_echo', 0),
          \ l:analysis_mode,
          \ l:realtime_mode
          \ )
  endif

  return l:applied
endfunction

function! s:auto_fix_queue_tick(timer_id) abort
  let s:realtime_dev_agent_auto_fix_timer = -1

  if empty(s:realtime_dev_agent_auto_fix_state)
    let s:realtime_dev_agent_auto_fix_busy = v:false
    return
  endif

  let l:state = s:realtime_dev_agent_auto_fix_state
  if !s:auto_fix_target_available(get(l:state, 'target_buf', -1))
    call s:clear_auto_fix_runtime()
    return
  endif

  if mode() =~# '^i'
    call s:schedule_auto_fix_queue(150)
    return
  endif

  let l:state = s:run_auto_fix_state(l:state, get(l:state, 'chunk_limit', s:auto_fix_non_blocking_max_per_check()))
  let s:realtime_dev_agent_auto_fix_state = l:state

  if !empty(get(l:state, 'candidates', [])) && (get(l:state, 'max_to_apply', 0) <= 0 || get(l:state, 'applied', 0) < get(l:state, 'max_to_apply', 0))
    call s:schedule_auto_fix_queue(s:auto_fix_queue_delay())
    return
  endif

  call s:finalize_auto_fix_state(l:state)
endfunction

function! s:realtime_dev_agent_apply_auto_fixes(qf, file, ...) abort
  let l:opts = a:0 > 0 && type(a:1) == v:t_dict ? a:1 : {}
  let l:state = s:build_auto_fix_state(a:qf, a:file, l:opts)
  if empty(l:state)
    return 0
  endif

  let s:realtime_dev_agent_auto_fix_busy = v:true
  if get(l:state, 'chunk_limit', 0) > 0
    let s:realtime_dev_agent_auto_fix_state = l:state
    call s:schedule_auto_fix_queue(0)
    return -1
  endif

  let l:state = s:run_auto_fix_state(l:state, 0)
  return s:finalize_auto_fix_state(l:state)
endfunction

function! s:shift_issue_for_batch(item, line_shift) abort
  if type(a:item) != v:t_dict || a:line_shift == 0
    return a:item
  endif

  let l:shifted = deepcopy(a:item)
  let l:base_line = get(l:shifted, 'lnum', 0)
  if l:base_line > 0
    let l:shifted.lnum = l:base_line + a:line_shift
  endif

  let l:action = s:issue_effective_action(l:shifted)
  if has_key(l:action, 'range') && type(l:action.range) == v:t_dict
    if has_key(l:action.range, 'start') && type(l:action.range.start) == v:t_dict
      let l:action.range.start.line = get(l:action.range.start, 'line', 0) + a:line_shift
    endif
    if has_key(l:action.range, 'end') && type(l:action.range.end) == v:t_dict
      let l:action.range.end.line = get(l:action.range.end, 'line', 0) + a:line_shift
    endif
  endif
  let l:shifted.action = l:action
  return l:shifted
endfunction

function! s:issue_line_delta(item) abort
  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  if l:op ==# 'write_file' || l:op ==# 'run_command'
    return 0
  endif

  let l:snippet = get(a:item, 'snippet', '')
  let l:snippet_lines = s:split_snippet_lines(l:snippet)
  if l:op ==# 'insert_before' || l:op ==# 'insert_after'
    return len(l:snippet_lines)
  endif

  if l:op ==# 'delete_line'
    return -1
  endif

  if l:op ==# 'replace_line'
    let l:replaced_lines = 1
    if has_key(l:action, 'range') && type(l:action.range) == v:t_dict
      let l:start_line = get(get(l:action, 'range', {}), 'start', {})
      let l:end_line = get(get(l:action, 'range', {}), 'end', {})
      if type(l:start_line) == v:t_dict && type(l:end_line) == v:t_dict
        let l:replaced_lines = (get(l:end_line, 'line', 0) - get(l:start_line, 'line', 0)) + 1
      endif
    endif
    return len(l:snippet_lines) - max([1, l:replaced_lines])
  endif

  return 0
endfunction

function! s:issue_shift_adjustment(item) abort
  let l:delta = s:issue_line_delta(a:item)
  if l:delta == 0
    return {}
  endif

  let l:action = s:issue_effective_action(a:item)
  let l:op = get(l:action, 'op', '')
  return {
        \ 'line': get(a:item, 'lnum', 0),
        \ 'delta': l:delta,
        \ 'inclusive': index(['insert_before', 'replace_line'], l:op) != -1,
        \ }
endfunction

function! s:drop_stale_candidates_after_delete_line(state, item) abort
  let l:action = s:issue_effective_action(a:item)
  if get(l:action, 'op', '') !=# 'delete_line'
    return a:state
  endif

  let l:deleted_line = get(a:item, 'lnum', 0)
  if l:deleted_line <= 0 || empty(get(a:state, 'candidates', []))
    return a:state
  endif

  let l:remaining = []
  for l:candidate in get(a:state, 'candidates', [])
    if get(l:candidate, 'lnum', 0) == l:deleted_line
      continue
    endif
    call add(l:remaining, l:candidate)
  endfor
  let a:state.candidates = l:remaining
  return a:state
endfunction

function! s:cumulative_line_shift(origin_line, adjustments) abort
  let l:origin_line = max([0, a:origin_line])
  let l:shift = 0
  for l:adjustment in a:adjustments
    if type(l:adjustment) != v:t_dict
      continue
    endif
    let l:line = get(l:adjustment, 'line', 0)
    if l:origin_line > l:line || (get(l:adjustment, 'inclusive', v:false) && l:origin_line == l:line)
      let l:shift += get(l:adjustment, 'delta', 0)
    endif
  endfor
  return l:shift
endfunction

function! s:compare_fix_order(entry_a, entry_b) abort
  let l:kind_a = get(a:entry_a, 'kind', '')
  let l:kind_b = get(a:entry_b, 'kind', '')
  let l:priority_a = get(a:entry_a, 'autofixPriority', s:issue_fix_priority(l:kind_a))
  let l:priority_b = get(a:entry_b, 'autofixPriority', s:issue_fix_priority(l:kind_b))

  if l:priority_a != l:priority_b
    return l:priority_a < l:priority_b ? -1 : 1
  endif

  let l:lnum_a = get(a:entry_a, 'lnum', 0)
  let l:lnum_b = get(a:entry_b, 'lnum', 0)
  if l:lnum_a != l:lnum_b
    return l:lnum_a < l:lnum_b ? 1 : -1
  endif

  return 0
endfunction

function! s:realtime_dev_agent_drain_pending_auto_fixes() abort
  if mode() =~# '^i'
    return
  endif

  if empty(s:realtime_dev_agent_pending_auto_fixes)
    return
  endif

  let l:items = copy(s:realtime_dev_agent_pending_auto_fixes)
  let s:realtime_dev_agent_pending_auto_fixes = []

  let l:file = fnamemodify(bufname('%'), ':p')
  call s:realtime_dev_agent_apply_auto_fixes(l:items, l:file, {
        \ 'bufnr': bufnr('%'),
        \ 'open_qf': g:realtime_dev_agent_realtime_open_qf,
        \ 'show_echo': 0,
        \ 'realtime_mode': v:true,
        \ })
endfunction

function! s:realtime_dev_agent_schedule_check(...) abort
  if !g:realtime_dev_agent_realtime_on_change || !has('timers')
    return
  endif

  if s:realtime_dev_agent_auto_fix_busy
    return
  endif

  let l:bufnr = bufnr('%')
  if l:bufnr <= 0 || !bufloaded(l:bufnr)
    return
  endif

  let l:file = fnamemodify(bufname(l:bufnr), ':p')
  if empty(l:file) || !s:should_check_file(l:file)
    return
  endif
  if !s:should_run_auto_check(l:bufnr)
    return
  endif

  let l:reason = a:0 > 0 ? a:1 : 'change'
  if l:reason ==# 'cursor_context'
    let l:context_key = s:current_cursor_context_key(l:bufnr)
    if l:context_key ==# s:realtime_dev_agent_last_cursor_context_key
      return
    endif
    let s:realtime_dev_agent_last_cursor_context_key = l:context_key
  elseif l:reason ==# 'change' || l:reason ==# 'buffer_load'
    let s:realtime_dev_agent_last_cursor_context_key = ''
  endif

  let s:realtime_dev_agent_realtime_pending_buf = l:bufnr

  if s:realtime_dev_agent_realtime_timer != -1
    call timer_stop(s:realtime_dev_agent_realtime_timer)
  endif

  let l:delay = g:realtime_dev_agent_realtime_delay
  if type(l:delay) != v:t_number
    let l:delay = str2nr(string(l:delay))
  endif
  if l:delay < 200
    let l:delay = 200
  endif
  let s:realtime_dev_agent_realtime_timer = timer_start(l:delay, function('RealtimeDevAgentRunPendingCheck'))
endfunction

function! RealtimeDevAgentRunPendingCheck(timer_id) abort
  call s:realtime_dev_agent_run_pending_check(a:timer_id)
endfunction

function! s:realtime_dev_agent_run_pending_check(timer_id) abort
  let l:bufnr = s:realtime_dev_agent_realtime_pending_buf
  let s:realtime_dev_agent_realtime_pending_buf = -1
  let s:realtime_dev_agent_realtime_timer = -1

  if l:bufnr <= 0 || !bufloaded(l:bufnr)
    return
  endif
  if !s:should_run_auto_check(l:bufnr)
    return
  endif

  let l:analysis_mode = s:analysis_mode_for_request(v:true)
  call s:start_async_realtime_check_with_fallback(l:bufnr, g:realtime_dev_agent_realtime_open_qf, 0, l:analysis_mode, v:true)
endfunction

function! s:window_refresh(file, qf) abort
  if !g:realtime_dev_agent_show_window
    return
  endif

  call s:window_open()

  let l:lines = []
  if type(l:lines) != v:t_list
    let l:lines = []
  endif
  call add(l:lines, 'Realtime Dev Agent')
  call add(l:lines, 'Arquivo: ' . a:file)
  call add(l:lines, '')

  if empty(a:qf)
    call add(l:lines, '[OK] Sem sugestoes encontradas')
    call s:window_set_lines(l:lines)
    return
  endif

  call add(l:lines, 'Total de sugestoes: ' . len(a:qf))
  call add(l:lines, '')
  let l:index = 0
  for l:item in a:qf
    let l:index = l:index + 1
    let l:qf_parts = s:issue_parse_parts(l:item.text)
    let l:severity = l:qf_parts[0]
    let l:message = l:qf_parts[1]
    let l:suggestion = l:qf_parts[2]
    let l:item_snippet = get(l:item, 'snippet', '')
    let l:qf_line = printf('[%d] %s:%d:%d', l:index, fnamemodify(l:item.filename, ':t'), l:item.lnum, l:item.col)
    call add(l:lines, l:qf_line)
    if !empty(l:severity)
      call add(l:lines, '    Tipo: ' . l:severity)
    endif
    call add(l:lines, '    Problema: ' . l:message)
    if !empty(l:suggestion)
      call add(l:lines, '    Acao: ' . l:suggestion)
    endif
    if !empty(l:item_snippet)
      call add(l:lines, '    Snippet:')
      for l:snippet_line in s:split_snippet_lines(l:item_snippet)
        call add(l:lines, '        ' . l:snippet_line)
      endfor
    endif
    call add(l:lines, '')
  endfor
  let s:realtime_dev_agent_last_qf = a:qf
  call add(l:lines, '')
  let l:command_line = 'Painel Realtime Dev Agent: ' . g:realtime_dev_agent_window_key . ' para abrir/atualizar'
  let l:command_line = l:command_line . ' | <Tab>/i/a: aplicar | Enter: ir para item | f: follow-up | r: reanalisar | q: fechar'
  call add(l:lines, l:command_line)
  call s:window_set_lines(l:lines)
endfunction

function! s:extract_issue_text(raw) abort
  let l:text = a:raw
  let l:snippet_marker = stridx(l:text, ' || SNIPPET:')
  if l:snippet_marker >= 0
    let l:text = strpart(l:text, 0, l:snippet_marker)
  endif
  let l:action_marker = stridx(l:text, ' || ACTION:')
  if l:action_marker >= 0
    let l:text = strpart(l:text, 0, l:action_marker)
  endif
  return l:text
endfunction

function! s:extract_issue_action(raw) abort
  let l:marker = ' || ACTION:'
  let l:start = stridx(a:raw, l:marker)
  if l:start < 0
    return {}
  endif
  let l:payload = strpart(a:raw, l:start + strlen(l:marker))
  let l:snippet_marker = stridx(l:payload, ' || SNIPPET:')
  if l:snippet_marker >= 0
    let l:payload = strpart(l:payload, 0, l:snippet_marker)
  endif
  try
    return json_decode(trim(l:payload))
  catch
    return {}
  endtry
endfunction

function! s:extract_issue_kind(raw) abort
  let l:match = matchlist(a:raw, '\v^\[[^]]+\]\s+([a-z_]+):')
  if empty(l:match)
    return ''
  endif
  return l:match[1]
endfunction

function! s:extract_issue_snippet(raw) abort
  let l:match = matchlist(a:raw, '\v^.*\s\|\|\sSNIPPET:(.*)$')
  if empty(l:match)
    return ''
  endif

  let l:snippet = substitute(l:match[1], '\s\+$', '', '')
  let l:snippet = substitute(l:snippet, '\\\\', '__REALTIME_DEV_AGENT_BACKSLASH__', 'g')
  let l:snippet_parts = split(l:snippet, '\\n', 1)
  let l:snippet_parts = map(l:snippet_parts, {_, val -> substitute(val, '__REALTIME_DEV_AGENT_BACKSLASH__', '\\', 'g')})
  let l:snippet = join(l:snippet_parts, "\n")
  let l:snippet = substitute(l:snippet, '__REALTIME_DEV_AGENT_BACKSLASH__', '\\', 'g')
  return l:snippet
endfunction

function! s:realtime_dev_agent_check() abort
  let l:bufnr = bufnr('%')
  let l:analysis_mode = s:analysis_mode_for_request(v:false)
  let l:prev_show_window = g:realtime_dev_agent_show_window
  let l:prev_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let g:realtime_dev_agent_show_window = 0
  let s:realtime_dev_agent_is_realtime_check = v:false
  call s:stop_async_analysis_job()
  try
    call s:start_async_realtime_check_with_fallback(l:bufnr, g:realtime_dev_agent_open_qf, 1, l:analysis_mode, v:false)
  finally
    call s:realtime_dev_agent_restore_show_window(l:prev_show_window)
    let s:realtime_dev_agent_is_realtime_check = l:prev_mode
  endtry
endfunction

function! s:realtime_dev_agent_window_check() abort
  let l:bufnr = bufnr('%')
  let l:analysis_mode = s:analysis_mode_for_request(v:false)
  let l:prev_mode = get(s:, 'realtime_dev_agent_is_realtime_check', v:false)
  let g:realtime_dev_agent_show_window = 1
  let s:realtime_dev_agent_is_realtime_check = v:false
  call s:stop_async_analysis_job()
  try
    call s:start_async_realtime_check_with_fallback(l:bufnr, 0, 1, l:analysis_mode, v:false)
  finally
    let s:realtime_dev_agent_is_realtime_check = l:prev_mode
  endtry
endfunction

function! s:set_global_normal_map(lhs, rhs, desc) abort
  if empty(a:lhs) || empty(a:rhs)
    return
  endif

  if has('nvim') && exists('*nvim_set_keymap')
    try
      call nvim_set_keymap('n', a:lhs, a:rhs, {
            \ 'noremap': v:true,
            \ 'silent': v:true,
            \ 'desc': a:desc,
            \ })
      return
    catch
      " Fallback para map tradicional quando a API de desc nao estiver disponível.
    endtry
  endif

  execute 'nnoremap <silent> ' . a:lhs . ' ' . a:rhs
endfunction

command! RealtimeDevAgentCheck call s:realtime_dev_agent_check()
command! RealtimeDevAgentWindowCheck call s:realtime_dev_agent_window_check()
command! RealtimeDevAgentWindowClose call s:window_close()
command! RealtimeDevAgentWindowToggle call s:window_toggle()
command! RealtimeDevAgentAutoFixEnable let g:realtime_dev_agent_auto_fix_enabled = 1 | echomsg '[RealtimeDevAgent] Auto-fix ligado'
command! RealtimeDevAgentAutoFixDisable let g:realtime_dev_agent_auto_fix_enabled = 0 | echomsg '[RealtimeDevAgent] Auto-fix desligado'

if !empty(g:realtime_dev_agent_map_key)
  " Atalho de analise rapida do arquivo atual.
  call s:set_global_normal_map(
        \ g:realtime_dev_agent_map_key,
        \ ':RealtimeDevAgentCheck<CR>',
        \ 'Pingu: analisar arquivo atual',
        \ )
endif

if !empty(g:realtime_dev_agent_window_key)
  " Atalho para executar analise no modo janela de interacao em tempo real.
  call s:set_global_normal_map(
        \ g:realtime_dev_agent_window_key,
        \ ':RealtimeDevAgentWindowCheck<CR>',
        \ 'Pingu: abrir painel e analisar',
        \ )
endif

if g:realtime_dev_agent_start_on_editor_enter
  augroup realtime_dev_agent_startup
    autocmd!
    autocmd VimEnter,BufEnter * call s:realtime_dev_agent_start_current_buffer()
  augroup END
endif

augroup realtime_dev_agent_code_buffer_maps
  autocmd!
  autocmd BufEnter * call s:set_code_buffer_tab_accept()
augroup END

augroup realtime_dev_agent_runtime_cleanup
  autocmd!
  autocmd VimLeavePre * call s:stop_async_analysis_job() | call s:stop_analysis_daemon()
augroup END

augroup realtime_dev_agent_open_review
  autocmd!
  autocmd BufReadPost,BufNewFile * if g:realtime_dev_agent_review_on_open | call s:realtime_dev_agent_open_review() | endif
augroup END

if g:realtime_dev_agent_auto_on_save
  " Auto check no save para acelerar a captura de problemas de rotina.
  augroup realtime_dev_agent
    autocmd!
    autocmd BufWritePost * call s:realtime_dev_agent_check()
  augroup END
endif

if g:realtime_dev_agent_realtime_on_change
  " Checagem em tempo real com debounce enquanto edita texto.
  augroup realtime_dev_agent_realtime
    autocmd!
    if get(g:, 'realtime_dev_agent_realtime_on_buffer_load', 1)
      autocmd BufReadPost,BufNewFile * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_schedule_check('buffer_load') | endif
    endif
    autocmd TextChanged * call s:realtime_dev_agent_schedule_check()
    if get(g:, 'realtime_dev_agent_realtime_insert_mode', 0)
      autocmd TextChangedI * call s:realtime_dev_agent_schedule_check()
    endif
    if has('nvim') && exists('##DiagnosticChanged')
      autocmd DiagnosticChanged * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_schedule_check('lsp_diagnostic') | endif
    endif
    autocmd InsertLeave * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_drain_pending_auto_fixes() | call s:realtime_dev_agent_schedule_check() | endif
    if get(g:, 'realtime_dev_agent_realtime_on_cursor_hold', 1)
      autocmd CursorHold * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_schedule_check('cursor_context') | endif
    endif
    if get(g:, 'realtime_dev_agent_realtime_on_buf_enter', 1)
      autocmd BufEnter * if g:realtime_dev_agent_realtime_on_change | call s:realtime_dev_agent_schedule_check('cursor_context') | endif
    endif
  augroup END
endif

call s:set_code_buffer_tab_accept()
