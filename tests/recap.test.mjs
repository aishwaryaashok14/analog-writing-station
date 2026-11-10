import test from 'node:test';
import assert from 'node:assert/strict';
import { springStep } from '../src/recap.js';

test('pen settles into its cap at different frame rates', () => {
  for (const fps of [30, 60, 120]) {
    const p = { x: 600, y: 300, a: 50, s: 1, vx: 1800, vy: -500 };
    const target = { x: 1230, y: 306.58, a: 90, s: 0.82 };
    for (let frame = 0; frame < fps * 3; frame++) {
      springStep(p, target, 1 / (fps * 2));
      springStep(p, target, 1 / (fps * 2));
      for (const key of ['x', 'y', 'a', 's']) assert.ok(Number.isFinite(p[key]));
    }
    for (const key of ['x', 'y', 'a', 's']) assert.ok(Math.abs(p[key] - target[key]) < 0.01, `${key} settles at ${fps} fps`);
  }
});

test('released cap returns smoothly from a moving target without teleporting', () => {
  const c = { x: 1230, y: 414, a: 90, s: 1 };
  const dragged = { x: 680, y: 280, a: 50, s: 1 };
  springStep(c, dragged, 1 / 120);
  assert.ok(c.x < 1230 && c.x > dragged.x);
  const home = { x: 1230, y: 414, a: 90, s: 1 };
  for (let i = 0; i < 360; i++) springStep(c, home, 1 / 120);
  assert.ok(Math.hypot(c.x - home.x, c.y - home.y) < 0.01);
});
