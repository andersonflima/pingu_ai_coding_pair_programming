'use strict';

// Resolucao de modulos locais e coleta de nomes exportados em JavaScript,
// extraidas do analyzer para isolar o dominio que toca o sistema de arquivos
// (resolucao de caminho relativo) e o parsing de exports ESM/CommonJS. A coleta
// de exports Python permanece no analyzer por depender de helpers de escopo
// compartilhados. Funcoes sem estado proprio: o cache e injetado por parametro.

const fs = require('fs');
const path = require('path');
const { isPythonLikeExtension } = require('./language-profiles');
const { isRelativeModuleSpecifier } = require('./analyzer-import-bindings');
const { splitTopLevelParams, stripInlineComment } = require('./support');

function resolveLocalModuleFile(file, importSource, ext, cache) {
  const cacheKey = `resolve:${file}:${ext}:${importSource}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const resolvedFile = isPythonLikeExtension(ext)
    ? resolvePythonLocalModuleFile(file, importSource)
    : resolveJavaScriptLocalModuleFile(file, importSource);
  cache.set(cacheKey, resolvedFile);
  return resolvedFile;
}

function resolveJavaScriptLocalModuleFile(file, importSource) {
  if (!isRelativeModuleSpecifier(importSource)) {
    return '';
  }

  const importerDir = path.dirname(path.resolve(String(file || '')));
  const targetBase = path.resolve(importerDir, String(importSource || '').trim());
  const explicitExtension = path.extname(targetBase).toLowerCase();
  const defaultExtensions = uniqueValues([
    path.extname(String(file || '')).toLowerCase(),
    '.js',
    '.jsx',
    '.ts',
    '.tsx',
    '.mjs',
    '.cjs',
  ]);
  const candidates = explicitExtension
    ? [targetBase]
    : uniqueValues([
      targetBase,
      ...defaultExtensions.map((extension) => `${targetBase}${extension}`),
      ...defaultExtensions.map((extension) => path.join(targetBase, `index${extension}`)),
    ]);

  return firstExistingFile(candidates);
}

function resolvePythonLocalModuleFile(file, importSource) {
  const normalizedSource = String(importSource || '').trim();
  const match = normalizedSource.match(/^(\.+)(.*)$/);
  if (!match || !match[1]) {
    return '';
  }

  let importerDir = path.dirname(path.resolve(String(file || '')));
  for (let level = 1; level < match[1].length; level += 1) {
    importerDir = path.dirname(importerDir);
  }

  const moduleSuffix = String(match[2] || '').replace(/^\./, '');
  const targetBase = moduleSuffix
    ? path.join(importerDir, ...moduleSuffix.split('.').filter(Boolean))
    : importerDir;
  const explicitExtension = path.extname(targetBase).toLowerCase();
  const candidates = explicitExtension === '.py'
    ? [targetBase]
    : uniqueValues([
      path.join(targetBase, '__init__.py'),
      `${targetBase}.py`,
    ]);

  return firstExistingFile(candidates);
}

function firstExistingFile(candidates) {
  for (const candidate of uniqueValues(candidates)) {
    if (!candidate) {
      continue;
    }
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_error) {
      continue;
    }
  }
  return '';
}

function uniqueValues(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function collectJavaScriptExportNames(sourceText) {
  const names = new Set();
  const source = String(sourceText || '');
  const lines = source.split(/\r?\n/);

  lines.forEach((rawLine) => {
    const line = String(stripInlineComment(rawLine, '.js') || '');
    const functionMatch = line.match(/^\s*export\s+(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (functionMatch && functionMatch[1]) {
      names.add(functionMatch[1]);
    }

    const classMatch = line.match(/^\s*export\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (classMatch && classMatch[1]) {
      names.add(classMatch[1]);
    }

    const valueMatch = line.match(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
    if (valueMatch && valueMatch[1]) {
      names.add(valueMatch[1]);
    }

    const memberExportMatch = line.match(/^\s*(?:module\.)?exports\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/);
    if (memberExportMatch && memberExportMatch[1]) {
      names.add(memberExportMatch[1]);
    }
  });

  [...source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*['"][^'"]+['"])?/g)].forEach((match) => {
    parseJavaScriptNamedExportList(match[1]).forEach((name) => names.add(name));
  });
  [...source.matchAll(/\bmodule\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/g)].forEach((match) => {
    parseCommonJsObjectExportList(match[1]).forEach((name) => names.add(name));
  });

  return Array.from(names);
}

function parseJavaScriptNamedExportList(raw) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => {
      const normalized = String(token || '').trim();
      const match = normalized.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
      if (!match || !match[1]) {
        return '';
      }
      return match[2] || match[1];
    })
    .filter(Boolean);
}

function parseCommonJsObjectExportList(raw) {
  return splitTopLevelParams(String(raw || ''))
    .map((token) => extractCommonJsObjectExportName(token))
    .filter(Boolean);
}

function extractCommonJsObjectExportName(token) {
  const normalized = String(token || '').trim().replace(/,$/, '');
  if (!normalized || normalized.startsWith('...')) {
    return '';
  }

  const keyToken = normalized.includes(':')
    ? normalized.split(':')[0].trim()
    : normalized;
  const quotedMatch = keyToken.match(/^['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]$/);
  if (quotedMatch && quotedMatch[1]) {
    return quotedMatch[1];
  }

  const bracketMatch = keyToken.match(/^\[\s*['"]([A-Za-z_$][A-Za-z0-9_$]*)['"]\s*\]$/);
  if (bracketMatch && bracketMatch[1]) {
    return bracketMatch[1];
  }

  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(keyToken) ? keyToken : '';
}

module.exports = {
  resolveLocalModuleFile,
  collectJavaScriptExportNames,
};
