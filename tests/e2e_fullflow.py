"""Full flow in ONE session: rear camera gets the card video, front camera gets the face video.
getUserMedia is replaced (test only) by a <video>.captureStream() chosen by facingMode.
python tests/e2e_fullflow.py BASE_URL SHOT_PREFIX   (needs tests/out/card.webm, face.webm)"""
import sys, json, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; SHOT = sys.argv[2]
INIT = """
(() => {
  const pick = (c) => { const f = c && c.video && c.video.facingMode; const v = f && (f.ideal || f.exact || f); return v === 'user' ? 'face' : 'card'; };
  navigator.mediaDevices.getUserMedia = async (c) => {
    const v = document.createElement('video');
    v.src = '/tests/out/' + pick(c) + '.webm'; v.muted = true; v.loop = true; v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px';
    document.body.appendChild(v); await v.play();
    const s = v.captureStream();
    const stop = s.getTracks()[0].stop.bind(s.getTracks()[0]);
    s.getTracks()[0].stop = () => { stop(); v.pause(); v.remove(); };
    return s;
  };
})();
"""
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/google/chrome/chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    page = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    page.add_init_script(INIT)
    page.on('pageerror', lambda e: print('[pageerror]', e))
    page.goto(BASE + '?manualAfter=60000')
    page.click('#btn-start')
    t0 = time.time()
    while time.time() - t0 < 60 and page.evaluate("window.__ekyc.state.step") != 'review':
        time.sleep(0.3)
    time.sleep(0.6)
    ev = page.evaluate('window.__ekyc.events')
    res['captures'] = [e for e in ev if 'captured' in e]
    res['cameras'] = [e for e in ev if 'camera' in e]
    res['reached_review'] = page.evaluate("window.__ekyc.state.step") == 'review'
    page.screenshot(path=SHOT + '8-review-fullflow.png')
    page.click('#btn-upload'); time.sleep(1.8)
    res['upload'] = page.inner_text('#upload-result')
    page.screenshot(path=SHOT + '9-uploaded-fullflow.png')
    b.close()
print(json.dumps(res, ensure_ascii=False, indent=1))
