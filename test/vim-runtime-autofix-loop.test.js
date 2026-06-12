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
  path.join(root, 'vim/autoload/pingu_dev_agent/internal.vim'),
  'utf8',
);
const pluginRuntime = fs.readFileSync(
  path.join(root, 'vim/plugin/pingu_dev_agent.vim'),
  'utf8',
);
const diagnosticManagerRuntime = fs.readFileSync(
  path.join(root, 'vim/plugin/00_pingu_diagnostic_manager.lua'),
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
  assert.doesNotMatch(pluginRuntime, /g:pingu_dev_agent_/);
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
  assert.match(internalRuntime, /rawset\(_G, "PinguStatusline", function\(\) return vim\.fn\.PinguStatusline\(\) end\) return true/);
  assert.match(internalRuntime, /PinguStatusline\(\)/);
  assert.match(internalRuntime, /Pingu\.\.\./);
  assert.match(internalRuntime, /call s:status_set_running\('auto-fix'\)/);
});

test('runtime descarta requests antigos do daemon para o mesmo buffer', () => {
  assert.match(internalRuntime, /function! s:drop_daemon_pending_requests_for_buffer\(bufnr\) abort/);
  assert.match(internalRuntime, /call s:drop_daemon_pending_requests_for_buffer\(a:bufnr\)/);
  assert.match(internalRuntime, /remove\(s:pingu_dev_agent_daemon_pending, l:request_id\)/);
});

test('runtime expõe comandos Pingu sem aliases legados', () => {
  assert.match(internalRuntime, /command! PinguCheck call s:pingu_dev_agent_check\(\)/);
  assert.match(internalRuntime, /command! PinguWindowCheck call s:pingu_dev_agent_window_check\(\)/);
  assert.match(internalRuntime, /command! PinguHintsRefresh call s:update_pingu_all_hints_current_buffer\(\)/);
  assert.match(internalRuntime, /command! PinguAutoFixNow call s:pingu_auto_fix_now\(\)/);
  assert.match(internalRuntime, /command! PinguFixCurrent call s:pingu_fix_current_issue\(\)/);
  assert.match(internalRuntime, /command! PinguFixCurrentAI call s:pingu_fix_current_issue_with_ai\(\)/);
  assert.match(internalRuntime, /command! PinguIssueHoverClose call s:pingu_issue_hover_close_and_restore\(\)/);
  assert.match(internalRuntime, /command! PinguQfNext call s:pingu_qf_next\(\)/);
  assert.match(internalRuntime, /command! PinguQfPrev call s:pingu_qf_prev\(\)/);
  assert.match(internalRuntime, /command! PinguDiagnosticNext call s:pingu_qf_next\(\)/);
  assert.match(internalRuntime, /command! PinguDiagnosticPrev call s:pingu_qf_prev\(\)/);
  assert.match(internalRuntime, /command! PinguHover call s:pingu_lsp_hover\(\)/);
  assert.match(internalRuntime, /command! PinguFinder call s:pingu_lsp_finder\(\)/);
  assert.match(internalRuntime, /command! PinguDefinition call s:pingu_lsp_definition\(\)/);
  assert.match(internalRuntime, /command! PinguReferences call s:pingu_lsp_references\(\)/);
  assert.match(internalRuntime, /command! PinguOutline call s:pingu_lsp_outline\(\)/);
  assert.match(internalRuntime, /command! -nargs=\? PinguRename call s:pingu_lsp_rename\(<q-args>\)/);
  assert.match(internalRuntime, /command! PinguCodeAction call s:pingu_lsp_code_action\(\)/);
  assert.match(internalRuntime, /function! s:pingu_issue_lines_for_current_buffer\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_jump_to_issue\(direction\) abort/);
  assert.match(internalRuntime, /call cursor\(l:lnum, l:col\)/);
  assert.match(internalRuntime, /normal! zv/);
  assert.match(internalRuntime, /call s:pingu_show_issue_hover_action_hint\(\)/);
  assert.match(internalRuntime, /win_gotoid\(l:source_winid\)/);
  assert.match(internalRuntime, /command! PinguStop call s:pingu_stop\(\)/);
  assert.match(internalRuntime, /command! -bang PinguUndoFix call s:undo_last_pingu_fix\(<bang>0\)/);
  assert.match(internalRuntime, /command! PinguLogs call s:pingu_logs_open\(\)/);
  assert.match(internalRuntime, /command! PinguLogsClear call s:pingu_logs_clear\(\)/);
  assert.doesNotMatch(internalRuntime, /command! PinguDevAgent/);
  assert.match(internalRuntime, /':PinguCheck<CR>'/);
  assert.match(internalRuntime, /':PinguWindowCheck<CR>'/);
});

test('runtime mantém histórico de logs operacionais do Pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_logs_max_entries = 200/);
  assert.match(internalRuntime, /let s:pingu_logs = \[\]/);
  assert.match(internalRuntime, /function! s:pingu_log_event\(level, source, message, \.\.\.\) abort/);
  assert.match(internalRuntime, /function! s:pingu_log_lines\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_logs_open\(\) abort/);
  assert.match(internalRuntime, /file pingu:\/\/logs/);
  assert.match(internalRuntime, /nnoremap <silent> <buffer> r :call <SID>pingu_logs_refresh\(\)<CR>/);
  assert.match(internalRuntime, /function! s:pingu_logs_clear\(\) abort/);
  assert.match(internalRuntime, /call s:pingu_log_event\('error', 'status', a:error/);
  assert.match(internalRuntime, /call s:pingu_log_event\('error', 'lsp-hover', v:exception/);
});

test('runtime expõe substitutos Pingu para fluxos do lspsaga', () => {
  assert.match(internalRuntime, /function! s:pingu_lsp_hover\(\) abort/);
  assert.match(pluginRuntime, /let g:pingu_lsp_ui = 'float'/);
  assert.match(internalRuntime, /function! s:pingu_lsp_ui_mode\(\) abort/);
  assert.match(internalRuntime, /function! s:define_pingu_lsp_ui_highlights\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_open_picker\(title, items\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_picker_apply\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_request_locations\(mode\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_set_qf\(title, items, jump_first\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_finder\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_definition\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_references\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_outline\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_rename\(name\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_code_action\(\) abort/);
  assert.match(internalRuntime, /vim\.lsp\.buf_request_sync\(bufnr, "textDocument\/hover"/);
  assert.match(internalRuntime, /textDocument\/definition/);
  assert.match(internalRuntime, /textDocument\/references/);
  assert.match(internalRuntime, /textDocument\/documentSymbol/);
  assert.match(internalRuntime, /vim\.lsp\.buf\.rename\(input\.name\)/);
  assert.match(internalRuntime, /call s:pingu_lsp_open_float\('Pingu Hover'/);
  assert.match(internalRuntime, /elseif s:pingu_lsp_open_picker\(a:title, a:items\)/);
  assert.match(internalRuntime, /Enter\/o abrir   q\/Esc fechar   quickfix sincronizado/);
  assert.match(internalRuntime, /PinguLspFloatTitle/);
  assert.match(internalRuntime, /call setqflist\(\[\], 'r', \{'title': a:title\}\)/);
});

test('runtime mostra hover de issue com layout limpo', () => {
  assert.match(internalRuntime, /function! s:pingu_issue_hover_menu_lines\(issue, \.\.\.\) abort/);
  assert.match(internalRuntime, /function! s:pingu_explain_issue_lines\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_show_issue_explain_in_hover\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_function_context_at_cursor\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_function_internal_calls\(lines\) abort/);
  assert.match(internalRuntime, /function! s:pingu_function_effects\(lines\) abort/);
  assert.match(internalRuntime, /function! s:pingu_function_flow_signals\(lines\) abort/);
  assert.match(internalRuntime, /function! s:pingu_function_analysis_lines\(context\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_hover_diff_lines\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_open_function_hover_menu\(context\) abort/);
  assert.match(internalRuntime, /index\(\['if', 'for', 'while', 'switch', 'catch', 'with', 'else', 'elseif'\], tolower\(l:name\)\) != -1/);
  assert.match(internalRuntime, /function! s:pingu_issue_hover_action_summary\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_hover_assisted_suggestion\(issue\) abort/);
  assert.match(internalRuntime, /function! s:start_pingu_issue_hover_ai_suggestion\(issue, signature\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_hover_ai_suggestion_on_exit\(context, job_id, code, event\) abort/);
  assert.match(internalRuntime, /s:pingu_issue_hover_ai_suggestion_cache/);
  assert.match(internalRuntime, /function! s:pingu_generic_lsp_suggestion\(text\) abort/);
  assert.match(internalRuntime, /' Pingu'/);
  assert.match(internalRuntime, /Code action/);
  assert.match(internalRuntime, /Correcao com IA/);
  assert.match(internalRuntime, /let l:focus_menu = a:0 > 0 \? !!a:1 : v:false/);
  assert.match(internalRuntime, /if !l:focus_menu\n    return l:detail_lines\n  endif/);
  assert.match(internalRuntime, /Acoes manuais/);
  assert.match(internalRuntime, /a  Aplicar resolucao/);
  assert.match(internalRuntime, /i  Corrigir com provider/);
  assert.match(internalRuntime, /Enter\/clique executa apenas actions manuais/);
  assert.doesNotMatch(internalRuntime, /d  Preview diff da correcao/);
  assert.doesNotMatch(internalRuntime, /e  Explicar problema/);
  assert.doesNotMatch(internalRuntime, /:PinguIssueActions abre o modo interativo/);
  assert.match(internalRuntime, /Explicacao do problema/);
  assert.match(internalRuntime, /Funcao no cursor/);
  assert.match(internalRuntime, /Comportamento/);
  assert.match(internalRuntime, /Chamadas internas/);
  assert.match(internalRuntime, /Efeitos observaveis/);
  assert.match(internalRuntime, /Diff disponivel/);
  assert.match(internalRuntime, /function! s:pingu_issue_has_hover_diff\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_post_fix_diff_lines\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_show_post_fix_diff_lines\(lines\) abort/);
  assert.match(internalRuntime, /function! s:pingu_show_post_fix_diff\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_highlight_issue_hover_buffer\(bufnr\) abort/);
  assert.match(internalRuntime, /sem chamadas internas evidentes/);
  assert.match(internalRuntime, /cria ou atualiza UI\/buffer flutuante/);
  assert.match(internalRuntime, /orquestra processo, canal ou timer/);
  assert.match(internalRuntime, /Trecho/);
  assert.match(internalRuntime, /Importar .* de outro arquivo ou implementar .* localmente/);
  assert.match(internalRuntime, /Corrigir import, modulo ou dependencia faltante com a menor declaracao segura/);
  assert.match(internalRuntime, /Resolver simbolo ausente: importar, criar definicao ou ajustar o uso atual/);
  assert.match(internalRuntime, /Aplicar a menor edicao local para o diagnostico de /);
  assert.match(internalRuntime, /fixall\/organizeimports\/quickfix/);
  assert.match(internalRuntime, /Substituir a linha atual pelo snippet sugerido/);
  assert.match(internalRuntime, /Aplicar resolucao/);
  assert.match(internalRuntime, /Corrigir com provider/);
  assert.match(internalRuntime, /Desfazer ultima correcao/);
  assert.match(internalRuntime, /Abrir historico/);
  assert.match(internalRuntime, /Abrir painel/);
  assert.doesNotMatch(internalRuntime, /Pingu: ' \. l:message/);
  assert.doesNotMatch(internalRuntime, /lsp_code_action: %s/);
  assert.match(internalRuntime, /call s:start_pingu_issue_hover_ai_suggestion\(a:issue, l:signature\)/);
  assert.match(internalRuntime, /'--lsp-ai-fix'/);
  assert.match(internalRuntime, /let l:line_index = index\(getbufline\(l:bufnr, 1, '\$'\), 'Sugestao'\)/);
  assert.match(internalRuntime, /call nvim_buf_set_lines\(l:bufnr, l:line_index \+ 1, l:line_index \+ 2, v:false, \['  ' \. l:suggestion\]\)/);
  assert.match(internalRuntime, /let l:height = min\(\[24, len\(l:lines\)\]\)/);
  assert.match(internalRuntime, /let l:text = trim\(getline\('\.'\)\)/);
  assert.match(internalRuntime, /if l:text =~# '\^a\\s'\n    call s:pingu_issue_hover_action\('apply'\)/);
  assert.doesNotMatch(internalRuntime, /if l:text =~# '\^d\\s'\n    call s:pingu_issue_hover_action\('preview'\)/);
  assert.match(internalRuntime, /if l:text =~# '\^u\\s'\n    call s:pingu_issue_hover_action\('undo'\)/);
  assert.doesNotMatch(internalRuntime, /if a:action ==# 'explain'\n    call s:restore_pingu_issue_hover_source\(\)\n    call s:clear_pingu_issue_hover_source_maps\(\)/);
  assert.match(internalRuntime, /let l:post_fix_diff_lines = s:pingu_post_fix_diff_lines\(l:issue\)/);
  assert.match(internalRuntime, /call s:pingu_show_post_fix_diff_lines\(l:post_fix_diff_lines\)/);
  assert.match(internalRuntime, /let l:winid = get\(s:, 'pingu_issue_hover_menu_winid', -1\)/);
  assert.match(internalRuntime, /call nvim_buf_set_lines\(l:bufnr, 0, -1, v:false, l:lines\)/);
  assert.match(internalRuntime, /if empty\(l:issue\)\n    let l:issue = s:pingu_issue_at_cursor_for_action\(\)\n  endif/);
});

test('runtime mantem painel Pingu fechado apos fechamento manual', () => {
  assert.match(internalRuntime, /function! s:window_close\(\) abort\n  let g:pingu_show_window = 0/);
  assert.match(internalRuntime, /augroup pingu_window_state/);
  assert.match(internalRuntime, /autocmd BufWinLeave <buffer> let g:pingu_show_window = 0/);
  assert.match(internalRuntime, /function! s:window_refresh\(file, qf\) abort\n  if !g:pingu_show_window\n    return\n  endif/);
});

test('runtime usa namespace semantico de atalhos pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_map_key = '<leader>pic'/);
  assert.match(pluginRuntime, /let g:pingu_window_key = '<leader>piw'/);
  assert.match(pluginRuntime, /let g:pingu_help_key = '<leader>pi\?'/);
  assert.match(pluginRuntime, /let g:pingu_action_menu_key = '<leader>pia'/);
  assert.match(pluginRuntime, /let g:pingu_prompt_key = '<leader>pip'/);
  assert.match(pluginRuntime, /let g:pingu_prompt_terminal_command = empty\(\$PINGU_PROMPT_TERMINAL_COMMAND\) \? '' : \$PINGU_PROMPT_TERMINAL_COMMAND/);
  assert.match(pluginRuntime, /let g:pingu_model_key = '<leader>pim'/);
  assert.match(pluginRuntime, /let g:pingu_model_key_alias = ''/);
  assert.match(pluginRuntime, /let g:pingu_ai_provider = empty\(\$PINGU_AI_PROVIDER\) \? 'codex' : \$PINGU_AI_PROVIDER/);
  assert.match(pluginRuntime, /let g:pingu_ai_model = empty\(\$PINGU_AI_MODEL\) \? '' : \$PINGU_AI_MODEL/);
  assert.match(pluginRuntime, /let g:pingu_codex_models = \[/);
  assert.match(pluginRuntime, /let g:pingu_openai_models = \[/);
  assert.match(pluginRuntime, /let g:pingu_prompt_context_radius = 80/);
  assert.match(pluginRuntime, /let g:pingu_fix_current_key = '<leader>pif'/);
  assert.match(pluginRuntime, /let g:pingu_stop_key = '<leader>pis'/);
  assert.match(pluginRuntime, /let g:pingu_next_issue_key = '<C-j>'/);
  assert.match(pluginRuntime, /let g:pingu_prev_issue_key = '<C-k>'/);
  assert.match(pluginRuntime, /let g:pingu_issue_qf_open = 1/);
  assert.match(internalRuntime, /function! s:set_buffer_normal_map\(lhs, rhs, desc\) abort/);
  assert.match(internalRuntime, /nvim_buf_set_keymap\(0, 'n', a:lhs, a:rhs/);
  assert.match(internalRuntime, /call s:set_buffer_normal_map\(g:pingu_next_issue_key, ':PinguQfNext<CR>', 'Pingu: proximo diagnostico'\)/);
  assert.match(internalRuntime, /call s:set_buffer_normal_map\(g:pingu_prev_issue_key, ':PinguQfPrev<CR>', 'Pingu: diagnostico anterior'\)/);
  assert.match(internalRuntime, /g:pingu_action_menu_key,\n        \\ ':PinguIssueActions<CR>',\n        \\ 'Pingu: menu de acoes da issue atual'/);
});

test('runtime expoe ajuda rapida do Pingu no namespace leader pi', () => {
  assert.match(internalRuntime, /function! s:pingu_help_lines\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_help_open\(\) abort/);
  assert.match(internalRuntime, /command! PinguHelp call s:pingu_help_open\(\)/);
  assert.match(internalRuntime, /call s:pingu_lsp_open_float\('Pingu Help', s:pingu_help_lines\(\)\)/);
  assert.match(internalRuntime, /printf\('  %s  analisar arquivo atual', get\(g:, 'pingu_map_key', '<leader>pic'\)\)/);
  assert.match(internalRuntime, /printf\('  %s  abrir menu de acoes da issue atual', get\(g:, 'pingu_action_menu_key', '<leader>pia'\)\)/);
  assert.match(internalRuntime, /\/\/ @pingu code cria funcao soma/);
  assert.match(internalRuntime, /\/\/ @pingu terminal roda os testes unitarios/);
  assert.match(internalRuntime, /\/\/\* executa comando de terminal/);
  assert.match(internalRuntime, /':PinguHelp<CR>'/);
  assert.match(internalRuntime, /Pingu: ajuda rapida/);
});

test('runtime permite escolher provider assistido do Pingu', () => {
  assert.ok(internalRuntime.includes("function! s:pingu_ai_provider_env_value() abort\n  let l:provider = s:pingu_normalize_ai_provider(get(g:, 'pingu_ai_provider', empty($PINGU_AI_PROVIDER) ? 'codex' : $PINGU_AI_PROVIDER))\n  return l:provider"));
  assert.match(internalRuntime, /return \['copilot', 'openai', 'codex', 'claude', 'auto'\]/);
  assert.match(internalRuntime, /for l:provider in s:pingu_supported_ai_provider_overview\(\)/);
  assert.match(internalRuntime, /Providers disponiveis/);
  assert.match(internalRuntime, /s:pingu_provider_status_line\(l:provider\)/);
  assert.match(internalRuntime, /function! s:pingu_provider_confirm_label\(provider\) abort/);
  assert.match(internalRuntime, /return '&Copilot'/);
  assert.match(internalRuntime, /return '&OpenAI'/);
  assert.match(internalRuntime, /return 'Co&dex'/);
  assert.match(internalRuntime, /return 'C&laude'/);
  assert.match(internalRuntime, /let l:labels = \['Ca&ncelar'\]/);
  assert.match(internalRuntime, /function! s:pingu_select_provider_choice\(provider_options\) abort/);
  assert.match(internalRuntime, /return confirm\('Pingu provider', join\(l:labels, "\\n"\), 0\)/);
  assert.match(internalRuntime, /function! s:pingu_select_ai_provider\(\.\.\.\) abort/);
  assert.match(internalRuntime, /function! s:pingu_select_ai_model\(provider, \.\.\.\) abort/);
  assert.match(internalRuntime, /function! s:pingu_provider_model_list\(provider\) abort/);
  assert.match(internalRuntime, /function! s:pingu_apply_ai_provider_env\(\) abort/);
  assert.match(internalRuntime, /let \$PINGU_AI_PROVIDER = l:provider/);
  assert.match(internalRuntime, /let \$PINGU_AI_MODEL = l:model/);
  assert.match(internalRuntime, /let \$PINGU_CODEX_MODEL = l:model/);
  assert.match(internalRuntime, /let \$PINGU_CLAUDE_MODEL = l:model/);
  assert.match(internalRuntime, /let \$PINGU_OPENAI_MODEL = l:model/);
  assert.match(internalRuntime, /command! -nargs=\* PinguModel call s:pingu_select_ai_provider\(<q-args>\)/);
  assert.match(internalRuntime, /call s:stop_analysis_daemon\(\)/);
  assert.doesNotMatch(internalRuntime, /input\('Escolha provider \[1-' \. len\(l:provider_options\) \. '\]: '\)/);
  assert.match(internalRuntime, /Provider selecionado: ' \. s:pingu_ai_provider_label\(l:raw\)/);
  assert.match(internalRuntime, /':PinguModel<CR>'/);
  assert.match(internalRuntime, /g:pingu_model_key_alias/);
});

test('runtime permite corrigir somente a issue da linha atual', () => {
  assert.match(pluginRuntime, /let g:pingu_fix_current_key = '<leader>pif'/);
  assert.match(internalRuntime, /function! s:pingu_fix_current_issue\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_at_cursor_for_action\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_from_open_hover\(\) abort/);
  assert.match(internalRuntime, /function! s:refresh_pingu_hints_after_issue_apply\(bufnr\) abort/);
  assert.match(internalRuntime, /let l:issue = s:pingu_issue_at_cursor_for_action\(\)/);
  assert.match(internalRuntime, /s:get_buffer_issue_at_cursor\(\)/);
  assert.match(internalRuntime, /s:issue_has_applicable_fix\(l:issue\)/);
  assert.match(internalRuntime, /let l:file = fnamemodify\(get\(l:issue, 'filename', empty\(bufname\('%'\)\) \? '' : bufname\('%'\)\), ':p'\)/);
  assert.match(internalRuntime, /call s:refresh_pingu_hints_after_issue_apply\(bufnr\('%'\)\)/);
  assert.match(internalRuntime, /call s:pingu_post_fix_check\(l:file\)/);
  assert.doesNotMatch(internalRuntime, /Correcao aplicada na linha atual'\\n\s*call s:clear_pingu_issue_hints_for_buffer/);
  assert.match(internalRuntime, /':PinguFixCurrent<CR>'/);
});

test('runtime mantem hover automatico de issue passivo por padrao', () => {
  assert.match(pluginRuntime, /let g:pingu_issue_hover_hint = 1/);
  assert.match(pluginRuntime, /let g:pingu_issue_hover_delay_ms = 30/);
  assert.match(internalRuntime, /function! s:issue_covers_line\(issue, line\) abort/);
  assert.match(internalRuntime, /get\(a:issue, 'end_lnum', l:start\)/);
  assert.match(internalRuntime, /function! s:get_buffer_issue_at_cursor_exact\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_open_issue_hover_menu\(issue, \.\.\.\) abort/);
  assert.match(internalRuntime, /let s:pingu_issue_hover_source_context = {}/);
  assert.match(internalRuntime, /function! s:restore_pingu_issue_hover_source\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_fix_current_issue_with_ai\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_hover_action_for_cursor\(\) abort/);
  assert.match(internalRuntime, /function! s:install_pingu_issue_hover_source_maps\(bufnr\) abort/);
  assert.match(internalRuntime, /function! s:clear_pingu_issue_hover_source_maps\(\) abort/);
  assert.match(internalRuntime, /let s:pingu_issue_hover_keep_open = 0/);
  assert.match(internalRuntime, /function! s:release_pingu_issue_hover_keep_open\(timer\) abort/);
  assert.match(internalRuntime, /function! s:pingu_current_buffer_is_issue_hover_menu\(\) abort/);
  assert.match(internalRuntime, /function! s:schedule_pingu_issue_hover_menu\(\) abort/);
  assert.match(internalRuntime, /function! s:fire_pingu_issue_hover_menu\(timer, bufnr, lnum, changedtick\) abort/);
  assert.match(internalRuntime, /function! s:pingu_show_issue_hover_action_hint\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_show_issue_hover_action_hint_if_current\(bufnr\) abort/);
  assert.match(internalRuntime, /s:pingu_qf_items_for_current_buffer\(\)/);
  assert.match(internalRuntime, /nvim_open_win/);
  assert.match(internalRuntime, /nvim_open_win\(l:bufnr, v:false, \{/);
  assert.match(internalRuntime, /'focusable': v:true,/);
  assert.match(internalRuntime, /setbufvar\(l:bufnr, 'pingu_issue_hover_menu', 1\)/);
  assert.match(internalRuntime, /setbufvar\(l:bufnr, 'pingu_issue_hover_focus_menu', l:focus_menu \? 1 : 0\)/);
  assert.match(internalRuntime, /getbufvar\(l:hover_bufnr, 'pingu_issue_hover_menu', 0\)/);
  assert.match(internalRuntime, /l:first_line =~# '\^Pingu:'/);
  assert.match(internalRuntime, /PinguFixCurrentAI/);
  assert.match(internalRuntime, /corrigir com IA/);
  assert.match(internalRuntime, /call s:restore_pingu_issue_hover_source\(\)/);
  assert.match(internalRuntime, /function! s:script_call_rhs\(call_expr\) abort/);
  assert.match(internalRuntime, /expand\('<SID>'\) \. a:call_expr/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("apply"\)'\)/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("ai"\)'\)/);
  assert.doesNotMatch(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("preview"\)'\)/);
  assert.doesNotMatch(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("explain"\)'\)/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("test"\)'\)/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("undo"\)'\)/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action\("history"\)'\)/);
  assert.match(internalRuntime, /t  Rodar checks/);
  assert.match(internalRuntime, /if l:focus_menu\n    call s:install_pingu_issue_hover_source_maps\(bufnr\('%'\)\)\n  endif/);
  assert.match(internalRuntime, /let l:lines = s:pingu_issue_hover_menu_lines\(a:issue, l:focus_menu\)/);
  assert.match(internalRuntime, /nvim_buf_set_keymap\(a:bufnr, 'n', l:lhs, l:rhs/);
  assert.match(internalRuntime, /nvim_buf_del_keymap\(l:bufnr, 'n', l:lhs\)/);
  assert.match(internalRuntime, /call nvim_buf_set_keymap\(l:bufnr, 'n', 'a'/);
  assert.match(internalRuntime, /s:script_call_rhs\('pingu_issue_hover_action_for_cursor\(\)'\)/);
  assert.match(internalRuntime, /'<LeftMouse>', '<LeftMouse>' \. s:script_call_rhs\('pingu_issue_hover_action_for_cursor\(\)'\)/);
  assert.match(internalRuntime, /let l:focus_menu = a:0 > 0 \? !!a:1 : v:false/);
  assert.match(internalRuntime, /let l:existing_focus_menu = getbufvar\(l:existing_bufnr, 'pingu_issue_hover_focus_menu', 0\)/);
  assert.match(internalRuntime, /if l:existing_focus_menu \|\| !l:focus_menu\n      return\n    endif/);
  assert.match(internalRuntime, /call nvim_buf_set_option\(l:bufnr, 'bufhidden', l:focus_menu \? 'hide' : 'wipe'\)/);
  assert.match(internalRuntime, /if l:focus_menu\n    let s:pingu_issue_hover_keep_open = 1\n  endif\n  let l:winid = nvim_open_win\(l:bufnr, v:false, \{/);
  assert.match(internalRuntime, /call s:pingu_open_issue_hover_menu\(l:issue, v:false\)/);
  assert.match(internalRuntime, /call s:pingu_open_issue_hover_menu\(l:issue, v:true\)/);
  assert.match(internalRuntime, /call timer_start\(120, function\('s:release_pingu_issue_hover_keep_open'\)\)/);
  assert.match(internalRuntime, /if !exists\('\*nvim_win_is_valid'\) \|\| nvim_win_is_valid\(l:winid\)\n    call s:start_pingu_issue_hover_ai_suggestion\(a:issue, l:signature\)/);
  assert.doesNotMatch(internalRuntime, /function! s:pingu_open_issue_hover_menu\(issue, \.\.\.\) abort[\s\S]*call nvim_set_current_win\(l:winid\)[\s\S]*function! s:pingu_show_issue_hover_action_hint\(\) abort/);
  assert.match(internalRuntime, /autocmd CursorHold \* if has\('nvim'\)/);
  assert.match(internalRuntime, /autocmd CursorMoved \* if has\('nvim'\)/);
  assert.doesNotMatch(internalRuntime, /autocmd CursorMoved,BufEnter \*/);
  assert.match(internalRuntime, /autocmd InsertEnter,BufLeave \* if has\('nvim'\)/);
  assert.match(internalRuntime, /s:pingu_show_issue_hover_action_hint\(\)/);
  assert.match(internalRuntime, /if s:pingu_current_buffer_is_issue_hover_menu\(\)\n    return\n  endif\n  call s:close_pingu_issue_hover_menu\(\)/);
  assert.match(internalRuntime, /get\(g:, 'pingu_issue_hover_hint', 1\)/);
  assert.match(internalRuntime, /let s:pingu_cursor_hover_issue_signature = ''/);
  assert.match(internalRuntime, /let l:delay = get\(g:, 'pingu_issue_hover_delay_ms', 30\)/);
  assert.match(internalRuntime, /return max\(\[10, l:delay\]\)/);
});

test('runtime nao rouba foco do arquivo durante check com hover de issue ligado', { skip: !commandExists('nvim') }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-vim-hover-focus-'));
  const sourceFile = path.join(tempDir, 'sample.js');
  const scriptFile = path.join(tempDir, 'hover-focus.vim');
  const outputFile = path.join(tempDir, 'result.json');
  fs.writeFileSync(sourceFile, ['const value = 1   ', 'console.log(value)', ''].join('\n'), 'utf8');
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
    'let g:pingu_issue_hover_hint = 1',
    'let g:pingu_issue_hover_delay_ms = 10',
    'let $PINGU_CODEX_DISABLED = 1',
    'let $PINGU_CLAUDE_DISABLED = 1',
    'let $PINGU_COPILOT_DISABLED = 1',
    'let $PINGU_OPENAI_DISABLED = 1',
    "let g:pingu_auto_fix_kinds = ['trailing_whitespace']",
    `execute 'set runtimepath^=' . fnameescape(${vimString(root)})`,
    'runtime plugin/pingu_dev_agent.vim',
    `execute 'edit ' . fnameescape(${vimString(sourceFile)})`,
    'call cursor(1, 1)',
    'silent PinguCheck',
    'sleep 900m',
    'let g:pingu_test_hover_open = 0',
    'for g:pingu_test_winid in nvim_list_wins()',
    '  let g:pingu_test_bufnr = nvim_win_get_buf(g:pingu_test_winid)',
    "  if getbufvar(g:pingu_test_bufnr, 'pingu_issue_hover_menu', 0)",
    '    let g:pingu_test_hover_open = 1',
    '  endif',
    'endfor',
    `call writefile([json_encode({'currentFile': fnamemodify(bufname('%'), ':p'), 'sourceFile': fnamemodify(${vimString(sourceFile)}, ':p'), 'line': line('.'), 'hoverOpen': g:pingu_test_hover_open})], ${vimString(outputFile)})`,
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
  assert.equal(payload.currentFile, payload.sourceFile);
  assert.equal(payload.line, 1);
});

test('runtime expoe fluxos praticos de doctor contexto acoes e check', () => {
  assert.match(pluginRuntime, /let g:pingu_post_fix_check_command = empty\(\$PINGU_POST_FIX_CHECK_COMMAND\) \? '' : \$PINGU_POST_FIX_CHECK_COMMAND/);
  assert.match(pluginRuntime, /let g:pingu_project_check_command = empty\(\$PINGU_PROJECT_CHECK_COMMAND\) \? '' : \$PINGU_PROJECT_CHECK_COMMAND/);
  assert.match(internalRuntime, /function! s:pingu_doctor_lines\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_doctor_open\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_project_context_command\(bang\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_actions_open\(\) abort/);
  assert.match(internalRuntime, /let l:issue = s:pingu_issue_from_open_hover\(\)/);
  assert.match(internalRuntime, /setbufvar\(l:bufnr, 'pingu_issue_hover_issue', deepcopy\(a:issue\)\)/);
  assert.match(internalRuntime, /function! s:pingu_preview_current_fix\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_preview_fix\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_issue_queue_open\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_action_history_open\(\) abort/);
  assert.match(internalRuntime, /call s:pingu_lsp_open_float\('Pingu Action History', s:pingu_action_history_lines\(\), \{'enter': v:true\}\)/);
  assert.match(internalRuntime, /function! s:pingu_explain_current\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_run_project_check\(\.\.\.\) abort/);
  assert.match(internalRuntime, /function! s:pingu_post_fix_check\(file\) abort/);
  assert.match(internalRuntime, /function! s:pingu_model_overview_lines\(\) abort/);
  assert.match(internalRuntime, /s:pingu_model_overview_open\(\)/);
  assert.match(internalRuntime, /command! PinguDoctor call s:pingu_doctor_open\(\)/);
  assert.match(internalRuntime, /command! -bang PinguProjectContext call s:pingu_project_context_command\(<bang>0\)/);
  assert.match(internalRuntime, /command! PinguIssueActions call s:pingu_issue_actions_open\(\)/);
  assert.match(internalRuntime, /command! PinguIssueApply call s:pingu_issue_hover_action\('apply'\)/);
  assert.match(internalRuntime, /command! PinguIssuePreview call s:pingu_issue_hover_action\('preview'\)/);
  assert.match(internalRuntime, /command! PinguIssueAI call s:pingu_issue_hover_action\('ai'\)/);
  assert.match(internalRuntime, /command! PinguIssueExplain call s:pingu_issue_hover_action\('explain'\)/);
  assert.match(internalRuntime, /command! PinguIssueCheck call s:pingu_issue_hover_action\('test'\)/);
  assert.match(internalRuntime, /command! PinguIssueUndo call s:pingu_issue_hover_action\('undo'\)/);
  assert.match(internalRuntime, /command! PinguIssueHistory call s:pingu_issue_hover_action\('history'\)/);
  assert.match(internalRuntime, /command! PinguIssuePanel call s:pingu_issue_hover_action\('panel'\)/);
  assert.match(internalRuntime, /command! PinguPreviewFix call s:pingu_preview_current_fix\(\)/);
  assert.match(internalRuntime, /command! PinguIssueQueue call s:pingu_issue_queue_open\(\)/);
  assert.match(internalRuntime, /command! PinguActionHistory call s:pingu_action_history_open\(\)/);
  assert.match(internalRuntime, /command! PinguExplainCurrent call s:pingu_explain_current\(\)/);
  assert.match(internalRuntime, /command! -nargs=\* PinguRunProjectCheck call s:pingu_run_project_check\(<q-args>\)/);
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
  assert.match(internalRuntime, /let s:pingu_prompt_chat_sessions = \{\}/);
  assert.match(internalRuntime, /function! s:pingu_prompt_history_for_file\(file\) abort/);
  assert.match(internalRuntime, /function! s:pingu_prompt_history_append\(file, prompt, issue\) abort/);
  assert.match(internalRuntime, /function! s:start_async_pingu_prompt\(argv, root, payload, context\) abort/);
  assert.match(internalRuntime, /jobstart\(l:command, \{/);
  assert.match(internalRuntime, /'on_stdout': function\('s:pingu_prompt_on_stdout'\)/);
  assert.match(internalRuntime, /'on_exit': function\('s:pingu_prompt_on_exit'\)/);
  assert.match(internalRuntime, /'contextRadius': str2nr\(string\(get\(g:, 'pingu_prompt_context_radius', 80\)\)\)/);
  assert.match(internalRuntime, /'promptHistory': s:pingu_prompt_history_for_file\(l:file\)/);
  assert.match(internalRuntime, /'hasExplicitRange': a:range_count > 0 \? v:true : v:false/);
  assert.match(internalRuntime, /if s:start_async_pingu_prompt\(l:argv, l:root, l:stdin_payload, l:context\)/);
  assert.match(internalRuntime, /command! -nargs=\? PinguPromptClear call s:pingu_prompt_clear_command\(<q-args>\)/);
  assert.match(pluginRuntime, /let g:pingu_prompt_chat_history_max = 12/);
  assert.match(pluginRuntime, /let g:pingu_prompt_chat_entry_max_chars = 320/);
});

test('runtime abre PinguPrompt sem argumento em terminal interativo', () => {
  assert.match(internalRuntime, /function! s:pingu_prompt_terminal\(line1, line2, range_count\) abort/);
  assert.match(internalRuntime, /let s:pingu_prompt_terminal_winid = -1/);
  assert.match(internalRuntime, /let s:pingu_prompt_terminal_bufnr = -1/);
  assert.match(internalRuntime, /function! s:pingu_prompt_terminal_close\(\) abort/);
  assert.match(internalRuntime, /function! s:pingu_prompt_terminal_map_close\(bufnr\) abort/);
  assert.match(internalRuntime, /function! s:pingu_prompt_terminal_session_lines\(file, root, line1, line2, range_count\) abort/);
  assert.match(internalRuntime, /function! s:pingu_prompt_terminal_session_argv\(file, root, line1, line2, range_count\) abort/);
  assert.match(internalRuntime, /function! s:open_pingu_prompt_terminal_float\(argv, cwd\) abort/);
  assert.match(internalRuntime, /function! s:open_pingu_prompt_terminal_native\(argv, cwd\) abort/);
  assert.match(internalRuntime, /function! s:open_pingu_prompt_terminal_toggleterm\(argv, cwd\) abort/);
  assert.match(internalRuntime, /nvim_open_win\(l:bufnr, v:true, \{/);
  assert.match(internalRuntime, /call termopen\(a:argv, \{'cwd': a:cwd\}\)/);
  assert.doesNotMatch(internalRuntime, /lazy_util\.float_term/);
  assert.match(internalRuntime, /'   direction = "float",'/);
  assert.match(internalRuntime, /let l:argv = s:pingu_prompt_terminal_session_argv\(l:file, l:root, a:line1, a:line2, a:range_count\)/);
  assert.match(internalRuntime, /let l:argv = \[l:command\] \+ s:pingu_prompt_terminal_model_args\(l:command\)/);
  assert.match(internalRuntime, /if !empty\(\$PINGU_PROMPT_TERMINAL_COMMAND\)\n    return \$PINGU_PROMPT_TERMINAL_COMMAND\n  endif/);
  assert.match(internalRuntime, /if l:provider !=# 'codex' && l:provider !=# 'claude' && l:provider !=# 'auto'\n    return ''\n  endif/);
  assert.match(internalRuntime, /Pingu Prompt Session/);
  assert.match(internalRuntime, /Contexto primario/);
  assert.match(internalRuntime, /:PinguPromptClose, q no modo normal, Esc, Ctrl-C ou Ctrl-Q fecham esta sessao/);
  assert.match(internalRuntime, /nvim_buf_set_keymap\(a:bufnr, 't', '<C-q>'/);
  assert.match(internalRuntime, /nvim_buf_set_keymap\(a:bufnr, 't', '<C-c>'/);
  assert.match(internalRuntime, /Sessao de prompt aberta no terminal/);
  assert.doesNotMatch(internalRuntime, /Provider atual nao possui terminal interativo configurado/);
  assert.match(internalRuntime, /call s:pingu_prompt_terminal\(a:line1, a:line2, a:range_count\)/);
  assert.match(internalRuntime, /command! -range PinguPromptTerminal call s:pingu_prompt_terminal\(<line1>, <line2>, <range>\)/);
  assert.match(internalRuntime, /command! PinguPromptClose call s:pingu_prompt_terminal_close\(\)/);
  assert.match(internalRuntime, /termopen\(a:argv, \{'cwd': a:cwd\}\)/);
  assert.match(internalRuntime, /call term_start\(a:argv, \{'cwd': a:cwd, 'curwin': 1\}\)/);
  assert.match(internalRuntime, /':PinguPrompt<CR>'/);
  assert.match(internalRuntime, /':<C-U>''<,''>PinguPrompt<CR>'/);
  assert.doesNotMatch(internalRuntime, /input\('\[Pingu\] Prompt: '\)/);
  assert.doesNotMatch(internalRuntime, /':PinguPrompt '/);
  assert.doesNotMatch(internalRuntime, /Pingu prompt no editor/);
  assert.doesNotMatch(internalRuntime, /Use o arquivo e o range acima como contexto principal/);
});

test('runtime mostra hints inline para prompts acionaveis do Pingu', () => {
  assert.match(pluginRuntime, /let g:pingu_hints_enabled = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_hints_max_lines = 1200/);
  assert.match(internalRuntime, /function! s:pingu_hint_for_line\(line\) abort/);
  assert.match(internalRuntime, /nvim_buf_set_extmark/);
  assert.match(internalRuntime, /PinguHintCode/);
  assert.match(internalRuntime, /PinguHintContext/);
  assert.match(internalRuntime, /PinguHintTerminal/);
  assert.match(internalRuntime, /return \['', 'PinguHintCode'\]/);
  assert.match(internalRuntime, /return \['', 'PinguHintContext'\]/);
  assert.match(internalRuntime, /return \['', 'PinguHintTerminal'\]/);
  assert.doesNotMatch(internalRuntime, /return \['Pingu code'/);
  assert.doesNotMatch(internalRuntime, /return \['Pingu context'/);
  assert.doesNotMatch(internalRuntime, /return \['Pingu terminal'/);
  assert.match(internalRuntime, /augroup pingu_hints/);
});

test('runtime mostra hints inline para diagnosticos encontrados pelo Pingu', () => {
  assert.match(diagnosticManagerRuntime, /vim\.g\.pingu_diagnostic_manager_bootstrapped = 1/);
  assert.match(diagnosticManagerRuntime, /state\.original_config = state\.original_config or diagnostic\.config/);
  assert.match(diagnosticManagerRuntime, /state\.original_show = state\.original_show or diagnostic\.show/);
  assert.match(diagnosticManagerRuntime, /state\.original_set = state\.original_set or diagnostic\.set/);
  assert.match(diagnosticManagerRuntime, /local function mask_diagnostic_opts\(opts\)/);
  assert.match(diagnosticManagerRuntime, /next_opts\.virtual_text = false/);
  assert.match(diagnosticManagerRuntime, /next_opts\.virtual_lines = false/);
  assert.match(diagnosticManagerRuntime, /next_opts\.signs = false/);
  assert.match(diagnosticManagerRuntime, /next_opts\.underline = false/);
  assert.match(diagnosticManagerRuntime, /diagnostic\.set = function\(namespace, bufnr, diagnostics, opts\)/);
  assert.match(diagnosticManagerRuntime, /diagnostic\.config\(mask_diagnostic_opts\(\{\}\)\)/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_enabled = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_prefix = ''/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_priority = 10000/);
  assert.match(pluginRuntime, /let g:pingu_issue_hints_position = 'eol'/);
  assert.match(pluginRuntime, /let g:pingu_diagnostic_takeover = has\('nvim'\) \? 1 : 0/);
  assert.match(pluginRuntime, /let g:pingu_diagnostic_takeover_max_items = -1/);
  assert.match(pluginRuntime, /g:pingu_diagnostic_source_labels = {/);
  assert.match(internalRuntime, /function! s:update_pingu_issue_hints_for_buffer\(bufnr, qf\) abort/);
  assert.match(internalRuntime, /function! s:apply_pingu_diagnostic_takeover\(\) abort/);
  assert.match(internalRuntime, /function! s:merge_lsp_diagnostic_hint_items\(bufnr, file, qf\) abort/);
  assert.match(internalRuntime, /function! s:pingu_diagnostic_source_label\(bufnr, source\) abort/);
  assert.match(internalRuntime, /return !empty\(l:source\) \? l:source : l:default/);
  assert.match(internalRuntime, /function! s:pingu_issue_hint_items_for_buffer\(bufnr, file, qf\) abort/);
  assert.match(internalRuntime, /function! s:update_pingu_all_hints_current_buffer\(\) abort/);
  assert.match(internalRuntime, /function! s:refresh_pingu_diagnostic_hints_event_buffer\(\) abort/);
  assert.match(internalRuntime, /let s:pingu_diagnostic_hints_refresh_timers = \[\]/);
  assert.match(internalRuntime, /function! s:schedule_pingu_diagnostic_hints_refresh\(bufnr\) abort/);
  assert.match(internalRuntime, /for l:delay in \[80, 250, 750\]/);
  assert.match(internalRuntime, /timer_start\(l:delay, \{timer -> s:fire_scheduled_pingu_diagnostic_hints_refresh\(l:bufnr, timer\)\}\)/);
  assert.match(internalRuntime, /if get\(l:item, 'kind', ''\) ==# 'lsp_diagnostic'\n        continue\n      endif/);
  assert.match(internalRuntime, /pingu_issue_hints/);
  assert.match(internalRuntime, /PinguIssueHintError/);
  assert.match(internalRuntime, /PinguIssueHintWarn/);
  assert.match(internalRuntime, /PinguIssueHintInfo/);
  assert.match(internalRuntime, /state\.original_config = vim\.diagnostic\.config/);
  assert.match(internalRuntime, /state\.original_show = vim\.diagnostic\.show/);
  assert.match(internalRuntime, /state\.original_set = vim\.diagnostic\.set/);
  assert.match(internalRuntime, /local function pingu_mask_diagnostic_opts\(opts\)/);
  assert.ok(internalRuntime.includes("\\ '(function(input)',"));
  assert.ok(internalRuntime.includes("\\ 'input = input or {}',"));
  assert.match(internalRuntime, /vim\.diagnostic\.config = function\(opts, namespace\)/);
  assert.match(internalRuntime, /vim\.diagnostic\.show = function\(namespace, bufnr, diagnostics, opts\)/);
  assert.match(internalRuntime, /vim\.diagnostic\.set = function\(namespace, bufnr, diagnostics, opts\)/);
  assert.match(internalRuntime, /next_opts\.virtual_text = false/);
  assert.match(internalRuntime, /next_opts\.virtual_lines = false/);
  assert.match(internalRuntime, /next_opts\.signs = false/);
  assert.match(internalRuntime, /next_opts\.underline = false/);
  assert.match(internalRuntime, /local original = type\(current\) == "table" and current\.original_config or state\.original_config/);
  assert.match(internalRuntime, /if opts == nil then/);
  assert.match(internalRuntime, /local cfg = original\(nil, namespace\)/);
  assert.match(internalRuntime, /next_cfg\.virtual_text = false/);
  assert.match(internalRuntime, /next_cfg\.virtual_lines = false/);
  assert.match(internalRuntime, /next_cfg\.signs = false/);
  assert.match(internalRuntime, /next_cfg\.underline = false/);
  assert.match(internalRuntime, /next_opts\.virtual_text = false/);
  assert.match(internalRuntime, /next_opts\.virtual_lines = false/);
  assert.match(internalRuntime, /return original\(namespace, bufnr, diagnostics, pingu_mask_diagnostic_opts\(opts\)\)/);
  assert.match(internalRuntime, /namespace_names\[ns_id\] = meta\.name ~= nil and tostring\(meta\.name\) or ""/);
  assert.match(internalRuntime, /source = namespace_names\[namespace\] or ""/);
  assert.match(internalRuntime, /end_lnum = \(tonumber\(diag\.end_lnum or diag\.lnum or 0\) or 0\) \+ 1/);
  assert.match(internalRuntime, /end_col = \(tonumber\(diag\.end_col or diag\.col or 0\) or 0\) \+ 1/);
  assert.match(internalRuntime, /function! s:pingu_effective_language_diagnostic_severity\(source, message, severity\) abort/);
  assert.match(internalRuntime, /'\\v\(undefined or private\|missing or private function\)'/);
  assert.match(internalRuntime, /'\\v\(cannot find \(name\|module\|symbol\|package\|type\)\|cannot resolve \(symbol\|module\|import\)\)'/);
  assert.match(internalRuntime, /'\\v\(cannot find module\|could not find \(module\|package\|declaration file\)\|no module named\)'/);
  assert.match(internalRuntime, /'\\v\(import .\+ could not be resolved\|could not resolve \(import\|module\|package\|dependency\)\)'/);
  assert.match(internalRuntime, /'\\v\(failed to resolve import\|unable to resolve \(path\|module\|import\|dependency\)\)'/);
  assert.match(internalRuntime, /'\\v\(unresolved \(reference\|import\|module\|name\|symbol\)\)'/);
  assert.match(internalRuntime, /'\\v\(use of undeclared identifier\|undeclared \(name\|identifier\)\|unknown identifier\)'/);
  assert.match(internalRuntime, /let l:severity = s:pingu_effective_language_diagnostic_severity\(l:source, l:message, l:severity\)/);
  assert.match(internalRuntime, /let l:qf = s:pingu_issue_hint_items_for_buffer\(a:bufnr, l:file, a:qf\)/);
  assert.match(internalRuntime, /return s:merge_lsp_diagnostic_hint_items\(a:bufnr, l:file, l:non_lsp_qf\)/);
  assert.match(internalRuntime, /call s:pingu_show_issue_hover_action_hint_if_current\(a:bufnr\)/);
  assert.match(
    internalRuntime,
    /function! s:update_pingu_issue_hints_for_buffer\(bufnr, qf\) abort[\s\S]*call s:pingu_show_issue_hover_action_hint_if_current\(a:bufnr\)[\s\S]*endfunction/
  );
  assert.match(internalRuntime, /suppress_handler\("virtual_text"\)/);
  assert.match(internalRuntime, /suppress_handler\("virtual_lines"\)/);
  assert.match(internalRuntime, /suppress_handler\("signs"\)/);
  assert.match(internalRuntime, /suppress_handler\("underline"\)/);
  assert.match(internalRuntime, /restore_handler\("virtual_text"\)/);
  assert.match(internalRuntime, /restore_handler\("virtual_lines"\)/);
  assert.match(internalRuntime, /restore_handler\("signs"\)/);
  assert.match(internalRuntime, /restore_handler\("underline"\)/);
  assert.match(internalRuntime, /vim\.diagnostic\.show = state\.original_show/);
  assert.match(internalRuntime, /vim\.diagnostic\.set = state\.original_set/);
  assert.match(internalRuntime, /vim\.diagnostic\.config\(pingu_mask_diagnostic_opts\(\{\}\)\)/);
  assert.match(internalRuntime, /vim\.diagnostic\.get_namespaces/);
  assert.match(internalRuntime, /vim\.diagnostic\.config\(pingu_mask_diagnostic_opts\(\{\}\), ns_id\)/);
  assert.match(internalRuntime, /function! s:refresh_pingu_diagnostic_hints_current_buffer\(\) abort/);
  assert.match(internalRuntime, /augroup pingu_diagnostic_takeover/);
  assert.match(internalRuntime, /DiagnosticChanged \* silent! call s:apply_pingu_diagnostic_takeover\(\) \| silent! call s:refresh_pingu_diagnostic_hints_event_buffer\(\)/);
  assert.match(internalRuntime, /if l:max_items == 0/);
  assert.match(internalRuntime, /if l:max_items > 0 && l:added >= l:max_items/);
  assert.match(internalRuntime, /'priority': l:priority/);
  assert.match(internalRuntime, /let l:severity = empty\(l:parts\[0\]\) \? 'error' : l:parts\[0\]/);
  assert.match(internalRuntime, /if get\(a:issue, 'kind', ''\) ==# 'lsp_diagnostic'/);
  assert.match(internalRuntime, /printf\('%s %s', empty\(l:prefix\) \? '' : l:prefix, l:message\)/);
  assert.match(internalRuntime, /printf\('%s %s: %s', empty\(l:prefix\) \? '' : l:prefix, l:severity, l:message\)/);
  assert.doesNotMatch(internalRuntime, /printf\('%s Pingu %s: %s'/);
  assert.match(internalRuntime, /printf\(' \+%d', l:extra_count\)/);
  assert.match(internalRuntime, /call s:update_pingu_issue_hints_for_buffer\(a:bufnr, l:qf\)/);
});

test('runtime registra historico para rollback manual de auto-fix', () => {
  assert.match(pluginRuntime, /let g:pingu_undo_fix_history_max = 30/);
  assert.match(pluginRuntime, /let g:pingu_action_history_max = 50/);
  assert.match(internalRuntime, /let s:pingu_dev_agent_fix_history = \{\}/);
  assert.match(internalRuntime, /let s:pingu_action_history = \[\]/);
  assert.match(internalRuntime, /function! s:capture_issue_fix_snapshot\(issue, source_file\) abort/);
  assert.match(internalRuntime, /function! s:pingu_record_action_history\(action, issue, status\) abort/);
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
    'let $PINGU_CODEX_DISABLED = 1',
    'let $PINGU_COPILOT_DISABLED = 1',
    'let $PINGU_OPENAI_DISABLED = 1',
    'let g:pingu_auto_fix_enabled = 1',
    'let g:pingu_auto_fix_max_per_check = 1',
    "let g:pingu_auto_fix_kinds = ['function_doc']",
    `execute 'set runtimepath^=' . fnameescape(${vimString(root)})`,
    'runtime plugin/pingu_dev_agent.vim',
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
    'let $PINGU_CODEX_DISABLED = 1',
    'let $PINGU_COPILOT_DISABLED = 1',
    'let $PINGU_OPENAI_DISABLED = 1',
    'let g:pingu_auto_fix_enabled = 1',
    'let g:pingu_auto_fix_max_per_check = 1',
    "let g:pingu_auto_fix_kinds = ['trailing_whitespace']",
    `execute 'set runtimepath^=' . fnameescape(${vimString(root)})`,
    'runtime plugin/pingu_dev_agent.vim',
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
  assert.match(internalRuntime, /pingu_dev_agent_suppress_auto_fix_once = v:false/);
  assert.match(internalRuntime, /let l:suppress_auto_fix = s:pingu_dev_agent_suppress_auto_fix_once/);
  assert.match(internalRuntime, /g:pingu_auto_fix_enabled && !l:suppress_auto_fix/);
  assert.match(internalRuntime, /let s:pingu_dev_agent_suppress_auto_fix_once = v:true/);
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
  assert.match(internalRuntime, /function! s:apply_issue_lsp_ai_fix_explicit\(issue\) abort/);
  assert.match(internalRuntime, /let l:issue\.filename = fnamemodify\(get\(l:issue, 'filename', empty\(bufname\('%'\)\) \? '' : bufname\('%'\)\), ':p'\)/);
  assert.match(internalRuntime, /function! s:pingu_fix_current_issue_with_ai\(\) abort\n  let l:issue = s:pingu_issue_at_cursor_for_action\(\)/);
  assert.match(internalRuntime, /call s:refresh_pingu_hints_after_issue_apply\(bufnr\('%'\)\)/);
  assert.match(internalRuntime, /for l:delay in \[80, 250, 750, 1500\]/);
  assert.match(internalRuntime, /function! s:pingu_lsp_local_fix_candidate\(issue\) abort/);
  assert.match(internalRuntime, /function! s:pingu_lsp_local_fix_candidate_for_line\(bufnr, lnum\) abort/);
  assert.match(internalRuntime, /function! s:restore_issue_cursor_and_hints\(issue\) abort/);
  assert.match(internalRuntime, /let s:pingu_lsp_ai_fix_last_error = ''/);
  assert.match(internalRuntime, /function! s:pingu_lsp_ai_fix_fail\(reason, issue\) abort/);
  assert.match(internalRuntime, /'Logger'/);
  assert.match(internalRuntime, /'debug'/);
  assert.match(internalRuntime, /let l:threshold = strlen\(l:name\) <= 4 \? 3 : 2/);
  assert.match(internalRuntime, /let l:issue = s:pingu_lsp_local_fix_candidate_for_line\(bufnr\('%'\), line\('\.'\)\)/);
  assert.match(internalRuntime, /let l:local_fix = s:pingu_lsp_local_fix_candidate\(l:issue\)/);
  assert.match(internalRuntime, /Correcao com IA nao alterou o buffer: /);
  assert.match(internalRuntime, /call s:pingu_log_event\('error', 'fix-current-ai'/);
  assert.match(internalRuntime, /call s:restore_issue_cursor_and_hints\(l:issue\)/);
  assert.match(internalRuntime, /silent! call s:update_pingu_all_hints_current_buffer\(\)/);
  assert.match(internalRuntime, /return s:apply_issue_lsp_ai_fix\(s:pingu_issue_ai_fix_candidate\(a:issue\)\)/);
  assert.match(internalRuntime, /function! s:pingu_lsp_issue_requires_ai_decision\(issue\) abort/);
  assert.match(internalRuntime, /reportundefined/);
  assert.match(internalRuntime, /let l:previous_changedticks = \{\}/);
  assert.match(internalRuntime, /for l:buf in getbufinfo\(\{'bufloaded': 1\}\)/);
  assert.match(internalRuntime, /code action nao alterou nenhum buffer carregado/);
  assert.match(
    internalRuntime,
    /if l:op ==# 'lsp_code_action'\n    if s:apply_issue_lsp_ai_fix_explicit\(l:issue\)\n      return v:true\n    endif\n    if s:apply_issue_lsp_code_action\(l:issue\)/,
  );
  assert.match(internalRuntime, /'kind': 'lsp_ai_fix'/);
  assert.match(internalRuntime, /'op': 'lsp_ai_fix'/);
  assert.match(internalRuntime, /'--lsp-ai-fix'/);
  assert.match(internalRuntime, /provider assistido nao aplicou: /);
  assert.match(internalRuntime, /snippet assistido nao alterou o buffer/);
  assert.match(internalRuntime, /index\(\['lsp_code_action', 'lsp_ai_fix'\], l:item_kind\)/);
});

test('runtime aplica code action manual mesmo sem auto-fix LSP ligado', () => {
  assert.match(internalRuntime, /function! s:apply_issue_lsp_code_action\(issue\) abort/);
  assert.doesNotMatch(
    internalRuntime,
    /function! s:apply_issue_lsp_code_action\(issue\) abort\n  if !s:lsp_auto_fix_enabled\(\)/,
  );
  assert.match(internalRuntime, /let l:previous_changedticks = \{\}/);
  assert.match(internalRuntime, /for l:buf in getbufinfo\(\{'bufloaded': 1\}\)/);
  assert.match(internalRuntime, /let l:settle_timeout_ms = max\(\[100, str2nr\(string\(get\(l:action, 'settle_timeout_ms', 500\)\)\)\]\)/);
  assert.match(internalRuntime, /let l:start_wait_ms = s:now_ms\(\)/);
  assert.match(internalRuntime, /while s:now_ms\(\) - l:start_wait_ms < l:settle_timeout_ms/);
  assert.match(internalRuntime, /call s:auto_save_buffer_if_modified\(l:changed_buf, fnamemodify\(bufname\(l:changed_buf\), ':p'\)\)/);
  assert.match(internalRuntime, /call s:pingu_log_event\('warn', 'lsp-code-action', 'code action nao alterou nenhum buffer carregado'/);
});

test('runtime remove trailing whitespace de snippets antes de aplicar correcoes', () => {
  assert.match(internalRuntime, /function! s:sanitize_snippet_lines\(snippet_lines\) abort/);
  assert.match(internalRuntime, /return s:sanitize_snippet_lines\(copy\(a:snippet\)\)/);
  assert.match(internalRuntime, /return s:sanitize_snippet_lines\(split\(l:snippet, "\\%x00\\\\\|\\n", 1\)\)/);
  assert.match(internalRuntime, /substitute\('' \. val, '\\s\\\+\$', '', ''\)/);
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
