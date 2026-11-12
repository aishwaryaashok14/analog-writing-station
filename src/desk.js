// Things on the desk that can be handled.
//
// A grabbed object is pulled by the point you hold it at. Hold it off-centre and it
// swings round to trail behind your hand, the way a sheet dragged by its corner does.
// Let go and it keeps a little of its speed, then friction takes it.
//
// The sheet being written on stays under its paperweight, but its lower corners can
// be lifted: the corner folds over along the crease your pull implies.

const SVG = 'http://www.w3.org/2000/svg';
const RAD = Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
const rnd = (a, b) => a + Math.random() * (b - a);

export const PAGE = { x: 490, y: 150, w: 620, h: 820 };   // the sheet's place on the stage
const PILE_SCALE = 0.36;

/** CSS transform for a sheet-sized element (origin top-left, living in the sheet wrap) centred at a stage point. */
export function sheetTransform({ x, y, a = 0 }, s = PILE_SCALE) {
  const cs = Math.cos(a), sn = Math.sin(a), hx = (PAGE.w / 2) * s, hy = (PAGE.h / 2) * s;
  const tx = x - (hx * cs - hy * sn) - PAGE.x, ty = y - (hx * sn + hy * cs) - PAGE.y;
  return `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) rotate(${a.toFixed(4)}rad) scale(${s})`;
}

export function createDesk({ stage, audio }) {
  const bodies = new Set();
  let raf = 0, last = 0;

  function point(e) {
    const box = stage.getBoundingClientRect(), k = box.width / 1600;
    return { x: (e.clientX - box.left) / k, y: (e.clientY - box.top) / k };
  }

  // only what is actually on screen counts as desk — nothing should slide out of reach
  function edges() {
    const box = stage.getBoundingClientRect(), k = box.width / 1600;
    return {
      l: Math.max(0, -box.left / k), r: Math.min(1600, (innerWidth - box.left) / k),
      t: Math.max(0, -box.top / k), b: Math.min(1000, (innerHeight - box.top) / k) - 46 / k,
    };
  }

  function wake() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }

  function loop(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    const lim = edges();
    let busy = false;
    // only what is moving is simulated; things at rest stay exactly where they were left
    for (const b of bodies) if (b.awake) { b.awake = b.step(dt, lim); busy ||= b.awake; }
    if (collide()) busy = true;
    raf = busy ? requestAnimationFrame(loop) : 0;
  }

  // paper balls knock into one another
  function collide() {
    const balls = [...bodies].filter((b) => b.o.ball);
    let stirred = false;
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const p = balls[i], q = balls[j];
      if (!p.awake && !q.awake) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, min = p.o.radius + q.o.radius - 8;
      if (d >= min) continue;
      const nx = dx / d, ny = dy / d, push = (min - d) / 2;
      if (!p.held) { p.x -= nx * push; p.y -= ny * push; }
      if (!q.held) { q.x += nx * push; q.y += ny * push; }
      const rel = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (rel < 0) { p.vx += rel * nx * 0.6; p.vy += rel * ny * 0.6; q.vx -= rel * nx * 0.6; q.vy -= rel * ny * 0.6; }
      p.draw(); q.draw();
      if (!p.awake || !q.awake) { p.awake = q.awake = true; stirred = true; }
    }
    return stirred;
  }

  /**
   * o: { x, y, a?, radius, inertia (Infinity = never turns), follow (how tightly it tracks the hand),
   *      friction, ball?, draw(b), canGrab?(), onGrab?(b), onDrop?(b, pt), onClick?(b), onStep?(b, dt) }
   */
  function movable(el, o) {
    const b = {
      el, o, x: o.x, y: o.y, a: o.a || 0, vx: 0, vy: 0, va: 0, ax: 0, ay: 0, lift: 0,
      held: false, target: null, awake: false,
    };
    let down = null, ptr = null, hand = null, g = null, dragged = false;

    b.draw = () => o.draw(b);

    b.step = (dt, lim) => {
      const pvx = b.vx, pvy = b.vy;
      if (b.held) {
        hand.x += (ptr.x - hand.x) * damp(dt, o.follow);
        hand.y += (ptr.y - hand.y) * damp(dt, o.follow);
        let cs = Math.cos(b.a), sn = Math.sin(b.a);
        const gx = g.x * cs - g.y * sn, gy = g.x * sn + g.y * cs;
        const dx = hand.x - (b.x + gx), dy = hand.y - (b.y + gy);
        let na = b.a;
        if (Number.isFinite(o.inertia)) na += (gx * dy - gy * dx) / (g.x * g.x + g.y * g.y + o.inertia);   // the off-centre pull turns it
        cs = Math.cos(na); sn = Math.sin(na);
        const nx = hand.x - (g.x * cs - g.y * sn), ny = hand.y - (g.x * sn + g.y * cs);
        b.vx += ((nx - b.x) / dt - b.vx) * 0.35;
        b.vy += ((ny - b.y) / dt - b.vy) * 0.35;
        b.va += ((na - b.a) / dt - b.va) * 0.35;
        if (o.ball) na += (nx - b.x) / o.radius;
        b.x = nx; b.y = ny; b.a = na;
      } else if (b.target) {
        const t = b.target, k = damp(dt, 9);
        b.x += (t.x - b.x) * k; b.y += (t.y - b.y) * k; b.a += (t.a - b.a) * k;
        b.vx = b.vy = b.va = 0;
        if (Math.hypot(t.x - b.x, t.y - b.y) < 0.6) { b.x = t.x; b.y = t.y; b.a = t.a; b.target = null; }
      } else {
        b.x += b.vx * dt; b.y += b.vy * dt;
        b.a += o.ball ? (b.vx * dt) / o.radius : b.va * dt;
        const f = Math.exp(-dt * o.friction);
        b.vx *= f; b.vy *= f; b.va *= Math.exp(-dt * o.friction * 1.5);
        const r = o.radius, bounce = o.ball ? 0.45 : 0.2;
        if (b.x < lim.l + r && lim.r - lim.l > r * 2) { b.x = lim.l + r; b.vx = Math.abs(b.vx) * bounce; }
        if (b.x > lim.r - r && lim.r - lim.l > r * 2) { b.x = lim.r - r; b.vx = -Math.abs(b.vx) * bounce; }
        if (b.y < lim.t + r && lim.b - lim.t > r * 2) { b.y = lim.t + r; b.vy = Math.abs(b.vy) * bounce; }
        if (b.y > lim.b - r && lim.b - lim.t > r * 2) { b.y = lim.b - r; b.vy = -Math.abs(b.vy) * bounce; }
      }
      b.ax += ((b.vx - pvx) / dt - b.ax) * 0.3;
      b.ay += ((b.vy - pvy) / dt - b.ay) * 0.3;
      b.lift += ((b.held ? 1 : 0) - b.lift) * damp(dt, 14);
      const more = o.onStep?.(b, dt);
      o.draw(b);
      return b.held || !!b.target || more || Math.hypot(b.vx, b.vy) > 4 || Math.abs(b.va) > 0.03 || b.lift > 0.01;
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button || (o.canGrab && !o.canGrab())) return;
      down = { pt: point(e), id: e.pointerId };
      dragged = false;
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      ptr = point(e);
      if (!b.held) {
        if (Math.hypot(ptr.x - down.pt.x, ptr.y - down.pt.y) < 6) return;
        b.held = dragged = true;
        b.target = null;
        b.vx = b.vy = b.va = 0;
        const cs = Math.cos(-b.a), sn = Math.sin(-b.a), dx = down.pt.x - b.x, dy = down.pt.y - b.y;
        g = { x: dx * cs - dy * sn, y: dx * sn + dy * cs };
        hand = { ...down.pt };
        el.classList.add('held');
        o.onGrab?.(b);
        b.awake = true;
        wake();
      }
    });
    const release = (e) => {
      if (!down) return;
      down = null;
      if (!b.held) return;
      b.held = false;
      el.classList.remove('held');
      const sp = Math.hypot(b.vx, b.vy), max = o.ball ? 1500 : 1200;
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      o.onDrop?.(b, ptr, e);
      b.awake = true;
      wake();
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    // a drag is not a click
    el.addEventListener('click', (e) => {
      if (dragged) { dragged = false; e.stopPropagation(); e.preventDefault(); return; }
      o.onClick?.(b, e);
    }, true);

    b.glide = (x, y, a = 0) => { b.target = { x, y, a }; b.awake = true; wake(); };
    b.toss = (vx, vy) => { b.vx = vx; b.vy = vy; b.awake = true; wake(); };
    b.remove = () => bodies.delete(b);
    bodies.add(b);
    return b;
  }

  /* ───────────── kinds of thing ───────────── */

  // something drawn inside the desk SVG, moved about its own centre
  function item(el, cx, cy, o = {}) {
    const lift = o.lifts ?? 0.035;
    return movable(el, {
      x: cx, y: cy, radius: 50, inertia: Infinity, follow: 22, friction: 7, ...o,
      draw(b) {
        const s = 1 + lift * b.lift;
        el.setAttribute('transform',
          `translate(${(b.x - cx).toFixed(2)} ${(b.y - cy).toFixed(2)}) rotate(${(b.a / RAD).toFixed(2)} ${cx} ${cy}) translate(${cx} ${cy}) scale(${s.toFixed(4)}) translate(${-cx} ${-cy})`);
      },
    });
  }

  // a finished sheet lying in the pile
  function sheet(el, pose, o = {}) {
    return movable(el, {
      ...pose, radius: 90, inertia: 5200, follow: 30, friction: 8, ...o,
      onGrab(b) { el.classList.add('loose'); o.onGrab?.(b); },
      draw(b) { el.style.transform = sheetTransform(b); },
    });
  }

  // a crumpled ball: light, rolls, bounces off the edge of the desk and off other balls
  function ball(canvas, x, y, o = {}) {
    const el = document.createElement('div');
    el.className = 'ball';
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    el.title = 'A crumpled page — click to open it, drag to roll it';
    el.setAttribute('aria-label', 'Crumpled page. Open it.');
    el.append(canvas);
    stage.append(el);
    const b = movable(el, {
      x, y, a: rnd(0, 6), radius: 36, inertia: Infinity, follow: 26, friction: 2.3, ball: true, ...o,
      draw(bb) {
        el.style.transform = `translate(${bb.x.toFixed(1)}px, ${bb.y.toFixed(1)}px) scale(${(1 + 0.08 * bb.lift).toFixed(3)})`;
        canvas.style.transform = `rotate(${bb.a.toFixed(3)}rad)`;
      },
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); o.onClick?.(b, e); } });
    const drop = b.remove;
    b.remove = () => { drop(); el.remove(); };
    b.draw();
    return b;
  }

  return { point, item, sheet, ball, wake };
}

/* ───────────── the corner of the page ───────────── */

/**
 * Lets the two lower corners of the current sheet be lifted. The fold is the perpendicular
 * bisector between where the corner was and where the finger has taken it.
 */
export function createCurl({ wrap, point, getSheet, canPull, onPull, hint }) {
  const { w: W, h: H } = PAGE;
  const LIMIT = 300, PULL = 252;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'curl');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = `
    <defs>
      <filter id="curlBlur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
      <linearGradient id="curlBack" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#bfb08f"/><stop offset=".1" stop-color="#fffaf0"/>
        <stop offset=".45" stop-color="#f1e9d6"/><stop offset="1" stop-color="#ddd0b4"/>
      </linearGradient>
    </defs>
    <polygon class="curl-hole" fill="rgba(0,0,0,.34)" filter="url(#curlBlur)"/>
    <polygon class="curl-cast" fill="rgba(30,18,8,.3)" filter="url(#curlBlur)"/>
    <polygon class="curl-flap" fill="url(#curlBack)" stroke="rgba(120,100,70,.35)" stroke-width=".6"/>`;
  wrap.append(svg);
  const hole = svg.querySelector('.curl-hole'), cast = svg.querySelector('.curl-cast'), flap = svg.querySelector('.curl-flap');
  const grad = svg.querySelector('#curlBack');

  let side = 1, len = 0, ang = 0.78, vel = 0, held = false, raf = 0, last = 0, grab = null, sheet = null, warned = false;

  function clear() {
    len = vel = 0;
    svg.style.display = 'none';
    if (sheet) { sheet.classList.remove('curling'); sheet.style.removeProperty('--clip'); }
    sheet = null;
  }

  function draw() {
    if (len < 0.6 || !sheet) { svg.style.display = 'none'; sheet?.classList.remove('curling'); return; }
    const dx = len * Math.cos(ang), dy = len * Math.sin(ang);
    const a = (len * len) / (2 * dx), b = (len * len) / (2 * dy);      // where the fold meets the bottom and side edges
    const mx = (x) => (side > 0 ? x : W - x);
    const C = [mx(W), H], P = [mx(W - dx), H - dy], A = [mx(W - a), H], B = [mx(W), H - b];
    const pts = (...p) => p.map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ');
    hole.setAttribute('points', pts(C, A, B));
    cast.setAttribute('points', pts([P[0] + 5, P[1] + 8], A, B));
    flap.setAttribute('points', pts(P, A, B));
    grad.setAttribute('x1', (A[0] + B[0]) / 2); grad.setAttribute('y1', (A[1] + B[1]) / 2);
    grad.setAttribute('x2', P[0]); grad.setAttribute('y2', P[1]);
    sheet.style.setProperty('--clip', side > 0
      ? `polygon(0 0, ${W}px 0, ${W}px ${H - b}px, ${W - a}px ${H}px, 0 ${H}px)`
      : `polygon(0 0, ${W}px 0, ${W}px ${H}px, ${a}px ${H}px, 0 ${H - b}px)`);
    sheet.classList.add('curling');
    svg.style.display = 'block';
  }

  function loop(now) {
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    if (!held) {
      // paper wants to lie flat: it springs back and flutters once
      vel += (-190 * len - 13 * vel) * dt;
      len += vel * dt;
      if (len <= 0) { len = 0; vel = Math.abs(vel) > 60 ? -vel * 0.28 : 0; }
    }
    draw();
    if (held || len > 0.6 || Math.abs(vel) > 4) raf = requestAnimationFrame(loop);
    else { raf = 0; clear(); }
  }

  function bind(handle, s) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button || held) return;
      const cur = getSheet();
      if (!cur) return;
      if (sheet && sheet !== cur) clear();
      sheet = cur; side = s; held = true; warned = false; vel = 0;
      const p = point(e);
      grab = { x: (s > 0 ? W : 0) + PAGE.x - p.x, y: H + PAGE.y - p.y };
      try { handle.setPointerCapture(e.pointerId); } catch {}
      e.preventDefault(); e.stopPropagation();
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    });
    handle.addEventListener('pointermove', (e) => {
      if (!held || side !== s) return;
      const p = point(e);
      const tipX = p.x + grab.x - PAGE.x, tipY = p.y + grab.y - PAGE.y;     // where the corner has been taken, in sheet units
      const dx = Math.max(0.01, s > 0 ? W - tipX : tipX), dy = Math.max(0.01, H - tipY);
      len = Math.min(LIMIT, Math.hypot(dx, dy));
      ang = clamp(Math.atan2(dy, dx), 0.34, 1.23);
      if (canPull() && len > PULL !== warned) { warned = len > PULL; hint('', warned ? 'Let go to set this sheet aside' : ''); }
    });
    const up = () => {
      if (!held || side !== s) return;
      held = false;
      if (warned && len > PULL && canPull()) { hint(); clear(); onPull(); }
    };
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  }

  for (const s of [1, -1]) {
    const h = document.createElement('div');
    h.className = `corner ${s > 0 ? 'br' : 'bl'}`;
    wrap.append(h);
    bind(h, s);
  }

  return { clear };
}

/** A ragged outline for a sheet being crushed in the hand: 0 is flat, 1 is nearly a ball. */
export function crush(t) {
  const pts = [];
  const n = 5;
  for (let side = 0; side < 4; side++) for (let i = 0; i < n; i++) {
    const f = i / n;
    let x = side === 0 ? f : side === 1 ? 1 : side === 2 ? 1 - f : 0;
    let y = side === 0 ? 0 : side === 1 ? f : side === 2 ? 1 : 1 - f;
    const pull = t * rnd(0.05, 0.3) + t * t * 0.16;
    x += (0.5 - x) * pull; y += (0.5 - y) * pull;
    pts.push(`${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}
