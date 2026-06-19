'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkUnusedImports } = require('../lib/analyzer-unused');
const { issueKindConfig } = require('../lib/issue-kinds');

function unused(source, ext) {
  return checkUnusedImports(source.split('\n'), `sample${ext}`, ext).map((issue) => issue.message);
}

test('unused_import e suggest-only (nunca auto-fix)', () => {
  assert.equal(issueKindConfig('unused_import').autoFixDefault, false);
});

test('JS: detecta named/default/namespace e require nao usados', () => {
  assert.deepEqual(unused("import { used, dead } from 'x';\nused();", '.js'), ["Import 'dead' nao utilizado"]);
  assert.deepEqual(unused("import Foo from 'x';\nconst y = 1;", '.js'), ["Import 'Foo' nao utilizado"]);
  assert.deepEqual(unused("import * as ns from 'x';\nconst y = 1;", '.js'), ["Import 'ns' nao utilizado"]);
  assert.deepEqual(unused("const { a, b } = require('x');\na();", '.js'), ["Import 'b' nao utilizado"]);
});

test('JS: respeita import por efeito colateral e uso em JSX', () => {
  assert.deepEqual(unused("import 'polyfill';\nconst x = 1;", '.js'), []);
  assert.deepEqual(unused("import Button from 'ui';\nconst x = <Button />;", '.jsx'), []);
});

test('JS: alias (as) usa o nome renomeado', () => {
  assert.deepEqual(unused("import { a as b } from 'x';\nb();", '.js'), []);
  assert.deepEqual(unused("import { a as b } from 'x';\na();", '.js'), ["Import 'b' nao utilizado"]);
});

test('Python: detecta import e from-import nao usados', () => {
  assert.deepEqual(unused('import os\nimport sys\nprint(sys.argv)', '.py'), ["Import 'os' nao utilizado"]);
  assert.deepEqual(unused('from os import path, sep\nprint(path)', '.py'), ["Import 'sep' nao utilizado"]);
});

test('Python: uso como atributo e anotacao de tipo contam como uso', () => {
  assert.deepEqual(unused('import os\nx = os.getcwd()', '.py'), []);
  assert.deepEqual(unused('from typing import List\ndef f() -> List:\n    return []', '.py'), []);
});

test('nao reporta nada quando nao ha imports', () => {
  assert.deepEqual(unused('const x = 1;\nx + 1;', '.js'), []);
  assert.deepEqual(unused('x = 1', '.py'), []);
});
