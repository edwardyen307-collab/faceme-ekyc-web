// Default engine: free, in-browser detection (own card-border heuristic + MediaPipe Face Landmarker).
// Results (v2026-11-11d):
//   captureIdCard -> { image: Blob (best frame), frames: Blob[] (best ~3, sharpest first, for idcard/ocr) }
//   captureFace   -> { image: Blob (still frame, for compare), frames: Blob[] (stage-1 sequence for
//                      face/spoofingcheck img_stg1_act_1), stillIndex: 0-based index of the still frame in frames,
//                      cameraInfo: string }
import { CardDetector } from '../card-detector.js?v=2026-11-11d';
import { FaceChecker, loadLandmarker } from '../face-checker.js?v=2026-11-11d';

const FRAME_MS = 70;          // ~14 fps analysis
const CARD_KEEP = 3;          // OCR doc recommends >= 3 idCardImage
const CARD_GRAB_MS = 110;
const SEQ_MAX = 15;           // spoofing stage-1 frames kept (ring buffer)
const SEQ_MIN = 10;           // don't finish before this many frames are buffered (unless manual)
const SEQ_GRAB_MS = 100;      // ~10 fps sequence
const SEQ_MAX_W = 720;

export class OpenSourceEngine {
  constructor() { this.id = 'opensource'; this.label = '開源引擎（瀏覽器端，MediaPipe + 自製證件框偵測）'; this._cancel = null; }

  prepare() { return loadLandmarker(); }

  cancel() { if (this._cancel) this._cancel(); }

  /**
   * ctx: { camera, ui, getGuide(): display rect, forceRef: {now:boolean}, cardOptions?, keep?, minFrames?, collectFront?, grabFull? }
   *   keep        – best-N frames returned in `frames` (default 3, for OCR)
   *   minFrames   – keep holding (silently) until this many good frames were collected
   *   collectFront– also return this many distinct good frames in `front` (forgery 'front' images), collected
   *                 silently during the normal hold – the user sees a single capture
   */
  captureIdCard(ctx) {
    const det = new CardDetector({ wantThumb: true, ...(ctx.cardOptions || {}) });
    const KEEP = ctx.keep || CARD_KEEP;
    const MIN = Math.max(ctx.minFrames || 0, ctx.collectFront || 0);
    const front = [], all = []; let thumb = null; let readySince = 0;
    const canvas = document.createElement('canvas');
    const cands = []; // {blob, sharp}
    let lastGrab = 0;
    const keep = (blob, sharp) => {
      cands.push({ blob, sharp });
      cands.sort((a, b) => b.sharp - a.sharp);
      cands.length = Math.min(cands.length, KEEP);
    };
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
      // every frame that passes all checks (holding still) is a candidate for the OCR set
      if ((out.state === 'hold' || out.state === 'capture') && rectVideo && ts - lastGrab >= (MIN > KEEP ? 80 : CARD_GRAB_MS)) {
        lastGrab = ts;
        const b = await cam.grab(pad(rectVideo, 0.04), 1600);
        keep(b, out.metrics.sharp || 0);
        if (ctx.collectFront && front.length < ctx.collectFront) front.push(b);
        if (MIN > KEEP) all.push(b);
      }
      if (out.thumb) thumb = out.thumb;
      const collected = MIN > KEEP ? all.length : cands.length;
      if (out.ready && !ctx.forceRef.now && collected < MIN) {
        // all checks passed; keep "capturing" a little longer to gather the extra frames silently
        if (!readySince) readySince = ts;
        if (ts - readySince < 4000) return null;
      }
      if (out.ready || ctx.forceRef.now) {
        if (!cands.length || ctx.forceRef.now) {
          const src = (out.ready && rectVideo) ? pad(rectVideo, 0.04) : pad(g, 0.02);
          keep(await cam.grab(src, 1600), ctx.forceRef.now ? Infinity : (out.metrics.sharp || 0));
        }
        const res = { image: cands[0].blob, frames: cands.map(c => c.blob), thumb };
        if (ctx.collectFront) res.front = front.length ? front.slice() : [cands[0].blob];
        if (MIN > KEEP) res.all = all.slice(-MIN);
        if (ctx.grabFull) res.full = await cam.grab({ x: 0, y: 0, w: cam.video.videoWidth, h: cam.video.videoHeight }, 1600);
        return res;
      }
      return null;
    });
  }

  captureCardShot(ctx) { return this.captureIdCard(ctx); }

  async captureFace(ctx) {
    ctx.ui.update({ state: 'loading', hint: '正在載入人臉偵測模型…', level: 'adjust', dir: 'wait', progress: 0, metrics: {} });
    const lmk = await loadLandmarker();
    const checker = new FaceChecker(ctx.faceOptions || {});
    const canvas = document.createElement('canvas');
    let lastVideoTs = -1, lastSeq = 0;
    const seq = []; // ring buffer of stage-1 frames (Blob)
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
      const crop = pad(o, 0.18);
      const nFaces = (res && res.faceLandmarks || []).length;
      if (nFaces !== 1) seq.length = 0; // sequence must show the (one) face continuously
      if (out.ready && !ctx.forceRef.now && seq.length < SEQ_MIN - 1) {
        // quality is fine but the liveness sequence is still short: keep holding a little longer
        ctx.ui.update({ ...out, state: 'hold', hint: '很好，請保持不動', level: 'good', dir: 'ok', ready: false, progress: 0.5 + 0.5 * seq.length / SEQ_MIN });
      } else if (out.ready || ctx.forceRef.now) {
        const image = await cam.grab(crop, 1280);
        seq.push(await cam.grab(crop, SEQ_MAX_W));
        while (seq.length > SEQ_MAX) seq.shift();
        return { image, frames: seq.slice(), stillIndex: seq.length - 1, cameraInfo: cam.info() };
      }
      if (nFaces === 1 && ts - lastSeq >= SEQ_GRAB_MS) {
        lastSeq = ts;
        seq.push(await cam.grab(crop, SEQ_MAX_W, 0.85));
        while (seq.length > SEQ_MAX - 1) seq.shift(); // leave room for the still frame
      }
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
            const r = await step(ts);
            if (r) { stopped = true; this._cancel = null; resolve(r); return; }
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
