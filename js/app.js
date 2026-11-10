import { APP_VERSION } from './version.js?v=2026-11-11b';
import { Camera } from './camera.js?v=2026-11-11b';
import { createEngine } from './engines/index.js?v=2026-11-11b';
import { CARD_ASPECT } from './card-detector.js?v=2026-11-11b';
import { loadConfig, saveConfig, uploadEkyc, CARD_TYPES } from './upload.js?v=2026-11-11b';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const MANUAL_AFTER_MS = Number(params.get('manualAfter') || 12000);

const els = {
  stage: $('stage'), video: $('video'), hint: $('hint'), progress: $('progress'), shade: $('shade'), guide: $('guide'),
  detected: $('detected'), overlay: $('overlay'), flash: $('flash'), metrics: $('metrics'), stageTitle: $('stage-title'),
  manual: $('btn-manual'),
};
const camera = new Camera(els.video, els.stage);
const engine = createEngine(params.get('engine') || 'opensource', { sdkUrl: params.get('sdk') || '' });
let cfg = loadConfig();

// In-memory only. Object URLs are revoked whenever an image is replaced or reset.
// card = { image, frames[], type }   face = { image, frames[], still, cameraInfo }
const shots = { card: null, face: null, cardUrl: null, faceUrl: null };
const state = { step: 'intro', retakeOnly: false, guide: null, kind: null, lastHint: '', lastHintAt: 0, manualTimer: 0 };
const forceRef = { now: false };
window.__ekyc = { state, shots, version: APP_VERSION, events: [] };
const log = (e) => { window.__ekyc.events.push({ t: Math.round(performance.now()), ...e }); };

$('ver').textContent = APP_VERSION;
const typeSel = $('card-type');
for (const [v, label] of CARD_TYPES) { const o = document.createElement('option'); o.value = v; o.textContent = label; typeSel.appendChild(o); }
typeSel.value = cfg.cardType || 'TW_ID_CARD_FRONT';
typeSel.addEventListener('change', () => { cfg.cardType = typeSel.value; if (cfg.remember) saveConfig(cfg); });
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
        if (out.hint !== els.hint.textContent) log({ hint: out.hint, state: out.state });
        els.hint.textContent = out.hint; state.lastHint = out.hint; state.lastHintAt = now;
        els.stage.dataset.state = out.state;
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
    window.__ekyc.last = { state: out.state, hint: out.hint, metrics: out.metrics };
  },
};

function flash() { els.flash.classList.remove('go'); void els.flash.offsetWidth; els.flash.classList.add('go'); }

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
  els.hint.textContent = '準備相機中…';
  els.stage.dataset.state = 'loading';
  els.stageTitle.textContent = kind === 'card' ? `步驟 1／3：拍攝${typeLabel()}（後鏡頭）` : '步驟 2／3：拍攝人臉（自拍鏡頭）';
  layoutGuide(kind);
  await camera.open(kind === 'card' ? 'environment' : 'user');
  layoutGuide(kind);
  log({ camera: camera.facing, w: els.video.videoWidth, h: els.video.videoHeight });
  state.manualTimer = setTimeout(() => { els.manual.hidden = false; }, MANUAL_AFTER_MS);
  const ctx = { camera, stage: els.stage, ui, getGuide: () => state.guide, forceRef };
  const raw = kind === 'card' ? await engine.captureIdCard(ctx) : await engine.captureFace(ctx);
  clearTimeout(state.manualTimer);
  flash();
  // engines may return a bare Blob (e.g. FaceMe SDK adapter) or { image, frames, ... }
  const shot = raw instanceof Blob ? { image: raw, frames: [raw], still: 0 } : raw;
  if (kind === 'card') shot.type = typeSel.value;
  if (kind === 'face' && !shot.cameraInfo) shot.cameraInfo = camera.info();
  log({ captured: kind, bytes: shot.image.size, frames: shot.frames.length, still: shot.still, manual: forceRef.now });
  setShot(kind, shot);
  await new Promise(r => setTimeout(r, 350));
  return shot;
}

function setShot(kind, shot) {
  const key = kind + 'Url';
  if (shots[key]) URL.revokeObjectURL(shots[key]);
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
  $('face-meta').textContent = `活體序列 ${shots.face.frames.length} 張・靜止幀 #${shots.face.still}`;
  $('upload-result').hidden = true;
  $('btn-upload').disabled = false;
  renderMode();
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
      html += r.steps.map(s => {
        let line = `<div class="step-res"><div class="${s.ok ? 'ok' : 'bad'}">${s.ok ? '✓' : '✗'} ${esc(s.name)}：${esc(s.verdict || s.error || '')}</div>`;
        if (s.summary) line += `<div class="note">${esc(s.summary).slice(0, 600)}</div>`;
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

// ---------- admin settings ----------
const form = $('admin-form');
const BOOL_KEYS = ['doSpoof', 'doOcr', 'doCompare', 'strictMode', 'deepfake', 'imageDeskewed', 'remember'];
function fillForm() {
  form.mode.value = cfg.mode;
  for (const k of ['baseUrl', 'token', 'platformAuth']) form[k].value = cfg[k] || '';
  for (const k of BOOL_KEYS) form[k].checked = !!cfg[k];
  $('real-fields').disabled = cfg.mode !== 'real';
}
form.addEventListener('change', () => { $('real-fields').disabled = form.mode.value !== 'real'; });
$('btn-save-admin').addEventListener('click', () => {
  cfg = { ...cfg, mode: form.mode.value, baseUrl: form.baseUrl.value.trim(), token: form.token.value.trim(), platformAuth: form.platformAuth.value.trim(), cardType: typeSel.value };
  for (const k of BOOL_KEYS) cfg[k] = form[k].checked;
  saveConfig(cfg); renderMode();
  const s = $('admin-saved'); s.hidden = false; setTimeout(() => { s.hidden = true; }, 1500);
});
fillForm(); renderMode(); setStep('card');
