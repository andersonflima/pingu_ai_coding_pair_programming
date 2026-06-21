'use strict';

// Deteccao de importacao circular: analise multi-arquivo (modo diretorio do CLI).
// Constroi um grafo dirigido de imports/requires RELATIVOS entre os arquivos
// analisados (sem tocar em node_modules nem em pacotes externos) e reporta cada
// ciclo uma unica vez via componentes fortemente conexos (Tarjan). Suggest-only:
// o ciclo costuma indicar acoplamento que dificulta inicializacao e testes.
//
// Escopo JS/TS: import/export ... from, import './x', require('./x') e
// import('./x') dinamico. So arestas dentro do conjunto analisado viram ciclo.

const fs = require('fs');
const path = require('path');

const JS_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

function isJsLikeFile(file) {
  return JS_EXTENSIONS.includes(path.extname(String(file || '')).toLowerCase());
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

function buildImportGraph(files) {
  const fileSet = new Set((Array.isArray(files) ? files : []).map((file) => path.resolve(file)));
  const edges = new Map();
  for (const file of fileSet) {
    if (!isJsLikeFile(file)) {
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
    for (const { spec, line } of extractRelativeImports(content)) {
      const target = resolveRelativeImport(file, spec, fileSet);
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

function lineOfEdge(fromFile, toFile, edges) {
  const edge = (edges.get(fromFile) || []).find((entry) => entry.target === toFile);
  return edge ? edge.line : 1;
}

// Diretorio base comum de um conjunto de arquivos, para exibir caminhos curtos e
// independentes do diretorio de execucao (bom inclusive para ciclos entre pacotes).
function commonBaseDir(files) {
  const dirs = files.map((file) => path.dirname(file).split(path.sep));
  if (dirs.length === 0) {
    return '';
  }
  const segments = [];
  for (let i = 0; i < dirs[0].length; i += 1) {
    const segment = dirs[0][i];
    if (dirs.every((parts) => parts[i] === segment)) {
      segments.push(segment);
    } else {
      break;
    }
  }
  return segments.join(path.sep);
}

function detectCircularImports(files, options = {}) {
  const explicitCwd = options.cwd ? path.resolve(options.cwd) : null;
  const { fileSet, edges } = buildImportGraph(files);
  const components = stronglyConnectedComponents(fileSet, edges);
  const issues = [];

  for (const component of components) {
    if (component.length < 2) {
      continue;
    }
    const start = component.slice().sort()[0];
    const cyclePath = shortestCycleThrough(start, component, edges);
    const base = explicitCwd || commonBaseDir(cyclePath);
    const relative = cyclePath.map((file) => path.relative(base, file) || file);
    const second = cyclePath[1];
    issues.push({
      file: start,
      line: lineOfEdge(start, second, edges),
      severity: 'warning',
      kind: 'circular_import',
      message: `Importacao circular: ${relative.join(' -> ')}`,
      suggestion: 'Quebre o ciclo extraindo o que e compartilhado para um modulo neutro, invertendo a dependencia, ou adiando o import (require tardio/import dinamico).',
      snippet: '',
      action: { op: 'insert_before' },
    });
  }

  return issues.sort((a, b) => String(a.file).localeCompare(String(b.file)) || a.line - b.line);
}

module.exports = {
  detectCircularImports,
  buildImportGraph,
  extractRelativeImports,
};
