// Perspective helpers: homography, quad -> rectangle warp (deskew) on ImageData / video frames / Blobs.
// Pure JS (no dependencies). Used for the deskewed card crop (display / OCR) and the front/back classifier.

/** 3x3 homography H (row-major, h33 = 1) mapping src[i] -> dst[i] for 4 point pairs. */
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i], { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/**
 * Warp the quad (TL, TR, BR, BL in src pixel coords) of an RGBA ImageData into an outW x outH rectangle.
 * Bilinear sampling; returns ImageData.
 */
export function warpQuad(src, quad, outW, outH) {
  outW = Math.max(2, Math.round(outW)); outH = Math.max(2, Math.round(outH));
  const H = homography([{ x: 0, y: 0 }, { x: outW - 1, y: 0 }, { x: outW - 1, y: outH - 1 }, { x: 0, y: outH - 1 }], quad);
  const out = new ImageData(outW, outH);
  if (!H) return out;
  const sw = src.width, sh = src.height, s = src.data, d = out.data;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = H[6] * x + H[7] * y + 1;
      const fx = (H[0] * x + H[1] * y + H[2]) / w, fy = (H[3] * x + H[4] * y + H[5]) / w;
      const o = (y * outW + x) * 4;
      if (fx < 0 || fy < 0 || fx > sw - 1 || fy > sh - 1) { d[o + 3] = 255; continue; }
      const x0 = fx | 0, y0 = fy | 0, x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1);
      const ax = fx - x0, ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = (y0 * sw + x1) * 4, i01 = (y1 * sw + x0) * 4, i11 = (y1 * sw + x1) * 4;
      for (let c = 0; c < 3; c++) {
        const top = s[i00 + c] + (s[i10 + c] - s[i00 + c]) * ax, bot = s[i01 + c] + (s[i11 + c] - s[i01 + c]) * ax;
        d[o + c] = top + (bot - top) * ay;
      }
      d[o + 3] = 255;
    }
  }
  return out;
}

const bboxOf = (q) => { const xs = q.map(p => p.x), ys = q.map(p => p.y); return { x: Math.min(...xs), y: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) }; };

/**
 * Deskew a quad from any drawable (video / ImageBitmap / canvas) of size srcW x srcH.
 * Draws only the quad's bounding box, scaled so the result has about outW px of source detail.
 */
export function deskewDrawable(drawable, srcW, srcH, quad, outW, aspect, canvas) {
  const b = bboxOf(quad);
  const x = Math.max(0, Math.floor(b.x - 2)), y = Math.max(0, Math.floor(b.y - 2));
  const x2 = Math.min(srcW, Math.ceil(b.x2 + 2)), y2 = Math.min(srcH, Math.ceil(b.y2 + 2));
  const bw = Math.max(2, x2 - x), bh = Math.max(2, y2 - y);
  const s = Math.min(1, (outW * 1.15) / bw);
  const c = canvas || document.createElement('canvas');
  c.width = Math.max(2, Math.round(bw * s)); c.height = Math.max(2, Math.round(bh * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(drawable, x, y, bw, bh, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height);
  const q = quad.map(p => ({ x: (p.x - x) * s, y: (p.y - y) * s }));
  return warpQuad(img, q, outW, outW / aspect);
}

/** ImageData -> JPEG Blob */
export async function imageDataToJpeg(img, quality = 0.92) {
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
  c.width = c.height = 0;
  return blob;
}

/** Decode a JPEG Blob crop and deskew the quad given in that crop's pixel coords. */
export async function deskewBlob(blob, quad, outW, aspect) {
  const bmp = await createImageBitmap(blob);
  try { return await imageDataToJpeg(deskewDrawable(bmp, bmp.width, bmp.height, quad, outW, aspect)); }
  finally { bmp.close && bmp.close(); }
}
