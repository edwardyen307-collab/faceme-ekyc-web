// Front/back/other classifier for the Taiwan ID card. Each side must POSITIVELY match the TW ID layout (v11g):
//   FRONT = pale tinted background (not white, not strongly coloured), no chip, a left label column with >= 3 text
//           rows, an ID-number text row in the bottom-left band, no barcode, AND a portrait of the right size in
//           the photo band on the right (checked last, it is the expensive part)
//   BACK  = pale background, no saturated areas, no chip, >= 4 text rows with a left label column (parents /
//           spouse / military service / birthplace / address), a REAL barcode (many thin coherent bars, not a
//           line of big text) of the right width at the bottom, and no portrait
//   UP*   = the same full match on the card rotated 180 degrees (only then the "upside down" hint is shown)
//   OTHER = anything else (another card, a look-alike, uncertain). Nothing is captured unless a side matches.
// NOTE: the bands below were set from the synthetic test cards and the general TW ID layout; tune on real cards.
// The card is first perspective-corrected (deskewed) from its quad, so the same features work with the fixed
// frame and with auto-tracking. Votes are only taken on good frames and the verdict must be stable over frames.
import { loadImageLandmarker } from './face-checker.js?v=2026-11-11g';
import { deskewDrawable } from './warp.js?v=2026-11-11g';
import { CARD_ASPECT } from './card-detector.js?v=2026-11-11g';
import { phrase } from './hints.js?v=2026-11-11g';

export const SIDE_DEFAULTS = {
  intervalMs: 180,    // min time between checks
  frontVotes: 2,      // FRONT: >= 2 of the last 3
  backVotes: 3,       // BACK: >= 3 of the last 4
  upVotes: 3,         // upside-down: >= 3 of the last 4
  otherVotes: 4,      // OTHER (not this document): >= 4 of the last 5
  resetGapMs: 450,    // card out of view this long (e.g. being flipped) -> forget the votes
  deskW: 960,
  // layout bands (fractions of the card)
  front: {
    rows: { x: [0.03, 0.58], y: [0.13, 0.70], label: [0.03, 0.17], minRows: 3, minLabelRows: 3 },
    idRow: { x: [0.03, 0.64], y: [0.68, 0.95], minSpan: 0.22 },
    bgChroma: [5, 32],                 // tinted, pale background (TW ID front is never plain white/grey)
    photo: { cx: [0.64, 0.95], cy: [0.32, 0.80], h: [0.16, 0.6], minFit: 30 },
  },
  back: {
    rows: { x: [0.03, 0.75], y: [0.04, 0.72], label: [0.03, 0.15], minRows: 4, minLabelRows: 3 },
    bgChroma: [0, 22],
    barcode: { y: [0.72, 0.99], cx: [0.25, 0.85], w: [0.15, 0.62], minBars: 12, minCoh: 0.8 },
  },
  minBgLuma: 150, maxSaturated: 0.04, satChroma: 40, maxChip: 0.012,
};

const lumaAt = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const chromaAt = (d, i) => Math.hypot(-0.1687 * d[i] - 0.3313 * d[i + 1] + 0.5 * d[i + 2], 0.5 * d[i] - 0.4187 * d[i + 1] - 0.0813 * d[i + 2]);
function gray(img) { const d = img.data, g = new Float32Array(img.width * img.height); for (let i = 0, j = 0; j < g.length; i += 4, j++) g[j] = lumaAt(d, i); return g; }
// luma spread of the card (robust contrast): p97 - p3 of a sparse sample
function spread(g) { const a = []; for (let i = 0; i < g.length; i += 7) a.push(g[i]); a.sort((x, y) => x - y); return Math.max(20, a[Math.floor(a.length * 0.97)] - a[Math.floor(a.length * 0.03)]); }
function rotate180(img) { const o = new ImageData(img.width, img.height), s = img.data, d = o.data, n = s.length; for (let i = 0; i < n; i += 4) { const j = n - 4 - i; d[j] = s[i]; d[j + 1] = s[i + 1]; d[j + 2] = s[i + 2]; d[j + 3] = 255; } return o; }
function half(img) { // 2x box downsample
  const W = img.width >> 1, H = img.height >> 1, o = new ImageData(W, H), s = img.data, d = o.data, sw = img.width;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((2 * y) * sw + 2 * x) * 4, j = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) d[j + c] = (s[i + c] + s[i + 4 + c] + s[i + sw * 4 + c] + s[i + sw * 4 + 4 + c]) / 4;
    d[j + 3] = 255;
  }
  return o;
}

/** Colour statistics: background (pale pixels) chroma, saturated fraction, chip-like (gold/yellow block) fraction. */
export function colourStats(img, o) {
  const d = img.data, W = img.width, H = img.height;
  let n = 0, nb = 0, bgN = 0, bgC = 0, sat = 0, chip = 0, chipN = 0; const lum = [];
  for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
    const i = (y * W + x) * 4, L = lumaAt(d, i), C = chromaAt(d, i); n++; lum.push(L); if (y > H * 0.15 && x < W * 0.6) nb++;
    if (L > o.minBgLuma) { bgN++; bgC += C; }
    if (C > o.satChroma && y > H * 0.15 && x < W * 0.6) sat++; // body of the card (not the title band / photo)
    if (x < W * 0.5) { chipN++; const cb = -0.1687 * d[i] - 0.3313 * d[i + 1] + 0.5 * d[i + 2], cr = 0.5 * d[i] - 0.4187 * d[i + 1] - 0.0813 * d[i + 2]; if (cb < -25 && cr > 8 && L > 110 && L < 235) chip++; }
  }
  lum.sort((a, b) => a - b);
  return { bgChroma: bgN ? bgC / bgN : 0, bgFrac: bgN / n, medLuma: lum[lum.length >> 1] || 0, saturated: sat / Math.max(1, nb), chip: chip / Math.max(1, chipN) };
}

/** Text rows in a region of a grey image: runs of rows dense in strong horizontal transitions (text strokes). */
export function textRows(g, W, H, xr, yr, labelX, S = spread(g)) {
  const thr = Math.max(7, 0.13 * S);
  const x0 = Math.round(W * xr[0]), x1 = Math.round(W * xr[1]), y0 = Math.round(H * yr[0]), y1 = Math.round(H * yr[1]);
  const l0 = Math.round(W * labelX[0]), l1 = Math.round(W * labelX[1]);
  const e = new Float32Array(H), lab = new Float32Array(H), ext = new Float32Array(H);
  for (let y = y0; y < y1; y++) {
    let c = 0, cl = 0, last = -1, first = -1; const r = y * W;
    for (let x = x0; x < x1 - 2; x++) {
      if (Math.abs(g[r + x + 2] - g[r + x]) > thr && Math.abs(g[r + x + 1] - g[r + x]) >= Math.abs(g[r + x + 2] - g[r + x + 1])) { c++; if (x >= l0 && x < l1) cl++; if (first < 0) first = x; last = x; }
    }
    e[y] = c / (x1 - x0); lab[y] = cl / Math.max(1, l1 - l0); ext[y] = first < 0 ? 0 : (last - first) / W;
  }
  const rows = []; const minH = Math.max(3, H * 0.022), maxH = H * 0.2;
  let start = -1;
  for (let y = y0; y <= y1; y++) {
    const on = y < y1 && e[y] > 0.012;
    if (on && start < 0) start = y;
    if (!on && start >= 0) {
      const h = y - start;
      if (h >= minH && h <= maxH) {
        let le = 0, sp = 0, den = 0; for (let k = start; k < y; k++) { le = Math.max(le, lab[k]); sp = Math.max(sp, ext[k]); den += e[k] / h; }
        rows.push({ y: (start + y) / 2 / H, h: h / H, label: le, span: sp, density: den });
      }
      start = -1;
    }
  }
  return rows;
}

/**
 * Strict barcode test (grey, full-resolution deskewed card): inside the band, find rows with dense transitions,
 * then require many thin bars whose columns are coherent from top to bottom (a line of big text is not).
 */
export function findBarcode(g, W, H, cfg, S = spread(g)) {
  const tThr = Math.max(7, 0.13 * S);
  const y0 = Math.round(H * cfg.y[0]), y1 = Math.round(H * cfg.y[1]);
  const tv = new Float32Array(H);
  for (let y = y0; y < y1; y++) { let s = 0; const r = y * W; for (let x = 2; x < W; x++) if (Math.abs(g[r + x] - g[r + x - 2]) > tThr && Math.abs(g[r + x] - g[r + x - 1]) >= Math.abs(g[r + x - 1] - g[r + x - 2])) s++; tv[y] = s / W; }
  // longest run of "busy" rows
  let best = null, st = -1;
  for (let y = y0; y <= y1; y++) {
    const on = y < y1 && tv[y] > 0.04;
    if (on && st < 0) st = y;
    if (!on && st >= 0) { if (!best || y - st > best[1] - best[0]) best = [st, y]; st = -1; }
  }
  const res = { found: false, bars: 0, coh: 0, cx: 0, w: 0, rows: best ? (best[1] - best[0]) / H : 0 };
  if (!best || best[1] - best[0] < H * 0.035) return res;
  const ra = best[0] + Math.round((best[1] - best[0]) * 0.15), rb = best[1] - Math.round((best[1] - best[0]) * 0.15);
  const m = new Float32Array(W); const rowTv = new Float32Array(W);
  for (let y = ra; y < rb; y++) { const r = y * W; for (let x = 0; x < W; x++) { m[x] += g[r + x] / (rb - ra); if (x) rowTv[x] += Math.abs(g[r + x] - g[r + x - 1]) / (rb - ra); } }
  // extent of the bar area: columns with strong local contrast in the column means
  const busy = new Uint8Array(W);
  for (let x = 6; x < W - 6; x++) { let lo = 255, hi = 0; for (let k = -6; k <= 6; k++) { lo = Math.min(lo, m[x + k]); hi = Math.max(hi, m[x + k]); } busy[x] = hi - lo > 0.25 * S ? 1 : 0; }
  // longest busy run, bridging gaps <= 1.5% of the width
  const maxGap = Math.round(W * 0.015); let bx = null, s = -1, gap = 0;
  for (let x = 0; x <= W; x++) {
    if (x < W && busy[x]) { if (s < 0) s = x; gap = 0; }
    else if (s >= 0) { gap++; if (gap > maxGap || x === W) { const e = x - gap + 1; if (!bx || e - s > bx[1] - bx[0]) bx = [s, e]; s = -1; gap = 0; } }
  }
  if (!bx) return res;
  // a TW ID barcode stands alone: a wide striped area (full-width label barcode, ruled lines) broken into pieces is not it
  let outside = 0; const m0 = bx[0] - maxGap * 3, m1 = bx[1] + maxGap * 3;
  for (let x = 0; x < W; x++) if (busy[x] && (x < m0 || x > m1)) outside++;
  res.outside = +(outside / Math.max(1, bx[1] - bx[0])).toFixed(2);
  if (outside > 0.35 * (bx[1] - bx[0])) return res;
  let bars = 0, sc = 0, sr = 0, dir = 0;
  for (let x = bx[0] + 1; x < bx[1]; x++) {
    const dlt = m[x] - m[x - 1]; sc += Math.abs(dlt); sr += rowTv[x];
    if (Math.abs(dlt) > 0.035 * S) { const nd = Math.sign(dlt); if (nd !== dir) { if (nd < 0) bars++; dir = nd; } }
  }
  Object.assign(res, { bars, coh: Math.min(1, sc / Math.max(1, sr)), cx: (bx[0] + bx[1]) / 2 / W, w: (bx[1] - bx[0]) / W });
  res.found = bars >= cfg.minBars && res.coh >= cfg.minCoh && res.w >= cfg.w[0] && res.w <= cfg.w[1] && res.cx >= cfg.cx[0] && res.cx <= cfg.cx[1];
  return res;
}

export class SideClassifier {
  constructor(opts = {}) {
    this.o = { ...SIDE_DEFAULTS, ...opts };
    this.votes = []; this.last = 0; this.seen = 0; this.lmk = null; this.failed = false; this.lastFeat = null; this.loadError = null;
    this.canvas = document.createElement('canvas'); this.work = document.createElement('canvas'); this.crop = document.createElement('canvas');
  }
  async load() {
    this.failed = false;
    try { this.lmk = await loadImageLandmarker(); } catch (e) { console.warn('side classifier unavailable', e); this.failed = true; this.loadError = e; }
    return !this.failed;
  }
  get ready() { return !!this.lmk; }
  tick(ts, cardVisible) {
    if (cardVisible) { if (this.seen && ts - this.seen > this.o.resetGapMs) this.votes = []; this.seen = ts; }
  }
  /** One check on the card quad (video px, TL TR BR BL) if it is time. Returns true when a vote was taken. */
  observe(video, quad, ts, aspect = CARD_ASPECT) {
    if (!this.lmk || ts - this.last < this.o.intervalMs) return false;
    this.last = ts;
    const desk = deskewDrawable(video, video.videoWidth, video.videoHeight, quad, this.o.deskW, aspect, this.work);
    this.vote(this.features(desk));
    return true;
  }
  vote(f) { this.lastFeat = f; this.votes.push(f.label); if (this.votes.length > 8) this.votes.shift(); }
  /** Still images (e.g. FaceMe SDK card crops, whole image = card): one vote per image; returns verdict(). */
  async classifyImages(blobs) {
    this.votes = [];
    for (const b of blobs) {
      const bmp = await createImageBitmap(b);
      const c = this.work; c.width = this.o.deskW; c.height = Math.round(this.o.deskW / CARD_ASPECT);
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
      this.vote(this.features(g.getImageData(0, 0, c.width, c.height)));
    }
    // one still per frame: require a clear majority instead of the streaming vote windows
    const n = this.votes.length, cnt = (l) => this.votes.filter(x => x === l).length;
    for (const l of ['front', 'back', 'upFront', 'upBack']) if (cnt(l) * 2 > n) return l;
    return n ? 'other' : null;
  }
  /** Features + label of one deskewed card image (ImageData, ~960 px wide). */
  features(desk) {
    const f = { label: 'other' };
    const up = this._match(desk, f, '');
    if (up) { f.label = up; return f; }
    const rot = rotate180(desk);
    const dn = this._match(rot, f, 'r_');
    if (dn) f.label = dn === 'front' ? 'upFront' : 'upBack';
    return f;
  }
  // full positive match of one orientation -> 'front' | 'back' | null; records the reasons in f
  _match(desk, f, pre) {
    const o = this.o, small = half(desk), g = gray(small), W = small.width, H = small.height;
    const col = colourStats(small, o);
    f[pre + 'col'] = { bg: +col.bgChroma.toFixed(1), sat: +col.saturated.toFixed(3), chip: +col.chip.toFixed(3), lum: Math.round(col.medLuma) };
    if (col.chip > o.maxChip) { f[pre + 'why'] = 'chip'; return null; }
    if (col.saturated > o.maxSaturated) { f[pre + 'why'] = 'colourful'; return null; }
    if (col.medLuma < o.minBgLuma) { f[pre + 'why'] = 'dark'; return null; }
    const G = gray(desk), bc = findBarcode(G, desk.width, desk.height, o.back.barcode);
    f[pre + 'bc'] = { ok: bc.found, bars: bc.bars, coh: +bc.coh.toFixed(2), cx: +bc.cx.toFixed(2), w: +bc.w.toFixed(2) };
    // FRONT candidate
    const fr = o.front, rowsF = textRows(g, W, H, fr.rows.x, fr.rows.y, fr.rows.label);
    const labF = rowsF.filter(r => r.label > 0.04).length;
    const idRows = textRows(g, W, H, fr.idRow.x, fr.idRow.y, fr.idRow.x).filter(r => r.span >= fr.idRow.minSpan);
    f[pre + 'front'] = { rows: rowsF.length, label: labF, id: idRows.length, bgOk: col.bgChroma >= fr.bgChroma[0] && col.bgChroma <= fr.bgChroma[1] };
    const frontLayout = !bc.found && rowsF.length >= fr.rows.minRows && labF >= fr.rows.minLabelRows && idRows.length >= 1 && f[pre + 'front'].bgOk;
    // BACK candidate
    const bk = o.back, rowsB = textRows(g, W, H, bk.rows.x, bk.rows.y, bk.rows.label);
    const labB = rowsB.filter(r => r.label > 0.04).length;
    f[pre + 'back'] = { rows: rowsB.length, label: labB, bgOk: col.bgChroma >= bk.bgChroma[0] && col.bgChroma <= bk.bgChroma[1] };
    const backLayout = bc.found && rowsB.length >= bk.rows.minRows && labB >= bk.rows.minLabelRows && f[pre + 'back'].bgOk;
    if (!frontLayout && !backLayout) { f[pre + 'why'] = 'layout'; return null; }
    // portrait (expensive): required for the front, forbidden for the back
    const c = this.canvas; c.width = desk.width; c.height = desk.height; c.getContext('2d').putImageData(desk, 0, 0);
    const face = this._face(c);
    const p = fr.photo;
    const okPhoto = face && face.fit >= p.minFit && face.cx >= p.cx[0] && face.cx <= p.cx[1] && face.cy >= p.cy[0] && face.cy <= p.cy[1] && face.h >= p.h[0] && face.h <= p.h[1];
    f[pre + 'face'] = face ? { cx: +face.cx.toFixed(2), cy: +face.cy.toFixed(2), h: +face.h.toFixed(2), fit: Math.round(face.fit), ok: !!okPhoto } : null;
    if (frontLayout && okPhoto) return 'front';
    if (backLayout && !face) return 'back';
    f[pre + 'why'] = frontLayout ? 'photo' : 'face-on-back';
    return null;
  }
  // portrait in the right part of the card (x 0.45-1). Box in card coords + fit quality (dark eyes on brighter skin;
  // the mesh is fitted upright even on an upside-down face, so a low fit means "not a proper upright portrait").
  _face(src) {
    const W = src.width, H = src.height, x0 = 0.45, cw = 0.55;
    const outW = 256, outH = Math.round(outW * H / (W * cw));
    const c = this.crop; c.width = outW; c.height = outH;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(src, W * x0, 0, W * cw, H, 0, 0, outW, outH);
    let res;
    try { res = this.lmk.detect(c); } catch (e) { console.warn(e); return null; }
    const lm = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!lm) return null;
    let xa = 1, xb = 0, ya = 1, yb = 0;
    for (const p of lm) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); ya = Math.min(ya, p.y); yb = Math.max(yb, p.y); }
    const px = g.getImageData(0, 0, outW, outH).data;
    const L = (i) => { const p = lm[i]; if (!p) return NaN; const x = Math.max(0, Math.min(outW - 1, Math.round(p.x * outW))), y = Math.max(0, Math.min(outH - 1, Math.round(p.y * outH))); return lumaAt(px, (y * outW + x) * 4); };
    const avg = (ids) => { const v = ids.map(L).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    const fit = avg([10, 151, 6, 50, 280]) - avg(lm.length > 473 ? [468, 473, 159, 386] : [159, 145, 386, 374]);
    return { cx: x0 + cw * (xa + xb) / 2, cy: (ya + yb) / 2, h: yb - ya, fit };
  }
  /** 'front' | 'back' | 'upFront' | 'upBack' | 'other' | null (undecided) */
  verdict() {
    const v = this.votes, o = this.o, cnt = (arr, l) => arr.filter(x => x === l).length;
    const l3 = v.slice(-3), l4 = v.slice(-4), l5 = v.slice(-5);
    if (l3.length >= 2 && cnt(l3, 'front') >= o.frontVotes) return 'front';
    if (l4.length >= 3 && cnt(l4, 'back') >= o.backVotes) return 'back';
    if (l4.length >= 3 && cnt(l4, 'upFront') >= o.upVotes) return 'upFront';
    if (l4.length >= 3 && cnt(l4, 'upBack') >= o.upVotes) return 'upBack';
    if (l5.length >= 4 && cnt(l5, 'other') >= o.otherVotes) return 'other';
    return null;
  }
  get summary() { return this.votes.map(l => ({ front: 'F', back: 'B', upFront: 'f', upBack: 'b', other: 'X' })[l] || '?').join(''); }
}

/** Expected side + verdict -> hint key when they don't match (null = OK / undecided). */
export function sideMismatchKey(expected, verdict) {
  if (!verdict || verdict === expected) return null;
  if (expected === 'front') return { back: 'card.wrongBack', upBack: 'card.wrongBack', upFront: 'card.upsideDown', other: 'card.notFront' }[verdict] || null;
  return { front: 'card.wrongFront', upFront: 'card.wrongFront', upBack: 'card.upsideDown', other: 'card.notBack' }[verdict] || null;
}

/**
 * Load the side classifier for a TW ID capture. If the face model cannot be loaded the capture is BLOCKED (never
 * silently skipped): a clear message is shown and we wait for ctx.waitRetry() (the app's retry button), then retry.
 * holder._cancel is set while waiting so the engine's cancel() still works. Throws if the app offers no retry.
 */
export async function loadSideClassifierOrBlock(ctx, holder) {
  const cls = new SideClassifier();
  ctx.ui.update({ state: 'loading', hint: '準備證件檢查中…', level: 'adjust', dir: 'wait', progress: 0, metrics: {} }, null, null, true);
  while (!(await cls.load())) {
    ctx.ui.update({ state: 'sideload', ...phrase('card.sideLoadFail'), ready: false, progress: 0, metrics: { side: 'load-failed' } }, null, null, true);
    if (!ctx.waitRetry) throw Object.assign(new Error('證件檢查元件載入失敗，請重新整理'), { code: 'sideload' });
    await new Promise((resolve, reject) => {
      holder._cancel = () => reject(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
      ctx.waitRetry().then(resolve);
    });
    holder._cancel = null;
    ctx.ui.update({ state: 'loading', hint: '重新載入證件檢查元件…', level: 'adjust', dir: 'wait', progress: 0, metrics: {} }, null, null, true);
  }
  return cls;
}
