'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RUNTIME_FILES = Object.freeze([
  ['vim/plugin/realtime_dev_agent.vim', 'plugin/realtime_dev_agent.vim'],
  ['vim/autoload/realtime_dev_agent/internal.vim', 'autoload/realtime_dev_agent/internal.vim'],
  ['vim/autoload/realtime_dev_agent/guard_runtime.js', 'autoload/realtime_dev_agent/guard_runtime.js'],
]);

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function writeSyncedFile(sourcePath, targetPath) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
}

function compareRuntimeFile([sourceRelative, targetRelative]) {
  const sourcePath = path.join(ROOT, sourceRelative);
  const targetPath = path.join(ROOT, targetRelative);
  const sourceText = readText(sourcePath);
  const targetText = readText(targetPath);

  return {
    sourceRelative,
    targetRelative,
    sourcePath,
    targetPath,
    exists: fs.existsSync(sourcePath) && fs.existsSync(targetPath),
    synced: sourceText === targetText,
  };
}

function renderFailure(result) {
  if (!result.exists) {
    return `${result.targetRelative}: arquivo ausente ou fonte canonica ausente`;
  }
  return `${result.targetRelative}: divergente de ${result.sourceRelative}`;
}

function run({ write }) {
  const results = RUNTIME_FILES.map(compareRuntimeFile);
  const failures = results.filter((result) => !result.exists || !result.synced);

  if (write) {
    failures.forEach((result) => writeSyncedFile(result.sourcePath, result.targetPath));
    process.stdout.write(`vim runtime synced: ${failures.length} file(s)\n`);
    return;
  }

  if (failures.length > 0) {
    failures.forEach((failure) => process.stderr.write(`${renderFailure(failure)}\n`));
    process.stderr.write('Execute npm run sync:vim-runtime para atualizar as copias publicas.\n');
    process.exit(1);
  }

  process.stdout.write(`vim runtime sync ok: ${results.length} file(s)\n`);
}

run({
  write: process.argv.includes('--write'),
});
