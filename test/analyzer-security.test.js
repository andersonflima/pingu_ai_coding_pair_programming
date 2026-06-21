'use strict';

const assert = require('assert/strict');
const test = require('node:test');

const { checkSecurityIssues } = require('../lib/analyzer-security');

function run(line, kind) {
  return checkSecurityIssues([line], 'a' + kind, kind, {});
}

test('command_injection: eval e exec com entrada dinamica', () => {
  assert.equal(run('eval(userInput);', '.js')[0].kind, 'command_injection');
  assert.equal(run('const o = execSync("ls " + dir);', '.js')[0].kind, 'command_injection');
  assert.equal(run('os.system("rm " + path)', '.py')[0].kind, 'command_injection');
  assert.equal(run('subprocess.run(cmd, shell=True)', '.py')[0].kind, 'command_injection');
});

test('command_injection: nao acusa formas seguras', () => {
  assert.deepEqual(run('subprocess.run(["ls", path])', '.py'), []);
  assert.deepEqual(run('const x = a + b;', '.js'), []);
  assert.deepEqual(run('execFile("ls", [dir]);', '.js'), []);
});

test('unsafe_deserialization: pickle e yaml.load inseguro', () => {
  assert.equal(run('data = pickle.loads(payload)', '.py')[0].kind, 'unsafe_deserialization');
  assert.equal(run('cfg = yaml.load(text)', '.py')[0].kind, 'unsafe_deserialization');
});

test('unsafe_deserialization: yaml.safe_load e json sao seguros', () => {
  assert.deepEqual(run('cfg = yaml.safe_load(text)', '.py'), []);
  assert.deepEqual(run('cfg = json.loads(text)', '.py'), []);
});

test('nao dispara dentro de string ou em linguagem sem suporte', () => {
  assert.deepEqual(run('const msg = "use eval(x) com cuidado";', '.js'), []);
  assert.deepEqual(run('eval(userInput);', '.go'), []);
});
