'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['lib', 'test', 'scripts'];
const ENTRY_FILES = ['pingu_dev_agent.js'];

function listJavaScriptFiles(dir) {
  const absoluteDir = path.join(ROOT, dir);
  if (!fs.existsSync(absoluteDir)) {
    return [];
  }

  return fs.readdirSync(absoluteDir, { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(dir, entry.name);
      const absolutePath = path.join(ROOT, relativePath);
      if (entry.isDirectory()) {
        return listJavaScriptFiles(relativePath);
      }
      if (entry.isFile() && /\.js$/i.test(entry.name)) {
        return [absolutePath];
      }
      return [];
    });
}

function checkFile(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], {
    encoding: 'utf8',
  });
  return {
    filePath,
    ok: result.status === 0,
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').trim(),
  };
}

function findDuplicateTopLevelFunctions(filePath) {
  // Declaracoes de funcao no nivel do arquivo (sem indentacao) com o mesmo nome
  // sao quase sempre um bug: por hoisting, a ultima vence e a primeira vira
  // codigo morto silencioso (foi o caso de uma definicao duplicada de
  // levenshteinDistance no analyzer). Check deterministico e sem dependencias.
  const content = fs.readFileSync(filePath, 'utf8');
  const seen = new Map();
  const duplicates = [];
  content.split('\n').forEach((line, index) => {
    const match = line.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/);
    if (!match) {
      return;
    }
    const name = match[1];
    if (seen.has(name)) {
      duplicates.push({ name, firstLine: seen.get(name), duplicateLine: index + 1 });
    } else {
      seen.set(name, index + 1);
    }
  });
  return duplicates;
}

function run() {
  const files = [
    ...ENTRY_FILES.map((file) => path.join(ROOT, file)),
    ...SEARCH_DIRS.flatMap(listJavaScriptFiles),
  ];
  const results = files.map(checkFile);
  const failures = results.filter((result) => !result.ok);

  if (failures.length > 0) {
    failures.forEach((failure) => {
      process.stderr.write(`${path.relative(ROOT, failure.filePath)}\n${failure.output}\n`);
    });
    process.exit(1);
  }

  const duplicateFailures = files
    .map((filePath) => ({ filePath, duplicates: findDuplicateTopLevelFunctions(filePath) }))
    .filter((entry) => entry.duplicates.length > 0);

  if (duplicateFailures.length > 0) {
    duplicateFailures.forEach((entry) => {
      entry.duplicates.forEach((duplicate) => {
        process.stderr.write(
          `${path.relative(ROOT, entry.filePath)}: funcao duplicada '${duplicate.name}' `
          + `(linhas ${duplicate.firstLine} e ${duplicate.duplicateLine})\n`,
        );
      });
    });
    process.exit(1);
  }

  process.stdout.write(`syntax ok: ${results.length} files (sem funcoes duplicadas)\n`);
}

module.exports = { findDuplicateTopLevelFunctions };

if (require.main === module) {
  run();
}
