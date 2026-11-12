import { audio } from './audio.js';
import { createWriter, SHEET, crease, ballOf } from './paper.js';
import { createRitual } from './ritual.js';
import { createRecap } from './recap.js';
import { createDesk, createCurl, sheetTransform, crush, PAGE } from './desk.js';

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

const state = {
  mode: 'idle', ink: 'ai', sound: true, rain: false, typed: false, prepared: false,
  sheets: [],            // every sheet set aside: { el, canvas, text, crumpled, body, ball }
  swapping: false, stamping: false,
  reading: null,         // the old sheet brought up to read, if any
  near: false,           // on a phone: leaning in over the page, rather than seeing the whole desk
};

const stage = $('#stage');
const wrap = $('#sheet-wrap');
const bunchin = $('#bunchin');
const ta = $('#input');
const penEl = $('#pen-top');
let sheetEl = null;
let recap = null;

/* ───────────── the view ───────────── */

// The desk is a fixed 1600 × 1000 stage seen through a camera. On a wide screen the camera
// simply fits it. On a phone it shows the desk from further back, then leans in over the
// page to write: the sheet fills the width, the handwriting is larger, and the line being
// written is kept clear of the keyboard.

const docEl = document.documentElement;
const vv = window.visualViewport;
const ticker = $('#ticker');
const TICKER_TOP = 85;                   // its place on the stage in the narrow layout (see styles)
const cam = { s: 1, x: 0, y: 0, set: false, css: '', tk: '', kb: -1, last: 0 };

const isPhone = () => docEl.clientWidth < 700;
const handScale = () => (isPhone() ? 1.3 : 1);

function aim(leanIn = true) {
  const vw = docEl.clientWidth, vh = docEl.clientHeight;
  const top = vv ? vv.offsetTop : 0, seen = vv ? vv.height : vh;
  const phone = isPhone();
  const close = leanIn && phone && (!!state.reading || (state.mode === 'writing' && state.near));
  let s = Math.min(vw / 1600, vh / 1000), x = 0, y = 0;
  if (close) {
    s = (vw - 20) / PAGE.w;
    const head = top + 10 + 60 * s;                              // the tape sits at the top of what is visible, the sheet just under it
    const line = state.reading ? 0 : writer.lineY;
    const paperTop = Math.min(head, top + seen * 0.56 - line * s);
    y = (paperTop - vh / 2) / s - (PAGE.y - 500);
  } else if (vw / vh < 1.45) {
    // narrow window: keep the paper and the pen tray, let the rest fall off the edges
    s = Math.min(vh / 1000, vw / 900);
    x = -Math.min(80, Math.max(0, (1600 * s - vw) / 2 / s));
  }
  return { s, x, y, phone, close, top, vw, vh, kb: Math.max(0, vh - top - seen) };
}

// what part of the stage a camera position shows
function seenBy(c) {
  const vw = docEl.clientWidth, vh = docEl.clientHeight;
  return { l: 800 - c.x - vw / (2 * c.s), r: 800 - c.x + vw / (2 * c.s), t: 500 - c.y - vh / (2 * c.s), b: 500 - c.y + vh / (2 * c.s) };
}

function look(now) {
  const t = aim();
  const k = cam.set ? 1 - Math.exp(-Math.min(60, now - cam.last) / 150) : 1;
  cam.last = now; cam.set = true;
  cam.s += (t.s - cam.s) * k; cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
  const css = `translate(-50%, -50%) scale(${cam.s.toFixed(4)}) translate(${cam.x.toFixed(1)}px, ${cam.y.toFixed(1)}px)`;
  if (css !== cam.css) stage.style.transform = cam.css = css;
  const tk = t.close ? `translateY(${((t.top + 8 - t.vh / 2) / cam.s + 500 - cam.y - TICKER_TOP).toFixed(1)}px)` : '';
  if (tk !== cam.tk) ticker.style.transform = cam.tk = tk;
  const kb = Math.round(t.kb);
  if (kb !== cam.kb) { cam.kb = kb; docEl.style.setProperty('--kb', `${kb}px`); document.body.classList.toggle('keys', kb > 80); }
  document.body.classList.toggle('phone', t.phone);
  document.body.classList.toggle('closeup', t.close);
  requestAnimationFrame(look);
}
look(performance.now());

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
  writer.attach(el, handScale());
  // touching the page is how you lean in and write (on a phone this is also what raises the keyboard)
  const lean = (e) => {
    if (el.classList.contains('done') || state.mode !== 'writing' || state.reading) return;
    if (e.type === 'pointerdown') e.preventDefault();
    state.near = true;
    focusInput();
  };
  el.addEventListener('pointerdown', lean);
  el.addEventListener('click', lean);
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
  if (composing || state.mode !== 'writing' || state.reading) return;
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
  if (state.reading) { if (e.key === 'Escape') { e.preventDefault(); closeReader('back'); } return; }
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
  state.near = true;
  await document.fonts.load('28px "La Belle Aurore"').catch(() => {});     // never let the first words fall back to another face
  writer.start();
  writer.resume();
  focusInput();
  if (!state.typed) hint('', touch ? 'Tap the page and start typing.' : 'Start typing. Click or drag the cap when you are done.', 9000);
}

function takePen() {
  if (state.mode !== 'idle') return;
  audio.init();
  audio.knock();
  $('#d-pen').classList.remove('target');
  if (state.prepared && writer.level > 0) {
    audio.pop();
    setMode('writing');
    state.near = true;
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
  canStart: () => state.mode === 'writing' && !state.swapping && !state.stamping && !state.reading && !$('#about').open,
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

/* ───────────── things on the desk ───────────── */

const RAD = Math.PI / 180;
const touch = matchMedia('(pointer: coarse)').matches;
const desk = createDesk({ stage, audio });
const handling = () => state.mode !== 'ritual' && !state.reading;

// tea leans away from a shove and takes a moment to settle
const tea = { x: 0, y: 0, vx: 0, vy: 0 };
const shine = $('#d-tea-shine');
function slosh(b, dt) {
  const tx = clamp(-b.ax * 0.0035, -9, 9), ty = clamp(-b.ay * 0.0035, -9, 9);
  tea.vx += ((tx - tea.x) * 120 - tea.vx * 5) * dt;
  tea.vy += ((ty - tea.y) * 120 - tea.vy * 5) * dt;
  tea.x += tea.vx * dt; tea.y += tea.vy * dt;
  shine.setAttribute('transform', `translate(${tea.x.toFixed(2)} ${tea.y.toFixed(2)})`);
  return Math.abs(tea.x) + Math.abs(tea.y) + Math.abs(tea.vx) + Math.abs(tea.vy) > 0.4;
}

const cup = desk.item($('#d-cup'), 285, 255, { radius: 63, follow: 16, friction: 9, lifts: 0.05, canGrab: handling, onStep: slosh, onGrab() { ride = null; } });
let ride = null;       // the cup rides along when the coaster under it is moved
desk.item($('#d-coaster'), 285, 255, {
  radius: 87, inertia: 5200, follow: 24, lifts: 0, canGrab: handling,
  onGrab(b) { ride = Math.hypot(cup.x - b.x, cup.y - b.y) < 55 ? { x: cup.x - b.x, y: cup.y - b.y } : null; },
  onStep(b, dt) {
    if (!ride) return false;
    cup.x = b.x + ride.x; cup.y = b.y + ride.y; cup.ax = b.ax; cup.ay = b.ay;
    const more = slosh(cup, dt);
    cup.draw();
    return more;
  },
});
desk.item($('#d-inkbox'), 1424, 296, { radius: 110, inertia: 30000, follow: 10, friction: 10, lifts: 0, canGrab: handling });
desk.item($('#d-cloth'), 1425, 555, { radius: 80, inertia: 2400, follow: 30, friction: 8, lifts: 0, canGrab: handling });
const pad = desk.item($('#d-pad'), 235, 835, { radius: 56, follow: 18, lifts: 0, canGrab: handling });
const sealBody = desk.item($('#d-seal-body'), 360, 800, {
  radius: 50, inertia: 2600, follow: 26, canGrab: () => handling() && !state.stamping,
  onDrop(b) {
    // set down on the page, it stamps right there
    const sx = b.x - PAGE.x, sy = b.y - PAGE.y;
    if (sx > 34 && sx < PAGE.w - 34 && sy > 34 && sy < PAGE.h - 34) stampSeal([sx, sy]);
  },
});

/* ───────────── sheets ───────────── */

let zTop = 0;

// where set-aside sheets and crumpled balls go, wherever this window leaves room for them
function spots() {
  const v = seenBy(aim(false));
  const floor = v.b - 60 / aim(false).s;
  if (v.l < 180) return { pile: { x: 275, y: 530 }, balls: [1190, 1500, 770, Math.min(920, floor)] };
  // tall and narrow: the pile goes under the pen tray, the balls along the foot of the page
  return { pile: { x: Math.min(1212, v.r - 118), y: 905 }, balls: [520, 900, 1012, Math.max(1014, Math.min(1050, floor - 60))] };
}

function pilePose() {
  const n = state.sheets.length, p = spots().pile;
  return { x: p.x + rnd(-14, 14) + (n % 5) * 3, y: p.y + rnd(-12, 12) - (n % 5) * 2, a: rnd(-9, -2) * RAD };
}

function toPile(rec, pose = pilePose()) {
  rec.el.style.zIndex = ++zTop;
  rec.el.style.transform = sheetTransform(pose);
  rec.body = desk.sheet(rec.el, pose, {
    canGrab: () => !state.reading && state.mode !== 'ritual',
    onGrab() { rec.el.style.zIndex = ++zTop; },
    onClick() { readSheet(rec); },
  });
}

async function newSheet(fate = 'pile') {
  if (state.swapping || state.mode !== 'writing' || state.reading) return;
  state.swapping = true;
  writer.pause();
  curl.clear();
  const old = sheetEl;
  const rec = { el: old, canvas: writer.canvas, text: writer.text(), crumpled: false, body: null, ball: null };
  state.sheets.push(rec);
  bunchin.classList.add('up');
  if (fate === 'pile') audio.paper();
  await sleep(260);
  old.classList.add('done');
  old.querySelector('.wet')?.remove();
  if (fate === 'ball') await crumple(rec, { x: PAGE.x + PAGE.w / 2, y: PAGE.y + PAGE.h / 2 });
  else toPile(rec);
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

/* crumpling, and thinking better of it */

async function crumple(rec, c) {
  const el = rec.el;
  audio.crumple();
  rec.body?.remove();
  rec.body = null;
  el.classList.remove('loose', 'opening');
  el.classList.add('crumpling');
  el.style.clipPath = crush(0);
  void el.offsetWidth;
  const turn = rnd(-0.6, 0.6);
  for (const [t, s] of [[0.35, 0.76], [0.7, 0.4], [1, 0.13]]) {       // three squeezes of the fist
    el.style.clipPath = crush(t);
    el.style.transform = sheetTransform({ x: c.x, y: c.y, a: turn * t }, s);
    await sleep(190);
  }
  el.style.display = 'none';
  el.classList.remove('crumpling', 'reading');
  el.style.clipPath = '';
  rec.crumpled = true;
  rec.ball = desk.ball(ballOf(rec.canvas), c.x, c.y, { canGrab: () => !state.reading, onClick: () => openBall(rec) });
  crease(rec.canvas);                                                   // the folds stay in the paper
  const [x0, x1, y0, y1] = spots().balls;
  const tx = rnd(x0, Math.max(x0, x1)), ty = rnd(y0, Math.max(y0, y1));
  rec.ball.toss((tx - c.x) * 2.3, (ty - c.y) * 2.3);                    // enough of a flick to roll there
}

function openBall(rec) {
  if (state.reading || state.swapping || recap?.active || state.mode === 'ritual' || state.mode === 'handling') return;
  const at = { x: rec.ball.x, y: rec.ball.y, a: rnd(-0.6, 0.6) };
  rec.ball.remove();
  rec.ball = null;
  rec.crumpled = false;
  audio.crumple();
  const el = rec.el;
  el.classList.add('loose');
  el.style.display = '';
  el.style.clipPath = crush(1);
  el.style.transform = sheetTransform(at, 0.13);
  void el.offsetWidth;
  el.classList.remove('loose');
  el.classList.add('opening');
  el.style.clipPath = crush(0);
  toPile(rec);
  readSheet(rec);
  setTimeout(() => { el.classList.remove('opening'); el.style.clipPath = ''; }, 820);
}

/* an old sheet, brought back up */

function readSheet(rec) {
  if (state.reading || state.swapping || recap?.active || state.mode === 'ritual' || state.mode === 'handling') return;
  state.reading = rec;
  if (state.mode === 'writing') { writer.pause(); audio.scratch(0); lastScratch = 0; }
  ta.blur();
  ta.disabled = true;
  hint();
  document.body.classList.add('reading');
  rec.el.classList.remove('loose');
  rec.el.classList.add('reading');
  rec.el.style.zIndex = 80;
  rec.el.style.transform = 'translate(0px, -6px) rotate(0rad) scale(1)';
  if (!rec.el.classList.contains('opening')) audio.paper();
}

let closing = false;
async function closeReader(how) {
  const rec = state.reading;
  if (!rec || closing) return;
  closing = true;
  if (how === 'crumple') await crumple(rec, { x: PAGE.x + PAGE.w / 2, y: PAGE.y + PAGE.h / 2 - 6 });
  else {
    rec.el.classList.remove('reading');
    rec.el.style.zIndex = ++zTop;
    rec.el.style.transform = sheetTransform(rec.body);
    audio.paper();
  }
  document.body.classList.remove('reading');
  state.reading = null;
  closing = false;
  ta.disabled = state.mode !== 'writing';
  if (state.mode === 'writing') { writer.resume(); focusInput(); }
}

$('#reader').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) closeReader(b.dataset.read);
});
wrap.addEventListener('click', (e) => { if (e.target === wrap && state.reading) closeReader('back'); });

// the lower corners of the page lift; pulled far enough, the sheet comes away
const curl = createCurl({
  wrap, point: desk.point, hint,
  getSheet: () => (state.swapping || state.reading ? null : sheetEl),
  canPull: () => state.mode === 'writing' && !state.swapping && !state.stamping,
  onPull: () => newSheet(),
});

/* ───────────── seal ───────────── */

async function stampSeal(drop) {
  if (state.stamping || state.swapping || state.mode !== 'writing' || state.reading) return;
  state.stamping = true;
  const fly = $('#hanko-fly'), seal = $('#d-seal');
  const [sx, sy] = drop || writer.stampPos();
  const tx = PAGE.x + sx, ty = PAGE.y + sy;
  const at = (x, y, s) => { fly.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
  fly.style.transition = 'none';
  if (drop) at(tx, ty, 1.25); else at(sealBody.x - 10, sealBody.y, 1.2);
  void fly.offsetWidth;
  fly.style.transition = '';
  fly.style.opacity = 1;
  seal.style.opacity = 0;
  if (drop) {
    // carried here by hand; the seal's own place on the desk is where it goes back to
    sealBody.x = 360; sealBody.y = 800; sealBody.a = 0; sealBody.vx = sealBody.vy = sealBody.va = 0;
    sealBody.draw();
    await sleep(120);
  } else {
    at(pad.x, pad.y, 1);                   // a dab on the vermilion pad
    await sleep(520);
    at(tx, ty, 1.25);
    await sleep(560);
  }
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
  at(sealBody.x - 10, sealBody.y, 1.2);
  await sleep(520);
  fly.style.opacity = 0;
  seal.style.opacity = 1;
  state.stamping = false;
  focusInput();
}
$('#d-hanko').addEventListener('click', () => stampSeal());

/* ───────────── keeping the letter ───────────── */

// crumpled pages are out of the letter until they are opened again
const kept = () => state.sheets.filter((s) => !s.crumpled);

function allText() {
  return [...kept().map((s) => s.text), writer.text()].filter((t) => t.trim()).join('\n\n');
}

function saveImage() {
  const pages = [...kept().map((s) => s.canvas), writer.canvas];
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
$('#step-back').addEventListener('click', () => { state.near = false; ta.blur(); hint('', 'Tap the page to lean back in.', 3200); });
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
  else if (act === 'crumple') newSheet('ball');
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
window.fuzukue = { state, writer, takePen, capPen, refill, newSheet, stampSeal, readSheet, closeReader, openBall };
