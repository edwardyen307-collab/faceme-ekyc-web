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

// UI choices. `sides` = OCR types captured in order (TW ID: front only, or front + back).
export const CARD_TYPES = [
  ['TWID_FRONT', '身分證正面', ['TW_ID_CARD_FRONT']],
  ['TWID_BOTH', '身分證兩面', ['TW_ID_CARD_FRONT', 'TW_ID_CARD_BACK']],
  ['TW_ARC_FRONT', '居留證（正面）', ['TW_ARC_FRONT']],
  ['TW_ARC_BACK', '居留證（背面）', ['TW_ARC_BACK']],
  ['TW_HEALTHCARE_CARD_FRONT', '健保卡（正面）', ['TW_HEALTHCARE_CARD_FRONT']],
  ['TW_DRIVER_LICENSE_FRONT', '駕照（正面）', ['TW_DRIVER_LICENSE_FRONT']],
  ['TW_DRIVER_LICENSE_BACK', '駕照（背面）', ['TW_DRIVER_LICENSE_BACK']],
  ['PASSPORT', '護照', ['PASSPORT']],
  ['TW_CAR_REGISTRATION', '汽車行照', ['TW_CAR_REGISTRATION']],
  ['TW_MOTORCYCLE_REGISTRATION', '機車行照', ['TW_MOTORCYCLE_REGISTRATION']],
];
export const SIDE_LABEL = { TW_ID_CARD_FRONT: '正面', TW_ID_CARD_BACK: '背面' };
/** Old saved values (v11c) -> new choice. */
export function normalizeCardChoice(v) {
  if (v === 'TW_ID_CARD_FRONT' || v === 'TW_ID_CARD_BACK') return 'TWID_FRONT';
  return CARD_TYPES.some(t => t[0] === v) ? v : 'TWID_FRONT';
}
export const sidesOf = (choice) => (CARD_TYPES.find(t => t[0] === choice) || CARD_TYPES[0])[2];

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
  strictMode: false, deepfake: false, imageDeskewed: false, idLargestFace: true, stillZeroBased: false,
  doForgery: false,
  ocrSideCheck: true,     // real mode: after each TW ID capture, run OCR once and check the fields belong to that side
  autoTrack: false,       // 自動追拍: the frame follows the card anywhere in view (default: fixed frame)
};
// Never persisted: secrets stay in memory for this page only.
const SECRET_KEYS = ['token', 'platformAuth'];

export function loadConfig() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (SECRET_KEYS.some(k => c[k])) { for (const k of SECRET_KEYS) delete c[k]; localStorage.setItem(LS_KEY, JSON.stringify(c)); } // purge older saves
      delete c.remember;
      return { ...DEFAULT_CONFIG, ...c, token: '', platformAuth: '' };
    }
  } catch (_) {}
  return { ...DEFAULT_CONFIG };
}
export function saveConfig(cfg) {
  const c = { ...cfg }; for (const k of SECRET_KEYS) delete c[k]; delete c.remember;
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch (_) {}
}

// ---------- ID card forgery (TW ID card front/back only) ----------
export const FORGERY_TYPES = ['TW_ID_CARD_FRONT', 'TW_ID_CARD_BACK'];
export const FORGERY_DEFAULT_COUNTS = { front: 5, rightSide: 2, full: 0 };
export const forgeryApplies = (cfg, type) => !!cfg.doForgery && FORGERY_TYPES.includes(type);
/** Ask the Console how many images it wants (Forgery Requirements API); falls back to 5/2/0. */
export async function getForgeryRequirement(cfg, type, signal) {
  if (cfg.mode !== 'real' || !cfg.baseUrl) return { ...FORGERY_DEFAULT_COUNTS, source: 'default' };
  try {
    const { call } = await prepareCall(cfg, null, signal);
    const d = await post(call, ENDPOINTS.forgeryRequirement, buildForgeryRequirementForm(type), signal);
    const c = pick(d, 'imageCounts') || {};
    const n = (v, dflt) => (Number.isFinite(+v) && +v >= 0 && +v <= 10 ? +v : dflt);
    return { front: n(c.front, 5), rightSide: n(c.rightSide, 2), full: n(c.full, 0), source: 'api' };
  } catch (e) {
    return { ...FORGERY_DEFAULT_COUNTS, source: 'default', error: e.message };
  }
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
  // card.deskewed: the auto-tracking crop is already perspective-corrected (OCR images only; forgery uses originals)
  if (cfg.imageDeskewed || card.deskewed) f.append('imageDeskewed', 'true');
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

// ---------- post-capture OCR side check (TW ID, real mode only) ----------
export const OCR_SIDE_FIELDS = {
  TW_ID_CARD_FRONT: ['fullName', 'name', 'identityNumber', 'dateOfBirth', 'sex', 'dateOfIssue'],
  TW_ID_CARD_BACK: ['Father', 'Mother', 'Spouse', 'militaryService', 'placeOfBirth', 'address', 'serialNumber', 'barCode'],
};
const filled = (info, keys) => keys.filter(k => { const v = info && info[k]; return v !== undefined && v !== null && String(v).trim() !== ''; }).length;
/** OCR info vs the side that was meant to be captured -> 'ok' | 'mismatch' (other side's fields) | 'empty' (nothing read). */
export function judgeOcrSide(type, info) {
  const own = OCR_SIDE_FIELDS[type]; if (!own) return { verdict: 'ok', own: 0, other: 0 };
  const otherType = type === 'TW_ID_CARD_FRONT' ? 'TW_ID_CARD_BACK' : 'TW_ID_CARD_FRONT';
  const o = filled(info, own), x = filled(info, OCR_SIDE_FIELDS[otherType]);
  if (!o && !x) return { verdict: 'empty', own: o, other: x };
  if (x > o) return { verdict: 'mismatch', own: o, other: x };
  return { verdict: 'ok', own: o, other: x };
}
/**
 * Right after a capture: run /idcard/ocr once and check the fields match the expected side.
 * mock mode / setting off / not a TW ID side -> { status:'skipped' } (no request, no claim).
 * Wrong side or unreadable -> { status:'reject', key, msg } (caller asks for a retake).
 * Network / auth / server problems -> { status:'unverified', msg } (not blocking; the full upload reports it).
 * A successful result is cached on the shot (shot.ocrCheck) so the final upload reuses it.
 */
export async function verifyOcrSide(cfg, shot, signal) {
  if (cfg.mode !== 'real' || !cfg.ocrSideCheck || !cfg.baseUrl || !OCR_SIDE_FIELDS[shot.type]) return { status: 'skipped' };
  const front = shot.type === 'TW_ID_CARD_FRONT';
  let d;
  try {
    const { call } = await prepareCall(cfg, null, signal);
    d = await post(call, ENDPOINTS.ocr, buildOcrForm(shot, cfg), signal);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    if (e.retake === 'card' || e.status === 400) return { status: 'reject', key: 'card.ocrUnreadable', msg: e.message, data: e.body };
    return { status: 'unverified', msg: e.message, data: e.body };
  }
  const { result, info } = readOcr(d);
  if (result === 'needMoreImage') return { status: 'reject', key: 'card.ocrUnreadable', msg: '證件影像不夠清楚', data: d };
  if (result !== 'ok') return { status: 'unverified', msg: '無法判讀 OCR 結果：' + fmt(result), data: d };
  const j = judgeOcrSide(shot.type, info);
  if (j.verdict === 'mismatch') return { status: 'reject', key: front ? 'card.ocrWrongFront' : 'card.ocrWrongBack', judge: j, data: d };
  if (j.verdict === 'empty') return { status: 'reject', key: 'card.ocrUnreadable', judge: j, data: d };
  return { status: 'ok', judge: j, data: d, info };
}

// ---------- per-session eKYC case (Create Request) ----------
let session = null; // { key, request, platformAuth } – memory only
export function resetSession() { session = null; }
function checkBase(cfg) {
  if (!/^https:\/\//i.test(cfg.baseUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(cfg.baseUrl)) {
    throw new Error('實際上傳需要 https:// 的伺服器網址');
  }
}
/** Returns the config to call platform APIs with (adds the case's platformToken when "create case" is on). */
export async function prepareCall(cfg, onStep, signal) {
  checkBase(cfg);
  if (!cfg.useRequest) return { call: cfg, request: null };
  const key = cfg.baseUrl + '|' + (cfg.templateUuid || '');
  if (!session || session.key !== key) {
    onStep && onStep('建立 eKYC 案件…');
    const d = await post(cfg, ENDPOINTS.createRequest, new URLSearchParams({ requestTemplateUuid: cfg.templateUuid || '' }), signal)
      .catch(e => { throw new Error('建立 eKYC 案件失敗：' + e.message); });
    const pt = pick(d, 'platformToken');
    if (!pt) throw new Error('建立 eKYC 案件失敗：回應沒有 platformToken');
    session = { key, request: { requestUuid: pick(d, 'requestUuid') }, platformAuth: pt };
  }
  return { call: { ...cfg, platformAuth: session.platformAuth }, request: session.request };
}

const pct = (v) => (v === undefined || v === null || isNaN(+v) ? null : (+v <= 1 ? +v * 100 : +v));
/** compare-boost/idcard response -> { isMatch, similarity%, threshold% } */
export function readCompare(d) {
  const th = pick(d, 'thresholds');
  return { isMatch: pick(d, 'isMatch'), similarity: pct(pick(d, 'similarity')), threshold: pct(th && typeof th === 'object' ? th.idcard : th) };
}
/** Stand-alone 人證比對 (ID photo vs selfie). Mock mode returns { mock:true } – no result is invented. */
export async function compareFaces(cfg, card, face, signal) {
  if (cfg.mode !== 'real') return { mock: true };
  const { call } = await prepareCall(cfg, null, signal);
  const d = await post(call, ENDPOINTS.compare, buildCompareForm(card, face, cfg), signal);
  return { mock: false, ...readCompare(d), data: d };
}

/**
 * card = { image, frames[], type, forgery?, back?: { image, frames[], type, forgery? } }
 * face = { image, frames[], stillIndex | (detail, still), cameraInfo }
 * Order: [create case] -> spoofingcheck -> ocr (each side) -> compare -> forgery (each side).
 * @returns {Promise<{mock:boolean, request?:object, steps:Array<{key,name,ok,verdict?,summary?,data?,error?,retake?}>}>}
 */
export async function uploadEkyc(cfg, card, face, onStep, signal) {
  const sides = [card, card.back].filter(Boolean);
  const sideName = (c) => (sides.length > 1 ? `（${SIDE_LABEL[c.type] || c.type}）` : '');
  if (cfg.mode !== 'real') {
    const steps = [];
    const plan = [['spoof', '真人檢查']];
    sides.forEach(c => plan.push(['ocr', `讀取證件資料${sideName(c)}`]));
    plan.push(['compare', '人證比對']);
    sides.forEach(c => { if (c.forgery) plan.push(['forgery', `證件真偽辨識${sideName(c)}`]); });
    for (const [key, name] of plan) {
      onStep && onStep(`模擬：${name}…`);
      await new Promise(r => setTimeout(r, 350));
      steps.push({ key, name, ok: true, summary: '模擬，未送出' });
    }
    return { mock: true, steps };
  }
  const steps = [];
  const { call, request } = await prepareCall(cfg, onStep, signal);
  const run = async (key, name, fn, interpret, extra = {}) => {
    onStep && onStep(name + '…');
    try {
      const data = await fn();
      steps.push({ key, name, data, ...extra, ...interpret(data) });
    } catch (e) {
      steps.push({ key, name, ok: false, error: e.message, data: e.body, retake: e.retake, ...extra });
    }
  };
  if (cfg.doSpoof) await run('spoof', '真人檢查', () => post(call, ENDPOINTS.spoof, buildSpoofForm(face, cfg), signal), (d) => {
    const r = pick(d, 'result'), score = pick(d, 'livenessScore'), clear = pick(d, 'clearImageIndex');
    const dfS = pick(d, 'deepfakeDetectStatus'), dfC = pick(d, 'deepfakeDetectConfidence');
    let summary = `分數：${fmt(score)}` + (clear !== undefined ? `，最清晰影格：${fmt(clear)}` : '');
    if (dfS) summary += `，AI 合成臉：${dfS === 'real' ? '未發現' : dfS === 'fake' ? '疑似' : dfS}（${fmt(dfC)}）`;
    if (dfS === 'fake') return { ok: false, verdict: '疑似 AI 合成臉，請重拍人臉', summary, retake: 'face' };
    if (r === 'liveness') return { ok: true, verdict: '是真人', summary };
    if (r === 'spoofing') return { ok: false, verdict: '判定為非真人（翻拍／照片／面具），請重拍人臉', summary, retake: 'face' };
    return { ok: false, verdict: '無法判讀真人檢查結果：' + fmt(r), summary };
  });
  // reuse the OCR result of the post-capture side check (same images) instead of sending them twice
  const ocrOnce = (c) => (c.ocrCheck && c.ocrCheck.status === 'ok' && c.ocrCheck.data ? Promise.resolve(c.ocrCheck.data) : post(call, ENDPOINTS.ocr, buildOcrForm(c, cfg), signal));
  if (cfg.doOcr) for (const c of sides) await run('ocr', `讀取證件資料${sideName(c)}`, () => ocrOnce(c), (d) => {
    const { result: r, info } = readOcr(d);
    if (r === 'ok') return { ok: true, verdict: '讀取完成', summary: ocrSummary(info), info };
    if (r === 'needMoreImage') return { ok: false, verdict: '證件影像不夠清楚，請重拍證件（拿穩、避免反光、讓證件填滿框線）', retake: 'card' };
    return { ok: false, verdict: '無法判讀證件資料：' + fmt(r) };
  }, { side: c.type });
  if (cfg.doCompare) await run('compare', '人證比對', () => post(call, ENDPOINTS.compare, buildCompareForm(card, face, cfg), signal), (d) => {
    const c = readCompare(d);
    const summary = `相似度 ${c.similarity === null ? '—' : c.similarity.toFixed(1) + '%'}` + (c.threshold !== null ? `（門檻 ${c.threshold.toFixed(1)}%）` : '');
    if (c.isMatch === true) return { ok: true, verdict: '是同一人', summary, compare: c };
    if (c.isMatch === false) return { ok: false, verdict: '不是同一人，請確認證件與本人', summary, compare: c };
    return { ok: false, verdict: '無法判讀比對結果', summary };
  });
  for (const c of sides) if (c.forgery) await run('forgery', `證件真偽辨識${sideName(c)}`, () => post(call, ENDPOINTS.forgery, buildForgeryForm(c.type, c.forgery.shots, c.forgery.full, cfg), signal), (d) => {
    const r = pick(d, 'result'), sc = pick(d, 'realScore'), why = pick(d, 'rejectReason');
    const summary = `分數：${fmt(sc)}` + (why ? `，原因：${fmt(why)}` : '');
    if (r === 'real') return { ok: true, verdict: '證件為真', summary };
    if (r === 'forgery') return { ok: false, verdict: '疑似偽造或翻拍的證件，請改用實體證件重拍', summary, retake: 'card' };
    if (r === 'unknown') return { ok: false, verdict: '無法判定真偽，請在光線充足處重拍證件', summary, retake: 'card' };
    return { ok: false, verdict: '無法判讀真偽結果：' + fmt(r), summary };
  }, { side: c.type });
  return { mock: false, request, steps };
}

function fmt(v) { return v === undefined || v === null ? '—' : (typeof v === 'object' ? JSON.stringify(v) : String(v)); }
