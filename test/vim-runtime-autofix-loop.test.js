'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const internalRuntime = fs.readFileSync(
  path.join(root, 'vim/autoload/realtime_dev_agent/internal.vim'),
  'utf8',
);
const pluginRuntime = fs.readFileSync(
  path.join(root, 'vim/plugin/realtime_dev_agent.vim'),
  'utf8',
);

test('runtime realtime limita comentarios automaticos ao contexto do cursor', () => {
  assert.match(pluginRuntime, /realtime_dev_agent_realtime_doc_cursor_context_only/);
  assert.match(pluginRuntime, /let g:realtime_dev_agent_realtime_doc_cursor_context_only = 1/);
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

test('runtime realtime guarda comentarios por identidade para evitar reaplicacao em loop', () => {
  assert.match(internalRuntime, /function! s:uses_realtime_loop_guard\(item\) abort/);
  assert.match(internalRuntime, /return s:is_documentation_issue\(a:item\)/);
  assert.match(internalRuntime, /function! s:issue_realtime_loop_guard_key\(item\) abort/);
  assert.match(internalRuntime, /let l:loop_guard_key = 'loop\|' \. s:issue_realtime_loop_guard_key\(l:item\)/);
  assert.match(internalRuntime, /let l:state\.fix_guard\[l:loop_guard_key\] = 1/);
});
