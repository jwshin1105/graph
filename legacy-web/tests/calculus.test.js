import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/math/parser.js';
import { antiderivative, tanhSinh } from '../src/math/integrate.js';
import { limitOf } from '../src/math/limit.js';
import { compile, makeContext } from '../src/math/evaluator.js';
import { createContext, createObject } from '../src/ui/objects.js';

const mk = (src) => { const ctx = createContext(); return createObject(src, ctx, 1, 0); };
const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));

// ── 정확한 정적분 ──────────────────────────────────────
test('부정적분을 기호로 구해 정확한 값을 낸다', () => {
  const cases = [
    ['integral(x^2, x, 0, 1)', '1/3'],
    ['integral(3x^2 + 2x + 1, x, 0, 2)', '14'],
    ['integral(1/x, x, 1, 2)', 'ln 2'],
    ['integral(sin x, x, 0, pi)', '2'],
    ['integral(cos x, x, 0, pi/2)', '1'],
    ['integral(1/(1+x^2), x, 0, 1)', 'π/4'],
    ['integral(sqrt(1-x^2), x, -1, 1)', 'π/2'],
    ['integral(ln(x), x, 1, e)', '1'],
    ['integral(x^3, x, -1, 1)', '0'],
  ];
  for (const [src, want] of cases) {
    const o = mk(src);
    assert.equal(o.method, 'exact', `${src} 를 정확히 풀지 못함`);
    assert.equal(o.exactText, want, src);
  }
});

test('∫√(1−x²) 는 심프슨이 4e−10 틀리던 자리다', () => {
  const o = mk('integral(sqrt(1-x^2), x, -1, 1)');
  assert.equal(o.exactText, 'π/2');
  assert.ok(rel(o.value, Math.PI / 2) < 1e-25, `${o.value}`);
});

test('부정적분을 못 구하면 수치로 풀고 오차를 함께 적는다', () => {
  const o = mk('integral(e^(-x^2), x, -10, 10)');
  assert.equal(o.method, 'numeric');
  assert.ok(rel(o.value, Math.sqrt(Math.PI)) < 1e-14, `${o.value}`);
  assert.ok(o.error < 1e-12, `추정 오차 ${o.error}`);
});

test('부정적분', () => {
  const F = (s) => antiderivative(parse(s), 'x');
  assert.ok(F('x^2'));
  assert.ok(F('1/x'));
  assert.ok(F('sin(2x+1)'));
  assert.ok(F('1/(1+x^2)'));
  assert.equal(F('sin(x^2)'), null);        // 못 구하면 없다고 한다
  assert.equal(F('e^(-x^2)'), null);
});

// ── 이중지수 구적법 ────────────────────────────────────
test('끝점이 발산하는 적분도 기계정밀도까지', () => {
  const t = [
    [(x) => 1 / Math.sqrt(x), 0, 1, 2],
    [(x) => Math.sqrt(1 - x * x), -1, 1, Math.PI / 2],
    [(x) => Math.log(x), 0, 1, -1],
    [(x) => Math.exp(-x * x), -10, 10, Math.sqrt(Math.PI)],
  ];
  for (const [f, a, b, want] of t) {
    const r = tanhSinh(f, a, b);
    assert.ok(rel(r.value, want) < 1e-14, `${want}: ${r.value}`);
    assert.ok(r.error < 1e-10, `추정 오차 ${r.error}`);
  }
});

test('식 안의 integral 도 같은 방법을 쓴다', () => {
  const ctx = makeContext();
  const v = compile(parse('integral(sqrt(1-x^2), x, -1, 1)'), ctx)({});
  assert.ok(rel(v, Math.PI / 2) < 1e-14, `${v}`);
});

// ── 극한 ───────────────────────────────────────────────
const lim = (src) => mk(src).limit;

test('대입할 수 있으면 대입한다', () => {
  const r = lim('limit(x^2, x, 3)');
  assert.equal(r.method, 'substitute');
  assert.equal(r.text, '9');
});

test('0/0 은 로피탈로 정확하게', () => {
  assert.equal(lim('limit(sin(x)/x, x, 0)').text, '1');
  assert.equal(lim('limit((1-cos(x))/x^2, x, 0)').text, '1/2');
  assert.equal(lim('limit((x^2-1)/(x-1), x, 1)').text, '2');
  assert.equal(lim('limit((e^x-1)/x, x, 0)').text, '1');
  assert.equal(lim('limit((sqrt(x+1)-1)/x, x, 0)').text, '1/2');
  assert.match(lim('limit(sin(x)/x, x, 0)').method, /hopital/);
});

test('발산과 진동과 좌우 불일치를 가른다', () => {
  assert.equal(lim('limit(1/x^2, x, 0)').text, '∞');
  assert.equal(lim('limit(ln(x), x, 0)').text, '−∞');
  assert.equal(lim('limit(x^2, x, inf)').text, '∞');
  assert.match(lim('limit(1/x, x, 0)').text, /좌우가 다름/);
  assert.match(lim('limit(abs(x)/x, x, 0)').text, /좌우가 다름/);
  assert.match(lim('limit(sin(x), x, inf)').text, /모이지 않음/);
});

test('천천히 모이는 극한은 가속해서 좁힌다', () => {
  // (1+1/x)^x 는 오차가 1/x 로 줄어 그냥 재면 자릿수가 안 나온다
  const r = lim('limit((1+1/x)^x, x, inf)');
  assert.ok(rel(r.value, Math.E) < 1e-6, `${r.value}`);
  assert.equal(lim('limit(sin(x)/x, x, inf)').text, '0');   // −6e−13 이라 적으면 안 된다
  assert.equal(lim('limit((3x^2+2)/(x^2-1), x, inf)').value, 3);
});

test('어떻게 구했는지 남긴다', () => {
  const r = lim('limit(sin(x)/x, x, 0)');
  assert.ok(r.steps.length);
  assert.match(r.steps.join(' '), /로피탈/);
});

test('limitOf 를 직접 부를 수도 있다', () => {
  const ctx = makeContext();
  const body = parse('(x^3-1)/(x-1)');
  const r = limitOf(body, 'x', 1, { fn: compile(body, ctx) });
  assert.equal(r.text, '3');
});
