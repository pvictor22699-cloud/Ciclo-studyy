'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { HttpError } = require('./errors');

const MAX_BODY = 1_000_000; // 1 MB

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function sendError(res, err) {
  const status = err instanceof HttpError ? err.status : 500;
  const payload = {
    error: err.code || (status === 500 ? 'internal_error' : 'error'),
    message: status === 500 ? 'erro interno' : err.message,
  };
  if (err.currentVersion != null) payload.currentVersion = err.currentVersion;
  if (status === 500) console.error('[erro]', err);
  sendJson(res, status, payload);
}

function readJsonBody(req) {
  // Em serverless (Vercel), o runtime já leu o stream e deixou o corpo pronto
  // em req.body. Nesse caso não há mais nada pra ouvir: o 'end' viria vazio e a
  // requisição chegaria ao router sem os campos.
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') {
      if (!req.body) return Promise.resolve({});
      try {
        return Promise.resolve(JSON.parse(req.body));
      } catch {
        return Promise.reject(new HttpError(400, 'bad_json', 'JSON inválido'));
      }
    }
    if (Buffer.isBuffer(req.body)) {
      const texto = req.body.toString('utf8');
      if (!texto) return Promise.resolve({});
      try {
        return Promise.resolve(JSON.parse(texto));
      } catch {
        return Promise.reject(new HttpError(400, 'bad_json', 'JSON inválido'));
      }
    }
    if (typeof req.body === 'object') return Promise.resolve(req.body);
  }

  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'payload_too_large', 'corpo muito grande'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, 'bad_json', 'JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/** Router minúsculo: rotas como '/api/professor/students/:id/extra'. */
function createRouter() {
  const routes = [];
  const add = (method, pattern, handler) => {
    const parts = pattern.split('/').filter(Boolean);
    routes.push({ method, parts, handler });
  };
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    patch: (p, h) => add('PATCH', p, h),
    del: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      const parts = pathname.split('/').filter(Boolean);
      for (const r of routes) {
        if (r.method !== method || r.parts.length !== parts.length) continue;
        const params = {};
        let ok = true;
        for (let i = 0; i < r.parts.length; i++) {
          const p = r.parts[i];
          if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(parts[i]);
          else if (p !== parts[i]) { ok = false; break; }
        }
        if (ok) return { handler: r.handler, params };
      }
      return null;
    },
    hasPath(pathname) {
      const parts = pathname.split('/').filter(Boolean);
      return routes.some(
        (r) =>
          r.parts.length === parts.length &&
          r.parts.every((p, i) => p.startsWith(':') || p === parts[i]),
      );
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

/** Estático simples pra rodar o front junto do servidor em dev. */
function serveStatic(root, pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(root, rel);
  const normalized = path.normalize(file);
  if (!normalized.startsWith(path.normalize(root))) return false; // path traversal
  if (!fs.existsSync(normalized) || !fs.statSync(normalized).isFile()) return false;
  const body = fs.readFileSync(normalized);
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(normalized)] || 'application/octet-stream',
    'Content-Length': body.length,
  });
  res.end(body);
  return true;
}

module.exports = { sendJson, sendError, readJsonBody, createRouter, serveStatic };
