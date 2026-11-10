// The sheet and the hand that writes on it.
//
// Typed characters arrive as a queue of ops. The writer works through them at a
// human pace: each glyph is revealed left-to-right while the nib follows the
// shape of the letter, then it is committed to the paper and dries.
// A backspace never erases — it becomes a strike-through drawn by hand.

export const SHEET = { w: 620, h: 820, ml: 62, mr: 54, top: 118, gap: 40, lines: 17 };

const S = 2;                 // canvas pixels per sheet unit
const PX = 28;               // handwriting size
const FONT = `${PX}px "La Belle Aurore", "Klee One", "Hiragino Maru Gothic ProN", cursive`;
const PAD = 18, BASE = 46, GH = 72;   // glyph cell: side padding, baseline, height
const CAPACITY = 1100;       // glyphs in a full converter

const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);

const mctx = document.createElement('canvas').getContext('2d');
function measure(s) {
  mctx.font = FONT;
  return mctx.measureText(s).width;
}

/* ───────────── paper ───────────── */

function paintPaper(c) {
  const { w, h } = SHEET;
  c.fillStyle = '#f3ecdb';
  c.fillRect(0, 0, w, h);

  // soft mottling, like pulp settling
  for (let i = 0; i < 46; i++) {
    const x = rnd(0, w), y = rnd(0, h), r = rnd(50, 190);
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    const light = Math.random() < 0.55;
    g.addColorStop(0, light ? 'rgba(255,251,238,.32)' : 'rgba(205,188,150,.13)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // fibres
  c.lineCap = 'round';
  for (let i = 0; i < 1300; i++) {
    const x = rnd(0, w), y = rnd(0, h), a = rnd(0, Math.PI * 2), len = rnd(5, 26);
    c.strokeStyle = Math.random() < 0.6 ? `rgba(255,255,250,${rnd(0.2, 0.5)})` : `rgba(150,128,90,${rnd(0.07, 0.2)})`;
    c.lineWidth = rnd(0.3, 0.9);
    c.beginPath();
    c.moveTo(x, y);
    c.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + rnd(-4, 4), y + Math.sin(a) * len * 0.5 + rnd(-4, 4), x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }

  // tooth
  const img = c.getImageData(0, 0, w * S, h * S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  c.putImageData(img, 0, 0);

  // rules
  const rule = 'rgba(178,112,96,';
  c.lineWidth = 0.7;
  for (let i = 0; i < SHEET.lines; i++) {
    const y = SHEET.top + i * SHEET.gap + 4.5;
    c.strokeStyle = rule + '.36)';
    c.beginPath(); c.moveTo(40, y); c.lineTo(w - 40, y); c.stroke();
  }
  const hy = SHEET.top - SHEET.gap + 4.5;
  c.strokeStyle = rule + '.6)';
  c.lineWidth = 1.1; c.beginPath(); c.moveTo(40, hy); c.lineTo(w - 40, hy); c.stroke();
  c.lineWidth = 0.6; c.beginPath(); c.moveTo(40, hy - 3.5); c.lineTo(w - 40, hy - 3.5); c.stroke();

  // seigaiha — a few printed waves in the corner
  c.strokeStyle = rule + '.5)';
  c.lineWidth = 0.8;
  const wave = (cx, cy) => { for (const r of [11, 7.5, 4]) { c.beginPath(); c.arc(cx, cy, r, Math.PI, 0); c.stroke(); } };
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4 - row; i++) wave(w - 62 - i * 22 - row * 11, 66 - row * 9);

  // maker's mark
  c.fillStyle = rule + '.6)';
  c.font = '500 9px "Shippori Mincho", serif';
  c.textAlign = 'center';
  c.fillText('F U Z U K U E  ·  T A K E  Y O U R  T I M E', w / 2, h - 30);
  c.textAlign = 'left';
}

/* ───────────── writer ───────────── */

export function createWriter(cb) {
  let paper, pctx, wctx;
  let glyphs = [], lines = [], line = 0, x = SHEET.ml;
  let queue = [], cur = null, run = null, afterStrike = false;
  let paused = true, dry = false, running = false;
  let wetList = [], wetDirty = false;
  let idle = 0, last = 0;
  const ink = { color: '#1b3a6b', level: 0 };
  const pen = { x: SHEET.ml, y: SHEET.top, down: false };

  const lineOf = (i) => (lines[i] ||= { off: rnd(-1.1, 1.1), slope: rnd(-0.006, 0.006), ph: rnd(0, 6.28), start: SHEET.ml + rnd(-3, 6) });
  const by = (i, xx) => { const L = lineOf(i); return SHEET.top + i * SHEET.gap + L.off + L.slope * (xx - SHEET.ml) + Math.sin(xx * 0.011 + L.ph) * 0.8; };
  const speed = () => { const q = queue.length; return q > 40 ? 0.08 : q > 14 ? 0.28 : q > 6 ? 0.5 : q > 2 ? 0.78 : 1; };

  function attach(el) {
    paper = document.createElement('canvas');
    const wet = document.createElement('canvas');
    wet.className = 'wet';
    for (const c of [paper, wet]) { c.width = SHEET.w * S; c.height = SHEET.h * S; }
    pctx = paper.getContext('2d', { willReadFrequently: false });
    wctx = wet.getContext('2d');
    pctx.scale(S, S); wctx.scale(S, S);
    paintPaper(pctx);
    el.append(paper, wet);
    glyphs = []; lines = []; line = 0; x = lineOf(0).start;
    cur = null; run = null; afterStrike = false; wetList = [];
    pen.x = x; pen.y = by(0, x) - 4; pen.down = false;
    return paper;
  }

  /* glyphs */

  function buildGlyph(ch, sx, kind = 'char') {
    const adv = measure(ch);
    const cw = Math.ceil(adv + PAD * 2);
    const c = document.createElement('canvas');
    c.width = cw * S; c.height = GH * S;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.scale(S, S);
    g.font = FONT;
    g.fillStyle = ink.color;
    g.fillText(ch, PAD, BASE);

    // fountain-pen shading: thin at the top of a stroke, pooled where it ends
    g.globalCompositeOperation = 'source-atop';
    const lg = g.createLinearGradient(0, BASE - 22, 0, BASE + 9);
    lg.addColorStop(0, 'rgba(255,255,255,.2)');
    lg.addColorStop(0.55, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.3)');
    g.fillStyle = lg; g.fillRect(0, 0, cw, GH);
    const bx = PAD + rnd(0, adv), byy = BASE - rnd(2, 14), br = rnd(7, 15);
    const rg = g.createRadialGradient(bx, byy, 0, bx, byy, br);
    rg.addColorStop(0, 'rgba(0,0,0,.26)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, cw, GH);

    // a starving nib skips
    const starve = ink.level < 0.07 ? 1 - ink.level / 0.07 : 0;
    if (starve > 0) {
      g.globalCompositeOperation = 'destination-out';
      const n = 3 + starve * 14;
      for (let i = 0; i < n; i++) {
        g.globalAlpha = rnd(0.3, 0.9);
        g.save();
        g.translate(rnd(PAD - 4, PAD + adv + 4), rnd(BASE - 26, BASE + 10));
        g.rotate(rnd(-1.1, -0.5));
        g.fillRect(-12, 0, 24, rnd(0.5, 1.4 + starve));
        g.restore();
      }
      g.globalAlpha = 1;
    }
    g.globalCompositeOperation = 'source-over';

    // where is the ink, column by column — the nib will follow this
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const top = new Float32Array(cw), bot = new Float32Array(cw);
    let l = -1, r = -1;
    for (let cx = 0; cx < cw; cx++) {
      let t = -1, b = -1;
      const px = cx * S;
      for (let py = 0; py < c.height; py += 2) {
        if (data[(py * c.width + px) * 4 + 3] > 50) { if (t < 0) t = py; b = py; }
      }
      if (t >= 0) { if (l < 0) l = cx; r = cx; top[cx] = t / S; bot[cx] = b / S; } else top[cx] = -1;
    }
    if (l < 0) { l = PAD; r = PAD + 1; }
    let lt = BASE - 8, lb = BASE;
    for (let cx = l; cx <= r; cx++) { if (top[cx] < 0) { top[cx] = lt; bot[cx] = lb; } else { lt = top[cx]; lb = bot[cx]; } }

    const sc = rnd(0.965, 1.035);
    return {
      kind, ch, line, x, struck: false,
      w: adv * sx * sc,
      y: by(line, x) + rnd(-0.7, 0.7),
      rot: rnd(-0.03, 0.03), sx, sc,
      alpha: 0.9 - starve * 0.4,
      ph: rnd(0, 6.28),
      canvas: c, cw, prof: { top, bot, l, r },
    };
  }

  function drawGlyph(c2, g, p, alphaMul = 1) {
    const cols = p >= 1 ? g.cw : Math.min(g.cw, g.prof.l - 1 + (g.prof.r - g.prof.l + 3) * p);
    if (cols <= 0) return;
    c2.save();
    c2.globalAlpha = clamp(g.alpha * alphaMul, 0, 1);
    c2.translate(g.x, g.y);
    c2.rotate(g.rot);
    c2.scale(g.sx * g.sc, g.sc);
    c2.drawImage(g.canvas, 0, 0, cols * S, GH * S, -PAD, -BASE, cols, GH);
    c2.restore();
  }

  function commitGlyph(g) {
    pctx.globalCompositeOperation = 'multiply';
    drawGlyph(pctx, g, 1);
    pctx.globalCompositeOperation = 'source-over';
    wetList.push({ g, t: 0 });
  }

  function penAt(g, p) {
    const { l, r, top, bot } = g.prof;
    const col = clamp(Math.round(l + (r - l) * p), l, r);
    const yy = top[col] + (bot[col] - top[col]) * (0.5 + 0.5 * Math.sin(p * 9 + g.ph));
    const lx = (col - PAD) * g.sx * g.sc, ly = (yy - BASE) * g.sc;
    const cs = Math.cos(g.rot), sn = Math.sin(g.rot);
    return [g.x + lx * cs - ly * sn, g.y + lx * sn + ly * cs];
  }

  /* strike-through */

  const sy = (r, xx) => r.y + r.slope * (xx - r.x0) + Math.sin(xx * 0.14 + r.ph) * 0.8 + Math.sin(xx * 0.043 + r.ph * 1.7) * 1.5;

  function strokeRun(c2, r, a, b, off = 0) {
    const n = Math.max(1, Math.ceil(Math.abs(b - a) / 2.5));
    c2.save();
    c2.strokeStyle = r.color; c2.lineWidth = r.wd; c2.lineCap = 'round'; c2.lineJoin = 'round';
    c2.beginPath();
    for (let i = 0; i <= n; i++) {
      const xx = a + ((b - a) * i) / n;
      const yy = sy(r, xx) + off;
      i ? c2.lineTo(xx, yy) : c2.moveTo(xx, yy);
    }
    c2.stroke();
    c2.restore();
  }

  function commitStroke(r, a, b, off) {
    pctx.globalCompositeOperation = 'darken';
    strokeRun(pctx, r, a, b, off);
    pctx.globalCompositeOperation = 'source-over';
  }

  /* ops */

  const gap = (op, dur) => { cur = { type: 'gap', op, t: 0, dur }; };

  function sheetFull(op) { queue.unshift(op); paused = true; cb.full?.(); }
  function runDry(op) { queue.unshift(op); dry = true; cb.dry?.(); }

  function peekWord() {
    if (!queue.length) return null;
    let s = '';
    for (const o of queue) {
      if (o.type !== 'char' || o.ch === ' ' || o.ch === '\n') break;
      s += o.ch;
      if (s.length > 24) break;
    }
    return measure(s);
  }

  function startBreak(op, kind) {
    glyphs.push({ kind, ch: kind === 'nl' ? '\n' : ' ', line, x, w: 0, struck: false });
    line++;
    x = lineOf(line).start;
    afterStrike = false;
    cur = { type: 'move', op, t: 0, dur: 190 * speed() + 30, from: [pen.x, pen.y], to: [x, by(Math.min(line, SHEET.lines - 1), x) - 5] };
  }

  function start(op) {
    if (op.type === 'strike') return startStrike(op);
    if (run) { afterStrike = run.count > 0; run = null; }
    const ch = op.ch;

    if (ch === '\n') return startBreak(op, 'nl');

    if (ch === ' ' || ch === ' ' || ch === '\t') {
      const room = SHEET.w - SHEET.mr - x;
      const next = peekWord();
      const need = next == null ? 58 : next;
      if (x > SHEET.ml + 40 && room < need + 8) return startBreak(op, 'wrap');
      const w = rnd(8.5, 11.5);
      glyphs.push({ kind: 'space', ch: ' ', line, x, w, struck: false });
      x += w;
      afterStrike = false;
      return gap(op, 26 * speed());
    }

    if (line >= SHEET.lines) return sheetFull(op);
    if (ink.level <= 0) return runDry(op);

    const adv = measure(ch);
    if (afterStrike) { x += rnd(5, 9); afterStrike = false; }

    // out of room in the middle of a word: hyphenate and carry on below
    if (x + adv * 0.86 > SHEET.w - 20 && x > SHEET.ml + 20) {
      const prev = glyphs[glyphs.length - 1];
      if (prev && prev.kind === 'char' && /\p{L}/u.test(prev.ch) && /\p{L}/u.test(ch)) {
        const h = buildGlyph('-', 0.86, 'hyph');
        glyphs.push(h); commitGlyph(h);
      }
      line++;
      x = lineOf(line).start;
      if (line >= SHEET.lines) return sheetFull(op);
    }

    const g = buildGlyph(ch, x + adv > SHEET.w - SHEET.mr ? 0.86 : 1);
    glyphs.push(g);
    x += g.w + rnd(-0.3, 0.5);
    ink.level = Math.max(0, ink.level - (0.35 + adv / 20) / CAPACITY);
    cb.ink?.(ink.level);
    cur = { type: 'char', op, g, t: 0, p: 0, dur: (60 + adv * 3.4) * speed() };
  }

  function startStrike(op) {
    let i = glyphs.length - 1;
    while (i >= 0 && (glyphs[i].struck || glyphs[i].kind === 'hyph')) i--;
    if (i < 0) return gap(op, 8);
    const g = glyphs[i];
    g.struck = true;
    if (g.kind === 'nl' || g.kind === 'wrap') { if (run) run.idx = i; return gap(op, 12); }

    const adjacent = run && run.line === g.line && run.idx === i + 1;
    if (g.kind === 'space' && !adjacent) { return gap(op, 14); }
    if (!adjacent) {
      const x0 = g.x + g.w + rnd(1, 4);
      run = {
        line: g.line, x0, left: x0, idx: i, count: 0,
        y: by(g.line, x0) - rnd(6, 8.5),
        slope: rnd(-0.035, 0.035), ph: rnd(0, 6.28), wd: rnd(1.5, 2), color: ink.color,
      };
    }
    run.idx = i;
    run.count++;
    const more = queue.length && queue[0].type === 'strike';
    const to = Math.min(run.left, g.x - (more ? 0 : rnd(1.5, 4)));
    cur = { type: 'strike', op, r: run, from: run.left, to, xx: run.left, off: 0, t: 0, dur: Math.max(26, (run.left - to) * 4.4 * speed()) };
  }

  // a long crossing-out gets a second, firmer pass
  function startRestrike() {
    run.doubled = true;
    if (Math.random() > 0.6) return;
    const a = run.left + rnd(0, 4), b = run.x0 + rnd(-3, 2);
    const r = { ...run, ph: run.ph + 2.1, slope: run.slope + rnd(-0.015, 0.015) };
    cur = { type: 'strike', second: true, r, from: a, to: b, xx: a, off: rnd(1.8, 3) * (Math.random() < 0.5 ? -1 : 1), t: 0, dur: Math.max(110, (b - a) * 1.7) };
  }

  function step(c, p) {
    if (c.type === 'char') {
      c.p = p;
      [pen.x, pen.y] = penAt(c.g, p);
      pen.down = true;
      return 0.55 + 0.45 * Math.abs(Math.sin(p * 9 + c.g.ph));
    }
    if (c.type === 'strike') {
      c.xx = c.from + (c.to - c.from) * p;
      pen.x = c.xx; pen.y = sy(c.r, c.xx) + c.off;
      pen.down = true;
      return 0.9;
    }
    if (c.type === 'move') {
      const e = ease(p);
      pen.x = c.from[0] + (c.to[0] - c.from[0]) * e;
      pen.y = c.from[1] + (c.to[1] - c.from[1]) * e - Math.sin(p * Math.PI) * 6;
      pen.down = false;
      return 0;
    }
    return 0;
  }

  function finish(c) {
    if (c.type === 'char') commitGlyph(c.g);
    else if (c.type === 'strike') {
      commitStroke(c.r, c.from, c.to, c.off);
      if (!c.second) c.r.left = c.to;
    }
    if (c.op?.id != null) cb.opDone?.(c.op.id);
    cur = null;
  }

  function renderWet(dt) {
    if (!wetDirty && !wetList.length && !cur) return;
    wctx.clearRect(0, 0, SHEET.w, SHEET.h);
    wetDirty = false;
    for (let i = wetList.length - 1; i >= 0; i--) {
      const w = wetList[i];
      w.t += dt;
      const a = 0.3 * (1 - w.t / 1700);
      if (a <= 0) { w.g.canvas = null; w.g.prof = null; wetList.splice(i, 1); wetDirty = true; continue; }
      drawGlyph(wctx, w.g, 1, a);
      wetDirty = true;
    }
    if (cur?.type === 'char') { drawGlyph(wctx, cur.g, cur.p, 1.1); wetDirty = true; }
    if (cur?.type === 'strike') { strokeRun(wctx, cur.r, cur.from, cur.xx, cur.off); wetDirty = true; }
  }

  function tick(now) {
    const dt = Math.min(60, now - last || 16);
    last = now;
    let budget = dt, level = 0, guard = 0;
    while (!paused && budget > 0 && guard++ < 400) {
      if (!cur && !paused && !dry) {
        const next = queue[0];
        if (run && run.count >= 6 && !run.doubled && (next ? next.type !== 'strike' : idle > 320)) startRestrike();
        if (!cur && queue.length) start(queue.shift());
      }
      if (!cur) break;
      idle = 0;
      const use = Math.min(cur.dur - cur.t, budget);
      cur.t += use; budget -= use;
      level = Math.max(level, step(cur, cur.dur <= 0 ? 1 : Math.min(1, cur.t / cur.dur)));
      if (cur.t >= cur.dur) finish(cur); else break;
    }
    if (!cur) {
      idle += dt;
      if (idle > 130) pen.down = false;
      if (idle > 130 && !paused) {
        // rest just past the last letter, ready for the next
        const ty = by(Math.min(line, SHEET.lines - 1), x) - 5;
        pen.x += (x + 3 - pen.x) * 0.2; pen.y += (ty - pen.y) * 0.2;
      }
    }
    renderWet(dt);
    cb.pen?.(pen.x, pen.y, pen.down, idle);
    cb.scratch?.(level);
    requestAnimationFrame(tick);
  }

  /* seal */

  function stampPos() {
    const ly = by(Math.min(line, SHEET.lines - 1), 0) + 36;
    return [SHEET.w - 104, clamp(ly, 150, SHEET.h - 92)];
  }

  function stamp(cx, cy, kanji) {
    const N = 76, R = 26;
    const c = document.createElement('canvas');
    c.width = c.height = N * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    g.translate(N / 2, N / 2);
    g.rotate(rnd(-0.1, 0.1));
    g.strokeStyle = g.fillStyle = '#c23a2b';
    g.lineWidth = 3.2;
    g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.stroke();
    g.font = '700 31px "Shippori Mincho", "Hiragino Mincho ProN", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(kanji, 0, 1.5);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 170; i++) {
      g.globalAlpha = rnd(0.25, 0.95);
      g.beginPath(); g.arc(rnd(-N / 2, N / 2), rnd(-N / 2, N / 2), rnd(0.3, 1.5), 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    const a = rnd(0, Math.PI * 2);
    const lg = g.createLinearGradient(Math.cos(a) * R, Math.sin(a) * R, -Math.cos(a) * R, -Math.sin(a) * R);
    lg.addColorStop(0, 'rgba(0,0,0,.5)'); lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.fillStyle = lg; g.fillRect(-N / 2, -N / 2, N, N);

    pctx.globalCompositeOperation = 'multiply';
    pctx.globalAlpha = 0.92;
    pctx.drawImage(c, cx - N / 2, cy - N / 2, N, N);
    pctx.globalAlpha = 1;
    pctx.globalCompositeOperation = 'source-over';
  }

  return {
    attach,
    start() { if (!running) { running = true; requestAnimationFrame(tick); } },
    type(ch, id) { queue.push({ type: 'char', ch, id }); },
    strike(id) { queue.push({ type: 'strike', id }); },
    pause() { paused = true; pen.down = false; cb.scratch?.(0); },
    resume() { paused = false; },
    setInk(color, level) { ink.color = color; ink.level = level; dry = false; cb.ink?.(level); },
    get level() { return ink.level; },
    get busy() { return !!cur || queue.length > 0; },
    get blank() { return glyphs.length === 0; },
    get canvas() { return paper; },
    text() {
      let s = '';
      for (const g of glyphs) {
        if (g.struck || g.kind === 'hyph') continue;
        s += g.kind === 'nl' ? '\n' : g.kind === 'wrap' ? ' ' : g.ch;
      }
      return s;
    },
    stampPos, stamp,
  };
}
