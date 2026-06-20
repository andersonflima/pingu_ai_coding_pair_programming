'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const taxonomy = require('../config/developer-error-taxonomy.json');
const issueKinds = require('../config/issue-kinds.json');

test('todo issue kind mapeado na taxonomia existe em issue-kinds.json', () => {
  const mapped = new Set(taxonomy.families.flatMap((family) => family.mappedIssueKinds || []));
  const missing = [...mapped].filter((kind) => !(kind in issueKinds));
  assert.deepEqual(missing, [], `kinds ausentes em issue-kinds.json: ${missing.join(', ')}`);
});

test('os detectores de erro humano sao todos suggest-only (autoFixDefault false)', () => {
  const detectors = [
    'typo',
    'assignment_in_condition',
    'unreachable_code',
    'duplicate_case',
    'control_flow_in_finally',
    'swallowed_error',
    'missing_await',
    'unused_import',
    'unused_variable',
    'self_comparison',
    'self_assignment',
    'duplicate_key',
    'invalid_typeof',
    'nan_comparison',
    'mutable_default_arg',
  ];
  for (const kind of detectors) {
    assert.ok(issueKinds[kind], `issue kind ausente: ${kind}`);
    assert.equal(issueKinds[kind].autoFixDefault, false, `${kind} deveria ser suggest-only`);
  }
});

test('familias da taxonomia declaram safeAutoFix e linguagens', () => {
  for (const family of taxonomy.families) {
    assert.equal(typeof family.id, 'string');
    assert.ok(Array.isArray(family.mappedIssueKinds));
    assert.equal(typeof family.safeAutoFix, 'boolean');
    assert.ok(Array.isArray(family.languages));
  }
});
