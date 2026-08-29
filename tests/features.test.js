import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createObject, computeObject, analyzeObject, intersectionsOf } from '../src/ui/objects.js';
import { analyzeSequence } from '../src/analysis/sequence.js';
import { analyzePointSet } from '../src/analysis/pointset.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
const P = Math.PI;

test("f'(x) 는 도함수를 그린다", () => {
  const ctx = createContext();
  createObject('f(x)=x^3-3x', ctx, 1, 0);
  assert.ok(Math.abs(createObject("y=f'(x)", ctx, 2, 1).fn({ x: 2 }) - 9) < 1e-6);
  assert.ok(Math.abs(createObject("y=f''(x)", ctx, 3, 2).fn({ x: 2 }) - 12) < 1e-3);
  assert.equal(createObject('y=f(x)', ctx, 4, 3).fn({ x: 2 }), 2);
});

test('점열 수열 P_n = (n, f(n))', () => {
  const ctx = createContext();
  const o = createObject('P_n = (n, 2^n); 1<=n<=8', ctx, 1, 0);
  assert.equal(o.kind, 'pointseq');
  const d = computeObject(o, B);
  assert.equal(d.points.length, 8);
  assert.deepEqual(d.points[0], [1, 2]);
  assert.deepEqual(d.points[7], [8, 256]);
  const a = analyzeObject(o, B, ctx);
  assert.ok(a.findings.some((f) => f.title.includes('등비수열')));
});

test('점열 수열로 만든 정다각형을 읽어낸다', () => {
  const ctx = createContext();
  const o = createObject('Q_k = (cos(2πk/7), sin(2πk/7)); 0<=k<=6', ctx, 1, 0);
  o.data = computeObject(o, B);
  const titles = analyzeObject(o, B, ctx).findings.map((f) => f.title);
  assert.ok(titles.some((t) => t.includes('정7각형')));
  assert.ok(titles.some((t) => t.includes('원')));
});

test('상수 정의에 슬라이더 범위가 붙는다', () => {
  const ctx = createContext();
  assert.deepEqual(createObject('a = 2', ctx, 1, 0).slider, { min: 0, max: 5, step: 0.05 });
  assert.equal(createObject('b = 0.5; 0<=b<=1', ctx, 2, 1).slider.max, 1);
  assert.equal(createObject('d = -3', ctx, 3, 2).slider.min, -5);
});

test('상수 이름을 변수로 쓰면 막는다', () => {
  const ctx = createContext();
  assert.match(createObject('e = 0.5', ctx, 1, 0).error, /상수/);
  assert.match(createObject('pi = 3', ctx, 2, 1).error, /상수/);
  assert.equal(createObject('a = 2', ctx, 3, 2).kind, 'constant');
});

test('곡선끼리의 교점을 쌍별로 모은다', () => {
  const ctx = createContext();
  const objs = ['y = sin x', 'y = 0.5', 'y = x/4'].map((s) => {
    const o = createObject(s, ctx, 1, 0);
    o.visible = true;
    o.data = computeObject(o, B);
    return o;
  });
  const hits = intersectionsOf(objs, B);
  assert.equal(hits.groups.length, 3);
  const sinHalf = hits.groups.find((g) => g.labels.join().includes('0.5') && g.labels.join().includes('sin'));
  assert.equal(sinHalf.points.length, 4);      // [-6.5, 6.5] 안의 해
  for (const [x, y] of sinHalf.points) {
    assert.ok(Math.abs(Math.sin(x) - 0.5) < 1e-9 && Math.abs(y - 0.5) < 1e-9);
  }
});

test('갈래 등차수열 — 삼각방정식 해의 표준형', () => {
  const r = analyzeSequence([-11 * P / 6, -7 * P / 6, P / 6, 5 * P / 6, 13 * P / 6, 17 * P / 6]);
  assert.equal(r.findings[0].type, 'interleaved');
  assert.equal(r.findings[0].formula, 'a = π/6 + 2π·k   또는   a = 5π/6 + 2π·k   (k = 0, 1, 2, …)');
  // 한 갈래로 충분한 경우에는 갈래로 쪼개지 않는다
  assert.equal(analyzeSequence([1, 3, 5, 7, 9, 11]).findings[0].type, 'arithmetic');
  assert.deepEqual(analyzeSequence([3, 1, 4, 1, 5, 9, 2, 6]).findings.filter((f) => !f.basic), []);
});

test('교점 점열에서 x 좌표의 규칙을 읽는다', () => {
  const pts = [-11 * P / 6, -7 * P / 6, P / 6, 5 * P / 6, 13 * P / 6].map((x) => [x, 0.5]);
  const titles = analyzePointSet(pts).findings.map((f) => f.title);
  assert.ok(titles.some((t) => t.includes('x 좌표의 규칙: 2갈래 등차수열')));
  // y 가 상수면 "y 와 x 의 관계" 같은 군더더기를 붙이지 않는다
  assert.ok(!titles.some((t) => t.includes('y 와 x 의 관계')));
});
