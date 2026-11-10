// Camera helper: getUserMedia, camera switching and display<->video coordinate mapping
// for a <video> shown with object-fit: cover (optionally mirrored for the front camera).

export class Camera {
  constructor(video, stage) { this.video = video; this.stage = stage; this.stream = null; this.facing = null; }

  async open(facing) {
    this.stop();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw Object.assign(new Error('此瀏覽器不支援相機（需 HTTPS 及 Safari／Chrome）'), { code: 'nosupport' });
    }
    const base = { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
    } catch (e) {
      if (e && (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError')) {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: false });
      } else throw e;
    }
    this.stream = stream; this.facing = facing;
    const v = this.video;
    v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.muted = true; v.autoplay = true;
    v.srcObject = stream;
    v.classList.toggle('mirror', facing === 'user');
    await new Promise((res) => { if (v.readyState >= 2 && v.videoWidth) res(); else v.onloadedmetadata = () => res(); });
    try { await v.play(); } catch (_) { /* iOS may need a tap; caller shows a button */ }
    // wait for real dimensions (Safari can report 0 for a moment)
    for (let i = 0; i < 50 && !v.videoWidth; i++) await new Promise(r => setTimeout(r, 50));
    return { width: v.videoWidth, height: v.videoHeight };
  }

  stop() {
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    if (this.video) this.video.srcObject = null;
  }

  get mirrored() { return this.facing === 'user'; }

  /** Parameters of the cover transform. */
  transform() {
    const cw = this.stage.clientWidth, ch = this.stage.clientHeight;
    const vw = this.video.videoWidth || 1, vh = this.video.videoHeight || 1;
    const s = Math.max(cw / vw, ch / vh);
    return { cw, ch, vw, vh, s, ox: (cw - vw * s) / 2, oy: (ch - vh * s) / 2 };
  }

  /** Display (stage CSS px) rect -> video pixel rect. Handles mirroring. */
  displayToVideo(r) {
    const t = this.transform();
    let x = r.x;
    if (this.mirrored) x = t.cw - (r.x + r.w);
    return { x: (x - t.ox) / t.s, y: (r.y - t.oy) / t.s, w: r.w / t.s, h: r.h / t.s };
  }

  /** Video pixel rect -> display rect. */
  videoToDisplay(r) {
    const t = this.transform();
    let x = r.x * t.s + t.ox;
    const w = r.w * t.s;
    if (this.mirrored) x = t.cw - (x + w);
    return { x, y: r.y * t.s + t.oy, w, h: r.h * t.s };
  }

  /** Copy a region of the current video frame (video px) into an ImageData of width outW. */
  sample(region, outW, canvas) {
    const v = this.video;
    const r = clampRect(region, v.videoWidth, v.videoHeight);
    const outH = Math.max(1, Math.round(outW * r.h / r.w));
    canvas.width = outW; canvas.height = outH;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, r.x, r.y, r.w, r.h, 0, 0, outW, outH);
    return { img: ctx.getImageData(0, 0, outW, outH), region: r, scale: outW / r.w };
  }

  /** Grab a JPEG of a region of the current frame at full resolution (never mirrored). */
  async grab(region, maxW = 1600, quality = 0.92) {
    const v = this.video;
    const r = clampRect(region || { x: 0, y: 0, w: v.videoWidth, h: v.videoHeight }, v.videoWidth, v.videoHeight);
    const scale = Math.min(1, maxW / r.w);
    const c = document.createElement('canvas');
    c.width = Math.round(r.w * scale); c.height = Math.round(r.h * scale);
    c.getContext('2d').drawImage(v, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', quality));
    c.width = c.height = 0;
    return blob;
  }
}

export function clampRect(r, W, H) {
  const x = Math.max(0, Math.min(W - 1, r.x)), y = Math.max(0, Math.min(H - 1, r.y));
  const x2 = Math.max(x + 1, Math.min(W, r.x + r.w)), y2 = Math.max(y + 1, Math.min(H, r.y + r.h));
  return { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
}
