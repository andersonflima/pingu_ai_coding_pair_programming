'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkHardcodedSecrets } = require('../lib/analyzer-secrets');

function run(line, kind) {
  return checkHardcodedSecrets([line], 'sample' + (kind || '.js'), kind || '.js', {});
}

test('sinaliza tokens de provedor conhecidos', () => {
  // Os literais sao montados em runtime para nao gravar um padrao de segredo
  // contiguo no arquivo (que o secret scanning do repositorio bloquearia).
  const aws = 'AKIA' + 'ABCDEFGHIJ123456';
  const github = 'ghp' + '_' + 'a'.repeat(36);
  const stripe = 'sk' + '_live_' + 'b'.repeat(24);
  const privateKey = '-----BEGIN RSA ' + 'PRIVATE KEY-----';
  assert.equal(run(`const k = "${aws}";`)[0].kind, 'hardcoded_secret');
  assert.equal(run(`token = "${github}"`)[0].kind, 'hardcoded_secret');
  assert.equal(run(`STRIPE = "${stripe}"`)[0].kind, 'hardcoded_secret');
  assert.equal(run(`const key = "${privateKey}";`).length, 1);
});

test('sinaliza atribuicao a nome sensivel com literal real', () => {
  const issues = run('const password = "S3nh@SuperSecreta!";');
  assert.equal(issues.length, 1);
  assert.match(issues[0].message, /password/);
  assert.match(issues[0].suggestion, /ambiente|cofre/);
});

test('ignora placeholders e leitura de ambiente', () => {
  assert.deepEqual(run('const password = "changeme";'), []);
  assert.deepEqual(run('const apiKey = "your-api-key";'), []);
  assert.deepEqual(run('const secret = "<your-secret>";'), []);
  assert.deepEqual(run('const token = process.env.TOKEN;'), []);
  assert.deepEqual(run('password = os.environ["PWD"]', '.py'), []);
  assert.deepEqual(run('const secret = "${SECRET}";'), []);
});

test('ignora atribuicao a nome nao sensivel', () => {
  assert.deepEqual(run('const title = "Minha aplicacao web";'), []);
});

test('respeita o focusRange', () => {
  const issues = checkHardcodedSecrets(
    ['const ok = 1;', 'const password = "S3nh@Real123";'],
    'a.js',
    '.js',
    { focusRange: { start: 1, end: 1 } },
  );
  assert.deepEqual(issues, []);
});
