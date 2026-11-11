"""Generate synthetic camera feeds (y4m) for Chromium fake-camera tests.
Usage: python make_feeds.py OUTDIR   (needs Pillow + ffmpeg)
All people/cards are synthetic test samples, not real persons/documents."""
import sys, os, random, subprocess, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
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

def make_card_back():
    """11h: the back feeds use the specimen-like TW ID back (tests/make_twid.py, real layout, no real data)."""
    from make_twid import make_twid_back, laminate
    c, m = make_twid_back()
    return laminate(c, m, Image.new('RGB', (8, 8), (150, 120, 90))), m   # clear laminate border shows the desk

def make_card_back_old():
    """(pre-11h) Synthetic ID back: different layout (address rows, barcode) so it differs from the front."""
    cw, ch = 856, 540
    card = Image.new('RGB', (cw, ch), (232, 226, 210))
    d = ImageDraw.Draw(card)
    for i in range(0, ch, 18):
        d.line([(0, i), (cw, i + 40)], fill=(224, 216, 198), width=2)
    d.text((30, 20), '測試用背面樣本 SAMPLE BACK', font=font(34), fill=(90, 60, 30))
    rows = [('父', '王測一'), ('母', '李測二'), ('配偶', '—'), ('出生地', '測試市'), ('住址', '測試市測試區範例路 1 號')]
    y = 90
    for k, v in rows:
        d.text((36, y), k, font=font(28), fill=(80, 80, 80))
        d.text((160, y), v, font=font(32), fill=(10, 10, 10))
        y += 62
    rnd = random.Random(5); x = 40
    while x < cw - 60:
        wbar = rnd.choice([3, 5, 8]); d.rectangle([x, 430, x + wbar, 510], fill=(0, 0, 0)); x += wbar + rnd.choice([3, 4, 6])
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=36, fill=255)
    return card, mask

def make_card_back_real():
    """11h: specimen-like TW ID back, slightly washed out (light-table / glare look)."""
    from make_twid import make_twid_back, laminate
    from PIL import ImageEnhance
    c, m = make_twid_back(serial='0000654321', seed=9)
    c = laminate(ImageEnhance.Contrast(c).enhance(0.8), m, Image.new('RGB', (8, 8), (200, 200, 196)))
    return c, m

def make_card_twid_front():
    """Specimen-like TW ID front (real layout; synthetic face from tests/feeds/face.jpg)."""
    from make_twid import make_twid_front, laminate
    c, m = make_twid_front()
    return laminate(c, m, Image.new('RGB', (8, 8), (150, 120, 90))), m

def make_card_back_real_old():
    """(pre-11h) Closer to a real TW ID back: pale, low-contrast print (fine guilloche, thin small text, barcode), no portrait."""
    cw, ch = 856, 540
    card = Image.new('RGB', (cw, ch), (236, 239, 230))
    d = ImageDraw.Draw(card)
    for i in range(-ch, cw, 9):
        d.line([(i, 0), (i + ch, ch)], fill=(228, 233, 222), width=1)
        d.line([(i + ch, 0), (i, ch)], fill=(230, 234, 224), width=1)
    rows = [('父', '王測一'), ('母', '李測二'), ('配偶', ''), ('役別', ''), ('出生地', '測試市'), ('住址', '測試市測試區範例里 1 鄰範例路 1 號')]
    y = 40
    for k, v in rows:
        d.text((40, y), k, font=font(24), fill=(120, 120, 115))
        d.text((150, y), v, font=font(26), fill=(70, 70, 70))
        y += 52
    rnd = random.Random(9); x = 470
    while x < cw - 50:
        wbar = rnd.choice([2, 3, 5]); d.rectangle([x, 440, x + wbar, 500], fill=(40, 40, 40)); x += wbar + rnd.choice([2, 3, 5])
    d.text((470, 505), '0123456789', font=font(20), fill=(90, 90, 90))
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=36, fill=255)
    return card, mask

def light_table():
    random.seed(4)
    bg = Image.new('RGB', (W, H), (178, 178, 172))
    px = bg.load()
    for yy in range(0, H, 2):
        for xx in range(0, W, 2):
            v = 178 + random.randint(-6, 6)
            for a in (0, 1):
                for b2 in (0, 1):
                    if xx + a < W and yy + b2 < H: px[xx + a, yy + b2] = (v, v, v - 6)
    return bg.filter(ImageFilter.GaussianBlur(0.8))

def exposure(img, gain=1.07, blur=0.7):
    from PIL import ImageEnhance
    return ImageEnhance.Brightness(img.filter(ImageFilter.GaussianBlur(blur))).enhance(gain)

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

def card_oblique(card, mask, wpx, k=1.0):
    """Card seen from the upper right (~25 deg): right edge nearer (taller), left edge shorter, slight rotation."""
    hpx = int(wpx * 540 / 856)
    c = card.resize((wpx, hpx), Image.LANCZOS); m = mask.resize((wpx, hpx))
    pad = 40; Wc, Hc = wpx + 2 * pad, hpx + 2 * pad
    src = [(0, 0), (wpx, 0), (wpx, hpx), (0, hpx)]
    shrink = 0.16 * hpx * k
    dst = [(pad + 0.06 * wpx * k, pad + shrink), (pad + wpx, pad - 0.02 * hpx * k), (pad + wpx * (1 - 0.02 * k), pad + hpx + 0.04 * hpx * k), (pad + 0.04 * wpx * k, pad + hpx - shrink * 0.6)]
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

def phase_feeds():
    """Still feeds per capture phase (the full-flow test switches feeds by app phase)."""
    bg = background(); cy = int(H * 0.42)
    for (card, mask), nm in ((make_card(), 'card-front'), (make_card_back(), 'card-back')):
        write([place(bg, card, mask, 450, W // 2, cy) for _ in range(30)], nm)
        oc, om = card_oblique(card, mask, 430)
        fr = []
        for _ in range(30):
            f = bg.copy(); f.paste(oc, (W // 2 - oc.width // 2, cy - oc.height // 2), om); fr.append(f)
        write(fr, nm + '-oblique')
    # front card held slightly rotated and far away (two problems at once -> one merged hint)
    card, mask = make_card(); fr = []
    c = card.resize((300, int(300 * 540 / 856)), Image.LANCZOS).convert('RGBA'); m = mask.resize(c.size)
    c.putalpha(m); c = c.rotate(14, expand=True, resample=Image.BICUBIC)
    for _ in range(30):
        f = bg.copy(); f.paste(c, (W // 2 - c.width // 2, cy - c.height // 2), c); fr.append(f)
    write(fr, 'card-far-rotated')

def real_feeds():
    """Back on a light table (low contrast, slightly soft, bright exposure) and tilted variants."""
    cy = int(H * 0.42)
    lt = light_table(); bg = background()
    cb, mb = make_card_back_real()
    rnd = random.Random(11)
    fr = []
    for i in range(45):
        f = place(lt, cb, mb, 450 + rnd.randint(-2, 2), W // 2 + rnd.randint(-3, 3), cy + rnd.randint(-3, 3))
        fr.append(exposure(f))
    write(fr, 'card-back-real')
    fr = [exposure(place(bg, cb, mb, 450, W // 2, cy)) for _ in range(30)]
    write(fr, 'card-back-real-wood')
    # perspective views for the tilt tests (strong = from the upper right, mild = almost flat, left = wrong side)
    card, mask = make_card()
    for nm, k, flip in (('card-tilt-strong', 1.0, False), ('card-tilt-mild', 0.25, False), ('card-tilt-left', 1.0, True)):
        if flip:  # mirror the geometry, not the print
            M = Image.FLIP_LEFT_RIGHT
            oc, om = card_oblique(card.transpose(M), mask.transpose(M), 430, k)
            oc = oc.transpose(M); om = om.transpose(M)
        else:
            oc, om = card_oblique(card, mask, 430, k)
        fr = []
        for _ in range(30):
            f = bg.copy(); f.paste(oc, (W // 2 - oc.width // 2, cy - oc.height // 2), om); fr.append(f)
        write(fr, nm)
    oc, om = card_oblique(cb, mb, 430, 1.0)
    fr = []
    for _ in range(30):
        f = bg.copy(); f.paste(oc, (W // 2 - oc.width // 2, cy - oc.height // 2), om); fr.append(exposure(f))
    write(fr, 'card-back-real-tilt')

def place_rot(bg, card, mask, wpx, cx, cy, angle=0.0, jitter=None):
    hpx = int(wpx * 540 / 856)
    c = card.resize((wpx, hpx), Image.LANCZOS).convert('RGBA'); c.putalpha(mask.resize((wpx, hpx)))
    if angle: c = c.rotate(angle, expand=True, resample=Image.BICUBIC)
    f = bg.copy(); f.paste(c, (int(cx - c.width / 2), int(cy - c.height / 2)), c)
    return f

def make_bank_card():
    """Non-ID card: colourful bank-card-like design (chip, big digits, logo), no portrait, no barcode."""
    cw, ch = 856, 540
    card = Image.new('RGB', (cw, ch))
    d = ImageDraw.Draw(card)
    for x in range(cw):
        t = x / cw; d.line([(x, 0), (x, ch)], fill=(int(30 + 120 * t), int(40 + 30 * t), int(170 - 60 * t)))
    d.ellipse([560, -120, 980, 300], fill=(210, 80, 140))
    d.rounded_rectangle([80, 190, 200, 280], radius=14, fill=(214, 180, 90))
    d.text((60, 40), '測試銀行 SAMPLE BANK', font=font(40), fill='white')
    d.text((80, 320), '1234  5678  9012  3456', font=font(52), fill=(240, 240, 240))
    d.text((80, 430), 'TEST CARDHOLDER   12/30', font=font(34), fill=(230, 230, 230))
    d.ellipse([650, 400, 740, 490], fill=(235, 60, 50)); d.ellipse([700, 400, 790, 490], fill=(250, 170, 40))
    mask = Image.new('L', (cw, ch), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, cw - 1, ch - 1], radius=36, fill=255)
    return card, mask

def make_card_photo_left():
    """Other ID-like card with the portrait on the LEFT (e.g. some licences / other countries' IDs)."""
    card, mask = make_card()
    c2 = Image.new('RGB', card.size, (226, 236, 220)); d = ImageDraw.Draw(c2)
    d.rectangle([0, 0, 856, 70], fill=(30, 120, 80)); d.text((30, 12), '其他證件樣本 OTHER CARD', font=font(38), fill='white')
    face = card.crop((590, 150, 820, 456)); c2.paste(face, (36, 150))
    y = 120
    for k, v in (('姓名', '王測試'), ('號碼', 'Z99-000-111'), ('有效', '2030-01-01')):
        d.text((320, y), k, font=font(30), fill=(70, 70, 70)); d.text((440, y), v, font=font(34), fill=(10, 10, 10)); y += 80
    return c2, mask

def track_feeds():
    """Auto-tracking (自動追拍) feeds: card anywhere in the frame, rotated, small, moving."""
    bg = background(); front = make_card(); back = make_card_back_real()
    fr = []
    for i in range(220):
        if i < 25: t = 0.0
        elif i < 70: t = (i - 25) / 45.0
        else: t = 1.0
        t = t * t * (3 - 2 * t)
        wpx = int(220 + t * 220); cx = 150 + t * (W / 2 + 10 - 150); cy = 260 + t * (H * 0.45 - 260); ang = 10 - 6 * t
        fr.append(place_rot(bg, *front, wpx, cx, cy, ang))
    write(fr, 'card-track-move')
    write([place_rot(bg, *front, 230, 160, 280, 8) for _ in range(30)], 'card-track-small')
    write([exposure(place_rot(bg, *back, 440, W / 2 - 15, H * 0.5, -5)) for _ in range(30)], 'card-track-back')
    write([place_rot(bg, *front, 440, W / 2 - 15, H * 0.5, -5) for _ in range(30)], 'card-track-front')
    oc, om = card_oblique(*front, 430, 1.0)
    fr = []
    for _ in range(30):
        f = bg.copy(); f.paste(oc, (int(W / 2 + 25 - oc.width / 2), int(H * 0.5 - oc.height / 2)), om); fr.append(f)
    write(fr, 'card-track-tilt')
    cy = int(H * 0.42)
    write([place(bg, *make_bank_card(), 450, W // 2, cy) for _ in range(30)], 'card-bank')
    write([place(bg, *make_card_photo_left(), 450, W // 2, cy) for _ in range(30)], 'card-photo-left')
    write([place_rot(bg, *front, 450, W // 2, cy, 180) for _ in range(30)], 'card-upside-down')
    write([place_rot(bg, *make_card_photo_left(), 440, W / 2 - 10, H * 0.47, -4) for _ in range(30)], 'card-track-photo-left')
    write([place_rot(bg, *make_bank_card(), 440, W / 2 + 10, H * 0.48, 4) for _ in range(30)], 'card-track-bank')

def low_contrast_bg():
    """Light grey desk / tablecloth: low edge contrast against the pale card (luma difference ~25-30)."""
    bg = Image.new('RGB', (W, H), (196, 194, 190)); d = ImageDraw.Draw(bg); rnd = random.Random(21)
    for i in range(0, H, 9):
        c = 194 + rnd.randint(-3, 3); d.line([(0, i), (W, i + rnd.randint(-2, 2))], fill=(c + 2, c, c - 4), width=5)
    return bg.filter(ImageFilter.GaussianBlur(1.5))

def tint(img, kind):
    if kind == 'warm': r, g, b = img.split(); return Image.merge('RGB', (r.point(lambda v: min(255, int(v * 1.06))), g, b.point(lambda v: int(v * 0.86))))
    if kind == 'cool': r, g, b = img.split(); return Image.merge('RGB', (r.point(lambda v: int(v * 0.9)), g, b.point(lambda v: min(255, int(v * 1.06)))))
    return img

def jitter_feed(name, card, mask, bg, wfrac, amp, rot, finger=None, kind='', n=75, seed=3):
    """Hand-held card: smooth hand shake (+-amp of the frame width, two frequencies), small rotation, optional finger
    over one edge, motion blur on the faster frames, colour cast."""
    rnd = random.Random(seed); ph = [rnd.uniform(0, 6.28) for _ in range(6)]
    wpx = int(W * wfrac); hpx = int(wpx * 540 / 856); fr = []
    for i in range(n):
        t = i / FPS
        sx = 0.6 * math.sin(2 * math.pi * 1.4 * t + ph[0]) + 0.4 * math.sin(2 * math.pi * 3.3 * t + ph[1])
        sy = 0.6 * math.sin(2 * math.pi * 1.1 * t + ph[2]) + 0.4 * math.sin(2 * math.pi * 2.9 * t + ph[3])
        sa = math.sin(2 * math.pi * 0.9 * t + ph[4])
        cx = W / 2 + sx * amp * W; cy = H * 0.45 + sy * amp * W; ang = sa * rot
        c = card.resize((wpx, hpx), Image.LANCZOS).convert('RGBA'); c.putalpha(mask.resize((wpx, hpx)))
        if finger:   # skin-coloured thumb over one edge, moving with the card
            dd = ImageDraw.Draw(c)
            if finger == 'bottom': box = [int(wpx * 0.30), int(hpx * 0.86), int(wpx * 0.46), hpx + 40]
            else: box = [-40, int(hpx * 0.40), int(wpx * 0.12), int(hpx * 0.62)]
            dd.rounded_rectangle(box, radius=int(wpx * 0.06), fill=(222, 170, 140, 255))
        c = c.rotate(ang, expand=True, resample=Image.BICUBIC)
        f = bg.copy()
        if finger:   # the rest of the hand beyond the card edge
            d2 = ImageDraw.Draw(f)
            if finger == 'bottom': d2.rounded_rectangle([int(cx - wpx * 0.2), int(cy + hpx * 0.45), int(cx - wpx * 0.04), H + 50], radius=30, fill=(214, 162, 132))
            else: d2.rounded_rectangle([-50, int(cy - hpx * 0.1), int(cx - wpx * 0.45), int(cy + hpx * 0.12)], radius=30, fill=(214, 162, 132))
        f.paste(c, (int(cx - c.width / 2), int(cy - c.height / 2)), c)
        if finger:   # re-draw the thumb tip over the card (it is ON the card)
            pass
        speed = abs(math.cos(2 * math.pi * 1.4 * t + ph[0])) * amp * 1.4 * 2 * math.pi / FPS
        if speed > 0.012: f = f.filter(ImageFilter.GaussianBlur(0.7))
        fr.append(exposure(tint(f, kind), gain=1.03, blur=0.5))
    write(fr, name)

def jitter_feeds():
    """11h hand-shake feeds for the auto-tracking lock / hold tests (specimen-like TW ID, 55-70% of the frame width)."""
    from make_twid import make_twid_back, make_twid_front, laminate
    bg, lc = background(), low_contrast_bg()
    def lam(fnc, b):
        c, m = fnc(); return laminate(c, m, b.crop((100, 300, 440, 520))), m
    jitter_feed('card-jitter-back', *lam(make_twid_back, bg), bg, 0.66, 0.04, 2.0, seed=3)
    jitter_feed('card-jitter-back-lowc', *lam(make_twid_back, lc), lc, 0.56, 0.035, 1.5, finger='bottom', kind='warm', seed=4)
    jitter_feed('card-jitter-front', *lam(make_twid_front, bg), bg, 0.64, 0.05, 2.0, finger='left', seed=5)
    jitter_feed('card-jitter-front-lowc', *lam(make_twid_front, lc), lc, 0.6, 0.03, 1.5, finger='bottom', kind='cool', seed=6)
    # still, realistic specimen-like cards for the fixed-guide mode (laminate, ~83% of the frame width like the guide)
    cy = int(H * 0.42)
    write([exposure(tint(place(bg, *lam(make_twid_back, bg), 450, W // 2, cy), 'warm')) for _ in range(30)], 'card-twid-back')
    write([exposure(place(bg, *lam(make_twid_front, bg), 450, W // 2, cy)) for _ in range(30)], 'card-twid-front')

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
        real_feeds(); face_feed('face-profile.jpg', 'face-profile', n=30); sys.exit()
    if len(sys.argv) > 2 and sys.argv[2] == 'jitter':
        jitter_feeds(); sys.exit()
    if len(sys.argv) > 2 and sys.argv[2] == 'track':
        track_feeds(); sys.exit()
    if len(sys.argv) > 2 and sys.argv[2] == 'new0':
        phase_feeds(); face_feed('face.jpg', 'face-far-offset', shift_x=60, zoom=0.55, n=30); sys.exit()
    card_feed()
    card_shaky_feed()
    card_forgery_feed()
    phase_feeds()
    real_feeds()
    track_feeds()
    jitter_feeds()
    face_feed('face.jpg', 'face')
    face_feed('face-mask.jpg', 'face-mask')
    face_feed('face.jpg', 'face-offset', shift_x=150, n=30)   # face to the right of the raw frame
    face_feed('face.jpg', 'face-far', zoom=0.55, n=30)
    face_feed('face.jpg', 'face-far-offset', shift_x=60, zoom=0.55, n=30)  # two problems at once -> one merged hint
    face_feed('face-profile.jpg', 'face-profile', n=30)       # synthetic person, head turned ~35 deg -> 側臉 hint
