import { APP_VERSION } from './version.js?v=2026-11-11f';
import { Camera } from './camera.js?v=2026-11-11f';
import { createEngine } from './engines/index.js?v=2026-11-11f';
import { CARD_ASPECT, CARD_RIGHTSIDE, CARD_BACK } from './card-detector.js?v=2026-11-11f';
import { phrase } from './hints.js?v=2026-11-11f';
import { loadConfig, saveConfig, uploadEkyc, CARD_TYPES, stillValue, forgeryApplies, getForgeryRequirement, compareFaces, resetSession, normalizeCardChoice, sidesOf, SIDE_LABEL, verifyOcrSide } from './upload.js?v=2026-11-11f';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const MANUAL_AFTER_MS = Number(params.get('manualAfter') || 12000);

const els = {
  stage: $('stage'), video: $('video'), hint: $('hint'), progress: $('progress'), shade: $('shade'), guide: $('guide'),
  detected: $('detected'), overlay: $('overlay'), flash: $('flash'), metrics: $('metrics'), stageTitle: $('stage-title'),
  track: $('track'), trackCorners: $('track-corners'),
  manual: $('btn-manual'), banner: $('banner'), hintIcon: $('hint-icon'), demo: $('demo'), demoText: $('demo-text'), ring: $('ring'),
};
const ICONS = { left: '←', right: '→', up: '↑', down: '↓', closer: '＋', farther: '－', rotate: '↻', flat: '▭', tiltright: '↗', frame: '⛶',
  still: '✋', ok: '✓', glare: '☀', light: '💡', blur: '◎', block: '!', person: '!', eye: '👁', wait: '…', flip: '⇋' };
const STATE_LEVEL = { hold: 'good', capture: 'good', sdk: 'adjust', loading: 'adjust' };
const camera = new Camera(els.video, els.stage);
let cfg = loadConfig();
const ENGINE_KIND = params.get('engine') === 'faceme' ? 'faceme' : 'opensource';
const engine = createEngine(ENGINE_KIND, { sdkUrl: params.get('sdk') || '', resPath: params.get('sdkRes') || '', strictMode: !!cfg.strictMode });

// In-memory only. Object URLs are revoked whenever an image is replaced or reset.
// card = { image, frames[], type }   face = { image, frames[], stillIndex | (detail, still), cameraInfo }
const shots = { card: null, face: null, cardUrl: null, faceUrl: null, backUrl: null, forgeryUrls: [] };
const state = { step: 'intro', phase: '', retakeOnly: false, guide: null, kind: null, manualTimer: 0, disp: { key: null, since: 0, level: '' }, pend: { key: null, since: 0 } };
const forceRef = { now: false };
window.__ekyc = { state, shots, version: APP_VERSION, events: [] };
const log = (e) => { window.__ekyc.events.push({ t: Math.round(performance.now()), ...e }); };

$('ver').textContent = APP_VERSION;
const typeSel = $('card-type');
for (const [v, label] of CARD_TYPES) { const o = document.createElement('option'); o.value = v; o.textContent = label; typeSel.appendChild(o); }
typeSel.value = normalizeCardChoice(cfg.cardType);
typeSel.addEventListener('change', () => { cfg.cardType = typeSel.value; saveConfig(cfg); });
const typeLabel = () => (CARD_TYPES.find(t => t[0] === typeSel.value) || [, '證件'])[1];
$('engine-label').textContent = '目前：' + engine.label;
if (DEBUG) els.metrics.hidden = false;

function show(screen) {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === 'screen-' + screen);
  document.body.classList.toggle('capturing', screen === 'capture');
}
function setStep(step) {
  state.step = step;
  const order = ['card', 'face', 'review'];
  document.querySelectorAll('.steps li').forEach(li => {
    const i = order.indexOf(li.dataset.step), cur = order.indexOf(step);
    li.classList.toggle('active', i === cur);
    li.classList.toggle('done', cur > i || (li.dataset.step === 'card' && shots.card && step !== 'card') || (li.dataset.step === 'face' && shots.face && step === 'review'));
  });
}
function renderMode() {
  const real = cfg.mode === 'real';
  const b = $('upload-mode');
  b.textContent = real ? '實際上傳模式：照片會送到 ' + (cfg.baseUrl || '（未設定網址）') : '模擬上傳模式：按「上傳」不會傳出任何資料，只示範流程';
  b.classList.toggle('real', real);
  $('mode-note').textContent = real ? '目前為「實際上傳」模式。' : '目前為「模擬上傳」模式，照片不會離開手機。';
}

// ---------- guide geometry ----------
function layoutGuide(kind) {
  state.kind = kind;
  const cw = els.stage.clientWidth, ch = els.stage.clientHeight;
  els.overlay.setAttribute('viewBox', `0 0 ${cw} ${ch}`);
  let g, path;
  if (kind === 'card' || kind === 'tilt') {
    const w = Math.min(cw * 0.88, 560, (ch * 0.6) * CARD_ASPECT), h = w / CARD_ASPECT;
    g = { x: (cw - w) / 2, y: ch * 0.44 - h / 2, w, h };
    const r = Math.min(18, w * 0.04);
    if (kind === 'tilt') {
      // card seen from the upper right: near (right) edge taller, far (left) edge shorter
      const s = h * 0.16;
      path = `M ${g.x + w * 0.06} ${g.y + s} L ${g.x + w} ${g.y - h * 0.02} L ${g.x + w * 0.98} ${g.y + h * 1.04} L ${g.x + w * 0.04} ${g.y + h - s * 0.6} Z`;
    } else path = roundRectPath(g.x, g.y, g.w, g.h, r);
    els.guide.classList.toggle('tilted', kind === 'tilt');
  } else {
    els.guide.classList.remove('tilted');
    const w = Math.min(cw * 0.68, ch * 0.5), h = w * 1.32;
    g = { x: (cw - w) / 2, y: ch * 0.43 - h / 2, w, h };
    const rx = w / 2, ry = h / 2, cx = g.x + rx, cy = g.y + ry;
    path = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
  }
  state.guide = g;
  // 自動追拍: no fixed frame / shade; the detected quad is drawn instead (see ui.update)
  state.tracking = !!cfg.autoTrack && (kind === 'card' || kind === 'tilt');
  els.stage.classList.toggle('tracking', state.tracking);
  els.track.classList.remove('on'); els.trackCorners.classList.remove('on');
  if (state.tracking) { els.shade.setAttribute('d', ''); els.guide.setAttribute('d', path); els.progress.style.top = (g.y + g.h + 14) + 'px'; return; }
  els.shade.setAttribute('d', `M0 0 H${cw} V${ch} H0 Z ` + path);
  els.guide.setAttribute('d', path);
  els.progress.style.top = (g.y + g.h + 14) + 'px';
}
function roundRectPath(x, y, w, h, r) {
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
window.addEventListener('resize', () => { if (state.kind) layoutGuide(state.kind); });

// ---------- live UI ----------
// One stable hint: a new hint must persist (debounce) and the current one stays at least MIN_SHOW ms,
// except that "good" states (hold / capturing) appear quickly so the user is not told to move while it shoots.
const MIN_SHOW = 1500, DEBOUNCE = 450, GOOD_DEBOUNCE = 150, LEAVE_GOOD_SHOW = 700;
const CALM = new Set(['hold', 'capture', 'steady', 'moving', 'loading', 'sdk', 'search', 'noface', 'flip', 'checking']);
function showHint(out) {
  const level = out.level || STATE_LEVEL[out.state] || 'adjust';
  const key = out.key || out.hint;
  if (key !== state.disp.key) {
    log({ hint: out.hint, state: out.state, level, dir: out.dir });
    els.banner.classList.remove('pop'); void els.banner.offsetWidth; els.banner.classList.add('pop');
  }
  state.disp = { key, since: performance.now(), level };
  els.hint.textContent = out.hint;
  els.stage.dataset.state = out.state; els.stage.dataset.level = level; els.stage.dataset.dir = out.dir || '';
  els.hintIcon.textContent = ICONS[out.dir] || '';
  els.stage.classList.toggle('warn', !CALM.has(out.state));
}
const ui = {
  /** force = show immediately (phase changes) */
  update(out, rectDisplay, _raw, force) {
    const now = performance.now();
    const level = out.level || STATE_LEVEL[out.state] || 'adjust';
    const key = out.key || out.hint;
    if (force || !state.disp.key || out.state === 'capture') { if (key !== state.disp.key || force) showHint(out); }
    else if (key === state.disp.key) { state.pend = { key: null, since: 0 }; }
    else {
      if (state.pend.key !== key) state.pend = { key, since: now };
      const good = level === 'good';
      const minShow = good ? 0 : (state.disp.level === 'good' ? LEAVE_GOOD_SHOW : MIN_SHOW);
      if (now - state.pend.since >= (good ? GOOD_DEBOUNCE : DEBOUNCE) && now - state.disp.since >= minShow) showHint(out);
    }
    const showProg = state.disp.level === 'good' && out.progress > 0;
    els.progress.classList.toggle('on', showProg && state.kind !== 'tilt');
    els.progress.firstElementChild.style.width = Math.round((showProg ? out.progress : 0) * 100) + '%';
    if (state.kind === 'tilt' && !els.ring.hidden) els.ring.style.setProperty('--p', Math.round((out.progress || 0) * 100));
    if (rectDisplay) {
      els.detected.setAttribute('x', rectDisplay.x); els.detected.setAttribute('y', rectDisplay.y);
      els.detected.setAttribute('width', Math.max(0, rectDisplay.w)); els.detected.setAttribute('height', Math.max(0, rectDisplay.h));
      els.detected.classList.toggle('on', state.kind !== 'tilt');
    } else els.detected.classList.remove('on');
    drawTrack(out.quadDisplay);
    if (DEBUG) els.metrics.textContent = out.state + ' ' + JSON.stringify(out.metrics || {});
    window.__ekyc.last = { state: out.state, hint: els.hint.textContent, raw: out.hint, level: els.stage.dataset.level, dir: els.stage.dataset.dir, metrics: out.metrics };
  },
};
// auto-tracking quad: dashed outline + corner marks that follow (and scale with) the card
function drawTrack(q) {
  if (!state.tracking || !q) { els.track.classList.remove('on'); els.trackCorners.classList.remove('on'); state.trackQuad = null; return; }
  els.track.setAttribute('points', q.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
  let d = '';
  for (let i = 0; i < 4; i++) {
    const p = q[i], a = q[(i + 1) % 4], b = q[(i + 3) % 4];
    const la = Math.min(26, Math.hypot(a.x - p.x, a.y - p.y) * 0.18), lb = Math.min(26, Math.hypot(b.x - p.x, b.y - p.y) * 0.18);
    const u = (t, l) => ({ x: p.x + (t.x - p.x) / Math.hypot(t.x - p.x, t.y - p.y) * l, y: p.y + (t.y - p.y) / Math.hypot(t.x - p.x, t.y - p.y) * l });
    const A = u(a, la), B = u(b, lb);
    d += `M ${A.x.toFixed(1)} ${A.y.toFixed(1)} L ${p.x.toFixed(1)} ${p.y.toFixed(1)} L ${B.x.toFixed(1)} ${B.y.toFixed(1)} `;
  }
  els.trackCorners.setAttribute('d', d);
  els.track.classList.add('on'); els.trackCorners.classList.add('on');
  state.trackQuad = q;
  const ys = q.map(p => p.y); els.progress.style.top = (Math.max(...ys) + 14) + 'px';
}
function demo(kind, text) {
  els.demo.hidden = !kind; els.demo.className = 'demo ' + (kind || ''); els.demoText.textContent = text || '';
}

function flash() {
  els.flash.classList.remove('go'); void els.flash.offsetWidth; els.flash.classList.add('go');
  try { if (navigator.vibrate) navigator.vibrate(60); } catch (_) {} // Android; iOS Safari ignores
}

function cameraErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '沒有相機權限。iPhone 請到「設定 > Safari > 相機」選「允許」，再重新整理頁面。';
  if (n === 'NotFoundError' || n === 'OverconstrainedError') return '找不到可用的相機。';
  if (n === 'NotReadableError') return '相機正被其他 App 使用，請關閉後再試。';
  return '無法開啟相機：' + (e && e.message ? e.message : e);
}

function resetStageUi(title) {
  forceRef.now = false; els.manual.hidden = true; clearTimeout(state.manualTimer);
  state.disp = { key: null, since: 0, level: '' }; state.pend = { key: null, since: 0 };
  demo(null); els.ring.hidden = true;
  if (title) els.stageTitle.textContent = title;
}
function armManual() { clearTimeout(state.manualTimer); state.manualTimer = setTimeout(() => { els.manual.hidden = false; }, MANUAL_AFTER_MS); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function openStage(kind, title) {
  setStep(kind === 'face' ? 'face' : 'card');
  show('capture');
  resetStageUi(title);
  ui.update({ state: 'loading', hint: '準備相機中…', level: 'adjust', dir: 'wait' }, null, null, true);
  layoutGuide(kind);
  await camera.open(kind === 'face' ? 'user' : 'environment');
  layoutGuide(kind);
  log({ camera: camera.facing, w: els.video.videoWidth, h: els.video.videoHeight });
  return { camera, stage: els.stage, ui, getGuide: () => state.guide, forceRef };
}

// expected aspect for auto-tracking / deskew (ID-1 cards by default)
const TYPE_ASPECT = { PASSPORT: 125 / 88, TW_CAR_REGISTRATION: 1.5, TW_MOTORCYCLE_REGISTRATION: 1.5 };
const trackOpts = (type) => (TYPE_ASPECT[type] ? { aspectTol: 0.35 } : {});
const OCR_MAX_UNREADABLE = 3; // an unreadable (not wrong-side) OCR result stops blocking after this many retakes

/** One side of a document (front or back), incl. silent forgery frames and the tilted shots. */
async function captureSide(ctx, type, opts) {
  const forgery = forgeryApplies(cfg, type);
  const req = forgery ? await getForgeryRequirement(cfg, type) : null;
  if (req) log({ forgeryRequirement: req, side: type });
  state.phase = opts.back ? 'back' : 'front';
  layoutGuide('card');
  armManual();
  // TW ID: portrait photo = front; capture only the requested side. The back is pale/low-contrast: softer thresholds.
  const side = type === 'TW_ID_CARD_FRONT' ? 'front' : type === 'TW_ID_CARD_BACK' ? 'back' : null;
  const track = !!cfg.autoTrack;
  let shot, unreadable = 0;
  for (;;) {
    const raw = await engine.captureIdCard({ ...ctx, cardType: type, collectFront: req ? req.front : 0, side, track,
      aspect: TYPE_ASPECT[type], trackOptions: trackOpts(type),
      cardOptions: type === 'TW_ID_CARD_BACK' ? CARD_BACK : undefined });
    clearTimeout(state.manualTimer);
    flash();
    shot = raw instanceof Blob ? { image: raw, frames: [raw] } : raw;
    shot.type = type;
    log({ captured: 'card', side: type, bytes: shot.image.size, frames: shot.frames.length, front: (shot.front || []).length, manual: forceRef.now, verdict: shot.side, votes: shot.votes, m: shot.metrics, track, deskewed: !!shot.deskewed });
    // real mode: OCR once right away and make sure the fields belong to this side (mock mode: skipped, nothing sent)
    if (cfg.mode !== 'real' || !cfg.ocrSideCheck || !side) break;
    ui.update({ state: 'checking', ...phrase('card.ocrChecking'), progress: 0 }, null, null, true);
    let chk;
    try { chk = await verifyOcrSide(cfg, shot); } catch (e) { chk = { status: 'unverified', msg: e.message }; }
    shot.ocrCheck = chk;
    log({ ocrSide: chk.status, side: type, key: chk.key, judge: chk.judge, msg: chk.msg });
    if (chk.status !== 'reject') break;
    if (chk.key === 'card.ocrUnreadable' && ++unreadable >= OCR_MAX_UNREADABLE) break; // the upload step will report it
    // wrong side (or unreadable): say why, then capture this side again
    forceRef.now = false;
    ui.update({ state: 'wrongside', ...phrase(chk.key), progress: 0 }, null, null, true);
    await sleep(2200);
    resetStageUi(); layoutGuide('card'); armManual();
  }
  if (req) {
    const fr = (shot.front && shot.front.length ? shot.front : shot.frames).slice(0, req.front);
    for (let i = 0; fr.length < req.front && i < 50; i++) fr.push(shot.frames[i % shot.frames.length]);
    // rightSide: tilted guide frame + short animation; captured silently once the tilt is detected
    state.phase = opts.back ? 'tiltBack' : 'tilt';
    await sleep(350);
    resetStageUi();
    layoutGuide('tilt');
    demo('tilt', '手機移到證件右上方，斜斜往下拍');
    ui.update({ state: 'search', ...phrase('card.rs.search') }, null, null, true);
    els.ring.hidden = false; els.ring.style.setProperty('--p', 0);
    armManual();
    const r = await engine.captureCardShot({ ...ctx, cardType: type, cardOptions: CARD_RIGHTSIDE, keep: req.rightSide, minFrames: req.rightSide, grabFull: req.full > 0, track, aspect: TYPE_ASPECT[type] });
    clearTimeout(state.manualTimer);
    els.ring.style.setProperty('--p', 100);
    flash();
    const rs = r instanceof Blob ? [r] : (r.frames || [r.image]);
    const rsList = rs.slice(0, req.rightSide);
    while (rsList.length < req.rightSide) rsList.push(rs[0]);
    shot.forgery = { shots: fr.map(b => ({ blob: b, direction: 'front' })).concat(rsList.map(b => ({ blob: b, direction: 'rightSide' }))),
      full: r.full ? [r.full] : [], counts: req };
    log({ forgery: type, front: fr.length, rightSide: rsList.length, geo: r.metrics ? { lr: r.metrics.lr, tb: r.metrics.tb, corner: r.metrics.corner, sharp: r.metrics.sharp } : null, manual: forceRef.now });
    await sleep(300);
    demo(null); els.ring.hidden = true; layoutGuide('card');
  }
  return shot;
}

async function runCard() {
  const sides = sidesOf(typeSel.value);
  const ctx = await openStage('card', `步驟 1／3：拍攝${typeLabel()}（後鏡頭）`);
  const front = await captureSide(ctx, sides[0], {});
  if (sides[1]) {
    // flip guide, then the back side (the portrait check refuses the front until it has really been flipped)
    state.phase = 'flip';
    resetStageUi('步驟 1／3：拍攝身分證背面（後鏡頭）');
    demo('flip', '把身分證翻到背面');
    ui.update({ state: 'flip', ...phrase('card.flip') }, null, null, true);
    await sleep(1800);
    front.back = await captureSide(ctx, sides[1], { back: true });
    demo(null);
  }
  setShot('card', front);
  await sleep(300);
  return front;
}

async function runFace() {
  const ctx = await openStage('face', '步驟 2／3：拍攝人臉（自拍鏡頭）');
  state.phase = 'face';
  armManual();
  const raw = await engine.captureFace(ctx);
  clearTimeout(state.manualTimer);
  flash();
  const shot = raw instanceof Blob ? { image: raw, frames: [raw], stillIndex: 0 } : raw;
  if (!shot.cameraInfo) shot.cameraInfo = camera.info();
  log({ captured: 'face', bytes: shot.image.size, frames: shot.frames.length, still: stillValue(shot, cfg), manual: forceRef.now });
  setShot('face', shot);
  await sleep(350);
  return shot;
}

function setShot(kind, shot) {
  const key = kind + 'Url';
  if (shots[key]) URL.revokeObjectURL(shots[key]);
  if (kind === 'card') {
    shots.forgeryUrls.forEach(u => URL.revokeObjectURL(u)); shots.forgeryUrls = [];
    if (shots.backUrl) URL.revokeObjectURL(shots.backUrl);
    shots.backUrl = shot.back ? URL.createObjectURL(shot.back.image) : null;
  }
  shots[kind] = shot; shots[key] = URL.createObjectURL(shot.image);
}

async function flow(from) {
  try {
    if (from === 'card') {
      await runCard();
      if (!(state.retakeOnly && shots.face)) await runFace();
    } else if (from === 'face') {
      await runFace();
    }
    camera.stop();
    showReview();
  } catch (e) {
    camera.stop();
    if (e && e.code === 'cancelled') return;
    console.error(e);
    show('intro'); setStep('card');
    const p = $('intro-error'); p.hidden = false;
    const camErr = e && ['NotAllowedError', 'SecurityError', 'NotFoundError', 'OverconstrainedError', 'NotReadableError', 'AbortError'].includes(e.name);
    p.textContent = camErr || (e && e.code === 'nosupport') ? cameraErrorText(e) : '發生錯誤：' + (e && e.message ? e.message : e);
    log({ error: String(e && e.message || e) });
  }
}

function showReview() {
  setStep('review');
  show('review');
  $('img-card').src = shots.cardUrl; $('img-face').src = shots.faceUrl;
  const c = shots.card;
  $('card-meta').textContent = `${typeLabel()}${c.back ? '・正面' : ''}` + (c.deskewed ? '・已自動校正（拉正）' : '') + (c.frames.length < 3 ? '・手動拍照只有 1 張，讀取資料可能要求補拍，建議重拍讓系統自動拍。' : '');
  $('back-fig').hidden = !c.back;
  if (c.back) { $('img-back').src = shots.backUrl; $('back-meta').textContent = '身分證背面' + (c.back.deskewed ? '・已自動校正（拉正）' : ''); }
  resetMatch();
  renderForgery();
  $('face-meta').textContent = shots.face.detail ? '真人檢查資料由 FaceMe 元件產生' : `自拍（含 ${shots.face.frames.length} 張連拍供真人檢查）`;
  $('upload-result').hidden = true;
  $('btn-upload').disabled = false;
  renderMode();
}

function renderForgery() {
  const fig = $('forgery-fig'), strip = $('forgery-strip');
  const sides = [shots.card, shots.card && shots.card.back].filter(c => c && c.forgery);
  fig.hidden = !sides.length; strip.innerHTML = '';
  $('oblique-fig').hidden = true;
  if (!sides.length) return;
  shots.forgeryUrls.forEach(u => URL.revokeObjectURL(u)); shots.forgeryUrls = [];
  let n = 0;
  for (const c of sides) for (const s of c.forgery.shots) {
    n++;
    const u = URL.createObjectURL(s.blob); shots.forgeryUrls.push(u);
    const fg = document.createElement('figure');
    fg.innerHTML = `<img alt=""><figcaption>${SIDE_LABEL[c.type] || ''}${s.direction === 'front' ? '・正拍' : '・斜拍'}</figcaption>`;
    fg.querySelector('img').src = u; strip.appendChild(fg);
  }
  $('forgery-count').textContent = n;
  // the oblique (rightSide) photos are shown openly so the tester can see that the card was really shot at an angle
  const ostrip = $('oblique-strip'); ostrip.innerHTML = '';
  for (const c of sides) c.forgery.shots.filter(x => x.direction === 'rightSide').forEach((s, i) => {
    const u = URL.createObjectURL(s.blob); shots.forgeryUrls.push(u);
    const fg = document.createElement('figure');
    fg.innerHTML = `<img alt="斜拍照"><figcaption>斜拍照 ${i + 1}${sides.length > 1 ? '・' + (SIDE_LABEL[c.type] || '') : ''}</figcaption>`;
    fg.querySelector('img').src = u; ostrip.appendChild(fg);
  });
  $('oblique-fig').hidden = !ostrip.children.length;
  $('forgery-meta').textContent = '上傳時用於證件真偽辨識。' + sides.map(c => `${SIDE_LABEL[c.type] || c.type}：正拍 ${c.forgery.shots.filter(x => x.direction === 'front').length}＋斜拍 ${c.forgery.shots.filter(x => x.direction === 'rightSide').length}`).join('，') +
    `（張數來源：${sides[0].forgery.counts.source === 'api' ? '伺服器' : '預設'}）`;
}

// ---------- 人證比對 ----------
function resetMatch() { const m = $('match-result'); m.hidden = true; m.className = 'match-result'; m.innerHTML = ''; $('btn-match').disabled = false; }
function renderMatch(r) {
  const m = $('match-result'); m.hidden = false;
  if (r.mock) {
    m.className = 'match-result mock';
    m.innerHTML = '<div class="tag">模擬結果</div><div class="big">未實際比對</div><div class="num">目前是「模擬」上傳方式，照片沒有送出，所以無法判斷是不是同一人。要真正比對，請到「設定 › 上傳方式」選「實際上傳」。</div>';
  } else if (r.error) {
    m.className = 'match-result err';
    m.innerHTML = `<div class="big">無法比對</div><div class="num">${esc(r.error)}</div>`;
  } else if (r.isMatch === true || r.isMatch === false) {
    m.className = 'match-result ' + (r.isMatch ? 'yes' : 'no');
    const sim = r.similarity == null ? '—' : r.similarity.toFixed(1) + '%';
    const th = r.threshold == null ? '' : `（門檻 ${r.threshold.toFixed(1)}%）`;
    m.innerHTML = `<div class="big">${r.isMatch ? '✓ 是同一人' : '✗ 不是同一人'}</div><div class="num">相似度 ${sim}${th}</div>` +
      (r.isMatch ? '' : '<div class="num">請確認證件是本人的，或在光線充足處重拍人臉。</div>');
  } else {
    m.className = 'match-result err'; m.innerHTML = '<div class="big">無法判讀比對結果</div>';
  }
  log({ match: r.mock ? 'mock' : r.error ? 'error' : r.isMatch, similarity: r.similarity, threshold: r.threshold });
}
$('btn-match').addEventListener('click', async () => {
  const b = $('btn-match'); b.disabled = true;
  const m = $('match-result'); m.hidden = false; m.className = 'match-result'; m.textContent = cfg.mode === 'real' ? '比對中…' : '';
  try { renderMatch(await compareFaces(cfg, shots.card, shots.face)); }
  catch (e) { renderMatch({ error: e.message }); }
  finally { b.disabled = false; }
});

// ---------- buttons ----------
$('btn-start').addEventListener('click', () => {
  $('intro-error').hidden = true;
  state.retakeOnly = false;
  resetSession();
  engine.prepare && engine.prepare().catch(err => console.warn('preload failed', err)); // preload face model in background
  flow('card');
});
els.manual.addEventListener('click', () => { forceRef.now = true; });
$('btn-back').addEventListener('click', () => {
  engine.cancel(); camera.stop(); clearTimeout(state.manualTimer);
  if (shots.card && shots.face) showReview(); else { show('intro'); setStep('card'); }
});
$('btn-retake-card').addEventListener('click', () => { state.retakeOnly = true; flow('card'); });
$('btn-retake-face').addEventListener('click', () => { state.retakeOnly = true; flow('face'); });
$('btn-upload').addEventListener('click', async () => {
  const out = $('upload-result'); out.hidden = false; out.innerHTML = '';
  const btn = $('btn-upload'); btn.disabled = true;
  const status = document.createElement('div'); out.appendChild(status);
  try {
    const r = await uploadEkyc(cfg, shots.card, shots.face, (s) => { status.textContent = s; });
    const allOk = r.steps.every(s => s.ok);
    log({ upload: r.mock ? 'mock' : 'real', ok: allOk, steps: r.steps.map(s => ({ key: s.key, ok: s.ok, retake: s.retake })) });
    let html = '';
    if (r.mock) {
      html += `<div class="ok">✓ 模擬上傳完成</div><div>資料沒有離開這支手機。實際上傳時會依序做：</div>`;
      html += '<ol class="steps-list">' + r.steps.map(s => `<li>${esc(s.name)}</li>`).join('') + '</ol>';
    } else {
      html += `<div class="${allOk ? 'ok' : 'bad'}">${allOk ? '✓ 驗證完成' : '✗ 驗證未通過，請依下方說明處理'}</div>`;
      if (r.request && r.request.requestUuid) html += `<div class="note">案件編號：${esc(r.request.requestUuid)}</div>`;
      html += r.steps.map(s => {
        let line = `<div class="step-res"><div class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'} ${esc(s.name)}：${esc(s.verdict || s.error || '')}</div>`;
        if (s.summary) line += `<div class="note pre">${esc(s.summary.slice(0, 1200))}</div>`;
        if (s.data !== undefined) line += `<details><summary>原始回應</summary><pre>${esc(JSON.stringify(s.data, null, 1)).slice(0, 3000)}</pre></details>`;
        return line + '</div>';
      }).join('');
      const retakes = [...new Set(r.steps.filter(s => s.retake).map(s => s.retake))];
      if (retakes.length) {
        html += '<div class="row retake-row">' + retakes.map(k => `<button class="btn primary" type="button" data-retake="${k}">${k === 'card' ? '重拍證件' : '重拍人臉'}</button>`).join('') + '</div>';
      }
    }
    out.innerHTML = html;
    if (r.mock) { if (cfg.doCompare) renderMatch({ mock: true }); }
    else { const cs = r.steps.find(x => x.key === 'compare'); if (cs) renderMatch(cs.compare ? cs.compare : { error: cs.error || cs.verdict || cs.summary || '比對失敗' }); }
    out.querySelectorAll('[data-retake]').forEach(b => b.addEventListener('click', () => $(b.dataset.retake === 'card' ? 'btn-retake-card' : 'btn-retake-face').click()));
  } catch (e) {
    out.innerHTML = `<div class="bad">✗ 上傳失敗：${esc(e.message)}</div>`;
  } finally { btn.disabled = false; }
});
function kb(list) { const n = (Array.isArray(list) ? list : [list]).reduce((a, b) => a + (b ? b.size : 0), 0); return Math.round(n / 1024) + ' KB'; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- settings sheet (reachable from every page; changes apply immediately) ----------
const form = $('admin-form');
const sheet = $('settings');
const BOOL_KEYS = ['useRequest', 'doSpoof', 'doOcr', 'doCompare', 'strictMode', 'deepfake', 'imageDeskewed', 'idLargestFace', 'stillZeroBased', 'doForgery', 'autoTrack', 'ocrSideCheck'];
const TEXT_KEYS = ['baseUrl', 'token', 'platformAuth', 'templateUuid'];
function fillForm() {
  form.mode.value = cfg.mode;
  for (const k of TEXT_KEYS) form[k].value = cfg[k] || '';
  for (const k of BOOL_KEYS) form[k].checked = !!cfg[k];
  // enableStrictMode uses the FaceMe web component's encryption: only meaningful with the SDK engine
  form.strictMode.disabled = ENGINE_KIND !== 'faceme';
  if (ENGINE_KIND !== 'faceme') form.strictMode.checked = false;
  renderRealNote();
}
function renderRealNote() { $('real-fields').classList.toggle('inactive', form.mode.value !== 'real'); }
let savedTimer = 0;
function applyForm() {
  cfg = { ...cfg, mode: form.mode.value, cardType: typeSel.value };
  for (const k of TEXT_KEYS) cfg[k] = form[k].value.trim();
  for (const k of BOOL_KEYS) cfg[k] = form[k].checked;
  if (ENGINE_KIND !== 'faceme') cfg.strictMode = false;
  engine.strictMode = !!cfg.strictMode;
  saveConfig(cfg); // token / platform-auth are stripped inside saveConfig
  renderMode(); renderRealNote();
  if (state.step === 'review' && shots.card) renderForgery();
  const s = $('admin-saved'); s.textContent = '已套用'; clearTimeout(savedTimer); savedTimer = setTimeout(() => { s.textContent = ''; }, 1200);
  log({ settings: Object.fromEntries(BOOL_KEYS.map(k => [k, cfg[k]]).concat([['mode', cfg.mode]])) });
}
form.addEventListener('change', applyForm);
form.addEventListener('input', (e) => { if (e.target.matches('input[type=url], input[type=text], input[type=password]')) applyForm(); });
function openSettings() { fillForm(); sheet.hidden = false; document.body.classList.add('sheet-open'); $('btn-settings').setAttribute('aria-expanded', 'true'); $('btn-settings-close').focus({ preventScroll: true }); }
function closeSettings() { sheet.hidden = true; document.body.classList.remove('sheet-open'); $('btn-settings').setAttribute('aria-expanded', 'false'); }
$('btn-settings').addEventListener('click', openSettings);
sheet.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSettings(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) closeSettings(); });
fillForm(); renderMode(); setStep('card');
