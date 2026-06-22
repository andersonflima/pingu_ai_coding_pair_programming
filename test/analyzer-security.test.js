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

test('sql_injection: query montada por concatenacao/template', () => {
  assert.equal(run('cursor.execute("SELECT * FROM users WHERE id = " + uid)', '.py')[0].kind, 'sql_injection');
  assert.equal(run('db.query(`UPDATE t SET n = ${name} WHERE id = 1`)', '.js')[0].kind, 'sql_injection');
});

test('sql_injection: ignora query parametrizada e "from" de import', () => {
  assert.deepEqual(run('cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))', '.py'), []);
  assert.deepEqual(run('import foo from `./${mod}`', '.js'), []);
  assert.deepEqual(run('const sql = "SELECT 1";', '.js'), []);
});

test('weak_crypto: md5/sha1 em contexto de senha/segredo', () => {
  assert.equal(run('password_hash = hashlib.sha1(password.encode())', '.py')[0].kind, 'weak_crypto');
  assert.equal(run('const tokenHash = crypto.createHash("md5").update(secret)', '.js')[0].kind, 'weak_crypto');
});

test('weak_crypto: ignora md5/sha1 de cache/checksum (sem contexto de seguranca)', () => {
  assert.deepEqual(run('const cacheHash = crypto.createHash("sha1").update(payload)', '.js'), []);
  assert.deepEqual(run('etag = hashlib.md5(body).hexdigest()', '.py'), []);
});

test('path_traversal: leitura de arquivo com caminho de request', () => {
  assert.equal(run('fs.readFile("./files/" + req.params.name, cb)', '.js')[0].kind, 'path_traversal');
  assert.equal(run('with open("data/" + request.args["f"]) as fh:', '.py')[0].kind, 'path_traversal');
});

test('path_traversal: ignora caminho estatico ou sem entrada do usuario', () => {
  assert.deepEqual(run('fs.readFile("./config.json", cb)', '.js'), []);
  assert.deepEqual(run('const p = path.join(base, child); fs.readFile(p, cb)', '.js'), []);
  assert.deepEqual(run('with open("data/fixed.txt") as fh:', '.py'), []);
});

test('xss: innerHTML, document.write e dangerouslySetInnerHTML dinamicos', () => {
  assert.equal(run('el.innerHTML = "<b>" + userName + "</b>";', '.js')[0].kind, 'xss');
  assert.equal(run('document.write(`<p>${comment}</p>`);', '.js')[0].kind, 'xss');
  assert.equal(run('<div dangerouslySetInnerHTML={{ __html: rawHtml }} />', '.jsx')[0].kind, 'xss');
});

test('xss: ignora atribuicao estatica e textContent', () => {
  assert.deepEqual(run('el.innerHTML = "<b>ok</b>";', '.js'), []);
  assert.deepEqual(run('el.textContent = userName;', '.js'), []);
  assert.deepEqual(run('<div dangerouslySetInnerHTML={{ __html: "<b>ok</b>" }} />', '.jsx'), []);
});

test('ssrf: requisicao HTTP com URL de entrada do usuario', () => {
  assert.equal(run('const r = await fetch(req.query.url);', '.js')[0].kind, 'ssrf');
  assert.equal(run('resp = requests.get(request.args["target"])', '.py')[0].kind, 'ssrf');
});

test('ssrf: ignora URL constante ou sem marcador de input', () => {
  assert.deepEqual(run('const r = await fetch("https://api.example.com/v1");', '.js'), []);
  assert.deepEqual(run('resp = requests.get(BASE_URL + "/health")', '.py'), []);
});

test('path_traversal/xss/ssrf: nao disparam dentro de string ou comentario', () => {
  assert.deepEqual(run('const note = "fs.readFile(req.params.x + y)";', '.js'), []);
  assert.deepEqual(run('// el.innerHTML = a + b', '.js'), []);
});
