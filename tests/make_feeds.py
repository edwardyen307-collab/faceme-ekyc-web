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
    if name in ('card', 'face'):  # webm copies for tests/e2e_fullflow.py
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
    card_feed()
    face_feed('face.jpg', 'face')
    face_feed('face-mask.jpg', 'face-mask')
    face_feed('face.jpg', 'face-offset', shift_x=150, n=30)   # face to the right of the raw frame
    face_feed('face.jpg', 'face-far', zoom=0.55, n=30)
