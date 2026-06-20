'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const {
  checkMarkdownTitle,
  checkMarkdownFenceIssues,
  checkTerraformRequiredVersion,
  checkDockerfileWorkdir,
} = require('../lib/analyzer-structured-text');

test('checkMarkdownTitle sinaliza documento sem H1', () => {
  assert.equal(checkMarkdownTitle(['texto sem titulo'], 'a.md').length, 1);
  assert.equal(checkMarkdownTitle(['# Titulo', 'corpo'], 'a.md').length, 0);
});

test('checkMarkdownFenceIssues detecta fence sem fechamento', () => {
  assert.equal(checkMarkdownFenceIssues(['```js', 'code'], 'a.md', '.md').length, 1);
  assert.equal(checkMarkdownFenceIssues(['```js', 'code', '```'], 'a.md', '.md').length, 0);
  assert.equal(checkMarkdownFenceIssues(['```js'], 'a.js', '.js').length, 0);
});

test('checkTerraformRequiredVersion sinaliza ausencia de required_version', () => {
  assert.equal(checkTerraformRequiredVersion(['resource "x" "y" {}'], 'a.tf').length, 1);
  assert.equal(checkTerraformRequiredVersion(['terraform {', '  required_version = ">= 1.5.0"', '}', 'resource "x" "y" {}'], 'a.tf').length, 0);
  assert.equal(checkTerraformRequiredVersion(['# sem conteudo terraform'], 'a.tf').length, 0);
});

test('checkDockerfileWorkdir sinaliza ausencia de WORKDIR', () => {
  assert.equal(checkDockerfileWorkdir(['FROM node:20'], 'Dockerfile').length, 1);
  assert.equal(checkDockerfileWorkdir(['FROM node:20', 'WORKDIR /app'], 'Dockerfile').length, 0);
  assert.equal(checkDockerfileWorkdir(['RUN echo hi'], 'Dockerfile').length, 0);
});
