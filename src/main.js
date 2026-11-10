import { audio } from './audio.js';
import { createWriter, SHEET } from './paper.js';
import { createRitual } from './ritual.js';
import { createRecap } from './recap.js';

const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SVG = 'http://www.w3.org/2000/svg';

const INKS = {
  ai:      { en: 'indigo',     short: 'blue',  c: '#1b3a6b' },
  sumi:    { en: 'soot black', short: 'black', c: '#272523' },
  enji:    { en: 'crimson',    short: 'red',   c: '#8a1f2d' },
  matsuba: { en: 'pine green', short: 'green', c: '#2c5a43' },
};

const PAPER = { x: 490, y: 150 };        // where the sheet sits on the stage
const SEAL = '文';

const state = { mode: 'idle', ink: 'ai', sound: true, rain: false, sheets: [], swapping: false, stamping: false, typed: false, prepared: false };

const stage = $('#stage');
const wrap = $('#sheet-wrap');
const bunchin = $('#bunchin');
const ta = $('#input');
const penEl = $('#pen-top');
let sheetEl = null;
let recap = null;

/* ───────────── stage fit ───────────── */

function fit() {
  const vw = innerWidth, vh = innerHeight;
  let s = Math.min(vw / 1600, vh / 1000), shift = 0;
  if (vw / vh < 1.45) {
    // narrow window: keep the paper and the pen tray, let the rest fall off the edges
    s = Math.min(vh / 1000, vw / 900);
    shift = -Math.min(80, Math.max(0, (1600 * s - vw) / 2 / s));
  }
  stage.style.setProperty('--s', s.toFixed(4));
  stage.style.setProperty('--shift', `${shift.toFixed(1)}px`);
}
addEventListener('resize', fit);
fit();

function setMode(m) {
  state.mode = m;
  document.body.dataset.mode = m;
  ta.disabled = m !== 'writing';
  $('#d-pen').setAttribute('aria-label', m === 'writing' ? 'Cap the pen and pause writing' : 'Take the pen');
  $('#d-pen-title').textContent = m === 'writing' ? 'Click to recap, or drag the cap to the pen' : 'Take the pen';
  $('#pen-caption').textContent = m === 'writing' ? 'click or drag to recap' : 'take the pen';
  penEl.setAttribute('tabindex', m === 'writing' ? '0' : '-1');
  $('#about-open').disabled = m === 'handling';
  for (const b of document.querySelectorAll('#bar .bar-left button')) b.disabled = m !== 'writing';
}

/* ───────────── hint ───────────── */

const hintEl = $('#hint');
let hintTimer = 0;
function hint(num, text, ms) {
  clearTimeout(hintTimer);
  if (!text) { hintEl.classList.remove('on'); return; }
  hintEl.querySelector('b').textContent = num || '';
  hintEl.querySelector('span').textContent = text;
  hintEl.classList.add('on');
  if (ms) hintTimer = setTimeout(() => hintEl.classList.remove('on'), ms);
}
function nudge() {
  hintEl.classList.remove('nudge');
  void hintEl.offsetWidth;
  hintEl.classList.add('nudge');
}

/* ───────────── desk dressing ───────────── */

{
  // leaf shadows
  const set = $('#leafset');
  for (let i = 0; i < 36; i++) {
    const t = Math.random();
    const e = document.createElementNS(SVG, 'ellipse');
    const x = 1130 + t * 520 + rnd(-50, 50), y = 150 - t * 170 + rnd(-80, 100);
    e.setAttribute('cx', x); e.setAttribute('cy', y);
    e.setAttribute('rx', rnd(26, 46)); e.setAttribute('ry', rnd(9, 16));
    e.setAttribute('transform', `rotate(${rnd(-70, 70)} ${x} ${y})`);
    set.append(e);
  }

  // ink bottles, seen from above
  const spots = [[1376, 248], [1472, 248], [1376, 344], [1472, 344]];
  $('#d-inks').innerHTML = Object.entries(INKS).map(([id, k], i) => {
    return `<g class="clickable d-ink" data-ink="${id}" transform="translate(${spots[i][0]} ${spots[i][1]})">
      <title>${k.en} ink</title>
      <circle r="40" fill="${k.c}"/><circle r="40" fill="url(#gGlassTop)"/>
      <circle r="27" fill="#141414" filter="url(#shSoft)"/><circle r="26.5" fill="none" stroke="rgba(255,255,255,.2)"/>
      <circle r="19" fill="#f3ecdb"/>
      <text y="3" text-anchor="middle" font-size="8" fill="${k.c}">${k.short}</text>
      <circle class="ring" r="44" fill="none" stroke="#e8c46a" stroke-width="1.6"/>
    </g>`;
  }).join('');
}

function showInk(id) {
  const k = INKS[id];
  document.documentElement.style.setProperty('--ink', k.c);
  $('#inkstat-n').textContent = k.en;
  $('#inkstat').title = `${k.en} ink remaining`;
  for (const g of document.querySelectorAll('.d-ink')) g.classList.toggle('on', g.dataset.ink === id);
}

function addStain(id) {
  const c = document.createElementNS(SVG, 'ellipse');
  const x = rnd(1370, 1480), y = rnd(516, 596);
  c.setAttribute('cx', x); c.setAttribute('cy', y);
  c.setAttribute('rx', rnd(9, 17)); c.setAttribute('ry', rnd(5, 9));
  c.setAttribute('transform', `rotate(${rnd(-40, 40)} ${x} ${y})`);
  c.setAttribute('fill', INKS[id].c);
  c.setAttribute('opacity', 0.7);
  $('#d-stains').append(c);
}

/* ───────────── the draft tape ───────────── */

const tape = $('#tape');
const ghost = $('#tape-ghost');
const spans = new Map();
const stack = [];
let opId = 0, tapeOff = 0;

function tapeAdd(ch) {
  const id = ++opId;
  const s = document.createElement('span');
  if (ch === '\n') { s.textContent = '↵'; s.className = 'nl'; }
  else s.textContent = ch === ' ' ? ' ' : ch;
  tape.append(s);
  tapeOff += s.offsetWidth;
  spans.set(id, s);
  stack.push(s);
  while (tape.children.length > 90) tape.firstElementChild.remove();
  if (stack.length > 400) stack.splice(0, 200);
  return id;
}

function tapeStrike() {
  stack.pop()?.classList.add('struck');
  return ++opId;
}

/* ───────────── writer & the pen in the hand ───────────── */

const disp = { x: 720, y: 60, lift: 1, a: 50 };
let lastPen = performance.now(), lastScratch = 0;

const writer = createWriter({
  pen(x, y, down, idle) {
    if (recap?.active) return;
    const now = performance.now(), dt = Math.min(60, now - lastPen);
    lastPen = now;
    const k = 1 - Math.exp(-dt / (down ? 18 : 95));
    const dx = x - disp.x;
    disp.x += dx * k;
    disp.y += (y - disp.y) * k;
    const liftTo = down ? 0 : idle > 2600 ? 1 : 0.5;
    disp.lift += (liftTo - disp.lift) * (1 - Math.exp(-dt / 120));
    const ang = 50 + clamp(dx * 0.45, -3.5, 3.5) + Math.sin(now / 1100) * 0.5 * disp.lift;
    disp.a += (ang - disp.a) * 0.25;
    penEl.style.transform = `translate(${(disp.x - 5 * disp.lift).toFixed(2)}px, ${(disp.y - 10 * disp.lift).toFixed(2)}px) rotate(${disp.a.toFixed(2)}deg)`;
    penEl.style.setProperty('--lift', disp.lift.toFixed(3));

    if (Math.abs(tapeOff) > 0.3) { tapeOff *= Math.exp(-dt / 55); tape.style.transform = `translateX(${tapeOff.toFixed(1)}px)`; }
    else if (tapeOff) { tapeOff = 0; tape.style.transform = ''; }
  },
  scratch(level) {
    if (level === 0 && lastScratch === 0) return;
    lastScratch = level;
    audio.scratch(state.mode === 'writing' && !document.hidden && !$('#about').open ? level : 0);
  },
  ink(level) {
    $('#inkstat-bar').style.width = `${Math.round(level * 100)}%`;
    $('#pen-level').setAttribute('width', (27 * level).toFixed(1));
    $('#inkstat').classList.toggle('dry', level <= 0);
  },
  opDone(id) {
    spans.get(id)?.classList.add('done');
    spans.delete(id);
  },
  dry() { hint('', 'The pen has run dry — refill it from an ink bottle'); },
  full() { newSheet(); },
});

function makeSheet(incoming) {
  const el = document.createElement('div');
  el.className = 'sheet' + (incoming ? ' incoming' : '');
  el.style.zIndex = 50;
  wrap.insertBefore(el, bunchin);
  writer.attach(el);
  el.addEventListener('pointerdown', (e) => { if (state.mode === 'writing') { e.preventDefault(); focusInput(); } });
  return el;
}

/* ───────────── typing ───────────── */

let prev = '', composing = false;

function focusInput() {
  if (state.mode !== 'writing') return;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(ta.value.length, ta.value.length);
}

function sync() {
  if (composing || state.mode !== 'writing') return;
  const v = ta.value;
  let i = 0;
  const n = Math.min(v.length, prev.length);
  while (i < n && v[i] === prev[i]) i++;
  const del = Array.from(prev.slice(i)).length;
  for (let k = 0; k < del; k++) writer.strike(tapeStrike());
  for (const ch of Array.from(v.slice(i))) writer.type(ch, tapeAdd(ch));
  prev = v;
  if (v.length > 6000) ta.value = prev = v.slice(-1500);
  if (!state.typed && v.length) { state.typed = true; ghost.classList.add('off'); hint(); }
}

ta.addEventListener('input', sync);
ta.addEventListener('compositionstart', () => { composing = true; });
ta.addEventListener('compositionend', () => { composing = false; sync(); });

addEventListener('keydown', (e) => {
  if ($('#about').open) return;
  if (e.target.closest('button, [role="button"]')) return;
  if (state.mode === 'idle') {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takePen(); }
    else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) nudge();
    return;
  }
  if (state.mode !== 'writing') return;
  if (e.metaKey || e.ctrlKey) {
    if (['a', 'z', 'y'].includes(e.key.toLowerCase())) e.preventDefault();
    else if (e.key.toLowerCase() === 'v') focusInput();
    return;
  }
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) { e.preventDefault(); return; }
  if (e.key === 'Tab') { e.preventDefault(); focusInput(); ta.value += '   '; sync(); return; }
  if (state.swapping) return;
  focusInput();
});

/* ───────────── the ritual ───────────── */

const ritual = createRitual({ inks: INKS, audio, hint, onInk: showInk });

async function prepare(opts) {
  const previousMode = state.mode;
  setMode('ritual');
  writer.pause();
  ta.blur();
  const res = await ritual.open(opts);
  if (res.cancelled) {
    showInk(state.ink);
    setMode(previousMode);
    if (previousMode === 'writing') { writer.resume(); focusInput(); }
    hint('', previousMode === 'writing' ? 'Back to your letter' : 'Take the pen whenever you are ready', 4000);
    return;
  }
  state.prepared = true;
  state.ink = res.inkId;
  showInk(res.inkId);
  writer.setInk(INKS[res.inkId].c, res.level);
  addStain(res.inkId);
  setMode('writing');
  writer.start();
  writer.resume();
  focusInput();
  if (!state.typed) hint('', 'Start typing. Click or drag the cap when you are done.', 9000);
}

function takePen() {
  if (state.mode !== 'idle') return;
  audio.init();
  audio.knock();
  $('#d-pen').classList.remove('target');
  if (state.prepared && writer.level > 0) {
    audio.pop();
    setMode('writing');
    writer.resume();
    focusInput();
    hint('', 'Pick up where you left off', 2600);
    return;
  }
  prepare({ uncap: true, inkId: state.ink, level: 0 });
}

function capPen() {
  recap.cap();
}

function togglePen() { state.mode === 'writing' ? capPen() : takePen(); }

function refill(id) {
  if (state.mode !== 'writing' || state.swapping || state.stamping) return;
  prepare({ uncap: false, inkId: id || state.ink, level: writer.level });
}

$('#d-pen').addEventListener('click', togglePen);
$('#d-pen').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); togglePen(); }
});
penEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); capPen(); }
});
recap = createRecap({
  stage, pen: penEl, cap: $('#d-pen-cap'), audio, hint,
  canStart: () => state.mode === 'writing' && !state.swapping && !state.stamping && !$('#about').open,
  getPen: () => ({ x: 490 + disp.x - 5 * disp.lift, y: 150 + disp.y - 10 * disp.lift, a: disp.a, s: 1 }),
  onBegin() {
    setMode('handling');
    writer.pause(); audio.scratch(0); lastScratch = 0; ta.blur();
  },
  onCap() {
    setMode('idle');
    hint('', 'Pen capped. Click it again to keep writing.', 6000);
  },
  onReturn() { setMode('writing'); writer.resume(); focusInput(); },
});
document.addEventListener('visibilitychange', () => { if (document.hidden) audio.scratch(0); });
$('#d-inks').addEventListener('click', (e) => {
  const g = e.target.closest('.d-ink');
  if (g) refill(g.dataset.ink);
});

/* ───────────── sheets ───────────── */

async function newSheet() {
  if (state.swapping || state.mode !== 'writing') return;
  state.swapping = true;
  writer.pause();
  audio.paper();
  const old = sheetEl;
  state.sheets.push({ canvas: writer.canvas, text: writer.text() });
  bunchin.classList.add('up');
  await sleep(260);
  old.classList.add('done');
  old.querySelector('.wet')?.remove();
  const n = state.sheets.length;
  old.style.zIndex = n;
  old.style.transform = `translate(${-330 + rnd(-10, 10) + n * 3}px, ${236 + rnd(-10, 10) - n * 2}px) rotate(${rnd(-9, -2).toFixed(1)}deg) scale(.36)`;
  sheetEl = makeSheet(true);
  await sleep(80);
  sheetEl.classList.remove('incoming');
  await sleep(850);
  bunchin.classList.remove('up');
  audio.knock();
  state.swapping = false;
  writer.resume();
  focusInput();
}

/* ───────────── seal ───────────── */

async function stampSeal() {
  if (state.stamping || state.swapping || state.mode !== 'writing') return;
  state.stamping = true;
  const fly = $('#hanko-fly'), seal = $('#d-seal');
  const [sx, sy] = writer.stampPos();
  const tx = PAPER.x + sx, ty = PAPER.y + sy;
  const at = (x, y, s) => { fly.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
  fly.style.transition = 'none';
  at(350, 800, 1.2);
  void fly.offsetWidth;
  fly.style.transition = '';
  fly.style.opacity = 1;
  seal.style.opacity = 0;
  at(235, 835, 1);                       // a dab on the vermilion pad
  await sleep(520);
  at(tx, ty, 1.25);
  await sleep(560);
  fly.style.transitionDuration = '.13s';
  fly.classList.add('press');
  at(tx, ty, 1);
  await sleep(140);
  audio.stamp();
  writer.stamp(sx, sy, SEAL);
  await sleep(260);
  fly.classList.remove('press');
  at(tx, ty, 1.25);
  await sleep(160);
  fly.style.transitionDuration = '';
  at(350, 800, 1.2);
  await sleep(520);
  fly.style.opacity = 0;
  seal.style.opacity = 1;
  state.stamping = false;
  focusInput();
}
$('#d-hanko').addEventListener('click', stampSeal);

/* ───────────── keeping the letter ───────────── */

function allText() {
  return [...state.sheets.map((s) => s.text), writer.text()].filter((t) => t.trim()).join('\n\n');
}

function saveImage() {
  const pages = [...state.sheets.map((s) => s.canvas), writer.canvas];
  const pw = pages[0].width, ph = pages[0].height, pad = 120;
  const c = document.createElement('canvas');
  c.width = pages.length * pw + (pages.length + 1) * pad;
  c.height = ph + pad * 2;
  const g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, c.width, c.height);
  lg.addColorStop(0, '#5a3d2b'); lg.addColorStop(1, '#3d291d');
  g.fillStyle = lg; g.fillRect(0, 0, c.width, c.height);
  pages.forEach((p, i) => {
    g.save();
    g.shadowColor = 'rgba(0,0,0,.5)'; g.shadowBlur = 60; g.shadowOffsetX = 18; g.shadowOffsetY = 30;
    g.drawImage(p, pad + i * (pw + pad), pad);
    g.restore();
    // Repeat the credit under each sheet so every exported page carries it.
    g.save();
    g.textAlign = 'center';
    g.fillStyle = '#efe6d2';
    g.font = '28px Georgia, serif';
    const center = pad + i * (pw + pad) + pw / 2;
    g.fillText('Fuzukue · by @aishashok14', center, pad + ph + 56);
    g.fillStyle = '#cdbb9e';
    g.font = '19px Georgia, serif';
    g.fillText('twitter.com/aishashok14', center, pad + ph + 88);
    g.restore();
  });
  c.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fuzukue-letter-${new Date().toISOString().slice(0, 10)}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }, 'image/png');
  hint('', 'Saved as an image', 2600);
}

async function copyText() {
  const t = allText();
  try { await navigator.clipboard.writeText(t); hint('', t ? 'Copied — crossed-out words left behind' : 'Nothing written yet', 2800); }
  catch { hint('', 'Could not reach the clipboard', 2800); }
}

/* ───────────── controls ───────────── */

const about = $('#about');
$('#about-open').addEventListener('click', () => {
  writer.pause();
  audio.scratch(0);
  ta.blur();
  about.showModal();
});
$('#about-close').addEventListener('click', () => about.close());
about.addEventListener('click', (e) => {
  const r = about.getBoundingClientRect();
  if (e.target === about && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) about.close();
});
about.addEventListener('close', () => {
  if (state.mode === 'writing') { writer.resume(); focusInput(); }
});

$('#bar').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'sheet') newSheet();
  else if (act === 'stamp') stampSeal();
  else if (act === 'refill') refill();
  else if (act === 'save') saveImage();
  else if (act === 'copy') copyText();
  else if (act === 'sound') {
    state.sound = !state.sound;
    b.setAttribute('aria-pressed', state.sound);
    audio.init(); audio.setMuted(!state.sound);
  } else if (act === 'rain') {
    state.rain = !state.rain;
    b.setAttribute('aria-pressed', state.rain);
    audio.init(); audio.rain(state.rain);
  }
  b.blur();
  focusInput();
});

/* ───────────── begin ───────────── */

const fontsReady = Promise.all([
  document.fonts.load('28px "La Belle Aurore"'),
  document.fonts.load('700 30px "Shippori Mincho"', '文'),
]).catch(() => {});

await Promise.race([fontsReady, sleep(2500)]);
sheetEl = makeSheet(false);
showInk(state.ink);
$('#d-pen').classList.add('target');
setMode('idle');
hint('', 'Take the pen from its tray');

// a handle for poking at things from the console
window.fuzukue = { state, writer, takePen, capPen, refill, newSheet, stampSeal };
