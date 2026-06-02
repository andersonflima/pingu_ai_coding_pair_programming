'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { offlineCoverageReport, REQUIRED_OFFLINE_FEATURES } = require('../lib/offline-coverage');
const { languageCapabilityRegistry } = require('../lib/language-capabilities');

test('offline coverage reaches every required feature for mapped languages', () => {
  const report = offlineCoverageReport();

  assert.equal(report.ok, true);
  assert.equal(report.percent, 100);
  assert.deepEqual(report.requiredFeatures, [...REQUIRED_OFFLINE_FEATURES]);
  assert.ok(report.languages.length > 0);
  report.languages.forEach((language) => {
    const capability = languageCapabilityRegistry().find((entry) => entry.id === language.id);
    const expectedFeatures = REQUIRED_OFFLINE_FEATURES.filter((feature) =>
      capability.editorFeatures.includes(feature));

    assert.equal(language.ok, true, language.id);
    assert.deepEqual(
      language.features.map((feature) => feature.feature),
      expectedFeatures,
    );
  });
});
