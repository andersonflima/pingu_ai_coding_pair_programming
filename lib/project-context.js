'use strict';

const fs = require('fs');
const path = require('path');
const { loadProjectMemory, resolveProjectRoot } = require('./project-memory');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function defaultContextDocument(memory) {
  const scripts = Array.isArray(memory.scriptNames) && memory.scriptNames.length > 0
    ? memory.scriptNames.join(', ')
    : 'nao detectado';
  return [
    '# Pingu Project Context',
    '',
    `summary: ${memory.readmeSummary || memory.projectName || 'Descreva o objetivo do projeto.'}`,
    `architecture: ${memory.architecture || 'Descreva a arquitetura principal.'}`,
    `source_root: ${memory.sourceRoot || 'src'}`,
    `ecosystem: ${memory.ecosystem || 'nao detectado'}`,
    `test_command: ${suggestTestCommand(memory)}`,
    `check_command: ${suggestCheckCommand(memory)}`,
    '',
    '## Decisoes',
    '',
    '- Documente padroes de implementacao, teste e revisao que o Pingu deve considerar.',
    '',
    '## Comandos',
    '',
    `- scripts detectados: ${scripts}`,
    '',
  ].join('\n');
}

function suggestTestCommand(memory) {
  const scripts = new Set(Array.isArray(memory.scriptNames) ? memory.scriptNames : []);
  if (memory.ecosystem === 'node') {
    if (scripts.has('test')) {
      return 'npm test';
    }
    if (scripts.has('check')) {
      return 'npm run check';
    }
  }
  if (memory.ecosystem === 'elixir') {
    return 'mix test';
  }
  if (memory.ecosystem === 'go') {
    return 'go test ./...';
  }
  if (memory.ecosystem === 'rust') {
    return 'cargo test';
  }
  if (memory.ecosystem === 'python') {
    return 'pytest';
  }
  return '';
}

function suggestCheckCommand(memory) {
  const scripts = new Set(Array.isArray(memory.scriptNames) ? memory.scriptNames : []);
  if (memory.ecosystem === 'node') {
    if (scripts.has('check')) {
      return 'npm run check';
    }
    if (scripts.has('lint')) {
      return 'npm run lint';
    }
  }
  return suggestTestCommand(memory);
}

function loadPinguContextFile(projectRoot) {
  const candidates = [
    path.join(projectRoot, '.pingu', 'context.md'),
    path.join(projectRoot, '.pingu-dev-agent', 'contexts', 'active.md'),
  ];
  const file = candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isFile();
    } catch (_error) {
      return false;
    }
  }) || candidates[0];
  let document = '';
  try {
    document = fs.readFileSync(file, 'utf8');
  } catch (_error) {
    document = '';
  }
  return { file, document };
}

function resolveProjectContext(options = {}) {
  const cwd = path.resolve(String(options.cwd || process.cwd()));
  const target = String(options.file || path.join(cwd, 'pingu.context'));
  const projectRoot = resolveProjectRoot(target);
  const memory = loadProjectMemory(path.join(projectRoot, 'pingu.context'));
  const context = loadPinguContextFile(projectRoot);
  const shouldWrite = options.write === true || options.force === true;

  let created = false;
  let overwritten = false;
  if (shouldWrite && (!context.document || options.force === true)) {
    ensureDir(path.dirname(context.file));
    fs.writeFileSync(context.file, defaultContextDocument(memory), 'utf8');
    created = !context.document;
    overwritten = Boolean(context.document);
    context.document = fs.readFileSync(context.file, 'utf8');
  }

  return {
    ok: true,
    projectRoot,
    file: context.file,
    exists: Boolean(context.document),
    created,
    overwritten,
    memory: {
      projectName: memory.projectName,
      ecosystem: memory.ecosystem,
      moduleType: memory.moduleType,
      scriptNames: memory.scriptNames,
      readmeTitle: memory.readmeTitle,
      readmeSummary: memory.readmeSummary,
      hints: memory.hints,
    },
    document: context.document,
    suggestions: {
      testCommand: suggestTestCommand(memory),
      checkCommand: suggestCheckCommand(memory),
    },
  };
}

module.exports = {
  defaultContextDocument,
  resolveProjectContext,
  suggestCheckCommand,
  suggestTestCommand,
};
