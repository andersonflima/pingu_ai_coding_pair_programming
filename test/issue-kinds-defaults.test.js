'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { defaultAutoFixKinds, defaultActionForKind } = require('../lib/issue-kinds');

test('terminal_task remains manually actionable but is not part of default auto-fix', () => {
  assert.equal(defaultActionForKind('terminal_task').op, 'run_command');
  assert.equal(defaultAutoFixKinds().includes('terminal_task'), false);
});

test('prompt_task uses explicit range replacement outside default auto-fix', () => {
  assert.equal(defaultActionForKind('prompt_task').op, 'replace_range');
  assert.equal(defaultAutoFixKinds().includes('prompt_task'), false);
});
