// Front/back/other classifier for the Taiwan ID card (2005 design). v11h:
//   FRONT = all of: portrait of the right size in the photo area (right), a left label column (>= 2 rows), a text row
//           in the bottom-left band (發證日期), tinted pale card, no chip, no strict barcode.
//   BACK  = weighted SCORE (real cards under phone cameras rarely pass an all-must-pass rule):
//           text rows with a left label column (父母/配偶/役別/出生地/住址)  x3
//           thin full-width ruling lines between the rows (TW ID back has 4)   x2
//           1-D barcode in the lower part (bottom-left on the real card; position tolerant, blur tolerant) x3
//           pale, not colourful card                                           x1
//         back if score >= backMin AND (barcode or ruling lines) AND no portrait anywhere AND no chip.
//   Colour tests are relative to the card's own background (white-balance / warm-light tolerant).
//   UP*   = the same match on the card rotated 180 degrees (only then the "upside down" hint is shown).
//   OTHER = anything else. Nothing is captured unless a side matches.
// Layout reference: public MOI specimen (內政部戶政司「國民身分證真偽辨識資料」). Bands are fractions of the laminated
// card (85.7 x 54 mm; the printed paper sits ~3.5% inside). Tune on real cards via ?debug=1 (side line in the overlay).
import { loadImageLandmarker } from './face-checker.js?v=2026-11-11h';
import { deskewDrawable } from './warp.js?v=2026-11-11h';
import { CARD_ASPECT } from './card-detector.js?v=2026-11-11h';
import { phrase } from './hints.js?v=2026-11-11h';

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
    rows: { x: [0.03, 0.62], y: [0.13, 0.95], label: [0.03, 0.17], minLabelRows: 2 },
    idRow: { x: [0.03, 0.64], y: [0.68, 0.95], minSpan: 0.22 },
    bgChroma: [0, 45],                 // pale background (tint varies with the light)
    photo: { cx: [0.62, 0.95], cy: [0.25, 0.80], h: [0.16, 0.62], minFit: 30 },
    maxSaturated: 0.08,                // flag / red seal are allowed
  },
  back: {
    rows: { x: [0.03, 0.78], y: [0.04, 0.74], label: [0.03, 0.2] },
    lines: { y: [0.12, 0.8], band: [0.17, 0.76], x: [0.05, 0.95], minFrac: 0.72 },
    barcode: { y: [0.5, 0.99], cx: [0.1, 0.62], w: [0.12, 0.72], strictW: [0.15, 0.62], minBars: 8, minCoh: 0.6 },
    maxBgChroma: 40, maxSaturated: 0.06,
    weights: { rows: 3, lines: 2, barcode: 3, bg: 1 }, minScore: 6,
  },
  minBgLuma: 95, satDev: 42, maxChip: 0.012,
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

/**
 * Colour statistics relative to the card's own background (so warm / cool light and the TW ID's orange-yellow tint
 * do not count as "colour"): background = brightest half of the pixels; saturated = chroma far from the background;
 * chip = a gold/yellow block clearly more yellow than the background in the left-middle of the card.
 */
export function colourStats(img, o) {
  const d = img.data, W = img.width, H = img.height, px = [];
  for (let y = 2; y < H - 2; y += 2) for (let x = 2; x < W - 2; x += 2) {
    const i = (y * W + x) * 4, L = lumaAt(d, i);
    px.push([L, -0.1687 * d[i] - 0.3313 * d[i + 1] + 0.5 * d[i + 2], 0.5 * d[i] - 0.4187 * d[i + 1] - 0.0813 * d[i + 2], x / W, y / H]);
  }
  const ls = px.map(p => p[0]).sort((a, b) => a - b), med = ls[ls.length >> 1] || 0, hi = ls[Math.floor(ls.length * 0.5)];
  let bcb = 0, bcr = 0, bn = 0;
  for (const p of px) if (p[0] >= hi) { bcb += p[1]; bcr += p[2]; bn++; }
  bcb /= Math.max(1, bn); bcr /= Math.max(1, bn);
  let nb = 0, sat = 0, chip = 0, chipN = 0;
  for (const [L, cb, cr, x, y] of px) {
    const dev = Math.hypot(cb - bcb, cr - bcr);
    if (y > 0.15 && x < 0.6) { nb++; if (dev > o.satDev) sat++; }
    if (x < 0.5 && y > 0.28 && y < 0.85) { chipN++; if (cb - bcb < -28 && cr - bcr > 2 && cr - bcr < 45 && dev > 30 && L > 80 && L < 235) chip++; } // gold, not red
  }
  return { bgChroma: Math.hypot(bcb, bcr), medLuma: med, saturated: sat / Math.max(1, nb), chip: chip / Math.max(1, chipN) };
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
 * 1-D barcode in the lower part of the card (grey, deskewed, ~960 px). Blur tolerant: barcode pixels have a strong
 * horizontal gradient but almost no vertical change; dense areas of such pixels are grouped into a box, then the bars
 * must be coherent from top to bottom (a row of text / digits / a QR code is not). Returns score 0 / 0.6 / 1.
 */
export function findBarcode(g, W, H, cfg, S = spread(g)) {
  const res = { score: 0, strict: false, bars: 0, coh: 0, cx: 0, cy: 0, w: 0, h: 0 };
  const y0 = Math.max(2, Math.round(H * cfg.y[0])), y1 = Math.min(H - 3, Math.round(H * cfg.y[1]));
  const t = Math.max(6, 0.08 * S), step = 4, gw = Math.ceil(W / step), gh = Math.ceil((y1 - y0) / step);
  const cnt = new Float32Array(gw * gh);
  for (let y = y0; y < y1; y++) {
    const r = y * W, gy = ((y - y0) / step) | 0;
    for (let x = 1; x < W - 1; x++) {
      const hm = Math.abs(g[r + x + 1] - g[r + x - 1]);
      if (hm > t && Math.abs(g[r + 2 * W + x] - g[r - 2 * W + x]) < 0.5 * hm) cnt[gy * gw + ((x / step) | 0)]++;
    }
  }
  // density over ~ (0.05 W x 0.05 H) windows, thresholded into a grid
  const rx = Math.max(1, Math.round(W * 0.025 / step)), ry = Math.max(1, Math.round(H * 0.025 / step));
  const on = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let s = 0, n = 0;
    for (let yy = Math.max(0, gy - ry); yy <= Math.min(gh - 1, gy + ry); yy++) for (let xx = Math.max(0, gx - rx); xx <= Math.min(gw - 1, gx + rx); xx++) { s += cnt[yy * gw + xx]; n++; }
    if (s / (n * step * step) > 0.2) on[gy * gw + gx] = 1;
  }
  // components -> evaluate each plausible box, keep the best
  const seen = new Uint8Array(gw * gh);
  for (let i0 = 0; i0 < on.length; i0++) {
    if (!on[i0] || seen[i0]) continue;
    let xa = 1e9, xb = -1, ya = 1e9, yb = -1, n = 0; const st = [i0]; seen[i0] = 1;
    while (st.length) {
      const i = st.pop(), gx = i % gw, gy = (i / gw) | 0; n++;
      xa = Math.min(xa, gx); xb = Math.max(xb, gx); ya = Math.min(ya, gy); yb = Math.max(yb, gy);
      for (const j of [i - 1, i + 1, i - gw, i + gw]) if (j >= 0 && j < on.length && on[j] && !seen[j] && Math.abs((j % gw) - gx) <= 1) { seen[j] = 1; st.push(j); }
    }
    const bx0 = xa * step, bx1 = (xb + 1) * step, by0 = y0 + ya * step, by1 = y0 + (yb + 1) * step;
    const w = (bx1 - bx0) / W, h = (by1 - by0) / H;
    // all bar-like cells in the middle rows of this box: a TW ID barcode stands alone (labels with a full-width code don't)
    let cols = 0; const ga = ya + Math.round((yb - ya) * 0.3), gb = yb - Math.round((yb - ya) * 0.3);
    for (let gx = 0; gx < gw; gx++) for (let gy = ga; gy <= gb; gy++) if (on[gy * gw + gx]) { cols++; break; }
    const spanAll = cols * step / W;
    if (w < cfg.w[0] * 0.8 || h < 0.035 || h > 0.3) continue;
    // coherence + bars on the middle 60% of the box
    const ra = by0 + Math.round((by1 - by0) * 0.2), rb = by1 - Math.round((by1 - by0) * 0.2);
    const m = new Float32Array(bx1 - bx0); let rowTv = 0;
    for (let y = ra; y < rb; y++) { const r = y * W; for (let x = bx0; x < bx1; x++) { m[x - bx0] += g[r + x] / (rb - ra); if (x > bx0) rowTv += Math.abs(g[r + x] - g[r + x - 1]) / (rb - ra); } }
    let colTv = 0, lo = 255, hi = 0; for (let k = 1; k < m.length; k++) colTv += Math.abs(m[k] - m[k - 1]);
    for (const v of m) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const coh = Math.min(1, colTv / Math.max(1, rowTv));
    let bars = 0, dir = 1, ext = m[0]; const prom = Math.max(4, 0.12 * (hi - lo));
    for (let k = 1; k < m.length; k++) {
      if (dir >= 0 && m[k] > ext) ext = m[k]; else if (dir <= 0 && m[k] < ext) ext = m[k];
      if (dir >= 0 && ext - m[k] > prom) { if (dir > 0) bars++; dir = -1; ext = m[k]; }
      else if (dir <= 0 && m[k] - ext > prom) { dir = 1; ext = m[k]; }
    }
    // vertical uniformity: bars look the same from top to bottom (text strokes do not): mean column std vs profile std
    let vs = 0, mm = 0; for (const v of m) mm += v / m.length;
    let ps = 0; for (const v of m) ps += (v - mm) * (v - mm) / m.length; ps = Math.sqrt(ps);
    for (let x = bx0; x < bx1; x += 2) { let a = 0, a2 = 0, n2 = 0; for (let y = ra; y < rb; y++) { const v = g[y * W + x]; a += v; a2 += v * v; n2++; } vs += Math.sqrt(Math.max(0, a2 / n2 - (a / n2) ** 2)) / Math.ceil((bx1 - bx0) / 2); }
    const vr = vs / Math.max(1, ps);
    let score = 0;
    if (spanAll > cfg.w[1] + 0.1) { if (!res.score && w * h > res.w * res.h) Object.assign(res, { bars, wide: +spanAll.toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) }); continue; }
    const strict = bars >= cfg.minBars && coh >= cfg.minCoh + 0.1 && vr <= 0.45 && h >= 0.075 && w >= cfg.strictW[0] && w <= cfg.strictW[1];
    if (bars >= cfg.minBars && coh >= cfg.minCoh && vr <= 0.45 && h >= 0.07 && w >= cfg.w[0] && w <= cfg.w[1]) score = 1;
    else if (bars >= 4 && coh >= cfg.minCoh && vr <= 0.6 && h >= 0.055 && w >= cfg.w[0] * 0.8 && w <= cfg.w[1] + 0.08) score = 0.6;
    if (score > res.score || (score === res.score && w > res.w && score > 0)) Object.assign(res, { score, strict, bars, vr: +vr.toFixed(2), coh: +coh.toFixed(2), cx: +((bx0 + bx1) / 2 / W).toFixed(2), cy: +((by0 + by1) / 2 / H).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) });
    else if (!res.score && w * h > res.w * res.h) Object.assign(res, { bars, vr: +vr.toFixed(2), coh: +coh.toFixed(2), cx: +((bx0 + bx1) / 2 / W).toFixed(2), cy: +((by0 + by1) / 2 / H).toFixed(2), w: +w.toFixed(2), h: +h.toFixed(2) });
  }
  return res;
}

/** Thin horizontal ruling lines across most of the card width (the TW ID back separates its rows with 4 of them). */
export function ruleLines(g, W, H, cfg, S = spread(g)) {
  const t = Math.max(5, 0.06 * S), x0 = Math.round(W * cfg.x[0]), x1 = Math.round(W * cfg.x[1]);
  const y0 = Math.max(3, Math.round(H * cfg.y[0])), y1 = Math.min(H - 4, Math.round(H * cfg.y[1]));
  const fr = new Float32Array(H);
  for (let y = y0 - 8; y < y1 + 8; y++) {
    if (y < 3 || y >= H - 3) continue;
    // longest continuous run of edge columns (gaps up to 1.5% of the width bridged): a ruling line, not scattered text
    let best = 0, run = 0, gap = 0; const maxGap = Math.max(2, Math.round(W * 0.015));
    for (let x = x0; x < x1; x++) {
      const i = y * W + x;
      if (Math.abs(g[i + 2 * W] - g[i - 2 * W]) > t || Math.abs(g[i + W] - g[i - W]) > t) { run += gap + 1; gap = 0; if (run > best) best = run; }
      else if (run) { if (++gap > maxGap) { run = 0; gap = 0; } }
    }
    fr[y] = best / (x1 - x0);
  }
  const lines = []; const gap = Math.max(4, Math.round(H * 0.035)), side = Math.max(5, Math.round(H * 0.018));
  for (let y = y0; y < y1; y++) {
    if (fr[y] < cfg.minFrac) continue;
    // thin: falls off quickly above and below (a text row stays busy over its whole height)
    const away = Math.min(Math.max(fr[y - side] || 0, fr[y - side - 1] || 0), Math.max(fr[y + side] || 0, fr[y + side + 1] || 0));
    if (away > 0.6 * fr[y]) continue;
    if (lines.length && y - lines[lines.length - 1] < gap) continue;
    lines.push(y);
  }
  return lines.map(y => +(y / H).toFixed(2));
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
    if (f.face) return f; // a portrait upright -> never an upside-down back
    const rot = rotate180(desk);
    const dn = this._match(rot, f, 'r_');
    if (dn === 'back') {
      // MediaPipe misses upside-down faces: check the upright image for a portrait before calling it an upside-down back
      const c = this.canvas; c.width = desk.width; c.height = desk.height; c.getContext('2d').putImageData(desk, 0, 0);
      if (this._face(c, 0.45) || this._face(c, 0)) { f.r_why = 'face-upright'; return f; }
    }
    if (dn) f.label = dn === 'front' ? 'upFront' : 'upBack';
    return f;
  }
  // positive match of one orientation -> 'front' | 'back' | null; records feature values / scores in f
  _match(desk, f, pre) {
    const o = this.o, small = half(desk), g = gray(small), W = small.width, H = small.height;
    const col = colourStats(small, o);
    f[pre + 'col'] = { bg: +col.bgChroma.toFixed(1), sat: +col.saturated.toFixed(3), chip: +col.chip.toFixed(3), lum: Math.round(col.medLuma) };
    if (col.chip > o.maxChip) { f[pre + 'why'] = 'chip'; return null; }
    if (col.medLuma < o.minBgLuma) { f[pre + 'why'] = 'dark'; return null; }
    const G = gray(desk), S = spread(G), bc = findBarcode(G, desk.width, desk.height, o.back.barcode, S);
    f[pre + 'bc'] = bc;
    // FRONT candidate (all must pass; the portrait is checked last)
    const fr = o.front, rowsF = textRows(g, W, H, fr.rows.x, fr.rows.y, fr.rows.label);
    const labF = rowsF.filter(r => r.label > 0.04).length;
    const idRows = textRows(g, W, H, fr.idRow.x, fr.idRow.y, fr.idRow.x).filter(r => r.span >= fr.idRow.minSpan);
    const bgF = col.bgChroma >= fr.bgChroma[0] && col.bgChroma <= fr.bgChroma[1];
    f[pre + 'front'] = { label: labF, id: idRows.length, bgOk: bgF };
    const frontLayout = !bc.strict && bc.score < 0.6 && labF >= fr.rows.minLabelRows && idRows.length >= 1 && bgF && col.saturated <= fr.maxSaturated;
    // BACK candidate (weighted score)
    const bk = o.back, wt = bk.weights;
    const rowsB = textRows(g, W, H, bk.rows.x, bk.rows.y, bk.rows.label), labB = rowsB.filter(r => r.label > 0.04).length;
    const raw = ruleLines(g, W, H, bk.lines);
    // TW ID back: 3-5 ruling lines between the rows, regularly spaced (>= 8% of the card height apart); a list / form
    // with many lines or boxes (top + bottom edges close together) is not counted
    const lines = raw.filter(y => y >= bk.lines.band[0] && y <= bk.lines.band[1]);
    const regular = raw.length <= 6 && lines.every((y, i) => i === 0 || y - lines[i - 1] >= 0.08);
    const nL = regular ? lines.length : 0;
    const sRows = Math.min(1, Math.max(0, (labB - 1) / 3)), sLines = Math.min(1, Math.max(0, (nL - 1) / 3)), sBc = bc.score;
    const sBg = col.saturated <= bk.maxSaturated && col.bgChroma <= bk.maxBgChroma ? 1 : (col.saturated <= bk.maxSaturated * 2 ? 0.5 : 0);
    const score = wt.rows * sRows + wt.lines * sLines + wt.barcode * sBc + wt.bg * sBg;
    const bcLeft = bc.cx >= bk.barcode.cx[0] && bc.cx <= bk.barcode.cx[1] && bc.cy >= 0.62;
    // evidence paths: barcode + >= 2 ruling lines | >= 3 ruling lines (barcode unreadable: glare / blur) |
    //                 a clear barcode where the TW ID has it + >= 4 labelled rows (lines too faint)
    const path = (sBc >= 0.6 && nL >= 2) ? 'bc+lines' : (nL >= 3 ? 'lines' : (sBc === 1 && bcLeft && labB >= 4 ? 'bc+rows' : ''));
    const backLayout = !!path && labB >= 3 && score >= bk.minScore && col.saturated <= bk.maxSaturated * 2.5;
    f[pre + 'back'] = { score: +score.toFixed(1), rows: labB, lines: nL, rawLines: raw.length, bc: sBc, bg: sBg, path, ok: backLayout };
    if (!frontLayout && !backLayout) { f[pre + 'why'] = 'layout'; return null; }
    // portrait (expensive): required for the front; forbidden anywhere on the back
    const c = this.canvas; c.width = desk.width; c.height = desk.height; c.getContext('2d').putImageData(desk, 0, 0);
    const face = this._face(c, 0.45);
    const p = fr.photo;
    const okPhoto = face && face.fit >= p.minFit && face.cx >= p.cx[0] && face.cx <= p.cx[1] && face.cy >= p.cy[0] && face.cy <= p.cy[1] && face.h >= p.h[0] && face.h <= p.h[1];
    f[pre + 'face'] = face ? { cx: +face.cx.toFixed(2), cy: +face.cy.toFixed(2), h: +face.h.toFixed(2), fit: Math.round(face.fit), ok: !!okPhoto } : null;
    if (frontLayout && okPhoto) return 'front';
    if (backLayout && !face) {
      const left = this._face(c, 0); // a portrait on the left (other cards) is not a TW ID back either
      if (!left) return 'back';
      f[pre + 'faceLeft'] = true;
    }
    f[pre + 'why'] = frontLayout ? 'photo' : 'face-on-back';
    return null;
  }
  /** One-line summary of the last check for the ?debug=1 overlay. */
  debugText() {
    const f = this.lastFeat; if (!f) return 'side: -';
    const b = f.back || {}, bc = f.bc || {}, c = f.col || {}, fr = f.front || {}, fa = f.face;
    return `side ${f.label} [${this.summary}] why=${f.why || '-'}\n` +
      `back score ${b.score ?? '-'}/${this.o.back.minScore} ${b.ok ? 'OK' : 'no'} path=${b.path || '-'} rows=${b.rows ?? '-'} lines=${b.lines ?? '-'}(${b.rawLines ?? '-'}) bc=${b.bc ?? '-'}(bars ${bc.bars ?? '-'} coh ${bc.coh ?? '-'} w ${bc.w ?? '-'} @${bc.cx ?? '-'},${bc.cy ?? '-'}) bg=${b.bg ?? '-'}\n` +
      `col bg=${c.bg} sat=${c.sat} chip=${c.chip} lum=${c.lum} | front label=${fr.label ?? '-'} id=${fr.id ?? '-'} bgOk=${fr.bgOk ?? '-'} face=${fa ? `${fa.cx},${fa.cy} h${fa.h} fit${fa.fit} ${fa.ok ? 'ok' : 'x'}` : '-'}`;
  }
  // portrait in the right part of the card (x 0.45-1). Box in card coords + fit quality (dark eyes on brighter skin;
  // the mesh is fitted upright even on an upside-down face, so a low fit means "not a proper upright portrait").
  _face(src, x0 = 0.45) {
    const W = src.width, H = src.height, cw = 0.55;
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
