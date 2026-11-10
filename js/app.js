import { APP_VERSION } from './version.js?v=2026-11-11c2';
import { Camera } from './camera.js?v=2026-11-11c2';
import { createEngine } from './engines/index.js?v=2026-11-11c2';
import { CARD_ASPECT, CARD_RIGHTSIDE } from './card-detector.js?v=2026-11-11c2';
import { loadConfig, saveConfig, uploadEkyc, CARD_TYPES, stillValue, forgeryApplies, getForgeryRequirement } from './upload.js?v=2026-11-11c2';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const MANUAL_AFTER_MS = Number(params.get('manualAfter') || 12000);

const els = {
  stage: $('stage'), video: $('video'), hint: $('hint'), progress: $('progress'), shade: $('shade'), guide: $('guide'),
  detected: $('detected'), overlay: $('overlay'), flash: $('flash'), metrics: $('metrics'), stageTitle: $('stage-title'),
  manual: $('btn-manual'), banner: $('banner'), hintIcon: $('hint-icon'), shotCount: $('shot-count'), shotGuide: $('shot-guide'),
};
const ICONS = { left: '←', right: '→', up: '↑', down: '↓', closer: '＋', farther: '－', rotate: '↻', flat: '▭', tiltright: '↗', frame: '⛶',
  still: '✋', ok: '✓', glare: '☀', light: '💡', blur: '◎', block: '!', person: '!', eye: '👁', wait: '…' };
const STATE_LEVEL = { hold: 'good', capture: 'good', sdk: 'adjust', loading: 'adjust' };
const camera = new Camera(els.video, els.stage);
let cfg = loadConfig();
const ENGINE_KIND = params.get('engine') === 'faceme' ? 'faceme' : 'opensource';
const engine = createEngine(ENGINE_KIND, { sdkUrl: params.get('sdk') || '', resPath: params.get('sdkRes') || '', strictMode: !!cfg.strictMode });

// In-memory only. Object URLs are revoked whenever an image is replaced or reset.
// card = { image, frames[], type }   face = { image, frames[], stillIndex | (detail, still), cameraInfo }
const shots = { card: null, face: null, cardUrl: null, faceUrl: null, forgeryUrls: [] };
const state = { step: 'intro', retakeOnly: false, guide: null, kind: null, lastHint: '', lastHintAt: 0, manualTimer: 0 };
const forceRef = { now: false };
window.__ekyc = { state, shots, version: APP_VERSION, events: [] };
const log = (e) => { window.__ekyc.events.push({ t: Math.round(performance.now()), ...e }); };

$('ver').textContent = APP_VERSION;
const typeSel = $('card-type');
for (const [v, label] of CARD_TYPES) { const o = document.createElement('option'); o.value = v; o.textContent = label; typeSel.appendChild(o); }
typeSel.value = cfg.cardType || 'TW_ID_CARD_FRONT';
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
  if (kind === 'card') {
    const w = Math.min(cw * 0.88, 560, (ch * 0.6) * CARD_ASPECT), h = w / CARD_ASPECT;
    g = { x: (cw - w) / 2, y: ch * 0.44 - h / 2, w, h };
    const r = Math.min(18, w * 0.04);
    path = roundRectPath(g.x, g.y, g.w, g.h, r);
  } else {
    const w = Math.min(cw * 0.68, ch * 0.5), h = w * 1.32;
    g = { x: (cw - w) / 2, y: ch * 0.43 - h / 2, w, h };
    const rx = w / 2, ry = h / 2, cx = g.x + rx, cy = g.y + ry;
    path = `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
  }
  state.guide = g;
  els.shade.setAttribute('d', `M0 0 H${cw} V${ch} H0 Z ` + path);
  els.guide.setAttribute('d', path);
  els.progress.style.top = (g.y + g.h + 14) + 'px';
}
function roundRectPath(x, y, w, h, r) {
  return `M ${x + r} ${y} H ${x + w - r} A ${r} ${r} 0 0 1 ${x + w} ${y + r} V ${y + h - r} A ${r} ${r} 0 0 1 ${x + w - r} ${y + h} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + h - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
window.addEventListener('resize', () => { if (state.kind) layoutGuide(state.kind); });

// ---------- live UI ----------
const GOOD = new Set(['hold', 'capture', 'steady', 'moving', 'loading', 'sdk']);
const ui = {
  update(out, rectDisplay) {
    const now = performance.now();
    // avoid flicker: a new warning must persist 250 ms unless it is a "good" state
    if (out.hint !== state.lastHint) {
      if (GOOD.has(out.state) || now - state.lastHintAt > 250 || !state.lastHint) {
        if (out.hint !== els.hint.textContent) {
          log({ hint: out.hint, state: out.state, level: out.level, dir: out.dir });
          els.banner.classList.remove('pop'); void els.banner.offsetWidth; els.banner.classList.add('pop');
        }
        els.hint.textContent = out.hint; state.lastHint = out.hint; state.lastHintAt = now;
        els.stage.dataset.state = out.state;
        els.stage.dataset.level = out.level || STATE_LEVEL[out.state] || 'adjust';
        els.stage.dataset.dir = out.dir || '';
        els.hintIcon.textContent = ICONS[out.dir] || '';
        els.stage.classList.toggle('warn', !GOOD.has(out.state) && out.state !== 'search' && out.state !== 'noface');
      }
    } else state.lastHintAt = now;
    els.progress.classList.toggle('on', out.progress > 0);
    els.progress.firstElementChild.style.width = Math.round((out.progress || 0) * 100) + '%';
    if (rectDisplay) {
      els.detected.setAttribute('x', rectDisplay.x); els.detected.setAttribute('y', rectDisplay.y);
      els.detected.setAttribute('width', Math.max(0, rectDisplay.w)); els.detected.setAttribute('height', Math.max(0, rectDisplay.h));
      els.detected.classList.add('on');
    } else els.detected.classList.remove('on');
    if (DEBUG) els.metrics.textContent = out.state + ' ' + JSON.stringify(out.metrics || {});
    window.__ekyc.last = { state: out.state, hint: out.hint, level: els.stage.dataset.level, dir: out.dir, metrics: out.metrics };
  },
};

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

async function runCapture(kind) {
  setStep(kind);
  show('capture');
  forceRef.now = false;
  els.manual.hidden = true;
  clearTimeout(state.manualTimer);
  state.lastHint = '';
  els.hint.textContent = '準備相機中…'; els.hintIcon.textContent = ICONS.wait;
  els.stage.dataset.state = 'loading'; els.stage.dataset.level = 'adjust'; els.stage.dataset.dir = 'wait';
  els.shotCount.hidden = true; els.shotGuide.hidden = true;
  els.stageTitle.textContent = kind === 'card' ? `步驟 1／3：拍攝${typeLabel()}（後鏡頭）` : '步驟 2／3：拍攝人臉（自拍鏡頭）';
  layoutGuide(kind);
  await camera.open(kind === 'card' ? 'environment' : 'user');
  layoutGuide(kind);
  log({ camera: camera.facing, w: els.video.videoWidth, h: els.video.videoHeight });
  state.manualTimer = setTimeout(() => { els.manual.hidden = false; }, MANUAL_AFTER_MS);
  const ctx = { camera, stage: els.stage, ui, getGuide: () => state.guide, forceRef, cardType: typeSel.value };
  const raw = kind === 'card' ? await engine.captureIdCard(ctx) : await engine.captureFace(ctx);
  clearTimeout(state.manualTimer);
  flash();
  // engines may return a bare Blob (e.g. FaceMe SDK adapter) or { image, frames, ... }
  const shot = raw instanceof Blob ? { image: raw, frames: [raw], stillIndex: 0 } : raw;
  if (kind === 'card') {
    shot.type = typeSel.value;
    if (forgeryApplies(cfg, shot.type)) shot.forgery = await runForgery(ctx);
  }
  if (kind === 'face' && !shot.cameraInfo) shot.cameraInfo = camera.info();
  log({ captured: kind, bytes: shot.image.size, frames: shot.frames.length, still: kind === 'face' ? stillValue(shot, cfg) : undefined, manual: forceRef.now });
  setShot(kind, shot);
  await new Promise(r => setTimeout(r, 350));
  return shot;
}

// Forgery shots: N 'front' (from directly above) + M 'rightSide' (from the upper right, tilted), counts from the
// Forgery Requirements API when available. Uses the same open rear camera.
async function runForgery(baseCtx) {
  const type = typeSel.value;
  els.hint.textContent = '準備證件防偽拍攝…'; state.lastHint = '';
  const req = await getForgeryRequirement(cfg, type);
  log({ forgeryRequirement: req });
  const plan = [];
  for (let i = 0; i < req.front; i++) plan.push({ direction: 'front', i: i + 1, n: req.front, full: i < req.full });
  for (let i = 0; i < req.rightSide; i++) plan.push({ direction: 'rightSide', i: i + 1, n: req.rightSide, full: false });
  const out = { shots: [], full: [], counts: req };
  for (const p of plan) {
    const front = p.direction === 'front';
    els.stageTitle.textContent = `證件防偽：${front ? '正面' : '右上斜拍'} 第 ${p.i}/${p.n} 張`;
    els.shotCount.textContent = `${front ? '正面' : '右上斜拍'} 第 ${p.i}/${p.n} 張`;
    els.shotCount.hidden = false;
    els.shotGuide.innerHTML = front
      ? '手機與證件平行、從<b>正上方</b>拍。每拍一張後會提示下一張。'
      : '把手機移到證件<b>右上方</b>，鏡頭斜斜朝左下（約 20–30 度），證件仍要整張在框內。';
    els.shotGuide.hidden = false;
    state.lastHint = '';
    ui.update({ state: 'search', hint: front ? `正面第 ${p.i} 張：請從正上方對準證件` : `右上斜拍第 ${p.i} 張：手機移到證件右上方斜拍`, level: 'adjust', dir: front ? 'frame' : 'tiltright', progress: 0 });
    await new Promise(r => setTimeout(r, p.i === 1 ? 900 : 450)); // let the user read / move between shots
    forceRef.now = false; els.manual.hidden = true; clearTimeout(state.manualTimer);
    state.manualTimer = setTimeout(() => { els.manual.hidden = false; }, MANUAL_AFTER_MS);
    const opts = front ? { steadyMs: 350 } : CARD_RIGHTSIDE;
    const r = await engine.captureCardShot({ ...baseCtx, cardOptions: opts, keep: 1, grabFull: p.full });
    clearTimeout(state.manualTimer);
    flash();
    out.shots.push({ blob: r.image, direction: p.direction });
    if (r.full) out.full.push(r.full);
    log({ forgeryShot: p.direction, i: p.i, n: p.n, bytes: r.image.size, manual: forceRef.now });
  }
  els.shotCount.hidden = true; els.shotGuide.hidden = true;
  return out;
}

function setShot(kind, shot) {
  const key = kind + 'Url';
  if (shots[key]) URL.revokeObjectURL(shots[key]);
  if (kind === 'card') { shots.forgeryUrls.forEach(u => URL.revokeObjectURL(u)); shots.forgeryUrls = []; }
  shots[kind] = shot; shots[key] = URL.createObjectURL(shot.image);
}

async function flow(from) {
  try {
    if (from === 'card') {
      await runCapture('card');
      if (!(state.retakeOnly && shots.face)) await runCapture('face');
    } else if (from === 'face') {
      await runCapture('face');
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
  $('card-meta').textContent = `${typeLabel()}・保留 ${shots.card.frames.length} 張供 OCR（顯示最清晰的一張）` + (shots.card.frames.length < 3 ? '。手動拍照只有 1 張，OCR 可能要求補拍，建議重拍讓系統自動拍。' : '');
  renderForgery();
  $('face-meta').textContent = `活體序列 ${shots.face.frames.length} 張` + (shots.face.detail ? '・活體資料由 FaceMe SDK 產生' : `・靜止幀為第 ${(shots.face.stillIndex ?? 0) + 1} 張`);
  $('upload-result').hidden = true;
  $('btn-upload').disabled = false;
  renderMode();
}

function renderForgery() {
  const fig = $('forgery-fig'), strip = $('forgery-strip'), f = shots.card && shots.card.forgery;
  fig.hidden = !f; strip.innerHTML = '';
  if (!f) return;
  shots.forgeryUrls.forEach(u => URL.revokeObjectURL(u)); shots.forgeryUrls = [];
  const cnt = { front: 0, rightSide: 0 };
  for (const s of f.shots) {
    cnt[s.direction]++;
    const u = URL.createObjectURL(s.blob); shots.forgeryUrls.push(u);
    const fg = document.createElement('figure');
    fg.innerHTML = `<img alt=""><figcaption>${s.direction === 'front' ? '正面' : '右上'} ${cnt[s.direction]}</figcaption>`;
    fg.querySelector('img').src = u; strip.appendChild(fg);
  }
  $('forgery-meta').textContent = `正面 ${cnt.front} 張＋右上斜拍 ${cnt.rightSide} 張` + (f.full.length ? `＋全幅 ${f.full.length} 張` : '') +
    `（張數來源：${f.counts.source === 'api' ? 'Forgery Requirements API' : '預設 5＋2'}）・上傳時呼叫 idcard/forgery`;
}

// ---------- buttons ----------
$('btn-start').addEventListener('click', () => {
  $('intro-error').hidden = true;
  state.retakeOnly = false;
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
      html += `<div class="ok">✓ 模擬上傳完成</div><div>資料沒有離開這支手機。實際上傳時會依序呼叫：</div>`;
      html += '<ol class="steps-list">' + r.steps.map(s => `<li>${esc(s.name)}</li>`).join('') + '</ol>';
      html += `<div class="note">證件 ${shots.card.frames.length} 張（${kb(shots.card.frames)}）、人臉序列 ${shots.face.frames.length} 張（${kb(shots.face.frames)}）。</div>`;
    } else {
      html += `<div class="${allOk ? 'ok' : 'bad'}">${allOk ? '✓ 驗證完成' : '✗ 驗證未通過，請依下方說明處理'}</div>`;
      if (r.request && r.request.requestUuid) html += `<div class="note">eKYC 案件：${esc(r.request.requestUuid)}</div>`;
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
const BOOL_KEYS = ['useRequest', 'doSpoof', 'doOcr', 'doCompare', 'strictMode', 'deepfake', 'imageDeskewed', 'idLargestFace', 'stillZeroBased', 'doForgery'];
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
function renderRealNote() {
  const real = form.mode.value === 'real';
  $('real-fields').classList.toggle('inactive', !real);
  $('real-note').textContent = real ? '目前為實際上傳，下列設定會在按「上傳」時使用。' : '目前為模擬上傳；下列設定可先調整，切換到「實際上傳」時才會使用。';
}
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
