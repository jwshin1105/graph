import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, format } from '../src/math/parser.js';
import {
  createContext, createObject, computeObject, analyzeObject, collectDomains, isDiscreteSet,
} from '../src/ui/objects.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 900, height: 700 };
const mk = (src, ctx = createContext()) => {
  const o = createObject(src, ctx, 1, 0);
  if (!o.error) o.data = computeObject(o, B);
  return o;
};

test('n ∈ Z 를 읽는다 — in 이라고 적어도 같다', () => {
  const known = new Set(['Z', 'N', 'n']);
  assert.equal(format(parse('n ∈ Z', known)), 'n ∈ Z');
  assert.equal(format(parse('n in Z', known)), 'n ∈ Z');
  const m = new Map();
  assert.equal(collectDomains(parse('x in Z and y in Z', known), m), true);
  assert.deepEqual([...m], [['x', 'Z'], ['y', 'Z']]);
  assert.equal(collectDomains(parse('x + 1', known), new Map()), false);
});

test("'in' 을 넣어도 sin·min 은 그대로다", () => {
  assert.equal(format(parse('sin(x)')), 'sin(x)');
  assert.equal(format(parse('min(1, 2)')), 'min(1, 2)');
});

test('이산 점열은 잇지 않는다', () => {
  const o = mk('P(n) = (n, sin n); n in Z');
  assert.equal(o.kind, 'pointseq');
  assert.equal(o.discrete, true);
  assert.equal(o.data.polylines.length, 0, '점을 곡선으로 이었다');
  assert.ok(o.data.points.length >= 10);
  // 모든 점의 x 가 정수다
  for (const [x] of o.data.points) assert.equal(x, Math.round(x));
});

test('connect 라고 밝히면 잇는다', () => {
  const o = mk('P(n) = (n, sin n); n in Z; connect');
  assert.equal(o.connect, true);
  assert.equal(o.data.polylines.length, 1);
});

test('P_n = (…) 과 P(n) = (…) 은 같은 대상이다', () => {
  const a = mk('P_n = (n, n^2); 1 <= n <= 5');
  const b = mk('P(n) = (n, n^2); 1 <= n <= 5');
  assert.equal(a.kind, b.kind);
  assert.deepEqual(a.data.points, b.data.points);
});

test('화면 범위에 따라 필요한 항만 계산한다', () => {
  const o = mk('P(n) = (n, n/2); n in Z');
  const near = computeObject(o, B).points.length;
  const wide = computeObject(o, { ...B, xmin: -60, xmax: 60 }).points.length;
  assert.ok(wide > near * 3, `${near} → ${wide}`);
  // 화면을 옮기면 그 자리의 항이 나온다
  const moved = computeObject(o, { ...B, xmin: 100, xmax: 110 }).points;
  assert.ok(moved.length >= 10 && moved[0][0] >= 100, JSON.stringify(moved.slice(0, 3)));
});

test('이산 정의역이 걸린 함수는 곡선이 아니라 점이다', () => {
  const o = mk('y = sin x; x in Z');
  assert.equal(o.data.polylines.length, 0);
  assert.ok(o.data.points.length >= 10);
  const ctx = createContext();
  const o2 = mk('y = sin x; x in Z', ctx);
  assert.match(analyzeObject(o2, B, ctx).title, /이산 점열/);
});

test('정수해를 찾는다', () => {
  const o = mk('x^2 + y^2 = 25; x in Z; y in Z');
  assert.equal(o.data.polylines.length, 0);
  assert.equal(o.data.points.length, 12);        // (±5,0),(0,±5),(±3,±4),(±4,±3)
  for (const [x, y] of o.data.points) {
    assert.equal(x * x + y * y, 25, `(${x}, ${y})`);
  }
});

test('자연수 정의역은 1 부터', () => {
  const o = mk('P(n) = (n, n); n in N');
  assert.ok(o.data.points.every(([x]) => x >= 1), JSON.stringify(o.data.points.slice(0, 3)));
});

test('(cos n, sin n) 이 단위원 위에 있음을 찾아낸다', () => {
  const ctx = createContext();
  const o = mk('P(n) = (cos n, sin n); n in Z', ctx);
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'conic');
  assert.ok(f, '원 위에 있다는 것을 못 찾음');
  assert.match(f.title, /원/);
  assert.match(f.detail, /반지름 1/);
});

test('정의역 종류', () => {
  assert.equal(isDiscreteSet('Z'), true);
  assert.equal(isDiscreteSet('N'), true);
  assert.equal(isDiscreteSet('R'), false);
  assert.equal(isDiscreteSet('Q'), false);
});
