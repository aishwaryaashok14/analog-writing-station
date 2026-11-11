// Real fountain-pen friction; the other small desk sounds are synthesised.
// Recording credit and CC0 license: ../sounds/CREDITS.md.

let ctx = null;
let master = null;
let noiseBuf = null;
let scratchGain = null;
let penBuffer = null;
let penSource = null;
let penEnvelope = null;
let penStopTimer = null;
let penStroke = 0;
let scratchLevel = 0;
let rain = null;
let muted = false;

// Fetch early so the pen is ready by the time the filling ritual ends.
const penRecording = fetch(new URL('../sounds/fountain-pen.mp3', import.meta.url))
  .then((response) => response.ok ? response.arrayBuffer() : null)
  .catch(() => null);

function stopPen() {
  clearTimeout(penStopTimer);
  penStopTimer = null;
  if (!penSource) return;
  const source = penSource, envelope = penEnvelope;
  penSource = penEnvelope = null;
  const t = ctx.currentTime;
  envelope.gain.cancelScheduledValues(t);
  envelope.gain.setTargetAtTime(0, t, 0.008);
  source.stop(t + 0.045);
}

function startPen() {
  if (penSource || !penBuffer || muted) return;
  // Enter at real nib contact, varying the phrase without changing its pitch.
  const contacts = [0.2, 0.91, 2.26, 3.12, 3.62];
  const source = ctx.createBufferSource();
  source.buffer = penBuffer;
  source.loop = true;
  source.loopStart = 0.18;
  source.loopEnd = 4.32;
  const envelope = ctx.createGain();
  envelope.gain.setValueAtTime(0, ctx.currentTime);
  envelope.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.012);
  source.connect(envelope).connect(scratchGain);
  source.onended = () => { source.disconnect(); envelope.disconnect(); };
  source.start(ctx.currentTime, contacts[penStroke++ % contacts.length]);
  penSource = source;
  penEnvelope = envelope;
}

function makeNoise(seconds = 2) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function noiseSrc(loop = false) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = loop;
  if (loop) s.loopStart = Math.random();
  return s;
}

function burst({ dur = 0.1, type = 'bandpass', freq = 2000, q = 1, gain = 0.1, attack = 0.004, to = null, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const s = noiseSrc();
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t, Math.random() * 1.5, dur + 0.05);
}

function tone({ freq = 440, to = null, dur = 0.1, gain = 0.1, type = 'sine', attack = 0.003, delay = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const audio = {
  init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    noiseBuf = makeNoise();

    scratchGain = ctx.createGain(); scratchGain.gain.value = 0;
    scratchGain.connect(master);
    penRecording.then(async (bytes) => {
      if (!bytes) return;
      penBuffer = await ctx.decodeAudioData(bytes);
    }).catch((error) => console.warn('Could not load the fountain pen recording.', error));
  },

  setMuted(m) {
    muted = m;
    if (m) { scratchLevel = 0; stopPen(); }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05);
  },

  /** level 0..1 — how hard the nib is working right now */
  scratch(level) {
    if (!ctx) return;
    scratchLevel = Math.max(0, Math.min(1, level));
    clearTimeout(penStopTimer);
    const t = ctx.currentTime;
    scratchGain.gain.cancelScheduledValues(t);
    scratchGain.gain.setTargetAtTime(scratchLevel > 0 ? 0.4 + scratchLevel * 0.3 : 0, t, 0.012);
    if (scratchLevel > 0 && !muted) {
      startPen();
      // Audio-clock release survives a throttled or hidden browser tab.
      scratchGain.gain.setTargetAtTime(0, t + 0.09, 0.015);
      penStopTimer = setTimeout(stopPen, 150);
    } else {
      stopPen();
    }
  },

  knock() { burst({ dur: 0.07, type: 'lowpass', freq: 500, gain: 0.25 }); tone({ freq: 170, to: 110, dur: 0.09, gain: 0.18 }); },
  pop() { tone({ freq: 540, to: 170, dur: 0.08, gain: 0.22 }); burst({ dur: 0.02, type: 'highpass', freq: 3000, gain: 0.12 }); },
  tick() { burst({ dur: 0.016, freq: 3400 + Math.random() * 900, q: 3, gain: 0.07 }); },
  clink() {
    tone({ freq: 2350, dur: 0.4, gain: 0.05 });
    tone({ freq: 3710, dur: 0.28, gain: 0.03 });
    tone({ freq: 5230, dur: 0.16, gain: 0.02 });
    burst({ dur: 0.015, type: 'highpass', freq: 4000, gain: 0.08 });
  },
  bubble() { const f = 260 + Math.random() * 260; tone({ freq: f, to: f * 2.1, dur: 0.07, gain: 0.06 }); },
  drip() { tone({ freq: 900, to: 1700, dur: 0.05, gain: 0.07 }); tone({ freq: 500, to: 300, dur: 0.12, gain: 0.04, delay: 0.04 }); },
  wipe() { burst({ dur: 0.26, freq: 1300, to: 700, q: 0.7, gain: 0.09, attack: 0.05 }); },
  seat() { burst({ dur: 0.02, freq: 2600, q: 2, gain: 0.14 }); tone({ freq: 210, to: 140, dur: 0.07, gain: 0.14 }); },
  crumple() {
    for (let i = 0; i < 10; i++) {
      burst({ dur: 0.03 + Math.random() * 0.07, freq: 1700 + Math.random() * 3400, q: 1.1, gain: 0.05 + Math.random() * 0.1, delay: i * 0.052 + Math.random() * 0.03 });
    }
    burst({ dur: 0.5, type: 'bandpass', freq: 2400, to: 900, q: 0.5, gain: 0.07, attack: 0.05 });
  },
  paper() { burst({ dur: 0.55, type: 'bandpass', freq: 900, to: 2600, q: 0.5, gain: 0.1, attack: 0.12 }); },
  stamp() { tone({ freq: 120, to: 55, dur: 0.16, gain: 0.5 }); burst({ dur: 0.05, type: 'lowpass', freq: 700, gain: 0.3 }); },

  rain(on) {
    if (!ctx) return;
    if (on && !rain) {
      const g = ctx.createGain(); g.gain.value = 0;
      const a = noiseSrc(true);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const ga = ctx.createGain(); ga.gain.value = 0.5;
      a.connect(lp).connect(ga).connect(g);
      const b = noiseSrc(true);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 5200; bp.Q.value = 0.4;
      const gb = ctx.createGain(); gb.gain.value = 0.12;
      b.connect(bp).connect(gb).connect(g);
      g.connect(master);
      a.start(); b.start();
      g.gain.setTargetAtTime(0.16, ctx.currentTime, 1.2);
      const drops = setInterval(() => {
        if (Math.random() < 0.55) burst({ dur: 0.03, freq: 1800 + Math.random() * 3000, q: 6, gain: 0.012 + Math.random() * 0.02 });
      }, 130);
      rain = { g, a, b, drops };
    } else if (!on && rain) {
      const r = rain; rain = null;
      clearInterval(r.drops);
      r.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => { try { r.a.stop(); r.b.stop(); } catch {} }, 2500);
    }
  },
};
