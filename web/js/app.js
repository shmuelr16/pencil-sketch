/* Page logic: picking a photo, the before/after slider, the four sliders and saving.
 * The same files run on the website and inside the Mac app (window.webkit.messageHandlers.pencil). */
import { PencilSketch, DEFAULTS } from './pencil.js';

const $ = (id) => document.getElementById(id);
const native = (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.pencil) || null;   // Mac app
const winShell = !!(window.chrome && window.chrome.webview);                                                       // Windows app (WebView2)

const LABELS = {
  load: 'פותח את התמונה…', detect: 'מזהה פנים ורקע…', resize: 'מכין את הדף…', smooth: 'מחליק גוונים…',
  edges: 'מחפש קווי מתאר…', tone: 'ממפה אור וצל…', eyes: 'מטפל בעיניים…', paper: 'מכין את הנייר…',
  strokes: 'מושך קווים…', hatch: 'מקווקו צללים…', compose: 'נגיעות אחרונות…', done: 'מוכן!',
};
const SLIDERS = ['darkness', 'thickness', 'density', 'paper'];

const el = {
  empty: $('empty'), work: $('work'), compare: $('compare'), after: $('after'), before: $('before'),
  divider: $('divider'), knob: $('knob'), tagAfter: $('tagAfter'), tagBefore: $('tagBefore'),
  busy: $('busy'), busyLabel: $('busyLabel'), bar: $('bar'), barFill: $('barFill'), busyPct: $('busyPct'),
  mini: $('mini'), note: $('note'), size: $('size'), engine: $('engine'), toast: $('toast'), dropveil: $('dropveil'),
  file: $('file'), camera: $('camera'), savePng: $('savePng'), saveJpg: $('saveJpg'),
};

const params = Object.assign({}, DEFAULTS);
let baseName = 'pencil-sketch';
let hasResult = false;
let working = false;
let beforeUrl = null;
let shownP = 0;

const ps = new PencilSketch({ onProgress: showProgress });
ps.ready.then(() => { el.engine.textContent = 'כלי הציור מוכנים ✏️'; })
  .catch(() => { el.engine.textContent = 'לא הצלחתי לטעון את כלי הציור. כדאי לרענן את הדף.'; });

/* ---------- progress ---------- */
function showProgress(p, label) {
  if (p < shownP && p > 0.02) return;
  shownP = p;
  const pct = Math.round(p * 100);
  el.barFill.style.width = pct + '%';
  el.bar.setAttribute('aria-valuenow', String(pct));
  el.busyPct.textContent = pct + '%';
  if (LABELS[label]) el.busyLabel.textContent = LABELS[label];
}

let toastTimer = 0;
function toast(text, ms = 4200) {
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

/* ---------- before / after slider ---------- */
let pos = 0.5;
function setPos(v) {
  pos = Math.min(1, Math.max(0, v));
  el.compare.style.setProperty('--pos', pos.toFixed(4));
  el.knob.setAttribute('aria-valuenow', String(Math.round(pos * 100)));
}
function posFromEvent(ev) {
  const r = el.compare.getBoundingClientRect();
  return (ev.clientX - r.left) / r.width;
}
let dragging = false;
el.compare.addEventListener('pointerdown', (ev) => {
  if (!hasResult || working || ev.button > 0) return;
  dragging = true;
  cancelAnimationFrame(revealRaf);
  el.compare.setPointerCapture(ev.pointerId);
  setPos(posFromEvent(ev));
});
el.compare.addEventListener('pointermove', (ev) => { if (dragging) setPos(posFromEvent(ev)); });
const stopDrag = () => { dragging = false; };
el.compare.addEventListener('pointerup', stopDrag);
el.compare.addEventListener('pointercancel', stopDrag);
el.knob.addEventListener('keydown', (ev) => {
  const step = ev.shiftKey ? 0.1 : 0.02;
  if (ev.key === 'ArrowLeft') setPos(pos - step);
  else if (ev.key === 'ArrowRight') setPos(pos + step);
  else if (ev.key === 'Home') setPos(0);
  else if (ev.key === 'End') setPos(1);
  else return;
  ev.preventDefault();
});

let revealRaf = 0;
function reveal() {          // wipe from the photo to the drawing, then rest in the middle
  const t0 = performance.now(), from = 0, to = 0.5, dur = 1100;   // pos 0 = the photo covers everything
  setPos(from);
  const tick = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    setPos(from + (to - from) * e);
    if (t < 1 && !dragging) revealRaf = requestAnimationFrame(tick);
  };
  revealRaf = requestAnimationFrame(tick);
}

function setCompareMode(on) {
  el.compare.classList.toggle('plain', !on);
  el.divider.hidden = !on;
  el.tagAfter.hidden = !on;
  el.tagBefore.hidden = !on;
}

/* ---------- running the engine ---------- */
function draw(result) {
  if (el.after.width !== result.width || el.after.height !== result.height) {
    el.after.width = result.width; el.after.height = result.height;
  }
  el.after.getContext('2d').putImageData(result.imageData, 0, 0);
  el.compare.style.setProperty('--ar', (result.width / result.height).toFixed(5));
}

async function handleFile(blob, name) {
  if (!blob) return;
  if (blob.type && !blob.type.startsWith('image/')) { toast('זה לא נראה כמו קובץ תמונה. אפשר JPG, PNG או WebP.'); return; }
  if (working) { toast('רגע, עוד מציירים את התמונה הקודמת…'); return; }
  working = true;
  hasResult = false;
  baseName = (name || 'photo').replace(/\.[^.]+$/, '').slice(0, 60) || 'photo';

  el.empty.hidden = true;
  el.work.hidden = false;
  el.note.hidden = true;
  el.mini.hidden = true;
  el.size.textContent = '';
  el.savePng.disabled = el.saveJpg.disabled = true;
  setCompareMode(false);
  if (beforeUrl) URL.revokeObjectURL(beforeUrl);
  beforeUrl = URL.createObjectURL(blob);
  el.before.onload = () => {
    if (!hasResult && el.before.naturalWidth) el.compare.style.setProperty('--ar', (el.before.naturalWidth / el.before.naturalHeight).toFixed(5));
  };
  el.before.src = beforeUrl;
  el.after.getContext('2d').clearRect(0, 0, el.after.width, el.after.height);
  shownP = 0;
  showProgress(0.01, 'load');
  el.busyLabel.textContent = LABELS.load;
  el.busy.hidden = false;
  if (window.matchMedia('(max-width: 880px)').matches) el.work.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const result = await ps.process(blob, params);
    draw(result);
    hasResult = true;
    el.busy.hidden = true;
    setCompareMode(true);
    reveal();
    el.savePng.disabled = el.saveJpg.disabled = false;
    el.size.textContent = `${result.width} × ${result.height} פיקסלים · צויר ב-${(result.totalMs / 1000).toFixed(1)} שניות`;
    const notes = [];
    if (!result.stats.hasPerson) notes.push('לא זיהיתי אדם בתמונה, אז ציירתי את כולה כמו שהיא.');
    else if (!result.stats.faces) notes.push('לא זיהיתי פנים, אז דילגתי על הטיפול המיוחד בעיניים.');
    el.note.textContent = notes.join(' ');
    el.note.hidden = !notes.length;
    return result;
  } catch (err) {
    console.error(err);
    el.busy.hidden = true;
    el.work.hidden = true;
    el.empty.hidden = false;
    const msg = /decode/.test(String(err && err.message))
      ? 'לא הצלחתי לפתוח את התמונה הזאת. כדאי לנסות JPG או PNG.'
      : 'משהו השתבש בזמן הציור. אפשר לנסות שוב, או עם תמונה אחרת.';
    toast(msg, 6000);
    throw err;
  } finally {
    working = false;
  }
}

/* ---------- sliders ---------- */
function syncSliders() {
  for (const key of SLIDERS) {
    $(key).value = String(params[key]);
    $(key + 'Out').textContent = Math.round(params[key] * 100) + '%';
  }
}
let updateRaf = 0;
function scheduleUpdate() {
  if (!hasResult || working) return;
  cancelAnimationFrame(updateRaf);
  updateRaf = requestAnimationFrame(async () => {
    el.mini.hidden = false;
    const r = await ps.update(params);
    if (r) { draw(r); el.mini.hidden = true; }
  });
}
for (const key of SLIDERS) {
  $(key).addEventListener('input', (ev) => {
    params[key] = Number(ev.target.value);
    $(key + 'Out').textContent = Math.round(params[key] * 100) + '%';
    scheduleUpdate();
  });
}
$('reset').addEventListener('click', () => { Object.assign(params, DEFAULTS); syncSliders(); scheduleUpdate(); });
syncSliders();

/* ---------- saving ---------- */
function canvasBlob(type) {
  return new Promise((resolve) => {
    if (type === 'image/jpeg') {            // JPEG has no alpha; the canvas is opaque already
      el.after.toBlob(resolve, type, 0.95);
    } else {
      el.after.toBlob(resolve, type);
    }
  });
}
async function save(type) {
  if (!hasResult) return;
  const ext = type === 'image/png' ? 'png' : 'jpg';
  const name = `${baseName}-sketch.${ext}`;
  const blob = await canvasBlob(type);
  if (!blob) { toast('השמירה נכשלה, אפשר לנסות שוב.'); return; }
  if (native) {
    const reader = new FileReader();
    reader.onload = () => native.postMessage({ save: { name, base64: String(reader.result).split(',')[1] } });
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  if (!winShell) toast(`נשמר: ${name}`, 2600);      // the Windows app shows its own Save dialog
}
el.savePng.addEventListener('click', () => save('image/png'));
el.saveJpg.addEventListener('click', () => save('image/jpeg'));

/* ---------- picking a photo ---------- */
const coarse = window.matchMedia('(pointer: coarse)').matches;
if (coarse) {
  $('shoot').hidden = false;
  $('pickLabel').textContent = 'מהגלריה';
  document.querySelector('.drop h2').textContent = 'בוחרים תמונה, ומקבלים ציור';
}
if (native || winShell) {
  for (const b of [el.savePng, el.saveJpg]) b.querySelector('span').textContent = b.querySelector('span').textContent.replace('הורדה', 'שמירה');
  document.querySelector('.foot p').textContent = native
    ? 'הציור נוצר כולו במחשב שלך, בלי אינטרנט. אפשר גם לגרור תמונה על האייקון ב-Dock.'
    : 'הציור נוצר כולו במחשב שלך, בלי אינטרנט.';
}
/* Ctrl/Cmd+O opens a picture, Ctrl/Cmd+S saves a PNG (the Mac app does the same through its menu) */
window.addEventListener('keydown', (ev) => {
  if (!(ev.ctrlKey || ev.metaKey) || ev.altKey || ev.shiftKey) return;
  const key = ev.key.toLowerCase();
  if (key === 'o') { ev.preventDefault(); el.file.click(); }
  else if (key === 's') { ev.preventDefault(); if (hasResult) save('image/png'); }
});
$('pick').addEventListener('click', () => el.file.click());
$('shoot').addEventListener('click', () => el.camera.click());
$('another').addEventListener('click', () => el.file.click());
for (const input of [el.file, el.camera]) {
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) handleFile(f, f.name).catch(() => {});
  });
}
$('sample').addEventListener('click', async () => {
  try {
    const blob = await (await fetch('samples/sample.jpg')).blob();
    await handleFile(blob, 'sample.jpg');
  } catch (e) { /* handled in handleFile */ }
});

/* ---------- "get the desktop app" (website only): point at the installer for this computer ---------- */
function detectDesktop() {
  const ua = navigator.userAgent || '';
  const plat = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'mobile';
  if (/Mac/i.test(plat) && navigator.maxTouchPoints > 1) return 'mobile';      // iPadOS says it is a Mac
  if (/Win/i.test(plat) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(plat) || /Macintosh/i.test(ua)) return 'mac';
  return 'other';
}
(function setupGetApp() {
  const box = $('getapp');
  if (native || winShell) return;                      // already inside the app
  const os = detectDesktop();
  if (os === 'mobile') return;                         // nothing to install on a phone
  const mac = $('dlMac'), win = $('dlWin'), note = $('getappNote');
  const hint = document.createElement('span');
  if (os === 'mac') {
    mac.classList.add('primary');
    win.classList.add('small');
    $('getappTitle').textContent = 'זיהיתי שאתם במק. רוצים את זה כאפליקציה?';
    hint.textContent = 'בפתיחה הראשונה: הגדרות המערכת ← פרטיות ואבטחה ← Open Anyway. ';
  } else if (os === 'windows') {
    win.classList.add('primary');
    mac.classList.add('small');
    win.parentNode.insertBefore(win, mac);             // the matching button comes first
    $('getappTitle').textContent = 'זיהיתי שאתם ב-Windows. רוצים את זה כאפליקציה?';
    hint.textContent = 'אם מופיע חלון כחול: More info ואז Run anyway. ';
  } else {
    hint.textContent = 'יש גרסה למק ול-Windows. ';
  }
  note.insertBefore(hint, note.firstChild);
  box.dataset.os = os;
  box.hidden = false;
})();

/* drag & drop anywhere on the page */
let dragDepth = 0;
const hasFiles = (ev) => ev.dataTransfer && Array.from(ev.dataTransfer.types || []).includes('Files');
window.addEventListener('dragenter', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); dragDepth++; el.dropveil.hidden = false; });
window.addEventListener('dragover', (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (ev) => { if (!hasFiles(ev)) return; dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.dropveil.hidden = true; });
window.addEventListener('drop', (ev) => {
  if (!hasFiles(ev)) return;
  ev.preventDefault();
  dragDepth = 0; el.dropveil.hidden = true;
  const f = Array.from(ev.dataTransfer.files || []).find((x) => !x.type || x.type.startsWith('image/'));
  if (f) handleFile(f, f.name).catch(() => {});
  else toast('אפשר לגרור לכאן רק קובצי תמונה.');
});
window.addEventListener('paste', (ev) => {
  const item = Array.from((ev.clipboardData && ev.clipboardData.items) || []).find((i) => i.type.startsWith('image/'));
  if (item) { const f = item.getAsFile(); if (f) handleFile(f, 'pasted.png').catch(() => {}); }
});

/* ---------- hooks for the Mac app ---------- */
/* a file dropped on the Dock icon or opened with the app arrives as a URL served by the app itself */
window.pencilOpenURL = async (url, name) => {
  try {
    const blob = await (await fetch(url)).blob();
    await handleFile(blob, name);
  } catch (e) { /* handled in handleFile */ }
};
/* PENCIL_SELFTEST=1: run the engine on the bundled sample and report */
window.pencilSelfTest = async () => {
  try {
    const blob = await (await fetch('samples/sample.jpg')).blob();
    const r = await handleFile(blob, 'sample.jpg');
    const d = r.imageData.data;
    let sum = 0, n = 0, lo = 255;
    for (let i = 0; i < d.length; i += 4 * 97) { sum += d[i]; n++; if (d[i] < lo) lo = d[i]; }
    const mean = sum / n;
    return JSON.stringify({ ok: mean > 90 && mean < 245 && lo < 80, width: r.width, height: r.height,
      engineMs: r.ms, totalMs: r.totalMs, faces: r.stats.faces, person: r.stats.hasPerson, mean: Math.round(mean) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  }
};
window.pencilReady = true;
