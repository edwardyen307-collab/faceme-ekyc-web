// Fake eKYC Console for tests (NOT the real API). Parses multipart field names/counts and answers
// with documented response shapes. MOCK_SCENARIO=ok (default) | needmore | errors
import http from 'node:http';
const SC = process.env.MOCK_SCENARIO || 'ok';
const PORT = Number(process.env.MOCK_PORT || 18790);
function parse(body, ctype) {
  const b = (ctype.match(/boundary=(.+)$/) || [])[1];
  const fields = {}; const values = {};
  if (!b) return { fields, values };
  for (const part of body.split('--' + b)) {
    const m = part.match(/name="([^"]+)"(; filename="([^"]+)")?/);
    if (!m) continue;
    fields[m[1]] = (fields[m[1]] || 0) + 1;
    if (!m[2]) values[m[1]] = part.split('\r\n\r\n').slice(1).join('\r\n\r\n').replace(/\r\n$/, '');
  }
  return { fields, values };
}
http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
    const body = Buffer.concat(chunks).toString('latin1');
    const { fields, values } = parse(body, req.headers['content-type'] || '');
    const echo = { path: req.url, auth: req.headers.authorization || null, platformAuth: req.headers['platform-auth'] || null, fields, values, bytes: body.length };
    console.log(JSON.stringify({ path: echo.path, auth: echo.auth, platformAuth: echo.platformAuth, fields, values }));
    const send = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ...obj, _echo: echo }));
    if (req.url.endsWith('/face/spoofingcheck')) {
      if (SC === 'errors') return send(200, { result: 'spoofing', livenessScore: 0.12, clearImageIndex: 3 });
      return send(200, { result: 'liveness', livenessScore: 0.97, clearImageIndex: JSON.parse(values.detail || '{}')?.stg1_act_1?.still ?? 0, deepfakeDetectStatus: 'notDetected', deepfakeDetectConfidence: 0.02 });
    }
    if (req.url.endsWith('/idcard/ocr')) {
      if (SC === 'needmore') return send(200, { result: 'needMoreImage' });
      if (SC === 'errors') return send(400, { message: "Can't find the ID card." });
      return send(200, { result: 'ok', info: { name: '王測試', idNumber: 'A123456789', type: values.type } });
    }
    if (req.url.endsWith('/compare-boost/idcard')) {
      if (SC === 'errors') return send(503, { message: 'Please setup FaceMe Platform first.' });
      return send(200, { isMatch: true, similarity: 0.93 });
    }
    send(404, { message: 'not found' });
  });
}).listen(PORT, () => console.log('mock console :' + PORT + ' scenario=' + SC));
