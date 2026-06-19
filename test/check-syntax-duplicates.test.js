'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const { findDuplicateTopLevelFunctions } = require('../scripts/check-syntax.js');

function withTempFile(content, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-lint-'));
  try {
    const file = path.join(dir, 'sample.js');
    fs.writeFileSync(file, content);
    return run(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('detecta funcao top-level duplicada (codigo morto por hoisting)', () => {
  const duplicates = withTempFile(
    'function alpha() {}\nfunction beta() {}\nfunction alpha(x) {}\n',
    findDuplicateTopLevelFunctions,
  );
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].name, 'alpha');
  assert.equal(duplicates[0].firstLine, 1);
  assert.equal(duplicates[0].duplicateLine, 3);
});

test('nao acusa funcoes aninhadas (indentadas) com o mesmo nome', () => {
  const duplicates = withTempFile(
    'function outer() {\n  function helper() {}\n}\nfunction other() {\n  function helper() {}\n}\n',
    findDuplicateTopLevelFunctions,
  );
  assert.deepEqual(duplicates, []);
});

test('nao acusa codigo sem duplicatas', () => {
  const duplicates = withTempFile(
    'function a() {}\nfunction b() {}\nconst c = () => {};\n',
    findDuplicateTopLevelFunctions,
  );
  assert.deepEqual(duplicates, []);
});
