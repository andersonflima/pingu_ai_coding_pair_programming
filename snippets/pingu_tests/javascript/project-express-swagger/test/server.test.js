const request = require('supertest');
const { app, users } = require('../src/server');

describe('Pingu JS API', () => {
  it('deve retornar health', async () => {
    await request(app)
      .get('/health')
      .expect(200)
      .expect((res) => {
        if (res.body.status !== 'ok') {
          throw new Error(`status inesperado ${res.body.status}`);
        }
      });
  });

  it('deve listar usuarios', async () => {
    await request(app)
      .get('/users')
      .expect(200)
      .expect((res) => {
        if (!Array.isArray(res.body)) {
          throw new Error('esperado array de usuarios');
        }
        if (res.body.length !== users.length) {
          throw new Error('quantidade divergente');
        }
      });
  });
});
