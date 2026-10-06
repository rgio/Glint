/**
 * Serves the web app's static export the way production hosting must (see docs/deploy.md):
 * files as they are, clean URLs (/settings → settings.html), the dynamic routes rewritten to
 * their pre-rendered shells, and +not-found.html with a 404 for anything else.
 */
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

import { WEB_PORT } from './ports';

const root = process.argv[2] ?? '.web-export';

const REWRITES: [RegExp, string][] = [
  [/^\/episode\/[^/]+$/, '/episode/[id].html'],
  [/^\/podcast\/[^/]+$/, '/podcast/[id].html'],
];
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
};

const isFile = async (path: string) => (await stat(join(root, normalize(path))).catch(() => null))?.isFile() ?? false;

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  let file = path === '/' ? '/index.html' : path;
  for (const [pattern, target] of REWRITES) if (pattern.test(path)) file = target;
  if (!(await isFile(file)) && (await isFile(`${file}.html`))) file = `${file}.html`;
  let status = 200;
  if (!(await isFile(file))) {
    file = '/+not-found.html';
    status = 404;
  }
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(join(root, normalize(file))));
}).listen(WEB_PORT, () => console.log(`Serving ${root} on ${WEB_PORT}`));
