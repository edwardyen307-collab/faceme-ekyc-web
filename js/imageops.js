// Small pixel helpers shared by the detectors (pure functions, no DOM).

/** RGBA ImageData -> Float32 grayscale (0..255). */
export function toGray(img) {
  const { data, width, height } = img;
  const g = new Float32Array(width * height);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    g[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return g;
}

/** Variance of the 4-neighbour Laplacian inside rect (x0,y0,x1,y1), integer coords. */
export function laplacianVariance(gray, width, height, x0, y0, x1, y1) {
  x0 = Math.max(1, x0 | 0); y0 = Math.max(1, y0 | 0);
  x1 = Math.min(width - 2, x1 | 0); y1 = Math.min(height - 2, y1 | 0);
  let n = 0, s = 0, s2 = 0;
  for (let y = y0; y <= y1; y++) {
    const r = y * width;
    for (let x = x0; x <= x1; x++) {
      const i = r + x;
      const v = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      s += v; s2 += v * v; n++;
    }
  }
  if (!n) return 0;
  const m = s / n;
  return s2 / n - m * m;
}

/** Mean luminance and fraction of near-white pixels inside rect. */
export function lumaStats(gray, width, height, x0, y0, x1, y1, whiteThr = 248) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(width - 1, x1 | 0); y1 = Math.min(height - 1, y1 | 0);
  let n = 0, s = 0, w = 0;
  for (let y = y0; y <= y1; y++) {
    const r = y * width;
    for (let x = x0; x <= x1; x++) {
      const v = gray[r + x];
      s += v; n++; if (v >= whiteThr) w++;
    }
  }
  return { mean: n ? s / n : 0, whiteFrac: n ? w / n : 0 };
}

/** Mean YCbCr in a square patch around (cx,cy) of half-size r (RGBA data). */
export function patchYCbCr(img, cx, cy, r) {
  const { data, width, height } = img;
  let n = 0, Y = 0, Cb = 0, Cr = 0;
  const x0 = Math.max(0, Math.round(cx - r)), x1 = Math.min(width - 1, Math.round(cx + r));
  const y0 = Math.max(0, Math.round(cy - r)), y1 = Math.min(height - 1, Math.round(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * width + x) * 4;
      const R = data[i], G = data[i + 1], B = data[i + 2];
      Y += 0.299 * R + 0.587 * G + 0.114 * B;
      Cb += 128 - 0.168736 * R - 0.331264 * G + 0.5 * B;
      Cr += 128 + 0.5 * R - 0.418688 * G - 0.081312 * B;
      n++;
    }
  }
  return n ? { Y: Y / n, Cb: Cb / n, Cr: Cr / n } : { Y: 0, Cb: 128, Cr: 128 };
}

/** Mean absolute difference between two equally sized gray buffers (subsampled). */
export function meanAbsDiff(a, b, step = 7) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i += step) { s += Math.abs(a[i] - b[i]); n++; }
  return s / n;
}

/** Median luminance and fraction of glare pixels (>= max(minThr, median + rel)) inside rect, subsampled.
 *  A pale card (e.g. the TW ID back) is bright everywhere; only pixels clearly brighter than the card itself count as glare. */
export function glareStats(gray, width, height, x0, y0, x1, y1, minThr = 250, rel = 14, step = 2) {
  x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
  x1 = Math.min(width - 1, x1 | 0); y1 = Math.min(height - 1, y1 | 0);
  const hist = new Uint32Array(256); let n = 0;
  for (let y = y0; y <= y1; y += step) { const r = y * width; for (let x = x0; x <= x1; x += step) { hist[Math.min(255, gray[r + x] | 0)]++; n++; } }
  if (!n) return { median: 0, glareFrac: 0, thr: 255 };
  let acc = 0, med = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n / 2) { med = v; break; } }
  const thr = Math.min(255, Math.max(minThr, med + rel));
  let g = 0; for (let v = thr; v < 256; v++) g += hist[v];
  return { median: med, glareFrac: g / n, thr };
}
