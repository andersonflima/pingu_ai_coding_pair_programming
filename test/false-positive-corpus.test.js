'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { analyzeText } = require('../lib/analyzer');

// Corpus de regressao anti-falso-positivo: cada trecho e codigo LEGITIMO que se
// parece com o gatilho de um detector mas nao deve dispara-lo. Protege contra
// regressoes que tornem as guardas conservadoras frouxas demais. Para cada caso,
// nenhuma issue dos `kinds` proibidos pode aparecer na analise completa.
const CASES = [
  {
    name: 'JS: duas comparacoes ligadas por && nao sao comparacao encadeada',
    file: '/tmp/fp/range.js',
    code: ['function inRange(a, b, c) {', '  return a < b && b < c;', '}', ''].join('\n'),
    forbid: ['chained_comparison'],
  },
  {
    name: 'JS: for await...of e await Promise.all nao sao await_in_loop',
    file: '/tmp/fp/stream.js',
    code: [
      'async function drain(stream, groups) {',
      '  for await (const chunk of stream) {',
      '    handle(chunk);',
      '  }',
      '  for (const group of groups) {',
      '    await Promise.all(group.map(work));',
      '  }',
      '}',
      '',
    ].join('\n'),
    forbid: ['await_in_loop'],
  },
  {
    name: 'JS: atribuicao intencional com parenteses duplos nao e assignment_in_condition',
    file: '/tmp/fp/match.js',
    code: [
      'function scan(re, text) {',
      '  let m;',
      '  while ((m = re.exec(text))) {',
      '    use(m);',
      '  }',
      '}',
      '',
    ].join('\n'),
    forbid: ['assignment_in_condition'],
  },
  {
    name: 'JS: typeof valido, Number.isNaN e parseInt com base nao disparam',
    file: '/tmp/fp/checks.js',
    code: [
      'function classify(x, raw) {',
      '  if (typeof x === "function") {',
      '    return "fn";',
      '  }',
      '  if (Number.isNaN(x)) {',
      '    return "nan";',
      '  }',
      '  return parseInt(raw, 10);',
      '}',
      '',
    ].join('\n'),
    forbid: ['invalid_typeof', 'nan_comparison', 'parseint_no_radix'],
  },
  {
    name: 'Python: comparacao encadeada valida e is None idiomatico',
    file: '/tmp/fp/range.py',
    code: [
      'def check(a, b, c, value):',
      '    if a < b < c:',
      '        return True',
      '    return value is None',
      '',
    ].join('\n'),
    forbid: ['chained_comparison', 'literal_identity_comparison'],
  },
  {
    name: 'Python: variaveis de dominio nao sao shadowing de builtin',
    file: '/tmp/fp/names.py',
    code: [
      'def build(items):',
      '    item_list = list(items)',
      '    config = {}',
      '    total_sum = 0',
      '    return item_list, config, total_sum',
      '',
    ].join('\n'),
    forbid: ['shadowed_builtin'],
  },
  {
    name: 'Python: dunders corretos nao sao typo',
    file: '/tmp/fp/model.py',
    code: [
      'class Money:',
      '    def __init__(self, amount):',
      '        self.amount = amount',
      '',
      '    def __repr__(self):',
      '        return f"Money({self.amount})"',
      '',
      '    def __eq__(self, other):',
      '        return self.amount == other.amount',
      '',
    ].join('\n'),
    forbid: ['dunder_typo'],
  },
  {
    name: 'JS: == null e membro custom parseInt nao disparam',
    file: '/tmp/fp/nullish.js',
    code: [
      'function pick(x, parser) {',
      '  if (x == null) {',
      '    return parser.parseInt(x);',
      '  }',
      '  return x;',
      '}',
      '',
    ].join('\n'),
    forbid: ['loose_equality', 'parseint_no_radix'],
  },
  {
    name: 'JS: comparacao entre chamadas distintas nao e auto-comparacao',
    file: '/tmp/fp/calls.js',
    code: [
      'function changed(read) {',
      '  return read() === read();',
      '}',
      '',
    ].join('\n'),
    forbid: ['self_comparison'],
  },
  {
    name: 'JS: import usado em JSX/codigo nao e import nao utilizado',
    file: '/tmp/fp/use-import.js',
    code: [
      'const { readFile } = require("fs/promises");',
      '',
      'async function load(path) {',
      '  return readFile(path, "utf8");',
      '}',
      '',
      'module.exports = { load };',
      '',
    ].join('\n'),
    forbid: ['unused_import'],
  },
];

for (const testCase of CASES) {
  test(`sem falso positivo — ${testCase.name}`, () => {
    const issues = analyzeText(testCase.file, testCase.code);
    const offending = issues.filter((issue) => testCase.forbid.includes(issue.kind));
    assert.deepEqual(
      offending.map((issue) => `${issue.kind}@${issue.line}`),
      [],
      `nenhum dos kinds ${testCase.forbid.join(', ')} deveria disparar`,
    );
  });
}
