import test from 'node:test';
import assert from 'node:assert/strict';
import { traceImplicit } from '../src/engine/implicit.js';
import { sampleFunction } from '../src/engine/sampler.js';
import { solveSystem2D, solve1D } from '../src/engine/solvers.js';

const view = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };

test('원은 닫힌 곡선 한 가지로 나온다', () => {
  const r = traceImplicit((x, y) => x * x + y * y - 4, view);
  assert.equal(r.polylines.length, 1);
  assert.equal(r.points.length, 0);
  const l = r.polylines[0];
  assert.ok(Math.hypot(l[0] - l[l.length - 2], l[1] - l[l.length - 1]) < 0.05);
  for (let i = 0; i < l.length; i += 2) {
    assert.ok(Math.abs(Math.hypot(l[i], l[i + 1]) - 2) < 5e-3);
  }
});

test('점근선을 곡선으로 오인하지 않는다', () => {
  const r = traceImplicit((x, y) => y - 1 / x, view);
  assert.equal(r.polylines.length, 2);            // 두 가지, 가운데 세로줄 없음
  for (const l of r.polylines) {
    for (let i = 0; i < l.length; i += 2) assert.ok(Math.abs(l[i]) > 0.05);
  }
});

test('tan x 는 극점마다 끊긴다', () => {
  const r = traceImplicit((x, y) => y - Math.tan(x), view);
  assert.ok(r.polylines.length >= 4);
});

test('고립해: x²+y²=0 은 원점 한 점', () => {
  const r = traceImplicit((x, y) => x * x + y * y, view);
  assert.equal(r.polylines.length, 0);
  assert.equal(r.points.length, 1);
  assert.ok(Math.hypot(...r.points[0]) < 1e-6);
});

test('고립해: sin²x + sin²y = 0 은 π 격자 점열', () => {
  const r = traceImplicit((x, y) => Math.sin(x) ** 2 + Math.sin(y) ** 2, view);
  assert.equal(r.points.length, 15);              // x: -2π..2π, y: -π..π
  for (const [x, y] of r.points) {
    assert.ok(Math.abs(Math.sin(x)) < 1e-6 && Math.abs(Math.sin(y)) < 1e-6);
  }
});

test('곡선과 고립해가 함께 있는 경우 (y²=x²(x-1))', () => {
  const r = traceImplicit((x, y) => y * y - x * x * (x - 1), view);
  assert.equal(r.points.length, 1);
  assert.ok(Math.hypot(...r.points[0]) < 1e-6);
  assert.ok(r.polylines.length >= 1);
});

test('곡선 위의 점을 고립해로 오인하지 않는다', () => {
  for (const f of [(x, y) => x * x + y * y - 4, (x, y) => y - x * x, (x, y) => x + y - 1]) {
    assert.equal(traceImplicit(f, view).points.length, 0);
  }
});

test('적응 표본화는 불연속에서 끊는다', () => {
  const r = sampleFunction((x) => 1 / x, -5, 5, { ymin: -4, ymax: 4 });
  assert.equal(r.polylines.length, 2);
});

test('연립방정식의 해', () => {
  const s = solveSystem2D((x, y) => x * x + y * y - 1, (x, y) => y - x, view);
  assert.equal(s.points.length, 2);
  for (const [x, y] of s.points) {
    assert.ok(Math.abs(x * x + y * y - 1) < 1e-9 && Math.abs(y - x) < 1e-9);
  }
});

test('한 변수 방정식의 해는 점열', () => {
  const roots = solve1D((x) => Math.sin(x), -10, 10);
  assert.equal(roots.length, 7);
});
