import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/math/parser.js';
import { compile, makeContext } from '../src/math/evaluator.js';
import { setAngleMode, getAngleMode } from '../src/math/functions.js';
import { defaultStyle, DASHES, SWATCHES, PALETTE } from '../src/ui/renderer.js';
import { renderMath } from '../src/ui/mathhtml.js';
import { createContext, createObject, computeObject } from '../src/ui/objects.js';

test('기본 스타일과 선 모양 표', () => {
  const st = defaultStyle('#2563eb');
  assert.equal(st.color, '#2563eb');
  assert.equal(st.dash, 'solid');
  assert.equal(st.pointStyle, 'filled');
  assert.equal(DASHES.solid, null);
  assert.deepEqual(DASHES.dashed, [8, 5]);
  assert.ok(SWATCHES.length >= PALETTE.length);
});

test('좌표가 이름인 점은 끌 수 있다', () => {
  const ctx = createContext();
  createObject('a = 1', ctx, 1, 0);
  createObject('b = 2', ctx, 2, 1);
  const p = createObject('(a, b)', ctx, 3, 2);
  assert.equal(p.kind, 'point');
  assert.deepEqual(p.dragVars, ['a', 'b']);
  // 한쪽만 이름이면 그 축만 끌 수 있다
  assert.deepEqual(createObject('(a, 3)', ctx, 4, 3).dragVars, ['a', null]);
  // 숫자만 있는 점은 끌 수 없다
  assert.equal(createObject('(1, 2)', ctx, 5, 4).dragVars, null);
});

test('각도 단위 전환', () => {
  const ev = (s) => {
    const ctx = makeContext();
    return compile(parse(s), ctx)({});
  };
  assert.equal(getAngleMode(), 'rad');
  assert.ok(Math.abs(ev('sin(pi/2)') - 1) < 1e-12);
  try {
    setAngleMode('deg');
    assert.equal(getAngleMode(), 'deg');
    assert.ok(Math.abs(ev('sin(90)') - 1) < 1e-12);
    assert.ok(Math.abs(ev('cos(60)') - 0.5) < 1e-12);
    assert.equal(ev('asin(1)'), 90);
    assert.ok(Math.abs(ev('atan(1)') - 45) < 1e-12);
  } finally {
    setAngleMode('rad');
  }
  assert.ok(Math.abs(ev('sin(pi/2)') - 1) < 1e-12);
});

test('수식을 수학처럼 그린다', () => {
  const html = renderMath(parse('y = (x^2+1)/(x-1)'));
  assert.match(html, /mh-frac/);       // 분수는 위아래로 쌓는다
  assert.match(html, /mh-num/);
  assert.match(html, /mh-den/);
  assert.match(html, /mh-sup/);        // 지수는 위첨자
  assert.match(renderMath(parse('y = sqrt(x+1)')), /mh-sqrt/);
  assert.match(renderMath(parse('y = |x|')), /mh-abs/);
  assert.match(renderMath(parse('a_n = 1')), /mh-sub/);
  assert.match(renderMath(parse("y = f'(x)")), /′/);
  // 태그가 새어 나가지 않아야 한다
  assert.ok(!renderMath(parse('y = x')).includes('<script'));
});

test('분수를 무한정 쌓지 않는다', () => {
  // 다섯 겹으로 중첩해도 위아래로 쌓는 것은 두 겹까지, 나머지는 한 줄(a/b)로 적는다
  const deep = renderMath(parse('y = a/(b/(c/(d/(e/f))))'));
  const stacked = (deep.match(/mh-frac/g) || []).length;
  assert.ok(stacked <= 2, `쌓인 분수 ${stacked}개`);
  assert.equal((renderMath(parse('y=(x^2+1)/(x-1)')).match(/mh-frac/g) || []).length, 1);
});

test('스타일이 있어도 계산 결과는 그대로다', () => {
  const ctx = createContext();
  const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
  const o = createObject('y = sin x', ctx, 1, 0);
  o.style = { ...defaultStyle('#dc2626'), dash: 'dotted', width: 4 };
  const d = computeObject(o, B);
  assert.equal(d.polylines.length, 1);
});
