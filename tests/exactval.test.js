import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/math/parser.js';
import { Exact, toExact, evalBig } from '../src/math/exactval.js';
import { Rat } from '../src/math/rational.js';
import { setPrecision, getPrecision } from '../src/math/precision.js';
import { createContext, createObject } from '../src/ui/objects.js';

const ex = (src) => toExact(parse(src));
const txt = (src) => { const v = ex(src); return v ? v.toString() : null; };

test('유리수는 부동소수로 강제하지 않는다', () => {
  assert.equal(txt('0.1 + 0.2'), '3/10');           // 0.30000000000000004 이 아니다
  assert.equal(txt('0.1 + 0.2 - 0.3'), '0');
  assert.equal(txt('1/3 + 1/6'), '1/2');
  assert.equal(txt('1/3 * 3'), '1');
  assert.equal(txt('1/7'), '1/7');
  assert.equal(txt('1e16 + 1 - 1e16'), '1');        // float64 는 0 을 낸다
});

test('큰 정수를 잃지 않는다', () => {
  assert.equal(txt('2^100'), '1267650600228229401496703205376');
  assert.equal(txt('fact(25)'), '15511210043330985984000000');
  assert.equal(txt('2^64 - 1'), '18446744073709551615');
});

test('근호를 기호 그대로 유지한다', () => {
  assert.equal(txt('sqrt(2)^2'), '2');              // 2.0000000000000004 이 아니다
  assert.equal(txt('sqrt(8)'), '2√2');
  assert.equal(txt('sqrt(2)/2'), '√2/2');
  assert.equal(txt('1/sqrt(2)'), '√2/2');           // 분모를 유리화한다
  assert.equal(txt('sqrt(2)*sqrt(3)'), '√6');
  assert.equal(txt('sqrt(18) + sqrt(8)'), '5√2');
  assert.equal(txt('sqrt(1/4)'), '1/2');
  assert.equal(txt('2^0.5'), '√2');
});

test('황금비와 켤레 유리화', () => {
  assert.equal(txt('(1 + sqrt(5))/2'), '(1 + √5)/2');
  assert.equal(txt('(1+sqrt(5))/2 * (1-sqrt(5))/2'), '-1');
  assert.equal(txt('3/(1 + sqrt(2))'), '-3 + 3√2');
});

test('π 와 e 를 기호로 유지한다', () => {
  assert.equal(txt('pi/4'), 'π/4');
  assert.equal(txt('2 pi'), '2π');
  assert.equal(txt('pi - pi'), '0');
  assert.equal(txt('ln(e)'), '1');
  assert.equal(txt('ln(1)'), '0');
  assert.equal(txt('e^0'), '1');
});

test('특수각의 삼각함수는 정확히', () => {
  assert.equal(txt('sin(pi/6)'), '1/2');
  assert.equal(txt('cos(pi/3)'), '1/2');
  assert.equal(txt('sin(pi/4)'), '√2/2');
  assert.equal(txt('cos(pi/6)'), '√3/2');
  assert.equal(txt('tan(pi/4)'), '1');
  assert.equal(txt('tan(pi/3)'), '√3');
  assert.equal(txt('sin(pi)'), '0');                // 1.22e-16 이 아니다
  assert.equal(txt('cos(2 pi)'), '1');
  assert.equal(txt('sin(7 pi/6)'), '-1/2');
});

test('정확값이 없으면 없다고 한다 — 억지로 만들지 않는다', () => {
  assert.equal(ex('sin(1)'), null);
  assert.equal(ex('e^pi'), null);
  assert.equal(ex('sqrt(-1)'), null);
  assert.equal(ex('sqrt(2)^sqrt(2)'), null);
});

test('정확값의 수치는 자릿수를 늘려도 앞자리가 그대로다', () => {
  const v = ex('(1 + sqrt(5))/2');
  assert.equal(v.toBig(20).toString(15), '1.61803398874989');
  assert.equal(v.toBig(60).toString(15), '1.61803398874989');
  assert.ok(Math.abs(v.toNumber() - (1 + Math.sqrt(5)) / 2) < 1e-15);
});

test('정확값이 없을 때는 고정밀 수치로 — 오차가 배정밀도보다 작다', () => {
  const b = evalBig(parse('sin(1)'), new Map(), 40);
  assert.equal(b.toString(40), '0.8414709848078965066525023216302989996226');
  assert.equal(evalBig(parse('e^pi'), new Map(), 30).toString(20), '23.140692632779269006');
  // atan(1)*4 = π
  assert.equal(evalBig(parse('atan(1)*4'), new Map(), 30).toString(25),
    '3.141592653589793238462643');
});

// ── 계산기에 이어 붙였을 때 ────────────────────────────
test('값 줄은 정확값을 먼저 보여 준다', () => {
  const ctx = createContext();
  const mk = (s) => createObject(s, ctx, 1, 0);
  assert.equal(mk('0.1 + 0.2').valueKind, 'exact');
  assert.match(mk('0.1 + 0.2').label, /= 3\/10/);
  assert.equal(mk('sqrt(2)^2').label, 'sqrt(2)^2 = 2');
  assert.equal(mk('sin(1)').valueKind, 'big');
});

test('정밀도를 지정할 수 있고 표시와 내부가 나뉜다', () => {
  const before = getPrecision();
  const ctx = createContext();
  createObject('precision = 60', ctx, 1, 0);
  createObject('digits = 40', ctx, 2, 0);
  const o = createObject('sin(1)', ctx, 3, 0);
  assert.equal(o.label, 'sin(1) = 0.8414709848078965066525023216302989996226');
  // 표시를 줄여도 안에 든 값은 그대로다
  createObject('digits = 5', ctx, 4, 0);
  const o2 = createObject('sin(1)', ctx, 5, 0);
  assert.equal(o2.label, 'sin(1) = 0.84147');
  assert.equal(o2.big.toString(30), '0.841470984807896506652502321630');
  setPrecision(before);
});

test('Exact 산술', () => {
  const a = Exact.rat(Rat.of(1, 3));
  const b = Exact.sqrtInt(2n);
  assert.equal(a.add(a).toString(), '2/3');
  assert.equal(b.mul(b).toString(), '2');
  assert.equal(a.div(b).toString(), '√2/6');
  assert.equal(Exact.int(5).pow(3).toString(), '125');
  assert.equal(Exact.int(2).pow(-1).toString(), '1/2');
  assert.equal(Exact.zero().isZero, true);
});
