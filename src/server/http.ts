import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { ReviewService } from './review-service.js';

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new Error('JSON request required.');
  let value = '';
  for await (const chunk of request) {
    value += chunk;
    if (value.length > 16_384) throw new Error('Request is too large.');
  }
  return JSON.parse(value);
}
function string(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('A non-empty path is required.');
  return value;
}

export function createReviewServer(service = new ReviewService()) {
  return createServer(async (request, response) => {
    // The service exposes local source. Never accept cross-site browser requests or DNS-rebound hosts.
    const host = request.headers.host ?? '';
    if (!/^127\.0\.0\.1:\d+$/.test(host) && !/^localhost:\d+$/.test(host)) return json(response, 403, { error: 'Local access only.' });
    const origin = request.headers.origin;
    if (origin && ![ `http://${host}`, `http://127.0.0.1:${process.env.E2E_PORT ?? 5173}`, `http://localhost:${process.env.E2E_PORT ?? 5173}` ].includes(origin)) return json(response, 403, { error: 'Local origin required.' });
    try {
      const url = new URL(request.url ?? '/', `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'POST') return json(response, 405, { error: 'POST required.' });
        const input = await body(request);
        if (url.pathname === '/api/comparison/preview') return json(response, 200, await service.prepareComparison(string(input.repositoryPath), string(input.filePath), input.model === undefined ? undefined : string(input.model), { contextLimitBytes: input.contextLimitBytes === undefined ? undefined : Number(input.contextLimitBytes) }));
        if (url.pathname === '/api/comparison/generate') {
          const controller = new AbortController();
          const disconnected = () => { if (!response.writableEnded) controller.abort(); };
          response.on('close', disconnected);
          try { return json(response, 200, await service.generateComparison(string(input.previewId), controller.signal)); }
          finally { response.off('close', disconnected); }
        }
        if (url.pathname === '/api/settings') return json(response, 200, service.getSettings());
        if (url.pathname === '/api/analysis/preview') return json(response, 200, await service.prepareAnalysis(string(input.repositoryPath), string(input.filePath), input.model === undefined ? undefined : string(input.model), { version: input.version === 'previous' || input.version === 'current' ? input.version : undefined, contextLimitBytes: input.contextLimitBytes === undefined ? undefined : Number(input.contextLimitBytes) }));
        if (url.pathname === '/api/analysis/cancel') return json(response, 200, { cancelled: service.cancelGeneration(string(input.previewId)) });
        if (url.pathname === '/api/analysis/generate') {
          const controller = new AbortController();
          const disconnect = () => { if (!response.writableEnded) controller.abort(); };
          response.once('close', disconnect);
          try { return json(response, 200, await service.generateExplanation(string(input.previewId), controller.signal)); }
          finally { response.removeListener('close', disconnect); }
        }
        if (url.pathname === '/api/repository') return json(response, 200, await service.openRepository(string(input.path)));
        if (url.pathname === '/api/file') return json(response, 200, await service.getFile(string(input.repositoryPath), string(input.filePath)));
        return json(response, 404, { error: 'Unknown operation.' });
      }
      if (request.method !== 'GET') return json(response, 405, { error: 'GET required.' });
      const dist = resolve('dist');
      const path = resolve(dist, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (!path.startsWith(`${dist}${sep}`)) return json(response, 403, { error: 'Invalid path.' });
      const data = await readFile(path);
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      response.end(data);
    } catch (error) {
      json(response, 400, { error: error instanceof Error ? error.message : 'Unable to read repository.' });
    }
  });
}
