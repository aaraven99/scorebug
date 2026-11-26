import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(new URL('public/', root), dist, { recursive: true });
console.log(`Built static app: ${fileURLToPath(dist)}`);
console.log('Vercel deploys api/scoreboard.js and api/game.js as Node.js functions. No keys or environment variables required.');
