const express = require('express');
const path = require('node:path');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');

const app = express();
app.use(express.json());

const users = [
  { id: 1, name: 'Ana', email: 'ana@exemplo.com' },
  { id: 2, name: 'Bruno', email: 'bruno@exemplo.com' },
];

const openApiSpec = YAML.load(path.join(__dirname, 'openapi.yaml'));
app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'pingu-js-swagger-api' });
});

app.get('/users', (_req, res) => {
  res.json(users);
});

app.post('/users', (req, res) => {
  const nextId = users.length ? users[users.length - 1].id + 1 : 1;
  const payload = req.body;
  const user = { id: nextId, ...payload };
  users.push(user);
  res.status(201).json(user);
});

module.exports = { app, users };

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}
