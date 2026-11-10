// A damped spring carries either part; the mouth guides the last bit of travel.
const RAD = Math.PI / 180;
const HOME = { x: 1230, y: 414, a: 90, s: 1 };
const DOCK = { x: 1230, y: 414 - 131 * 0.82, a: 90, s: 0.82 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function springStep(body, target, dt, stiffness = 260, damping = 30) {
  for (const key of ['x', 'y', 'a', 's']) {
    const velocity = `v${key}`;
    body[velocity] = (body[velocity] || 0) + ((target[key] - body[key]) * stiffness - (body[velocity] || 0) * damping) * dt;
    body[key] += body[velocity] * dt;
  }
}

const pose = (p) => ({ x: p.x, y: p.y, a: p.a, s: p.s ?? 1 });
const mouth = (p, depth = 131) => ({ x: p.x + Math.cos(p.a * RAD) * depth * p.s, y: p.y + Math.sin(p.a * RAD) * depth * p.s, a: p.a, s: 1 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createRecap({ stage, pen, cap, canStart, getPen, onBegin, onCap, onReturn, audio, hint }) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'cap-top';
  svg.setAttribute('viewBox', '1194 210 72 216');
  svg.setAttribute('aria-hidden', 'true');
  const copy = cap.cloneNode(true);
  copy.removeAttribute('id');
  svg.append(copy);
  stage.append(svg);

  let active = false, frame = 0, phase = '', dragged = null, hand = null;
  let p, c, pTarget, cTarget, original, candidate = false, last = 0, phaseStart = 0;
  let grab = null, heldElement = null, heldPointer = null;
  let suppressClick = false;

  function point(e) {
    const box = stage.getBoundingClientRect();
    const scale = box.width / 1600;
    return { x: (e.clientX - box.left) / scale, y: (e.clientY - box.top) / scale };
  }

  function draw() {
    pen.style.transform = `translate(${p.x - 490}px, ${p.y - 150}px) rotate(${p.a}deg) scale(${p.s})`;
    pen.style.setProperty('--lift', phase === 'rest' ? '0.3' : '1');
    svg.style.transform = `translate(${c.x - HOME.x}px, ${c.y - HOME.y}px) rotate(${c.a - 90}deg)`;
    stage.classList.toggle('cap-near', candidate);
  }

  function begin(part) {
    if (active || !canStart()) return false;
    active = true;
    dragged = part;
    original = pose(getPen());
    p = pose(original); c = pose(HOME);
    pTarget = pose(p); cTarget = pose(c);
    stage.classList.add('recapping');
    onBegin();
    last = performance.now();
    frame = requestAnimationFrame(tick);
    return true;
  }

  function changePhase(next) { phase = next; phaseStart = performance.now(); }

  function finish(capped) {
    active = false;
    candidate = false;
    phase = '';
    cancelAnimationFrame(frame);
    stage.classList.remove('recapping', 'cap-near', 'pen-held');
    if (capped) onCap(); else onReturn();
  }

  function dock() {
    candidate = false;
    if (dragged === 'cap') {
      pTarget = pose(p);
      cTarget = mouth(p, 164);
    } else {
      pTarget = { ...DOCK, y: DOCK.y + 28 };
      cTarget = pose(HOME);
    }
    changePhase('align');
    hint('', 'Let the cap find the nib…');
  }

  function settled() {
    return distance(p, pTarget) + distance(c, cTarget) < 1.4 &&
      Math.abs(p.a - pTarget.a) + Math.abs(c.a - cTarget.a) < 0.6 &&
      Math.abs(p.vx || 0) + Math.abs(p.vy || 0) + Math.abs(c.vx || 0) + Math.abs(c.vy || 0) < 12;
  }

  function tick(now) {
    if (!active) return;
    const dt = Math.min(1 / 30, (now - last) / 1000 || 1 / 60);
    last = now;
    if (phase === 'drag' && hand) {
      if (dragged === 'pen') {
        const attraction = clamp(1 - distance(hand, HOME) / 330, 0, 1);
        const angle = original.a + (90 - original.a) * attraction;
        const scale = 1 - attraction * 0.18;
        pTarget = { x: hand.x - Math.cos(angle * RAD) * grab.along * scale + Math.sin(angle * RAD) * grab.across * scale,
          y: hand.y - Math.sin(angle * RAD) * grab.along * scale - Math.cos(angle * RAD) * grab.across * scale, a: angle, s: scale };
        candidate = distance(mouth(pTarget), HOME) < 155;
      } else {
        cTarget = { x: hand.x - grab.x, y: hand.y - grab.y, a: c.a, s: 1 };
        const target = mouth(p);
        const attraction = clamp(1 - distance(cTarget, target) / 250, 0, 1);
        cTarget.a = 90 + (p.a - 90) * attraction;
        candidate = distance(cTarget, target) < 125;
      }
    }
    // Small substeps keep the spring stable after a delayed frame.
    springStep(p, pTarget, dt / 2); springStep(c, cTarget, dt / 2);
    springStep(p, pTarget, dt / 2); springStep(c, cTarget, dt / 2);
    if (phase === 'rest') c = { ...c, ...mouth(p) };
    draw();
    if (phase !== 'drag' && (settled() || now - phaseStart > 2200)) {
      if (phase === 'align') {
        if (dragged === 'cap') cTarget = mouth(pTarget);
        else pTarget = pose(DOCK);
        changePhase('seat');
      } else if (phase === 'seat') {
        audio.seat();
        pTarget = pose(DOCK); cTarget = pose(HOME);
        changePhase('rest');
      } else if (phase === 'rest') {
        audio.knock(); finish(true); return;
      } else if (phase === 'return') { finish(false); return; }
    }
    frame = requestAnimationFrame(tick);
  }

  function cancelDrag() {
    if (!active || phase !== 'drag') return;
    hand = null; grab = null;
    candidate = false;
    pTarget = pose(original); cTarget = pose(HOME);
    changePhase('return');
    hint('', 'Back to your letter', 2400);
  }

  function bind(element, part) {
    let down = null;
    element.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || active || !canStart()) return;
      down = { point: point(e), id: e.pointerId };
      heldElement = element; heldPointer = e.pointerId;
      element.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    element.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      const at = point(e);
      if (!active && distance(at, down.point) > 7) {
        if (!begin(part)) return;
        suppressClick = true;
        const dx = down.point.x - p.x, dy = down.point.y - p.y;
        grab = part === 'pen' ? { along: dx * Math.cos(p.a * RAD) + dy * Math.sin(p.a * RAD), across: -dx * Math.sin(p.a * RAD) + dy * Math.cos(p.a * RAD) }
          : { x: down.point.x - HOME.x, y: down.point.y - HOME.y };
        changePhase('drag');
        stage.classList.add('pen-held');
        hint('', part === 'pen' ? 'Bring the nib to its cap' : 'Bring the cap over the nib');
      }
      hand = at;
    });
    element.addEventListener('pointerup', (e) => {
      if (!down || e.pointerId !== down.id) return;
      down = null;
      if (active && phase === 'drag') {
        hand = null;
        if (candidate) dock(); else cancelDrag();
        stage.classList.remove('pen-held');
      }
      if (element.hasPointerCapture(e.pointerId)) element.releasePointerCapture(e.pointerId);
      heldElement = heldPointer = null;
    });
    element.addEventListener('pointercancel', () => { down = null; cancelDrag(); heldElement = heldPointer = null; });
    element.addEventListener('lostpointercapture', () => { down = null; cancelDrag(); });
    element.addEventListener('click', (e) => {
      if (suppressClick) { e.preventDefault(); e.stopPropagation(); suppressClick = false; }
    }, true);
  }

  bind(pen, 'pen'); bind(cap, 'cap');
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active && phase === 'drag') {
      e.preventDefault();
      cancelDrag();
      if (heldElement?.hasPointerCapture(heldPointer)) heldElement.releasePointerCapture(heldPointer);
    }
  });
  window.addEventListener('blur', cancelDrag);

  return {
    get active() { return active; },
    cap() {
      if (!begin('pen')) return;
      dock();
    },
  };
}
