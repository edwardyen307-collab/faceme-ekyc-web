"""End-to-end test with Chromium fake camera feeds (390px wide, iPhone-like).
python tests/e2e.py BASE_URL FEEDS_DIR SHOT_PREFIX"""
import sys, json, time
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:8765/'
FEEDS = sys.argv[2] if len(sys.argv) > 2 else '/tmp/ekyc-feeds'
SHOT = sys.argv[3] if len(sys.argv) > 3 else '/workspace/ekyc-11a-'
CHROME = '/opt/google/chrome/chrome'
results = {}

def launch(p, feed):
    b = p.chromium.launch(executable_path=CHROME, headless=True, args=[
        '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
        f'--use-file-for-fake-video-capture={FEEDS}/{feed}.y4m', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        permissions=['camera'])
    page = ctx.new_page()
    page.on('console', lambda m: print('  [console]', m.type, m.text[:200]) if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: print('  [pageerror]', e))
    return b, page

def hints(page):
    return [e.get('hint') for e in page.evaluate('window.__ekyc.events') if e.get('hint')]

def wait_for(page, js, timeout=30):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if page.evaluate(js): return True
        time.sleep(0.2)
    return False

def main(p):
    # 1) ID card feed: guidance + auto capture
    b, page = launch(p, 'card')
    page.goto(BASE + '?debug=1&manualAfter=60000')
    page.screenshot(path=SHOT + '0-intro.png')
    page.click('#btn-start')
    time.sleep(1.2)
    page.screenshot(path=SHOT + '1-card-guidance.png')
    ok = wait_for(page, "window.__ekyc.events.some(e => e.captured === 'card')", 40)
    results['card_autocapture'] = ok
    results['card_hints'] = hints(page)
    results['card_event'] = [e for e in page.evaluate('window.__ekyc.events') if e.get('captured')]
    time.sleep(1.0)
    page.screenshot(path=SHOT + '2-face-step-on-card-feed.png')
    b.close()

    # 1b) TW ID + manual button on a feed with NO ID card (face feed): must be refused (no bypass, v11g)
    b, page = launch(p, 'face')
    page.goto(BASE + '?debug=1&manualAfter=1500')
    page.click('#btn-start')
    page.wait_for_selector('#btn-manual:not([hidden])', timeout=15000)
    for _ in range(2):
        page.click('#btn-manual'); time.sleep(4.5)
    results['twid_manual_without_id_refused'] = not page.evaluate("window.__ekyc.events.some(e => e.captured === 'card')")
    results['twid_manual_hints'] = hints(page)[-3:]
    b.close()

    # 2) face feed: card via manual button, then face auto capture, then review
    b, page = launch(p, 'face')
    page.goto(BASE + '?debug=1&manualAfter=1500')
    page.select_option('#card-type', 'TW_ARC_FRONT')  # TW ID manual capture needs a passing front/back check (v11g)
    page.click('#btn-start')
    page.wait_for_selector('#btn-manual:not([hidden])', timeout=15000)
    page.click('#btn-manual')
    wait_for(page, "window.__ekyc.state.step === 'face'", 10)
    time.sleep(0.5)
    t_face = time.time()
    # snapshot during guidance (before capture) if possible
    wait_for(page, "window.__ekyc.last && window.__ekyc.last.state !== 'loading'", 40)
    page.screenshot(path=SHOT + '3-face-guidance.png')
    ok = wait_for(page, "window.__ekyc.events.some(e => e.captured === 'face' && !e.manual)", 40)
    results['face_autocapture'] = ok
    results['face_secs'] = round(time.time() - t_face, 1)
    results['face_hints'] = [h for h in hints(page)]
    results['face_last_metrics'] = page.evaluate('window.__ekyc.last')
    wait_for(page, "window.__ekyc.state.step === 'review'", 10)
    time.sleep(0.6)
    page.screenshot(path=SHOT + '4-review.png')
    results['review_imgs'] = page.evaluate("[document.getElementById('img-card').naturalWidth, document.getElementById('img-face').naturalWidth]")
    page.click('#btn-upload')
    wait_for(page, "document.getElementById('upload-result').textContent.includes('模擬上傳完成')", 10)
    results['mock_upload'] = page.inner_text('#upload-result')
    page.screenshot(path=SHOT + '5-mock-upload.png')
    # retake face -> back
    page.click('#btn-retake-face')
    results['retake_face_step'] = wait_for(page, "window.__ekyc.state.step === 'face' && document.getElementById('screen-capture').classList.contains('active')", 10)
    ok = wait_for(page, "window.__ekyc.events.filter(e => e.captured === 'face').length >= 2", 40)
    results['retake_face_autocapture_back_to_review'] = ok and wait_for(page, "window.__ekyc.state.step === 'review'", 10)
    # retake card -> goes to card step; back returns to review
    page.click('#btn-retake-card')
    results['retake_card_step'] = wait_for(page, "window.__ekyc.state.step === 'card' && document.getElementById('screen-capture').classList.contains('active')", 10)
    time.sleep(0.8)
    page.click('#btn-back')
    results['back_to_review'] = wait_for(page, "document.getElementById('screen-review').classList.contains('active')", 5)
    b.close()

    # 3) masked face: should NOT auto-capture, hint should mention occlusion
    b, page = launch(p, 'face-mask')
    page.goto(BASE + '?debug=1&manualAfter=1500')
    page.select_option('#card-type', 'TW_ARC_FRONT')  # TW ID manual capture needs a passing front/back check (v11g)
    page.click('#btn-start')
    page.wait_for_selector('#btn-manual:not([hidden])', timeout=15000)
    page.click('#btn-manual')
    wait_for(page, "window.__ekyc.state.step === 'face'", 10)
    wait_for(page, "window.__ekyc.last && window.__ekyc.last.state !== 'loading'", 40)
    time.sleep(6)
    page.screenshot(path=SHOT + '6-face-mask.png')
    results['mask_captured'] = page.evaluate("window.__ekyc.events.some(e => e.captured === 'face')")
    results['mask_hints'] = hints(page)
    results['mask_last'] = page.evaluate('window.__ekyc.last')
    b.close()

    # 4) position / distance guidance (face shifted right in the raw frame = left on the mirrored preview; face too small)
    for feed in ('face-offset', 'face-far'):
        b, page = launch(p, feed)
        page.goto(BASE + '?debug=1&manualAfter=1500')
        page.select_option('#card-type', 'TW_ARC_FRONT')
        page.click('#btn-start')
        page.wait_for_selector('#btn-manual:not([hidden])', timeout=15000)
        page.click('#btn-manual')
        wait_for(page, "window.__ekyc.state.step === 'face'", 10)
        wait_for(page, "window.__ekyc.last && window.__ekyc.last.state !== 'loading'", 40)
        time.sleep(4)
        page.screenshot(path=SHOT + '7-' + feed + '.png')
        results[feed + '_captured'] = page.evaluate("window.__ekyc.events.some(e => e.captured === 'face')")
        results[feed + '_last'] = page.evaluate('window.__ekyc.last')
        b.close()

with sync_playwright() as p:
    try:
        main(p)
    finally:
        print(json.dumps(results, ensure_ascii=False, indent=1))
