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
    if (req.url === '/api/request/' || req.url === '/api/request') {
      const tpl = new URLSearchParams(body).get('requestTemplateUuid');
      console.log(JSON.stringify({ createRequest: tpl, ctype: req.headers['content-type'] }));
      return send(200, { requestUuid: 'req-mock-0001', platformToken: 'pt-mock-per-request', ekycToken: 'ek-mock-should-be-stripped' });
    }
    if (req.url.endsWith('/idcard/forgery/requirement')) {
      const type = new URLSearchParams(body).get('type');
      console.log(JSON.stringify({ forgeryRequirement: type, ctype: req.headers['content-type'], platformAuth: req.headers['platform-auth'] || null }));
      return send(200, { imageCounts: { front: 5, rightSide: 2, full: 0 } });
    }
    if (req.url.endsWith('/idcard/forgery')) {
      if (SC === 'errors') return send(200, { result: 'forgery', realScore: 0.08, rejectReason: 'screen recapture' });
      return send(200, { result: 'real', realScore: 0.91, rejectReason: '' });
    }
    if (req.url.endsWith('/face/spoofingcheck')) {
      if (SC === 'errors') return send(200, { result: 'spoofing', livenessScore: 0.12, clearImageIndex: 3 });
      return send(200, { result: 'liveness', livenessScore: 0.97, clearImageIndex: JSON.parse(values.detail || '{}')?.stg1_act_1?.still ?? 0, deepfakeDetectStatus: 'real', deepfakeDetectConfidence: 0.02 });
    }
    if (req.url.endsWith('/idcard/ocr')) {
      if (SC === 'needmore') return send(200, { result: 'needMoreImage' });
      if (SC === 'errors') return send(400, { message: 'Image has reflection.' });
      // flat info object, as in the document's response example
      return send(200, { fullName: '王測試', sex: '男', dateOfBirth: '民國80年1月1日', dateOfIssue: '民國110年5月5日', parsedLocationFromDateOfIssue: '北市', identityNumber: 'A123456789' });
    }
    if (req.url.endsWith('/compare-boost/idcard')) {
      if (SC === 'errors') return send(503, { message: 'Please setup FaceMe Platform first.' });
      return send(200, { thresholds: { idcard: 0.68 }, isMatch: true, similarity: 0.93, faceInfo: { boundingBox: { left: 10, top: 10, right: 90, bottom: 110 } }, face2Info: { boundingBox: { left: 100, top: 80, right: 300, bottom: 330 } } });
    }
    send(404, { message: 'not found' });
  });
}).listen(PORT, () => console.log('mock console :' + PORT + ' scenario=' + SC));
