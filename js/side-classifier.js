// Front/back classifier for the Taiwan ID card: the FRONT carries a portrait photo, the BACK does not.
// Runs the (vendored) MediaPipe face model on crops of the detected card: right half (photo side), and the left
// half rotated 180 degrees (card held upside down). Votes are only taken on frames where the card is fully found,
// sharp and steady (otherwise "no face" means nothing), and the verdict must be stable over several frames.
import { loadImageLandmarker } from './face-checker.js?v=2026-11-11e';

export const SIDE_DEFAULTS = {
  intervalMs: 140,   // min time between face checks
  frontVotes: 2,     // FRONT: face seen in >= 2 of the last 3 checks
  backVotes: 4,      // BACK: no face in the last 4 checks
  resetGapMs: 450,   // card out of view this long (e.g. being flipped) -> forget the votes
  cropW: 256,
};

export class SideClassifier {
  constructor(opts = {}) { this.o = { ...SIDE_DEFAULTS, ...opts }; this.votes = []; this.last = 0; this.seen = 0; this.lmk = null; this.canvas = document.createElement('canvas'); this.failed = false; }
  async load() {
    try { this.lmk = await loadImageLandmarker(); } catch (e) { console.warn('side classifier unavailable', e); this.failed = true; }
    return !this.failed;
  }
  get ready() { return !!this.lmk; }
  /** card visible this frame? (used to forget votes when the card leaves the view) */
  tick(ts, cardVisible) {
    if (cardVisible) { if (this.seen && ts - this.seen > this.o.resetGapMs) this.votes = []; this.seen = ts; }
  }
  /** Run one face check on the card region (video px) if it is time. Returns true when a vote was taken. */
  observe(video, rect, ts) {
    if (!this.lmk || ts - this.last < this.o.intervalMs) return false;
    this.last = ts;
    let face = this._detect(video, rect, false);
    if (!face) face = this._detect(video, rect, true);
    this.votes.push(face ? 1 : 0); if (this.votes.length > 6) this.votes.shift();
    return true;
  }
  _detect(video, r, upsideDown) {
    // photo region of the TW ID front: right ~52% of the card (left half when the card is upside down)
    const x = upsideDown ? r.x : r.x + r.w * 0.48, w = r.w * 0.52;
    const outW = this.o.cropW, outH = Math.round(outW * r.h / w);
    const c = this.canvas; c.width = outW; c.height = outH;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.save();
    if (upsideDown) { g.translate(outW, outH); g.rotate(Math.PI); }
    g.drawImage(video, x, r.y, w, r.h, 0, 0, outW, outH);
    g.restore();
    try { const res = this.lmk.detect(c); return !!(res && res.faceLandmarks && res.faceLandmarks.length); }
    catch (e) { console.warn(e); return false; }
  }
  /** 'front' | 'back' | null (undecided) */
  verdict() {
    const v = this.votes, o = this.o;
    const last3 = v.slice(-3), last4 = v.slice(-o.backVotes);
    if (last3.length >= 2 && last3.reduce((a, b) => a + b, 0) >= o.frontVotes) return 'front';
    if (last4.length >= o.backVotes && last4.every(x => x === 0)) return 'back';
    return null;
  }
  get summary() { return this.votes.join(''); }
}
