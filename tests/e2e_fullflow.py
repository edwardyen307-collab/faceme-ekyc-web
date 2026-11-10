"""Full flow in ONE session: rear camera gets the card video, front camera gets the face video.
getUserMedia is replaced (test only) by a <video>.captureStream() chosen by facingMode.
python tests/e2e_fullflow.py BASE_URL SHOT_PREFIX [REAL_BASE_URL] [CARD_TYPE]
  (needs tests/out/card.webm, face.webm from make_feeds.py; REAL_BASE_URL = proxy for real-mode test)"""
import sys, json, time, os
from playwright.sync_api import sync_playwright
BASE = sys.argv[1]; SHOT = sys.argv[2]
REAL = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != '-' else None
CTYPE = sys.argv[4] if len(sys.argv) > 4 else None
EXTRA = json.loads(os.environ.get('EKYC_CFG', '{}'))
QUERY = os.environ.get('EKYC_QUERY', '')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
INIT = """
(() => {
  const pick = (c) => { const f = c && c.video && c.video.facingMode; const v = f && (f.ideal || f.exact || f); return v === 'user' ? 'face' : 'card'; };
  navigator.mediaDevices.getUserMedia = async (c) => {
    const v = document.createElement('video');
    v.src = '/__feeds/' + pick(c) + '.webm'; v.muted = true; v.loop = true; v.playsInline = true;
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
    page.route('**/__feeds/*.webm', lambda r: r.fulfill(path=os.path.join(OUT, r.request.url.split('/')[-1]), content_type='video/webm'))
    if REAL:
        page.add_init_script('localStorage.setItem("ekyc-upload-config-v1", JSON.stringify(Object.assign({mode:"real",baseUrl:%s,token:"",remember:true}, %s)))' % (json.dumps(REAL), json.dumps(EXTRA)))
    page.on('pageerror', lambda e: print('[pageerror]', e))
    page.goto(BASE + '?manualAfter=60000' + QUERY)
    res['title'] = page.title()
    if CTYPE: page.select_option('#card-type', CTYPE)
    page.click('#btn-start')
    t0 = time.time()
    while time.time() - t0 < 60 and page.evaluate("window.__ekyc.state.step") != 'review':
        time.sleep(0.3)
    time.sleep(0.6)
    ev = page.evaluate('window.__ekyc.events')
    res['captures'] = [e for e in ev if 'captured' in e]
    res['reached_review'] = page.evaluate("window.__ekyc.state.step") == 'review'
    res['meta'] = [page.inner_text('#card-meta'), page.inner_text('#face-meta')]
    res['cameraInfo'] = page.evaluate('window.__ekyc.shots.face.cameraInfo')
    res['face_detail'] = page.evaluate('window.__ekyc.shots.face.detail || null')
    res['sdk_calls'] = page.evaluate('window.FaceMe && window.FaceMe.__calls ? JSON.stringify(window.FaceMe.__calls) : null')
    page.screenshot(path=SHOT + 'review.png')
    page.click('#btn-upload')
    page.wait_for_function("!document.getElementById('btn-upload').disabled && document.getElementById('upload-result').textContent.length > 20", timeout=30000)
    res['upload_text'] = page.inner_text('#upload-result')
    res['upload_event'] = [e for e in page.evaluate('window.__ekyc.events') if 'upload' in e]
    res['retake_buttons'] = page.eval_on_selector_all('#upload-result [data-retake]', 'els => els.map(e => e.textContent)')
    page.screenshot(path=SHOT + 'uploaded.png', full_page=True)
    if res['retake_buttons']:
        page.click('#upload-result [data-retake]')
        time.sleep(1)
        res['retake_click_step'] = page.evaluate('window.__ekyc.state.step')
    b.close()
print(json.dumps(res, ensure_ascii=False, indent=1))
