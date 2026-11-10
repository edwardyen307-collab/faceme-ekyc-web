// Selfie quality gate on top of MediaPipe Face Landmarker (Apache-2.0, vendored in /vendor).
// Decides: one face, inside oval, size, frontal pose, eyes open, not occluded, bright, sharp,
// held still >= holdMs. Occlusion is a colour/geometry heuristic (best effort, see README).
import { toGray, laplacianVariance, patchYCbCr } from './imageops.js';

export const FACE_DEFAULTS = {
  minSize: 0.66, maxSize: 0.98,   // face width / oval width
  maxCenter: 0.20,                // normalised ellipse distance of face centre
  maxYaw: 14, maxPitch: 16, maxRoll: 10, // degrees (from transformation matrix)
  yawRatio: 0.09,                 // landmark fallback: nose offset / face width
  pitchLo: 0.22, pitchHi: 0.48, pitchNeutral: 0.35, // (nose.y-eye.y)/(chin.y-eye.y); measured ≈0.33 on a frontal test face
  maxBlink: 0.5,
  minLuma: 65, maxLuma: 235,
  minSharpness: 22,
  maxMove: 0.035,                 // per-frame landmark motion / face width
  holdMs: 500,
  maskChroma: 11, maskLumaLo: 0.55, maskLumaHi: 1.5, minLipCr: 1.0, minEyeLuma: 0.38,
};

const IDX = { leftCheek: 234, rightCheek: 454, forehead: 151, top: 10, chin: 152, noseTip: 1, noseBridge: 168,
  upperLip: 0, lowerLip: 17, mouthL: 61, mouthR: 291, cheekA: 205, cheekB: 425, eyeA: 468, eyeB: 473,
  eyeA_out: 33, eyeB_out: 263 };

function blend(cats, name) {
  const c = cats && cats.find(x => x.categoryName === name);
  return c ? c.score : 0;
}

function matrixAngles(m) {
  if (!m || !m.data || m.data.length < 16) return null;
  const d = m.data; // column-major 4x4
  const r = (i, j) => d[j * 4 + i];
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * 180 / Math.PI;
  const yaw = Math.asin(Math.max(-1, Math.min(1, -r(2, 0)))) * 180 / Math.PI;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * 180 / Math.PI;
  return { yaw, pitch, roll };
}

export class FaceChecker {
  constructor(opts = {}) { this.o = { ...FACE_DEFAULTS, ...opts }; this.reset(); }
  reset() { this.prev = null; this.holdSince = 0; }

  /**
   * @param {object} res FaceLandmarkerResult
   * @param {ImageData} img analysis frame (full video frame, downscaled, NOT mirrored)
   * @param {{cx:number,cy:number,rx:number,ry:number}} oval in analysis pixel coords
   * @param {boolean} mirrored whether the preview is mirrored (front camera)
   */
  analyze(res, img, oval, mirrored, ts) {
    const o = this.o, W = img.width, H = img.height;
    const metrics = {};
    const fail = (state, hint) => { this.holdSince = 0; return { state, hint, ready: false, metrics, progress: 0 }; };
    const faces = (res && res.faceLandmarks) || [];
    metrics.faces = faces.length;
    if (faces.length === 0) return fail('noface', '請把臉移進橢圓框');
    if (faces.length > 1) return fail('multi', '畫面中只能有一張臉');
    const lm = faces[0];
    const P = i => ({ x: lm[i].x * W, y: lm[i].y * H });
    const sgn = mirrored ? -1 : 1; // display-space x direction
    const lc = P(IDX.leftCheek), rc = P(IDX.rightCheek);
    const faceW = Math.hypot(rc.x - lc.x, rc.y - lc.y);
    const top = P(IDX.top), chin = P(IDX.chin), nose = P(IDX.noseTip), bridge = P(IDX.noseBridge);
    const fc = { x: (lc.x + rc.x) / 2, y: (top.y + chin.y) / 2 };
    const size = faceW / (2 * oval.rx);
    const dx = (fc.x - oval.cx) / oval.rx, dy = (fc.y - oval.cy) / oval.ry;
    const cdist = Math.hypot(dx, dy);
    Object.assign(metrics, { size: +size.toFixed(2), dx: +dx.toFixed(2), dy: +dy.toFixed(2) });

    // whole face must fit inside oval (bounding box of all landmarks, slightly relaxed)
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of lm) { const x = p.x * W, y = p.y * H; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    const outside = (minX < 0 || minY < 0 || maxX > W || maxY > H);

    if (size < o.minSize * 0.75 && cdist > 0.6) return fail('position', '請把臉移進橢圓框');
    if (outside || cdist > o.maxCenter) {
      const ddx = dx * sgn; // display direction
      if (Math.abs(ddx) >= Math.abs(dy)) return fail('position', ddx > 0 ? '臉偏右了，請往左移一點' : '臉偏左了，請往右移一點');
      return fail('position', dy > 0 ? '臉偏下了，請把手機放低一點' : '臉偏上了，請把手機抬高一點');
    }
    if (size < o.minSize) return fail('far', '靠近一點');
    if (size > o.maxSize) return fail('near', '退後一點');

    // pose
    const ang = matrixAngles(res.facialTransformationMatrixes && res.facialTransformationMatrixes[0]);
    const eyeMid = { x: (P(IDX.eyeA_out).x + P(IDX.eyeB_out).x) / 2, y: (P(IDX.eyeA_out).y + P(IDX.eyeB_out).y) / 2 };
    const yawR = ((nose.x - fc.x) / faceW) * sgn;  // + : nose points to display-right
    const pitchR = (nose.y - eyeMid.y) / Math.max(1, chin.y - eyeMid.y);
    const ea = P(IDX.eyeA_out), eb = P(IDX.eyeB_out);
    const rollDeg = Math.atan2(eb.y - ea.y, eb.x - ea.x) * 180 / Math.PI;
    Object.assign(metrics, { yawR: +yawR.toFixed(3), pitchR: +pitchR.toFixed(2), rollL: +rollDeg.toFixed(1) });
    if (ang) Object.assign(metrics, { yaw: +ang.yaw.toFixed(1), pitch: +ang.pitch.toFixed(1), roll: +ang.roll.toFixed(1) });
    const yawBad = ang ? Math.abs(ang.yaw) > o.maxYaw : Math.abs(yawR) > o.yawRatio;
    const pitchBad = ang ? Math.abs(ang.pitch) > o.maxPitch : (pitchR < o.pitchLo || pitchR > o.pitchHi);
    const rollBad = ang ? Math.abs(ang.roll) > o.maxRoll : Math.abs(rollDeg) > o.maxRoll;
    if (yawBad || Math.abs(yawR) > o.yawRatio * 1.6) {
      if (Math.abs(yawR) > 0.02) return fail('yaw', yawR > 0 ? '請正面看鏡頭，頭往左轉一點' : '請正面看鏡頭，頭往右轉一點');
      return fail('yaw', '請正面看鏡頭');
    }
    if (pitchBad) {
      if (pitchR < o.pitchNeutral) return fail('pitch', '請正面看鏡頭，稍微低頭一點');
      return fail('pitch', '請正面看鏡頭，稍微抬頭一點');
    }
    if (rollBad) return fail('roll', '請把頭擺正，不要歪頭');

    // eyes open
    const cats = res.faceBlendshapes && res.faceBlendshapes[0] && res.faceBlendshapes[0].categories;
    const blink = Math.max(blend(cats, 'eyeBlinkLeft'), blend(cats, 'eyeBlinkRight'));
    metrics.blink = +blink.toFixed(2);

    // colour-based occlusion / lighting
    const r = Math.max(2, faceW * 0.045);
    const skinPts = [P(IDX.cheekA), P(IDX.cheekB), P(IDX.forehead)].map(p => patchYCbCr(img, p.x, p.y, r));
    const skin = skinPts.reduce((a, b) => ({ Y: a.Y + b.Y / 3, Cb: a.Cb + b.Cb / 3, Cr: a.Cr + b.Cr / 3 }), { Y: 0, Cb: 0, Cr: 0 });
    const lowerChin = P(IDX.lowerLip), chinP = { x: (lowerChin.x + chin.x) / 2, y: (lowerChin.y + chin.y) / 2 };
    const lower = [nose, chinP].map(p => patchYCbCr(img, p.x, p.y, r));
    const lipA = P(IDX.upperLip), lipB = P(IDX.lowerLip);
    const lip = patchYCbCr(img, (lipA.x + lipB.x) / 2, (lipA.y + lipB.y) / 2, r * 0.7);
    const eyes = [P(IDX.eyeA), P(IDX.eyeB)].map(p => patchYCbCr(img, p.x, p.y, r * 1.2));
    const chroma = Math.max(...lower.map(l => Math.hypot(l.Cb - skin.Cb, l.Cr - skin.Cr)));
    const lumaR = Math.min(...lower.map(l => l.Y / Math.max(1, skin.Y)));
    const lumaRmax = Math.max(...lower.map(l => l.Y / Math.max(1, skin.Y)));
    const lipCr = lip.Cr - skin.Cr;
    const eyeL = Math.max(...eyes.map(e => e.Y / Math.max(1, skin.Y)));
    Object.assign(metrics, { skinY: +skin.Y.toFixed(0), chroma: +chroma.toFixed(1), lumaR: +lumaR.toFixed(2), lipCr: +lipCr.toFixed(1), eyeL: +eyeL.toFixed(2) });
    if (skin.Y < o.minLuma) return fail('dark', '光線太暗，請面向光源');
    if (skin.Y > o.maxLuma) return fail('bright', '光線太亮，請避開強光');
    if (eyeL < o.minEyeLuma) return fail('occluded', '眼睛被遮住，請摘下墨鏡或撥開頭髮');
    if (chroma > o.maskChroma || lumaR < o.maskLumaLo || lumaRmax > o.maskLumaHi) return fail('occluded', '臉部被遮住，請拿下口罩或移開遮蔽物');
    if (lipCr < o.minLipCr) return fail('occluded', '嘴巴被遮住，請移開手或遮蔽物');
    if (blink > o.maxBlink) return fail('eyes', '請張開眼睛');

    // sharpness on the face box
    const gray = toGray(img);
    const sharp = laplacianVariance(gray, W, H, lc.x + faceW * 0.1, top.y + (chin.y - top.y) * 0.2, rc.x - faceW * 0.1, chin.y - (chin.y - top.y) * 0.1);
    metrics.sharp = +sharp.toFixed(0);
    if (sharp < o.minSharpness) return fail('blur', '畫面模糊，請拿穩手機');

    // stillness
    const cur = { x: nose.x, y: nose.y, w: faceW };
    let move = 1;
    if (this.prev) move = Math.max(Math.abs(cur.x - this.prev.x), Math.abs(cur.y - this.prev.y), Math.abs(cur.w - this.prev.w)) / faceW;
    this.prev = cur;
    metrics.move = +move.toFixed(3);
    if (move > o.maxMove) { this.holdSince = 0; return { state: 'moving', hint: '請保持不動', ready: false, metrics, progress: 0 }; }
    if (!this.holdSince) this.holdSince = ts;
    const held = ts - this.holdSince;
    if (held >= o.holdMs) return { state: 'capture', hint: '正在拍攝…', ready: true, metrics, progress: 1 };
    return { state: 'hold', hint: '很好，請保持不動', ready: false, metrics, progress: held / o.holdMs };
  }
}

let landmarkerPromise = null;
/** Lazily create a FaceLandmarker from the vendored wasm + model (no CDN). */
export function loadLandmarker() {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import('../vendor/mediapipe/vision_bundle.mjs');
    const wasmBase = new URL('../vendor/mediapipe/wasm', import.meta.url).href;
    const model = new URL('../models/face_landmarker.task', import.meta.url).href;
    const fileset = await FilesetResolver.forVisionTasks(wasmBase);
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO', numFaces: 2,
      outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
      minFaceDetectionConfidence: 0.5, minFacePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { return await FaceLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { console.warn('GPU delegate failed, using CPU', e); return await FaceLandmarker.createFromOptions(fileset, opts('CPU')); }
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}
