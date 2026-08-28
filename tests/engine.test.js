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
  // 배율을 바꿔 가며 훑어도 매끄러운 곡선에서는 고립해가 하나도 나오면 안 된다
  const views = [
    view,
    { xmin: -1, xmax: 1, ymin: -1, ymax: 1, width: 900, height: 700 },
    { xmin: -30, xmax: 30, ymin: -20, ymax: 20, width: 900, height: 700 },
    { xmin: -100, xmax: 100, ymin: -70, ymax: 70, width: 900, height: 700 },
  ];
  const curves = {
    '원': (x, y) => x * x + y * y - 4,
    '포물선': (x, y) => y - x * x,
    '직선': (x, y) => x + y - 1,
    '쌍곡선': (x, y) => x * x - y * y - 1,
    '1/x': (x, y) => y - 1 / x,
    'tan': (x, y) => y - Math.tan(x),
    '렘니스케이트': (x, y) => (x * x + y * y) ** 2 - 2 * (x * x - y * y),
    '데카르트의 잎': (x, y) => x ** 3 + y ** 3 - 3 * x * y,
    'sin(xy)': (x, y) => Math.sin(x * y),
    '첨점 y³=x²': (x, y) => y ** 3 - x * x,     // 원점은 곡선 위의 첨점이지 고립해가 아니다
    '첨점 y²=x³': (x, y) => y * y - x ** 3,
    '접하는 두 원': (x, y) => (x * x + y * y - 1) * ((x - 2) ** 2 + y * y - 1),
  };
  for (const v of views) {
    for (const [name, f] of Object.entries(curves)) {
      assert.equal(traceImplicit(f, v).points.length, 0, `${name} (폭 ${v.xmax - v.xmin})`);
    }
  }
});

test('곡선에 바짝 붙은 고립해도 찾아낸다', () => {
  // y² = x²(x−a) 의 원점은 a > 0 일 때 고립해다. a 가 작아질수록 곡선이 가까워진다.
  for (const a of [1, 0.5, 0.3, 0.1, 0.05]) {
    const r = traceImplicit((x, y) => y * y - x * x * (x - a), view);
    assert.equal(r.points.length, 1, `a = ${a}`);
    assert.ok(Math.hypot(...r.points[0]) < 1e-6);
  }
  // a < 0 이면 원점이 곡선의 매듭점이므로 고립해가 아니다
  assert.equal(traceImplicit((x, y) => y * y - x * x * (x + 0.3), view).points.length, 0);
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
