import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSequence, findLinearRecurrence, polynomialFromDifferences } from '../src/analysis/sequence.js';
import { analyzePointSet } from '../src/analysis/pointset.js';
import { analyzeFunction } from '../src/analysis/functionAnalysis.js';
import { fitConic } from '../src/analysis/conic.js';
import { fitModels } from '../src/analysis/fitting.js';

const top = (r) => r.findings[0];
const has = (r, t) => r.findings.some((f) => f.title.includes(t));
const formulaOf = (r, t) => r.findings.find((f) => f.title.includes(t))?.formula;

test('등차수열의 일반항', () => {
  const r = analyzeSequence([3, 7, 11, 15, 19, 23]);
  assert.equal(top(r).type, 'arithmetic');
  assert.equal(top(r).formula, 'a_n = 4n - 1');
  assert.deepEqual(top(r).next, [27, 31, 35]);
});

test('등비수열의 일반항과 무한합', () => {
  const r = analyzeSequence([2, 6, 18, 54, 162]);
  assert.equal(top(r).type, 'geometric');
  assert.deepEqual(top(r).next, [486, 1458, 4374]);
});

test('계차로 다항식 일반항 복원', () => {
  const r = analyzeSequence([1, 3, 6, 10, 15, 21, 28]);
  assert.equal(top(r).type, 'polynomial');
  assert.equal(top(r).formula, 'a_n = 1/2·n² + 1/2·n');
  assert.ok(has(r, '삼각수'));
});

test('피보나치: 점화식과 비네 공식', () => {
  const r = analyzeSequence([1, 1, 2, 3, 5, 8, 13, 21, 34]);
  assert.equal(top(r).type, 'recurrence');
  assert.match(top(r).detail, /a_\{n−1\} \+ a_\{n−2\}/);
  assert.match(top(r).formula, /φⁿ/);
  assert.deepEqual(top(r).next, [55, 89, 144]);
  assert.ok(has(r, '피보나치'));
});

test('하노이탑: aₙ₊₁ = 2aₙ + 1 → 2ⁿ − 1', () => {
  const r = analyzeSequence([1, 3, 7, 15, 31, 63, 127]);
  assert.equal(top(r).type, 'affine');
  assert.equal(top(r).formula, 'a_n = 2·2ⁿ⁻¹ - 1');
  assert.ok(has(r, '메르센'));
});

test('주기수열', () => {
  const r = analyzeSequence([1, 2, 3, 1, 2, 3, 1, 2, 3]);
  assert.equal(top(r).type, 'periodic');
  assert.deepEqual(top(r).next, [1, 2, 3]);
});

test('소수 수열은 사전에서 찾는다', () => {
  const r = analyzeSequence([2, 3, 5, 7, 11, 13, 17, 19, 23]);
  assert.ok(has(r, '소수'));
});

test('규칙 없는 수열은 억지로 규칙을 만들지 않는다', () => {
  const r = analyzeSequence([3, 1, 4, 1, 5, 9, 2, 6]);
  assert.equal(r.findings.length, 0);
});

test('점화식 계수와 다항식 복원 유틸', () => {
  assert.deepEqual(findLinearRecurrence([1, 1, 2, 3, 5, 8, 13, 21]), { order: 2, coef: [1, 1] });
  assert.deepEqual(polynomialFromDifferences([1, 4, 9, 16, 25], 1, 2).map(Math.round), [0, 0, 1]);
});

test('점열: 등간격 x 위의 y 는 수열로 분석된다', () => {
  const r = analyzePointSet([[1, 3], [2, 5], [3, 7], [4, 9], [5, 11]]);
  assert.ok(has(r, 'x 좌표가 등간격'));
  assert.equal(formulaOf(r, '등차수열'), 'y_n = 2n + 1');
  assert.ok(has(r, '한 직선 위에 있음'));
});

test('점열: 원 위의 정다각형 배치', () => {
  const pts = [...Array(8)].map((_, i) => [Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)]);
  const r = analyzePointSet(pts);
  assert.ok(has(r, '정8각형'));
  assert.equal(formulaOf(r, '이차곡선'), 'x² + y² - 1 = 0');
});

test('점열: 로그나선', () => {
  const pts = [...Array(7)].map((_, i) => [1.3 ** i * Math.cos(i * 0.5), 1.3 ** i * Math.sin(i * 0.5)]);
  assert.ok(has(analyzePointSet(pts), '로그나선'));
});

test('점열: 격자 구조', () => {
  const r = analyzePointSet([[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1]]);
  assert.ok(has(r, '격자'));
});

test('원뿔곡선 판별', () => {
  const circle = [...Array(9)].map((_, i) => [3 * Math.cos(i * 0.7), 3 * Math.sin(i * 0.7)]);
  assert.equal(fitConic(circle).kind, '원');
  const ell = [...Array(9)].map((_, i) => [3 * Math.cos(i * 0.7), 2 * Math.sin(i * 0.7)]);
  assert.equal(fitConic(ell).kind, '타원');
  const hyp = [...Array(9)].map((_, i) => [Math.cosh(i * 0.3 - 1), Math.sinh(i * 0.3 - 1)]);
  assert.equal(fitConic(hyp).kind, '쌍곡선');
  const par = [...Array(9)].map((_, i) => [i - 4, (i - 4) ** 2]);
  assert.equal(fitConic(par).kind, '포물선');
  const two = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [3, 1], [3, 0]];
  assert.equal(fitConic(two).degenerate, true);
});

test('함수 분석: sin x', () => {
  const r = analyzeFunction(Math.sin, { xmin: -10, xmax: 10 });
  assert.ok(has(r, '기함수'));
  assert.ok(has(r, '주기함수 (주기 2π)'));
  assert.equal(r.roots.length, 7);
  assert.ok(has(r, '근이 이루는 규칙: 등차수열'));
});

test('함수 분석: 점근선', () => {
  const r = analyzeFunction((x) => (x * x + 1) / x, { xmin: -10, xmax: 10 });
  assert.ok(r.findings.some((f) => f.type === 'vasym' && f.detail.includes('x = 0')));
  assert.ok(r.findings.some((f) => f.type === 'oasym' && f.detail === 'y = x'));
  const t = analyzeFunction(Math.tan, { xmin: -10, xmax: 10 });
  assert.ok(t.findings.some((f) => f.type === 'vasym' && f.detail.includes('π/2')));
  // 진동하는 함수에 가짜 수평 점근선을 붙이지 않는다
  assert.ok(!analyzeFunction(Math.sin, { xmin: -10, xmax: 10 }).findings.some((f) => f.type === 'hasym'));
});

test('함수 분석: 극값과 변곡점', () => {
  const r = analyzeFunction((x) => x ** 3 - 3 * x, { xmin: -5, xmax: 5 });
  assert.equal(r.maxima.length, 1);
  assert.equal(r.minima.length, 1);
  assert.ok(Math.abs(r.maxima[0][0] + 1) < 1e-3);
  assert.equal(r.inflex.length, 1);
});

test('모델 적합은 올바른 함수족을 고른다', () => {
  const xs = [...Array(12)].map((_, i) => i + 1);
  assert.equal(fitModels(xs, xs.map((x) => 2 * x + 1))[0].name, '일차(선형)');
  assert.equal(fitModels(xs, xs.map((x) => 3 * 2 ** x))[0].name, '지수');
  assert.equal(fitModels(xs, xs.map(Math.sin))[0].name, '삼각(주기)');
  assert.equal(fitModels(xs, xs.map((x) => 2 * Math.log(x) + 1))[0].name, '로그');
});
