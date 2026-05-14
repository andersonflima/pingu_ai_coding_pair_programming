'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'package.json');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');
const CHANGELOG_PATH = path.join(ROOT, 'CHANGELOG.md');

const args = process.argv.slice(2);
const RELEASE_BUMP_MODE = normalizeReleaseBumpMode(
  getArgValue(args, '--bump')
  || process.env.RELEASE_BUMP
  || process.env.PINGU_RELEASE_BUMP
  || process.env.RELEASE_BUMP_MODE
  || 'patch',
);
const RELEASE_SAFE_MODE = parseBoolean(getArgValue(args, '--safe-mode') || process.env.RELEASE_SAFE_MODE || 'false');
const RELEASE_SCOPE = getArgValue(args, '--scope') || 'release';
const IS_PREPARE = args.includes('--prepare');

function getArgValue(argv, flag) {
  const index = argv.indexOf(flag);
  if (index === -1 || index + 1 >= argv.length) {
    return null;
  }
  return argv[index + 1];
}

function parseBoolean(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFile(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function parseSemver(version) {
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

function formatSemver({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function normalizeReleaseBumpMode(rawMode) {
  const mode = String(rawMode || 'patch').trim().toLowerCase();
  if (mode === 'major' || mode === 'minor' || mode === 'patch') {
    return mode;
  }
  return 'patch';
}

function nextAvailableVersion(currentVersion, existingVersions, bumpMode) {
  const parsed = parseSemver(currentVersion);
  if (!parsed) {
    throw new Error(`A versao atual do package.json (${currentVersion}) nao segue semver X.Y.Z. Atualize manualmente.`);
  }

  let major = parsed.major;
  let minor = parsed.minor;
  let patch = parsed.patch;

  if (bumpMode === 'major') {
    major += 1;
    minor = 0;
    patch = 0;
  } else if (bumpMode === 'minor') {
    minor += 1;
    patch = 0;
  } else {
    patch += 1;
  }

  while (existingVersions.has(formatSemver({ major, minor, patch }))) {
    patch += 1;
  }

  return formatSemver({ major, minor, patch });
}

function runCommand(command, commandArgs) {
  return spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

function parseVersions(rawOutput) {
  try {
    const parsed = JSON.parse(String(rawOutput || '[]'));
    if (Array.isArray(parsed)) {
      return parsed.map(String);
    }
    if (typeof parsed === 'string') {
      return [parsed];
    }
    return [];
  } catch (_error) {
    return [];
  }
}

function readPublishedVersions(packageName) {
  const result = runCommand('npm', ['view', packageName, 'versions', '--json']);

  if (result.status !== 0) {
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    if (/E404|404 Not Found/i.test(output)) {
      return [];
    }
    throw new Error(`${output.trim() || 'Falha ao consultar'} versoes publicadas de ${packageName}.`);
  }

  return parseVersions(result.stdout);
}

function collectLocalVersionsFromHistory(lockVersion) {
  const versions = new Set();

  const pushVersion = (value) => {
    const parsed = parseSemver(value);
    if (parsed) {
      versions.add(formatSemver(parsed));
    }
  };

  const manifest = readJsonFile(MANIFEST_PATH);
  const lockfile = readJsonFile(LOCK_PATH);

  pushVersion(manifest.version || '');
  pushVersion(lockfile.version || '');
  pushVersion(lockfile.packages && lockfile.packages[''] ? lockfile.packages[''].version || '' : '');
  if (lockVersion) {
    pushVersion(lockVersion);
  }

  const gitTags = runCommand('git', ['tag', '--list', '--sort=-v:refname']);
  if (gitTags.status === 0) {
    for (const rawLine of (gitTags.stdout || '').split('\n')) {
      const match = String(rawLine || '').trim().match(/^v?(\d+\.\d+\.\d+)$/);
      if (match) {
        pushVersion(match[1]);
      }
    }
  }

  if (fs.existsSync(CHANGELOG_PATH)) {
    const changelog = fs.readFileSync(CHANGELOG_PATH, 'utf8');
    const headingMatches = changelog.match(/^##\s+(\d+\.\d+\.\d+)(?:\s|$)/gm) || [];
    for (const line of headingMatches) {
      const match = line.match(/\d+\.\d+\.\d+/);
      if (match) {
        pushVersion(match[0]);
      }
    }
  }

  return versions;
}

function syncPackageVersion(nextVersion) {
  const manifest = readJsonFile(MANIFEST_PATH);
  const lockfile = readJsonFile(LOCK_PATH);

  manifest.version = nextVersion;
  lockfile.version = nextVersion;
  if (lockfile.packages && lockfile.packages['']) {
    lockfile.packages[''].version = nextVersion;
  }

  writeJsonFile(MANIFEST_PATH, manifest);
  writeJsonFile(LOCK_PATH, lockfile);
}

function appendChangelogEntry({ packageName, currentVersion, nextVersion }) {
  if (!fs.existsSync(CHANGELOG_PATH)) {
    return false;
  }

  const existing = fs.readFileSync(CHANGELOG_PATH, 'utf8');
  const headingRegex = new RegExp(`^##\\s+${escapeRegExp(nextVersion)}\\b`, 'm');
  if (headingRegex.test(existing)) {
    return false;
  }

  const entry = `\n## ${nextVersion} - Em desenvolvimento\n\n### Antes\n\n- ${packageName}@${currentVersion} já estava publicada.\n\n### Depois\n\n- A versão foi avançada para \`${nextVersion}\` com bump ${RELEASE_BUMP_MODE}.\n\n### Motivo\n\n- Evitar falha de publicação por versão duplicada e manter rastreabilidade da decisão.\n\n### Impacto\n\n- A publicação passa a refletir a versão versionada no repositório, sem inconsistência entre source e npm.\n\n`;
  const lines = existing.split('\n');
  const firstSection = lines.findIndex((line) => line.startsWith('## '));
  const injected = entry.replace(/^\n/, '').split('\n');

  if (firstSection === -1) {
    fs.writeFileSync(CHANGELOG_PATH, `${existing.trimEnd()}\n${entry}\n`, 'utf8');
    return true;
  }

  lines.splice(firstSection, 0, ...injected);
  fs.writeFileSync(CHANGELOG_PATH, `${lines.join('\n').replace(/\n+$/, '\n')}`, 'utf8');
  return true;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function run() {
  const manifest = readJsonFile(MANIFEST_PATH);
  const packageName = String(manifest.name || '').trim();
  const packageVersion = String(manifest.version || '').trim();
  if (!packageName || !packageVersion) {
    throw new Error('package.json precisa declarar name e version para release.');
  }

  const lockfile = readJsonFile(LOCK_PATH);
  const lockVersion = String(lockfile.version || '').trim();
  const lockRootVersion = String(lockfile.packages && lockfile.packages[''] ? lockfile.packages[''].version || '' : '').trim();

  let publishedVersions = new Set();
  let source = 'npm';
  try {
    publishedVersions = new Set(readPublishedVersions(packageName));
  } catch (error) {
    if (!RELEASE_SAFE_MODE) {
      throw error;
    }

    publishedVersions = collectLocalVersionsFromHistory(lockVersion);
    if (publishedVersions.size === 0) {
      process.stderr.write(`Sem metadados locais para recuperar versão de ${packageName}.\n`);
      throw error;
    }
    source = 'local-fallback';
    process.stderr.write(`Fallback local para ${packageName}: ${Array.from(publishedVersions).join(', ')}.\n`);
  }

  let nextVersion = packageVersion;
  let reason = 'release version ok';
  let didBump = false;
  let changed = false;

  if (publishedVersions.has(packageVersion)) {
    nextVersion = nextAvailableVersion(packageVersion, publishedVersions, RELEASE_BUMP_MODE);
    reason = 'version already exists';
    didBump = true;
    changed = true;
  }

  const shouldSyncLock = (lockVersion !== nextVersion) || (lockRootVersion !== nextVersion);
  if (shouldSyncLock) {
    reason = reason === 'release version ok' ? 'lock file synced' : reason;
    changed = true;
  }

  if (IS_PREPARE) {
    process.stdout.write(`release:prepare sugerido ${packageName}@${nextVersion} (sem persistencia).\n`);
    process.stdout.write(`DECISAO: ${packageVersion} -> ${nextVersion} | motivo=${reason} | origem=${source} | bump=${RELEASE_BUMP_MODE} | scope=${RELEASE_SCOPE}\n`);
    process.stdout.write(`release version ok: ${packageName}@${nextVersion}\n`);
    return;
  }

  if (changed) {
    syncPackageVersion(nextVersion);
    process.stdout.write(`release version ajustada: ${packageName}@${nextVersion}.\n`);
  }

  if (didBump) {
    appendChangelogEntry({
      packageName,
      currentVersion: packageVersion,
      nextVersion,
    });
  }

  process.stdout.write(`DECISAO: ${packageVersion} -> ${nextVersion} | motivo=${reason} | origem=${source} | bump=${RELEASE_BUMP_MODE} | scope=${RELEASE_SCOPE}\n`);
  process.stdout.write(`release version ok: ${packageName}@${nextVersion}\n`);
}

try {
  run();
} catch (error) {
  process.stderr.write(`${error && error.message ? error.message : error}\n`);
  process.exit(1);
}
