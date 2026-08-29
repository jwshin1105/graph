import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BigFloat, add, sub, mul, div, sqrt, exp, ln, sin, cos, tan, atan, pow, PI, E,
} from '../src/math/bigfloat.js';

const B = BigFloat;
const P = 50;
// Python 의 decimal / 알려진 상수표로 확인한 값들 (앞 50자리)
const REF = {
  pi: '3.1415926535897932384626433832795028841971693993751',
  e: '2.7182818284590452353602874713526624977572470936999',
  ln2: '0.69314718055994530941723212145817656807550013436026',
  ln10: '2.3025850929940456840179914546843642076011014886288',
  sqrt2: '1.4142135623730950488016887242096980785696718753769',
  sin1: '0.84147098480789650665250232163029899962256306079837',
  cos1: '0.54030230586813971740093660744297660373231042061792',
  exp15: '4.4816890703380648226020554601192758190057498683697',
  atan1: '0.78539816339744830961566084581987572104929234984378',
};
/** 앞 n 자리가 같은가 (마지막 한 자리는 반올림 차이를 봐 준다) */
const head = (bf, ref, n = 45) => {
  const g = bf.toString(n).replace('-', '');
  const w = ref.replace('-', '').slice(0, g.length);
  assert.equal(g.slice(0, n - 3), w.slice(0, n - 3), `${g}\n≠ ${w}`);
};

test('십진 문자열을 정확히 담는다 — 배정밀도를 거치지 않는다', () => {
  assert.equal(B.parse('0.1').toString(), '0.1');
  assert.equal(add(B.parse('0.1'), B.parse('0.2'), P).toString(), '0.3');
  assert.equal(sub(B.parse('0.3'), add(B.parse('0.1'), B.parse('0.2'), P), P).toString(), '0');
  // float64 는 0 을 내놓는 계산
  assert.equal(sub(add(B.parse('1e16'), B.fromInt(1), P), B.parse('1e16'), P).toString(), '1');
});

test('사칙연산', () => {
  assert.equal(div(B.fromInt(1), B.fromInt(3), P).toString(20), '0.33333333333333333333');
  assert.equal(mul(B.parse('1.5'), B.parse('2.5'), P).toString(), '3.75');
  assert.equal(sub(B.fromInt(3), B.fromInt(10), P).toString(), '-7');
  assert.equal(div(B.fromInt(1), B.zero(), P), null);
});

test('제곱근', () => {
  head(sqrt(B.fromInt(2), P), REF.sqrt2);
  assert.equal(sqrt(B.fromInt(144), P).toString(), '12');
  // (√2)² 는 자릿수 안에서 정확히 2 로 돌아온다
  const r = sqrt(B.fromInt(2), P);
  assert.equal(mul(r, r, 30).toString(20), '2');
  assert.equal(sqrt(B.fromInt(-1), P), null);
});

test('π 와 e', () => {
  head(PI(P), REF.pi);
  head(E(P), REF.e);
  // sin π 는 자릿수 끝까지 0 에 붙는다
  assert.ok(Math.abs(sin(PI(P), P).toNumber()) < 1e-45);
});

test('지수와 로그', () => {
  head(exp(B.parse('1.5'), P), REF.exp15);
  head(ln(B.fromInt(2), P), REF.ln2);
  head(ln(B.fromInt(10), P), REF.ln10);
  // ln(e^x) = x
  head(ln(exp(B.parse('3.75'), P + 5), P), '3.75');
  assert.equal(ln(B.fromInt(0), P), null);
  assert.equal(ln(B.fromInt(-2), P), null);
});

test('삼각함수', () => {
  head(sin(B.fromInt(1), P), REF.sin1);
  head(cos(B.fromInt(1), P), REF.cos1);
  head(atan(B.fromInt(1), P), REF.atan1);
  // 4·atan 1 = π
  head(mul(atan(B.fromInt(1), P + 5), B.fromInt(4), P), REF.pi);
  // sin² + cos² = 1
  const s = sin(B.parse('0.7'), P), c = cos(B.parse('0.7'), P);
  assert.equal(add(mul(s, s, P), mul(c, c, P), 40).toString(30), '1');
  assert.ok(Math.abs(tan(B.parse('0.7'), P).toNumber() - Math.tan(0.7)) < 1e-15);
});

test('거듭제곱 — 정수 지수는 정확하게', () => {
  assert.equal(pow(B.fromInt(2), B.fromInt(100), 60).toString(60),
    '1267650600228229401496703205376');
  assert.equal(pow(B.fromInt(3), B.fromInt(-2), P).toString(20), '0.11111111111111111111');
  // 2^0.5 = √2
  head(pow(B.fromInt(2), B.parse('0.5'), P), REF.sqrt2);
});

test('자릿수를 늘리면 앞자리는 그대로다', () => {
  const a = PI(30).toString(25);
  const b = PI(80).toString(25);
  assert.equal(a, b);
});

test('반올림이 값을 오염시키지 않는다', () => {
  const x = div(B.fromInt(2), B.fromInt(3), 60);
  assert.equal(x.toString(5), '0.66667');           // 보여 줄 때만 반올림
  assert.equal(x.toString(30), '0.666666666666666666666666666667');
  // 원래 값은 그대로 남아 있다
  assert.equal(mul(x, B.fromInt(3), 40).toString(30), '2');
});

test('99…9 가 올라갈 때 자릿수가 어긋나지 않는다', () => {
  const x = B.parse('0.9999999999');
  assert.equal(x.round(3).toString(), '1');
  assert.equal(add(x, B.parse('0.0000000001'), 20).toString(), '1');
});
