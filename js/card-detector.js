// Open-source ID-card detector (no dependencies).
// Finds the four straight borders of a card-shaped object around the on-screen guide
// using Sobel edge projection profiles, then checks fill, alignment, aspect ratio,
// glare, darkness and sharpness. Works on a downscaled RGBA ImageData.
import { toGray, laplacianVariance, lumaStats, meanAbsDiff, glareStats } from './imageops.js?v=2026-11-11g';
import { phrase } from './hints.js?v=2026-11-11g';

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
  steadyMs: 450,        // hold time before capture (was 600)
  steadyRectTol: 0.045, // max side deviation from the recent average / guide width (was 0.025 frame-to-frame)
  steadyDiffTol: 22,    // gross-motion guard only: median mean-abs gray diff over the last 3 frames (was 7, single frame).
                        // Fine stability comes from the averaged border positions; blur is caught by minSharpness.
  steadyWindow: 5,      // frames averaged for the steadiness reference (~0.35 s)
  graceMs: 300,         // a brief glitch (one bad frame) does not restart the hold timer
  mode: 'front',        // 'front' | 'rightSide' (forgery: card shot obliquely from the upper right)
  glareRel: 14,         // glare pixel = brighter than max(250, card median + glareRel) (pale cards are bright everywhere)
};

// TW ID back: pale, low-contrast print and little texture -> softer edge / sharpness thresholds.
export const CARD_BACK = { minEdge: 10, edgeRatio: 1.6, minSharpness: 30, maxGlare: 0.04 };

// Oblique shot used by idcard/forgery (direction "rightSide").
// Geometry: the card quad (4 fitted border lines) must show real perspective consistent with a view from the
// right: right edge clearly longer than the left one and corners clearly away from 90 degrees.
export const CARD_RIGHTSIDE = {
  mode: 'rightSide', minFill: 0.5, maxFill: 1.2, maxCenterOffset: 0.18, steadyMs: 400, minSharpness: 40,
  minSideRatio: 1.12,   // right / left edge length
  maxSideRatio: 1.9,    // beyond this the card is too oblique to read
  minCornerDev: 6,      // degrees, max |corner angle - 90|
  maxFitRms: 2.2,       // px (analysis resolution) line-fit error; worse = quad not found reliably
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

// ---- card quad (for oblique shots) ----
// Border points: along each side, scan from OUTSIDE inwards for the first strong gradient peak; then a robust line fit.
function edgePoints(grad, w, h, side, guide, minEdge) {
  const { x: L, y: T, w: gw, h: gh } = guide, R = L + gw, B = T + gh;
  const vertical = side === 'left' || side === 'right';
  const pts = [], N = 11;
  const along0 = vertical ? T + 0.18 * gh : L + 0.16 * gw, along1 = vertical ? B - 0.18 * gh : R - 0.16 * gw;
  let a0, a1; // search range across the border, outermost first
  if (side === 'left') { a0 = L - 0.30 * gw; a1 = L + 0.42 * gw; }
  else if (side === 'right') { a0 = R + 0.30 * gw; a1 = R - 0.42 * gw; }
  else if (side === 'top') { a0 = T - 0.40 * gh; a1 = T + 0.45 * gh; }
  else { a0 = B + 0.40 * gh; a1 = B - 0.45 * gh; }
  const lim = vertical ? w : h, limA = vertical ? h : w;
  a0 = Math.max(1, Math.min(lim - 2, Math.round(a0))); a1 = Math.max(1, Math.min(lim - 2, Math.round(a1)));
  const dir = a1 > a0 ? 1 : -1, len = Math.abs(a1 - a0) + 1;
  for (let k = 0; k < N; k++) {
    const t = Math.round(along0 + (along1 - along0) * k / (N - 1));
    if (t < 2 || t > limA - 3) continue;
    const prof = new Float32Array(len);
    let mx = 0;
    for (let i = 0; i < len; i++) {
      const c = a0 + dir * i; let v = 0;
      for (let d = -2; d <= 2; d++) v += vertical ? grad[(t + d) * w + c] : grad[c * w + t + d];
      prof[i] = v / 5; if (prof[i] > mx) mx = prof[i];
    }
    const thr = Math.max(minEdge * 1.6, mx * 0.3);
    for (let i = 1; i < len - 1; i++) {
      if (prof[i] >= thr && prof[i] >= prof[i - 1] && prof[i] >= prof[i + 1]) { pts.push([t, a0 + dir * i, prof[i]]); break; }
    }
  }
  return pts; // [along, across, strength]
}
function fitLine(pts) {
  // across = m * along + c. RANSAC over point pairs (robust to a few points caught on inner print lines),
  // then least squares on the inliers.
  if (pts.length < 5) return null;
  const tol = 1.6;
  let best = null;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[j];
    if (x2 === x1) continue;
    const m = (y2 - y1) / (x2 - x1), c = y1 - m * x1;
    const inl = pts.filter(([x, y]) => Math.abs(y - (m * x + c)) <= tol);
    // more inliers wins; ties -> the outer line (larger total strength)
    const score = inl.length + inl.reduce((a, p) => a + p[2], 0) * 1e-4;
    if (!best || score > best.score) best = { score, inl };
  }
  if (!best || best.inl.length < 5) return null;
  const use = best.inl, n = use.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const [x, y] of use) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
  const den = n * sxx - sx * sx; if (Math.abs(den) < 1e-6) return null;
  const m = (n * sxy - sx * sy) / den, c = (sy - m * sx) / n;
  const rms = Math.sqrt(use.reduce((a, [x, y]) => a + (y - (m * x + c)) ** 2, 0) / n);
  return { m, c, rms, n, of: pts.length };
}
// intersection of a vertical-ish line x = mv*y + cv with a horizontal-ish line y = mh*x + ch
function cross(v, hz) { const y = (hz.m * v.c + hz.c) / (1 - hz.m * v.m); return { x: v.m * y + v.c, y }; }
export function findQuad(gx, gy, w, h, guide, minEdge) {
  const lines = {};
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const f = fitLine(edgePoints(side === 'left' || side === 'right' ? gx : gy, w, h, side, guide, minEdge));
    if (!f) return { ok: false, missing: side };
    lines[side] = f;
  }
  const tl = cross(lines.left, lines.top), tr = cross(lines.right, lines.top), br = cross(lines.right, lines.bottom), bl = cross(lines.left, lines.bottom);
  const rms = Math.max(...Object.values(lines).map(l => l.rms));
  return { ok: true, corners: [tl, tr, br, bl], rms, lines };
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function cornerAngle(p, a, b) {
  const v1 = { x: a.x - p.x, y: a.y - p.y }, v2 = { x: b.x - p.x, y: b.y - p.y };
  return Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y))))) * 180 / Math.PI;
}
export function quadGeometry(c) {
  const [tl, tr, br, bl] = c;
  const left = dist(tl, bl), right = dist(tr, br), top = dist(tl, tr), bottom = dist(bl, br);
  const angles = [cornerAngle(tl, tr, bl), cornerAngle(tr, br, tl), cornerAngle(br, bl, tr), cornerAngle(bl, tl, br)];
  return { left, right, top, bottom, lr: right / Math.max(1, left), tb: top / Math.max(1, bottom),
    cornerDev: Math.max(...angles.map(a => Math.abs(a - 90))), angleSum: angles.reduce((a, b) => a + b, 0),
    aspect: (top + bottom) / Math.max(1, left + right) };
}

export class CardDetector {
  constructor(opts = {}) {
    this.o = { ...CARD_DEFAULTS, ...opts };
    this.reset();
  }
  reset() {
    this.prevRect = null; this.prevGray = null; this.steadySince = 0; this.lastTs = 0;
    this.hist = []; this.diffs = []; this.lastGood = 0;
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
    const diff1 = meanAbsDiff(gray, this.prevGray);
    this.prevGray = gray;
    this.diffs.push(diff1); if (this.diffs.length > 3) this.diffs.shift();
    const diff = [...this.diffs].sort((a, b) => a - b)[this.diffs.length >> 1];
    metrics.diff = +diff.toFixed(1);
    const rs = o.mode === 'rightSide';
    const RS = { 'card.search': 'card.rs.search', 'card.partial': 'card.rs.search', 'card.near': 'card.rs.near', 'card.small': 'card.rs.small', 'card.flat': 'card.rs.flat' };
    const say = (keys) => { keys = [].concat(keys); if (rs && keys.length > 1) keys = keys.filter(k => k !== 'card.flat'); if (rs && keys.length === 1 && RS[keys[0]]) keys = [RS[keys[0]]]; return phrase(keys); };

    const fail = (state, keys, rect) => {
      if (ts - this.lastGood > o.graceMs) { this.steadySince = 0; this.hist = []; }
      this.prevRect = rect || null;
      return { state, ...say(keys), ready: false, rect, metrics, progress: 0 };
    };

    // overall darkness (whole guide area)
    const g = lumaStats(gray, w, h, L, T, R, B);
    metrics.luma = +g.mean.toFixed(0);
    if (g.mean < o.minLuma) return fail('dark', 'card.dark');
    if (rs) return this._oblique(img, gray, gx, gy, guide, ts, metrics, diff, fail, say);
    if (found < 3) return fail('search', 'card.search');

    const rect = { x: lef.ok ? lef.pos : L, y: top.ok ? top.pos : T, x2: rig.ok ? rig.pos : R, y2: bot.ok ? bot.pos : B };
    rect.w = rect.x2 - rect.x; rect.h = rect.y2 - rect.y;
    if (rect.w < gw * 0.3 || rect.h < gh * 0.3) return fail('search', 'card.search');
    const fill = rect.w / gw;
    const aspect = rect.w / rect.h;
    const offX = ((rect.x + rect.x2) / 2 - (L + R) / 2) / gw;
    const offY = ((rect.y + rect.y2) / 2 - (T + B) / 2) / gw;
    Object.assign(metrics, { fill: +fill.toFixed(2), aspect: +aspect.toFixed(2), offX: +offX.toFixed(2), offY: +offY.toFixed(2) });

    if (found < 4) {
      // one border missing: usually because the card is cut off by the frame edge (too close) or too small
      if (sides.some(s => s && s.ok && s.atLimit) || fill > o.maxFill) return fail('near', 'card.near', rect);
      return fail('search', 'card.partial', rect);
    }
    const inset = 0.06;
    const ix0 = rect.x + rect.w * inset, iy0 = rect.y + rect.h * inset, ix1 = rect.x2 - rect.w * inset, iy1 = rect.y2 - rect.h * inset;
    const sharp = laplacianVariance(gray, w, h, ix0, iy0, ix1, iy1);
    metrics.sharp = +sharp.toFixed(0);
    // tilt: slope of the borders (only meaningful on a sharp frame; blur gives false slopes)
    let tilt = 0;
    if (sharp >= o.minSharpness) {
      const sl = (side, horiz) => side && side.ok ? Math.abs(horiz
        ? borderSlopeDeg(gy, w, h, true, side, L + 0.05 * gw, R - 0.05 * gw, 0.10 * gh)
        : borderSlopeDeg(gx, w, h, false, side, T + 0.08 * gh, B - 0.08 * gh, 0.10 * gh)) : 0;
      tilt = Math.max(sl(top, true), sl(bot, true), sl(lef, false), sl(rig, false));
      metrics.tilt = +tilt.toFixed(1);
    }
    // Geometry problems are collected and merged into ONE hint (priority: distance, rotation, position, flatness).
    const parts = [];
    if (fill > o.maxFill || sides.some(s => s && s.atLimit && s.strength > o.minEdge)) parts.push('card.near');
    else if (fill < o.minFill) parts.push('card.small');
    if (tilt > o.maxTiltDeg) parts.push('card.rotate');
    if (Math.abs(offX) > o.maxCenterOffset || Math.abs(offY) > o.maxCenterOffset) {
      // card right of centre in the (unmirrored) rear preview -> move the phone right, etc.
      parts.push(Math.abs(offX) >= Math.abs(offY) ? (offX > 0 ? 'card.right' : 'card.left') : (offY > 0 ? 'card.down' : 'card.up'));
    }
    if (aspect < o.aspectMin || aspect > o.aspectMax) parts.push('card.flat');
    if (parts.length) return fail(parts[0].slice(5), parts, rect);
    const st = glareStats(gray, w, h, ix0, iy0, ix1, iy1, 250, o.glareRel);
    metrics.glare = +st.glareFrac.toFixed(3); metrics.med = st.median;
    if (st.glareFrac > o.maxGlare) return fail('glare', 'card.glare', rect);
    if (sharp < o.minSharpness) return fail('blur', 'card.blur', rect);
    // steadiness: compare with the average of the last few accepted rects (smooths detector jitter)
    this.lastGood = ts;
    let moved = false;
    if (this.hist.length) {
      const n = this.hist.length, avg = { x: 0, x2: 0, y: 0, y2: 0 };
      for (const r of this.hist) { avg.x += r.x / n; avg.x2 += r.x2 / n; avg.y += r.y / n; avg.y2 += r.y2 / n; }
      const d = Math.max(Math.abs(rect.x - avg.x), Math.abs(rect.x2 - avg.x2), Math.abs(rect.y - avg.y), Math.abs(rect.y2 - avg.y2)) / gw;
      metrics.move = +d.toFixed(3);
      moved = d > o.steadyRectTol || diff > o.steadyDiffTol;
    } else moved = diff > o.steadyDiffTol;
    this.hist.push(rect); if (this.hist.length > o.steadyWindow) this.hist.shift();
    this.prevRect = rect;
    if (moved) {
      this.steadySince = 0;
      return { state: 'steady', ...say('card.steady'), ready: false, rect, metrics, progress: 0 };
    }
    if (!this.steadySince) this.steadySince = ts;
    const held = ts - this.steadySince;
    const progress = Math.min(1, held / o.steadyMs);
    if (held >= o.steadyMs) return { state: 'capture', ...say('card.capture'), ready: true, rect, metrics, progress: 1 };
    return { state: 'hold', ...say('card.hold'), ready: false, rect, metrics, progress };
  }

  /** Oblique ("rightSide") shot: geometric perspective check on the fitted card quad. */
  _oblique(img, gray, gx, gy, guide, ts, metrics, diff, fail, say) {
    const o = this.o, w = img.width, h = img.height, gw = guide.w;
    const P = (k) => phrase(k);
    const failK = (state, key, rect) => { const r = fail(state, 'card.rs.search', rect); return { ...r, ...P(key) }; };
    const q = findQuad(gx, gy, w, h, guide, o.minEdge);
    metrics.gd = [guide.x, guide.y, guide.w, guide.h].map(v => Math.round(v)).join(',');
    if (!q.ok) { metrics.miss = q.missing; return failK('search', 'card.rs.search'); }
    const [tl, tr, br, bl] = q.corners;
    const xs = q.corners.map(p => p.x), ys = q.corners.map(p => p.y);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    rect.w = rect.x2 - rect.x; rect.h = rect.y2 - rect.y;
    const geo = quadGeometry(q.corners);
    Object.assign(metrics, { inl: Object.values(q.lines).map(l => l.n + '/' + l.of).join(' '), rms: +q.rms.toFixed(2), lr: +geo.lr.toFixed(2), tb: +geo.tb.toFixed(2), corner: +geo.cornerDev.toFixed(1),
      qaspect: +geo.aspect.toFixed(2), fill: +(rect.w / gw).toFixed(2) });
    // a sane convex quad, reliably fitted, completely inside the frame
    const m = 2;
    const inside = q.corners.every(p => p.x >= m && p.y >= m && p.x <= w - 1 - m && p.y <= h - 1 - m);
    if (!(Math.abs(geo.angleSum - 360) < 3) || geo.aspect < 0.8 || geo.aspect > 3.5 || rect.w < gw * 0.35) return failK('search', 'card.rs.search', rect);
    if (!inside) return failK('near', 'card.rs.inframe', rect);
    if (q.rms > o.maxFitRms) return failK('search', 'card.rs.search', rect);
    if (rect.w / gw > o.maxFill) return failK('near', 'card.rs.near', rect);
    if (rect.w / gw < o.minFill) return failK('small', 'card.rs.small', rect);
    const cx = (rect.x + rect.x2) / 2 - (guide.x + gw / 2), cy = (rect.y + rect.y2) / 2 - (guide.y + guide.h / 2);
    if (Math.abs(cx) / gw > o.maxCenterOffset || Math.abs(cy) / gw > o.maxCenterOffset) return failK('position', 'card.rs.center', rect);
    // perspective consistent with a view from the right: right edge nearer (longer) than the left edge
    if (geo.lr < 1 / o.minSideRatio && geo.cornerDev >= o.minCornerDev) return failK('tilt', 'card.rs.wrongSide', rect);
    if (geo.lr < o.minSideRatio || geo.cornerDev < o.minCornerDev) return failK('tilt', 'card.rs.flat', rect);
    if (geo.lr > o.maxSideRatio) return failK('tilt', 'card.rs.tooMuch', rect);
    // sharp, no glare (inside the quad's inner box)
    const ix0 = Math.max(tl.x, bl.x) + rect.w * 0.06, ix1 = Math.min(tr.x, br.x) - rect.w * 0.06;
    const iy0 = Math.max(tl.y, tr.y) + rect.h * 0.08, iy1 = Math.min(bl.y, br.y) - rect.h * 0.08;
    const sharp = laplacianVariance(gray, w, h, ix0, iy0, ix1, iy1);
    metrics.sharp = +sharp.toFixed(0);
    const st = glareStats(gray, w, h, ix0, iy0, ix1, iy1, 250, o.glareRel);
    metrics.glare = +st.glareFrac.toFixed(3);
    if (st.glareFrac > o.maxGlare) return fail('glare', 'card.glare', rect);
    if (sharp < o.minSharpness) return fail('blur', 'card.blur', rect);
    // steadiness on the corners
    this.lastGood = ts;
    const cur = q.corners;
    let moved;
    if (this.hist.length) {
      const n = this.hist.length;
      let d = 0;
      for (let k = 0; k < 4; k++) {
        let ax = 0, ay = 0; for (const c of this.hist) { ax += c[k].x / n; ay += c[k].y / n; }
        d = Math.max(d, Math.hypot(cur[k].x - ax, cur[k].y - ay) / gw);
      }
      metrics.move = +d.toFixed(3);
      moved = d > o.steadyRectTol * 1.3 || diff > o.steadyDiffTol;
    } else moved = diff > o.steadyDiffTol;
    this.hist.push(cur); if (this.hist.length > o.steadyWindow) this.hist.shift();
    if (moved) { this.steadySince = 0; return { state: 'steady', ...P('card.rs.steady'), ready: false, rect, quad: cur, metrics, progress: 0 }; }
    if (!this.steadySince) this.steadySince = ts;
    const held = ts - this.steadySince;
    if (held >= o.steadyMs) return { state: 'capture', ...P('card.capture'), ready: true, rect, quad: cur, metrics, progress: 1 };
    return { state: 'hold', ...P('card.rs.hold'), ready: false, rect, quad: cur, metrics, progress: Math.min(1, held / o.steadyMs) };
  }
}
