// Front/back/other classifier for the Taiwan ID card. Each side must POSITIVELY match its own layout:
//   FRONT = a portrait photo in the photo area (right part of the card, face of plausible size and position)
//   BACK  = no portrait AND a barcode in the bottom band AND a pale (not strongly coloured) card
//   OTHER = a card is in view but matches neither (bank card, other ID with the photo on the left, ...)
//   UP*   = the same layouts with the card upside down
// The card is first perspective-corrected (deskewed) from its quad, so the same features work with the fixed
// frame and with auto-tracking. Votes are only taken on good frames and the verdict must be stable over frames.
import { loadImageLandmarker } from './face-checker.js?v=2026-11-11f';
import { deskewDrawable } from './warp.js?v=2026-11-11f';
import { CARD_ASPECT } from './card-detector.js?v=2026-11-11f';

export const SIDE_DEFAULTS = {
  intervalMs: 160,    // min time between checks
  frontVotes: 2,      // FRONT: >= 2 of the last 3
  backVotes: 3,       // BACK: >= 3 of the last 4
  upVotes: 3,         // upside-down: >= 3 of the last 4
  otherVotes: 4,      // OTHER (not this document): >= 4 of the last 5
  resetGapMs: 450,    // card out of view this long (e.g. being flipped) -> forget the votes
  deskW: 640,
  barcodeMin: 5.5,    // barcode score (column-coherent stripe contrast, at 320 px card width)
  maxChroma: 32,      // mean chroma above this = strongly coloured card (not a TW ID)
  photoX: [0.55, 0.98], photoY: [0.18, 0.86], photoH: [0.15, 0.8],
};

/** Barcode-like stripes in a horizontal band of a deskewed card (ImageData ~320 px wide). */
export function barcodeScore(img, top) {
  const { data, width: W, height: H } = img;
  const y0 = Math.round(H * (top ? 0.03 : 0.72)), y1 = Math.round(H * (top ? 0.28 : 0.97));
  const x0 = Math.round(W * 0.03), x1 = Math.round(W * 0.97), rows = y1 - y0;
  const n = x1 - x0, m = new Float32Array(n), rt = new Float32Array(n);
  for (let y = y0; y < y1; y++) {
    let prev = -1;
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      m[x - x0] += g / rows;
      if (prev >= 0) rt[x - x0] += Math.abs(g - prev) / rows;
      prev = g;
    }
  }
  const ww = Math.round(W * 0.22), ct = (x) => (x > 0 ? Math.abs(m[x] - m[x - 1]) : 0);
  let sc = 0, sr = 0, best = { score: 0, s: 0, coh: 0, x: 0 };
  for (let x = 1; x < n; x++) {
    sc += ct(x); sr += rt[x];
    if (x > ww) { sc -= ct(x - ww); sr -= rt[x - ww]; }
    if (x >= ww) {
      const s = sc / ww, coh = Math.min(1, sc / Math.max(1e-3, sr)), score = s * coh * coh;
      if (score > best.score) best = { score, s, coh, x: (x0 + x - ww / 2) / W };
    }
  }
  return best;
}
/** Mean chroma (YCbCr distance from grey) of an ImageData. */
export function meanChroma(img) {
  const d = img.data; let s = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    s += Math.hypot(-0.1687 * r - 0.3313 * g + 0.5 * b, 0.5 * r - 0.4187 * g - 0.0813 * b); n++;
  }
  return n ? s / n : 0;
}
function half(img) { // 2x box downsample
  const W = img.width >> 1, H = img.height >> 1, o = new ImageData(W, H), s = img.data, d = o.data, sw = img.width;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = ((2 * y) * sw + 2 * x) * 4, j = (y * W + x) * 4;
    for (let c = 0; c < 3; c++) d[j + c] = (s[i + c] + s[i + 4 + c] + s[i + sw * 4 + c] + s[i + sw * 4 + 4 + c]) / 4;
    d[j + 3] = 255;
  }
  return o;
}

export class SideClassifier {
  constructor(opts = {}) {
    this.o = { ...SIDE_DEFAULTS, ...opts };
    this.votes = []; this.last = 0; this.seen = 0; this.lmk = null; this.failed = false; this.lastFeat = null;
    this.canvas = document.createElement('canvas'); this.work = document.createElement('canvas'); this.crop = document.createElement('canvas');
  }
  async load() {
    try { this.lmk = await loadImageLandmarker(); } catch (e) { console.warn('side classifier unavailable', e); this.failed = true; }
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
    const f = this.features(desk);
    this.lastFeat = f;
    this.votes.push(f.label); if (this.votes.length > 8) this.votes.shift();
    return true;
  }
  /** Features + label of one deskewed card image (ImageData). */
  features(desk) {
    const o = this.o;
    const small = desk.width > 400 ? half(desk) : desk;
    const bc = barcodeScore(small, false), bcTop = barcodeScore(small, true), chroma = meanChroma(small);
    const f = { barcode: +bc.score.toFixed(1), barcodeTop: +bcTop.score.toFixed(1), chroma: +chroma.toFixed(1) };
    const c = this.canvas; c.width = desk.width; c.height = desk.height;
    c.getContext('2d').putImageData(desk, 0, 0);
    // Where is the portrait, and which way up is it RELATIVE TO THE CARD?
    //   right part, upright            -> FRONT (if size/position fit the photo area)
    //   left part, upside down         -> FRONT held upside down
    //   left part, upright             -> photo on the wrong side: another kind of card
    const hasBarcode = Math.max(bc.score, bcTop.score) >= o.barcodeMin;
    let face = this._face(c, 'right');
    if (face && face.fit < 60) {
      // weak fit: maybe an upside-down portrait (e.g. another card held upside down) -> compare with the rotated fit
      const r = this._face(c, 'rightRot');
      if (r && r.fit > face.fit) face = { ...face, where: 'odd', dbg: `(${face.fit.toFixed(0)}/${r.fit.toFixed(0)})` };
    }
    if (!face && !hasBarcode) {
      // a portrait in the left part: decide its orientation by which fit looks like a face (dark eyes on brighter skin);
      // the face model can also "find" an upside-down face with an upright mesh, so both orientations are compared
      const a = this._face(c, 'left'), b = a ? this._face(c, 'leftRot') : this._face(c, 'leftRot');
      face = a && b ? (a.fit >= b.fit ? a : b) : (a || b);
      if (a && b) face = { ...face, dbg: `(${a.fit.toFixed(0)}/${b.fit.toFixed(0)})` };
    }
    f.face = face ? face.where + (face.dbg || '') : '-';
    const okPhoto = (b) => b && b.cx >= o.photoX[0] && b.cx <= o.photoX[1] && b.cy >= o.photoY[0] && b.cy <= o.photoY[1] && b.h >= o.photoH[0] && b.h <= o.photoH[1];
    if (face) {
      if (face.where === 'R') f.label = okPhoto(face) && chroma <= o.maxChroma ? 'front' : 'other';
      else if (face.where === 'U') f.label = okPhoto(face) && chroma <= o.maxChroma ? 'upFront' : 'other';
      else f.label = 'other';
    }
    else if (chroma > o.maxChroma) f.label = 'other';
    else if (bc.score >= o.barcodeMin && bc.score >= bcTop.score) f.label = 'back';
    else if (bcTop.score >= o.barcodeMin) f.label = 'upBack';
    else f.label = 'other';
    return f;
  }
  // Face search in part of the card. which: 'right' (x 0.45-1, upright crop), 'left' (x 0-0.55, upright crop),
  // 'leftRot' (x 0-0.55 rotated 180). Returns the face box in CARD coords of a card that is the right way up
  // (an upside-down card is mapped by 180 deg), whether the face is upright relative to the card's own
  // orientation, and where: 'R' photo right/upright, 'U' card upside down, 'left' photo on the left.
  _face(src, which) {
    const W = src.width, H = src.height, x0 = which.startsWith('right') ? 0.45 : 0, cw = 0.55, rot = which.endsWith('Rot');
    const outW = 256, outH = Math.round(outW * H / (W * cw));
    const c = this.crop; c.width = outW; c.height = outH;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.save();
    if (rot) { g.translate(outW, outH); g.rotate(Math.PI); }
    g.drawImage(src, W * x0, 0, W * cw, H, 0, 0, outW, outH);
    g.restore();
    let res;
    try { res = this.lmk.detect(c); } catch (e) { console.warn(e); return null; }
    const lm = res && res.faceLandmarks && res.faceLandmarks[0];
    if (!lm) return null;
    let xa = 1, xb = 0, ya = 1, yb = 0;
    for (const p of lm) { xa = Math.min(xa, p.x); xb = Math.max(xb, p.x); ya = Math.min(ya, p.y); yb = Math.max(yb, p.y); }
    const eyeY = (lm[33].y + lm[263].y) / 2, mouthY = lm[13].y;
    // fit quality: skin (forehead, nose bridge, cheeks) minus eyes (iris centres if present, else eye corners)
    const px = g.getImageData(0, 0, outW, outH).data;
    const L = (i) => { const p = lm[i]; if (!p) return NaN; const x = Math.max(0, Math.min(outW - 1, Math.round(p.x * outW))), y = Math.max(0, Math.min(outH - 1, Math.round(p.y * outH))); const k = (y * outW + x) * 4; return 0.299 * px[k] + 0.587 * px[k + 1] + 0.114 * px[k + 2]; };
    const avg = (ids) => { const v = ids.map(L).filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    const fit = avg([10, 151, 6, 50, 280]) - avg(lm.length > 473 ? [468, 473, 159, 386] : [159, 145, 386, 374]);
    const uprightInCrop = mouthY > eyeY; // note: the mesh tends to be fitted upright even on an upside-down face; `fit` decides
    // crop coords -> card coords (card frame as it appears in the deskewed image)
    let cx = x0 + cw * (rot ? 1 - (xa + xb) / 2 : (xa + xb) / 2), cy = rot ? 1 - (ya + yb) / 2 : (ya + yb) / 2;
    const uprightInCard = rot ? !uprightInCrop : uprightInCrop;
    const dbg = '';
    if (which === 'rightRot') return { cx, cy, h: yb - ya, upright: false, where: 'odd', dbg, fit };
    if (which === 'right') return { cx, cy, h: yb - ya, upright: uprightInCard, where: uprightInCard ? 'R' : 'odd', dbg, fit };
    // left part: upright face = photo on the left (other card); upside-down face = TW front held upside down
    if (uprightInCard) return { cx, cy, h: yb - ya, upright: true, where: 'left', dbg, fit };
    return { cx: 1 - cx, cy: 1 - cy, h: yb - ya, upright: true, where: 'U', dbg, fit };
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
