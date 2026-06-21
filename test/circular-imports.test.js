'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { detectCircularImports, extractRelativeImports } = require('../lib/circular-imports');

function makeProject(fileMap) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pingu-cycle-'));
  const files = [];
  for (const [relPath, content] of Object.entries(fileMap)) {
    const full = path.join(root, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
    files.push(full);
  }
  return { root, files };
}

test('extractRelativeImports captura import/export/require/dinamico relativos', () => {
  const specs = extractRelativeImports([
    "import a from './a';",
    "export { b } from './b';",
    "const c = require('./c');",
    "const d = await import('./d');",
    "import 'external-pkg';",
    "import x from 'react';",
  ].join('\n')).map((entry) => entry.spec);
  assert.deepEqual(specs.sort(), ['./a', './b', './c', './d']);
});

test('detecta ciclo direto entre dois modulos', () => {
  const { root, files } = makeProject({
    'a.js': "const b = require('./b');\nmodule.exports = { a: 1 };\n",
    'b.js': "const a = require('./a');\nmodule.exports = { b: 2 };\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
  assert.match(issues[0].message, /a\.js -> b\.js -> a\.js/);
});

test('detecta ciclo de tres modulos com import ESM', () => {
  const { root, files } = makeProject({
    'x.js': "import './y';\n",
    'y.js': "import './z';\n",
    'z.js': "import './x';\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
  assert.match(issues[0].message, /x\.js -> y\.js -> z\.js -> x\.js/);
});

test('resolve import sem extensao e via index', () => {
  const { root, files } = makeProject({
    'feature/index.js': "const helper = require('../helper');\n",
    'helper.js': "const feature = require('./feature');\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
});

test('nao acusa grafo aciclico', () => {
  const { root, files } = makeProject({
    'a.js': "import './b';\nimport './c';\n",
    'b.js': "import './c';\n",
    'c.js': "module.exports = {};\n",
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('ignora imports de pacotes externos e arestas fora do conjunto', () => {
  const { root, files } = makeProject({
    'a.js': "import react from 'react';\nimport './missing-not-scanned';\n",
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('ignora import comentado para evitar falso ciclo', () => {
  const { root, files } = makeProject({
    'a.js': "// const b = require('./b');\nmodule.exports = {};\n",
    'b.js': "const a = require('./a');\n",
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('reporta cada ciclo uma unica vez e em arquivo/linha do ciclo', () => {
  const { root, files } = makeProject({
    'a.js': "\nconst b = require('./b');\n",
    'b.js': "const a = require('./a');\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 2, 'aponta a linha do require que fecha o ciclo');
  assert.match(issues[0].file, /a\.js$/);
});
