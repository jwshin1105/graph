import test from 'node:test';
import assert from 'node:assert/strict';
import { createContext, createObject, computeObject, analyzeObject } from '../src/ui/objects.js';

const B = { xmin: -6.5, xmax: 6.5, ymin: -5, ymax: 5, width: 1000, height: 770 };
const make = (src, ctx = createContext()) => {
  const o = createObject(src, ctx, 1, 0);
  if (!o.error) o.data = computeObject(o, B);
  return o;
};
const nv = (o) => (o.data.polylines || []).reduce((s, l) => s + l.length / 2, 0);

test('입력 종류를 알맞게 분류한다', () => {
  const cases = {
    'y=x^2-2': 'function', 'x=3': 'functionY', 'x^2+y^2=4': 'implicit',
    'y<x^2': 'region', 'sin x = 0': 'equation1d', 'x^2+y^2=4 and y=x': 'system',
    'x=1 or x=2': 'union', '(2,3)': 'point', '{(1,2),(2,4)}': 'points',
    '[1,1,2,3]': 'sequence', 'a_1=1; a_n=2a_{n-1}': 'sequence',
    'r=1+cos(θ)': 'polar', '(cos t, sin t)': 'parametric', '2+3*4': 'value',
    'f(x)=x^2': 'function', 'g(x,y)=x^2+y^2': 'defined', 'a=2': 'constant',
  };
  for (const [src, kind] of Object.entries(cases)) {
    assert.equal(make(src).kind, kind, `${src} 는 ${kind} 이어야 함`);
  }
});

test('or 로 이은 방정식은 해집합의 합집합', () => {
  const o = make('x=1 or x=2');
  assert.equal(o.kind, 'union');
  assert.equal(o.data.polylines.length, 2);
  const o2 = make('x^2+y^2=4 or y=x');
  assert.equal(o2.data.polylines.length, 2);
});

test('한 변수 연립방정식은 공통근으로 푼다', () => {
  const o = make('sin x=0 and cos x=-1');
  assert.equal(o.kind, 'system');
  assert.equal(o.data.points.length, 2);
  for (const [x] of o.data.points) assert.ok(Math.abs(Math.abs(x) - Math.PI) < 1e-9);
});

test('식이 셋 이상인 과결정 연립도 전부 검사한다', () => {
  assert.equal(make('x+y=3 and x-y=1 and 2x+y=4').data.points.length, 0);   // 모순계
  const ok = make('x+y=3 and x-y=1 and 2x+y=5').data.points;
  assert.equal(ok.length, 1);
  assert.ok(Math.abs(ok[0][0] - 2) < 1e-6 && Math.abs(ok[0][1] - 1) < 1e-6);
});

test('한쪽으로 풀린 식이 있으면 대입해서 푼다', () => {
  const ctx = createContext();
  const mk = (src) => {
    const o = createObject(src, ctx, 1, 0);
    o.data = computeObject(o, B);
    return o;
  };
  const a = mk('x^2+y^2=4 and y=x');
  assert.ok(a.explicit, '대입 경로를 타야 한다');
  assert.equal(a.data.points.length, 2);
  for (const [x, y] of a.data.points) {
    assert.ok(Math.abs(x * x + y * y - 4) < 1e-9 && Math.abs(y - x) < 1e-9);
  }
  const b = mk('x^2+y^2=4 and y=x^2-1');
  assert.equal(b.data.points.length, 2);
  for (const [x, y] of b.data.points) {
    assert.ok(Math.abs(x * x + y * y - 4) < 1e-9 && Math.abs(y - (x * x - 1)) < 1e-9);
  }
  // 해가 없을 때도 올바르게 없다고 한다
  assert.equal(mk('y = x^2 + 0.3 and y = x').data.points.length, 0);
  // 양쪽 다 음함수면 교점 방식으로 돌아간다
  const c = mk('x^2+y^2=4 and x^2-y^2=1');
  assert.equal(c.explicit, undefined);
  assert.equal(c.data.points.length, 4);
});

test('대입 경로가 교점 추적보다 훨씬 빠르다', () => {
  const ctx = createContext();
  const time = (src) => {
    const o = createObject(src, ctx, 1, 0);
    const t = Date.now();
    computeObject(o, B);
    return Date.now() - t;
  };
  const fast = time('x^2+y^2=4 and y=x');
  const slow = time('x^2+y^2=4 and x^2-y^2=1');
  assert.ok(fast * 3 < slow, `대입 ${fast}ms vs 교점 ${slow}ms`);
});

test('해가 없으면 그렇다고 알린다', () => {
  for (const src of ['x^2+y^2=-1', 'e^x=x']) {
    const o = make(src);
    assert.equal(o.data.empty, true);
    assert.equal(analyzeObject(o, B, createContext()).summary, '해 없음');
  }
});

test('해가 화면 해상도보다 촘촘하면 규칙을 단정하지 않는다', () => {
  const wide = { xmin: -1e6, xmax: 1e6, ymin: -8e5, ymax: 8e5, width: 1000, height: 770 };
  const ctx = createContext();
  const o = createObject('sin x = 0', ctx, 1, 0);
  o.data = computeObject(o, wide);
  assert.equal(o.data.dense, true);
  assert.equal(analyzeObject(o, wide, ctx).summary, '해가 너무 촘촘함');
});

test('계단함수는 도약에서 선이 끊긴다', () => {
  assert.equal(make('y=floor(x)').data.polylines.length, 14);   // [-6.5, 6.5] 안의 13번 도약
  assert.equal(make('y=sgn(x)').data.polylines.length, 2);
  // 가파르지만 연속인 함수는 끊지 않는다
  assert.equal(make('y=x^3').data.polylines.length, 1);
});

test('합·곱·정적분 기호를 계산한다', () => {
  assert.equal(make('sum(k^2, k, 1, 5)').value, 55);
  assert.equal(make('prod(k, k, 1, 5)').value, 120);
  const it = make('integral(x^2, x, 0, 1)');
  assert.equal(it.kind, 'integral');
  assert.ok(Math.abs(it.value - 1 / 3) < 1e-9);
  assert.ok(it.data.areaFill.length, '넓이를 칠하지 않음');
  assert.ok(Math.abs(make('integral(sin x, 0, pi)').value - 2) < 1e-9);
  const taylor = make('y = sum(x^k/fact(k), k, 0, 12)');
  assert.equal(taylor.kind, 'function');
  assert.ok(Math.abs(taylor.fn({ x: 1 }) - Math.E) < 1e-8);
});

test('매개변수 범위를 자동으로 잡고, 지정도 받는다', () => {
  assert.deepEqual(make('r=1+cos(θ)').range, [0, 2 * Math.PI]);      // 닫힌 곡선
  assert.deepEqual(make('r=θ').range, [0, 8 * Math.PI]);             // 주기 없음 → 여러 바퀴
  assert.deepEqual(make('r=θ; 0<=θ<=2π').range, [0, 2 * Math.PI]);   // 명시 지정
  assert.deepEqual(make('(cos t, sin 2t)').range, [0, 2 * Math.PI]);
  assert.deepEqual(make('(t, t^2)').range, [-4 * Math.PI, 4 * Math.PI]);
  assert.deepEqual(make('(t, sin t); -10<=t<=10').range, [-10, 10]);
});

test('이미 정의된 이름을 다시 쓰면 방정식으로 읽는다', () => {
  const ctx = createContext();
  assert.equal(make('g(x,y)=x^2+y^2', ctx).kind, 'defined');
  assert.equal(make('g(x,y)=4', ctx).kind, 'implicit');
  assert.equal(make('g(x,y)=4', ctx).data.polylines.length, 1);
});

test('정해지지 않은 기호는 이유를 밝히고 멈춘다', () => {
  const o = createObject('a x + y = 1', createContext(), 1, 0);
  assert.equal(o.kind, 'error');
  assert.match(o.error, /정해지지 않은 기호/);
});

test('까다로운 음함수도 그린다', () => {
  const hard = {
    'x^3+y^3=3x y': 1, 'max(x,y)=1': 1, 'x^4+y^4=1': 1,
    '(x^2+y^2)^2=4(x^2-y^2)': 2, 'abs(x)+abs(y)=1': 1,
  };
  for (const [src, minLines] of Object.entries(hard)) {
    const o = make(src);
    assert.ok(o.data.polylines.length >= minLines, `${src} → ${o.data.polylines.length}가지`);
    assert.ok(nv(o) > 100, `${src} 의 점 수가 너무 적음`);
  }
});

test('점 수가 폭주하지 않는다', () => {
  for (const src of ['y=e^x', 'y=x^3-3x', '(t^3-3t, t^2)', 'r=θ']) {
    assert.ok(nv(make(src)) < 20000, `${src} → ${nv(make(src))}점`);
  }
});

// ── 등식 ∧ 부등식 = 제한된 해집합 ───────────────────────
test('등식에 부등식이 붙으면 영역이 아니라 조건이 걸린 곡선', () => {
  const o = make('x^2 + y^2 = 4 and x > 0');
  assert.equal(o.kind, 'implicit');
  assert.equal(o.restricted, true);
  assert.ok(o.data.polylines.length >= 1, '반원이 그려지지 않음');
  // 그려진 점이 모두 조건을 만족해야 한다
  for (const line of o.data.polylines) {
    for (let i = 0; i < line.length; i += 2) {
      assert.ok(line[i] > -0.05, `x = ${line[i]} 는 조건 밖`);
    }
  }
});

test('{ } 제한과 and 부등식은 같은 결과', () => {
  const a = make('x^2 + y^2 = 4 and x > 0');
  const b = make('x^2 + y^2 = 4 {x > 0}');
  const len = (o) => o.data.polylines.reduce((n, l) => n + l.length, 0);
  assert.equal(a.kind, b.kind);
  assert.ok(Math.abs(len(a) - len(b)) <= 4, `${len(a)} vs ${len(b)}`);
});

test('제한이 걸려도 종류는 본래 식에서 정확히 읽는다', () => {
  const ctx = createContext();
  const o = make('x^2 + y^2 = 4 and x > 0', ctx);
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'conic-exact');
  assert.ok(f, '이차곡선 판정이 없음');
  assert.match(f.title, /원의 일부/);       // 해집합이 원 "자체"는 아니다
});

test('부등식만 있으면 그대로 영역', () => {
  const o = make('y < x^2 and y > 0');
  assert.equal(o.kind, 'region');
  assert.ok(o.data.mask);
});

test('연립해도 조건으로 거른다', () => {
  const o = make('x^2 + y^2 = 4 and y = x and x > 0');
  assert.equal(o.kind, 'system');
  assert.equal(o.data.points.length, 1);
  assert.ok(o.data.points[0][0] > 0);
});

test('표본을 맞춰 본 이차곡선은 "위에 놓인다" 라고만 말한다', () => {
  const ctx = createContext();
  const o = make('max(x, y) = 1', ctx);       // ㄱ 자 — 두 직선의 일부일 뿐이다
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'conic');
  assert.ok(f);
  assert.match(f.detail, /위에 놓입니다/);
  assert.doesNotMatch(f.detail, /해집합이/);
});

// ── 수열: 점화식과 초기값의 순서 ────────────────────────
test('점화식을 먼저 써도 초기값을 알아본다', () => {
  const terms = (src) => {
    const o = make(src);
    return computeObject(o, B).points.slice(0, 7).map((p) => p[1]);
  };
  const fib = [1, 1, 2, 3, 5, 8, 13];
  assert.deepEqual(terms('a_1 = 1; a_2 = 1; a_n = a_{n-1} + a_{n-2}'), fib);
  assert.deepEqual(terms('a_n = a_{n-1} + a_{n-2}; a_1 = 1; a_2 = 1'), fib);
  assert.deepEqual(terms('b_n = 3 b_{n-1}; b_1 = 2').slice(0, 4), [2, 6, 18, 54]);
});

// ── 영역의 넓이는 잰 만큼만 적는다 ──────────────────────
test('영역의 넓이를 경계 칸까지 잘게 재어 맞춘다', () => {
  const areaOf = (src) => {
    const ctx = createContext();
    const o = make(src, ctx);
    return analyzeObject(o, B, ctx).findings.find((f) => f.value !== undefined).value;
  };
  const rel = (src, truth) => Math.abs(areaOf(src) - truth) / truth;
  assert.ok(rel('|x| + |y| < 1', 2) < 3e-3, '마름모');
  assert.ok(rel('x^2 + y^2 < 1', Math.PI) < 3e-3, '원');
  assert.ok(rel('y > x^2 and y < 4', 32 / 3) < 3e-3, '포물선 띠');
  assert.ok(rel('x^2 + y^2 < 0.25', Math.PI / 4) < 3e-3, '작은 원');
  assert.ok(rel('y < x and y > -x and x < 3', 9) < 3e-3, '삼각형');
});

test('적은 자릿수가 실제 정확도를 넘지 않는다', () => {
  // 유효숫자 셋까지만 적는다 — 적힌 마지막 자리는 반올림해서 맞아야 한다
  const cases = [
    ['y > x^2 and y < 4', 32 / 3],
    ['|x| + |y| < 1', 2],
    ['x^2 + y^2 < 1', Math.PI],
    ['x^2/4 + y^2/9 < 1', 6 * Math.PI],
    ['x^2 + y^2 < 0.25', Math.PI / 4],
    ['y < x and y > -x and x < 3', 9],
  ];
  for (const [src, truth] of cases) {
    const ctx = createContext();
    const o = make(src, ctx);
    const f = analyzeObject(o, B, ctx).findings.find((x) => x.value !== undefined);
    const shown = Number(f.detail.match(/약 ([\d.]+)/)[1]);
    const dec = (String(shown).split('.')[1] || '').length;
    assert.ok(Math.abs(shown - truth) <= 0.5 * Math.pow(10, -dec) + 1e-12,
      `${src}: ${shown} 은 소수 ${dec}자리까지 맞다고 하기 어렵다 (참값 ${truth})`);
  }
});

test('등고선이 "가지 115개" 라 하던 식을 곡선족으로 읽는다', () => {
  const ctx = createContext();
  const o = make('sin(x y) = 0', ctx);
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'level-family');
  assert.ok(f, '곡선족을 알아보지 못함');
  assert.match(f.title, /x·y = kπ/);
  assert.match(f.detail, /쌍곡선/);
  assert.match(f.detail, /퇴화/);         // x y = 0 은 두 직선
});

test('가질 수 없는 값이면 곡선족 대신 해 없음', () => {
  const ctx = createContext();
  const o = make('sin(x + y) = 2', ctx);
  const f = analyzeObject(o, B, ctx).findings.find((x) => x.type === 'level-family');
  assert.equal(f.title, '해 없음');
});

// ── 미적분: 접선·법선과 정적분 ──────────────────────────
test('접선의 방정식을 세워 그린다', () => {
  const ctx = createContext();
  make('f(x) = x^3 - 3x', ctx);
  const t = make('tangent(f, 2)', ctx);
  assert.equal(t.kind, 'tangent');
  assert.equal(t.data.equation, 'y = 9x - 16');       // f′(2) = 9, f(2) = 2
  assert.deepEqual(t.data.points, [[2, 2]]);
  assert.ok(t.data.polylines.length);
});

test('법선은 기울기가 −1/f′ 이고, f′ = 0 이면 세로선', () => {
  const ctx = createContext();
  make('f(x) = x^2', ctx);
  assert.equal(make('normal(f, 1)', ctx).data.equation, 'y = -x/2 + 3/2');
  // x = 0 에서 f′ = 0 → 법선은 x = 0
  assert.equal(make('normal(f, 0)', ctx).data.equation, 'x = 0');
});

test('접선은 식으로 세워 두므로 슬라이더를 따라 움직인다', () => {
  const ctx = createContext();
  const slider = make('a = 1', ctx);
  const t = make('tangent(x^2, a)', ctx);
  assert.equal(t.data.equation, 'y = 2x - 1');
  const def = ctx.defs.get('a');
  def.body = { type: 'num', value: 3 };
  def.compiled = null;
  slider.value = 3;
  assert.equal(computeObject(t, B).equation, 'y = 6x - 9');
});

test('이름 없이 식을 바로 줘도 된다', () => {
  assert.equal(make('tangent(sin x, 0)').data.equation, 'y = x');
});

test('정적분은 값과 함께 넓이를 칠한다', () => {
  const o = make('integral(sin x, 0, pi)');
  assert.equal(o.kind, 'integral');
  assert.ok(Math.abs(o.value - 2) < 1e-9);
  assert.ok(o.data.areaFill.length);
  assert.equal(o.data.labels.length, 1);
});

test('축 아래 부분이 있으면 부호 없는 넓이도 알려 준다', () => {
  const ctx = createContext();
  const o = make('integral(sin x, 0, 2pi)', ctx);
  const f = analyzeObject(o, B, ctx).findings;
  assert.ok(Math.abs(f[0].detail.includes('0')));
  const signed = f.find((x) => x.type === 'signed');
  assert.ok(signed, '축 아래 부분을 알리지 않음');
  assert.match(signed.detail, /4/);
});
