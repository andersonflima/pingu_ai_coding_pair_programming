'use strict';

const fs = require('fs');
const path = require('path');

function defaultProjectConfig() {
  return {
    schemaVersion: 1,
    targetScope: 'current_file',
    analysisMode: 'light',
    autoFix: {
      enabled: true,
      scope: 'near_cursor',
      maxPerCheck: 2,
    },
    terminal: {
      enabled: false,
      riskMode: 'safe',
    },
    ai: {
      mode: 'prefer',
    },
  };
}

function resolveProjectConfigPath(projectRoot = process.cwd()) {
  return path.join(projectRoot, '.pingu', 'config.json');
}

function initProjectConfig(options = {}) {
  const projectRoot = path.resolve(options.cwd || process.cwd());
  const targetFile = resolveProjectConfigPath(projectRoot);
  const force = options.force === true;
  const exists = fs.existsSync(targetFile);

  if (exists && !force) {
    return {
      ok: true,
      created: false,
      overwritten: false,
      file: targetFile,
      config: JSON.parse(fs.readFileSync(targetFile, 'utf8')),
    };
  }

  const config = defaultProjectConfig();
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.writeFileSync(targetFile, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return {
    ok: true,
    created: !exists,
    overwritten: exists,
    file: targetFile,
    config,
  };
}

module.exports = {
  defaultProjectConfig,
  initProjectConfig,
  resolveProjectConfigPath,
};
