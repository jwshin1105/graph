import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createObject, computeObject } from '../src/ui/objects.js';
import { analyzeSequence } from '../src/analysis/sequence.js';
import { analyzePointSet } from '../src/analysis/pointset.js';
import { analyzeFunction } from '../src/analysis/functionAnalysis.js';
import { fitConic } from '../src/analysis/conic.js';
import { sampleFunction } from '../src/engine/sampler.js';

const top = (r) => r.findings[0];
const titles = (r) => r.findings.map((f) => f.title);

test('상수 정의를 다른 식에서 쓸 수 있다', () => {
  const ctx = createContext();
  createObject('a = 2', ctx, 1, 0);
  const o = createObject('y = a x^2', ctx, 2, 1);
  assert.equal(o.fn({ x: 3 }), 18);
  ctx.defs.set('a', { params: [], body: { type: 'num', value: 5 }, compiled: null });
  assert.equal(o.fn({ x: 3 }), 45);            // 정의를 바꾸면 바로 반영된다
});

test('수열은 깊은 항에서도 스택이 넘치지 않는다', () => {
  const ctx = createContext();
  const o = createObject('a_1=1; a_n=a_{n-1}+1', ctx, 1, 0);
  assert.equal(o.seq.get(50000), 50000);
});

test('서로를 부르는 정의는 크래시 대신 NaN', () => {
  const ctx = createContext();
  createObject('f(x)=g(x)+1', ctx, 1, 0);
  createObject('g(x)=f(x)+1', ctx, 2, 1);
  const use = createObject('y=f(x)', ctx, 3, 2);
  assert.ok(Number.isNaN(use.fn({ x: 1 })));
});

test('아주 작은 수열을 상수로 오판하지 않는다', () => {
  const r = analyzeSequence([1e-15, 2e-15, 3e-15, 4e-15]);
  assert.equal(top(r).type, 'arithmetic');
});

test('항이 둘뿐이면 규칙을 단정하지 않는다', () => {
  const r = analyzeSequence([1, 2]);
  assert.equal(top(r).type, 'ambiguous');
  assert.ok(top(r).confidence <= 0.5);
  // 항이 늘어나면 확신도가 올라간다
  assert.ok(analyzeSequence([1, 2, 4]).findings[0].confidence
    < analyzeSequence([1, 2, 4, 8, 16, 32]).findings[0].confidence);
});

test('정확한 규칙은 근사 모형보다 항상 앞선다', () => {
  for (const v of [[0, 1, 2, 3], [0, 1, 4, 9, 16], [1e-15, 2e-15, 3e-15, 4e-15]]) {
    assert.equal(top(analyzeSequence(v)).exact, true);
  }
  // 규칙이 없으면 근사 모형은 낮은 확신도로만
  const approx = analyzeSequence([1, 2, 3.0001, 4, 5]).findings[0];
  assert.equal(approx.exact, false);
  assert.ok(approx.confidence <= 0.6);
});

test('값이 빠진 수열은 이어지는 구간만 보고 그렇다고 밝힌다', () => {
  const r = analyzeSequence([1, NaN, 3, 4, 5]);
  assert.equal(r.n0, 3);
  assert.match(r.note, /빼고/);
});

test('같은 점이 겹쳐 있으면 가짜 직선을 만들지 않는다', () => {
  const r = analyzePointSet([[1, 1], [1, 1], [1, 1]]);
  assert.ok(titles(r).some((t) => t.includes('겹쳐')));
  assert.ok(!titles(r).some((t) => t.includes('직선')));
  assert.equal(analyzePointSet([[0, 0], [1, 1]]).findings.length, 0);   // 두 점은 구조를 말하지 않는다
});

test('상수·직선 함수에 가짜 극값·변곡점을 붙이지 않는다', () => {
  const c = analyzeFunction(() => 3, { xmin: -6, xmax: 6 });
  assert.deepEqual(titles(c), ['상수함수']);
  const l = analyzeFunction((x) => 2 * x, { xmin: -6, xmax: 6 });
  assert.equal(l.inflex.length, 0);
  assert.ok(titles(l).includes('일차함수 (직선)'));
  const abs = analyzeFunction(Math.abs, { xmin: -6, xmax: 6 });
  assert.equal(abs.inflex.length, 0);
  assert.equal(abs.minima.length, 1);
});

test('해가 구간을 이루면 점열이라고 우기지 않는다', () => {
  const r = analyzeFunction(Math.floor, { xmin: -6.5, xmax: 6.5 });
  assert.ok(titles(r).includes('해가 구간을 이룹니다'));
  assert.equal(r.inflex.length, 0);
  const zero = analyzeFunction(() => 0, { xmin: -6, xmax: 6 });
  assert.ok(titles(zero).includes('모든 점이 해'));
});

test('진짜 극값·변곡점은 그대로 찾는다', () => {
  const r = analyzeFunction((x) => x ** 3 - 3 * x, { xmin: -6.5, xmax: 6.5 });
  assert.equal(r.maxima.length, 1);
  assert.equal(r.minima.length, 1);
  assert.equal(r.inflex.length, 1);
  const q = analyzeFunction((x) => x ** 4 - 2 * x * x, { xmin: -6.5, xmax: 6.5 });
  assert.equal(q.inflex.length, 2);
});

test('없앨 수 있는 구멍은 메우고 진짜 극점은 끊는다', () => {
  const opt = { ymin: -5, ymax: 5 };
  // sin x / x 는 x = 0 에서만 값이 없고 양옆이 이어지므로 한 줄로 그린다
  assert.equal(sampleFunction((x) => Math.sin(x) / x, -6.5, 6.5, opt).polylines.length, 1);
  assert.equal(sampleFunction((x) => (x * x - 1) / (x - 1), -6.5, 6.5, opt).polylines.length, 1);
  // 극점과 계단은 그대로 끊는다
  assert.equal(sampleFunction((x) => 1 / x, -6.5, 6.5, opt).polylines.length, 2);
  assert.ok(sampleFunction(Math.tan, -6.5, 6.5, opt).polylines.length >= 4);
  assert.equal(sampleFunction(Math.floor, -6.5, 6.5, opt).polylines.length, 14);
});

test('좌표가 커도 매끄러운 직선을 끊지 않는다', () => {
  const r = sampleFunction((x) => x, 1e15, 1e15 + 10, { ymin: 1e15, ymax: 1e15 + 10 });
  assert.equal(r.polylines.length, 1);
});

test('원뿔곡선 판별이 표본 오차에 흔들리지 않는다', () => {
  const ctx = createContext();
  const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
  const o = createObject('x^2+y^2=4', ctx, 1, 0);
  const d = computeObject(o, B);
  const sample = [];
  for (const line of d.polylines) {
    const stride = Math.max(2, Math.floor(line.length / 40) * 2);
    for (let i = 0; i < line.length; i += stride) sample.push([line[i], line[i + 1]]);
  }
  assert.equal(fitConic(sample).kind, '원');
});

test('부등식 영역의 성질을 읽는다', async () => {
  const { analyzeObject } = await import('../src/ui/objects.js');
  const ctx = createContext();
  const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
  const mk = (src) => {
    const o = createObject(src, ctx, 1, 0);
    o.data = computeObject(o, B);
    return analyzeObject(o, B, ctx).findings.map((f) => f.title);
  };
  assert.ok(mk('x^2+y^2<4').includes('유계 영역'));
  assert.ok(mk('x^2+y^2<4').includes('경계선은 원'));
  assert.ok(mk('y<x^2').includes('화면 밖으로 이어지는 영역'));
  assert.ok(mk('x^2+y^2<-1').includes('해가 없는 부등식'));
});

test('알아채기 어려운 상황은 말로 알려 준다', () => {
  const ctx = createContext();
  createObject('f(x)=x^2', ctx, 1, 0);
  assert.match(createObject('f(x)=x^3', ctx, 2, 1).note, /이미 정의/);
  assert.match(createObject('a_n = a_{n-1}+1', ctx, 3, 2).note, /초기값/);
});
