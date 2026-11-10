// Default engine: free, in-browser detection (own card-border heuristic + MediaPipe Face Landmarker).
import { CardDetector } from '../card-detector.js';
import { FaceChecker, loadLandmarker } from '../face-checker.js';

const FRAME_MS = 70; // ~14 fps analysis

export class OpenSourceEngine {
  constructor() { this.id = 'opensource'; this.label = '開源引擎（瀏覽器端，MediaPipe + 自製證件框偵測）'; this._cancel = null; }

  prepare() { return loadLandmarker(); }

  cancel() { if (this._cancel) this._cancel(); }

  /** ctx: { camera, ui, getGuide(): display rect, forceRef: {now:boolean} } */
  captureIdCard(ctx) {
    const det = new CardDetector(ctx.cardOptions || {});
    const canvas = document.createElement('canvas');
    return this._loop(ctx, async (ts) => {
      const cam = ctx.camera;
      const g = cam.displayToVideo(ctx.getGuide());
      const m = 0.25;
      const region = { x: g.x - g.w * m, y: g.y - g.h * m, w: g.w * (1 + 2 * m), h: g.h * (1 + 2 * m) };
      const { img, region: rr, scale } = cam.sample(region, 320, canvas);
      const guideA = { x: (g.x - rr.x) * scale, y: (g.y - rr.y) * scale, w: g.w * scale, h: g.h * scale };
      const out = det.analyze(img, guideA, ts);
      let rectVideo = null;
      if (out.rect) rectVideo = { x: rr.x + out.rect.x / scale, y: rr.y + out.rect.y / scale, w: out.rect.w / scale, h: out.rect.h / scale };
      ctx.ui.update(out, rectVideo ? cam.videoToDisplay(rectVideo) : null);
      if (out.ready || ctx.forceRef.now) {
        const src = (out.ready && rectVideo) ? pad(rectVideo, 0.04) : pad(g, 0.02);
        return cam.grab(src, 1600);
      }
      return null;
    });
  }

  async captureFace(ctx) {
    ctx.ui.update({ state: 'loading', hint: '正在載入人臉偵測模型…', progress: 0, metrics: {} });
    const lmk = await loadLandmarker();
    const checker = new FaceChecker(ctx.faceOptions || {});
    const canvas = document.createElement('canvas');
    let lastVideoTs = -1;
    return this._loop(ctx, async (ts) => {
      const cam = ctx.camera, v = cam.video;
      if (!v.videoWidth) return null;
      const t = Math.max(lastVideoTs + 1, Math.round(performance.now()));
      lastVideoTs = t;
      const res = lmk.detectForVideo(v, t);
      const full = { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight };
      const { img, scale } = cam.sample(full, 360, canvas);
      const o = cam.displayToVideo(ctx.getGuide());
      const oval = { cx: (o.x + o.w / 2) * scale, cy: (o.y + o.h / 2) * scale, rx: o.w / 2 * scale, ry: o.h / 2 * scale };
      const out = checker.analyze(res, img, oval, cam.mirrored, ts);
      ctx.ui.update(out, null, res);
      if (out.ready || ctx.forceRef.now) return cam.grab(pad(o, 0.18), 1280);
      return null;
    });
  }

  _loop(ctx, step) {
    return new Promise((resolve, reject) => {
      let stopped = false, last = 0, busy = false;
      this._cancel = () => { stopped = true; reject(Object.assign(new Error('cancelled'), { code: 'cancelled' })); };
      const tick = async (ts) => {
        if (stopped) return;
        if (!busy && ts - last >= FRAME_MS) {
          busy = true; last = ts;
          try {
            const blob = await step(ts);
            if (blob) { stopped = true; this._cancel = null; resolve(blob); return; }
          } catch (e) { stopped = true; this._cancel = null; reject(e); return; }
          busy = false;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
}

function pad(r, p) { return { x: r.x - r.w * p, y: r.y - r.h * p, w: r.w * (1 + 2 * p), h: r.h * (1 + 2 * p) }; }
