'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function parseVersions(rawOutput) {
  try {
    const parsed = JSON.parse(String(rawOutput || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } catch (_error) {
    return [];
  }
}

function readPublishedVersions(packageName) {
  const result = spawnSync('npm', ['view', packageName, 'versions', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (/E404|404 Not Found/i.test(output)) {
      return [];
    }
    throw new Error(output.trim() || `Falha ao consultar versoes publicadas de ${packageName}`);
  }

  return parseVersions(result.stdout);
}

function run() {
  const packageName = String(manifest.name || '').trim();
  const packageVersion = String(manifest.version || '').trim();

  if (!packageName || !packageVersion) {
    throw new Error('package.json precisa declarar name e version para release.');
  }

  const publishedVersions = new Set(readPublishedVersions(packageName));
  if (publishedVersions.has(packageVersion)) {
    throw new Error(
      `${packageName}@${packageVersion} ja existe no npm. Atualize package.json antes de publicar.`,
    );
  }

  process.stdout.write(`release version ok: ${packageName}@${packageVersion}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
}
