'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { resolveCliTargetFiles } = require('../lib/cli-targets');

const root = path.join(__dirname, '..');
const internalRuntime = fs.readFileSync(
  path.join(root, 'vim/autoload/realtime_dev_agent/internal.vim'),
  'utf8',
);
const pluginRuntime = fs.readFileSync(
  path.join(root, 'vim/plugin/realtime_dev_agent.vim'),
  'utf8',
);

function commandExists(command) {
  const result = spawnSync('sh', ['-lc', `command -v ${shellQuote(command)}`], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value || '').replace(/'/g, `'\\''`)}'`;
}

function vimString(value) {
  return `'${String(value || '').replace(/'/g, "''")}'`;
}

test('runtime realtime limita comentarios automaticos ao contexto do cursor', () => {
  assert.match(pluginRuntime, /pingu_realtime_doc_cursor_context_only/);
  assert.match(pluginRuntime, /let g:pingu_realtime_doc_cursor_context_only = 1/);
  assert.match(internalRuntime, /function! s:realtime_doc_cursor_context_only\(\) abort/);
  assert.match(
    internalRuntime,
    /select_auto_fix_candidates_by_scope\(l:auto_candidates, l:target_buf, l:force_documentation_context\)/,
  );
  assert.match(
    internalRuntime,
    /limit_cursor_context_auto_fix_candidates\(l:auto_candidates, l:target_buf, l:force_documentation_context\)/,
  );
});

test('runtime LazyVim usa defaults leves para preservar responsividade', () => {
  assert.match(pluginRuntime, /let g:pingu_realtime_on_cursor_hold = 0/);
  assert.match(pluginRuntime, /let g:pingu_realtime_on_buf_enter = 0/);
  assert.match(pluginRuntime, /let g:pingu_realtime_insert_mode = 0/);
  assert.match(pluginRuntime, /let g:pingu_auto_fix_enabled = 0/);
  assert.match(pluginRuntime, /let g:pingu_lsp_auto_fix_enabled = 0/);
  assert.match(pluginRuntime, /let g:pingu_lsp_ai_fix_enabled = 0/);
  assert.match(pluginRuntime, /let g:pingu_auto_check_max_lines = 600/);
  assert.match(pluginRuntime, /let g:pingu_realtime_delay = 900/);
  assert.match(pluginRuntime, /let g:pingu_auto_fix_strict_validation = has\('nvim'\) \? 0 : 1/);
});

test('runtime usa somente variaveis globais g:pingu_*', () => {
  assert.match(pluginRuntime, /let g:pingu_realtime_on_change = 1/);
  assert.match(pluginRuntime, /let g:pingu_start_on_editor_enter = 1/);
  assert.doesNotMatch(pluginRuntime, /g:realtime_dev_agent_/);
});

test('runtime registra telemetria local opcional de latencia', () => {
  assert.match(pluginRuntime, /pingu_latency_metrics_enabled/);
  assert.match(pluginRuntime, /let g:pingu_latency_metrics_enabled = 0/);
  assert.match(pluginRuntime, /let g:pingu_latency_metrics_max_entries = 50/);
  assert.match(internalRuntime, /function! s:record_latency_metric\(metric\) abort/);
  assert.match(internalRuntime, /function! s:print_latency_metrics\(\) abort/);
  assert.match(internalRuntime, /command! PinguLatencyMetrics call s:print_latency_metrics\(\)/);
  assert.match(internalRuntime, /'source': 'daemon'/);
  assert.match(internalRuntime, /'source': 'job'/);
  assert.match(internalRuntime, /'source': 'sync'/);
});

test('runtime expoe indicador Pingu para statusline', () => {
  assert.match(pluginRuntime, /let g:pingu_statusline_enabled = 1/);
  assert.match(pluginRuntime, /let g:pingu_statusline_icon = ''/);
  assert.match(pluginRuntime, /let g:pingu_statusline_auto = 0/);
  assert.match(internalRuntime, /function! PinguStatusline\(\) abort/);
  assert.match(internalRuntime, /function! s:install_statusline_component\(\) abort/);
  assert.match(internalRuntime, /function! s:install_neovim_lualine_global\(\) abort/);
  assert.match(internalRuntime, /PinguStatusline\(\)/);
  assert.match(internalRuntime, /Pingu\.\.\./);
  assert.match(internalRuntime, /call s:status_set_running\('auto-fix'\)/);
});

test('runtime descarta requests antigos do daemon para o mesmo buffer', () => {
  assert.match(internalRuntime, /function! s:drop_daemon_pending_requests_for_buffer\(bufnr\) abort/);
  assert.match(internalRuntime, /call s:drop_daemon_pending_requests_for_buffer\(a:bufnr\)/);
  assert.match(internalRuntime, /remove\(s:realtime_dev_agent_daemon_pending, l:request_id\)/);
});

test('runtime expõe comandos Pingu sem aliases legados', () => {
  assert.match(internalRuntime, /command! PinguCheck call s:realtime_dev_agent_check\(\)/);
  assert.match(internalRuntime, /command! PinguWindowCheck call s:realtime_dev_agent_window_check\(\)/);
  assert.match(internalRuntime, /command! PinguHintsRefresh call s:update_pingu_hints_current_buffer\(\)/);
  assert.match(internalRuntime, /command! PinguAutoFixNow call s:pingu_auto_fix_now\(\)/);
  assert.match(internalRuntime, /command! PinguFixCurrent call s:pingu_fix_current_issue\(\)/);
  assert.match(internalRuntime, /command! PinguStop call s:pingu_stop\(\)/);
  assert.match(internalRuntime, /command! -bang PinguUndoFix call s:undo_last_pingu_fix\(<bang>0\)/);
  assert.doesNotMatch(internalRuntime, /command! RealtimeDevAgent/);
  assert.match(internalRuntime, /':PinguCheck<CR>'/);
  assert.match(internalRuntime, /':PinguWindowCheck<CR>'/);
});

test('runtime usa namespace semantico de atalhos pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_map_key = '<leader>pic'/);
  assert.match(pluginRuntime, /let g:pingu_window_key = '<leader>pia'/);
  assert.match(pluginRuntime, /let g:pingu_prompt_key = '<leader>pip'/);
  assert.match(pluginRuntime, /let g:pingu_prompt_context_radius = 80/);
  assert.match(pluginRuntime, /let g:pingu_fix_current_key = '<leader>pif'/);
  assert.match(pluginRuntime, /let g:pingu_stop_key = '<leader>pis'/);
});

test('runtime permite corrigir somente a issue da linha atual', () => {
  assert.match(pluginRuntime, /let g:pingu_fix_current_key = '<leader>pif'/);
  assert.match(internalRuntime, /function! s:pingu_fix_current_issue\(\) abort/);
  assert.match(internalRuntime, /s:get_buffer_issue_at_cursor\(\)/);
  assert.match(internalRuntime, /s:issue_has_applicable_fix\(l:issue\)/);
  assert.match(internalRuntime, /':PinguFixCurrent<CR>'/);
});

test('runtime permite interromper processamento ativo do Pingu', () => {
  assert.match(internalRuntime, /function! s:pingu_stop\(\) abort/);
  assert.match(internalRuntime, /s:stop_async_analysis_job\(\)/);
  assert.match(internalRuntime, /s:stop_pingu_prompt_job\(\)/);
  assert.match(internalRuntime, /s:stop_analysis_daemon\(\)/);
  assert.match(internalRuntime, /s:stop_auto_fix_timer\(\)/);
  assert.match(internalRuntime, /':PinguStop<CR>'/);
});

test('runtime executa PinguPrompt de forma assincrona no Neovim', () => {
  assert.match(internalRuntime, /let s:pingu_prompt_job = -1/);
  assert.match(internalRuntime, /function! s:start_async_pingu_prompt\(argv, root, payload, context\) abort/);
  assert.match(internalRuntime, /jobstart\(l:command, \{/);
  assert.match(internalRuntime, /'on_stdout': function\('s:pingu_prompt_on_stdout'\)/);
  assert.match(internalRuntime, /'on_exit': function\('s:pingu_prompt_on_exit'\)/);
  assert.match(internalRuntime, /'contextRadius': str2nr\(string\(get\(g:, 'pingu_prompt_context_radius', 80\)\)\)/);
  assert.match(internalRuntime, /if s:start_async_pingu_prompt\(l:argv, l:root, l:stdin_payload, l:context\)/);
});

test('runtime mostra hints inline para prompts acionaveis do Pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_hints_enabled = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_hints_max_lines = 1200/);
  assert.match(internalRuntime, /function! s:pingu_hint_for_line\(line\) abort/);
  assert.match(internalRuntime, /nvim_buf_set_extmark/);
  assert.match(internalRuntime, /PinguHintCode/);
  assert.match(internalRuntime, /PinguHintContext/);
  assert.match(internalRuntime, /PinguHintTerminal/);
  assert.match(internalRuntime, /augroup pingu_hints/);
});

test('runtime mostra hints inline para diagnosticos encontrados pelo Pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_issue_hints_enabled = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_prefix = ''/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_priority = 10000/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_position = 'eol'/);
  assert.match(pluginRuntime, /let g:pingu_diagnostic_takeover = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_diagnostic_takeover_max_items = 80/);
  assert.match(internalRuntime, /function! s:update_pingu_issue_hints_for_buffer\(bufnr, qf\) abort/);
  assert.match(internalRuntime, /function! s:apply_pingu_diagnostic_takeover\(\) abort/);
  assert.match(internalRuntime, /function! s:merge_lsp_diagnostic_hint_items\(bufnr, file, qf\) abort/);
  assert.match(internalRuntime, /pingu_issue_hints/);
  assert.match(internalRuntime, /PinguIssueHintError/);
  assert.match(internalRuntime, /PinguIssueHintWarn/);
  assert.match(internalRuntime, /PinguIssueHintInfo/);
  assert.match(internalRuntime, /vim\.diagnostic\.config\(\{ virtual_text = false \}\)/);
  assert.match(internalRuntime, /augroup pingu_diagnostic_takeover/);
  assert.match(internalRuntime, /'priority': l:priority/);
  assert.match(internalRuntime, /let l:severity = empty\(l:parts\[0\]\) \? 'error' : l:parts\[0\]/);
  assert.match(internalRuntime, /printf\('%s Pingu %s: %s'/);
  assert.match(internalRuntime, /printf\(' \+%d', l:extra_count\)/);
  assert.match(internalRuntime, /call s:update_pingu_issue_hints_for_buffer\(a:bufnr, l:qf\)/);
});

test('runtime registra historico para rollback manual de auto-fix', () => {
  assert.match(pluginRuntime, /let g:pingu_undo_fix_history_max = 30/);
  assert.match(internalRuntime, /let s:realtime_dev_agent_fix_history = \{\}/);
  assert.match(internalRuntime, /function! s:capture_issue_fix_snapshot\(issue, source_file\) abort/);
  assert.match(internalRuntime, /function! s:undo_last_pingu_fix\(force\) abort/);
  assert.match(internalRuntime, /:PinguUndoFix!/);
});

test('runtime realtime guarda comentarios por identidade para evitar reaplicacao em loop', () => {
  assert.match(internalRuntime, /function! s:uses_realtime_loop_guard\(item\) abort/);
  assert.match(internalRuntime, /return s:is_documentation_issue\(a:item\)/);
  assert.match(internalRuntime, /function! s:issue_realtime_loop_guard_key\(item\) abort/);
  assert.match(internalRuntime, /let l:loop_guard_key = 'loop\|' \. s:issue_realtime_loop_guard_key\(l:item\)/);
  assert.match(internalRuntime, /let l:state\.fix_guard\[l:loop_guard_key\] = 1/);
});

test('runtime preserva o cursor semantico quando auto-fix insere linhas acima', { skip: !commandExists('nvim') }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vim-cursor-'));
  const sourceFile = path.join(tempDir, 'sample.py');
  const scriptFile = path.join(tempDir, 'cursor.vim');
  const outputFile = path.join(tempDir, 'result.json');
  const source = [
    'class Example:',
    '    def start(self, kind, args):',
    '        result = kind + args',
    '        return result',
    '',
  ].join('\n');
  fs.writeFileSync(sourceFile, source, 'utf8');
  fs.writeFileSync(scriptFile, [
    'set nomore',
    'set hidden',
    'let g:pingu_start_on_editor_enter = 0',
    'let g:pingu_open_window_on_start = 0',
    'let g:pingu_show_window = 0',
    'let g:pingu_review_on_open = 0',
    'let g:pingu_realtime_on_change = 0',
    'let g:pingu_realtime_on_buffer_load = 0',
    'let g:pingu_realtime_async = 0',
    'let g:pingu_non_blocking_mode = 0',
    'let g:pingu_auto_fix_enabled = 1',
    'let g:pingu_auto_fix_max_per_check = 1',
    "let g:pingu_auto_fix_kinds = ['function_doc']",
    `execute 'set runtimepath^=' . fnameescape(${vimString(root)})`,
    'runtime plugin/realtime_dev_agent.vim',
    `execute 'edit ' . fnameescape(${vimString(sourceFile)})`,
    'call cursor(3, 1)',
    'let b:before_line = line(".")',
    'let b:before_text = getline(".")',
    'silent PinguCheck',
    'sleep 500m',
    'let b:after_line = line(".")',
    'let b:after_text = getline(".")',
    `call writefile([json_encode({'beforeLine': b:before_line, 'beforeText': b:before_text, 'afterLine': b:after_line, 'afterText': b:after_text, 'lineCount': line('$'), 'currentLineText': getline(b:after_line)})], ${vimString(outputFile)})`,
    'quitall!',
    '',
  ].join('\n'), 'utf8');

  const result = spawnSync('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-S', scriptFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(payload.beforeText, '        result = kind + args');
  assert.equal(payload.afterText, payload.beforeText);
  assert.equal(payload.currentLineText, payload.beforeText);
  assert.ok(payload.lineCount >= source.trimEnd().split('\n').length);
});

test('runtime permite reverter a ultima correcao aplicada pelo Pingu', { skip: !commandExists('nvim') }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vim-undo-fix-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  const scriptFile = path.join(tempDir, 'undo-fix.vim');
  const outputFile = path.join(tempDir, 'result.json');
  const source = [
    'const value = 1   ',
    'console.log(value)',
    '',
  ].join('\n');
  fs.writeFileSync(sourceFile, source, 'utf8');
  fs.writeFileSync(scriptFile, [
    'set nomore',
    'set hidden',
    'let g:pingu_start_on_editor_enter = 0',
    'let g:pingu_open_window_on_start = 0',
    'let g:pingu_show_window = 0',
    'let g:pingu_review_on_open = 0',
    'let g:pingu_realtime_on_change = 0',
    'let g:pingu_realtime_on_buffer_load = 0',
    'let g:pingu_realtime_async = 0',
    'let g:pingu_non_blocking_mode = 0',
    'let g:pingu_auto_fix_enabled = 1',
    'let g:pingu_auto_fix_max_per_check = 1',
    "let g:pingu_auto_fix_kinds = ['trailing_whitespace']",
    `execute 'set runtimepath^=' . fnameescape(${vimString(root)})`,
    'runtime plugin/realtime_dev_agent.vim',
    `execute 'edit ' . fnameescape(${vimString(sourceFile)})`,
    'let b:before_line = getline(1)',
    'silent PinguCheck',
    'let l:fix_wait = 0',
    'while getline(1) ==# b:before_line && l:fix_wait < 30',
    '  sleep 100m',
    '  let l:fix_wait += 1',
    'endwhile',
    'let b:after_fix_line = getline(1)',
    'silent PinguUndoFix',
    'sleep 150m',
    'let b:after_undo_line = getline(1)',
    `call writefile([json_encode({'beforeLine': b:before_line, 'afterFixLine': b:after_fix_line, 'afterUndoLine': b:after_undo_line})], ${vimString(outputFile)})`,
    'quitall!',
    '',
  ].join('\n'), 'utf8');

  const result = spawnSync('nvim', ['--headless', '-u', 'NONE', '-i', 'NONE', '-S', scriptFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20000,
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
  assert.equal(payload.beforeLine, 'const value = 1   ');
  assert.ok(
    ['const value = 1', 'const value = 1   '].includes(payload.afterFixLine),
    `afterFixLine inesperado: ${payload.afterFixLine}`,
  );
  assert.equal(payload.afterUndoLine, payload.beforeLine);
});

test('runtime evita segunda rodada automatica logo apos aplicar um lote', () => {
  assert.match(internalRuntime, /realtime_dev_agent_suppress_auto_fix_once = v:false/);
  assert.match(internalRuntime, /let l:suppress_auto_fix = s:realtime_dev_agent_suppress_auto_fix_once/);
  assert.match(internalRuntime, /g:pingu_auto_fix_enabled && !l:suppress_auto_fix/);
  assert.match(internalRuntime, /let s:realtime_dev_agent_suppress_auto_fix_once = v:true/);
});

test('runtime compensa deslocamento visual quando auto-fix insere linhas', () => {
  assert.match(internalRuntime, /\\ 'line_adjustments': \[\]/);
  assert.match(internalRuntime, /function! s:shift_saved_view_for_adjustments\(view, adjustments\) abort/);
  assert.match(internalRuntime, /let l:shift \+= get\(l:adjustment, 'delta', 0\)/);
  assert.match(internalRuntime, /call winrestview\(s:shift_saved_view_for_adjustments\(l:view, get\(l:context, 'line_adjustments', \[\]\)\)\)/);
  assert.match(internalRuntime, /call add\(l:state\.line_adjustments, l:adjustment\)/);
});

test('runtime ignora ambientes Python e dependencias por padrao', () => {
  ['.venv/', 'venv/', '__pycache__/', 'site-packages/', '.mypy_cache/', '.pytest_cache/'].forEach((pattern) => {
    assert.match(pluginRuntime, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

test('runtime cria fallback Copilot para warnings do LSP sem code action', () => {
  assert.match(pluginRuntime, /pingu_lsp_ai_fix_enabled/);
  assert.match(pluginRuntime, /pingu_lsp_ai_fix_severities = \['warning'\]/);
  assert.match(internalRuntime, /function! s:lsp_ai_fix_enabled\(\) abort/);
  assert.match(internalRuntime, /function! s:apply_issue_lsp_ai_fix\(issue\) abort/);
  assert.match(internalRuntime, /'kind': 'lsp_ai_fix'/);
  assert.match(internalRuntime, /'op': 'lsp_ai_fix'/);
  assert.match(internalRuntime, /'--lsp-ai-fix'/);
  assert.match(internalRuntime, /index\(\['lsp_code_action', 'lsp_ai_fix'\], l:item_kind\)/);
});

test('runtime descarta auto-fix pendente quando insert mode altera o buffer', () => {
  assert.match(internalRuntime, /'changedtick': getbufvar\(l:target_buf, 'changedtick', -1\)/);
  assert.match(internalRuntime, /let l:pending_tick = get\(l:pending, 'changedtick', -1\)/);
  assert.match(internalRuntime, /getbufvar\(l:target_buf, 'changedtick', -1\) !=# l:pending_tick/);
  assert.match(internalRuntime, /return\n\s*endif\n\n  let l:items = get\(l:pending, 'items', \[\]\)/);
});

test('CLI ignora ambientes Python e dependencias ao varrer diretorios', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cli-ignore-'));
  fs.mkdirSync(path.join(tempDir, 'app'), { recursive: true });
  fs.mkdirSync(path.join(tempDir, '.venv', 'lib', 'python3.14', 'site-packages', 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'app', 'main.py'), 'def run():\n    return 1\n', 'utf8');
  fs.writeFileSync(
    path.join(tempDir, '.venv', 'lib', 'python3.14', 'site-packages', 'pkg', 'ignored.py'),
    'def vendor():\n    return 1\n',
    'utf8',
  );

  const files = resolveCliTargetFiles([tempDir]);

  assert.deepEqual(files.map((file) => path.relative(tempDir, file)), [path.join('app', 'main.py')]);
});
