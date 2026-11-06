// Kerangka HTTP kecil tanpa dependensi: router, body JSON, berkas statis, cookie.
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'galat';
  }
}

export function createRouter() {
  const routes = [];
  const add = (method) => (pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/\//g, '\\/').replace(/:(\w+)/g, (_, k) => {
          keys.push(k);
          return '([^\\/]+)';
        }) +
        '\\/?$'
    );
    routes.push({ method, re, keys, handlers });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    patch: add('PATCH'),
    put: add('PUT'),
    delete: add('DELETE'),
    match(method, pathname) {
      let pathMatched = false;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m) continue;
        pathMatched = true;
        if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handlers: r.handlers, params };
      }
      return pathMatched ? { methodNotAllowed: true } : null;
    },
  };
}

export function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export async function readBody(req, limit = 3 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Data yang dikirim terlalu besar.', 'terlalu_besar'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new HttpError(400, 'Format data tidak dikenali.', 'json_rusak');
  }
}

export function send(res, status, body, headers = {}) {
  if (res.headersSent) return;
  const isBuf = Buffer.isBuffer(body);
  const isStr = typeof body === 'string';
  const payload = isBuf || isStr ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf || isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(self)',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' http: https:; manifest-src 'self'; worker-src 'self'",
};

export function serveStatic(roots) {
  // roots: [{ prefix: '/ui/', dir: '...' }, { prefix: '/', dir: '...' }]
  return (req, res, pathname) => {
    for (const { prefix, dir } of roots) {
      if (!pathname.startsWith(prefix)) continue;
      let rel = pathname.slice(prefix.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';
      const file = path.normalize(path.join(dir, rel));
      if (!file.startsWith(path.normalize(dir))) return false;
      let target = file;
      if (!fs.existsSync(target) && !path.extname(target) && fs.existsSync(target + '.html')) target += '.html';
      if (!fs.existsSync(target) || !fs.statSync(target).isFile()) continue;
      const ext = path.extname(target);
      const st = fs.statSync(target);
      const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
      // Selalu divalidasi ulang; tablet hanya mengunduh ulang bila berkas berubah (hemat Wi-Fi).
      const headers = {
        ...SECURITY_HEADERS,
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        ETag: etag,
      };
      if (target.endsWith('sw.js')) headers['Service-Worker-Allowed'] = '/';
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers);
        res.end();
        return true;
      }
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end(), true;
      fs.createReadStream(target).pipe(res);
      return true;
    }
    return false;
  };
}

export function startServer({ router, statics, port, host = '0.0.0.0', cors = [], onError, tls }) {
  const handler = async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const origin = req.headers.origin;
    if (origin && cors.length && cors.some((c) => url.pathname.startsWith(c))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') return send(res, 204, '');
    }
    req.query = Object.fromEntries(url.searchParams);
    req.pathname = url.pathname;
    try {
      const m = router.match(req.method, url.pathname);
      if (m && m.methodNotAllowed) throw new HttpError(405, 'Metode tidak didukung.', 'metode');
      if (m) {
        req.params = m.params;
        for (const h of m.handlers) {
          const out = await h(req, res);
          if (res.writableEnded || res.headersSent) return;
          if (out !== undefined) return send(res, 200, out, SECURITY_HEADERS);
        }
        return;
      }
      if (statics && (req.method === 'GET' || req.method === 'HEAD') && statics(req, res, url.pathname)) return;
      throw new HttpError(404, 'Halaman atau data tidak ditemukan.', 'tidak_ada');
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) (onError || console.error)(err);
      send(res, status, {
        galat: err.code || 'galat_server',
        pesan: status >= 500 ? 'Server mengalami gangguan. Coba lagi sebentar lagi.' : err.message,
      });
    }
  };
  const server = tls ? https.createServer(tls, handler) : http.createServer(handler);
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

export function loadTls() {
  const cert = process.env.TLS_CERT;
  const key = process.env.TLS_KEY;
  if (cert && key && fs.existsSync(cert) && fs.existsSync(key)) {
    return { cert: fs.readFileSync(cert), key: fs.readFileSync(key) };
  }
  return null;
}
