// Minimal CORS proxy for FaceMe eKYC Console (Node.js >= 18, no dependencies).
// Keeps the Console access token on the server; the phone page only talks to this proxy.
//
//   EKYC_BASE_URL=https://<console-host> EKYC_TOKEN=<access token> \
//   ALLOW_ORIGIN=https://edwardyen307-collab.github.io PORT=8787 node proxy/ekyc-proxy.mjs
//
// Optional: EKYC_PLATFORM_AUTH=<value for platform-auth header>.
// Self-signed Console certificate? Use NODE_EXTRA_CA_CERTS=/path/ca.pem (do NOT disable TLS checks).
// Put this behind HTTPS (reverse proxy / tunnel) – iPhone pages on https cannot call http.
import http from 'node:http';

const BASE = (process.env.EKYC_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.EKYC_TOKEN || '';
const PLATFORM_AUTH = process.env.EKYC_PLATFORM_AUTH || '';
const ORIGINS = (process.env.ALLOW_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED = new Set([
  '/api/platform/ekyc/face/compare-boost/idcard',
  '/api/platform/ekyc/idcard/ocr',
  '/api/platform/ekyc/idcard/forgery',
  '/api/platform/ekyc/face/spoofingcheck',
]);
if (!BASE || !TOKEN) { console.error('Set EKYC_BASE_URL and EKYC_TOKEN'); process.exit(1); }

function cors(req, res) {
  const o = req.headers.origin;
  if (o && ORIGINS.includes(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, platform-auth');
    res.setHeader('Access-Control-Max-Age', '600');
    return true;
  }
  return false;
}

http.createServer(async (req, res) => {
  const okOrigin = cors(req, res);
  const path = new URL(req.url, 'http://x').pathname;
  if (req.method === 'OPTIONS') { res.writeHead(okOrigin ? 204 : 403).end(); return; }
  if (!okOrigin) { res.writeHead(403).end('origin not allowed'); return; }
  if (req.method !== 'POST' || !ALLOWED.has(path)) { res.writeHead(404).end(); return; }
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BYTES) { res.writeHead(413).end(); return; }
  try {
    const chunks = []; let n = 0;
    for await (const c of req) { n += c.length; if (n > MAX_BYTES) { res.writeHead(413).end(); return; } chunks.push(c); }
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/octet-stream', Authorization: TOKEN };
    if (PLATFORM_AUTH) headers['platform-auth'] = PLATFORM_AUTH;
    const r = await fetch(BASE + path, { method: 'POST', headers, body: Buffer.concat(chunks) });
    const body = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }).end(body);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'proxy_error', message: e.message }));
  }
}).listen(PORT, () => console.log(`eKYC proxy on :${PORT} -> ${BASE} (origins: ${ORIGINS.join(', ') || 'none'})`));
