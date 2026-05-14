const http = require('node:http');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'pingu-docker-api' }));
    return;
  }

  res.writeHead(404);
  res.end('not found');
});

server.listen(3000, () => {
  console.log('container app running on 3000');
});
