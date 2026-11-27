import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import scoreboardHandler from './api/scoreboard.js';
import gameHandler from './api/game.js';
import teamsHandler from './api/teams.js';

const root = fileURLToPath(new URL('./', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
export const contentSecurityPolicy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://a.espncdn.com https://media.formula1.com; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self';";

export function createScorebugServer({ publicDir = resolve(root, 'public') } = {}) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', contentSecurityPolicy);
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/scoreboard') return await scoreboardHandler(req, res);
      if (url.pathname === '/api/game') return await gameHandler(req, res);
      if (url.pathname === '/api/teams') return await teamsHandler(req, res);
      if (!['GET', 'HEAD'].includes(req.method)) {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end('Method not allowed');
      }
      const pathname = decodeURIComponent(url.pathname);
      const path = resolve(publicDir, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!path.startsWith(`${resolve(publicDir)}${sep}`)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      const info = await stat(path);
      if (!info.isFile()) throw Object.assign(new Error('Not found'), { code: 'ENOENT' });
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const status = error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : error instanceof URIError ? 400 : 500;
      res.writeHead(status, { 'Content-Type': 'text/plain' });
      res.end(status === 404 ? 'Not found' : status === 400 ? 'Bad request' : 'Unable to serve this request');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const server = createScorebugServer();
  server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Scorebug → http://localhost:${port}`));
}
