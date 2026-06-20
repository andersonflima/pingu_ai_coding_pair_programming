'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkFunctionalReassignment, checkNestedConditionDepth } = require('../lib/analyzer-complexity');

test('checkFunctionalReassignment sinaliza reatribuicao em Elixir', () => {
  const issues = checkFunctionalReassignment(['acc = acc + 1'], 'a.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'functional_reassignment');
});

test('checkFunctionalReassignment ignora nova atribuicao e outras linguagens', () => {
  assert.equal(checkFunctionalReassignment(['total = a + b'], 'a.ex').length, 0);
  assert.equal(checkFunctionalReassignment(['x = x + 1'], 'a.js').length, 0);
  assert.equal(checkFunctionalReassignment(['ok = ok'], 'a.ex').length, 0);
});

test('checkNestedConditionDepth sinaliza aninhamento acima de 4', () => {
  const lines = ['if a do', '  if b do', '    if c do', '      if d do', '        if e do', '          x', '        end', '      end', '    end', '  end', 'end'];
  const issues = checkNestedConditionDepth(lines, 'a.ex');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'nested_condition');
  assert.match(issues[0].message, /profundidade 5/);
});

test('checkNestedConditionDepth nao acusa aninhamento raso', () => {
  assert.deepEqual(checkNestedConditionDepth(['if a do', '  x', 'end'], 'a.ex'), []);
});
