// Adapter for the CyberLink FaceMe Platform Web SDK (FaceMeWebSDK_1.0.0.zip, "sdk" folder).
// The SDK files are distributed from FaceMe Platform Central (Developer page) and are NOT in this repo.
// API used below follows the FaceMe Platform Web SDK API document (see docs/API-NOTES.md):
//   - load sdk/faceme-web-sdk.js asynchronously; the SDK then calls window.facemeAsyncInit()
//   - FaceMe.init(success, fail, { path })        – face / anti-spoofing models (path default 'sdk/res')
//   - FaceMe.initIDCard(success, fail, { path })  – ID card models
//   - FaceMe.startIDCardCapture(cameraSetting, success(idCardDetectImages, fullScreenImage, snapshotScores, maResult), fail)
//   - FaceMe.startAntiSpoofing(cameraSetting, detectionSetting, success(detail, spoofingcheckImages, clearImage), fail)
//   - FaceMe.stopIDCardCapture() / stopAntiSpoofing() / release()
//   - errors: { code, message, details? }
// The SDK renders its own camera preview + hints into sdkBlockId / hintBlockId.
// Model files (*.fmin) must be served as application/octet-stream over HTTPS.
//
// Enable with ?engine=faceme&sdk=<url of faceme-web-sdk.js>  (default ./sdk/faceme-web-sdk.js;
// models are expected in <sdk dir>/res unless &sdkRes=<path> is given).

// eKYC Console OCR `type` -> SDK idCardStep. Types without an auto-capture step fall back to the
// open-source engine (the SDK only offers manual captureImage via 'front_g').
export const ID_CARD_STEP = {
  TW_ID_CARD_FRONT: 'front',
  TW_ID_CARD_BACK: 'back',
  TW_HEALTHCARE_CARD_FRONT: 'nhi_front',
  TW_DRIVER_LICENSE_FRONT: 'driver_license_front',
  TW_DRIVER_LICENSE_BACK: 'driver_license_back',
  TW_ARC_FRONT: 'arc_front',
  TW_ARC_BACK: 'arc_back',
  PASSPORT: 'passport_front',
};

export const SDK_ERRORS = {
  100: 'SDK 設定錯誤：找不到顯示區塊（sdkBlockId）',
  101: 'SDK 無法變更設定',
  102: 'SDK 參數名稱錯誤',
  103: 'SDK 參數值錯誤',
  104: 'SDK 尚未初始化',
  105: '影像尺寸不正確',
  300: '找不到相機',
  301: '找不到指定的相機',
  302: '行動裝置不支援切換相機',
  303: '相機無法播放（請確認已允許相機權限）',
  400: '逾時，請重新拍攝',
  404: '找不到 SDK 模型檔（請確認 res 路徑與 .fmin MIME 設定）',
  500: 'SDK 發生未預期錯誤',
};
export function sdkError(err) {
  const code = err && typeof err === 'object' ? err.code : err;
  const msg = SDK_ERRORS[code] || 'FaceMe SDK 錯誤';
  return Object.assign(new Error(`${msg}（code ${code ?? '?'}${err && err.message ? '：' + err.message : ''}）`), { sdkCode: code, name: 'FaceMeSdkError' });
}

export class FaceMeSdkEngine {
  /**
   * @param {{sdkUrl?:string, resPath?:string, fallback?:object, strictMode?:boolean}} opts
   *   fallback = engine used for card types the SDK cannot auto-capture.
   */
  constructor({ sdkUrl, resPath, fallback, strictMode } = {}) {
    this.id = 'faceme'; this.label = 'FaceMe Platform Web SDK';
    this.sdkUrl = sdkUrl || './sdk/faceme-web-sdk.js';
    this.resPath = resPath || this.sdkUrl.replace(/[^/]*$/, '') + 'res';
    this.fallback = fallback || null;
    this.strictMode = !!strictMode;
    this._load = null; this._face = null; this._card = null; this._active = null;
  }

  /** Inject the SDK script once and wait for window.facemeAsyncInit. */
  load() {
    if (this._load) return this._load;
    this._load = new Promise((resolve, reject) => {
      if (window.FaceMe) { resolve(window.FaceMe); return; }
      const timer = setTimeout(() => reject(new Error('FaceMe Web SDK 載入逾時')), 30000);
      const prev = window.facemeAsyncInit;
      window.facemeAsyncInit = function () {
        clearTimeout(timer);
        try { if (typeof prev === 'function') prev(); } catch (_) {}
        resolve(window.FaceMe);
      };
      const s = document.createElement('script');
      s.src = this.sdkUrl; s.async = true;
      s.onerror = () => { clearTimeout(timer); this._load = null; reject(new Error('無法載入 FaceMe Web SDK：' + this.sdkUrl)); };
      document.head.appendChild(s);
    });
    return this._load;
  }
  initFace() {
    if (!this._face) this._face = this.load().then(F => new Promise((res, rej) =>
      F.init(() => res(F), (e) => { this._face = null; rej(sdkError(e)); }, { path: this.resPath })));
    return this._face;
  }
  initCard() {
    if (!this._card) this._card = this.load().then(F => new Promise((res, rej) =>
      F.initIDCard(() => res(F), (e) => { this._card = null; rej(sdkError(e)); }, { path: this.resPath })));
    return this._card;
  }
  prepare() { return this.initFace(); }

  cancel() {
    const F = window.FaceMe;
    try { if (this._active === 'card') F && F.stopIDCardCapture(); if (this._active === 'face') F && F.stopAntiSpoofing(); } catch (_) {}
    if (this._reject) { const r = this._reject; this._reject = null; r(Object.assign(new Error('cancelled'), { code: 'cancelled' })); }
    this._active = null; this._unmount();
    if (this.fallback) this.fallback.cancel();
  }
  release() { try { window.FaceMe && window.FaceMe.release(); } catch (_) {} this._face = this._card = null; }

  _mount(stage) {
    let block = document.getElementById('faceme-sdk-block');
    if (!block) {
      block = document.createElement('div'); block.id = 'faceme-sdk-block'; block.className = 'sdk-block';
      const hint = document.createElement('div'); hint.id = 'faceme-sdk-hint'; hint.className = 'sdk-hint';
      stage.appendChild(block); stage.appendChild(hint);
    }
    stage.classList.add('sdk-mode');
    return { sdkBlockId: 'faceme-sdk-block', hintBlockId: 'faceme-sdk-hint' };
  }
  _unmount() {
    for (const id of ['faceme-sdk-block', 'faceme-sdk-hint']) { const e = document.getElementById(id); if (e) e.remove(); }
    document.querySelectorAll('.sdk-mode').forEach(e => e.classList.remove('sdk-mode'));
  }
  _hintStyle() { return { fontSize: '18px', color: '#ffffff', fontFamily: '-apple-system, "PingFang TC", "Noto Sans TC", sans-serif' }; }

  /** Forgery shots (front / rightSide) use the built-in detector. */
  async captureCardShot(ctx) {
    if (!this.fallback) throw new Error('需要預設引擎來拍攝防偽影像');
    if (!ctx.camera.stream) await ctx.camera.open('environment'); // the SDK capture released the camera
    return this.fallback.captureIdCard(ctx);
  }

  /** ctx.cardType = eKYC OCR type. Returns { image, frames[], scores[] }. */
  async captureIdCard(ctx) {
    const step = ID_CARD_STEP[ctx.cardType];
    // forgery needs several distinct front frames (and the back side the portrait-based front/back check), which the SDK
    // capture does not return: use the built-in detector for that side.
    if (this.fallback && (ctx.collectFront || ctx.side === 'back')) {
      if (!ctx.camera.stream) await ctx.camera.open('environment');
      return this.fallback.captureIdCard(ctx);
    }
    if (!step) {
      if (this.fallback) return this.fallback.captureIdCard(ctx);
      throw new Error('FaceMe SDK 不支援自動拍攝此證件類型：' + ctx.cardType);
    }
    const F = await this.initCard();
    ctx.camera.stop();
    ctx.ui.update({ state: 'sdk', hint: 'FaceMe SDK：請依畫面指示拍攝證件', progress: 0, metrics: {} });
    const ids = this._mount(ctx.stage);
    this._active = 'card';
    try {
      const [images, , scores] = await new Promise((resolve, reject) => {
        this._reject = reject;
        F.startIDCardCapture(
          { ...ids, captureMode: 'IDCard', idCardStep: step, enableIdcardAS: false, showHintImg: true, hintStyle: this._hintStyle() },
          (idCardDetectImages, fullScreenImage, snapshotScores, maResult) => resolve([idCardDetectImages, fullScreenImage, snapshotScores, maResult]),
          (e) => reject(sdkError(e)));
      });
      const list = (Array.isArray(images) ? images : [images]).filter(Boolean);
      if (!list.length) throw new Error('FaceMe SDK 沒有回傳證件影像');
      const order = list.map((_, i) => i).sort((a, b) => ((scores && scores[b]) || 0) - ((scores && scores[a]) || 0));
      const blobs = await Promise.all(order.map(i => toJpeg(list[i])));
      return { image: blobs[0], frames: blobs.slice(0, 3), scores: order.map(i => scores && scores[i]) };
    } finally {
      try { F.stopIDCardCapture(); } catch (_) {}
      this._reject = null; this._active = null; this._unmount();
    }
  }

  /**
   * Single-stage anti-spoofing (matches eKYC Console face/spoofingcheck, which takes img_stg1_act_1 only).
   * Returns { image, frames[], detail (SDK object, sent to the Console as-is), cameraInfo, still }.
   */
  async captureFace(ctx) {
    const F = await this.initFace();
    ctx.camera.stop();
    ctx.ui.update({ state: 'sdk', hint: 'FaceMe SDK：請依畫面指示拍攝人臉', progress: 0, metrics: {} });
    const ids = this._mount(ctx.stage);
    this._active = 'face';
    try {
      const cameraSetting = { ...ids, hintStyle: this._hintStyle() };
      if (this.strictMode) cameraSetting.enableStrictMode = true; // CyberLink encryption; only with the web component
      const [detail, imgs, clear] = await new Promise((resolve, reject) => {
        this._reject = reject;
        F.startAntiSpoofing(cameraSetting, { antiSpoofingType: 'SINGLE_STAGE' },
          (d, spoofingcheckImages, clearImage) => resolve([d, spoofingcheckImages, clearImage]),
          (e) => reject(sdkError(e)));
      });
      const frames = ((imgs && imgs.img_stg1_act_1) || []).filter(Boolean);
      const clearList = (Array.isArray(clear) ? clear : [clear]).filter(Boolean);
      const image = clearList[0] || frames[frames.length - 1];
      if (!image) throw new Error('FaceMe SDK 沒有回傳人臉影像');
      const det = typeof detail === 'string' ? safeJson(detail) : detail;
      const still = det && det.stg1_act_1 && det.stg1_act_1.still;
      return { image: await toJpeg(image), frames: await Promise.all(frames.map(toJpeg)), detail, still, cameraInfo: det && det.cameraInfo };
    } finally {
      try { F.stopAntiSpoofing(); } catch (_) {}
      this._reject = null; this._active = null; this._unmount();
    }
  }
}

function safeJson(s) { try { return JSON.parse(s); } catch (_) { return null; } }

/** Blob | ImageData | canvas | data URL -> JPEG Blob */
export async function toJpeg(v) {
  if (v instanceof Blob) return v;
  if (typeof v === 'string' && v.startsWith('data:')) return (await fetch(v)).blob();
  let c = v;
  if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
    c = document.createElement('canvas'); c.width = v.width; c.height = v.height; c.getContext('2d').putImageData(v, 0, 0);
  }
  if (c && typeof c.toBlob === 'function') return new Promise((r, j) => c.toBlob(b => (b ? r(b) : j(new Error('toBlob failed'))), 'image/jpeg', 0.92));
  throw new Error('無法辨識 FaceMe SDK 回傳的影像格式');
}
