import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, format, freeVars } from '../src/math/parser.js';
import { compile, residual, makeContext } from '../src/math/evaluator.js';
import { derivative } from '../src/math/derivative.js';
import * as N from '../src/math/numeric.js';

const ctx = () => makeContext();
const ev = (src, env = {}) => compile(parse(src), ctx())(env);

test('암묵적 곱과 연산자 우선순위', () => {
  assert.equal(ev('2x^2', { x: 3 }), 18);
  assert.equal(ev('2+3*4'), 14);
  assert.equal(ev('(x-1)(x+1)', { x: 4 }), 15);
  assert.equal(ev('2^-2'), 0.25);
  assert.equal(ev('-x^2', { x: 3 }), -9);
});

test('함수 호출과 절댓값', () => {
  assert.equal(ev('sin(0)'), 0);
  assert.equal(ev('|x|+|y|', { x: -3, y: -4 }), 7);
  assert.equal(ev('sin x cos x', { x: 0 }), 0);
  assert.equal(ev('3!'), 6);
});

test('음수의 세제곱근을 실수로 확장', () => {
  assert.equal(ev('(-8)^(1/3)'), -2);
});

test('자유변수 추출', () => {
  assert.deepEqual([...freeVars(parse('x^2+y^2=1'))].sort(), ['x', 'y']);
  assert.deepEqual([...freeVars(parse('sin(t)'))], ['t']);
});

test('등식은 잔차 함수로 변환된다', () => {
  const f = residual(parse('x^2+y^2=4'), ctx());
  assert.equal(f({ x: 2, y: 0 }), 0);
  assert.equal(f({ x: 0, y: 0 }), -4);
});

test('논리 결합 파싱', () => {
  assert.equal(format(parse('x^2+y^2=1 and y=x')), 'x^2 + y^2 = 1 ∧ y = x');
  assert.equal(format(parse('1<x<3')), '1 < x ∧ x < 3');
});

test('기호 미분', () => {
  assert.equal(format(derivative(parse('x^3-3x'), 'x')), '3·x^2 - 3');
  assert.equal(format(derivative(parse('sin(2x)'), 'x')), 'cos(2·x)·2');
  assert.equal(derivative(parse('x^2*y'), 'y') !== null, true);
});

test('근 찾기: 부호변화·중근·극점', () => {
  const sin = N.findRoots(Math.sin, -10, 10);
  assert.equal(sin.length, 7);
  assert.ok(Math.abs(sin[3]) < 1e-9);
  const dbl = N.findRoots((x) => (x - 1) ** 2 * (x + 2), -5, 5);
  assert.deepEqual(dbl.map((r) => Math.round(r)), [-2, 1]);
  assert.deepEqual(N.findRoots((x) => 1 / x, -5, 5), []);   // 극점은 근이 아니다
});

test('수 인식: 분수 · π 배수 · 무리수', () => {
  assert.equal(N.pretty(0.75), '3/4');
  assert.equal(N.pretty(Math.PI / 3), 'π/3');
  assert.equal(N.pretty(Math.sqrt(2)), '√2');
  assert.equal(N.pretty(-2), '-2');
});

test('2변수 뉴턴법', () => {
  const p = N.newton2D((x, y) => x * x + y * y - 1, (x, y) => y - x, 1, 0.5);
  assert.ok(Math.abs(p[0] - Math.SQRT1_2) < 1e-9);
});
