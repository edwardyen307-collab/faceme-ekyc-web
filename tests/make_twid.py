"""Specimen-like synthetic Taiwan ID card (2005 design) for tests — layout modelled on the public MOI specimen
(內政部戶政司「國民身分證真偽辨識資料」 sample images). Fictional data only, marked 樣本/SAMPLE; not a real document.
Card = 856 x 540 px laminate (85.7 x 54 mm); the printed paper card (79.7 x 48 mm) sits inside a ~3 mm clear border.
  back : pale lavender / orange-yellow gradient with a faint orchid pattern; 4 bands separated by thin pink ruling lines
         (父 母 / 配偶 役別 / 出生地 / 住址 2 lines), labels at the left; a 1-D barcode bottom-LEFT (~x 0.08-0.52,
         y 0.74-0.85); gold MOI emblem and a green 10-digit serial number bottom-right.
  front: flag top-left, title, portrait right (x 0.66-0.95, y 0.10-0.66), labels 姓名/出生年月日/發證日期 at the left,
         性別 under the photo, red ID number bottom-right."""
import os, math, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__))
FONT = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc'
if not os.path.exists(FONT): FONT = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
SANS = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
CW, CH = 856, 540
PX0, PY0, PX1, PY1 = 30, 30, 826, 510   # paper area inside the clear laminate border

def f(sz, sans=False): return ImageFont.truetype(SANS if sans else FONT, sz)

def _paper(front):
    p = Image.new('RGB', (PX1 - PX0, PY1 - PY0))
    d = ImageDraw.Draw(p); w, h = p.size
    for x in range(w):
        t = x / w
        if front:   # light purple -> light brown
            c = (int(232 + 8 * t), int(228 - 4 * t), int(240 - 22 * t))
        else:       # orange-yellow -> light purple -> orange-yellow
            k = abs(t - 0.5) * 2
            c = (int(236 + 8 * k), int(228 + 2 * k), int(238 - 30 * k))
        d.line([(x, 0), (x, h)], fill=c)
    # fine guilloche + relief pattern (Taiwan relief on the front, orchid on the back): faint thin curves
    rnd = random.Random(11 if front else 12)
    cx, cy = (w * 0.45, h * 0.5) if front else (w * 0.5, h * 0.42)
    for r in range(20, 260, 7):
        d.arc([cx - r * 1.4, cy - r, cx + r * 1.4, cy + r], rnd.randint(0, 90), rnd.randint(200, 340), fill=(222, 208, 224) if not front else (225, 220, 205), width=1)
    for i in range(-h, w, 11):
        d.line([(i, 0), (i + h, h)], fill=tuple(v - 5 for v in p.getpixel((min(w - 1, max(0, i + h // 2)), h // 2))), width=1)
    return p

def make_twid_back(serial='0000123456', seed=5):
    card = Image.new('RGB', (CW, CH), (0, 0, 0)); paper = _paper(False); d = ImageDraw.Draw(paper)
    ox, oy = PX0, PY0
    line = (214, 120, 140)
    for y in (125, 192, 258, 352):          # pink ruling lines (card px)
        d.line([(0, y - oy), (paper.width, y - oy)], fill=line, width=2)
    lab, val = (70, 60, 60), (25, 25, 25)
    def T(x, y, s, sz, col, fn=f): d.text((x - ox, y - oy), s, font=fn(sz), fill=col)
    T(62, 72, '父', 26, lab); T(185, 64, '王測一', 34, val); T(410, 66, '母', 26, lab); T(470, 64, '李測二', 34, val)
    T(62, 140, '配 偶', 26, lab); T(185, 134, '陳樣本', 34, val); T(410, 138, '役 別', 26, lab)
    T(62, 207, '出生地', 26, lab); T(185, 200, '臺北市', 34, val)
    T(62, 290, '住 址', 26, lab); T(185, 270, '臺北市測試區範例里1鄰', 28, val); T(185, 308, '範例路一段123巷45號', 28, val)
    # barcode bottom-left (Code-39-like: thin/wide bars)
    rnd = random.Random(seed); x = 66
    while x < 440:
        wb = rnd.choice([3, 3, 7]); d.rectangle([x - ox, 398 - oy, x + wb - ox, 458 - oy], fill=(20, 20, 20)); x += wb + rnd.choice([3, 3, 7])
    # gold MOI emblem (stylised) + green serial number bottom-right
    ex, ey = 700, 410
    d.ellipse([ex - 34 - ox, ey - 40 - oy, ex + 34 - ox, ey + 34 - oy], outline=(150, 120, 60), width=9)
    d.ellipse([ex - 14 - ox, ey - 52 - oy, ex + 14 - ox, ey - 26 - oy], fill=(150, 120, 60))
    T(540, 458, serial, 34, (120, 190, 60), lambda s: f(s, True))
    card.paste(paper.filter(ImageFilter.GaussianBlur(0.4)), (PX0, PY0))
    return card, _mask()

def make_twid_front():
    card = Image.new('RGB', (CW, CH), (0, 0, 0)); paper = _paper(True); d = ImageDraw.Draw(paper)
    ox, oy = PX0, PY0
    def T(x, y, s, sz, col): d.text((x - ox, y - oy), s, font=f(sz), fill=col)
    # flag
    d.rectangle([52 - ox, 68 - oy, 172 - ox, 148 - oy], fill=(200, 30, 40)); d.rectangle([52 - ox, 68 - oy, 112 - ox, 108 - oy], fill=(20, 40, 140))
    d.ellipse([70 - ox, 76 - oy, 94 - ox, 100 - oy], fill='white')
    T(185, 84, '中華民國國民身分證', 38, (30, 30, 30))
    d.rectangle([300 - ox, 76 - oy, 352 - ox, 128 - oy], outline=(220, 90, 90), width=3)
    T(210, 160, '樣本', 40, (215, 70, 70)); T(420, 160, 'SAMPLE', 30, (215, 70, 70))
    face = Image.open(os.path.join(HERE, 'feeds', 'face.jpg')).convert('RGB').crop((150, 70, 618, 720)).resize((238, 292))
    paper.paste(face, (552 - ox, 56 - oy))
    lab, val = (70, 70, 70), (20, 20, 20)
    T(50, 258, '姓 名', 26, lab); T(150, 248, '王  測  試', 40, val)
    d.line([(40 - ox, 318 - oy), (520 - ox, 318 - oy)], fill=(170, 170, 175), width=1)
    T(50, 334, '出 生', 24, lab); T(50, 364, '年月日', 24, lab); T(150, 346, '民國 70 年 1 月 1 日', 30, val)
    d.line([(40 - ox, 405 - oy), (520 - ox, 405 - oy)], fill=(170, 170, 175), width=1)
    T(50, 428, '發證日期', 24, lab); T(150, 424, '民國 110年 5月 5日(北市)換發', 26, val)
    T(600, 362, '性別', 22, lab); T(680, 356, '男', 30, val)
    T(548, 400, '統一編號', 18, (200, 60, 60)); T(548, 424, 'A123456789', 38, (200, 40, 40))
    card.paste(paper.filter(ImageFilter.GaussianBlur(0.4)), (PX0, PY0))
    return card, _mask()

def _mask():
    m = Image.new('L', (CW, CH), 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, CW - 1, CH - 1], radius=36, fill=255); return m

def laminate(card, mask, bg_crop):
    """Clear laminate border: the background shows through (slightly lightened) outside the paper area."""
    c = card.copy(); b = bg_crop.resize(card.size)
    lam = Image.blend(b, Image.new('RGB', card.size, (255, 255, 255)), 0.12)
    inner = Image.new('L', card.size, 0); ImageDraw.Draw(inner).rectangle([PX0, PY0, PX1 - 1, PY1 - 1], fill=255)
    lam.paste(c, (0, 0), inner)
    return lam

if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp'
    for n, fn in (('twid-back', make_twid_back), ('twid-front', make_twid_front)):
        c, m = fn(); flat = laminate(c, m, Image.new('RGB', (10, 10), (120, 100, 80))); flat.save(os.path.join(out, n + '.png'))
