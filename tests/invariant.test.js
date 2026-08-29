import test from 'node:test';
import assert from 'node:assert/strict';
import { findInvariant } from '../src/analysis/invariant.js';
import { analyzePointSet } from '../src/analysis/pointset.js';
import { analyzeSequence } from '../src/analysis/sequence.js';
import { createContext, createObject, computeObject, analyzeObject } from '../src/ui/objects.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 900, height: 700 };
const gen = (f, lo, hi) => { const o = []; for (let n = lo; n <= hi; n++) o.push(f(n)); return o; };
const inv = (f) => findInvariant(gen(f, 1, 16), gen(f, 30, 44));

test('점들이 함께 만족하는 관계식을 찾는다', () => {
  assert.equal(inv((n) => [Math.cos(n), Math.sin(n)]).text, 'x^2 + y^2 = 1');
  assert.equal(inv((n) => [n, n * n]).text, 'x^2 - y = 0');
  assert.equal(inv((n) => [n, 2 * n + 1]).text, '2x - y = -1');
  assert.equal(inv((n) => [n, 1 / n]).text, 'xy = 1');
  assert.equal(inv((n) => [2 * Math.cos(n), 3 * Math.sin(n)]).text, '9x^2 + 4y^2 = 36');
  assert.equal(inv((n) => [Math.cos(n) + 3, Math.sin(n) - 2]).text,
    'x^2 + y^2 - 6x + 4y = -12');
});

test('관계가 없으면 만들어 내지 않는다', () => {
  assert.equal(inv((n) => [n, Math.sin(n)]), null);
  assert.equal(inv((n) => [n, Math.pow(2, n)]), null);
  assert.equal(inv((n) => [Math.sin(n * 1.7) * 3, Math.cos(n * 2.3) * 2 + n * 0.1]), null);
});

test('쓰지 않은 점으로 가설을 검증한다', () => {
  const r = inv((n) => [Math.cos(n), Math.sin(n)]);
  assert.equal(r.checked, 15);
  assert.equal(r.passed, 15);
  // 계수를 유리수로 되돌린 뒤 다시 확인한 것만 인정한다
  assert.equal(r.exact, true);
});

test('점이 모자라면 관계를 주장하지 않는다', () => {
  // 이차식은 단항식이 6개다. 점 5개로는 늘 "맞는" 식을 만들 수 있으니 규칙이라 할 수 없다.
  const few = [[0, 0], [1, 1], [2, 4], [3, 9], [4, 16]];
  assert.equal(findInvariant(few, [], { maxDegree: 2 }), null);
  // 넉넉히 주면 찾는다
  const many = [...few, [5, 25], [6, 36], [7, 49], [8, 64]];
  assert.equal(findInvariant(many, [], { maxDegree: 2 }).text, 'x^2 - y = 0');
});

test('점열 분석이 관계식을 가설로 알린다', () => {
  const pts = gen((n) => [Math.cos(n), Math.sin(n)], 1, 14);
  const extra = gen((n) => [Math.cos(n), Math.sin(n)], 30, 44);
  const f = analyzePointSet(pts, { extra }).findings.find((x) => x.type === 'invariant');
  assert.ok(f);
  assert.equal(f.formula, 'x^2 + y^2 = 1');
  assert.equal(f.hypothesis, true);
  assert.deepEqual(f.verified, { checked: 15, passed: 15 });
  assert.match(f.detail, /가설/);
});

test('P(n) = (cos n, sin n) 을 넣으면 단위원 위에 있음을 스스로 찾는다', () => {
  const ctx = createContext();
  const o = createObject('P(n) = (cos n, sin n); n in Z', ctx, 1, 0);
  o.visible = true;
  o.data = computeObject(o, B);
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'invariant');
  assert.ok(f, '관계식을 못 찾음');
  assert.equal(f.formula, 'x^2 + y^2 = 1');
  assert.ok(f.verified.passed > 0);
});

// ── 차분벡터 ───────────────────────────────────────────
test('평행이동으로 얻어지는 점열', () => {
  const f = analyzePointSet(gen((n) => [n + 1, n + 3], 1, 8))
    .findings.find((x) => x.type === 'translation');
  assert.ok(f);
  assert.match(f.formula, /P_n \+ \(1, 1\)/);
});

test('Δ²P 가 일정한 점열', () => {
  const f = analyzePointSet(gen((n) => [n, n * n], 1, 8))
    .findings.find((x) => x.type === 'accel');
  assert.ok(f);
  assert.match(f.detail, /\(0, 2\)/);
});

// ── 수열의 기본 성질 ──────────────────────────────────
const seqFind = (v, type) => analyzeSequence(v).findings.find((f) => f.type === type);

test('증가·감소·일정을 가른다', () => {
  assert.match(seqFind([1, 2, 3, 4, 5], 'mono').title, /증가/);
  assert.match(seqFind([5, 4, 3, 2, 1], 'mono').title, /감소/);
  assert.match(seqFind([2, 2, 2, 2], 'flat').title, /일정/);
  assert.match(seqFind([1, -1, 2, -2, 3], 'osc').title, /오르내림/);
});

test('성장률', () => {
  assert.match(seqFind([3, 6, 12, 24, 48, 96], 'growth').title, /지수적으로 커집니다/);
  assert.match(seqFind([1, 4, 9, 16, 25, 36, 49], 'growth').title, /n\^2/);
});

test('극한 후보는 가속해서 좁히고, 못 좁히면 못 좁혔다고 한다', () => {
  const conv = seqFind([1, 1.5, 5 / 3, 1.75, 1.8, 11 / 6, 13 / 7, 15 / 8], 'limit');
  assert.match(conv.title, /→ 2/);
  assert.equal(conv.hypothesis, true);
  // 발산하는 수열에는 극한을 붙이지 않는다
  assert.equal(seqFind([1, 2, 4, 8, 16, 32], 'limit'), undefined);
});

test('사실과 가설을 나눠 표시한다', () => {
  const r = analyzeSequence([1, 4, 9, 16, 25]);
  const facts = r.findings.filter((f) => f.basic);
  const guesses = r.findings.filter((f) => f.hypothesis && !f.basic);
  assert.ok(facts.length && guesses.length);
  assert.ok(facts.every((f) => !f.hypothesis));
  // 규칙 후보가 사실보다 앞에 온다
  assert.equal(r.findings[0].hypothesis, true);
});
