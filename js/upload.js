// Upload layer. Default = mock (nothing leaves the phone).
// Real mode calls FaceMe eKYC Console APIs (see docs/API-NOTES.md for what is confirmed vs assumed).
// Base URL / tokens are entered at runtime and kept in memory (optionally in this device's
// localStorage if the admin ticks "remember"); they are never in the repo or the page URL.

export const ENDPOINTS = {
  compare: '/api/platform/ekyc/face/compare-boost/idcard', // multipart: image1, image2 -> isMatch, similarity (doc pp.71-73)
  ocr: '/api/platform/ekyc/idcard/ocr',                    // multipart ID image (doc p.49) – field name ASSUMED
  spoof: '/api/platform/ekyc/face/spoofingcheck',          // face image (doc p.68) – field name ASSUMED
};

const LS_KEY = 'ekyc-upload-config-v1';
export const DEFAULT_CONFIG = {
  mode: 'mock', baseUrl: '', token: '', platformAuth: '',
  doCompare: true, doOcr: false, doSpoof: false, ocrField: 'image', spoofField: 'image', remember: false,
};

export function loadConfig() {
  try { const s = localStorage.getItem(LS_KEY); if (s) return { ...DEFAULT_CONFIG, ...JSON.parse(s), remember: true }; } catch (_) {}
  return { ...DEFAULT_CONFIG };
}
export function saveConfig(cfg) {
  try { if (cfg.remember) localStorage.setItem(LS_KEY, JSON.stringify(cfg)); else localStorage.removeItem(LS_KEY); } catch (_) {}
}

async function post(cfg, path, form, signal) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + path;
  const headers = {};
  if (cfg.token) headers['Authorization'] = cfg.token;          // doc p.12: access token in Authorization header
  if (cfg.platformAuth) headers['platform-auth'] = cfg.platformAuth; // platform-integration APIs
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: form, signal, mode: 'cors', credentials: 'omit' });
  } catch (e) {
    throw new Error('連線失敗（可能是 CORS 或網址錯誤；正式環境請經由後端代理）：' + e.message);
  }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { body });
  return body;
}

/** @returns {Promise<{mock:boolean, steps:Array<{name:string, ok:boolean, data?:any, error?:string}>}>} */
export async function uploadEkyc(cfg, idBlob, faceBlob, onStep, signal) {
  if (cfg.mode !== 'real') {
    const steps = [];
    for (const name of ['證件影像', '人臉影像']) {
      onStep && onStep(`模擬上傳 ${name}…`);
      await new Promise(r => setTimeout(r, 600));
      steps.push({ name, ok: true, data: { size: (name === '證件影像' ? idBlob : faceBlob).size } });
    }
    return { mock: true, steps };
  }
  if (!/^https:\/\//i.test(cfg.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)/i.test(cfg.baseUrl)) {
    throw new Error('實際上傳需要 https:// 的 eKYC Console 或代理網址');
  }
  const steps = [];
  const run = async (name, fn) => {
    onStep && onStep(name + '…');
    try { steps.push({ name, ok: true, data: await fn() }); }
    catch (e) { steps.push({ name, ok: false, error: e.message, data: e.body }); }
  };
  if (cfg.doOcr) await run('證件 OCR', () => { const f = new FormData(); f.append(cfg.ocrField || 'image', idBlob, 'idcard.jpg'); return post(cfg, ENDPOINTS.ocr, f, signal); });
  if (cfg.doSpoof) await run('人臉活體檢查', () => { const f = new FormData(); f.append(cfg.spoofField || 'image', faceBlob, 'face.jpg'); return post(cfg, ENDPOINTS.spoof, f, signal); });
  if (cfg.doCompare) await run('證件與人臉 1:1 比對', () => { const f = new FormData(); f.append('image1', idBlob, 'idcard.jpg'); f.append('image2', faceBlob, 'face.jpg'); return post(cfg, ENDPOINTS.compare, f, signal); });
  return { mock: false, steps };
}

/** Pull the headline fields out of a compare-boost response without assuming its exact nesting. */
export function summarizeCompare(data) {
  const find = (o, k, d = 0) => { if (!o || typeof o !== 'object' || d > 4) return undefined; if (k in o) return o[k]; for (const v of Object.values(o)) { const r = find(v, k, d + 1); if (r !== undefined) return r; } return undefined; };
  return { isMatch: find(data, 'isMatch'), similarity: find(data, 'similarity') };
}
