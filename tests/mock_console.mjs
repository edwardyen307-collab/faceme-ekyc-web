// Fake eKYC Console for tests: echoes what it received (fields, sizes, auth headers).
import http from 'node:http';
http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    const fields = [...body.matchAll(/name="([^"]+)"(?:; filename="([^"]+)")?/g)].map(m => m[1] + (m[2] ? ':' + m[2] : ''));
    const out = { path: req.url, auth: req.headers.authorization || null, platformAuth: req.headers['platform-auth'] || null, contentType: (req.headers['content-type'] || '').split(';')[0], fields, bytes: body.length };
    if (req.url.endsWith('/compare-boost/idcard')) Object.assign(out, { result: { isMatch: true, similarity: 0.93 } });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(out));
  });
}).listen(18790, () => console.log('mock console :18790'));
