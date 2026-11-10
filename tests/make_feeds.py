"""Generate synthetic camera feeds (y4m) for Chromium fake-camera tests.
Usage: python make_feeds.py OUTDIR   (needs Pillow + ffmpeg)
All people/cards are synthetic test samples, not real persons/documents."""
import sys, os, random, subprocess, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ekyc-feeds'
os.makedirs(OUT, exist_ok=True)
W, H, FPS = 540, 960, 15
FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
if not os.path.exists(FONT):
    FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'

def font(sz):
    return ImageFont.truetype(FONT, sz)

def make_card():
    cw, ch = 856, 540
    card = Image.new('RGB', (cw, ch), (214, 228, 238))
    d = ImageDraw.Draw(card)
    for i in range(0, cw, 24):
        d.line([(i, 0), (i + 200, ch)], fill=(205, 220, 232), width=2)
    d.rectangle([0, 0, cw, 70], fill=(40, 90, 150))
    d.text((30, 12), '測試用身分證樣本 SAMPLE', font=font(38), fill='white')
    face = Image.open(os.path.join(HERE, 'feeds', 'face.jpg')).convert('RGB')
    face = face.crop((150, 80, 618, 704)).resize((230, 306))
    card.paste(face, (590, 150))
    d.rectangle([590, 150, 820, 456], outline=(60, 60, 60), width=3)
    rows = [('姓名', '王測試'), ('出生', '民國 70 年 1 月 1 日'), ('性別', '男'),
            ('發證', '民國 110 年 5 月 5 日'), ('統一編號', 'A123456789')]
    y = 110
    for k, v in rows:
        d.text((36, y), k, font=font(30), fill=(70, 70, 70))
        d.text((180, y), v, font=font(34), fill=(10, 10, 10))
        y += 70
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=36, fill=255)
    return card, mask

def background():
    random.seed(3)
    bg = Image.new('RGB', (W, H), (92, 70, 52))
    d = ImageDraw.Draw(bg)
    for i in range(0, H, 6):
        c = 80 + int(18 * math.sin(i / 23.0)) + random.randint(-6, 6)
        d.line([(0, i), (W, i + random.randint(-3, 3))], fill=(c + 14, c - 6, c - 24), width=6)
    return bg.filter(ImageFilter.GaussianBlur(1.2))

def write(frames, name):
    tmp = os.path.join(OUT, name + '_frames')
    os.makedirs(tmp, exist_ok=True)
    for i, f in enumerate(frames):
        f.save(os.path.join(tmp, '%04d.png' % i))
    out = os.path.join(OUT, name + '.y4m')
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i',
                    os.path.join(tmp, '%04d.png'), '-pix_fmt', 'yuv420p', out], check=True)
    print('wrote', out)
    if True:  # webm copies for tests/e2e_fullflow.py
        od = os.path.join(HERE, 'out'); os.makedirs(od, exist_ok=True)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i',
                        os.path.join(tmp, '%04d.png'), '-c:v', 'libvpx', '-b:v', '2M', os.path.join(od, name + '.webm')], check=True)

def card_feed():
    card, mask = make_card()
    bg = background()
    frames = []
    n_small, n_grow, n_hold = 30, 15, 60
    for i in range(n_small + n_grow + n_hold):
        if i < n_small:
            wpx = 240
        elif i < n_small + n_grow:
            t = (i - n_small) / n_grow
            wpx = int(240 + t * 210)
        else:
            wpx = 450
        hpx = int(wpx * 540 / 856)
        c = card.resize((wpx, hpx), Image.LANCZOS)
        m = mask.resize((wpx, hpx))
        f = bg.copy()
        cx, cy = W // 2, int(H * 0.42)
        f.paste(c, (cx - wpx // 2, cy - hpx // 2), m)
        frames.append(f)
    write(frames, 'card')

def place(bg, card, mask, wpx, cx, cy):
    hpx = int(wpx * 540 / 856)
    f = bg.copy()
    f.paste(card.resize((wpx, hpx), Image.LANCZOS), (cx - wpx // 2, cy - hpx // 2), mask.resize((wpx, hpx)))
    return f

def card_shaky_feed(amp=7, n=120):
    """Hand-held tremor: card jitters a few px every frame (plus an occasional bigger jerk)."""
    card, mask = make_card(); bg = background(); rnd = random.Random(7)
    frames = []
    for i in range(n):
        jx, jy = rnd.randint(-amp, amp), rnd.randint(-amp, amp)
        if i % 37 == 0: jx += 14
        frames.append(place(bg, card, mask, 450 + rnd.randint(-4, 4), W // 2 + jx, int(H * 0.42) + jy))
    write(frames, 'card-shaky')

def perspective_coeffs(src, dst):
    import numpy as np
    A = []; B = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float)).tolist()

def card_oblique(card, mask, wpx):
    """Card seen from the upper right (~25 deg): right edge nearer (taller), left edge shorter, slight rotation."""
    hpx = int(wpx * 540 / 856)
    c = card.resize((wpx, hpx), Image.LANCZOS); m = mask.resize((wpx, hpx))
    pad = 40; Wc, Hc = wpx + 2 * pad, hpx + 2 * pad
    src = [(0, 0), (wpx, 0), (wpx, hpx), (0, hpx)]
    shrink = 0.16 * hpx
    dst = [(pad + 0.06 * wpx, pad + shrink), (pad + wpx, pad - 0.02 * hpx), (pad + wpx * 0.98, pad + hpx + 0.04 * hpx), (pad + 0.04 * wpx, pad + hpx - shrink * 0.6)]
    co = perspective_coeffs(src, dst)
    return c.transform((Wc, Hc), Image.PERSPECTIVE, co, Image.BICUBIC), m.transform((Wc, Hc), Image.PERSPECTIVE, co, Image.BICUBIC)

def card_forgery_feed():
    """~7 s front (still) then ~5 s oblique from the upper right; loops in the test."""
    card, mask = make_card(); bg = background()
    frames = [place(bg, card, mask, 450, W // 2, int(H * 0.42)) for _ in range(105)]
    oc, om = card_oblique(card, mask, 430)
    for i in range(75):
        f = bg.copy(); f.paste(oc, (W // 2 - oc.width // 2, int(H * 0.42) - oc.height // 2), om); frames.append(f)
    write(frames, 'card-forgery')

def face_feed(src, name, shift_x=0, zoom=1.0, n=75):
    img = Image.open(os.path.join(HERE, 'feeds', src)).convert('RGB')
    if zoom != 1.0:  # zoom<1: face smaller (user too far) - pad with wall colour
        bg = Image.new('RGB', img.size, img.getpixel((10, 10)))
        sm = img.resize((int(img.width * zoom), int(img.height * zoom)), Image.LANCZOS)
        bg.paste(sm, ((img.width - sm.width) // 2, (img.height - sm.height) // 3))
        img = bg
    # cover-fit 768x1024 into 540x960
    s = max(W / img.width, H / img.height)
    big = img.resize((int(img.width * s), int(img.height * s)), Image.LANCZOS)
    frames = []
    for i in range(n):
        dx = int(30 * max(0, 1 - i / 10.0))  # small slide in first frames, then still
        x0 = max(0, min(big.width - W, (big.width - W) // 2 + dx - shift_x))
        y0 = (big.height - H) // 2 + int(H * 0.0)
        fr = Image.new('RGB', (W, H), big.getpixel((5, 5)))
        sx = (big.width - W) // 2 + dx - shift_x
        fr.paste(big, (-sx, -y0))
        frames.append(fr)
    write(frames, name)

if __name__ == '__main__':
    if len(sys.argv) > 2 and sys.argv[2] == 'new':
        card_shaky_feed(); card_forgery_feed(); sys.exit()
    card_feed()
    card_shaky_feed()
    card_forgery_feed()
    face_feed('face.jpg', 'face')
    face_feed('face-mask.jpg', 'face-mask')
    face_feed('face.jpg', 'face-offset', shift_x=150, n=30)   # face to the right of the raw frame
    face_feed('face.jpg', 'face-far', zoom=0.55, n=30)
