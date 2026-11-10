// Adapter for the CyberLink FaceMe Platform Web SDK (FaceMeWebSDK_1.0.0.zip).
//
// STATUS: skeleton. The SDK package (sample + JS) is only distributed from the FaceMe Platform
// Central "Developer" page and is NOT in this repo. Only these entry points are confirmed by the
// "FaceMe Platform Web SDK API Document" (via the colleague bot's reading, pp.2, 4-10):
//   window.facemesasyncinit, FaceMe.init, FaceMe.startAntispoofing, FaceMe.startIDCardCapture
// Exact argument / callback / result shapes are NOT confirmed here; every place that depends on
// them is marked "TODO(SDK)". Fill these in from the PDF/sample once the zip is on hand.
//
// Enable with ?engine=faceme&sdk=<url-of-sdk-js> (same-origin path recommended, e.g. ./faceme-sdk/faceme.js)
// and optional runtime init JSON in 進階設定 (never committed).

export class FaceMeSdkEngine {
  constructor({ sdkUrl, initOptions } = {}) {
    this.id = 'faceme'; this.label = 'FaceMe Platform Web SDK'; this.sdkUrl = sdkUrl; this.initOptions = initOptions || {};
    this._ready = null;
  }

  prepare() {
    if (this._ready) return this._ready;
    this._ready = new Promise((resolve, reject) => {
      if (!this.sdkUrl) { reject(new Error('未設定 FaceMe Web SDK 路徑（?sdk=）')); return; }
      const timer = setTimeout(() => reject(new Error('FaceMe Web SDK 載入逾時')), 20000);
      // The SDK calls window.facemesasyncinit once its script is loaded (async-init pattern).
      window.facemesasyncinit = async () => {
        try {
          // TODO(SDK): confirm FaceMe.init signature/return (Promise vs callback) and required fields
          // (license key / Platform Central server URL / access token, etc.).
          const r = window.FaceMe.init(this.initOptions);
          if (r && typeof r.then === 'function') await r;
          clearTimeout(timer); resolve(window.FaceMe);
        } catch (e) { clearTimeout(timer); reject(e); }
      };
      const s = document.createElement('script');
      s.src = this.sdkUrl; s.async = true; s.onerror = () => { clearTimeout(timer); reject(new Error('無法載入 FaceMe Web SDK：' + this.sdkUrl)); };
      document.head.appendChild(s);
    });
    return this._ready;
  }

  cancel() { /* TODO(SDK): call the SDK's stop/cancel API if it exposes one */ }

  /** The SDK drives its own camera UI; we stop ours first and hand it the stage element. */
  async captureIdCard(ctx) {
    const FaceMe = await this.prepare();
    ctx.camera.stop();
    ctx.ui.update({ state: 'sdk', hint: 'FaceMe SDK：請依畫面指示拍攝證件', progress: 0, metrics: {} });
    // TODO(SDK): confirm option names (container element, card type, quality thresholds).
    const result = await callSdk(FaceMe.startIDCardCapture, FaceMe, { container: ctx.stage });
    return toBlob(result);
  }

  async captureFace(ctx) {
    const FaceMe = await this.prepare();
    ctx.camera.stop();
    ctx.ui.update({ state: 'sdk', hint: 'FaceMe SDK：請依畫面指示完成活體檢測', progress: 0, metrics: {} });
    // TODO(SDK): confirm option names and where the captured face image + liveness verdict live.
    const result = await callSdk(FaceMe.startAntispoofing, FaceMe, { container: ctx.stage });
    if (result && result.isLive === false) throw new Error('活體檢測未通過');
    return toBlob(result);
  }
}

// Accept either a Promise-returning API or a callback-style API ({onSuccess,onError} / (err,res)).
function callSdk(fn, self, options) {
  if (typeof fn !== 'function') return Promise.reject(new Error('FaceMe SDK 缺少此功能'));
  return new Promise((resolve, reject) => {
    const opts = { ...options, onSuccess: resolve, onResult: resolve, onError: reject, onFail: reject };
    try {
      const r = fn.call(self, opts, (err, res) => (err ? reject(err) : resolve(res)));
      if (r && typeof r.then === 'function') r.then(resolve, reject);
    } catch (e) { reject(e); }
  });
}

// TODO(SDK): adjust to the real result field (Blob / ImageData / canvas / base64 / dataURL).
async function toBlob(res) {
  if (!res) throw new Error('FaceMe SDK 沒有回傳影像');
  const v = res.blob || res.image || res.imageData || res.croppedImage || res.data || res;
  if (v instanceof Blob) return v;
  if (typeof v === 'string') {
    const url = v.startsWith('data:') ? v : 'data:image/jpeg;base64,' + v;
    return (await fetch(url)).blob();
  }
  if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return new Promise(r => v.toBlob(r, 'image/jpeg', 0.92));
  if (typeof ImageData !== 'undefined' && v instanceof ImageData) {
    const c = document.createElement('canvas'); c.width = v.width; c.height = v.height; c.getContext('2d').putImageData(v, 0, 0);
    return new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  }
  throw new Error('無法辨識 FaceMe SDK 回傳的影像格式');
}
