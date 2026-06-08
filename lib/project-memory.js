'use strict';

const fs = require('fs');
const path = require('path');
const { pathExists, resolveProjectRoot, safeReadDir } = require('./project-paths');
const projectMemoryCache = new Map();

function safeReadFile(targetPath) {
  try {
    return fs.readFileSync(targetPath, 'utf8');
  } catch (_error) {
    return '';
  }
}

function parseContextMetadata(content) {
  const metadata = {};
  String(content || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .forEach((line) => {
      const match = String(line || '').match(/^([a-z_]+):\s*(.+?)\s*$/i);
      if (!match || !match[1]) {
        return;
      }
      metadata[String(match[1] || '').trim().toLowerCase()] = String(match[2] || '').trim();
    });
  return metadata;
}

function listContextFiles(contextsDir) {
  return safeReadDir(contextsDir)
    .filter((name) => /\.md$/i.test(name))
    .map((name) => {
      const filePath = path.join(contextsDir, name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(filePath).mtimeMs;
      } catch (_error) {
        mtimeMs = 0;
      }
      return {
        filePath,
        name,
        mtimeMs,
      };
    })
    .sort((left, right) => {
      const leftActive = /(?:^|[-_])active\.md$/i.test(left.name) ? 1 : 0;
      const rightActive = /(?:^|[-_])active\.md$/i.test(right.name) ? 1 : 0;
      if (leftActive !== rightActive) {
        return rightActive - leftActive;
      }
      return right.mtimeMs - left.mtimeMs;
    });
}

function loadContextMemory(projectRoot) {
  const contextsDir = path.join(projectRoot, '.pingu-dev-agent', 'contexts');
  if (!pathExists(contextsDir)) {
    return {
      filePath: '',
      metadata: {},
      document: '',
    };
  }

  const [selected] = listContextFiles(contextsDir);
  if (!selected) {
    return {
      filePath: '',
      metadata: {},
      document: '',
    };
  }

  const document = safeReadFile(selected.filePath);
  return {
    filePath: selected.filePath,
    metadata: parseContextMetadata(document),
    document,
  };
}

function readReadmeMemory(projectRoot) {
  const readmePath = ['README.md', 'Readme.md', 'readme.md']
    .map((name) => path.join(projectRoot, name))
    .find((candidate) => pathExists(candidate));
  if (!readmePath) {
    return {
      title: '',
      summary: '',
    };
  }

  const content = safeReadFile(readmePath).replace(/\r\n/g, '\n');
  const titleMatch = content.match(/^#\s+(.+?)\s*$/m);
  const summaryMatch = content
    .split('\n')
    .map((line) => String(line || '').trim())
    .find((line) => line && !/^#/.test(line) && !/^</.test(line));

  return {
    title: titleMatch && titleMatch[1] ? titleMatch[1].trim() : '',
    summary: summaryMatch || '',
  };
}

function readPackageJsonMemory(projectRoot) {
  const packagePath = path.join(projectRoot, 'package.json');
  if (!pathExists(packagePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(safeReadFile(packagePath));
    return {
      ecosystem: 'node',
      projectName: String(parsed.name || '').trim(),
      moduleType: String(parsed.type || '').trim(),
      scriptNames: Object.keys(parsed.scripts || {}).slice(0, 6),
    };
  } catch (_error) {
    return null;
  }
}

function readPyprojectMemory(projectRoot) {
  const pyprojectPath = path.join(projectRoot, 'pyproject.toml');
  if (!pathExists(pyprojectPath)) {
    return null;
  }

  const content = safeReadFile(pyprojectPath);
  const nameMatch = content.match(/\[project\][\s\S]*?\nname\s*=\s*["']([^"']+)["']/);
  return {
    ecosystem: 'python',
    projectName: nameMatch && nameMatch[1] ? String(nameMatch[1]).trim() : '',
    moduleType: '',
    scriptNames: [],
  };
}

function readMixMemory(projectRoot) {
  const mixPath = path.join(projectRoot, 'mix.exs');
  if (!pathExists(mixPath)) {
    return null;
  }

  const content = safeReadFile(mixPath);
  const appMatch = content.match(/\bapp:\s*:([a-zA-Z0-9_]+)/);
  return {
    ecosystem: 'elixir',
    projectName: appMatch && appMatch[1] ? String(appMatch[1]).trim() : '',
    moduleType: '',
    scriptNames: [],
  };
}

function readGoMemory(projectRoot) {
  const goModPath = path.join(projectRoot, 'go.mod');
  if (!pathExists(goModPath)) {
    return null;
  }

  const content = safeReadFile(goModPath);
  const moduleMatch = content.match(/^module\s+(.+?)\s*$/m);
  return {
    ecosystem: 'go',
    projectName: moduleMatch && moduleMatch[1] ? String(moduleMatch[1]).trim() : '',
    moduleType: '',
    scriptNames: [],
  };
}

function readCargoMemory(projectRoot) {
  const cargoPath = path.join(projectRoot, 'Cargo.toml');
  if (!pathExists(cargoPath)) {
    return null;
  }

  const content = safeReadFile(cargoPath);
  const nameMatch = content.match(/\[package\][\s\S]*?\nname\s*=\s*["']([^"']+)["']/);
  return {
    ecosystem: 'rust',
    projectName: nameMatch && nameMatch[1] ? String(nameMatch[1]).trim() : '',
    moduleType: '',
    scriptNames: [],
  };
}

function readGemMemory(projectRoot) {
  const gemfilePath = path.join(projectRoot, 'Gemfile');
  if (!pathExists(gemfilePath)) {
    return null;
  }

  return {
    ecosystem: 'ruby',
    projectName: path.basename(projectRoot),
    moduleType: '',
    scriptNames: [],
  };
}

function loadManifestMemory(projectRoot) {
  return readPackageJsonMemory(projectRoot)
    || readPyprojectMemory(projectRoot)
    || readMixMemory(projectRoot)
    || readGoMemory(projectRoot)
    || readCargoMemory(projectRoot)
    || readGemMemory(projectRoot)
    || {
      ecosystem: '',
      projectName: path.basename(projectRoot),
      moduleType: '',
      scriptNames: [],
    };
}

function buildMemoryHints(memory) {
  const hints = [];
  if (memory.architecture) {
    hints.push(`arquitetura ${memory.architecture}`);
  }
  if (memory.entity) {
    hints.push(`entidade ${memory.entity}`);
  }
  if (memory.sourceRoot) {
    hints.push(`source_root ${memory.sourceRoot}`);
  }
  if (memory.ecosystem) {
    hints.push(`stack ${memory.ecosystem}`);
  }
  if (memory.moduleType) {
    hints.push(`module_type ${memory.moduleType}`);
  }
  if (memory.projectName) {
    hints.push(`projeto ${memory.projectName}`);
  }
  return hints;
}

function loadProjectMemory(file) {
  const projectRoot = resolveProjectRoot(file);
  if (projectMemoryCache.has(projectRoot)) {
    return projectMemoryCache.get(projectRoot);
  }

  const contextMemory = loadContextMemory(projectRoot);
  const readmeMemory = readReadmeMemory(projectRoot);
  const manifestMemory = loadManifestMemory(projectRoot);
  const metadata = contextMemory.metadata || {};

  const memory = {
    projectRoot,
    projectName: String(manifestMemory.projectName || '').trim(),
    ecosystem: String(manifestMemory.ecosystem || '').trim(),
    moduleType: String(manifestMemory.moduleType || '').trim(),
    scriptNames: Array.isArray(manifestMemory.scriptNames) ? manifestMemory.scriptNames : [],
    readmeTitle: String(readmeMemory.title || '').trim(),
    readmeSummary: String(readmeMemory.summary || '').trim(),
    contextFile: String(contextMemory.filePath || '').trim(),
    architecture: String(metadata.architecture || '').trim(),
    blueprintType: String(metadata.blueprint_type || '').trim(),
    entity: String(metadata.entity || '').trim(),
    sourceRoot: String(metadata.source_root || '').trim(),
    sourceExt: String(metadata.source_ext || '').trim(),
    contextSummary: String(metadata.summary || '').trim(),
  };

  const cachedMemory = {
    ...memory,
    hints: buildMemoryHints(memory),
  };
  projectMemoryCache.set(projectRoot, cachedMemory);
  return cachedMemory;
}

function summarizeProjectMemory(memory) {
  const hints = Array.isArray(memory && memory.hints) ? memory.hints : [];
  return hints.join(' | ');
}

module.exports = {
  loadProjectMemory,
  resolveProjectRoot,
  summarizeProjectMemory,
};
