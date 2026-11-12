import test from 'node:test';
import assert from 'node:assert/strict';
import { sheetTransform, crush, PAGE } from '../src/desk.js';

// Apply the CSS transform the way the browser would (origin top-left) to a point on the sheet.
function place(css, px, py) {
  const [, tx, ty] = css.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/).map(Number);
  const a = Number(css.match(/rotate\(([-\d.]+)rad\)/)[1]);
  const s = Number(css.match(/scale\(([-\d.]+)\)/)[1]);
  const x = px * s, y = py * s;
  return [tx + x * Math.cos(a) - y * Math.sin(a) + PAGE.x, ty + x * Math.sin(a) + y * Math.cos(a) + PAGE.y];
}

test('a sheet is centred on the point it is asked to lie at, whatever its turn or size', () => {
  for (const [pose, s] of [[{ x: 275, y: 530, a: -0.12 }, 0.36], [{ x: 800, y: 560, a: 0.5 }, 0.13], [{ x: 1212, y: 905, a: 0 }, 1]]) {
    const [cx, cy] = place(sheetTransform(pose, s), PAGE.w / 2, PAGE.h / 2);
    assert.ok(Math.abs(cx - pose.x) < 0.2 && Math.abs(cy - pose.y) < 0.2, `${cx}, ${cy}`);
  }
});

test('a crushed outline keeps its corner count, so the browser can ease between squeezes', () => {
  const count = (p) => p.split(',').length;
  assert.equal(count(crush(0)), count(crush(1)));
  assert.match(crush(0), /^polygon\(0\.0% 0\.0%/);
});
