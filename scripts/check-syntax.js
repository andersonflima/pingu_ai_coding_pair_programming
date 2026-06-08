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

  process.stdout.write(`syntax ok: ${results.length} files\n`);
}

run();
