const { app, users } = require('../src/server');
const assert = require('node:assert/strict');

describe('Pingu JS API', () => {
  let server;
  let baseUrl = '';

  before(async () => {
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(() => {
    return new Promise((resolve, reject) => {
      if (!server) {
        resolve();
        return;
      }

      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  const requestJson = async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    const body = await response.json();
    return { response, body };
  };

  it('deve retornar health', async () => {
    const { response, body } = await requestJson('/health');
    assert.equal(response.status, 200);
    assert.equal(body.status, 'ok');
  });

  it('deve listar usuarios', async () => {
    const { response, body } = await requestJson('/users');
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(body.length, users.length);
  });
});
