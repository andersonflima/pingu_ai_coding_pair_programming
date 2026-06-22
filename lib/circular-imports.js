'use strict';

// Deteccao de importacao circular: analise multi-arquivo (modo diretorio do CLI).
// Constroi um grafo dirigido de imports/requires RELATIVOS entre os arquivos
// analisados (sem tocar em node_modules nem em pacotes externos) e reporta cada
// ciclo uma unica vez via componentes fortemente conexos (Tarjan). Suggest-only:
// o ciclo costuma indicar acoplamento que dificulta inicializacao e testes.
//
// Escopo JS/TS: import/export ... from, import './x', require('./x') e
// import('./x') dinamico. Escopo Python: imports relativos (from .mod import x,
// from . import mod, from ..pkg import y). Escopo Ruby: require_relative. Escopo
// Go: grafo entre pacotes (diretorios) resolvido pelo prefixo do modulo no
// go.mod (Go proibe ciclo de import). So arestas dentro do conjunto analisado
// viram ciclo. Rust e Elixir ficam de fora: referencias mutuas entre modulos
// sao legais nessas linguagens, entao um ciclo nao indica defeito.

const fs = require('fs');
const path = require('path');

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const PY_EXTENSIONS = ['.py', '.pyi'];
const RB_EXTENSIONS = ['.rb'];
const GO_EXTENSIONS = ['.go'];

function isJsLikeFile(file) {
  return JS_EXTENSIONS.includes(path.extname(String(file || '')).toLowerCase());
}

function isGoFile(file) {
  return GO_EXTENSIONS.includes(path.extname(String(file || '')).toLowerCase());
}

function isRubyFile(file) {
  return RB_EXTENSIONS.includes(path.extname(String(file || '')).toLowerCase());
}

function isPythonFile(file) {
  return PY_EXTENSIONS.includes(path.extname(String(file || '')).toLowerCase());
}

function isCommentLine(line) {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
}

// Specifiers relativos (.../..) por linha, com o numero da linha para reporte.
const SPEC_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

function extractRelativeImports(content) {
  const found = [];
  const lines = String(content || '').split('\n');
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    if (isCommentLine(line)) {
      return;
    }
    for (const pattern of SPEC_PATTERNS) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        const spec = match[1];
        if (spec && spec.startsWith('.')) {
          found.push({ spec, line: index + 1 });
        }
      }
    }
  });
  return found;
}

// Resolve um specifier relativo para um arquivo concreto dentro do conjunto
// analisado (tenta a extensao explicita, depois extensoes e index/<ext>).
function resolveRelativeImport(fromFile, spec, fileSet) {
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (path.extname(resolved)) {
    candidates.push(resolved);
  }
  for (const ext of JS_EXTENSIONS) {
    candidates.push(resolved + ext);
  }
  for (const ext of JS_EXTENSIONS) {
    candidates.push(path.join(resolved, `index${ext}`));
  }
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Python: resolve um import relativo (nivel = numero de pontos, modulo pontilhado)
// para um arquivo concreto, tentando <mod>.py e <mod>/__init__.py.
function resolvePythonModule(fromFile, level, dottedModule, fileSet) {
  let baseDir = path.dirname(path.resolve(fromFile));
  for (let depth = 1; depth < level; depth += 1) {
    baseDir = path.dirname(baseDir);
  }
  const parts = String(dottedModule || '').split('.').filter(Boolean);
  const target = parts.length ? path.join(baseDir, ...parts) : baseDir;
  const candidates = [
    `${target}.py`,
    `${target}.pyi`,
    path.join(target, '__init__.py'),
    path.join(target, '__init__.pyi'),
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

// Python: arestas relativas do arquivo. `from .mod import x` aponta para `mod`;
// `from . import a, b` aponta para os irmaos `a` e `b` do mesmo pacote.
function pythonImportTargets(fromFile, content, fileSet) {
  const targets = [];
  const lines = String(content || '').split('\n');
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    if (/^\s*#/.test(line)) {
      return;
    }
    const match = line.match(/^\s*from\s+(\.+)([A-Za-z_][\w.]*)?\s+import\s+(.+)$/);
    if (!match) {
      return;
    }
    const level = match[1].length;
    const dottedModule = match[2] || '';
    const lineNumber = index + 1;
    if (dottedModule) {
      const target = resolvePythonModule(fromFile, level, dottedModule, fileSet);
      if (target) {
        targets.push({ target, line: lineNumber });
      }
      return;
    }
    // from . import a, b as c  -> irmaos a, b no pacote atual.
    const names = String(match[3] || '')
      .replace(/[()\\]/g, ' ')
      .split(',')
      .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
      .filter((name) => /^[A-Za-z_]\w*$/.test(name));
    for (const name of names) {
      const target = resolvePythonModule(fromFile, level, name, fileSet);
      if (target) {
        targets.push({ target, line: lineNumber });
      }
    }
  });
  return targets;
}

// Ruby: require_relative e sempre relativo ao arquivo atual; resolve para <x>.rb.
function resolveRubyRequire(fromFile, spec, fileSet) {
  const resolved = path.resolve(path.dirname(fromFile), spec);
  const candidates = [];
  if (path.extname(resolved) === '.rb') {
    candidates.push(resolved);
  }
  candidates.push(`${resolved}.rb`);
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

function rubyImportTargets(fromFile, content, fileSet) {
  const targets = [];
  const lines = String(content || '').split('\n');
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    if (/^\s*#/.test(line)) {
      return;
    }
    const pattern = /\brequire_relative\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      const target = resolveRubyRequire(fromFile, match[1], fileSet);
      if (target) {
        targets.push({ target, line: index + 1 });
      }
    }
  });
  return targets;
}

// Go: localiza o go.mod (subindo a arvore) e le o prefixo do modulo, que mapeia
// import paths para diretorios locais. Sem go.mod nao da para resolver com
// seguranca, entao o arquivo e ignorado.
function findGoModule(startDir, cache) {
  let dir = startDir;
  while (true) {
    if (cache.has(dir)) {
      return cache.get(dir);
    }
    let found = null;
    const candidate = path.join(dir, 'go.mod');
    try {
      if (fs.existsSync(candidate)) {
        const match = fs.readFileSync(candidate, 'utf8').match(/^\s*module\s+(\S+)/m);
        if (match) {
          found = { prefix: match[1], root: dir };
        }
      }
    } catch (_error) {
      found = null;
    }
    if (found) {
      cache.set(dir, found);
      return found;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      cache.set(startDir, null);
      return null;
    }
    dir = parent;
  }
}

// Go: import paths de um arquivo (forma simples e bloco import (...)), com linha.
function goImportPaths(content) {
  const out = [];
  const lines = String(content || '').split('\n');
  let inBlock = false;
  lines.forEach((rawLine, index) => {
    const line = String(rawLine || '');
    const lineNumber = index + 1;
    if (!inBlock) {
      if (/^\s*import\s*\(\s*$/.test(line)) {
        inBlock = true;
        return;
      }
      const single = line.match(/^\s*import\s+(?:[A-Za-z_.][\w.]*\s+|_\s+|\.\s+)?"([^"]+)"/);
      if (single) {
        out.push({ importPath: single[1], line: lineNumber });
      }
      return;
    }
    if (/^\s*\)/.test(line)) {
      inBlock = false;
      return;
    }
    const grouped = line.match(/^\s*(?:[A-Za-z_.][\w.]*\s+|_\s+|\.\s+)?"([^"]+)"/);
    if (grouped) {
      out.push({ importPath: grouped[1], line: lineNumber });
    }
  });
  return out;
}

// Go: grafo entre pacotes (diretorios). No = diretorio com .go analisados; aresta
// = import local (sob o prefixo do modulo) para outro diretorio do conjunto.
function buildGoPackageGraph(files) {
  const goFiles = (Array.isArray(files) ? files : [])
    .map((file) => path.resolve(file))
    .filter(isGoFile)
    .sort();
  const nodeSet = new Set();
  const fileByDir = new Map();
  for (const file of goFiles) {
    const dir = path.dirname(file);
    nodeSet.add(dir);
    if (!fileByDir.has(dir)) {
      fileByDir.set(dir, file);
    }
  }

  const moduleCache = new Map();
  const edges = new Map();
  const seenPerDir = new Map();
  for (const file of goFiles) {
    const fromDir = path.dirname(file);
    const mod = findGoModule(fromDir, moduleCache);
    if (!mod) {
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_error) {
      continue;
    }
    for (const { importPath, line } of goImportPaths(content)) {
      const isLocal = importPath === mod.prefix || importPath.startsWith(`${mod.prefix}/`);
      if (!isLocal) {
        continue;
      }
      const rel = importPath === mod.prefix ? '' : importPath.slice(mod.prefix.length + 1);
      const targetDir = rel ? path.join(mod.root, ...rel.split('/')) : mod.root;
      if (targetDir === fromDir || !nodeSet.has(targetDir)) {
        continue;
      }
      const seen = seenPerDir.get(fromDir) || new Set();
      if (seen.has(targetDir)) {
        continue;
      }
      seen.add(targetDir);
      seenPerDir.set(fromDir, seen);
      const list = edges.get(fromDir) || [];
      list.push({ target: targetDir, line, file });
      edges.set(fromDir, list);
    }
  }
  return { nodeSet, edges, treatNodesAsDir: true };
}

// Arestas de import de um arquivo, conforme a linguagem.
function fileImportTargets(file, content, fileSet) {
  if (isJsLikeFile(file)) {
    return extractRelativeImports(content)
      .map(({ spec, line }) => ({ target: resolveRelativeImport(file, spec, fileSet), line }))
      .filter((edge) => edge.target);
  }
  if (isPythonFile(file)) {
    return pythonImportTargets(file, content, fileSet);
  }
  if (isRubyFile(file)) {
    return rubyImportTargets(file, content, fileSet);
  }
  return [];
}

function buildImportGraph(files) {
  const fileSet = new Set((Array.isArray(files) ? files : []).map((file) => path.resolve(file)));
  const edges = new Map();
  for (const file of fileSet) {
    if (!isJsLikeFile(file) && !isPythonFile(file) && !isRubyFile(file)) {
      continue;
    }
    let content;
    try {
      content = fs.readFileSync(file, 'utf8');
    } catch (_error) {
      continue;
    }
    const list = [];
    const seenTargets = new Set();
    for (const { target, line } of fileImportTargets(file, content, fileSet)) {
      if (target && target !== file && !seenTargets.has(target)) {
        seenTargets.add(target);
        list.push({ target, line });
      }
    }
    edges.set(file, list);
  }
  return { fileSet, edges };
}

// Tarjan: componentes fortemente conexos. Cada SCC com 2+ nos e um ciclo.
function stronglyConnectedComponents(fileSet, edges) {
  const indexOf = new Map();
  const lowLink = new Map();
  const onStack = new Set();
  const stack = [];
  const result = [];
  let counter = 0;

  // Iterativo para nao estourar a pilha em grafos grandes.
  const nodes = Array.from(fileSet).sort();
  for (const start of nodes) {
    if (indexOf.has(start)) {
      continue;
    }
    const work = [{ node: start, edgeIndex: 0 }];
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const { node } = frame;
      if (frame.edgeIndex === 0) {
        indexOf.set(node, counter);
        lowLink.set(node, counter);
        counter += 1;
        stack.push(node);
        onStack.add(node);
      }
      const neighbors = edges.get(node) || [];
      if (frame.edgeIndex < neighbors.length) {
        const next = neighbors[frame.edgeIndex].target;
        frame.edgeIndex += 1;
        if (!indexOf.has(next)) {
          work.push({ node: next, edgeIndex: 0 });
        } else if (onStack.has(next)) {
          lowLink.set(node, Math.min(lowLink.get(node), indexOf.get(next)));
        }
        continue;
      }
      if (lowLink.get(node) === indexOf.get(node)) {
        const component = [];
        let popped;
        do {
          popped = stack.pop();
          onStack.delete(popped);
          component.push(popped);
        } while (popped !== node);
        result.push(component);
      }
      work.pop();
      if (work.length > 0) {
        const parent = work[work.length - 1].node;
        lowLink.set(parent, Math.min(lowLink.get(parent), lowLink.get(node)));
      }
    }
  }
  return result;
}

// Menor ciclo passando por `start`, dentro do SCC: BFS de cada vizinho ate start.
function shortestCycleThrough(start, component, edges) {
  const inComponent = new Set(component);
  const neighborsOf = (node) => (edges.get(node) || [])
    .map((edge) => edge.target)
    .filter((target) => inComponent.has(target));

  let best = null;
  for (const first of neighborsOf(start)) {
    if (first === start) {
      const candidate = [start, start];
      if (!best || candidate.length < best.length) {
        best = candidate;
      }
      continue;
    }
    const previous = new Map([[first, start]]);
    const queue = [first];
    let reached = false;
    while (queue.length > 0 && !reached) {
      const node = queue.shift();
      for (const next of neighborsOf(node)) {
        if (next === start) {
          reached = true;
          previous.set(start, node);
          break;
        }
        if (!previous.has(next)) {
          previous.set(next, node);
          queue.push(next);
        }
      }
    }
    if (reached) {
      const cyclePath = [start];
      let node = previous.get(start);
      const segment = [];
      while (node !== start) {
        segment.push(node);
        node = previous.get(node);
      }
      segment.reverse();
      const candidate = [start, ...segment, start];
      if (!best || candidate.length < best.length) {
        best = candidate;
      }
    }
  }
  return best || [start, start];
}

function edgeBetween(from, to, edges) {
  return (edges.get(from) || []).find((entry) => entry.target === to) || null;
}

// Base comum dos nos, para exibir caminhos curtos e independentes do diretorio de
// execucao. Para nos-arquivo usa o diretorio do arquivo; para nos-diretorio (Go)
// usa o proprio diretorio.
function commonBasePath(nodes, treatNodesAsDir) {
  const partsList = nodes.map((node) => (treatNodesAsDir ? node : path.dirname(node)).split(path.sep));
  if (partsList.length === 0) {
    return '';
  }
  const segments = [];
  for (let i = 0; i < partsList[0].length; i += 1) {
    const segment = partsList[0][i];
    if (partsList.every((parts) => parts[i] === segment)) {
      segments.push(segment);
    } else {
      break;
    }
  }
  return segments.join(path.sep);
}

// Transforma um grafo (nos + arestas) em issues de ciclo, uma por SCC com 2+ nos.
function cycleIssuesFromGraph(graph, options) {
  const { nodeSet, edges, treatNodesAsDir = false } = graph;
  const explicitCwd = options.cwd ? path.resolve(options.cwd) : null;
  const components = stronglyConnectedComponents(nodeSet, edges);
  const issues = [];
  for (const component of components) {
    if (component.length < 2) {
      continue;
    }
    const start = component.slice().sort()[0];
    const cyclePath = shortestCycleThrough(start, component, edges);
    const base = explicitCwd || commonBasePath(cyclePath, treatNodesAsDir);
    const relative = cyclePath.map((node) => path.relative(base, node) || node);
    const edge = edgeBetween(start, cyclePath[1], edges);
    issues.push({
      file: (edge && edge.file) || start,
      line: (edge && edge.line) || 1,
      severity: 'warning',
      kind: 'circular_import',
      message: `Importacao circular: ${relative.join(' -> ')}`,
      suggestion: 'Quebre o ciclo extraindo o que e compartilhado para um modulo neutro, invertendo a dependencia, ou adiando o import (require tardio/import dinamico).',
      snippet: '',
      action: { op: 'insert_before' },
    });
  }
  return issues;
}

function detectCircularImports(files, options = {}) {
  const fileGraph = buildImportGraph(files);
  const issues = [
    ...cycleIssuesFromGraph({ nodeSet: fileGraph.fileSet, edges: fileGraph.edges }, options),
    ...cycleIssuesFromGraph(buildGoPackageGraph(files), options),
  ];
  return issues.sort((a, b) => String(a.file).localeCompare(String(b.file)) || a.line - b.line);
}

module.exports = {
  detectCircularImports,
  buildImportGraph,
  buildGoPackageGraph,
  extractRelativeImports,
};
