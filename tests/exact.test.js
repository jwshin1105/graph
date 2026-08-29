import test from 'node:test';
import assert from 'node:assert/strict';
import { Rat, ratFromNumber } from '../src/math/rational.js';
import { Poly, toPoly } from '../src/math/poly.js';
import {
  classifyConicExact, conicCoeffs, conicEquation, conicTransitions,
  familyTransitions, polyRootsExact, exactSqrt, singularTransitions,
} from '../src/analysis/exact.js';
import { parse } from '../src/math/parser.js';

const P = (src, vars = ['x', 'y']) => toPoly(parse(src), vars);
const kindOf = (src) => classifyConicExact(P(src)).kind;

// ── 유리수 ─────────────────────────────────────────────
test('유리수 산술', () => {
  assert.equal(Rat.of(1, 3).add(Rat.of(1, 6)).toString(), '1/2');
  assert.equal(Rat.of(2, 4).toString(), '1/2');            // 약분해서 담는다
  assert.equal(Rat.of(-3, -6).toString(), '1/2');
  assert.equal(Rat.of(3, 4).pow(2).toString(), '9/16');
  assert.equal(Rat.of(1, 3).cmp(Rat.of(1, 2)), -1);
  assert.throws(() => Rat.of(1).div(Rat.ZERO));
});

test('소수 표기는 유리수로 되살리고, 무리수는 거절한다', () => {
  assert.equal(ratFromNumber(0.85).toString(), '17/20');
  assert.equal(ratFromNumber(-1.4).toString(), '-7/5');
  assert.equal(ratFromNumber(0.125).toString(), '1/8');
  assert.equal(ratFromNumber(3).toString(), '3');
  // π 를 245850922/78256779 라고 우기면 안 된다
  assert.equal(ratFromNumber(Math.PI), null);
  assert.equal(ratFromNumber(Math.SQRT2), null);
  assert.equal(ratFromNumber(NaN), null);
});

// ── 다항식 ─────────────────────────────────────────────
test('다항식 산술과 차수', () => {
  const p = P('(x + y)^2');
  assert.equal(p.coeff([2, 0]).toString(), '1');
  assert.equal(p.coeff([1, 1]).toString(), '2');
  assert.equal(p.degree, 2);
  assert.equal(P('x^3 y - x').degreeIn('x'), 3);
  assert.equal(P('x/2 + y/3').coeff([1, 0]).toString(), '1/2');
  assert.equal(P('x^2 - x^2').isZero, true);
});

test('다항식이 아닌 식은 받지 않는다', () => {
  assert.equal(P('sin x'), null);
  assert.equal(P('1/x'), null);
  assert.equal(P('x^(1/2)'), null);
  assert.equal(P('pi x'), null);          // π 는 유리수가 아니다
});

test('편미분과 대입', () => {
  const p = P('x^2 y + 3x');
  assert.equal(p.derivative('x').toString(), '2·x·y + 3');
  assert.equal(p.substitute({ y: Rat.of(2) }).toString(), '2·x^2 + 3·x');
  assert.equal(p.evaluate({ x: 2, y: 3 }), 18);
});

// ── 이차곡선의 정확한 분류 ──────────────────────────────
test('이차곡선의 종류를 정확히 가른다', () => {
  assert.equal(kindOf('x^2 + y^2 = 1'), '원');
  assert.equal(kindOf('x^2 + 2y^2 = 1'), '타원');
  assert.equal(kindOf('x^2 - y^2 = 1'), '쌍곡선');
  assert.equal(kindOf('y = x^2'), '포물선');
  assert.equal(kindOf('x y = 1'), '쌍곡선');
  assert.equal(kindOf('x^2 - y^2 = 0'), '두 직선(교차)');
  assert.equal(kindOf('x^2 = 1'), '두 평행선');
  assert.equal(kindOf('x^2 = 0'), '겹친 직선');
  assert.equal(kindOf('x^2 + y^2 = 0'), '한 점');
  assert.equal(kindOf('x^2 + y^2 = -1'), '해 없음');
  assert.equal(kindOf('2x + 3y = 1'), '직선');
});

test('허용오차가 아니라 정확히 0 인지로 가른다', () => {
  // 조금이라도 어긋난 것은 원이 아니라 타원이다
  assert.equal(kindOf('x^2 + y^2 = 1'), '원');
  assert.equal(kindOf('x^2 + 1.0001 y^2 = 1'), '타원');
  // 판별식이 정확히 0 이면 포물선, 부호가 갈리면 타원·쌍곡선
  assert.equal(kindOf('y = x^2'), '포물선');
  assert.equal(kindOf('y = x^2 - 0.0001 y^2'), '쌍곡선');
  assert.equal(kindOf('y = x^2 + 0.0001 y^2'), '타원');
});

test('분모가 너무 큰 소수는 유리수로 보지 않고 손을 뗀다', () => {
  // 1e-12 자리까지 적힌 값은 무리수와 구별할 수 없다 — 억지로 판정하지 않는다
  assert.equal(toPoly(parse('x^2 + 1.000000000001 y^2 = 1'), ['x', 'y']), null);
});

test('중심과 반지름 제곱도 정확히', () => {
  const c = classifyConicExact(P('x^2 + y^2 - 2x - 4y = 4'));
  assert.equal(c.kind, '원');
  assert.deepEqual(c.center.map((r) => r.toString()), ['1', '2']);
  assert.equal(c.radiusSq.toString(), '9');
});

test('이차곡선 식은 정수 계수로 정리해서 보여준다', () => {
  assert.equal(conicEquation(P('x^2/2 + y^2/2 = 1')), 'x² + y² - 2 = 0');
  assert.equal(conicEquation(P('-x^2 - y^2 = -4')), 'x² + y² - 4 = 0');
});

test('이차곡선 계수 뽑기', () => {
  const k = conicCoeffs(P('3x^2 + 4x y + 5y^2 + 6x + 7y + 8 = 0'));
  assert.deepEqual([k.A, k.B, k.C, k.D, k.E, k.F].map((r) => r.toString()),
    ['3', '4', '5', '6', '7', '8']);
});

// ── 정확한 근 ──────────────────────────────────────────
const roots = (src, v = 'x') => polyRootsExact(P(src, [v]).toUnivariate(v, {}));

test('유리근은 분수 그대로', () => {
  assert.deepEqual(roots('2x^2 - 3x + 1 = 0').map((r) => r.text), ['1/2', '1']);
  assert.deepEqual(roots('x^3 - 6x^2 + 11x - 6 = 0').map((r) => r.text), ['1', '2', '3']);
  assert.deepEqual(roots('x^2 = 0').map((r) => r.text), ['0']);
});

test('무리근은 근호 꼴로', () => {
  assert.deepEqual(roots('x^2 - 2 = 0').map((r) => r.text), ['-√2', '√2']);
  assert.deepEqual(roots('x^2 - x - 1 = 0').map((r) => r.text), ['(1 - √5)/2', '(1 + √5)/2']);
  // (-2√2)/2 처럼 약분되지 않은 꼴이 남으면 안 된다
  assert.deepEqual(roots('2x^2 - 4 = 0').map((r) => r.text), ['-√2', '√2']);
});

test('실근이 없으면 빈 목록', () => {
  assert.deepEqual(roots('x^2 + 1 = 0'), []);
});

test('완전제곱근', () => {
  assert.equal(exactSqrt(Rat.of(9, 4)).toString(), '3/2');
  assert.equal(exactSqrt(Rat.of(2)), null);
});

// ── 파라미터가 든 이차곡선 ──────────────────────────────
const at = (list) => list.map((e) => e.text);

test('이차곡선의 분기점을 풀어서 구한다', () => {
  const t = conicTransitions(P('x^2 + a y^2 = 1', ['x', 'y', 'a']), 'a');
  assert.deepEqual(at(t), ['0', '1']);
  assert.match(t[0].reason, /판별식 B²−4AC = 0/);
  assert.match(t[1].reason, /원이 되는 조건/);
});

test('원이 생겨나는 자리', () => {
  const t = conicTransitions(P('x^2 + y^2 = a', ['x', 'y', 'a']), 'a');
  assert.deepEqual(at(t), ['0']);
  assert.match(t[0].reason, /퇴화/);
});

test('같은 값에서 나온 근거는 하나로 묶는다', () => {
  const t = conicTransitions(P('a x^2 + a y^2 = 1', ['x', 'y', 'a']), 'a');
  assert.deepEqual(at(t), ['0']);
  assert.equal(t[0].reason.split(', ').length, new Set(t[0].reason.split(', ')).size);
});

test('파라미터가 없거나 3차 이상이면 손대지 않는다', () => {
  assert.equal(conicTransitions(P('x^2 + y^2 = 1'), 'a'), null);
  assert.equal(conicTransitions(P('x^3 + a y = 1', ['x', 'y', 'a']), 'a'), null);
});

// ── 파라미터가 든 다항함수 ──────────────────────────────
const fam = (src, v = 'x') => familyTransitions(toPoly(parse(src), [v, 'a']), 'a', v);

test('실근·극값 개수가 바뀌는 자리를 종결식으로 구한다', () => {
  assert.deepEqual(at(fam('x^3 - 3x + a')), ['-2', '2']);
  assert.deepEqual(at(fam('x^3 + a x')), ['0']);
  assert.deepEqual(at(fam('x^4 + a x^2')), ['0']);
  assert.deepEqual(at(fam('x^2 + a')), ['0']);
});

test('최고차항이 사라지는 자리도 분기점이다', () => {
  const t = fam('a x^2 + x + 1');
  assert.deepEqual(at(t), ['0', '1/4']);
  assert.match(t[0].reason, /최고차항/);
  assert.match(t[1].reason, /중근/);
});

test('다항식이 아니거나 파라미터가 없으면 손대지 않는다', () => {
  assert.equal(fam('x^2 + 1'), null);
  assert.equal(familyTransitions(toPoly(parse('x^2'), ['x']), 'a', 'x'), null);
});

test('Poly 는 변수 순서를 지킨다', () => {
  const p = Poly.variable(['x', 'y'], 'y');
  assert.equal(p.coeff([0, 1]).toString(), '1');
  assert.throws(() => Poly.variable(['x'], 'z'));
});

// ── 곡선족이 특이해지는 자리 ────────────────────────────
const sing = (src) => singularTransitions(P(src, ['x', 'y', 'a']), 'a');

test('가지가 갈라지는 자리 — f = f_x = f_y = 0 을 종결식으로 푼다', () => {
  assert.deepEqual(at(sing('y^2 = x^3 - a x')), ['0']);
  assert.deepEqual(at(sing('y^2 = x^3 + a')), ['0']);
  assert.deepEqual(at(sing('y^2 = (x-a)(x^2-1)')), ['-1', '1']);
  assert.match(sing('y^2 = x^3 - a x')[0].reason, /특이해지는/);
});

test('늘 특이한 곡선은 특이점의 종류가 바뀌는 자리를 찾는다', () => {
  // y² = x²(x−a) 의 원점은 늘 특이점 — a 의 부호에 따라 매듭점 ↔ 고립점
  const r = sing('y^2 = x^2 (x - a)');
  assert.deepEqual(at(r), ['0']);
  assert.match(r[0].reason, /헤세 행렬식/);
  // 데카르트의 잎도 원점이 늘 특이점이다
  assert.deepEqual(at(sing('x^3 + y^3 = a x y')), ['0']);
});

test('파라미터가 없거나 차수가 너무 높으면 손대지 않는다', () => {
  assert.equal(singularTransitions(P('y^2 = x^3 - x', ['x', 'y', 'a']), 'a'), null);
  assert.equal(sing('y^6 = x^6 + a'), null);
});
