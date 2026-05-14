'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs, positionalArgs } = require('../lib/cli-args');

test('cli parser trata autofix-guard como JSON e seta saída', () => {
  const args = parseArgs(['--autofix-guard', '--source-path', 'sample.js']);
  assert.equal(args.guardMode, true);
  assert.equal(args.output, 'json');
});

test('cli parser trata --format como alias de output', () => {
  const args = parseArgs(['--format', 'vim', 'sample.js']);
  assert.equal(args.output, 'vim');
  assert.deepEqual(positionalArgs(['--format', 'vim', 'sample.js']), ['sample.js']);
});

test('cli parser mantém aliases e lista de alvos', () => {
  const args = parseArgs(['--min-confidence', '0.4', '--kinds', 'a,b, c', '--check', '--dry-run']);
  assert.equal(args.minConfidence, 0.4);
  assert.deepEqual(args.kinds, ['a', 'b', 'c']);
  assert.equal(args.check, true);
  assert.equal(args.write, false);
});
