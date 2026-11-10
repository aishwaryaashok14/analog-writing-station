// The pen, up close: uncap, unscrew, open the ink, dip, draw, wipe, close.
//
// Every step can be done two ways. A click lets the hand do it for you. A drag
// does it yourself: parts trail the pointer on a spring, a friction-fit cap
// gives a little and then pops, threads turn under a stroke and keep spinning
// from a flick, and whatever you let go of falls to the table.

const $ = (s) => document.querySelector(s);
const easeIO = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2);
const easeOut = (p) => 1 - Math.pow(1 - p, 3);
const easeIn = (p) => p * p;
const mod = (v, n) => ((v % n) + n) % n;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (dt, rate) => 1 - Math.exp(-dt * rate);
const RAD = Math.PI / 180;

const REST = { x: 260, y: 230 };          // where the pen floats, nib tip at the origin
const TURNS = 150;                        // thread travel, in units of barrel spin
const FLOOR = { cap: 580, barrel: 582, bcap: 148 };
const SPOT = { cap: [70, 150], barrel: [176, 206], bcap: [112, 190] };   // where each part ends up on the table

export function createRitual({ inks, audio, hint, onInk }) {
  const root = $('#ritual');
  const panel = root.querySelector('.r-panel');
  const svg = $('#r-svg');
  const el = {
    core: $('#r-core'), barrel: $('#r-barrel'), cap: $('#r-cap'), bcap: $('#r-bcap'),
    bottle: $('#r-bottle-back'), cloth: $('#r-cloth'),
    ink: $('#r-ink'), piston: $('#r-piston'), rod: $('#r-rod'), motif: $('#r-motif'),
    knurlH: $('#pKnurlH'), knurlV: $('#pKnurlV'),
    drop: $('#r-drop'), stain: $('#r-stain'), nibWet: $('#r-nib-wet'), bubbles: $('#r-bubbles'),
    shCap: $('#r-sh-cap'), shBarrel: $('#r-sh-barrel'), shBcap: $('#r-sh-bcap'),
    meter: $('#r-meter'), swatches: $('#r-swatches'), skip: $('#r-skip'),
    labelK: $('#r-label-k'), labelR: $('#r-label-r'),
    inkB: [...document.querySelectorAll('.r-inkB')],
  };

  const P = {};
  let gen = 0;            // bumping this silently abandons everything in flight
  let inkId = 'ai';
  let advance = null;     // what Enter / Space does right now
  let keyHold = null;     // { down, up } while the piston can be worked from the keyboard
  let cleanups = [];
  let finishOpen = null;
  let canCloseWithCap = false;

  function setCapClose(ready) {
    canCloseWithCap = ready;
    el.cap.classList.toggle('closable', ready);
    el.cap.setAttribute('aria-label', ready ? 'Close the pen preparation' : 'Uncap the pen');
    $('#r-cap-title').textContent = ready ? 'Click the cap again to close' : 'Uncap the pen';
    $('#r-cap-note').classList.toggle('on', ready);
    $('#r-cap-note').setAttribute('aria-hidden', String(!ready));
  }

  /* ───────────── drawing the state ───────────── */

  const near = (y, floor, span) => clamp(1 - (floor - y) / span, 0, 1);   // shadows gather as a part nears the table

  function apply() {
    const t = (o) => `translate(${o.x} ${o.y}) rotate(${o.r || 0} ${o.px || 0} ${o.py || 0})`;
    el.core.setAttribute('transform', t(P.core));
    el.barrel.setAttribute('transform', t(P.barrel));
    el.cap.setAttribute('transform', t(P.cap));
    el.bcap.setAttribute('transform', `translate(${P.bcap.x} ${P.bcap.y}) rotate(${P.bcap.r || 0} 770 428)`);
    el.motif.setAttribute('transform', `translate(0 ${mod(P.barrel.spin, 36)})`);
    el.knurlV.setAttribute('patternTransform', `translate(${mod(P.bcap.tw, 6)} 0)`);
    el.knurlH.setAttribute('patternTransform', `translate(0 ${mod(P.piston * 110, 5)})`);
    const px = 198 + 120 * P.piston;
    el.ink.setAttribute('width', Math.max(0, 2 + 120 * P.fill));
    el.piston.setAttribute('x', px);
    el.rod.setAttribute('x', px + 9);
    el.rod.setAttribute('width', Math.max(0, 332 - px - 9));
    for (const r of el.inkB) r.setAttribute('y', P.blevel);
    el.stain.setAttribute('rx', 22 * P.stain);
    el.stain.setAttribute('ry', 13 * P.stain);
    el.nibWet.setAttribute('opacity', 0.78 * P.wet);
    el.drop.setAttribute('cy', P.drop.y);
    el.drop.setAttribute('r', P.drop.r);
    el.cloth.setAttribute('transform', `translate(${P.cloth.x} ${P.cloth.y})`);
    el.cloth.setAttribute('opacity', P.cloth.o);
    el.shCap.setAttribute('cx', P.cap.x + 74);
    el.shCap.setAttribute('opacity', 0.32 * near(P.cap.y, FLOOR.cap, 150));
    el.shBarrel.setAttribute('cx', P.barrel.x + 306);
    el.shBarrel.setAttribute('opacity', 0.32 * near(P.barrel.y, FLOOR.barrel, 150));
    el.shBcap.setAttribute('cx', 770 + P.bcap.x);
    el.shBcap.setAttribute('opacity', 0.32 * near(P.bcap.y, FLOOR.bcap, 110) * smooth((P.bcap.x - 70) / 40));
    el.meter.firstElementChild.style.width = `${P.fill * 100}%`;
  }

  /* ───────────── motion ───────────── */

  function tween(obj, to, ms, ease = easeIO) {
    const my = gen;
    return new Promise((res) => {
      const from = {};
      for (const k in to) from[k] = obj[k] || 0;
      const t0 = performance.now();
      const f = (now) => {
        if (gen !== my) return;
        const p = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
        const e = ease(p);
        for (const k in to) obj[k] = from[k] + (to[k] - from[k]) * e;
        apply();
        p < 1 ? requestAnimationFrame(f) : res();
      };
      requestAnimationFrame(f);
    });
  }

  function sleep(ms) {
    const my = gen;
    return new Promise((res) => setTimeout(() => gen === my && res(), ms));
  }

  // a held part trails the hand on a slightly loose spring, and swings a little with its own speed
  function follow(o, tx, ty, dt, tilt = 0) {
    const k = 240, c = 26;
    o.vx = (o.vx || 0) + ((tx - o.x) * k - (o.vx || 0) * c) * dt;
    o.vy = (o.vy || 0) + ((ty - o.y) * k - (o.vy || 0) * c) * dt;
    o.x += o.vx * dt;
    o.y += o.vy * dt;
    if (tilt) o.r = (o.r || 0) + (clamp(o.vx * tilt, -16, 16) - (o.r || 0)) * damp(dt, 9);
  }

  // a released part falls, knocks the table, and slides the last bit to its place. true once it is at rest.
  function settle(o, dt, floor, [min, max]) {
    if (!o.landed) {
      o.vy = (o.vy || 0) + 2600 * dt;
      o.vx = (o.vx || 0) * Math.exp(-dt * 1.2);
      o.x = clamp(o.x + o.vx * dt, min - 420, max + 520);
      o.y += o.vy * dt;
      o.r = (o.r || 0) * Math.exp(-dt * 6);
      if (o.y >= floor) {
        o.y = floor;
        if (!o.hit) { o.hit = true; if (o.vy > 120) audio.knock(); }
        if (o.vy > 260) { o.vy *= -0.24; o.vx *= 0.5; } else { o.vy = 0; o.landed = true; }
      }
      return false;
    }
    const tx = clamp(o.x, min, max);
    o.x += (tx - o.x) * damp(dt, 7);
    o.r = (o.r || 0) * Math.exp(-dt * 14);
    o.y = floor;
    return Math.abs(tx - o.x) < 0.6 && Math.abs(o.r) < 0.4;
  }

  const grabbed = (o, pt) => {
    o.vx = o.vy = 0; o.landed = false; o.hit = false;
    return { x: pt.x - o.x, y: pt.y - o.y };
  };

  // turning a thread by stroking across it: the first direction you choose is "undo", the other does it back up
  function roller(total, perUnit) {
    let sign = 0, raw = 0, acc = 0, since = 0;
    return {
      get acc() { return acc; },
      by(d) {
        raw += d;
        if (!sign) { if (Math.abs(raw) < 8) return; sign = Math.sign(raw); }
        const before = acc;
        acc = clamp(acc + d * sign * perUnit, 0, total);
        since += Math.abs(acc - before);
        if (since > total / 11) { since = 0; audio.tick(); }
      },
    };
  }

  /* ───────────── the hand ───────────── */

  function toSvg(e) {
    const m = svg.getScreenCTM();
    return { x: (e.clientX - m.e) / m.a, y: (e.clientY - m.f) / m.d };
  }

  // Waits on a set of parts. Resolves 'click' for a press without movement (or Enter / Space),
  // 'drag' when the handlers decide the job is done by hand.
  function gesture(els, h) {
    const my = gen;
    return new Promise((res) => {
      let down = null, dragging = false, refused = false, over = false, last = performance.now();
      const finish = (how) => { if (over) return; over = true; off(); res(how); };
      const onDown = (e) => {
        if (e.button) return;
        down = { pt: toSvg(e), el: e.currentTarget };
        dragging = refused = false;
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!down || refused) return;
        const pt = toSvg(e);
        if (!dragging) {
          if (Math.hypot(pt.x - down.pt.x, pt.y - down.pt.y) < 6) return;
          if (h.start?.(down.pt, down.el) === false) { refused = true; return; }
          dragging = true;
          root.classList.add('grabbing');
        }
        h.move?.(pt);
      };
      const onUp = () => {
        if (!down) return;
        const was = dragging;
        down = null; dragging = false;
        root.classList.remove('grabbing');
        if (was) h.end?.(); else finish('click');
      };
      const loop = (now) => {
        if (gen !== my || over) return;
        const dt = Math.min(0.04, (now - last) / 1000);
        last = now;
        h.frame?.(dt, () => finish('drag'));
        apply();
        requestAnimationFrame(loop);
      };
      const off = () => {
        for (const e of els) { e.classList.remove('target'); e.removeEventListener('pointerdown', onDown); }
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        root.classList.remove('grabbing');
        advance = null;
      };
      for (const e of els) { e.classList.add('target'); e.addEventListener('pointerdown', onDown); }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      advance = () => finish('click');
      cleanups.push(off);
      requestAnimationFrame(loop);
    });
  }

  function ticking(every = 95) {
    const id = setInterval(() => audio.tick(), every);
    cleanups.push(() => clearInterval(id));
    return () => clearInterval(id);
  }

  function bubble() {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', 770 + (Math.random() * 44 - 22));
    c.setAttribute('cy', 566);
    c.setAttribute('r', 1.5 + Math.random() * 2.5);
    el.bubbles.append(c);
    c.animate([{ transform: 'translateY(0)', opacity: 0.8 }, { transform: `translateY(${-(566 - P.blevel) + 4}px)`, opacity: 0 }], { duration: 500 + Math.random() * 400, easing: 'ease-out' }).onfinish = () => c.remove();
  }

  /* ───────────── the steps ───────────── */

  // 二 — a friction-fit cap: it gives a little, then lets go all at once
  async function stepCap() {
    const c = P.cap;
    let held = false, popped = false, grab = null, tgt = null;
    hint('1', 'Pull off the cap');
    const how = await gesture([el.cap], {
      start(pt) { held = true; grab = grabbed(c, pt); tgt = { x: c.x, y: c.y }; c.px = grab.x; c.py = grab.y; },
      move(pt) { tgt = { x: pt.x - grab.x, y: pt.y - grab.y }; },
      end() { held = false; },
      frame(dt, done) {
        if (!popped) {
          if (held) {
            const pull = REST.x - tgt.x;
            c.x = REST.x - clamp(pull, -3, 60) * 0.3;
            if (pull > 52) { popped = true; audio.pop(); c.vx = -420; c.vy = 0; }
          } else c.x += (REST.x - c.x) * damp(dt, 20);
        } else if (held) follow(c, tgt.x, tgt.y, dt, 0.02);
        else if (settle(c, dt, FLOOR.cap, SPOT.cap)) done();
      },
    });
    if (how === 'click') {
      if (!popped) { audio.pop(); await tween(c, { x: c.x - 64 }, 300, easeOut); }
      await tween(c, { x: 140, y: FLOOR.cap, r: 0 }, 650);
      audio.knock();
    }
  }

  // 三 — the barrel turns under a stroke, spins on from a flick, and comes away once the threads run out
  async function stepUnscrew() {
    const b = P.barrel;
    const roll = roller(TURNS, 0.62);
    let held = false, free = false, lifted = false, told = false, grab = null, tgt = null, lastY = 0, lastT = 0, w = 0;
    hint('2', 'Unscrew the barrel');
    const how = await gesture([el.barrel], {
      start(pt) { held = true; grab = grabbed(b, pt); tgt = { x: b.x, y: b.y }; b.px = grab.x; b.py = grab.y; lastY = pt.y; lastT = performance.now(); w = 0; },
      move(pt) {
        const now = performance.now(), dy = pt.y - lastY, dtm = Math.max(8, now - lastT) / 1000;
        lastY = pt.y; lastT = now;
        if (!free) { b.spin += dy; roll.by(dy); w = w * 0.5 + (dy / dtm) * 0.5; }
        tgt = { x: pt.x - grab.x, y: pt.y - grab.y };
      },
      end() { held = false; },
      frame(dt, done) {
        if (!free) {
          if (!held && Math.abs(w) > 20) { const d = w * dt; b.spin += d; roll.by(d); w *= Math.exp(-dt * 2.6); }
          b.x = REST.x + (16 * roll.acc) / TURNS;
          if (roll.acc >= TURNS) { free = true; audio.seat(); }
        } else if (held) { lifted = true; follow(b, tgt.x, tgt.y, dt, 0.012); }
        else if (lifted) { if (settle(b, dt, FLOOR.barrel, SPOT.barrel)) done(); }
        else if (!told) { told = true; hint('2', 'It is loose now — pull the barrel away'); }
      },
    });
    if (how === 'click') {
      const left = 1 - roll.acc / TURNS;
      if (!free) { const stop = ticking(); await tween(b, { spin: b.spin + TURNS * left, x: REST.x + 16 }, 1150 * left + 40); stop(); }
      if (!lifted) await tween(b, { x: REST.x + 150 }, 380, easeOut);
      await tween(b, { x: 180, y: FLOOR.barrel, r: 0 }, 700);
      audio.knock();
    }
  }

  // 四 — the bottle cap twists off the same way, sideways
  async function stepOpenBottle() {
    const c = P.bcap;
    const roll = roller(46, 0.24);
    let held = false, free = false, lifted = false, grab = null, tgt = null, lastX = 0, lastT = 0, w = 0;
    el.swatches.classList.remove('locked');
    hint('3', 'Choose an ink, then twist the cap off');
    const how = await gesture([el.bcap], {
      start(pt) { held = true; grab = grabbed(c, pt); tgt = { x: c.x, y: c.y }; lastX = pt.x; lastT = performance.now(); w = 0; el.swatches.classList.add('locked'); },
      move(pt) {
        const now = performance.now(), dx = pt.x - lastX, dtm = Math.max(8, now - lastT) / 1000;
        lastX = pt.x; lastT = now;
        if (!free) { c.tw += dx * 0.5; roll.by(dx); w = w * 0.5 + (dx / dtm) * 0.5; }
        tgt = { x: pt.x - grab.x, y: pt.y - grab.y };
      },
      end() { held = false; },
      frame(dt, done) {
        if (!free) {
          if (!held && Math.abs(w) > 20) { const d = w * dt; c.tw += d * 0.5; roll.by(d); w *= Math.exp(-dt * 2.6); }
          c.y = (-8 * roll.acc) / 46;
          if (roll.acc >= 46) { free = true; audio.clink(); }
        } else if (held) { lifted = true; follow(c, tgt.x, tgt.y, dt, 0.015); }
        else if (lifted) {
          if (!c.landed && c.x < 105) c.vx += 1500 * dt;          // let go over the bottle: it tumbles off to the side
          if (settle(c, dt, FLOOR.bcap, SPOT.bcap)) done();
        }
      },
    });
    el.swatches.classList.add('locked');
    if (how === 'click') {
      const left = 1 - roll.acc / 46;
      if (!free) { const stop = ticking(120); await tween(c, { tw: c.tw + 46 * left, y: -8 }, 800 * left + 40); stop(); audio.clink(); }
      if (c.y > -40 || c.x < 105) {
        await tween(c, { y: Math.min(c.y, -62), r: 0 }, 300, easeOut);
        await tween(c, { x: 150, y: -44 }, 380);
      }
      await tween(c, { x: clamp(c.x, ...SPOT.bcap), y: FLOOR.bcap, r: 0 }, 360, easeIn);
      audio.knock();
    }
  }

  // 五 — carry the pen over; it tips nib-down as it nears the bottle, and only the mouth lets it in
  async function stepDip() {
    const c = P.core;
    let held = false, wetted = false, d = 0, ptr = null;
    hint('4', 'Dip the nib into the ink');
    const how = await gesture([el.core, el.bottle], {
      start(pt, from) {
        if (from !== el.core) return false;
        held = true; c.vx = c.vy = 0; ptr = pt;
        d = (pt.x - c.x) * Math.cos(c.r * RAD) + (pt.y - c.y) * Math.sin(c.r * RAD);   // how far up the pen it is held
      },
      move(pt) { ptr = pt; },
      end() { held = false; },
      frame(dt, done) {
        if (held) {
          c.r += (-90 * smooth((c.x - 380) / 300) - c.r) * damp(dt, 10);
          let tx = ptr.x - d * Math.cos(c.r * RAD), ty = ptr.y - d * Math.sin(c.r * RAD);
          const off = Math.abs(tx - 770);
          if (c.y > 452 || (off < 26 && c.r < -80)) { tx = 770 + clamp(tx - 770, -4, 4); ty = Math.min(ty, 574); }
          else if (off < 112) ty = Math.min(ty, 446);       // glass
          else ty = Math.min(ty, 592);                      // table
          follow(c, tx, ty, dt);
          if (c.y > 452) c.x = 770 + clamp(c.x - 770, -5, 5);
          if (!wetted && c.y > 512) { wetted = true; audio.drip(); }
        } else if (c.y > 452) {
          // let go inside the bottle: it sinks the rest of the way
          c.r += (-90 - c.r) * damp(dt, 10);
          follow(c, 770, 574, dt);
          if (Math.abs(c.y - 574) < 1 && Math.abs(c.vy) < 8) done();
        } else if (ptr) {
          // let go in the air: the hand brings it back
          c.r += (0 - c.r) * damp(dt, 7);
          follow(c, REST.x, REST.y, dt);
        }
      },
    });
    if (how === 'click') {
      if (c.y < 440) await tween(c, { x: 770, y: Math.min(c.y, 400), r: -90 }, 950);
      await tween(c, { x: 770, y: 574, r: -90 }, 800);
      if (!wetted) audio.drip();
    } else { c.x = 770; c.y = 574; c.r = -90; }
  }

  // 六 — work the piston: pull it up by hand, or hold and let it turn. The ink follows a beat behind.
  function stepFill() {
    const my = gen;
    hint('5', 'Pull the piston up, or press and hold, to draw the ink');
    return new Promise((res) => {
      let last = performance.now(), bub = 0, released = 0, warned = false;
      let pressing = false, mode = 'hold', startY = 0, startP = 0, want = P.piston;
      el.meter.classList.add('on');
      const down = (e) => {
        if (e.target.closest?.('button')) return;
        pressing = true; mode = 'hold';
        startY = toSvg(e).y; startP = P.piston;
      };
      const move = (e) => {
        if (!pressing) return;
        const dy = startY - toSvg(e).y;
        if (mode === 'hold' && Math.abs(dy) > 6) { mode = 'pull'; root.classList.add('grabbing'); }
        if (mode === 'pull') want = clamp(startP + dy / 120, 0, 1);
      };
      const up = () => { if (pressing) released = performance.now(); pressing = false; root.classList.remove('grabbing'); };
      panel.addEventListener('pointerdown', down);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      keyHold = { down() { pressing = true; mode = 'hold'; }, up };
      const off = () => {
        keyHold = null;
        el.meter.classList.remove('on');
        panel.removeEventListener('pointerdown', down);
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        root.classList.remove('grabbing');
      };
      cleanups.push(off);
      const f = (now) => {
        if (gen !== my) return;
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        if (pressing) {
          if (mode === 'hold') P.piston = Math.min(1, P.piston + dt / 2.6);
          else P.piston += (want - P.piston) * damp(dt, 22);
        }
        const before = P.fill;
        if (P.fill > P.piston) P.fill = P.piston;                                   // pushed back down: the ink goes with it
        else P.fill += Math.min(P.piston - P.fill, dt * 0.7 + (P.piston - P.fill) * dt * 5);
        if (P.fill !== before) {
          P.blevel = 505 + P.fill * 12;
          bub += dt;
          if (bub > 0.16) { bub = 0; audio.bubble(); bubble(); }
        }
        apply();
        if (!pressing && released && P.fill < 0.2 && !warned) { warned = true; hint('5', 'A little more — keep drawing'); }
        const caught = P.piston - P.fill < 0.01;
        if ((P.fill >= 0.995 && caught) || (!pressing && released && caught && P.fill >= 0.2 && now - released > 550)) { off(); res(); return; }
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    });
  }

  // 七 — rub the nib with the cloth until it comes away clean
  async function stepWipe() {
    const cl = P.cloth;
    let held = false, grab = null, tgt = null, rub = 0, beat = 0, lastX = 0;
    hint('6', 'Wipe the nib clean');
    await tween(cl, { x: 176, y: 330, o: 1 }, 500, easeOut);
    lastX = cl.x;
    const how = await gesture([el.cloth, el.core], {
      start(pt, from) {
        if (from !== el.cloth) return false;
        held = true; grab = grabbed(cl, pt); tgt = { x: cl.x, y: cl.y };
      },
      move(pt) { tgt = { x: pt.x - grab.x, y: pt.y - grab.y }; },
      end() { held = false; },
      frame(dt, done) {
        if (held) follow(cl, tgt.x, tgt.y, dt);
        else { cl.vx = (cl.vx || 0) * Math.exp(-dt * 8); cl.vy = (cl.vy || 0) * Math.exp(-dt * 8); cl.x += cl.vx * dt; cl.y += cl.vy * dt; }
        const dx = Math.abs(cl.x - lastX);
        lastX = cl.x;
        if (cl.x > 214 && cl.x < 366 && cl.y > 196 && cl.y < 276) {
          rub += dx; beat += dx;
          if (beat > 64) { beat = 0; audio.wipe(); }
          P.stain = Math.min(1, rub / 180);
          P.wet = 1 - P.stain;
          if (rub >= 180) done();
        }
      },
    });
    if (how === 'click') {
      await tween(cl, { x: 300, y: 238 }, 420);
      audio.wipe();
      await tween(cl, { x: 236 }, 300);
      tween(P, { stain: Math.max(P.stain, 0.7), wet: 0 }, 300);
      await tween(cl, { x: 296 }, 250);
      audio.wipe();
      tween(P, { stain: 1 }, 300);
      await tween(cl, { x: 226 }, 300);
    }
    P.wet = 0;
    await tween(cl, { x: 150, y: 420, o: 0 }, 600);
  }

  // 八 — bring the barrel back to the threads; it catches, then turns home
  async function stepScrewOn() {
    const b = P.barrel;
    const roll = roller(TURNS, 0.62);
    const home = { x: REST.x + 16, y: REST.y };
    let held = false, engaged = false, lifted = false, grab = null, tgt = null, lastY = 0, lastT = 0, w = 0;
    hint('7', 'Screw the barrel back on');
    const how = await gesture([el.barrel], {
      start(pt) { held = true; grab = grabbed(b, pt); tgt = { x: b.x, y: b.y }; b.px = grab.x; b.py = grab.y; lastY = pt.y; lastT = performance.now(); w = 0; },
      move(pt) {
        const now = performance.now(), dy = pt.y - lastY, dtm = Math.max(8, now - lastT) / 1000;
        lastY = pt.y; lastT = now;
        if (engaged) { b.spin += dy; roll.by(dy); w = w * 0.5 + (dy / dtm) * 0.5; }
        tgt = { x: pt.x - grab.x, y: pt.y - grab.y };
      },
      end() { held = false; },
      frame(dt, done) {
        if (engaged) {
          if (!held && Math.abs(w) > 20) { const d = w * dt; b.spin += d; roll.by(d); w *= Math.exp(-dt * 2.6); }
          b.x += (REST.x + 16 * (1 - roll.acc / TURNS) - b.x) * damp(dt, 25);
          b.y += (REST.y - b.y) * damp(dt, 25);
          b.r = (b.r || 0) * Math.exp(-dt * 20);
          if (roll.acc >= TURNS) done();
        } else if (held) {
          lifted = true;
          follow(b, tgt.x, tgt.y, dt, 0.012);
          if (Math.hypot(b.x - home.x, b.y - home.y) < 30) { engaged = true; w = 0; audio.tick(); hint('7', 'It has caught — now turn it home'); }
        } else if (lifted && settle(b, dt, FLOOR.barrel, SPOT.barrel)) lifted = false;
      },
    });
    if (how === 'click') {
      if (!engaged) await tween(b, { x: home.x, y: home.y, r: 0 }, 750);
      const left = 1 - roll.acc / TURNS;
      const stop = ticking();
      await tween(b, { spin: b.spin - TURNS * left, x: REST.x, y: REST.y, r: 0 }, 1000 * left + 40);
      stop();
    }
    b.x = REST.x; b.y = REST.y; b.r = 0;
    audio.seat();
  }

  async function sequence(o) {
    await sleep(750);
    if (o.uncap) await stepCap();
    setCapClose(true);
    await stepUnscrew();
    await stepOpenBottle();
    await stepDip();
    await stepFill();

    // out of the bottle; one drop falls back
    hint();
    P.wet = 1;
    await tween(P.core, { y: 400 }, 800);
    await sleep(220);
    P.drop.y = 404; P.drop.r = 3.2;
    await tween(P.drop, { y: P.blevel }, 330, easeIn);
    P.drop.r = 0; apply();
    audio.drip();
    await tween(P.core, { x: REST.x, y: REST.y, r: 0 }, 950);

    await stepWipe();
    await stepScrewOn();
    hint();

    // the bottle is closed again, unasked — good habits
    const c = P.bcap;
    await tween(c, { y: -62, r: 0 }, 320);
    await tween(c, { x: 0 }, 380);
    await tween(c, { y: 0, tw: 0 }, 520);
    audio.clink();
    await sleep(650);
  }

  /* ───────────── scene ───────────── */

  function setInk(id) {
    inkId = id;
    const k = inks[id];
    document.documentElement.style.setProperty('--ink', k.c);
    el.labelK.textContent = k.en;
    el.labelR.textContent = 'FOUNTAIN INK';
    for (const b of el.swatches.children) b.classList.toggle('on', b.dataset.ink === id);
    onInk?.(id);
  }

  for (const [id, k] of Object.entries(inks)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.ink = id;
    b.style.setProperty('--c', k.c);
    b.textContent = k.short;
    b.title = `${k.en} ink`;
    b.setAttribute('aria-label', `${k.en} ink`);
    b.addEventListener('click', () => setInk(id));
    el.swatches.append(b);
  }

  function resetScene(o) {
    P.core = { ...REST, r: 0 };
    P.barrel = { ...REST, r: 0, spin: 0 };
    P.cap = o.uncap ? { ...REST, r: 0 } : { x: 140, y: FLOOR.cap, r: 0 };
    P.bcap = { x: 0, y: 0, r: 0, tw: 0 };
    P.cloth = { x: 150, y: 420, o: 0 };
    P.drop = { y: 400, r: 0 };
    P.fill = P.piston = Math.min(0.95, o.level || 0);
    P.blevel = 505; P.stain = 0; P.wet = 0;
    el.cap.style.display = '';
    el.shCap.style.display = '';
    setCapClose(!o.uncap);
    el.swatches.classList.add('locked');
    el.meter.classList.remove('on');
    el.bubbles.replaceChildren();
    setInk(o.inkId || inkId);
    apply();
  }

  function close() {
    for (const c of cleanups) c();
    cleanups = [];
    advance = null;
    keyHold = null;
    root.classList.remove('grabbing');
    setCapClose(false);
    hint();
    root.classList.remove('open');
    root.setAttribute('aria-hidden', 'true');
    root.inert = true;
  }

  el.skip.addEventListener('click', () => finishOpen?.(true));
  el.cap.addEventListener('click', () => {
    if (canCloseWithCap) { audio.seat(); finishOpen?.(false, true); }
  });
  el.cap.addEventListener('keydown', (e) => {
    if (canCloseWithCap && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault(); e.stopPropagation();
      audio.seat(); finishOpen?.(false, true);
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!root.classList.contains('open') || e.repeat) return;
    if (e.key === 'Escape') { e.preventDefault(); finishOpen?.(false, true); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (keyHold) keyHold.down(); else advance?.();
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') keyHold?.up();
  });

  return {
    /** resolves with { inkId, level } once the pen is ready to write */
    open(o) {
      gen++;
      resetScene(o);
      root.classList.add('open');
      root.setAttribute('aria-hidden', 'false');
      root.inert = false;
      return new Promise((res) => {
        const my = gen;
        finishOpen = (skipped, cancelled = false) => {
          if (gen !== my) return;
          finishOpen = null;
          gen++;
          if (skipped) P.fill = 1;
          close();
          res({ inkId, level: P.fill, cancelled });
        };
        sequence(o).then(() => finishOpen?.(false));
      });
    },
  };
}
