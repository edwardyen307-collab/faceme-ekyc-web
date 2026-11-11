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
PHASEMAP = json.loads(os.environ.get('PHASEMAP', 'null') or 'null') or {
    'front': 'card', 'tilt': 'card-tilt-strong', 'flip': 'card-front',
    'back': ['card-front', 2500, 'card-back-real'],   # first still shows the FRONT (must be refused), then a pale real-looking back
    'tiltBack': 'card-back-real-tilt'}
INIT = """
(() => {
  const PHASEMAP = %s;
  const pick = (c) => { const f = c && c.video && c.video.facingMode; const v = f && (f.ideal || f.exact || f); return v === 'user' ? 'face' : 'card'; };
  const vids = {};
  const vid = (name) => {
    if (vids[name]) return vids[name];
    const v = document.createElement('video');
    v.src = '/__feeds/' + name + '.webm'; v.muted = true; v.loop = true; v.playsInline = true;
    v.style.cssText = 'position:fixed;left:-9999px;width:2px;height:2px';
    document.body.appendChild(v); v.play().catch(() => {});
    return (vids[name] = v);
  };
  let phaseSeen = null, phaseAt = 0;
  const feedNow = () => {
    const ph = (window.__ekyc && window.__ekyc.state.phase) || 'front';
    if (ph !== phaseSeen) { phaseSeen = ph; phaseAt = performance.now(); }
    let m = (window.__phasemap || PHASEMAP)[ph] || 'card';
    if (Array.isArray(m)) m = performance.now() - phaseAt < m[1] ? m[0] : m[2];
    return m;
  };
  window.__feedLog = [];
  navigator.mediaDevices.getUserMedia = async (c) => {
    if (pick(c) === 'face') {
      const v = vid('face'); await v.play();
      const s = v.captureStream();
      return s;
    }
    for (const ph in PHASEMAP) [].concat(PHASEMAP[ph]).filter(x => typeof x === 'string').forEach(vid);
    const cv = document.createElement('canvas'); cv.width = 540; cv.height = 960;
    const g = cv.getContext('2d'); let last = '';
    let on = true;
    const draw = () => { if (!on) return; const n = feedNow(); if (n !== last) { last = n; window.__feedLog.push(n); }
      const v = vid(n); if (v.readyState >= 2) g.drawImage(v, 0, 0, 540, 960); requestAnimationFrame(draw); };
    await vid('card').play(); draw();
    const s = cv.captureStream(15);
    const t = s.getTracks()[0]; const stop = t.stop.bind(t);
    t.stop = () => { on = false; stop(); };
    t.getSettings = () => ({ width: 540, height: 960, facingMode: 'environment', deviceId: 'fake-rear' });
    return s;
  };
})();
""" % json.dumps(PHASEMAP)
res = {}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/opt/google/chrome/chrome', headless=True, args=['--autoplay-policy=no-user-gesture-required'])
    page = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    page.add_init_script(INIT)
    if os.environ.get("EKYC_INIT_JS"): page.add_init_script(path=os.environ["EKYC_INIT_JS"])  # e.g. window.__fakeSdkCards for the SDK stub
    FEEDMAP = {'card.webm': os.environ.get('FEED_CARD', 'card') + '.webm', 'face.webm': os.environ.get('FEED_FACE', 'face') + '.webm'}
    page.route('**/__feeds/*.webm', lambda r: r.fulfill(path=os.path.join(OUT, FEEDMAP.get(r.request.url.split('/')[-1], r.request.url.split('/')[-1])), content_type='video/webm'))
    if not REAL and EXTRA:
        page.add_init_script('localStorage.setItem("ekyc-upload-config-v1", JSON.stringify(%s))' % json.dumps(EXTRA))
    if REAL:
        page.add_init_script('localStorage.setItem("ekyc-upload-config-v1", JSON.stringify(Object.assign({mode:"real",baseUrl:%s,token:"",remember:true}, %s)))' % (json.dumps(REAL), json.dumps(EXTRA)))
    page.on('pageerror', lambda e: print('[pageerror]', e))
    page.goto(BASE + '?manualAfter=60000' + QUERY)
    res['title'] = page.title()
    if CTYPE: page.select_option('#card-type', CTYPE)
    page.click('#btn-start')
    t0 = time.time()
    while time.time() - t0 < float(os.environ.get('FLOW_TIMEOUT', '60')) and page.evaluate("window.__ekyc.state.step") != 'review':
        time.sleep(0.3)
    time.sleep(0.6)
    ev = page.evaluate('window.__ekyc.events')
    res['captures'] = [e for e in ev if 'captured' in e]
    res['reached_review'] = page.evaluate("window.__ekyc.state.step") == 'review'
    if not res['reached_review']:
        print(json.dumps({'stuck': page.evaluate("({step: window.__ekyc.state.step, phase: window.__ekyc.state.phase, last: window.__ekyc.last, feeds: window.__feedLog, ev: window.__ekyc.events.slice(-25)})")}, ensure_ascii=False, indent=1))
        page.screenshot(path=SHOT + 'stuck.png'); b.close(); sys.exit(1)
    res['meta'] = [page.inner_text('#card-meta'), page.inner_text('#face-meta')]
    res['cameraInfo'] = page.evaluate('window.__ekyc.shots.face.cameraInfo')
    res['face_detail'] = page.evaluate('window.__ekyc.shots.face.detail || null')
    res['sdk_calls'] = page.evaluate('window.FaceMe && window.FaceMe.__calls ? JSON.stringify(window.FaceMe.__calls) : null')
    res['forgery_events'] = [e for e in ev if 'forgery' in e or 'forgeryRequirement' in e]
    res['feed_log'] = page.evaluate('window.__feedLog')
    res['phases_hints'] = [(e.get('hint')) for e in ev if 'hint' in e]
    res['back_visible'] = page.is_visible('#back-fig')
    res['forgery_details_open'] = page.evaluate("document.getElementById('forgery-fig').open")
    res['forgery_meta'] = page.inner_text('#forgery-meta') if page.is_visible('#forgery-fig') else None
    res['card_capture_ms'] = next((e['t'] for e in ev if e.get('captured') == 'card'), None)
    res['hint_levels'] = sorted({(e.get('level') or '') + ':' + (e.get('dir') or '') for e in ev if 'hint' in e})
    res['hints'] = [(e['t'], e['hint']) for e in ev if 'hint' in e][:60]
    page.screenshot(path=SHOT + 'review.png')
    page.click('#btn-upload')
    page.wait_for_function("!document.getElementById('btn-upload').disabled && document.getElementById('upload-result').textContent.length > 20", timeout=60000)
    res['upload_text'] = page.inner_text('#upload-result')
    res['upload_event'] = [e for e in page.evaluate('window.__ekyc.events') if 'upload' in e]
    res['retake_buttons'] = page.eval_on_selector_all('#upload-result [data-retake]', 'els => els.map(e => e.textContent)')
    page.screenshot(path=SHOT + 'uploaded.png', full_page=True)
    res['match_text'] = page.inner_text('#match-result') if page.is_visible('#match-result') else None
    if res['retake_buttons']:
        page.click('#upload-result [data-retake]')
        time.sleep(1)
        res['retake_click_step'] = page.evaluate('window.__ekyc.state.step')
    b.close()
print(json.dumps(res, ensure_ascii=False, indent=1))
