import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, format } from '../src/math/parser.js';
import { compile, makeContext } from '../src/math/evaluator.js';
import { levenbergMarquardt } from '../src/math/numeric.js';
import { createContext, createObject, computeObject, analyzeObject } from '../src/ui/objects.js';
import { View } from '../src/ui/view.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
const ev = (src, env = {}) => compile(parse(src), makeContext())(env);

test('리스트 · 범위 · 내포', () => {
  assert.deepEqual(ev('[1...5]'), [1, 2, 3, 4, 5]);
  assert.deepEqual(ev('[1,3,...,11]'), [1, 3, 5, 7, 9, 11]);
  assert.deepEqual(ev('[n^2 for n=[1...5]]'), [1, 4, 9, 16, 25]);
  assert.deepEqual(ev('[5...1]'), [5, 4, 3, 2, 1]);
  assert.deepEqual(ev('[]'), []);
});

test('리스트에 연산과 함수를 원소마다 적용한다', () => {
  assert.deepEqual(ev('[1,2,3]+10'), [11, 12, 13]);
  assert.deepEqual(ev('[1,2,3]*[4,5,6]'), [4, 10, 18]);
  assert.deepEqual(ev('[1,2,3]^2'), [1, 4, 9]);
  assert.deepEqual(ev('-[1,2]'), [-1, -2]);
  assert.deepEqual(ev('abs([-1,2,-3])'), [1, 2, 3]);
});

test('통계 함수', () => {
  assert.equal(ev('mean([1,2,3,4])'), 2.5);
  assert.equal(ev('total([1,2,3])'), 6);
  assert.equal(ev('median([3,1,2])'), 2);
  assert.equal(ev('length([1...10])'), 10);
  assert.equal(ev('max([3,9,2])'), 9);
  assert.deepEqual(ev('sort([3,1,2])'), [1, 2, 3]);
  assert.ok(Math.abs(ev('stdev([2,4,4,4,5,5,7,9])') - 2.13808993) < 1e-6);
  assert.equal(ev('quantile([1,2,3,4], 0.5)'), 2.5);
});

test('조각별 정의와 정의역 제한', () => {
  assert.deepEqual([-2, -1, 0, 1, 2].map((x) => ev('{x<0: -x, x^2}', { x })), [2, 1, 0, 1, 4]);
  const r = [-1, 1, 2, 4].map((x) => ev('x^2{0<x<3}', { x }));
  assert.ok(Number.isNaN(r[0]) && r[1] === 1 && r[2] === 4 && Number.isNaN(r[3]));
  // 값이 있는 중괄호는 곱셈, 조건만 있는 중괄호는 제한
  assert.equal(format(parse('y = x {x<0: -1, 1}')), 'y = x·{x < 0: -1, 1}');
  assert.equal(format(parse('y = x^2 {0<x<3}')), 'y = {0 < x ∧ x < 3: x^2}');
  assert.equal(format(parse('y=x^2{x<0}+1')), 'y = {x < 0: x^2} + 1');
});

test('리스트 값을 갖는 식은 여러 곡선이 된다', () => {
  const ctx = createContext();
  const o = createObject('y = [1,2,3] x', ctx, 1, 0);
  const d = computeObject(o, B);
  assert.equal(d.branches, 3);
  assert.equal(d.polylines.length, 3);
  // 정의역이 제한되어 있어도 리스트임을 알아본다
  const o2 = createObject('y = [1,2,3] x^2 {0<x<3}', ctx, 2, 1);
  assert.equal(computeObject(o2, B).branches, 3);
});

test('자료 리스트와 점 찍기', () => {
  const ctx = createContext();
  createObject('x_1 = [1,2,3,4,5]', ctx, 1, 0);
  createObject('y_1 = [2,4,6,8,10]', ctx, 2, 1);
  const pts = createObject('(x_1, y_1)', ctx, 3, 2);
  assert.equal(pts.kind, 'points');
  assert.deepEqual(pts.points, [[1, 2], [2, 4], [3, 6], [4, 8], [5, 10]]);
  assert.equal(createObject('mean(y_1)', ctx, 4, 3).value, 6);
});

test('선형 회귀', () => {
  const ctx = createContext();
  createObject('x_1 = [1,2,3,4,5]', ctx, 1, 0);
  createObject('y_1 = [2.1, 3.9, 6.2, 7.8, 10.1]', ctx, 2, 1);
  const r = createObject('y_1 ~ a x_1 + b', ctx, 3, 2);
  assert.equal(r.kind, 'regression');
  assert.ok(Math.abs(r.values[0] - 1.99) < 1e-6);
  assert.ok(r.r2 > 0.99);
  // 구한 계수를 다른 식에서 쓸 수 있다
  assert.ok(Math.abs(createObject('y = a x + b', ctx, 4, 3).fn({ x: 1 }) - 2.04) < 1e-6);
  // 같은 회귀를 다시 계산해도 계수가 미지수로 남는다
  assert.equal(createObject('y_1 ~ a x_1 + b', ctx, 5, 4).kind, 'regression');
});

test('비선형 회귀', () => {
  const ctx = createContext();
  createObject('u_1 = [0,1,2,3,4,5,6]', ctx, 1, 0);
  createObject('v_1 = [4, 5.95, 9.15, 14.4, 23.0, 37.6, 61.3]', ctx, 2, 1);
  const r = createObject('v_1 ~ c e^(k u_1) + d', ctx, 3, 2);
  assert.equal(r.kind, 'regression');
  assert.ok(r.r2 > 0.999, `R² = ${r.r2}`);
  assert.ok(Math.abs(r.values[1] - 0.5) < 0.02);        // 지수의 계수 k ≈ 0.5
  const titles = analyzeObject(r, B, ctx).findings.map((f) => f.title);
  assert.ok(titles.some((t) => t.startsWith('결정계수')));
});

test('회귀는 자료가 없으면 이유를 밝힌다', () => {
  const ctx = createContext();
  assert.match(createObject('y_1 ~ a x_1 + b', ctx, 1, 0).error, /자료 리스트/);
});

test('Levenberg–Marquardt 는 비선형 모형을 찾아낸다', () => {
  const xs = [0, 1, 2, 3, 4, 5, 6];
  const ys = xs.map((x) => 3 * Math.exp(0.5 * x) + 1);
  const fit = levenbergMarquardt((p) => xs.map((x, i) => p[0] * Math.exp(p[1] * x) + p[2] - ys[i]), [1, 1, 0]);
  assert.ok(Math.abs(fit.params[0] - 3) < 1e-6);
  assert.ok(Math.abs(fit.params[1] - 0.5) < 1e-6);
  assert.ok(Math.abs(fit.params[2] - 1) < 1e-6);
});

test('x·y 축 배율을 따로 잡을 수 있다', () => {
  const v = new View(1000, 770);
  v.fit(-6, 6, -3000, 3000, 0.15, false);
  assert.ok(v.xmax > 6 && v.xmax < 8);
  assert.ok(v.ymax > 3000 && v.ymax < 4000);
  assert.equal(v.locked, false);
  // 왕복 변환이 정확해야 한다
  assert.ok(Math.abs(v.toMathX(v.toPxX(3.5)) - 3.5) < 1e-9);
  assert.ok(Math.abs(v.toMathY(v.toPxY(-2200)) + 2200) < 1e-6);
  v.squareUp();
  assert.equal(v.aspect, 1);
  v.zoomAt(500, 385, 2, 'y');
  assert.ok(Math.abs(v.aspect - 2) < 1e-9);
});

test('y = [1...5] 는 리스트 정의가 아니라 다섯 개의 가로선', () => {
  const ctx = createContext();
  const o = createObject('y = [1...5]', ctx, 1, 0);
  assert.equal(o.kind, 'function');
  assert.equal(computeObject(o, B).branches, 5);
});
