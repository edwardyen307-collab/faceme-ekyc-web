// Auto-tracking card detector ("自動追拍"): finds the card quad ANYWHERE in the frame (no fixed guide).
// Signed Sobel (luma + colour-opponent) -> orientation-constrained Hough lines -> best 4-line quad by edge support
// -> per-side refinement -> temporal lock (the same quad must be seen on several consecutive frames, so a random
// background rectangle is not locked onto) -> size / flatness / glare / sharpness / steadiness checks.
// Works on a downscaled RGBA ImageData of the whole video frame.
import { toGray, laplacianVariance, meanAbsDiff, glareStats } from './imageops.js?v=2026-11-11f';
import { phrase } from './hints.js?v=2026-11-11f';
import { CARD_ASPECT, quadGeometry } from './card-detector.js?v=2026-11-11f';

export const TRACK_DEFAULTS = {
  mode: 'front',          // 'front' (flat shot) | 'rightSide' (oblique forgery shot)
  aspect: CARD_ASPECT,    // expected aspect of the document (ID-1 by default)
  aspectTol: 0.24,        // flat mode: accepted |measured/expected - 1|
  minWidthFrac: 0.6,      // card width / frame width below this -> "再靠近一點" (OCR / forgery clarity)
  maxWidthFrac: 0.97,
  maxPerspective: 0.12,   // flat mode: |1 - right/left|, |1 - top/bottom| above this -> "拿平"
  maxCornerDevFlat: 10,
  minSupport: 0.6,        // fraction of each side covered by matching edge pixels
  minEndSupport: 0.5,     // ... and of each end (5–22% / 78–95%) of every side, so the corners are real
  lockFrames: 3,          // consecutive consistent detections before the quad is trusted
  lockTol: 0.06,          // corner distance / frame width that still counts as "the same" quad
  loseMs: 350,
  smooth: 0.45,           // display smoothing (EMA weight of the newest detection)
  minSharpness: 45, maxGlare: 0.03, glareRel: 14,
  steadyTol: 0.022, steadyDiffTol: 24, steadyMs: 500, steadyWindow: 5,
  // oblique (rightSide) rules, same as the fixed-guide mode
  minSideRatio: 1.12, maxSideRatio: 1.9, minCornerDev: 6,
};

const DEG = Math.PI / 180;
export function _signedSobel(img) { return signedSobel(img); }
function signedSobel(img) {
  const { data, width: w, height: h } = img;
  const g = toGray(img), o = new Float32Array(w * h);
  for (let i = 0, j = 0; j < o.length; i += 4, j++) o[j] = 128 + (data[i + 2] - data[i]) * 0.5;
  const gx = new Float32Array(w * h), gy = new Float32Array(w * h), mag = new Float32Array(w * h);
  for (const ch of [g, o]) {
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const sx = ((ch[i - w + 1] + 2 * ch[i + 1] + ch[i + w + 1]) - (ch[i - w - 1] + 2 * ch[i - 1] + ch[i + w - 1])) / 4;
      const sy = ((ch[i + w - 1] + 2 * ch[i + w] + ch[i + w + 1]) - (ch[i - w - 1] + 2 * ch[i - w] + ch[i - w + 1])) / 4;
      const m = Math.hypot(sx, sy);
      if (m > mag[i]) { mag[i] = m; gx[i] = sx; gy[i] = sy; }
    }
  }
  return { gray: g, gx, gy, mag, w, h };
}
function percentile(mag, p) {
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < mag.length; i += 3) { hist[Math.min(255, mag[i] | 0)]++; n++; }
  let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; }
  return 255;
}
// Hough with each edge pixel voting only near its own gradient direction.
export function _hough(E, thr) { return houghLines(E, thr); }
function houghLines(E, thr, maxLines = 60) {
  const { gx, gy, mag, w, h } = E;
  const NT = 90, diag = Math.ceil(Math.hypot(w, h)), NR = 2 * diag + 1;
  const acc = new Float32Array(NT * NR);
  const cs = [], sn = []; for (let t = 0; t < NT; t++) { cs.push(Math.cos(t * 2 * DEG)); sn.push(Math.sin(t * 2 * DEG)); }
  for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
    const i = y * w + x, m = mag[i];
    if (m < thr) continue;
    let a = Math.atan2(gy[i], gx[i]) / DEG; if (a < 0) a += 180; if (a >= 180) a -= 180;
    const t0 = Math.round(a / 2);
    for (let dt = -4; dt <= 4; dt++) {
      const t = (t0 + dt + NT) % NT;
      const r = Math.round(x * cs[t] + y * sn[t]) + diag;
      acc[t * NR + r] += m;
    }
  }
  const cells = [];
  let mx = 0; for (let k = 0; k < acc.length; k++) if (acc[k] > mx) mx = acc[k];
  const floor = mx * 0.1;
  for (let t = 0; t < NT; t++) for (let r = 1; r < NR - 1; r++) {
    const v = acc[t * NR + r];
    if (v > floor && v >= acc[t * NR + r - 1] && v >= acc[t * NR + r + 1]) cells.push([v, t, r - diag]);
  }
  cells.sort((a, b) => b[0] - a[0]);
  const lines = [];
  for (const [v, t, r] of cells) {
    const th = t * 2;
    if (lines.some(L => { let d = Math.abs(L.th - th); d = Math.min(d, 180 - d); return d <= 6 && Math.abs((d === Math.abs(L.th - th) ? L.r - r : L.r + r)) <= 8; })) continue;
    lines.push({ th, r, v });
    if (lines.length >= maxLines) break;
  }
  return lines;
}
function inter(a, b) {
  const c1 = Math.cos(a.th * DEG), s1 = Math.sin(a.th * DEG), c2 = Math.cos(b.th * DEG), s2 = Math.sin(b.th * DEG);
  const det = c1 * s2 - s1 * c2; if (Math.abs(det) < 1e-6) return null;
  return { x: (a.r * s2 - s1 * b.r) / det, y: (c1 * b.r - a.r * c2) / det };
}
// fraction of a segment backed by edge pixels whose gradient is perpendicular to it (t0..t1 of its length)
function support(E, p, q, thr, t0 = 0.06, t1 = 0.94) {
  const { gx, gy, mag, w, h } = E;
  const len = Math.hypot(q.x - p.x, q.y - p.y); if (len < 8) return 0;
  const ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, nx = -uy, ny = ux;
  const n = Math.max(8, Math.min(48, Math.round(len * (t1 - t0) / 3)));
  let ok = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + (t1 - t0) * k / (n - 1);
    const cx = p.x + (q.x - p.x) * t, cy = p.y + (q.y - p.y) * t;
    let hit = false;
    for (let d = -1.5; d <= 1.5 && !hit; d += 1) {
      const x = Math.round(cx + nx * d), y = Math.round(cy + ny * d);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const i = y * w + x, m = mag[i];
      if (m < thr * 0.6) continue;
      const cosang = Math.abs(gx[i] * nx + gy[i] * ny) / (m || 1);
      if (cosang > 0.9) hit = true; // within ~25 deg
    }
    if (hit) ok++;
  }
  return ok / n;
}
// refine one side: strongest edge along the normal within +-4 px at several stations, then a robust line fit
function refineSide(E, p, q, thr) {
  const { mag, w, h } = E;
  const len = Math.hypot(q.x - p.x, q.y - p.y), ux = (q.x - p.x) / len, uy = (q.y - p.y) / len, nx = -uy, ny = ux;
  const pts = [];
  for (let k = 0; k < 15; k++) {
    const t = 0.08 + 0.84 * k / 14, cx = p.x + (q.x - p.x) * t, cy = p.y + (q.y - p.y) * t;
    let best = 0, bd = 0;
    for (let d = -4; d <= 4; d += 0.5) {
      const x = Math.round(cx + nx * d), y = Math.round(cy + ny * d);
      if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) continue;
      const m = mag[y * w + x]; if (m > best) { best = m; bd = d; }
    }
    if (best >= thr * 0.8) pts.push({ x: cx + nx * bd, y: cy + ny * bd });
  }
  if (pts.length < 6) return null;
  let use = pts;
  for (let round = 0; round < 3; round++) {
    const mx = use.reduce((a, p) => a + p.x, 0) / use.length, my = use.reduce((a, p) => a + p.y, 0) / use.length;
    let sxx = 0, syy = 0, sxy = 0; for (const p of use) { sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; sxy += (p.x - mx) * (p.y - my); }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(ang), dy = Math.sin(ang);
    const res = use.map(p => Math.abs(-(p.x - mx) * dy + (p.y - my) * dx));
    const keep = use.filter((_, i) => res[i] <= 1.5);
    if (keep.length === use.length || keep.length < 6) {
      const th = (Math.atan2(dx, -dy) / DEG + 360) % 360; // normal direction
      return { th, r: mx * Math.cos(th * DEG) + my * Math.sin(th * DEG), rms: Math.sqrt(res.reduce((a, r) => a + r * r, 0) / res.length) };
    }
    use = keep;
  }
  return null;
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const maxCornerDist = (a, b) => Math.max(...a.map((p, i) => dist(p, b[i])));

/** Best card quad in the frame (or null). Corners TL, TR, BR, BL. */
export function detectQuad(E, o) {
  const { w, h } = E;
  const thr = Math.max(10, percentile(E.mag, 0.85));
  const lines = houghLines(E, thr);
  // keep the strongest lines of EACH orientation group, so long background lines (desk edge, wood grain) in one
  // direction cannot crowd out a small card's edges
  let H = [], V = [];
  for (const L of lines) {
    if (Math.abs(L.th - 90) <= 40) H.push(L);
    else V.push(L.th > 90 ? { th: L.th - 180, r: -L.r, v: L.v } : L);
  }
  H = H.slice(0, o.maxPerGroup || 14); V = V.slice(0, o.maxPerGroup || 14);
  const yAt = (L) => (L.r - (w / 2) * Math.cos(L.th * DEG)) / Math.sin(L.th * DEG);
  const xAt = (L) => (L.r - (h / 2) * Math.sin(L.th * DEG)) / Math.cos(L.th * DEG);
  H.sort((a, b) => yAt(a) - yAt(b)); V.sort((a, b) => xAt(a) - xAt(b));
  const oblique = o.mode === 'rightSide';
  const [alo, ahi] = oblique ? [0.9, 3.2] : [o.aspect * (1 - o.aspectTol), o.aspect * (1 + o.aspectTol)];
  let best = null;
  for (let i = 0; i < H.length; i++) for (let j = i + 1; j < H.length; j++) {
    if (yAt(H[j]) - yAt(H[i]) < h * 0.06) continue;
    for (let k = 0; k < V.length; k++) for (let l = k + 1; l < V.length; l++) {
      if (xAt(V[l]) - xAt(V[k]) < w * 0.18) continue;
      const tl = inter(H[i], V[k]), tr = inter(H[i], V[l]), br = inter(H[j], V[l]), bl = inter(H[j], V[k]);
      if (!tl || !tr || !br || !bl) continue;
      const c = [tl, tr, br, bl];
      if (c.some(p => p.x < 1 || p.y < 1 || p.x > w - 2 || p.y > h - 2)) continue;
      const g = quadGeometry(c);
      if (Math.abs(g.angleSum - 360) > 3 || g.cornerDev > (oblique ? 50 : 40)) continue;
      if (g.aspect < alo || g.aspect > ahi) continue;
      const sides = [[tl, tr], [tr, br], [br, bl], [bl, tl]];
      const s = sides.map(([a, b]) => support(E, a, b, thr));
      if (Math.min(...s) < o.minSupport) continue;
      // both ends of every side must be real edges too: a long background line (wood grain, desk edge) that merely
      // passes through one card edge extends past the card's corners, where the other side then has no edge
      if (sides.some(([a, b]) => support(E, a, b, thr, 0.05, 0.22) < o.minEndSupport || support(E, a, b, thr, 0.78, 0.95) < o.minEndSupport)) continue;
      const score = s[0] * g.top + s[1] * g.right + s[2] * g.bottom + s[3] * g.left;
      if (!best || score > best.score) best = { score, c, s };
    }
  }
  if (!best) return null;
  // refine each side and re-intersect
  const [tl, tr, br, bl] = best.c;
  const R = [refineSide(E, tl, tr, thr), refineSide(E, tr, br, thr), refineSide(E, br, bl, thr), refineSide(E, bl, tl, thr)];
  let c = best.c, rms = null;
  if (R.every(Boolean)) {
    const n = [inter(R[3], R[0]), inter(R[0], R[1]), inter(R[1], R[2]), inter(R[2], R[3])];
    if (n.every(p => p && p.x > 0 && p.y > 0 && p.x < w - 1 && p.y < h - 1) && maxCornerDist(n, c) < w * 0.03) { c = n; rms = Math.max(...R.map(r => r.rms)); }
  }
  return { corners: c, support: best.s, rms, thr };
}

export class CardTracker {
  constructor(opts = {}) { this.o = { ...TRACK_DEFAULTS, ...opts }; this.reset(); }
  reset() { this.cand = null; this.locked = false; this.lastDet = 0; this.smoothQ = null; this.hist = []; this.steadySince = 0; this.prevGray = null; }

  analyze(img, ts) {
    const o = this.o, w = img.width, h = img.height;
    const E = signedSobel(img);
    const diff = meanAbsDiff(E.gray, this.prevGray); this.prevGray = E.gray;
    const det = detectQuad(E, o);
    const metrics = {};
    const P = (k) => phrase(k);
    const out = (state, key, extra = {}) => ({ state, ...P(key), ready: false, metrics, progress: 0, ...extra });
    if (det) {
      if (this.cand && maxCornerDist(det.corners, this.cand.q) <= o.lockTol * w) { this.cand.n++; this.cand.q = det.corners; }
      else { this.cand = { q: det.corners, n: 1 }; this.locked = false; this.steadySince = 0; this.hist = []; }
      this.lastDet = ts;
      if (this.cand.n >= o.lockFrames) this.locked = true;
      // frame-rate independent smoothing: the same settling time whether analysis runs at 14 fps or 4 fps
      const a = 1 - Math.pow(1 - o.smooth, Math.max(1, (ts - (this.lastSmooth || ts - 70)) / 70));
      this.lastSmooth = ts;
      this.smoothQ = this.smoothQ && maxCornerDist(this.smoothQ, det.corners) < 0.12 * w
        ? this.smoothQ.map((p, i) => ({ x: p.x + (det.corners[i].x - p.x) * a, y: p.y + (det.corners[i].y - p.y) * a }))
        : det.corners.map(p => ({ ...p }));
    } else if (ts - this.lastDet > o.loseMs) { this.cand = null; this.locked = false; this.smoothQ = null; this.hist = []; this.steadySince = 0; }
    metrics.lock = this.cand ? this.cand.n : 0;
    const disp = this.locked ? this.smoothQ : null;
    const searchKey = o.mode === 'rightSide' ? 'card.rs.search' : 'card.track.search';
    if (!this.locked || !det) { this.steadySince = 0; return out(this.locked ? 'steady' : 'search', this.locked ? 'card.steady' : searchKey, { quad: disp }); }

    const q = det.corners, g = quadGeometry(q);
    const xs = q.map(p => p.x), ys = q.map(p => p.y);
    const rect = { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }; rect.w = rect.x2 - rect.x; rect.h = rect.y2 - rect.y;
    const widthFrac = (g.top + g.bottom) / 2 / w;
    Object.assign(metrics, { wf: +widthFrac.toFixed(2), lr: +g.lr.toFixed(2), tb: +g.tb.toFixed(2), corner: +g.cornerDev.toFixed(1), qaspect: +g.aspect.toFixed(2), sup: det.support.map(s => +s.toFixed(2)).join(','), rms: det.rms === null ? null : +det.rms.toFixed(2) });
    const ex = { rect, quad: disp, rawQuad: q };
    const fail = (state, key) => { this.steadySince = 0; return out(state, key, ex); };
    const mg = 0.012 * w;
    if (q.some(p => p.x < mg || p.y < mg || p.x > w - mg || p.y > h - mg)) return fail('partial', o.mode === 'rightSide' ? 'card.rs.inframe' : 'card.partial');
    if (o.mode === 'rightSide') {
      if (widthFrac < o.minWidthFrac * 0.85) return fail('small', 'card.rs.small');
      if (g.lr < 1 / o.minSideRatio && g.cornerDev >= o.minCornerDev) return fail('tilt', 'card.rs.wrongSide');
      if (g.lr < o.minSideRatio || g.cornerDev < o.minCornerDev) return fail('tilt', 'card.rs.flat');
      if (g.lr > o.maxSideRatio) return fail('tilt', 'card.rs.tooMuch');
    } else {
      if (widthFrac < o.minWidthFrac) return fail('small', 'card.track.small');
      if (widthFrac > o.maxWidthFrac) return fail('near', 'card.near');
      if (Math.max(Math.abs(1 - g.lr), Math.abs(1 - g.tb)) > o.maxPerspective || g.cornerDev > o.maxCornerDevFlat) return fail('flat', 'card.flat');
    }
    // glare / sharpness inside the quad
    const ix0 = Math.max(q[0].x, q[3].x) + rect.w * 0.06, ix1 = Math.min(q[1].x, q[2].x) - rect.w * 0.06;
    const iy0 = Math.max(q[0].y, q[1].y) + rect.h * 0.08, iy1 = Math.min(q[2].y, q[3].y) - rect.h * 0.08;
    const sharp = laplacianVariance(E.gray, w, h, ix0, iy0, ix1, iy1);
    const st = glareStats(E.gray, w, h, ix0, iy0, ix1, iy1, 250, o.glareRel);
    metrics.sharp = +sharp.toFixed(0); metrics.glare = +st.glareFrac.toFixed(3);
    if (st.glareFrac > o.maxGlare) return fail('glare', 'card.glare');
    if (sharp < o.minSharpness) return fail('blur', 'card.blur');
    // steadiness (corners vs recent average)
    let moved = diff > o.steadyDiffTol;
    if (this.hist.length) {
      const n = this.hist.length; let d = 0;
      for (let k = 0; k < 4; k++) { let ax = 0, ay = 0; for (const c of this.hist) { ax += c[k].x / n; ay += c[k].y / n; } d = Math.max(d, Math.hypot(q[k].x - ax, q[k].y - ay) / w); }
      metrics.move = +d.toFixed(3); moved = moved || d > o.steadyTol;
    }
    this.hist.push(q); if (this.hist.length > o.steadyWindow) this.hist.shift();
    if (moved) { this.steadySince = 0; return out('steady', o.mode === 'rightSide' ? 'card.rs.steady' : 'card.steady', ex); }
    if (!this.steadySince) this.steadySince = ts;
    const held = ts - this.steadySince;
    if (held >= o.steadyMs) return { state: 'capture', ...P('card.capture'), ready: true, metrics, progress: 1, ...ex };
    return { state: 'hold', ...P(o.mode === 'rightSide' ? 'card.rs.hold' : 'card.hold'), ready: false, metrics, progress: held / o.steadyMs, ...ex };
  }
}
