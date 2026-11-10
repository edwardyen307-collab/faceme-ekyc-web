// Minimal CORS proxy for FaceMe eKYC Console (Node.js >= 18, no dependencies).
// Keeps the Console access token on the server; the phone page only talks to this proxy.
//
//   EKYC_BASE_URL=https://<console-host> EKYC_TOKEN=<access token> \
//   ALLOW_ORIGIN=https://edwardyen307-collab.github.io PORT=8787 node proxy/ekyc-proxy.mjs
//
// platform-auth: either a fixed EKYC_PLATFORM_AUTH, or (recommended) per-case tokens: the page first
// calls POST /api/request/ (Create Request), the Console returns { requestUuid, platformToken, ekycToken },
// the proxy strips ekycToken and the page sends platformToken back as platform-auth for that case only.
// EKYC_TEMPLATE_UUID=<requestTemplateUuid> forces the template used by Create Request (page value ignored).
// Self-signed Console certificate? Use NODE_EXTRA_CA_CERTS=/path/ca.pem (do NOT disable TLS checks).
// Put this behind HTTPS (reverse proxy / tunnel) – iPhone pages on https cannot call http.
import http from 'node:http';

const BASE = (process.env.EKYC_BASE_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.EKYC_TOKEN || '';
const PLATFORM_AUTH = process.env.EKYC_PLATFORM_AUTH || '';
const TEMPLATE = process.env.EKYC_TEMPLATE_UUID || '';
const ORIGINS = (process.env.ALLOW_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT || 8787);
const MAX_BYTES = 30 * 1024 * 1024; // spoofing sends a ~15-frame sequence + OCR 3 frames
// Multipart bodies are forwarded byte-for-byte, so every documented field passes through unchanged:
//   spoofingcheck: img_stg1_act_1 (repeat), detail, features
//   idcard/ocr:    type, idCardImage (repeat), imageDeskewed, enableBase64Encoding
//   idcard/forgery: type, idCardImage (repeat), idCardDirections (repeat), idCardFullImage, imageDeskewed
//   compare-boost/idcard: image1, image2, image1Info, image2Info, multipleFacePriority1/2, enableAutoRotate
// urlencoded: /api/request/ (requestTemplateUuid), idcard/forgery/requirement (type)
// Authorization from the browser is always replaced by the server-side token. A browser platform-auth
// is forwarded only when EKYC_PLATFORM_AUTH is not set.
const ALLOWED = new Set([
  '/api/request/',
  '/api/platform/ekyc/idcard/forgery/requirement',
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
    let body = Buffer.concat(chunks);
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/octet-stream', Authorization: TOKEN };
    const pa = PLATFORM_AUTH || req.headers['platform-auth'];
    if (pa) headers['platform-auth'] = pa;
    if (path === '/api/request/') {
      const f = new URLSearchParams(body.toString('utf8'));
      if (TEMPLATE) f.set('requestTemplateUuid', TEMPLATE);
      if (!f.get('requestTemplateUuid')) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'requestTemplateUuid required' })); return; }
      body = Buffer.from(new URLSearchParams({ requestTemplateUuid: f.get('requestTemplateUuid') }).toString());
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      delete headers['platform-auth'];
    }
    const r = await fetch(BASE + path, { method: 'POST', headers, body });
    let out = Buffer.from(await r.arrayBuffer());
    if (path === '/api/request/' && r.ok) {
      try { const j = JSON.parse(out.toString('utf8')); delete j.ekycToken; out = Buffer.from(JSON.stringify(j)); } catch (_) {}
    }
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' }).end(out);
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'proxy_error', message: e.message }));
  }
}).listen(PORT, () => console.log(`eKYC proxy on :${PORT} -> ${BASE} (origins: ${ORIGINS.join(', ') || 'none'})`));
