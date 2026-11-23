import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';

export function isReservedBackendPath(decodedPath: string): boolean {
  return decodedPath === '/api' || decodedPath.startsWith('/api/') ||
    decodedPath === '/mcp' || decodedPath.startsWith('/mcp/') ||
    decodedPath.startsWith('/.well-known/') || decodedPath === '/register';
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain', '.wasm': 'application/wasm',
};

export function createDashboardStaticRoutes(dir: string): FastifyPluginAsync {
  return async (app) => {
    const root = path.resolve(dir);
    const index = path.join(root, 'index.html');
    const indexStat = await stat(index).catch(() => null);
    if (!indexStat?.isFile()) throw new Error(`DASHBOARD_DIR index.html is not a file: ${index}`);

    async function serve(req: FastifyRequest, reply: FastifyReply) {
      let decodedPath: string;
      try { decodedPath = decodeURIComponent((req.raw.url ?? req.url).split('?')[0]); }
      catch { return reply.code(400).send({ error: 'Bad Request' }); }
      if (isReservedBackendPath(decodedPath)) return reply.code(404).send({ error: 'Not Found' });
      const resolved = path.resolve(root, '.' + decodedPath);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) return reply.code(404).send({ error: 'Not Found' });
      const ext = path.extname(decodedPath);
      if (decodedPath === '/' || !ext) {
        return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(await readFile(index));
      }
      const fileStat = await stat(resolved).catch(() => null);
      if (!fileStat?.isFile()) return reply.code(404).send({ error: 'Not Found' });
      return reply.type(contentTypes[ext.toLowerCase()] ?? 'application/octet-stream').send(await readFile(resolved));
    }
    app.get('/', { config: { publicStatic: true } }, serve);
    app.get('/*', { config: { publicStatic: true } }, serve);
  };
}
