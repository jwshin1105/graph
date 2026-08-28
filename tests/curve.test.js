import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCurve } from '../src/analysis/curve.js';
import { createContext, createObject, computeObject } from '../src/ui/objects.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 900, height: 700 };
const curve = (src) => {
  const ctx = createContext();
  const o = createObject(src, ctx, 1, 0);
  o.visible = true;
  return analyzeCurve(computeObject(o, B, {}).polylines, { bounds: B });
};
const close = (a, b, tol) => Math.abs(a - b) <= tol;

test('닫힌 곡선의 둘레와 넓이', () => {
  const c = curve('(cos t, sin t)');
  assert.equal(c.closed, true);
  assert.ok(close(c.length, 2 * Math.PI, 1e-3), `둘레 ${c.length}`);
  assert.ok(close(c.area, Math.PI, 1e-3), `넓이 ${c.area}`);
});

test('심장형의 둘레는 8, 넓이는 3π/2', () => {
  const c = curve('r = 1 + cos t');
  assert.equal(c.closed, true);
  assert.ok(close(c.length, 8, 5e-3), `둘레 ${c.length}`);
  assert.ok(close(c.area, (3 * Math.PI) / 2, 5e-3), `넓이 ${c.area}`);
});

test('음함수 곡선도 잰다', () => {
  const c = curve('x^2 + y^2 = 4');
  assert.ok(close(c.length, 4 * Math.PI, 1e-2), `둘레 ${c.length}`);
  assert.ok(close(c.area, 4 * Math.PI, 1e-2), `넓이 ${c.area}`);
  // 초타원 x⁴ + y⁴ = 1 의 넓이는 약 3.7081
  assert.ok(close(curve('x^4 + y^4 = 1').area, 3.7081, 5e-3));
});

test('자기교차를 찾는다', () => {
  const lem = curve('(cos t, sin 2t)');
  assert.equal(lem.crossings.length, 1);
  assert.ok(Math.hypot(...lem.crossings[0]) < 1e-6, '원점에서 만나야 한다');
  // y² = x²(x+1) 의 원점은 매듭점이다
  assert.equal(curve('y^2 = x^2 (x + 1)').crossings.length, 1);
  // 안쪽 고리가 있는 리마송
  assert.equal(curve('r = 1 + 2cos t').crossings.length, 1);
});

test('되짚어 그리는 곡선을 수백 번 교차로 세지 않는다', () => {
  // r = sin 3θ 는 꽃잎 3장을 두 번씩 그린다 — 만나는 자리는 원점 하나다
  assert.equal(curve('r = sin(3t)').crossings.length, 1);
  assert.equal(curve('r = sin(2t)').crossings.length, 1);
});

test('스스로 가로지르면 넓이를 말하지 않는다', () => {
  const c = curve('(cos t, sin 2t)');
  assert.equal(c.closed, true);
  assert.equal(c.area, null);
});

test('닫히지 않은 곡선', () => {
  const c = curve('r = t; 0 <= t <= 6.2831853');
  assert.equal(c.closed, false);
  assert.ok(c.findings.some((f) => f.title.includes('열린 곡선')));
});

test('화면에 잘린 곡선은 열렸다고 단정하지 않는다', () => {
  const c = curve('y = x^2');
  assert.equal(c.closed, false);
  assert.ok(c.findings.some((f) => f.detail.includes('실제로는 더 깁니다')));
});

test('곡선이 없으면 아무 말도 하지 않는다', () => {
  const c = analyzeCurve([], {});
  assert.deepEqual(c.findings, []);
});
