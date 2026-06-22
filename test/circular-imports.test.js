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

test('Python: ciclo direto com from .mod import', () => {
  const { root, files } = makeProject({
    'a.py': 'from .b import beta\n',
    'b.py': 'from .a import alpha\n',
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
  assert.match(issues[0].message, /a\.py -> b\.py -> a\.py/);
});

test('Python: from . import irmao e resolvido', () => {
  const { root, files } = makeProject({
    'pkg/a.py': 'from . import b\n',
    'pkg/b.py': 'from . import a\n',
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
});

test('Python: import via __init__.py e import de parente (..)', () => {
  const { root, files } = makeProject({
    'pkg/__init__.py': 'from .sub.mod import thing\n',
    'pkg/sub/mod.py': 'from ... import pkg\n',
    'pkg2.py': '',
  });
  // pkg/__init__ -> pkg/sub/mod -> (..) resolve para o pacote pkg (__init__) = ciclo
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /__init__\.py/);
});

test('Python: grafo aciclico nao acusa, e import absoluto e ignorado', () => {
  const { root, files } = makeProject({
    'a.py': 'import os\nfrom .b import beta\n',
    'b.py': 'import sys\n',
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('Python: import comentado nao gera ciclo', () => {
  const { root, files } = makeProject({
    'a.py': '# from .b import beta\n',
    'b.py': 'from .a import alpha\n',
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('Ruby: ciclo direto com require_relative', () => {
  const { root, files } = makeProject({
    'a.rb': "require_relative 'b'\n",
    'b.rb': "require_relative 'a'\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
  assert.match(issues[0].message, /a\.rb -> b\.rb -> a\.rb/);
});

test('Ruby: require_relative com caminho relativo de subdir', () => {
  const { root, files } = makeProject({
    'lib/a.rb': "require_relative '../core/b'\n",
    'core/b.rb': "require_relative '../lib/a'\n",
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
});

test('Ruby: grafo aciclico e require comentado nao acusam', () => {
  const acyclic = makeProject({
    'a.rb': "require_relative 'b'\n",
    'b.rb': "puts 'ok'\n",
  });
  assert.deepEqual(detectCircularImports(acyclic.files, { cwd: acyclic.root }), []);

  const commented = makeProject({
    'a.rb': "# require_relative 'b'\n",
    'b.rb': "require_relative 'a'\n",
  });
  assert.deepEqual(detectCircularImports(commented.files, { cwd: commented.root }), []);
});

test('Go: ciclo entre pacotes resolvido pelo prefixo do go.mod', () => {
  const { root, files } = makeProject({
    'go.mod': 'module example.com/app\n\ngo 1.21\n',
    'a/a.go': 'package a\n\nimport "example.com/app/b"\n\nvar _ = b.X\n',
    'b/b.go': 'package b\n\nimport "example.com/app/a"\n\nvar _ = a.Y\n',
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
  assert.match(issues[0].message, /a -> b -> a/);
  assert.match(issues[0].file, /a\.go$/);
});

test('Go: bloco import (...) e import de stdlib ignorado', () => {
  const { root, files } = makeProject({
    'go.mod': 'module example.com/app\n',
    'a/a.go': 'package a\n\nimport (\n\t"fmt"\n\t"example.com/app/b"\n)\n\nvar _ = fmt.Sprint(b.X)\n',
    'b/b.go': 'package b\n\nimport "example.com/app/a"\n',
  });
  const issues = detectCircularImports(files, { cwd: root });
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'circular_import');
});

test('Go: sem go.mod nao resolve e nao acusa ciclo', () => {
  const { root, files } = makeProject({
    'a/a.go': 'package a\n\nimport "example.com/app/b"\n',
    'b/b.go': 'package b\n\nimport "example.com/app/a"\n',
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});

test('Go: grafo aciclico nao acusa', () => {
  const { root, files } = makeProject({
    'go.mod': 'module example.com/app\n',
    'a/a.go': 'package a\n\nimport "example.com/app/b"\n',
    'b/b.go': 'package b\n\nimport "fmt"\n',
  });
  assert.deepEqual(detectCircularImports(files, { cwd: root }), []);
});
