'use strict';

const assert = require('assert/strict');
const test = require('node:test');
const path = require('node:path');

const generation = require('../lib/generation');

// Linguagens sem scaffold CRUD nativo devem gerar um blueprint document-only
// (contexto arquitetural + .gitignore), nunca um scaffold cross-language em
// JavaScript dentro de um projeto Java/PHP/Kotlin/etc.
const DOCUMENT_ONLY_CASES = [
  { lang: 'java', file: '/tmp/pingu-blueprint/Sample.java', ext: '.java' },
  { lang: 'csharp', file: '/tmp/pingu-blueprint/Sample.cs', ext: '.cs' },
  { lang: 'kotlin', file: '/tmp/pingu-blueprint/App.kt', ext: '.kt' },
  { lang: 'swift', file: '/tmp/pingu-blueprint/App.swift', ext: '.swift' },
  { lang: 'scala', file: '/tmp/pingu-blueprint/App.scala', ext: '.scala' },
  { lang: 'php', file: '/tmp/pingu-blueprint/sample.php', ext: '.php' },
];

for (const { lang, file, ext } of DOCUMENT_ONLY_CASES) {
  test(`blueprint ${lang} gera contexto document-only sem scaffold cross-language`, () => {
    const issues = generation.checkCommentTask(['//** bff para crud de produto'], file);

    assert.ok(issues.length >= 1, 'deveria produzir ao menos o documento de contexto');

    const targets = issues.map((issue) => issue.action && issue.action.target_file).filter(Boolean);
    const hasContextDocument = targets.some((target) => target.endsWith(path.join('contexts', 'bff-crud-produto.md')));
    assert.ok(hasContextDocument, 'deveria gerar o documento de contexto arquitetural');

    const foreignSource = targets.filter((target) => /\.(js|ts|py|go|rs)$/.test(target));
    assert.deepEqual(foreignSource, [], `nenhum arquivo de codigo de outra linguagem deveria ser gerado para ${ext}`);

    for (const issue of issues) {
      assert.equal(issue.kind, 'context_file');
    }
  });
}
