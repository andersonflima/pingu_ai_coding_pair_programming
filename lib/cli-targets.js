'use strict';

const fs = require('fs');
const path = require('path');
const { isLanguageActive } = require('./language-capabilities');

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.hg',
  '.next',
  '.nuxt',
  '.mypy_cache',
  '.pytest_cache',
  '.svn',
  '.turbo',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'log',
  'node_modules',
  'site-packages',
  'temp',
  'tmp',
  'venv',
  'vendor',
]);

function resolveCliTargetFiles(targets, options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const uniqueFiles = new Set();
  (Array.isArray(targets) ? targets : [])
    .map((target) => String(target || '').trim())
    .filter(Boolean)
    .forEach((target) => {
      resolveOneTarget(target, cwd).forEach((file) => {
        uniqueFiles.add(file);
      });
    });

  return Array.from(uniqueFiles).sort();
}

function resolveOneTarget(target, cwd) {
  const targetPath = path.resolve(cwd, target);
  if (!fs.existsSync(targetPath)) {
    return [];
  }

  const stat = fs.statSync(targetPath);
  if (stat.isFile()) {
    return isLanguageActive(targetPath) ? [targetPath] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return collectSupportedFiles(targetPath);
}

function collectSupportedFiles(rootDir) {
  const files = [];
  const visit = (currentDir) => {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    entries.forEach((entry) => {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (!DEFAULT_IGNORE_DIRS.has(entry.name)) {
          visit(fullPath);
        }
        return;
      }
      if (entry.isFile() && isLanguageActive(fullPath)) {
        files.push(fullPath);
      }
    });
  };

  visit(rootDir);
  return files;
}

module.exports = {
  DEFAULT_IGNORE_DIRS,
  resolveCliTargetFiles,
};
