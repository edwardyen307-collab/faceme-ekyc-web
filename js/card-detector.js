// Open-source ID-card detector (no dependencies).
// Finds the four straight borders of a card-shaped object around the on-screen guide
// using Sobel edge projection profiles, then checks fill, alignment, aspect ratio,
// glare, darkness and sharpness. Works on a downscaled RGBA ImageData.
import { toGray, laplacianVariance, lumaStats, meanAbsDiff } from './imageops.js';

export const CARD_ASPECT = 85.6 / 53.98; // ISO/IEC 7810 ID-1 (Taiwan ID card, driver licence, health card)

export const CARD_DEFAULTS = {
  minFill: 0.84,        // card width / guide width
  maxFill: 1.10,
  maxCenterOffset: 0.07,// relative to guide width
  aspectMin: 1.38,
  aspectMax: 1.82,
  maxTiltDeg: 4.5,      // border slope
  minEdge: 14,          // min mean |gradient| for a border line
  edgeRatio: 1.9,       // border peak must beat profile median by this factor
  maxGlare: 0.025,      // fraction of near-white pixels inside card
  minLuma: 55,
  minSharpness: 55,     // Laplacian variance at analysis resolution
  steadyMs: 600,
  steadyRectTol: 0.025, // side movement / guide width per frame
  steadyDiffTol: 7,     // mean abs gray diff per frame
};

function sobel(gray, w, h) {
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = gray[i - w - 1], b = gray[i - w], c = gray[i - w + 1];
      const d = gray[i - 1], f = gray[i + 1];
      const g = gray[i + w - 1], hh = gray[i + w], k = gray[i + w + 1];
      gx[i] = Math.abs((c + 2 * f + k) - (a + 2 * d + g)) / 4;
      gy[i] = Math.abs((g + 2 * hh + k) - (a + 2 * b + c)) / 4;
    }
  }
  return { gx, gy };
}

function toOpponent(img) {
  const d = img.data, out = new Float32Array(img.width * img.height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = 128 + (d[i + 2] - d[i]) * 0.5; // blue-yellow/red axis
  return out;
}

function median(arr) {
  const s = Array.from(arr).sort((p, q) => p - q);
  return s.length ? s[s.length >> 1] : 0;
}

// profile of |gy| along rows (horizontal borders) or |gx| along columns (vertical borders)
function findBorder(grad, w, h, horizontal, from, to, spanFrom, spanTo, opt, outerLow) {
  from = Math.max(1, Math.round(from)); to = Math.min((horizontal ? h : w) - 2, Math.round(to));
  spanFrom = Math.max(1, Math.round(spanFrom)); spanTo = Math.min((horizontal ? w : h) - 2, Math.round(spanTo));
  if (to <= from || spanTo <= spanFrom) return null;
  const prof = new Float32Array(to - from + 1);
  for (let p = from; p <= to; p++) {
    let s = 0;
    // use the max of +-1 neighbour lines so slightly tilted borders still register
    for (let q = spanFrom; q <= spanTo; q++) {
      let v;
      if (horizontal) v = Math.max(grad[p * w + q], grad[(p - 1) * w + q], grad[(p + 1) * w + q]);
      else v = Math.max(grad[q * w + p], grad[q * w + p - 1], grad[q * w + p + 1]);
      s += v;
    }
    prof[p - from] = s / (spanTo - spanFrom + 1);
  }
  let best = -1, bi = -1;
  for (let i = 0; i < prof.length; i++) if (prof[i] > best) { best = prof[i]; bi = i; }
  // Cards often have strong inner lines (coloured header band, photo box). Prefer the OUTERMOST
  // local peak that is still at least 45% of the strongest one (and clearly above the background): that is the physical card edge.
  const thr = Math.max(best * 0.45, opt.minEdge, opt.edgeRatio * median(prof));
  const isPeak = (i) => prof[i] >= thr && (i === 0 || prof[i] >= prof[i - 1]) && (i === prof.length - 1 || prof[i] >= prof[i + 1]);
  if (outerLow) { for (let i = 0; i < prof.length; i++) if (isPeak(i)) { bi = i; break; } }
  else { for (let i = prof.length - 1; i >= 0; i--) if (isPeak(i)) { bi = i; break; } }
  best = prof[bi];
  const med = median(prof);
  const ok = best >= opt.minEdge && best >= opt.edgeRatio * Math.max(med, 1);
  return { pos: from + bi, strength: best, median: med, ok, atLimit: bi <= 1 || bi >= prof.length - 2 };
}

// Strongest line near `pos` using only part of the span; used to measure border slope (tilt).
function localPeak(grad, w, h, horizontal, pos, radius, spanFrom, spanTo) {
  const lim = horizontal ? h : w;
  const p0 = Math.max(1, Math.round(pos - radius)), p1 = Math.min(lim - 2, Math.round(pos + radius));
  const prof = [];
  for (let p = p0; p <= p1; p++) {
    let s = 0;
    for (let q = Math.round(spanFrom); q <= Math.round(spanTo); q++) s += horizontal ? grad[p * w + q] : grad[q * w + p];
    prof.push(s);
  }
  const mx = Math.max(...prof);
  // nearest local maximum to the full-span border position that is at least half the window max
  let bp = pos, bd = Infinity;
  for (let i = 0; i < prof.length; i++) {
    const isMax = (i === 0 || prof[i] >= prof[i - 1]) && (i === prof.length - 1 || prof[i] >= prof[i + 1]);
    if (isMax && prof[i] >= mx * 0.5) { const d = Math.abs(p0 + i - pos); if (d < bd) { bd = d; bp = p0 + i; } }
  }
  return bp;
}

function borderSlopeDeg(grad, w, h, horizontal, border, spanFrom, spanTo, radius) {
  const len = spanTo - spanFrom, third = len / 3;
  const a = localPeak(grad, w, h, horizontal, border.pos, radius, spanFrom, spanFrom + third);
  const b = localPeak(grad, w, h, horizontal, border.pos, radius, spanTo - third, spanTo);
  return Math.atan2(b - a, len - third) * 180 / Math.PI;
}

export class CardDetector {
  constructor(opts = {}) {
    this.o = { ...CARD_DEFAULTS, ...opts };
    this.reset();
  }
  reset() {
    this.prevRect = null; this.prevGray = null; this.steadySince = 0; this.lastTs = 0;
  }
  /**
   * @param {ImageData} img analysis frame
   * @param {{x:number,y:number,w:number,h:number}} guide guide rect in analysis coords
   * @param {number} ts timestamp ms
   * @returns {{state:string, hint:string, ready:boolean, rect?:object, metrics:object, progress:number}}
   */
  analyze(img, guide, ts) {
    const o = this.o, w = img.width, h = img.height;
    const gray = toGray(img);
    // gradients on luminance AND a colour-opponent channel, so a card whose colour differs from
    // the background but whose brightness is similar (e.g. blue band on a brown desk) is still found
    const { gx, gy } = sobel(gray, w, h);
    const opp = toOpponent(img);
    const c = sobel(opp, w, h);
    for (let i = 0; i < gx.length; i++) { if (c.gx[i] > gx[i]) gx[i] = c.gx[i]; if (c.gy[i] > gy[i]) gy[i] = c.gy[i]; }
    const gw = guide.w, gh = guide.h;
    const L = guide.x, T = guide.y, R = guide.x + gw, B = guide.y + gh;
    const top = findBorder(gy, w, h, true, T - 0.22 * gh, T + 0.40 * gh, L + 0.27 * gw, R - 0.27 * gw, o, true);
    const bot = findBorder(gy, w, h, true, B - 0.40 * gh, B + 0.22 * gh, L + 0.27 * gw, R - 0.27 * gw, o, false);
    const lef = findBorder(gx, w, h, false, L - 0.22 * gw, L + 0.30 * gw, T + 0.25 * gh, B - 0.25 * gh, o, true);
    const rig = findBorder(gx, w, h, false, R - 0.30 * gw, R + 0.22 * gw, T + 0.25 * gh, B - 0.25 * gh, o, false);
    const sides = [top, bot, lef, rig];
    const found = sides.filter(s => s && s.ok).length;
    const metrics = { found, edges: sides.map(s => s ? +s.strength.toFixed(1) : 0) };
    const diff = meanAbsDiff(gray, this.prevGray);
    this.prevGray = gray;
    metrics.diff = +diff.toFixed(1);

    const fail = (state, hint, rect) => { this.steadySince = 0; this.prevRect = rect || null; return { state, hint, ready: false, rect, metrics, progress: 0 }; };

    // overall darkness (whole guide area)
    const g = lumaStats(gray, w, h, L, T, R, B);
    metrics.luma = +g.mean.toFixed(0);
    if (g.mean < o.minLuma) return fail('dark', '光線太暗，請到明亮的地方');
    if (found < 3) return fail('search', '請把證件放進框內');

    const rect = { x: lef.ok ? lef.pos : L, y: top.ok ? top.pos : T, x2: rig.ok ? rig.pos : R, y2: bot.ok ? bot.pos : B };
    rect.w = rect.x2 - rect.x; rect.h = rect.y2 - rect.y;
    if (rect.w < gw * 0.3 || rect.h < gh * 0.3) return fail('search', '請把證件放進框內');
    const fill = rect.w / gw;
    const aspect = rect.w / rect.h;
    const offX = ((rect.x + rect.x2) / 2 - (L + R) / 2) / gw;
    const offY = ((rect.y + rect.y2) / 2 - (T + B) / 2) / gw;
    Object.assign(metrics, { fill: +fill.toFixed(2), aspect: +aspect.toFixed(2), offX: +offX.toFixed(2), offY: +offY.toFixed(2) });

    if (found < 4) {
      // one border missing: usually because the card is cut off by the frame edge (too close) or too small
      if (sides.some(s => s && s.ok && s.atLimit) || fill > o.maxFill) return fail('near', '太近了，請把手機拿遠一點', rect);
      return fail('search', '請把證件完整放進框內', rect);
    }
    if (fill > o.maxFill || sides.some(s => s.atLimit && s.strength > o.minEdge)) return fail('near', '太近了，請把手機拿遠一點', rect);
    if (fill < o.minFill) return fail('small', '再靠近一點，讓證件填滿框線', rect);
    if (aspect < o.aspectMin || aspect > o.aspectMax) return fail('tilt', '請把證件放平，與框線對齊', rect);
    if (Math.abs(offX) > o.maxCenterOffset || Math.abs(offY) > o.maxCenterOffset) {
      return fail('offset', '請把證件移到框線中央', rect);
    }
    const inset = 0.06;
    const ix0 = rect.x + rect.w * inset, iy0 = rect.y + rect.h * inset, ix1 = rect.x2 - rect.w * inset, iy1 = rect.y2 - rect.h * inset;
    const st = lumaStats(gray, w, h, ix0, iy0, ix1, iy1);
    metrics.glare = +st.whiteFrac.toFixed(3);
    if (st.whiteFrac > o.maxGlare) return fail('glare', '證件反光，請稍微傾斜調整角度', rect);
    const sharp = laplacianVariance(gray, w, h, ix0, iy0, ix1, iy1);
    metrics.sharp = +sharp.toFixed(0);
    if (sharp < o.minSharpness) return fail('blur', '畫面模糊，請拿穩讓鏡頭對焦', rect);
    // tilt: slope of the top/bottom and left/right borders
    const tilt = Math.max(
      Math.abs(borderSlopeDeg(gy, w, h, true, top, L + 0.05 * gw, R - 0.05 * gw, 0.10 * gh)),
      Math.abs(borderSlopeDeg(gy, w, h, true, bot, L + 0.05 * gw, R - 0.05 * gw, 0.10 * gh)),
      Math.abs(borderSlopeDeg(gx, w, h, false, lef, T + 0.08 * gh, B - 0.08 * gh, 0.10 * gh)),
      Math.abs(borderSlopeDeg(gx, w, h, false, rig, T + 0.08 * gh, B - 0.08 * gh, 0.10 * gh)));
    metrics.tilt = +tilt.toFixed(1);
    if (tilt > o.maxTiltDeg) return fail('tilt', '請把證件轉正，與框線對齊', rect);

    // steadiness
    let moved = true;
    if (this.prevRect && this.prevRect.x2 !== undefined) {
      const d = Math.max(Math.abs(rect.x - this.prevRect.x), Math.abs(rect.x2 - this.prevRect.x2),
        Math.abs(rect.y - this.prevRect.y), Math.abs(rect.y2 - this.prevRect.y2)) / gw;
      metrics.move = +d.toFixed(3);
      moved = d > o.steadyRectTol || diff > o.steadyDiffTol;
    }
    this.prevRect = rect;
    if (moved) { this.steadySince = 0; return { state: 'steady', hint: '請拿穩，不要晃動', ready: false, rect, metrics, progress: 0 }; }
    if (!this.steadySince) this.steadySince = ts;
    const held = ts - this.steadySince;
    const progress = Math.min(1, held / o.steadyMs);
    if (held >= o.steadyMs) return { state: 'capture', hint: '正在拍攝…', ready: true, rect, metrics, progress: 1 };
    return { state: 'hold', hint: '很好，請保持不動', ready: false, rect, metrics, progress };
  }
}
