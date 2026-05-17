'use strict';

const { performance } = require('perf_hooks');
const { analyzeText } = require('./analyzer');

function buildJavaScriptFixture(lineCount) {
  return Array.from({ length: lineCount }, (_value, index) => {
    const name = `total${index}`;
    return `function ${name}(value, expected) { return value == expected ? value : expected }`;
  }).join('\n');
}

function buildPythonFixture(lineCount) {
  return Array.from({ length: lineCount }, (_value, index) => [
    `def normalize_${index}(value):`,
    '    if value == None:',
    '        return value',
    '    return value',
  ].join('\n')).join('\n');
}

function profileCase(testCase) {
  const startedAt = performance.now();
  const issues = analyzeText(testCase.file, testCase.text, {
    analysisMode: testCase.analysisMode || 'light',
  });
  const durationMs = performance.now() - startedAt;

  return {
    name: testCase.name,
    file: testCase.file,
    analysisMode: testCase.analysisMode || 'light',
    lineCount: testCase.text.split('\n').length,
    issueCount: issues.length,
    durationMs: Number(durationMs.toFixed(3)),
  };
}

function buildAnalyzerProfileReport(options = {}) {
  const lineCount = Number.isFinite(options.lineCount) && options.lineCount > 0
    ? Math.floor(options.lineCount)
    : 180;
  const cases = [
    {
      name: 'javascript-light',
      file: 'profile.fixture.js',
      text: buildJavaScriptFixture(lineCount),
      analysisMode: 'light',
    },
    {
      name: 'python-light',
      file: 'profile.fixture.py',
      text: buildPythonFixture(Math.max(1, Math.floor(lineCount / 4))),
      analysisMode: 'light',
    },
  ];
  let results = [];
  results = cases.map(profileCase);
  const totalDurationMs = results.reduce((total, result) => total + result.durationMs, 0);

  return {
    ok: true,
    aiMode: 'local-fallback',
    caseCount: results.length,
    totalDurationMs: Number(totalDurationMs.toFixed(3)),
    results,
  };
}

module.exports = {
  buildAnalyzerProfileReport,
};
