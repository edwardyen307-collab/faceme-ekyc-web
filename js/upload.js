// Upload layer. Default = mock (nothing leaves the phone).
// Real mode calls FaceMe eKYC Console 6.8.1 APIs. Field names below are CONFIRMED from
// "FaceMe eKYC Console API Document" v6 (via the 工作資料 bot); see docs/API-NOTES.md.
// Base URL / tokens are entered at runtime and kept in memory (optionally this device's
// localStorage if the admin ticks "remember"); never in the repo or the page URL.

export const ENDPOINTS = {
  spoof: '/api/platform/ekyc/face/spoofingcheck',          // img_stg1_act_1[], detail, features?
  ocr: '/api/platform/ekyc/idcard/ocr',                    // type, idCardImage[], imageDeskewed?, enableBase64Encoding?
  compare: '/api/platform/ekyc/face/compare-boost/idcard', // image1 (ID), image2 (face)
  forgery: '/api/platform/ekyc/idcard/forgery',            // NOT in the default flow (needs extra rightSide shots)
};

export const CARD_TYPES = [
  ['TW_ID_CARD_FRONT', '國民身分證（正面）'],
  ['TW_ID_CARD_BACK', '國民身分證（背面）'],
  ['TW_ARC_FRONT', '居留證（正面）'],
  ['TW_ARC_BACK', '居留證（背面）'],
  ['TW_HEALTHCARE_CARD_FRONT', '健保卡（正面）'],
  ['TW_DRIVER_LICENSE_FRONT', '駕照（正面）'],
  ['TW_DRIVER_LICENSE_BACK', '駕照（背面）'],
  ['PASSPORT', '護照'],
  ['TW_CAR_REGISTRATION', '汽車行照'],
  ['TW_MOTORCYCLE_REGISTRATION', '機車行照'],
];

const LS_KEY = 'ekyc-upload-config-v1';
export const DEFAULT_CONFIG = {
  mode: 'mock', baseUrl: '', token: '', platformAuth: '',
  doSpoof: true, doOcr: true, doCompare: true,
  strictMode: false, deepfake: false, imageDeskewed: false, remember: false,
};

export function loadConfig() {
  try { const s = localStorage.getItem(LS_KEY); if (s) { const c = JSON.parse(s); return { ...DEFAULT_CONFIG, ...c, remember: c.remember !== false }; } } catch (_) {}
  return { ...DEFAULT_CONFIG };
}
export function saveConfig(cfg) {
  try { if (cfg.remember) localStorage.setItem(LS_KEY, JSON.stringify(cfg)); else localStorage.removeItem(LS_KEY); } catch (_) {}
}

// Documented error responses -> Chinese guidance. `retake` tells the UI which step to offer again.
const KNOWN_ERRORS = [
  { status: 400, match: /can'?t find the id card/i, msg: '找不到證件：請重拍證件，讓證件填滿框線、避免反光。', retake: 'card' },
  { status: 403, match: /license does not support tw id doc/i, msg: '授權不支援台灣證件（TW ID Doc），請聯絡管理者確認 FaceMe 授權。' },
  { status: 503, match: /setup faceme platform/i, msg: 'FaceMe Platform 尚未設定完成，請管理者先在 eKYC Console 完成設定。' },
];
export function explainError(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  const k = KNOWN_ERRORS.find(e => e.match.test(text)) || KNOWN_ERRORS.find(e => e.status === status);
  if (k) return { msg: k.msg, retake: k.retake };
  if (status === 401) return { msg: '存取權杖無效或過期（401），請管理者更新 Access Token。' };
  if (status === 413) return { msg: '上傳的影像太大（413）。' };
  return { msg: `伺服器回傳錯誤 HTTP ${status}` };
}

async function post(cfg, path, form, signal) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + path;
  const headers = {};
  if (cfg.token) headers['Authorization'] = cfg.token;          // access token, no "Bearer"
  if (cfg.platformAuth) headers['platform-auth'] = cfg.platformAuth;
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: form, signal, mode: 'cors', credentials: 'omit' });
  } catch (e) {
    throw Object.assign(new Error('連線失敗（可能是 CORS 或網址錯誤；正式環境請經由後端代理）：' + e.message), { network: true });
  }
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  if (!res.ok) { const ex = explainError(res.status, body); throw Object.assign(new Error(ex.msg), { body, status: res.status, retake: ex.retake }); }
  return body;
}

/** Deep-find a key in a response without assuming its exact nesting. */
export function pick(o, k, d = 0) {
  if (!o || typeof o !== 'object' || d > 5) return undefined;
  if (Object.prototype.hasOwnProperty.call(o, k)) return o[k];
  for (const v of Object.values(o)) { const r = pick(v, k, d + 1); if (r !== undefined) return r; }
  return undefined;
}

// ---------- request builders (exported for tests) ----------
export function buildSpoofForm(face, cfg) {
  const f = new FormData();
  face.frames.forEach((b, i) => f.append('img_stg1_act_1', b, `stg1_${String(i).padStart(2, '0')}.jpg`));
  f.append('detail', JSON.stringify({ cameraInfo: face.cameraInfo || '', stg1_act_1: { still: face.still } }));
  if (cfg.strictMode || cfg.deepfake) f.append('features', JSON.stringify({ enableStrictMode: !!cfg.strictMode, enableDeepfakeDetect: !!cfg.deepfake }));
  return f;
}
export function buildOcrForm(card, cfg) {
  const f = new FormData();
  f.append('type', card.type);
  card.frames.forEach((b, i) => f.append('idCardImage', b, `idcard_${i}.jpg`));
  if (cfg.imageDeskewed) f.append('imageDeskewed', 'true');
  return f;
}
export function buildCompareForm(card, face) {
  const f = new FormData();
  f.append('image1', card.image, 'idcard.jpg');
  f.append('image2', face.image, 'face.jpg');
  return f;
}
/** Forgery check – NOT used by the default flow. Needs >= 7 images: 5 'front' + 2 'rightSide'. TODO: capture UI. */
export function buildForgeryForm(type, shots /* [{blob, direction:'front'|'rightSide'}] */, fullImage, cfg = {}) {
  const f = new FormData();
  f.append('type', type); // TW_ID_CARD_FRONT / TW_ID_CARD_BACK only
  shots.forEach((s, i) => { f.append('idCardImage', s.blob, `forgery_${i}.jpg`); f.append('idCardDirections', s.direction); });
  if (fullImage) f.append('idCardFullImage', fullImage, 'full.jpg');
  if (cfg.imageDeskewed) f.append('imageDeskewed', 'true');
  return f;
}

/**
 * card = { image, frames[], type }, face = { image, frames[], still, cameraInfo }
 * Order: spoofingcheck -> ocr -> compare.
 * @returns {Promise<{mock:boolean, steps:Array<{key,name,ok,verdict?,summary?,data?,error?,retake?}>}>}
 */
export async function uploadEkyc(cfg, card, face, onStep, signal) {
  if (cfg.mode !== 'real') {
    const steps = [];
    const plan = [
      ['spoof', `人臉活體檢查（序列 ${face.frames.length} 張，still=${face.still}）`],
      ['ocr', `證件 OCR（${card.type}，${card.frames.length} 張）`],
      ['compare', '證件與人臉 1:1 比對'],
    ];
    for (const [key, name] of plan) {
      onStep && onStep(`模擬：${name}…`);
      await new Promise(r => setTimeout(r, 450));
      steps.push({ key, name, ok: true, summary: '模擬，未送出' });
    }
    return { mock: true, steps };
  }
  if (!/^https:\/\//i.test(cfg.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(cfg.baseUrl)) {
    throw new Error('實際上傳需要 https:// 的 eKYC Console 或代理網址');
  }
  const steps = [];
  const run = async (key, name, fn, interpret) => {
    onStep && onStep(name + '…');
    try {
      const data = await fn();
      steps.push({ key, name, data, ...interpret(data) });
    } catch (e) {
      steps.push({ key, name, ok: false, error: e.message, data: e.body, retake: e.retake });
    }
  };
  if (cfg.doSpoof) await run('spoof', '人臉活體檢查', () => post(cfg, ENDPOINTS.spoof, buildSpoofForm(face, cfg), signal), (d) => {
    const r = pick(d, 'result'), score = pick(d, 'livenessScore'), clear = pick(d, 'clearImageIndex');
    const dfS = pick(d, 'deepfakeDetectStatus'), dfC = pick(d, 'deepfakeDetectConfidence');
    let summary = `livenessScore：${fmt(score)}，clearImageIndex：${fmt(clear)}`;
    if (dfS !== undefined || dfC !== undefined) summary += `，deepfake：${fmt(dfS)}（${fmt(dfC)}）`;
    if (r === 'liveness') return { ok: true, verdict: '活體通過', summary };
    if (r === 'spoofing') return { ok: false, verdict: '判定為非真人（翻拍／照片／面具），請重拍人臉', summary, retake: 'face' };
    return { ok: false, verdict: '無法判讀活體結果：' + fmt(r), summary };
  });
  if (cfg.doOcr) await run('ocr', '證件 OCR', () => post(cfg, ENDPOINTS.ocr, buildOcrForm(card, cfg), signal), (d) => {
    const r = pick(d, 'result'), info = pick(d, 'info');
    if (r === 'ok') return { ok: true, verdict: '辨識完成', summary: info !== undefined ? JSON.stringify(info) : '' };
    if (r === 'needMoreImage') return { ok: false, verdict: '證件影像不足或不清楚，系統需要更多張證件照：請重拍證件（拿穩、避免反光、讓證件填滿框線）', retake: 'card' };
    return { ok: false, verdict: '無法判讀 OCR 結果：' + fmt(r) };
  });
  if (cfg.doCompare) await run('compare', '證件與人臉 1:1 比對', () => post(cfg, ENDPOINTS.compare, buildCompareForm(card, face), signal), (d) => {
    const m = pick(d, 'isMatch'), s = pick(d, 'similarity');
    const summary = `similarity：${fmt(s)}`;
    if (m === true) return { ok: true, verdict: '同一人', summary };
    if (m === false) return { ok: false, verdict: '比對不符，請確認證件與本人', summary };
    return { ok: false, verdict: '無法判讀比對結果', summary };
  });
  return { mock: false, steps };
}

function fmt(v) { return v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
