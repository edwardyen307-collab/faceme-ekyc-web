// Upload layer. Default = mock (nothing leaves the phone).
// Real mode calls FaceMe eKYC Console (6.x) platform APIs. Field names follow the vendor API
// document; see docs/API-NOTES.md for the short field list.
// Base URL / tokens are entered at runtime and kept in memory (optionally this device's
// localStorage if the admin ticks "remember"); never in the repo or the page URL.

export const ENDPOINTS = {
  createRequest: '/api/request/',                           // x-www-form-urlencoded requestTemplateUuid -> requestUuid, platformToken, ekycToken
  spoof: '/api/platform/ekyc/face/spoofingcheck',          // img_stg1_act_1[], detail, features?
  ocr: '/api/platform/ekyc/idcard/ocr',                    // type, idCardImage[], imageDeskewed?, enableBase64Encoding?
  compare: '/api/platform/ekyc/face/compare-boost/idcard', // image1 (ID), image2 (face), multipleFacePriority1/2?, image1Info/image2Info?, enableAutoRotate?
  forgeryRequirement: '/api/platform/ekyc/idcard/forgery/requirement', // urlencoded type -> imageCounts{front,rightSide,full}
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

// OCR info field -> Chinese label (fields listed for each type in the API document).
export const OCR_LABELS = {
  fullName: '姓名', name: '姓名', sex: '性別', dateOfBirth: '出生日期', identityNumber: '身分證字號',
  dateOfIssue: '發證日期', parsedDateFromDateOfIssue: '發證日期（解析）', parsedLocationFromDateOfIssue: '發證地點',
  parsedTypeFromDateOfIssue: '領補換類別', Father: '父', Mother: '母', Spouse: '配偶', militaryService: '役別',
  placeOfBirth: '出生地', address: '住址', serialNumber: '證件序號', barCode: '條碼',
  'UI_No.': '統一證號', purposeOfResidence: '居留事由', type: '類別',
  reissuanceTimes: '補發次數', bloodType: '血型', expirationDate: '有效日期', jurisdictionCode: '管轄編號',
  conditionOfHolder: '持照條件', issuanceDate: '發照日期', inspectionDate: '審驗日期',
  printSerial: '印製序號', addedCondition: '加註持照條件', addressChange: '住址變更', inspection: '職業駕駛審驗', note: '備註',
  firstLineOfMrz: 'MRZ 第 1 行', secondLineOfMrz: 'MRZ 第 2 行', thirdLineOfMrz: 'MRZ 第 3 行',
  mrzExtractedName: '姓名（MRZ）', mrzExtractedSurname: '姓（MRZ）', mrzExtractedDateOfBirth: '出生日期（MRZ）',
  mrzExtractedExpirationDate: '有效日期（MRZ）', mrzExtractedNationality: '國籍（MRZ）', mrzExtractedSex: '性別（MRZ）',
  mrzExtractedIssueCountry: '簽發國（MRZ）', mrzExtractedPPnumber: '護照號碼（MRZ）', mrzExtractedPSnumber: '個人號碼（MRZ）',
  mrzExtractedPassportNumber: '護照號碼（MRZ）', mrzExtractedSerialNumber: '序號（MRZ）', mrzExtractedUINumber: '統一證號（MRZ）',
  serialBarCode: '序號條碼',
};

const LS_KEY = 'ekyc-upload-config-v1';
export const DEFAULT_CONFIG = {
  mode: 'mock', baseUrl: '', token: '', platformAuth: '',
  useRequest: false, templateUuid: '',         // create an eKYC Console request first and use its platformToken as platform-auth
  doSpoof: true, doOcr: true, doCompare: true,
  strictMode: false, deepfake: false, imageDeskewed: false, idLargestFace: true, stillZeroBased: false, remember: false,
};

export function loadConfig() {
  try { const s = localStorage.getItem(LS_KEY); if (s) { const c = JSON.parse(s); return { ...DEFAULT_CONFIG, ...c, remember: c.remember !== false }; } } catch (_) {}
  return { ...DEFAULT_CONFIG };
}
export function saveConfig(cfg) {
  try { if (cfg.remember) localStorage.setItem(LS_KEY, JSON.stringify(cfg)); else localStorage.removeItem(LS_KEY); } catch (_) {}
}

// Documented error messages -> Chinese guidance. The document lists HTTP status + message text
// (no fixed JSON field), so we match on the whole response text. `retake` = which step to offer again.
const KNOWN_ERRORS = [
  { match: /can'?t find the id card|no id card was detected/i, msg: '找不到證件：請重拍證件，讓證件填滿框線、避免反光。', retake: 'card' },
  { match: /image is blurry/i, msg: '證件影像模糊：請拿穩、對焦後重拍證件。', retake: 'card' },
  { match: /image has reflection/i, msg: '證件有反光：請調整角度或換個位置後重拍證件。', retake: 'card' },
  { match: /incorrectly cropped|extremely tilted/i, msg: '證件裁切不完整或太傾斜：請讓證件平放、完整放進框內後重拍。', retake: 'card' },
  { match: /image quality detection failed/i, msg: '證件影像品質檢查失敗：請在光線充足處重拍證件。', retake: 'card' },
  { match: /covered by a mask/i, msg: '臉部被口罩遮住：請拿下口罩後重拍人臉。', retake: 'face' },
  { match: /detailed json and input images do not match/i, msg: '活體資料（detail）與影像不相符：請重拍人臉；若持續發生，請改用 FaceMe Web SDK 產生活體資料。', retake: 'face' },
  { match: /image2 field should (only )?contain (only )?one face|no face found in parameter image2/i, msg: '自拍照中的人臉不是剛好一張：畫面中只能有你一個人，請重拍人臉。', retake: 'face' },
  { match: /image1 field should (only )?contain (only )?one face|no face found in parameter image1/i, msg: '證件照片中找不到唯一的人臉：請重拍證件，讓大頭照清楚可見。', retake: 'card' },
  { match: /no face (was )?found|should (only )?contain (only )?one face/i, msg: '找不到唯一的人臉：請確認畫面中只有你一個人，並重拍人臉。', retake: 'face' },
  { match: /token is expired/i, msg: '存取權杖已過期（401），請管理者更新 Access Token。' },
  { match: /token is invalid|resource is forbidden/i, msg: '存取權杖無效（401），請管理者確認 Access Token。' },
  { match: /requires https/i, msg: 'API 需要 HTTPS 連線（401），請改用 https:// 網址。' },
  { match: /license does not support 2d anti-spoofing/i, msg: '授權不支援人臉活體檢查（2D Anti-Spoofing），請聯絡管理者，或在進階設定取消活體檢查。' },
  { match: /license does not support accuracy boost/i, msg: '授權不支援 Accuracy Boost 比對，請聯絡管理者。' },
  { match: /license does not support tw id doc|tw id doc validation is not enabled/i, msg: '授權或設定未啟用台灣證件（TW ID Doc），請聯絡管理者確認 FaceMe 授權。' },
  { match: /ocr for .* is not enabled/i, msg: '此證件類型的 OCR 尚未啟用，請管理者在 eKYC Console 啟用，或改選其他證件類型。' },
  { match: /fps upper bound/i, msg: '伺服器忙碌（超過每秒請求上限，429），請稍後再試。' },
  { match: /setup faceme platform/i, msg: 'FaceMe Platform 尚未設定完成，請管理者先在 eKYC Console 完成設定。' },
];
export function explainError(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  const k = KNOWN_ERRORS.find(e => e.match.test(text));
  if (k) return { msg: k.msg, retake: k.retake };
  if (status === 400) return { msg: '影像或參數不符合要求（400）：請重拍後再試。' };
  if (status === 401) return { msg: '存取權杖無效或過期（401），請管理者更新 Access Token。' };
  if (status === 403) return { msg: '此功能未授權或未啟用（403），請聯絡管理者。' };
  if (status === 408) return { msg: '伺服器處理逾時（408），請稍後再試。' };
  if (status === 413) return { msg: '上傳的影像太大（413）。' };
  if (status === 415) return { msg: '影像格式不支援（415）。' };
  if (status === 429) return { msg: '伺服器忙碌（429），請稍後再試。' };
  if (status === 503) return { msg: '服務暫時無法使用（503），請聯絡管理者。' };
  return { msg: `伺服器回傳錯誤 HTTP ${status}` };
}

async function post(cfg, path, form, signal) {
  const url = cfg.baseUrl.replace(/\/+$/, '') + path;
  const headers = {};
  if (cfg.token) headers['Authorization'] = cfg.token;          // access token, no "Bearer"
  if (cfg.platformAuth) headers['platform-auth'] = cfg.platformAuth;
  if (form instanceof URLSearchParams) headers['Content-Type'] = 'application/x-www-form-urlencoded';
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
/** Our own engine: detail is built here. FaceMe SDK engine: its detail object is sent as-is. */
export function buildSpoofForm(face, cfg) {
  const f = new FormData();
  face.frames.forEach((b, i) => f.append('img_stg1_act_1', b, `stg1_${String(i + 1).padStart(2, '0')}.jpg`));
  let detail = face.detail;
  if (!detail) {
    // The document example pairs 10 images with still:10, i.e. a 1-based index; admin can switch to 0-based.
    detail = { cameraInfo: face.cameraInfo || '', stg1_act_1: { still: stillValue(face, cfg) } };
  }
  f.append('detail', typeof detail === 'string' ? detail : JSON.stringify(detail));
  // enableStrictMode relies on the web component's encryption -> only offered with the FaceMe SDK engine.
  const strict = !!cfg.strictMode && !!face.detail;
  if (strict || cfg.deepfake) f.append('features', JSON.stringify({ enableStrictMode: strict, enableDeepfakeDetect: !!cfg.deepfake }));
  return f;
}
export function stillValue(face, cfg = {}) {
  if (face.detail) return face.still;
  return (face.stillIndex ?? 0) + (cfg.stillZeroBased ? 0 : 1);
}
export function buildOcrForm(card, cfg) {
  const f = new FormData();
  f.append('type', card.type);
  card.frames.forEach((b, i) => f.append('idCardImage', b, `idcard_${i}.jpg`));
  if (cfg.imageDeskewed) f.append('imageDeskewed', 'true');
  return f;
}
export function buildCompareForm(card, face, cfg = {}) {
  const f = new FormData();
  f.append('image1', card.image, 'idcard.jpg');
  f.append('image2', face.image, 'face.jpg');
  // Passports / ARCs can show a second (ghost) portrait; default "Not Allowed" would reject them.
  if (cfg.idLargestFace) f.append('multipleFacePriority1', 'Largest');
  return f;
}
export function buildForgeryRequirementForm(type) { return new URLSearchParams({ type }); }
/** Forgery check – NOT used by the default flow. Image counts come from the requirement API (e.g. 5 front + 2 rightSide). */
export function buildForgeryForm(type, shots /* [{blob, direction:'front'|'rightSide'}] */, fullImages = [], cfg = {}) {
  const f = new FormData();
  f.append('type', type); // TW_ID_CARD_FRONT / TW_ID_CARD_BACK only
  shots.forEach((s, i) => { f.append('idCardImage', s.blob, `forgery_${i}.jpg`); f.append('idCardDirections', s.direction); });
  [].concat(fullImages || []).forEach((b, i) => f.append('idCardFullImage', b, `full_${i}.jpg`));
  if (cfg.imageDeskewed) f.append('imageDeskewed', 'true');
  return f;
}

/** OCR response -> { result, info }. The document shows both {result, info} and a flat info object. */
export function readOcr(d) {
  if (!d || typeof d !== 'object') return { result: undefined, info: undefined };
  const result = pick(d, 'result');
  let info = pick(d, 'info');
  if (info === undefined && result === undefined) {
    info = Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));
    if (Object.keys(info).length) return { result: 'ok', info };
  }
  return { result, info };
}
export function ocrSummary(info) {
  if (!info || typeof info !== 'object') return '';
  const flat = {};
  for (const [k, v] of Object.entries(info)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k2, v2] of Object.entries(v)) flat[k + k2] = v2; // mrzExtracted{...}
    else flat[k] = v;
  }
  return Object.entries(flat).filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${OCR_LABELS[k] || k}：${typeof v === 'object' ? JSON.stringify(v) : v}`).join('\n');
}

/**
 * card = { image, frames[], type }, face = { image, frames[], stillIndex | (detail, still), cameraInfo }
 * Order: [create request] -> spoofingcheck -> ocr -> compare.
 * @returns {Promise<{mock:boolean, request?:object, steps:Array<{key,name,ok,verdict?,summary?,data?,error?,retake?}>}>}
 */
export async function uploadEkyc(cfg, card, face, onStep, signal) {
  if (cfg.mode !== 'real') {
    const steps = [];
    const plan = [
      ['spoof', `人臉活體檢查（序列 ${face.frames.length} 張，still=${stillValue(face, cfg)}）`],
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
  let call = cfg, request;
  if (cfg.useRequest) {
    onStep && onStep('建立 eKYC 案件…');
    const d = await post(cfg, ENDPOINTS.createRequest, new URLSearchParams({ requestTemplateUuid: cfg.templateUuid || '' }), signal)
      .catch(e => { throw new Error('建立 eKYC 案件失敗：' + e.message); });
    const pt = pick(d, 'platformToken');
    if (!pt) throw new Error('建立 eKYC 案件失敗：回應沒有 platformToken');
    request = { requestUuid: pick(d, 'requestUuid') };
    call = { ...cfg, platformAuth: pt }; // per-request token, memory only
  }
  const run = async (key, name, fn, interpret) => {
    onStep && onStep(name + '…');
    try {
      const data = await fn();
      steps.push({ key, name, data, ...interpret(data) });
    } catch (e) {
      steps.push({ key, name, ok: false, error: e.message, data: e.body, retake: e.retake });
    }
  };
  if (cfg.doSpoof) await run('spoof', '人臉活體檢查', () => post(call, ENDPOINTS.spoof, buildSpoofForm(face, cfg), signal), (d) => {
    const r = pick(d, 'result'), score = pick(d, 'livenessScore'), clear = pick(d, 'clearImageIndex');
    const dfS = pick(d, 'deepfakeDetectStatus'), dfC = pick(d, 'deepfakeDetectConfidence');
    let summary = `livenessScore：${fmt(score)}` + (clear !== undefined ? `，clearImageIndex：${fmt(clear)}` : '');
    if (dfS) summary += `，deepfake：${dfS === 'real' ? '真人' : dfS === 'fake' ? '偽造' : dfS}（${fmt(dfC)}）`;
    if (dfS === 'fake') return { ok: false, verdict: '偵測到深偽（deepfake）影像，請重拍人臉', summary, retake: 'face' };
    if (r === 'liveness') return { ok: true, verdict: '活體通過', summary };
    if (r === 'spoofing') return { ok: false, verdict: '判定為非真人（翻拍／照片／面具），請重拍人臉', summary, retake: 'face' };
    return { ok: false, verdict: '無法判讀活體結果：' + fmt(r), summary };
  });
  if (cfg.doOcr) await run('ocr', '證件 OCR', () => post(call, ENDPOINTS.ocr, buildOcrForm(card, cfg), signal), (d) => {
    const { result: r, info } = readOcr(d);
    if (r === 'ok') return { ok: true, verdict: '辨識完成', summary: ocrSummary(info), info };
    if (r === 'needMoreImage') return { ok: false, verdict: '證件影像不足或不清楚，系統需要更多張證件照：請重拍證件（拿穩、避免反光、讓證件填滿框線）', retake: 'card' };
    return { ok: false, verdict: '無法判讀 OCR 結果：' + fmt(r) };
  });
  if (cfg.doCompare) await run('compare', '證件與人臉 1:1 比對', () => post(call, ENDPOINTS.compare, buildCompareForm(card, face, cfg), signal), (d) => {
    const m = pick(d, 'isMatch'), s = pick(d, 'similarity'), th = pick(d, 'thresholds');
    const thv = th && typeof th === 'object' ? th.idcard : th;
    const summary = `similarity：${fmt(s)}` + (thv !== undefined ? `（門檻 ${fmt(thv)}）` : '');
    if (m === true) return { ok: true, verdict: '同一人', summary };
    if (m === false) return { ok: false, verdict: '比對不符，請確認證件與本人', summary };
    return { ok: false, verdict: '無法判讀比對結果', summary };
  });
  return { mock: false, request, steps };
}

function fmt(v) { return v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
