// TEST STUB ONLY – NOT the CyberLink SDK. Mimics the documented FaceMe Web SDK surface so the
// adapter (js/engines/faceme-sdk.js) can be exercised without the real SDK files.
(function () {
  const calls = [];
  function frame(w, h, hue) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue},40%,70%)`; g.fillRect(0, 0, w, h); g.fillStyle = '#334'; g.font = '28px sans-serif'; g.fillText('FAKE SDK', 20, 50);
    return { c, data: g.getImageData(0, 0, w, h) };
  }
  function blob(c) { return new Promise(r => c.toBlob(r, 'image/jpeg', 0.8)); }
  function show(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
  window.FaceMe = {
    __calls: calls,
    init(ok, fail, params) { calls.push(['init', params]); setTimeout(ok, 50); },
    initIDCard(ok, fail, params) { calls.push(['initIDCard', params]); setTimeout(ok, 50); },
    startIDCardCapture(cs, ok, fail) {
      calls.push(['startIDCardCapture', cs]);
      if (!document.getElementById(cs.sdkBlockId)) return fail({ code: 100, message: 'invalid sdkBlockId' });
      show(cs.hintBlockId, '（假 SDK）證件拍攝中…');
      setTimeout(() => ok([frame(640, 404, 30).data, frame(640, 404, 60).data, frame(640, 404, 90).data, frame(640, 404, 120).data], null, [0.5, 0.9, 0.7, 0.2], null), 600);
    },
    stopIDCardCapture() { calls.push(['stopIDCardCapture']); },
    async startAntiSpoofing(cs, ds, ok, fail) {
      calls.push(['startAntiSpoofing', cs, ds]);
      show(cs.hintBlockId, '（假 SDK）活體檢測中…');
      const imgs = []; for (let i = 0; i < 8; i++) imgs.push(await blob(frame(480, 640, i * 20).c));
      const detail = { cameraInfo: 'FakeCam(0000:0000)', stg1_act_1: { status: [0.1, 0.1, 0.2, 0.1, 0.1, 0.1, 0.1, 0.1], still: 8 } };
      setTimeout(() => ok(detail, { img_stg1_act_1: imgs, img_stg1_act_1_crop: imgs }, [imgs[7]]), 600);
    },
    stopAntiSpoofing() { calls.push(['stopAntiSpoofing']); },
    release() { calls.push(['release']); },
  };
  setTimeout(() => window.facemeAsyncInit && window.facemeAsyncInit(), 0);
})();
