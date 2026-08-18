const http = require('http');
const fs = require('fs');
const path = require('path');

const PORTS = [8000, 8080, 3000, 5000, 8081];
let portIdx = 0;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.gz': 'application/gzip'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(__dirname, decodeURIComponent(req.url === '/' ? 'index.html' : req.url.split('?')[0]));
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });
});

function startServer() {
  const p = PORTS[portIdx];
  server.removeAllListeners('error');
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      portIdx++;
      if (portIdx < PORTS.length) startServer();
      else console.error('No free ports available');
    }
  });
  server.listen(p, () => {
    console.log(`Server running at http://localhost:${p}/`);
  });
}

startServer();
