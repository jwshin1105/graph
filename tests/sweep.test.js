import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createObject, computeObject, dependsOn, sweepHooks } from '../src/ui/objects.js';
import { sweepParameter, sweepSteps, objectSignature } from '../src/analysis/sweep.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 900, height: 700 };

/** 파라미터 하나를 훑는 준비를 한 번에 */
function setup(lines, param) {
  const ctx = createContext();
  const objs = lines.map((src, i) => {
    const o = createObject(src, ctx, i + 1, 0);
    o.visible = true;
    return o;
  });
  const setParam = (t) => {
    const d = ctx.defs.get(param);
    d.body = { type: 'num', value: t };
    d.compiled = null;
  };
  const targets = objs.filter((o) => o.defName !== param && dependsOn(o, param)
    && !['constant', 'list', 'value'].includes(o.kind));
  return { ctx, objs, targets, setParam };
}
const run = (lines, param, min, max) => {
  const s = setup(lines, param);
  return sweepParameter({
    objects: s.targets, setParam: s.setParam, min, max, bounds: B, compute: computeObject,
    ...sweepHooks(s.targets, s.ctx, param),
  });
};
const labels = (r) => r.stages.map((st) => st.sig.label);

test('이차곡선의 종류가 갈리는 지점', () => {
  const r = run(['a = 1', 'x^2 + a y^2 = 1'], 'a', -2, 2);
  assert.deepEqual(labels(r), ['쌍곡선', '타원']);
  assert.equal(r.transitions.length, 1);
  assert.equal(r.transitions[0].at, 0);
  assert.match(r.transitions[0].isolated.label, /두 평행선|두 직선/);
  // 정확히 원이 되는 순간도 따로 잡는다
  const circle = r.events.find((e) => e.sig.label.includes('원'));
  assert.ok(circle, '원이 되는 순간을 못 찾음');
  assert.equal(circle.at, 1);
});

test('실근 개수가 바뀌는 지점', () => {
  const r = run(['a = 0', 'y = x^3 + a x'], 'a', -3, 3);
  assert.deepEqual(labels(r), ['실근 3개 · 극값 2개', '실근 1개 · 극값 0개']);
  assert.equal(r.transitions.length, 1);
  assert.equal(r.transitions[0].at, 0);
});

test('해가 생겨나는 지점 — 빈 집합 → 한 점 → 원', () => {
  const r = run(['a = 1', 'x^2 + y^2 = a'], 'a', -1, 3);
  assert.deepEqual(labels(r), ['해 없음', '원']);
  assert.equal(r.transitions[0].at, 0);
  assert.match(r.transitions[0].isolated.label, /고립해 1개/);   // a = 0 에서는 원점 한 점
});

test('연립방정식의 해 개수가 바뀌는 지점', () => {
  // y = x² + a 와 y = x 는 x² − x + a = 0, 판별식 1 − 4a 가 0 이 되는 a = 1/4 에서 접한다
  const r = run(['a = 0', 'y = x^2 + a and y = x'], 'a', -2, 2);
  assert.deepEqual(labels(r), ['연립해 2개', '연립해 0개']);
  assert.equal(r.transitions[0].at, 0.25);
});

test('극값 개수가 바뀌는 지점', () => {
  const r = run(['a = 0', 'y = x^4 + a x^2'], 'a', -3, 3);
  assert.deepEqual(labels(r), ['실근 2개 · 극값 3개', '실근 0개 · 극값 1개']);
  assert.equal(r.transitions[0].at, 0);
});

test('분류가 내내 같으면 분기점을 만들어 내지 않는다', () => {
  const r = run(['a = 1', 'y = a x + 1'], 'a', 1, 3);
  assert.equal(r.transitions.length, 0);
  assert.equal(r.stages.length, 1);
});

test('훑기가 끝나면 파라미터를 원래 값으로 되돌린다', () => {
  const s = setup(['a = 1.5', 'x^2 + a y^2 = 1'], 'a');
  sweepParameter({
    objects: s.targets, setParam: s.setParam, min: -2, max: 2,
    bounds: B, compute: computeObject, restore: 1.5,
  });
  assert.equal(s.ctx.defs.get('a').body.value, 1.5);
});

test('제너레이터는 진행률을 흘려보내고 같은 결과를 낸다', () => {
  const s = setup(['a = 1', 'x^2 + a y^2 = 1'], 'a');
  const it = sweepSteps({
    objects: s.targets, setParam: s.setParam, min: -2, max: 2, bounds: B, compute: computeObject,
  });
  let step = it.next();
  let count = 0;
  let last = 0;
  while (!step.done) {
    assert.ok(step.value >= last - 1e-9 && step.value <= 1, `진행률 ${step.value}`);
    last = step.value;
    count++;
    step = it.next();
  }
  assert.ok(count > 20);
  assert.equal(step.value.transitions[0].at, 0);
});

test('객체 하나의 서명', () => {
  const ctx = createContext();
  const circle = createObject('x^2+y^2=4', ctx, 1, 0);
  assert.match(objectSignature(circle, B, computeObject).label, /원/);
  const cubic = createObject('y = x^3 - 3x', ctx, 2, 1);
  assert.equal(objectSignature(cubic, B, computeObject).label, '실근 3개 · 극값 2개');
  const empty = createObject('x^2+y^2=-1', ctx, 3, 2);
  assert.equal(objectSignature(empty, B, computeObject).label, '해 없음');
});

test('곡선에 붙은 고립해가 생기는 지점을 기호로 짚는다', () => {
  // y² = x²(x−a) 의 원점은 늘 특이점이지만, a 의 부호에 따라
  // 매듭점이었다가 고립점이 된다. 격자로는 a ≈ 0.0004 로만 잡히던 자리다.
  const r = run(['a = 0', 'y^2 = x^2 (x - a)'], 'a', -2, 2);
  assert.equal(r.transitions.length, 1);
  assert.equal(r.transitions[0].at, 0);
  assert.equal(r.transitions[0].approx, false);
  assert.match(r.transitions[0].reason, /헤세 행렬식/);
  assert.match(r.transitions[0].after.label, /고립해/);
});

test('가지가 갈라지는 자리도 기호로 짚는다', () => {
  // y² = x³ − a x 는 a = 0 에서 첨점이 되며 가지가 1개 ↔ 2개로 갈린다
  const r = run(['a = 0', 'y^2 = x^3 - a x'], 'a', -2, 2);
  assert.equal(r.transitions.length, 1);
  assert.equal(r.transitions[0].at, 0);
  assert.match(r.transitions[0].reason, /f_x = f_y = 0/);
});

test('3차 이상인 식을 표본에 맞춰 이차곡선이라 부르지 않는다', () => {
  // 데카르트의 잎 x³+y³ = a x y 를 "두 평행선" 이라 하고 있었다
  const r = run(['a = 1', 'x^3 + y^3 = a x y'], 'a', -2, 2);
  for (const st of r.stages) {
    assert.doesNotMatch(st.sig.label, /직선|평행|타원|쌍곡선|포물선/, st.sig.label);
  }
});

test('훑기 결과는 실행할 때마다 같다', () => {
  const key = () => {
    const r = run(['a = 1', 'x^2 + a y^2 = 1'], 'a', -2, 2);
    return `${r.transitions.map((t) => t.atText).join(',')}|${r.events.map((e) => e.atText).join(',')}`;
  };
  const a = key();
  const b = key();
  assert.equal(a, b);
  assert.equal(a, '0|1');       // 분기점 a=0, 원이 되는 순간 a=1
  // "그 순간" 표시도 매번 같아야 한다 (깔끔한 수로 맞춘 자리에서 재므로)
  const r = run(['a = 1', 'x^2 + y^2 = a'], 'a', -1, 3);
  assert.match(r.transitions[0].isolated.label, /고립해 1개/);
});

test('깔끔한 수로 맞춘 값에는 근사 표시를 붙이지 않는다', () => {
  const exact = run(['a = 0', 'y = x^3 + a x'], 'a', -3, 3);
  assert.equal(exact.transitions[0].approx, false);
  assert.equal(exact.transitions[0].at, 0);
  // 화면 범위 때문에 생기는 경계처럼 깔끔하지 않은 값은 근사로 표시한다
  const win = run(['a = 0', 'y = sin x + a'], 'a', -2, 2);
  const odd = win.transitions.find((t) => Math.abs(Math.abs(t.at) - 0.206) < 0.01);
  assert.ok(odd && odd.approx === true);
  const clean = win.transitions.find((t) => t.at === 1);
  assert.ok(clean && clean.approx === false);
});

test('시간 예산을 넘겨도 결과를 돌려준다', () => {
  const s = setup(['a = 1', 'x^2 + a y^2 = 1'], 'a');
  const r = sweepParameter({
    objects: s.targets, setParam: s.setParam, min: -2, max: 2,
    bounds: B, compute: computeObject, budgetMs: 0,
  });
  assert.equal(r.truncated, true);
  assert.ok(r.stages.length >= 1);
});

test('계산 설정이 실제로 전달된다', () => {
  const ctx = createContext();
  const o = createObject('x^2 + y^2 = 4', ctx, 1, 0);
  const fine = computeObject(o, B, {});
  const coarse = computeObject(o, B, { coarsePx: 40, refine: 4 });
  const count = (d) => d.polylines.reduce((n, l) => n + l.length / 2, 0);
  assert.ok(count(coarse) < count(fine) / 2, `성긴 설정 ${count(coarse)} vs 기본 ${count(fine)}`);
});

test('슬라이더 의존성 판정', () => {
  const ctx = createContext();
  createObject('a = 1', ctx, 1, 0);
  assert.equal(dependsOn(createObject('y = a x^2', ctx, 2, 1), 'a'), true);
  assert.equal(dependsOn(createObject('y = x^2', ctx, 3, 2), 'a'), false);
});
