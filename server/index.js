// HTTP static server + WebSocket game server.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

async function serveStatic(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA fallback
    const file = path.resolve(PUBLIC_DIR, '.' + rel);
    if (!file.startsWith(PUBLIC_DIR + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}

export function createGameServer() {
  const manager = new RoomManager();
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, rooms: manager.rooms.size }));
      return;
    }
    serveStatic(req, res);
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.bucket = { tokens: 40, last: Date.now() };
    ws.on('pong', () => (ws.isAlive = true));
    ws.on('message', (raw) => {
      // Token-bucket rate limit: 20 msg/s sustained, burst of 40.
      const now = Date.now();
      ws.bucket.tokens = Math.min(40, ws.bucket.tokens + ((now - ws.bucket.last) / 1000) * 20);
      ws.bucket.last = now;
      if (ws.bucket.tokens < 1) return;
      ws.bucket.tokens--;

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
      manager.handle(ws, msg);
    });
    ws.on('close', () => manager.onClose(ws));
    ws.on('error', () => {});
  });

  // Heartbeat: detect dead connections quickly so "disconnected" shows up.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 10_000);
  server.on('close', () => clearInterval(heartbeat));

  return { server, wss, manager };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createGameServer();
  server.listen(port, () => {
    console.log(`\n  UNO Online running →  http://localhost:${port}\n`);
  });
}
