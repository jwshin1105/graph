import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createObject, computeObject, analyzeObject } from '../src/ui/objects.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
const make = (src, ctx = createContext()) => {
  const o = createObject(src, ctx, 1, 0);
  if (!o.error) o.data = computeObject(o, B);
  return o;
};
const nv = (o) => (o.data.polylines || []).reduce((s, l) => s + l.length / 2, 0);

test('입력 종류를 알맞게 분류한다', () => {
  const cases = {
    'y=x^2-2': 'function', 'x=3': 'functionY', 'x^2+y^2=4': 'implicit',
    'y<x^2': 'region', 'sin x = 0': 'equation1d', 'x^2+y^2=4 and y=x': 'system',
    'x=1 or x=2': 'union', '(2,3)': 'point', '{(1,2),(2,4)}': 'points',
    '[1,1,2,3]': 'sequence', 'a_1=1; a_n=2a_{n-1}': 'sequence',
    'r=1+cos(θ)': 'polar', '(cos t, sin t)': 'parametric', '2+3*4': 'value',
    'f(x)=x^2': 'function', 'g(x,y)=x^2+y^2': 'defined', 'a=2': 'constant',
  };
  for (const [src, kind] of Object.entries(cases)) {
    assert.equal(make(src).kind, kind, `${src} 는 ${kind} 이어야 함`);
  }
});

test('or 로 이은 방정식은 해집합의 합집합', () => {
  const o = make('x=1 or x=2');
  assert.equal(o.kind, 'union');
  assert.equal(o.data.polylines.length, 2);
  const o2 = make('x^2+y^2=4 or y=x');
  assert.equal(o2.data.polylines.length, 2);
});

test('한 변수 연립방정식은 공통근으로 푼다', () => {
  const o = make('sin x=0 and cos x=-1');
  assert.equal(o.kind, 'system');
  assert.equal(o.data.points.length, 2);
  for (const [x] of o.data.points) assert.ok(Math.abs(Math.abs(x) - Math.PI) < 1e-9);
});

test('식이 셋 이상인 과결정 연립도 전부 검사한다', () => {
  assert.equal(make('x+y=3 and x-y=1 and 2x+y=4').data.points.length, 0);   // 모순계
  const ok = make('x+y=3 and x-y=1 and 2x+y=5').data.points;
  assert.equal(ok.length, 1);
  assert.ok(Math.abs(ok[0][0] - 2) < 1e-6 && Math.abs(ok[0][1] - 1) < 1e-6);
});

test('해가 없으면 그렇다고 알린다', () => {
  for (const src of ['x^2+y^2=-1', 'e^x=x']) {
    const o = make(src);
    assert.equal(o.data.empty, true);
    assert.equal(analyzeObject(o, B, createContext()).summary, '해 없음');
  }
});

test('해가 화면 해상도보다 촘촘하면 규칙을 단정하지 않는다', () => {
  const wide = { xmin: -1e6, xmax: 1e6, ymin: -8e5, ymax: 8e5, width: 1000, height: 770 };
  const ctx = createContext();
  const o = createObject('sin x = 0', ctx, 1, 0);
  o.data = computeObject(o, wide);
  assert.equal(o.data.dense, true);
  assert.equal(analyzeObject(o, wide, ctx).summary, '해가 너무 촘촘함');
});

test('계단함수는 도약에서 선이 끊긴다', () => {
  assert.equal(make('y=floor(x)').data.polylines.length, 14);   // [-6.5, 6.5] 안의 13번 도약
  assert.equal(make('y=sgn(x)').data.polylines.length, 2);
  // 가파르지만 연속인 함수는 끊지 않는다
  assert.equal(make('y=x^3').data.polylines.length, 1);
});

test('합·곱·정적분 기호를 계산한다', () => {
  assert.equal(make('sum(k^2, k, 1, 5)').value, 55);
  assert.equal(make('prod(k, k, 1, 5)').value, 120);
  assert.ok(Math.abs(make('integral(x^2, x, 0, 1)').value - 1 / 3) < 1e-9);
  assert.ok(Math.abs(make('integral(sin x, 0, pi)').value - 2) < 1e-9);
  const taylor = make('y = sum(x^k/fact(k), k, 0, 12)');
  assert.equal(taylor.kind, 'function');
  assert.ok(Math.abs(taylor.fn({ x: 1 }) - Math.E) < 1e-8);
});

test('매개변수 범위를 자동으로 잡고, 지정도 받는다', () => {
  assert.deepEqual(make('r=1+cos(θ)').range, [0, 2 * Math.PI]);      // 닫힌 곡선
  assert.deepEqual(make('r=θ').range, [0, 8 * Math.PI]);             // 주기 없음 → 여러 바퀴
  assert.deepEqual(make('r=θ; 0<=θ<=2π').range, [0, 2 * Math.PI]);   // 명시 지정
  assert.deepEqual(make('(cos t, sin 2t)').range, [0, 2 * Math.PI]);
  assert.deepEqual(make('(t, t^2)').range, [-4 * Math.PI, 4 * Math.PI]);
  assert.deepEqual(make('(t, sin t); -10<=t<=10').range, [-10, 10]);
});

test('이미 정의된 이름을 다시 쓰면 방정식으로 읽는다', () => {
  const ctx = createContext();
  assert.equal(make('g(x,y)=x^2+y^2', ctx).kind, 'defined');
  assert.equal(make('g(x,y)=4', ctx).kind, 'implicit');
  assert.equal(make('g(x,y)=4', ctx).data.polylines.length, 1);
});

test('정해지지 않은 기호는 이유를 밝히고 멈춘다', () => {
  const o = createObject('a x + y = 1', createContext(), 1, 0);
  assert.equal(o.kind, 'error');
  assert.match(o.error, /정해지지 않은 기호/);
});

test('까다로운 음함수도 그린다', () => {
  const hard = {
    'x^3+y^3=3x y': 1, 'max(x,y)=1': 1, 'x^4+y^4=1': 1,
    '(x^2+y^2)^2=4(x^2-y^2)': 2, 'abs(x)+abs(y)=1': 1,
  };
  for (const [src, minLines] of Object.entries(hard)) {
    const o = make(src);
    assert.ok(o.data.polylines.length >= minLines, `${src} → ${o.data.polylines.length}가지`);
    assert.ok(nv(o) > 100, `${src} 의 점 수가 너무 적음`);
  }
});

test('점 수가 폭주하지 않는다', () => {
  for (const src of ['y=e^x', 'y=x^3-3x', '(t^3-3t, t^2)', 'r=θ']) {
    assert.ok(nv(make(src)) < 20000, `${src} → ${nv(make(src))}점`);
  }
});
