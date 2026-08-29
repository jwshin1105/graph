// 입력 한 줄 → 그릴 수 있는 객체로 해석하고, 그 객체의 해집합을 계산·분석한다.

import { parse, freeVars, format, ParseError } from '../math/parser.js';
import { compile, residual, residualList, predicate, makeContext } from '../math/evaluator.js';
import { derivative } from '../math/derivative.js';
import { FUNCTIONS, CONSTANTS } from '../math/functions.js';
import { traceImplicit } from '../engine/implicit.js';
import { sampleFunction, sampleParametric, samplePolar } from '../engine/sampler.js';
import { solve1D, solveSystem2D, solveSystemN, intersectRoots, regionMask, polylineIntersections } from '../engine/solvers.js';
import { newton2D, levenbergMarquardt, trimNum as tn } from '../math/numeric.js';
import { analyzeSequence } from '../analysis/sequence.js';
import { analyzePointSet } from '../analysis/pointset.js';
import { analyzeCurve } from '../analysis/curve.js';
import { analyzeFunction } from '../analysis/functionAnalysis.js';
import { fitConic } from '../analysis/conic.js';
import { classifyConicExact, conicEquation, polyRootsExact, conicTransitions, familyTransitions, singularTransitions, levelFamily } from '../analysis/exact.js';
import { toPoly } from '../math/poly.js';
import { ratFromNumber } from '../math/rational.js';
import { toExact, evalBig, Exact } from '../math/exactval.js';
import { internalDigits, displayDigits, setPrecision, getPrecision } from '../math/precision.js';
import { pretty, trimNum } from '../math/numeric.js';

const ANGLE_VARS = new Set(['t', 'θ', 'theta']);
const isBuiltin = (n) => Object.prototype.hasOwnProperty.call(FUNCTIONS, n);

export const SETTING_NAMES = ['precision', 'digits'];

export function createContext() {
  return makeContext();
}

/** ctx 에 이미 정의된 이름들 (토크나이저가 통째로 인식하도록) */
export function knownNames(ctx) {
  // 설정 이름은 한 낱말로 읽어야 한다. 모르는 이름이면 p·r·e·c·i·s·i·o·n 으로 쪼개진다.
  return new Set([...ctx.defs.keys(), ...ctx.seqs.keys(), 'x', 'y', 'n', 'k', 't', 'r', 'θ',
    'and', 'or', ...SETTING_NAMES]);
}

/**
 * 입력 문자열을 해석해 객체를 만든다. 여러 정의는 ';' 로 나눈다.
 */
export function createObject(source, ctx, id, colorIndex) {
  const obj = {
    id, source, colorIndex, visible: true, error: null, kind: 'unknown',
    label: source.trim(), analysis: null, data: null,
  };
  const parts = source.split(';').map((s) => s.trim()).filter(Boolean);
  if (!parts.length) { obj.kind = 'empty'; return obj; }

  // e, π 처럼 이미 상수인 이름을 변수로 쓰면 "2.718 = 0.5" 라는 참·거짓 판정이 되어 버린다
  const reserved = /^\s*([A-Za-zπφτ]+)\s*=[^=]/.exec(`${source} `);
  if (reserved) {
    const lhs = reserved[1];
    const isConst = (t) => Object.prototype.hasOwnProperty.call(CONSTANTS, t);
    // 'e = 0.5' 는 "2.718 = 0.5" 라는 참·거짓 판정이 되어 버린다.
    // 'ee = 1' 처럼 상수 글자만으로 이루어진 이름도 마찬가지다.
    const bad = isConst(lhs) || (lhs.length > 1 && [...lhs].every((ch) => isConst(ch)));
    if (bad) {
      obj.kind = 'error';
      obj.error = `'${lhs}' 는 이미 정해진 상수라서 이름으로 쓸 수 없습니다. 다른 글자를 써 주세요.`;
      return obj;
    }
  }

  try {
    const asts = parts.map((p) => parse(p, knownNames(ctx)));
    classify(obj, asts, ctx);
  } catch (e) {
    obj.error = e instanceof ParseError ? `${e.message} (위치 ${e.pos})` : e.message;
    obj.kind = 'error';
  }
  return obj;
}

function classify(obj, asts, ctx) {
  // ';' 로 붙인 조각 중 "0 <= t <= 6π" 꼴은 매개변수 범위 지정으로 떼어 낸다
  const ranges = [];
  const rest = asts.filter((a) => {
    const r = asRange(a);
    if (r) { ranges.push(r); return false; }
    return true;
  });
  if (rest.length) asts = rest;
  const main = asts[asts.length - 1];
  obj.asts = asts;
  obj.ranges = ranges;

  // ── 리스트 정의: x_1 = [1,2,3] 또는 L = [1...10]
  const listDef = asts.find((a) => a.type === 'cmp' && a.op === '='
    && ['range', 'comp', 'list'].includes(a.b.type)
    && ((a.a.type === 'var' && !['x', 'y', 'r'].includes(a.a.name))
      || (a.a.type === 'index' && a.a.index.type === 'num')));
  if (listDef && !(listDef.b.type === 'list'
      && listDef.b.items.every((it) => it.type === 'tuple'))) {
    const name = listDef.a.type === 'var'
      ? listDef.a.name
      : `${listDef.a.base.name}_${listDef.a.index.value}`;
    ctx.defs.set(name, { params: [], body: listDef.b, compiled: null });
    obj.kind = 'list';
    obj.defName = name;
    obj.values = compile(listDef.b, ctx)({});
    obj.label = `${name} = [${obj.values.slice(0, 8).map((v) => tn(v, 6)).join(', ')}`
      + `${obj.values.length > 8 ? ', …' : ''}]  (${obj.values.length}개)`;
    return obj;
  }

  // ── 회귀: y_1 ~ a x_1 + b
  if (main.type === 'cmp' && main.op === '~') return buildRegression(obj, main, ctx);

  // ── 점열 정의: P_n = (n, n²) — 값이 점인 수열
  const ptSeq = asts.find((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index'
    && a.b.type === 'tuple' && a.b.items.length === 2);
  if (ptSeq) {
    const name = ptSeq.a.base.type === 'var' ? ptSeq.a.base.name : 'P';
    const idxVar = ptSeq.a.index.type === 'var' ? ptSeq.a.index.name : 'n';
    obj.kind = 'pointseq';
    obj.name = name;
    obj.varName = idxVar;
    obj.fx = compile(ptSeq.b.items[0], ctx);
    obj.fy = compile(ptSeq.b.items[1], ctx);
    obj.n0 = 1;
    const given = ranges.find((r) => r.name === idxVar);
    obj.nRange = given ? [Math.round(given.range[0]), Math.round(given.range[1])] : null;
    obj.label = `${name}_${idxVar} = (${format(ptSeq.b.items[0])}, ${format(ptSeq.b.items[1])})`;
    return obj;
  }

  // ── 수열 정의: a_n = …  (앞선 조각들은 초기값 a_1 = 1 처럼 취급)
  const seqDef = asts.find((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index');
  if (seqDef) return buildSequence(obj, asts, ctx);

  // ── 함수 정의: f(x) = …
  const distinctVarArgs = (n) =>
    n.type === 'call' && n.args.length > 0 && n.args.every((p) => p.type === 'var')
    && new Set(n.args.map((p) => p.name)).size === n.args.length;
  const looksLikeDef = main.type === 'cmp' && main.op === '=' && main.a.type === 'call'
    && !isBuiltin(main.a.name) && distinctVarArgs(main.a);
  if (looksLikeDef && ctx.defs.has(main.a.name)) {
    // 이미 있는 이름이면 새 정의가 아니라 "그 함수에 대한 방정식"으로 읽는다.
    // 조용히 넘기면 사용자가 재정의한 줄 알기 쉬우므로 그렇다고 알린다.
    obj.note = `${main.a.name} 는 이미 정의되어 있어서 이 줄은 방정식으로 읽었습니다. `
      + `다시 정의하려면 원래 줄을 고쳐 주세요.`;
  }
  if (looksLikeDef && !ctx.defs.has(main.a.name)) {
    const name = main.a.name;
    const params = main.a.args.map((p) => p.name);
    ctx.defs.set(name, { params, body: main.b, compiled: null });
    obj.kind = params.length === 1 ? 'function' : 'defined';
    obj.defName = name;
    obj.varName = params[0];
    obj.expr = main.b;
    obj.label = `${name}(${params.join(', ')}) = ${format(main.b)}`;
    if (params.length === 1) obj.fn = compile(main.b, ctx);
    if (params.length === 2) {
      obj.kind = 'defined';
      obj.detail = '2변수 함수로 등록했습니다. f(x,y)=0 처럼 방정식으로 쓰면 그래프가 그려집니다.';
    }
    return obj;
  }

  // ── 계산 정밀도 설정: precision = 50, digits = 20
  if (main.type === 'cmp' && main.op === '=' && main.a.type === 'var'
      && SETTING_NAMES.includes(main.a.name)) {
    const n = Math.round(compile(main.b, ctx)({}));
    const isDisplay = main.a.name === 'digits';
    const p = setPrecision(isDisplay ? { display: n } : { internal: n });
    obj.kind = 'setting';
    obj.label = isDisplay
      ? `화면에 ${p.display}자리까지 (내부 계산은 ${p.internal}자리)`
      : `내부 계산 ${p.internal}자리 (화면은 ${p.display}자리)`;
    obj.precision = p;
    return obj;
  }

  // ── 상수/슬라이더 정의: a = 3
  if (main.type === 'cmp' && main.op === '=' && main.a.type === 'var'
      && !['x', 'y', 'r'].includes(main.a.name) && freeVars(main.b).size === 0) {
    const name = main.a.name;
    ctx.defs.set(name, { params: [], body: main.b, compiled: null });
    obj.kind = 'constant';
    obj.defName = name;
    obj.value = compile(main.b, ctx)({});
    obj.label = `${name} = ${pretty(obj.value)}`;
    // 값을 손으로 끌어 볼 수 있게 슬라이더 범위를 붙인다.
    // "a = 2; 0 <= a <= 5" 처럼 직접 지정할 수 있고, 없으면 값에서 유추한다.
    const given = ranges.find((r) => r.name === name);
    obj.slider = given ? { min: given.range[0], max: given.range[1] }
      : defaultSliderRange(obj.value);
    obj.slider.step = niceStep((obj.slider.max - obj.slider.min) / 100);
    return obj;
  }

  // ── 접선·법선: tangent(f, 1), normal(x^2, 2)
  if (main.type === 'call' && ['tangent', 'normal'].includes(main.name)
      && main.args && main.args.length === 2) {
    const built = buildTangent(obj, main, ctx);
    if (built) return built;
  }

  // ── 정적분: integral(x^2, x, 0, 2) — 값만 내지 않고 넓이를 칠한다
  if (main.type === 'call' && main.name === 'integral' && main.args
      && (main.args.length === 3 || main.args.length === 4)) {
    const built = buildIntegral(obj, main, ctx);
    if (built) return built;
  }

  const vars = freeVars(main);
  vars.delete('and'); vars.delete('or');
  const known = new Set([...ctx.defs.keys(), ...ctx.seqs.keys()]);
  const free = new Set([...vars].filter((v) => !known.has(v)));

  // ── 점 (a, b) 또는 매개변수 곡선 (x(t), y(t))
  if (main.type === 'tuple' && main.items.length === 2) {
    if (free.size === 0) {
      const f = compile(main, ctx);
      const [x, y] = f({});
      // (x_1, y_1) 처럼 두 리스트를 짝지으면 점열이 된다
      if (Array.isArray(x) || Array.isArray(y)) {
        const xs = Array.isArray(x) ? x : null;
        const ys = Array.isArray(y) ? y : null;
        const n = Math.min(xs ? xs.length : Infinity, ys ? ys.length : Infinity);
        const pts = [];
        for (let i = 0; i < n; i++) {
          const px = xs ? xs[i] : x;
          const py = ys ? ys[i] : y;
          if (isFinite(px) && isFinite(py)) pts.push([px, py]);
        }
        obj.kind = 'points';
        obj.points = pts;
        obj.label = `점 ${pts.length}개`;
        return obj;
      }
      obj.kind = 'point';
      obj.points = [[x, y]];
      obj.label = `(${pretty(x)}, ${pretty(y)})`;
      // 좌표가 이름(슬라이더 상수)이면 점을 끌어 그 값을 바꿀 수 있다
      obj.dragVars = main.items.map((it) => {
        if (it.type !== 'var') return null;
        const d = ctx.defs.get(it.name);
        return d && d.params.length === 0 ? it.name : null;
      });
      if (!obj.dragVars.some(Boolean)) obj.dragVars = null;
      return obj;
    }
    const p = [...free][0];
    if (free.size === 1) {
      obj.kind = 'parametric';
      obj.varName = p;
      obj.fx = compile(main.items[0], ctx);
      obj.fy = compile(main.items[1], ctx);
      obj.label = `(${format(main.items[0])}, ${format(main.items[1])})`;
      obj.range = pickRange(ranges, p) || autoParametricRange(obj);
      return obj;
    }
  }

  // ── 점열/수열 리스트
  if (main.type === 'list') {
    if (main.items.every((it) => it.type === 'tuple' && it.items.length === 2)) {
      const f = compile(main, ctx);
      obj.kind = 'points';
      obj.points = f({});
      obj.label = `점 ${obj.points.length}개`;
      return obj;
    }
    if (free.size === 0) {
      const f = compile(main, ctx);
      obj.kind = 'sequence';
      obj.terms = f({});
      obj.n0 = 1;
      obj.name = 'a';
      obj.label = `수열 ${obj.terms.length}항`;
      return obj;
    }
  }

  // ── 극좌표 r = f(θ)
  if (main.type === 'cmp' && main.op === '=' && main.a.type === 'var' && main.a.name === 'r') {
    const inner = freeVars(main.b);
    if ([...inner].every((v) => ANGLE_VARS.has(v) || known.has(v))) {
      obj.kind = 'polar';
      obj.fr = compile(main.b, ctx);
      obj.varName = [...inner].find((v) => ANGLE_VARS.has(v)) || 'θ';
      obj.range = pickRange(ranges, obj.varName) || autoPolarRange(obj);
      obj.label = `r = ${format(main.b)}`;
      return obj;
    }
  }

  // ── 등식 ∧ 부등식 → 제한된 해집합 (반원, 선분, 부채꼴 경계 …)
  //
  // 부등식이 하나라도 끼면 전부 "영역"으로 읽던 탓에, x²+y²=4 ∧ x>0 이
  // 조건을 만족하는 점이 없는 영역으로 판정되어 빈 화면이 나왔다.
  // 등식이 함께 있으면 영역이 아니라 **조건이 걸린 곡선**이다.
  if (main.type === 'logic' && main.op === 'and' && isRegion(main)) {
    const eqs = collectEqs(main);
    const conds = collectEqs(main, true).filter((n) => n.op !== '=');
    if (eqs.length && conds.length) {
      const cond = conds.reduce((a, b) => (a ? { type: 'logic', op: 'and', a, b } : b), null);
      if (eqs.length === 1) {
        // 등식 하나 — 우변에 조건을 얹어 { } 제한과 똑같은 꼴로 만든다
        const restricted = {
          type: 'cmp', op: '=', a: eqs[0].a,
          b: { type: 'piece', cases: [{ cond, value: eqs[0].b }], otherwise: null },
        };
        classify(obj, [restricted], ctx);
        if (!obj.error) {
          obj.restricted = true;
          obj.label = format(main);
        }
        return obj;
      }
      // 등식이 여럿 — 연립해를 구한 뒤 조건으로 거른다
      const inner = eqs.reduce((a, b) => ({ type: 'logic', op: 'and', a, b }));
      classify(obj, [inner], ctx);
      if (!obj.error) {
        obj.filter = predicate(cond, ctx);
        obj.restricted = true;
        obj.label = format(main);
      }
      return obj;
    }
  }

  // ── 연립방정식 (등식 ∧ 등식) → 해는 점열
  if (main.type === 'logic' && main.op === 'and' && !isRegion(main)
      && collectEqs(main).length >= 2
      && [...free].every((v) => v === 'x' || v === 'y')) {
    obj.kind = 'system';
    obj.residuals = residualList(main, ctx);
    obj.vars = free;
    // y = f(x) 처럼 한 쪽으로 풀린 식이 끼어 있으면 대입해서 1변수 문제로 만든다.
    // 두 곡선을 각각 추적해 교점을 찾는 것보다 훨씬 빠르고 정확하다.
    const eqs = collectEqs(main);
    eqs.forEach((eq, i) => {
      if (obj.explicit) return;
      for (const [lhs, rhs, name, other] of [[eq.a, eq.b, 'y', 'x'], [eq.b, eq.a, 'y', 'x'],
        [eq.a, eq.b, 'x', 'y'], [eq.b, eq.a, 'x', 'y']]) {
        if (lhs.type === 'var' && lhs.name === name && !freeVars(rhs).has(name)) {
          obj.explicit = { solved: name, free: other, fn: compile(rhs, ctx), index: i };
          return;
        }
      }
    });
    // 변수가 하나뿐인 연립(sin x = 0 ∧ cos x = −1)은 곡선 교점이 아니라 공통근 문제다
    obj.oneVar = free.size <= 1 ? ([...free][0] || 'x') : null;
    obj.label = format(main);
    return obj;
  }

  // ── 등식들의 합집합 (A = B or C = D) → 각 해집합을 모두 그린다
  if (main.type === 'logic' && main.op === 'or' && !isRegion(main)) {
    const parts = collectEqs(main);
    if (parts.length >= 2) {
      obj.kind = 'union';
      obj.children = parts.map((ast) => {
        const child = { kind: 'unknown', error: null, label: format(ast) };
        try { classify(child, [ast], ctx); } catch (e) { child.error = e.message; }
        return child;
      });
      obj.label = format(main);
      return obj;
    }
  }

  // ── 부등식 / 논리 결합 → 영역
  if (isRegion(main)) {
    obj.kind = 'region';
    obj.pred = predicate(main, ctx);
    obj.boundaries = collectEqs(main, true).map((e) => residual(e, ctx));
    obj.label = format(main);
    return obj;
  }

  // ── 등식
  if (main.type === 'cmp' && main.op === '=') {
    // y = f(x)
    if (main.a.type === 'var' && main.a.name === 'y' && !freeVars(main.b).has('y')) {
      obj.kind = 'function';
      obj.varName = 'x';
      obj.expr = main.b;
      obj.fn = compile(main.b, ctx);
      obj.label = `y = ${format(main.b)}`;
      return obj;
    }
    // x = f(y)
    if (main.a.type === 'var' && main.a.name === 'x' && !freeVars(main.b).has('x')) {
      obj.kind = 'functionY';
      obj.varName = 'y';
      obj.expr = main.b;
      obj.fn = compile(main.b, ctx);
      obj.label = `x = ${format(main.b)}`;
      return obj;
    }
    if (free.has('x') && free.has('y')) {
      const extra = [...free].filter((v) => v !== 'x' && v !== 'y');
      if (extra.length) {
        obj.kind = 'error';
        obj.error = `정해지지 않은 기호가 있습니다: ${extra.join(', ')}. `
          + `'${extra[0]} = 1' 처럼 값을 먼저 정의해 주세요.`;
        return obj;
      }
      obj.kind = 'implicit';
      obj.f = residual(main, ctx);
      {
        const st = stripRestriction(main);
        obj.exprAst = st.ast;
        if (st.restricted) obj.restricted = true;
      }
      obj.label = format(main);
      return obj;
    }
    // 한 변수 방정식 → 해가 점열
    if (free.size === 1) {
      const v = [...free][0];
      obj.kind = 'equation1d';
      obj.varName = v;
      obj.f = residual(main, ctx);
      {
        const st = stripRestriction(main);
        obj.exprAst = st.ast;
        if (st.restricted) obj.restricted = true;
      }
      obj.label = format(main);
      return obj;
    }
    if (free.size === 0) {
      const r = residual(main, ctx)({});
      obj.kind = 'statement';
      obj.label = `${format(main)} → ${Math.abs(r) < 1e-12 ? '참' : '거짓'}`;
      return obj;
    }
  }

  // ── 순수 식
  if (free.size === 0) {
    obj.kind = 'value';
    evaluateValue(obj, main, ctx);
    return obj;
  }
  if (free.size === 1 && (free.has('x') || known.size >= 0)) {
    const v = [...free][0];
    obj.kind = 'function';
    obj.varName = v;
    obj.expr = main;
    obj.fn = compile(main, ctx);
    obj.label = `y = ${format(main)}`;
    if (v !== 'x') obj.substitute = v;
    return obj;
  }
  if (free.has('x') && free.has('y')) {
    const eq = { type: 'cmp', op: '=', a: main, b: { type: 'num', value: 0 } };
    obj.kind = 'implicit';
    obj.f = residual(eq, ctx);
    obj.exprAst = eq;
    obj.label = `${format(main)} = 0`;
    return obj;
  }

  obj.kind = 'unknown';
  obj.error = '어떤 그래프인지 판단하지 못했습니다.';
  return obj;
}

/** "a <= t <= b" 를 [a, b] 범위로 해석 (매개변수 범위·슬라이더 범위에 함께 쓰인다) */
function asRange(node) {
  if (node.type !== 'logic' || node.op !== 'and') return null;
  const { a, b } = node;
  if (a.type !== 'cmp' || b.type !== 'cmp') return null;
  const varOf = (n) => (n.type === 'var' ? n.name : null);
  const name = varOf(a.b) || varOf(b.a);
  if (!name) return null;
  const ctx0 = makeContext();
  const num = (n) => {
    try {
      const v = compile(n, ctx0)({});
      return typeof v === 'number' && isFinite(v) ? v : null;
    } catch { return null; }
  };
  const lo = num(a.a);
  const hi = num(b.b);
  if (lo === null || hi === null || !(hi > lo)) return null;
  return { name, range: [lo, hi] };
}

/** 슬라이더 기본 범위: 값의 크기에 맞춰 대칭 구간을 잡는다 */
function defaultSliderRange(v) {
  if (!isFinite(v)) return { min: -10, max: 10 };
  let hi = niceStep(Math.max(1, Math.abs(v) * 2));
  while (hi < Math.abs(v)) hi = niceStep(hi * 2);
  return { min: v < 0 ? -hi : 0, max: hi };
}

function niceStep(rough) {
  if (!(rough > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const r = rough / p;
  return (r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10) * p;
}

function pickRange(ranges, name) {
  const hit = ranges.find((r) => r.name === name) || ranges[0];
  return hit ? hit.range : null;
}

/** 극좌표 r(θ) 의 주기를 찾아 한 바퀴가 온전히 그려지는 범위를 고른다 */
function autoPolarRange(obj) {
  const v = obj.varName;
  const r = (t) => obj.fr({ [v]: t });
  for (let k = 1; k <= 8; k++) {
    const T = 2 * Math.PI * k;
    let ok = true;
    for (let i = 0; i <= 24; i++) {
      const t = (2 * Math.PI * i) / 24;
      const a = r(t), b = r(t + T);
      if (!isFinite(a) && !isFinite(b)) continue;
      if (!isFinite(a) || !isFinite(b) || Math.abs(a - b) > 1e-7 * Math.max(1, Math.abs(a))) {
        ok = false; break;
      }
    }
    if (ok) return [0, T];
  }
  return [0, 8 * Math.PI];        // 나선처럼 주기가 없으면 여러 바퀴를 그린다
}

/** 매개변수 곡선이 [0,2π] 에서 닫히면 그대로, 아니면 넉넉한 범위 */
function autoParametricRange(obj) {
  const v = obj.varName;
  const at = (t) => [obj.fx({ [v]: t }), obj.fy({ [v]: t })];
  const p0 = at(0);
  const p1 = at(2 * Math.PI);
  const closed = p0.every(isFinite) && p1.every(isFinite)
    && Math.hypot(p0[0] - p1[0], p0[1] - p1[1]) < 1e-7 * (1 + Math.hypot(...p0));
  return closed ? [0, 2 * Math.PI] : [-4 * Math.PI, 4 * Math.PI];
}

/** 점화식이 자기 이전 항을 참조하는지 */
function referencesEarlier(node, name, idxVar) {
  let found = false;
  (function walk(n) {
    if (!n || typeof n !== 'object' || found) return;
    if (n.type === 'index' && n.base.type === 'var' && n.base.name === name) {
      if (!(n.index.type === 'var' && n.index.name === idxVar)) found = true;
    }
    for (const k of ['a', 'b', 'base', 'index']) if (n[k]) walk(n[k]);
    for (const k of ['args', 'items']) if (n[k]) n[k].forEach(walk);
  })(node);
  return found;
}

/**
 * `{조건}` 제한을 벗겨 낸 식.
 * 반원도 원의 일부이므로, 종류를 따질 때는 조건을 떼고 본래 식을 본다.
 * 조건이 붙어 있었으면 두 번째 값으로 알린다.
 */
export function stripRestriction(node) {
  let found = false;
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'piece' && n.cases.length === 1 && !n.otherwise && n.cases[0].value) {
      found = true;
      return walk(n.cases[0].value);
    }
    if (n.type === 'piece') return n;                 // 조각별 식은 그대로 둔다
    const out = { ...n };
    for (const k of ['a', 'b', 'arg']) if (n[k] && n[k].type) out[k] = walk(n[k]);
    if (Array.isArray(n.args)) out.args = n.args.map(walk);
    return out;
  };
  const ast = walk(node);
  return { ast, restricted: found };
}

/**
 * 값을 세 층으로 구한다.
 *   1. 정확값 — 유리수·근호·π 를 그대로 (0.1+0.2 = 3/10, √2² = 2)
 *   2. 고정밀 수치 — 정확값이 없으면 자릿수를 늘려 (sin 1 = 0.841470984807896506652…)
 *   3. 배정밀도 — 그마저 안 되면 기존 계산기로
 * 화면에는 표시 자릿수만큼만 적지만, 안에는 내부 자릿수만큼 남겨 둔다.
 * 표시하려고 반올림한 값이 다음 계산에 흘러들지 않게 하려는 것이다.
 */
export function evaluateValue(obj, main, ctx) {
  const consts = exactValueConstants(ctx);
  const ip = internalDigits();
  const dp = displayDigits();
  let exact = null;
  try { exact = toExact(main, consts); } catch { exact = null; }
  const float = compile(main, ctx)({});
  obj.value = float;
  obj.exact = exact;

  if (exact) {
    const big = exact.toBig(ip);
    obj.big = big;
    obj.value = big ? big.toNumber() : float;
    obj.exactText = exact.toString();
    obj.approxText = big ? big.toString(dp) : pretty(float);
    // 정수는 근삿값을 덧붙이지 않는다 (2^100 ≈ 1.27e30 은 알려 줄 것이 없다)
    const r = exact.asRat;
    const same = obj.exactText === obj.approxText || (r && r.isInt);
    obj.label = `${format(main)} = ${obj.exactText}${same ? '' : `  ≈ ${obj.approxText}`}`;
    obj.valueKind = 'exact';
    return obj;
  }

  let big = null;
  try { big = evalBig(main, consts, ip); } catch { big = null; }
  if (big) {
    obj.big = big;
    obj.value = big.toNumber();
    obj.approxText = big.toString(dp);
    obj.label = `${format(main)} = ${obj.approxText}`;
    obj.valueKind = 'big';
    return obj;
  }
  obj.approxText = pretty(float);
  obj.label = `${format(main)} = ${obj.approxText}`;
  obj.valueKind = 'float';
  return obj;
}

/** 이름 → 정확값 (정확값 계산에 넘기기 위해) */
export function exactValueConstants(ctx) {
  const out = new Map();
  for (const [name, def] of ctx.defs) {
    if (def.params.length !== 0 || !def.body) continue;
    let v = null;
    try { v = toExact(def.body, out); } catch { v = null; }
    if (v) out.set(name, v);
  }
  return out;
}

/** 값이 정해진 이름들을 정확한 유리수로 (기호 계산에 넘기기 위해) */
export function exactConstants(ctx) {
  const out = new Map();
  for (const [name, def] of ctx.defs) {
    if (def.params.length !== 0 || !def.body) continue;
    if (def.body.type !== 'num' || def.body.sym) continue;
    const r = ratFromNumber(def.body.value);
    if (r) out.set(name, r);
  }
  return out;
}

/** 식을 x·y 에 대한 다항식으로 (슬라이더 값은 유리수로 대입). 아니면 null */
export function polyOf(obj, ctx, vars = ['x', 'y']) {
  if (!obj || !obj.exprAst) return null;
  return toPoly(obj.exprAst, vars, exactConstants(ctx));
}

/**
 * 파라미터 훑기에 넘길 기호 계산 고리.
 *   exactAt   — 분류가 갈리는 파라미터 값을 방정식을 풀어 미리 구해 둔 것
 *   exactKind — 파라미터 값마다 이차곡선의 종류를 식에서 바로 판정하는 함수
 * 훑기가 표본으로 짐작하던 자리를 정확한 값으로 바꿔 준다.
 */
export function sweepHooks(objects, ctx, param) {
  const consts = exactConstants(ctx);
  consts.delete(param);            // 훑는 파라미터는 값이 아니라 문자로 남겨 둔다
  const exactAt = [];
  for (const o of objects) {
    if ((o.kind === 'function' || o.kind === 'functionY') && o.expr) {
      // y = f(x) 꼴 — 실근·극값 개수가 바뀌는 자리를 종결식으로
      const v = o.varName || 'x';
      const fp = toPoly(o.expr, [v, param], consts);
      const list = fp ? familyTransitions(fp, param, v) : null;
      if (list) exactAt.push(...list);
      continue;
    }
    if (!o.exprAst) continue;
    const poly = toPoly(o.exprAst, ['x', 'y', param], consts);
    if (!poly) continue;
    // 이차곡선이면 판별식으로, 그보다 높은 차수면 곡선이 특이해지는 자리로
    const list = conicTransitions(poly, param) || singularTransitions(poly, param);
    if (list) exactAt.push(...list);
  }
  // 종류를 문자열로 돌려준다. 다항식이지만 3차 이상이면 false —
  // "모른다" 가 아니라 "이차곡선이 아님이 확실하다" 는 뜻이다.
  // 그러지 않으면 데카르트의 잎 x³+y³=axy 를 표본에 맞춰 보고
  // "두 평행선" 이라고 우기게 된다.
  const exactKind = (obj) => {
    const poly = polyOf(obj, ctx);
    if (!poly) return null;
    if (poly.degree > 2) return false;
    const c = classifyConicExact(poly);
    return c ? c.kind : false;
  };
  return { exactAt, exactKind };
}

/** 이 식이 주어진 이름(슬라이더 등)에 기대고 있는가 */
export function dependsOn(obj, name) {
  if (!obj || !obj.asts) return false;
  for (const ast of obj.asts) {
    if (freeVars(ast).has(name)) return true;
  }
  return false;
}

/** 식이 참조하지만 아직 정의되지 않은 이름들 */
export function missingRefs(obj, ctx) {
  const out = new Set();
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'call' && !isBuiltin(n.name) && !ctx.defs.has(n.name) && !ctx.seqs.has(n.name)) {
      out.add(n.name);
    }
    if (n.type === 'var' && !['x', 'y', 'r', 'n', 'k', 't', 'θ'].includes(n.name)
        && !ctx.defs.has(n.name) && !ctx.seqs.has(n.name)) {
      seen.add(n.name);
    }
    for (const k of ['a', 'b', 'base', 'index']) if (n[k]) walk(n[k]);
    for (const k of ['args', 'items']) if (n[k]) n[k].forEach(walk);
  })(obj.asts ? obj.asts[obj.asts.length - 1] : null);
  return [...out];
}

function collectEqs(node, includeIneq = false) {
  const out = [];
  (function walk(n) {
    if (n.type === 'logic') { walk(n.a); walk(n.b); return; }
    if (n.type === 'cmp' && (n.op === '=' || includeIneq)) out.push(n);
  })(node);
  return out;
}

function isRegion(node) {
  if (node.type === 'cmp') return node.op !== '=';
  if (node.type === 'logic') return isRegion(node.a) || isRegion(node.b);
  return false;
}

// ── 회귀 ────────────────────────────────────────────────────
/**
 * y_1 ~ a·x_1 + b 꼴의 회귀.
 * 정의되지 않은 이름을 미지의 계수로 보고 Levenberg–Marquardt 로 맞춘 뒤,
 * 찾은 값을 ctx 에 등록해 다른 식에서도 쓸 수 있게 한다.
 */
function buildRegression(obj, main, ctx) {
  const evalNode = (n) => compile(n, ctx)({});
  const observed = evalNode(main.a);
  if (!Array.isArray(observed) || observed.length < 2) {
    obj.kind = 'error';
    obj.error = '회귀는 왼쪽에 자료 리스트가 있어야 합니다. 예: y_1 ~ a x_1 + b';
    return obj;
  }
  // 아직 정의되지 않은 이름 = 맞출 계수.
  // 앞선 회귀가 정해 둔 계수는 다시 미지수로 본다 (같은 회귀를 고쳐 쓸 수 있어야 하므로)
  const params = [...freeVars(main.b)].filter((v) => {
    if (['x', 'y'].includes(v)) return false;
    const d = ctx.defs.get(v);
    return !d || d.fromRegression;
  });
  if (!params.length) {
    obj.kind = 'error';
    obj.error = '맞출 계수가 없습니다. a, b 처럼 아직 정의하지 않은 이름을 써 주세요.';
    return obj;
  }
  const model = compile(main.b, ctx);
  const predict = (values) => {
    const env = Object.create(null);
    params.forEach((p, i) => { env[p] = values[i]; });
    const out = model(env);
    return Array.isArray(out) ? out : observed.map(() => out);
  };
  const residual = (values) => {
    const pred = predict(values);
    const n = Math.min(pred.length, observed.length);
    const r = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = pred[i] - observed[i];
      if (!isFinite(d)) return null;
      r[i] = d;
    }
    return r;
  };
  const fit = levenbergMarquardt(residual, params.map(() => 1));
  if (!fit) {
    obj.kind = 'error';
    obj.error = '회귀가 수렴하지 않았습니다. 계수의 개수나 모형을 확인해 주세요.';
    return obj;
  }
  params.forEach((p, i) => {
    ctx.defs.set(p, {
      params: [], body: { type: 'num', value: fit.params[i] }, compiled: null, fromRegression: true,
    });
  });
  const mean = observed.reduce((a, b) => a + b, 0) / observed.length;
  const sst = observed.reduce((a, b) => a + (b - mean) ** 2, 0);
  obj.kind = 'regression';
  obj.params = params;
  obj.values = fit.params;
  obj.r2 = sst > 0 ? 1 - fit.cost / sst : 1;
  obj.rmse = Math.sqrt(fit.cost / observed.length);
  obj.count = observed.length;
  obj.observed = observed;
  obj.predicted = predict(fit.params);
  obj.label = `${format(main)}  →  `
    + params.map((p, i) => `${p} = ${tn(fit.params[i], 6)}`).join(', ');
  return obj;
}

// ── 미적분 ──────────────────────────────────────────────────
/** 식 안의 변수 v 를 다른 식으로 바꿔 끼운다 */
function substAst(node, v, repl) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'var' && n.name === v) return repl;
    const out = { ...n };
    for (const k of ['a', 'b']) if (n[k] && n[k].type) out[k] = walk(n[k]);
    if (Array.isArray(n.args)) out.args = n.args.map(walk);
    if (Array.isArray(n.items)) out.items = n.items.map(walk);
    if (Array.isArray(n.cases)) {
      out.cases = n.cases.map((c) => ({ cond: walk(c.cond), value: walk(c.value) }));
      out.otherwise = walk(n.otherwise);
    }
    return out;
  };
  return walk(node);
}

const NUM = (v) => ({ type: 'num', value: v });
const BIN = (op, a, b) => ({ type: 'bin', op, a, b });

/**
 * 접선·법선.
 * 값을 그때그때 숫자로 굳히지 않고 **식으로** 세운다. 그래야 슬라이더를 움직이면
 * 접선도 따라 움직인다.  y = f′(a)·(x − a) + f(a)
 */
function buildTangent(obj, main, ctx) {
  const [target, atAst] = main.args;
  let body = target;
  let v = 'x';
  // tangent(f, 1) 처럼 이름만 주면 그 함수의 본체를 꺼내 쓴다
  const named = (target.type === 'var' || target.type === 'call') && ctx.defs.get(target.name);
  if (named && named.params.length === 1) {
    body = named.body;
    v = named.params[0];
  }

  const d1 = derivative(body, v);
  if (!d1) {
    obj.kind = 'error';
    obj.error = '이 식은 미분할 수 없어 접선을 그릴 수 없습니다.';
    return obj;
  }
  const y0 = substAst(body, v, atAst);
  const m0 = substAst(d1, v, atAst);
  const isTangent = main.name === 'tangent';
  const slope = isTangent ? m0 : BIN('/', NUM(-1), m0);
  const lineAst = BIN('+', BIN('*', slope, BIN('-', { type: 'var', name: 'x' }, atAst)), y0);

  obj.kind = 'tangent';
  obj.varName = 'x';
  obj.expr = lineAst;
  obj.fn = compile(lineAst, ctx);
  obj.slopeFn = compile(slope, ctx);
  obj.atFn = compile(atAst, ctx);
  obj.yFn = compile(y0, ctx);
  obj.tangentKind = isTangent ? '접선' : '법선';
  obj.baseLabel = format(body);
  obj.label = `${obj.tangentKind}: ${format(body)} 의 ${v} = ${format(atAst)} 에서`;
  return obj;
}

/** 정적분 — 값과 함께 넓이를 칠한다 */
function buildIntegral(obj, main, ctx) {
  const a = main.args;
  const hasVar = a.length === 4;
  const v = hasVar && a[1].type === 'var' ? a[1].name : 'x';
  const body = a[0];
  if (freeVars(body).size && ![...freeVars(body)].every(
    (n) => n === v || ctx.defs.has(n) || ctx.seqs.has(n))) return null;

  obj.kind = 'integral';
  obj.varName = v;
  obj.expr = body;
  obj.fn = compile(body, ctx);
  obj.loFn = compile(a[hasVar ? 2 : 1], ctx);
  obj.hiFn = compile(a[hasVar ? 3 : 2], ctx);
  obj.valueFn = compile(main, ctx);
  obj.value = obj.valueFn({});
  obj.label = `∫ ${format(body)} d${v} = ${pretty(obj.value)}`;
  return obj;
}

// ── 수열 ────────────────────────────────────────────────────
function buildSequence(obj, asts, ctx) {
  const defs = asts.filter((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index');
  // 어느 것이 점화식이고 어느 것이 초기값인지는 **첨자의 모양**으로 가른다.
  // 자리로 가르면 "a_n = a_{n−1} + a_{n−2}; a_1 = 1; a_2 = 1" 처럼 점화식을 먼저 쓴
  // 경우에 a_2 = 1 을 규칙으로 읽어 상수 수열이 되어 버린다.
  const rules = defs.filter((d) => d.a.index.type !== 'num');
  const main = rules.length ? rules[rules.length - 1] : defs[defs.length - 1];
  const name = main.a.base.type === 'var' ? main.a.base.name : 'a';
  const idxVar = main.a.index.type === 'var' ? main.a.index.name : 'n';

  const seeds = new Map();
  for (const d of defs) {
    if (d !== main && d.a.index.type === 'num') seeds.set(d.a.index.value, compile(d.b, ctx)({}));
  }
  // a_{n+1} = … 형태면 인덱스를 한 칸 당겨 a_n 기준으로 맞춘다
  let shift = 0;
  if (main.a.index.type === 'bin' && main.a.index.a.type === 'var') {
    const s = main.a.index.b.type === 'num' ? main.a.index.b.value : 0;
    shift = main.a.index.op === '+' ? s : -s;
  }

  const cache = new Map(seeds);
  const base = seeds.size ? Math.min(...seeds.keys()) : 1;
  const entry = {
    values: cache,
    get(n) {
      const k = Math.round(n);
      if (!isFinite(k)) return NaN;
      if (cache.has(k)) return cache.get(k);
      if (k < base - 50 || k > 100000) return NaN;
      // 재귀 대신 낮은 항부터 차례로 채운다.
      // a_50000 같은 요청에서도 호출 스택이 넘치지 않는다.
      const start = Math.max(base, lowestMissing(cache, base, k));
      for (let i = start; i <= k; i++) {
        if (cache.has(i)) continue;
        cache.set(i, NaN);                    // 자기참조 차단용 임시값
        const env = Object.create(null);
        env[idxVar] = i - shift;
        cache.set(i, body(env));
      }
      return cache.get(k);
    },
  };
  const lowestMissing = (map, from, upto) => {
    for (let i = from; i <= upto; i++) if (!map.has(i)) return i;
    return upto;
  };
  ctx.seqs.set(name, entry);
  const body = compile(main.b, ctx);

  obj.kind = 'sequence';
  obj.name = name;
  obj.seq = entry;
  obj.n0 = seeds.size ? Math.min(...seeds.keys()) : 1;
  obj.label = asts.map(format).join(';  ');
  obj.terms = null;   // 계산은 compute 에서
  obj.count = 25;
  if (!seeds.size && referencesEarlier(main.b, name, idxVar)) {
    obj.note = `${name}_1 = … 처럼 초기값을 함께 주어야 항이 정해집니다. `
      + `세미콜론으로 이어 쓰세요: "${name}_1 = 1; ${format(main)}"`;
  }
  return obj;
}

// ── 해집합 계산 ─────────────────────────────────────────────
/**
 * 현재 보이는 영역에 맞춰 객체의 그릴 거리를 계산한다.
 * @returns {{polylines?:number[][], points?:number[][], mask?:object, labels?:Array}}
 */
export function computeObject(obj, bounds, opts = {}) {
  const b = bounds;
  switch (obj.kind) {
    case 'union2': {
      return { polylines: [], points: [] };
    }
    case 'function': {
      const v = obj.substitute || 'x';
      const f = (x) => obj.fn({ [v]: x });
      // 값이 리스트면 (y = [1,2,3]x 처럼) 한 번에 여러 곡선을 그린다.
      // 정의역이 제한된 식은 가운데 한 점만 봐서는 알 수 없으므로 여러 곳을 짚어 본다.
      let probe = null;
      for (let i = 0; i <= 12 && !probe; i++) {
        const v0 = f(b.xmin + ((b.xmax - b.xmin) * i) / 12);
        if (Array.isArray(v0)) probe = v0;
      }
      if (probe) {
        const out = [];
        for (let k = 0; k < Math.min(probe.length, 40); k++) {
          const fk = (x) => {
            const val = obj.fn({ [v]: x });
            return Array.isArray(val) ? val[k] : val;
          };
          out.push(...sampleFunction(fk, b.xmin, b.xmax, { ymin: b.ymin, ymax: b.ymax }).polylines);
        }
        return { polylines: out, points: [], branches: probe.length };
      }
      const r = sampleFunction(f, b.xmin, b.xmax, { ymin: b.ymin, ymax: b.ymax });
      return { polylines: r.polylines, points: [] };
    }
    case 'tangent': {
      const x0 = obj.atFn({});
      const y0 = obj.yFn({});
      const m = obj.slopeFn({});
      const pts = isFinite(x0) && isFinite(y0) ? [[x0, y0]] : [];
      // f′(a) = 0 인 자리의 법선처럼 기울기가 무한하면 세로선이 된다
      if (pts.length && !isFinite(m)) {
        const eq = `x = ${pretty(x0)}`;
        return {
          polylines: [[x0, b.ymin, x0, b.ymax]], points: pts, isolated: pts,
          labels: [{ x: x0, y: y0, text: eq }], equation: eq, slope: Infinity, at: x0,
        };
      }
      const f = (x) => obj.fn({ x });
      const r = sampleFunction(f, b.xmin, b.xmax, { ymin: b.ymin, ymax: b.ymax });
      const eq = isFinite(m) && isFinite(y0)
        ? `y = ${coefLine(m, x0, y0)}` : '기울기를 구할 수 없습니다';
      return {
        polylines: r.polylines, points: pts, isolated: pts,
        labels: pts.length ? [{ x: x0, y: y0, text: eq }] : [],
        equation: eq, slope: m, at: x0,
      };
    }
    case 'integral': {
      const lo = obj.loFn({});
      const hi = obj.hiFn({});
      const v = obj.varName;
      const f = (t) => obj.fn({ [v]: t });
      if (!isFinite(lo) || !isFinite(hi)) return { polylines: [], points: [] };
      const [a0, b0] = lo <= hi ? [lo, hi] : [hi, lo];
      const r = sampleFunction(f, a0, b0, { ymin: b.ymin, ymax: b.ymax });
      // 곡선과 x 축 사이를 닫아 다각형으로 만든다
      const fills = r.polylines.map((line) => {
        const poly = [line[0], 0, ...line, line[line.length - 2], 0];
        return poly;
      });
      const value = obj.valueFn({});
      const mid = (a0 + b0) / 2;
      return {
        polylines: r.polylines, points: [], areaFill: fills,
        labels: [{ x: mid, y: f(mid) / 2, text: `${pretty(value)}` }],
        value,
      };
    }
    case 'functionY': {
      const r = sampleFunction((y) => obj.fn({ y }), b.ymin, b.ymax, { ymin: b.xmin, ymax: b.xmax });
      return { polylines: r.polylines.map(swapXY), points: [] };
    }
    case 'implicit': {
      const r = traceImplicit((x, y) => obj.f({ x, y }), b, opts);
      return {
        polylines: r.polylines, points: r.points, isolated: r.points,
        empty: !r.polylines.length && !r.points.length,
        dense: r.points.length > 400, total: r.points.length,
      };
    }
    case 'region': {
      // 화면 폭에 맞춰 채우기 해상도를 정한다(픽셀 3칸당 1셀)
      const cols = Math.max(160, Math.min(420, Math.round((b.width || 800) / 3)));
      const mask = regionMask((x, y) => obj.pred({ x, y }), b, cols);
      const polylines = [];
      for (const bf of obj.boundaries) {
        const t = traceImplicit((x, y) => bf({ x, y }), b, { ...opts, findIsolated: false });
        polylines.push(...t.polylines);
      }
      return { mask, polylines, dash: [6, 4], points: [] };
    }
    case 'system': {
      // 조건이 걸린 연립(x²+y²=4 ∧ y=x ∧ x>0)은 해를 구한 뒤 조건으로 거른다
      const keep = obj.filter
        ? (r) => {
          const points = (r.points || []).filter(([x, y]) => obj.filter({ x, y }));
          return { ...r, points, isolated: points, empty: points.length === 0 };
        }
        : (r) => r;
      if (obj.oneVar) {
        const v = obj.oneVar;
        const lo = v === 'y' ? b.ymin : b.xmin;
        const hi = v === 'y' ? b.ymax : b.xmax;
        const roots = intersectRoots(obj.residuals.map((f) => (t) => f({ [v]: t })), lo, hi);
        const pts = roots.map((t) => (v === 'y' ? [0, t] : [t, 0]));
        return keep({ points: pts, isolated: pts, polylines: [], empty: pts.length === 0 });
      }
      const fns = obj.residuals.map((f) => (x, y) => f({ x, y }));

      if (obj.explicit) {
        // 대입해서 1변수 방정식으로 푼다
        const { solved, free: fv, fn, index } = obj.explicit;
        const lo = fv === 'y' ? b.ymin : b.xmin;
        const hi = fv === 'y' ? b.ymax : b.xmax;
        const others = obj.residuals.filter((_, i) => i !== index);
        const pointAt = (t) => {
          const env = { [fv]: t };
          env[solved] = fn(env);
          return env;
        };
        const g0 = (t) => {
          const env = pointAt(t);
          return others[0] ? others[0](env) : 0;
        };
        const roots = solve1D(g0, lo, hi, 4000).map(([t]) => t);
        const scale = Math.max(b.xmax - b.xmin, b.ymax - b.ymin);
        const pts = [];
        for (const t of roots) {
          const env = pointAt(t);
          if (!others.every((r) => Math.abs(r(env)) < 1e-7 * Math.max(1, scale))) continue;
          const p = [env.x, env.y];
          if (!isFinite(p[0]) || !isFinite(p[1])) continue;
          if (pts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < scale * 1e-6)) continue;
          pts.push(p);
        }
        return keep({
          points: pts, isolated: pts, polylines: [], empty: pts.length === 0, ghost: true,
        });
      }

      const s = fns.length === 2
        ? solveSystem2D(fns[0], fns[1], b, opts)
        : solveSystemN(fns, b, opts);
      return keep({
        points: s.points,
        polylines: s.curves.flatMap((c) => c.polylines),
        ghost: true,
        isolated: s.points,
        empty: s.points.length === 0,
      });
    }
    case 'union': {
      const out = { polylines: [], points: [], isolated: [] };
      for (const child of obj.children || []) {
        if (child.error) continue;
        const d = computeObject(child, bounds, opts);
        out.polylines.push(...(d.polylines || []));
        out.points.push(...(d.points || []));
        out.isolated.push(...(d.isolated || []));
      }
      out.empty = !out.polylines.length && !out.points.length;
      return out;
    }
    case 'equation1d': {
      const v = obj.varName;
      const lo = v === 'y' ? b.ymin : b.xmin;
      const hi = v === 'y' ? b.ymax : b.xmax;
      const SAMPLES = 4000;
      const roots = solve1D((t) => obj.f({ [v]: t }), lo, hi, SAMPLES);
      const pts = v === 'y' ? roots.map(([t]) => [0, t]) : roots;
      // 표본 간격마다 근이 하나씩 잡히는 수준이면 해가 화면 해상도보다 촘촘하다는 뜻.
      // 이때 보이는 점들은 전체 해의 일부일 뿐이므로 그렇다고 밝힌다.
      const dense = pts.length > SAMPLES / 20;
      return {
        points: dense ? pts.filter((_, i) => i % Math.ceil(pts.length / 200) === 0) : pts,
        isolated: pts, polylines: [], empty: pts.length === 0, dense, total: pts.length,
      };
    }
    case 'point':
    case 'points':
      return { points: obj.points, isolated: obj.points, polylines: [] };
    case 'pointseq': {
      const [lo, hi] = obj.nRange || [obj.n0, obj.n0 + 19];
      const v = obj.varName;
      const pts = [];
      for (let n = lo; n <= hi && pts.length < 400; n++) {
        const x = obj.fx({ [v]: n });
        const y = obj.fy({ [v]: n });
        if (isFinite(x) && isFinite(y)) pts.push([x, y]);
      }
      obj.points = pts;
      return { points: pts, isolated: pts, polylines: [], empty: pts.length === 0 };
    }
    case 'sequence': {
      const terms = sequenceTerms(obj, b);
      obj.terms = terms;
      const pts = terms.map((v, i) => [obj.n0 + i, v]).filter((p) => isFinite(p[1]));
      return { points: pts, isolated: pts, polylines: [], stems: true };
    }
    case 'parametric': {
      const [t0, t1] = obj.range;
      const v = obj.varName;
      const r = sampleParametric(
        (t) => obj.fx({ [v]: t }), (t) => obj.fy({ [v]: t }), t0, t1, paramOpts(b, t0, t1),
      );
      return { polylines: r.polylines, points: [] };
    }
    case 'polar': {
      const [t0, t1] = obj.range;
      const v = obj.varName;
      const r = samplePolar((t) => obj.fr({ [v]: t }), t0, t1, paramOpts(b, t0, t1));
      return { polylines: r.polylines, points: [] };
    }
    default:
      return { polylines: [], points: [] };
  }
}

/** |f| 의 적분 — 부호 있는 넓이와 견주기 위한 것 */
function adaptiveAbsArea(obj, lo, hi) {
  if (!isFinite(lo) || !isFinite(hi) || lo === hi) return null;
  const v = obj.varName;
  const N = 2000;
  const h = (hi - lo) / N;
  let s = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(obj.fn({ [v]: lo + i * h }));
    const m = Math.abs(obj.fn({ [v]: lo + (i + 0.5) * h }));
    const b = Math.abs(obj.fn({ [v]: lo + (i + 1) * h }));
    if (!isFinite(a) || !isFinite(m) || !isFinite(b)) return null;
    s += ((a + 4 * m + b) * h) / 6;
  }
  return Math.abs(s);
}

/** y = m(x − x0) + y0 를 정리해 적는다 */
function coefLine(m, x0, y0) {
  const b = y0 - m * x0;
  if (Math.abs(m) < 1e-12) return pretty(y0);
  if (Math.abs(b) < 1e-12) return coefX(m);
  return `${coefX(m)} ${b < 0 ? '-' : '+'} ${pretty(Math.abs(b))}`;
}

/** m·x 를 적는다. 분수는 -1/2x 가 아니라 -x/2 로 — 앞의 것은 -1/(2x) 로 읽힌다 */
function coefX(m) {
  if (Math.abs(m - 1) < 1e-12) return 'x';
  if (Math.abs(m + 1) < 1e-12) return '-x';
  const t = pretty(m);
  const slash = t.indexOf('/');
  if (slash < 0) return `${t}x`;
  const p = t.slice(0, slash);
  const q = t.slice(slash + 1);
  const head = p === '1' ? 'x' : p === '-1' ? '-x' : `${p}x`;
  return `${head}/${q}`;
}

/** 매개변수 표본화 옵션: 화면 크기로 정밀도를, 매개변수 폭으로 표본 수를 정한다 */
function paramOpts(b, t0, t1) {
  const turns = Math.max(1, (t1 - t0) / (2 * Math.PI));
  return {
    samples: Math.min(6000, Math.round(400 * turns)),
    xmin: b.xmin, xmax: b.xmax, ymin: b.ymin, ymax: b.ymax,
  };
}

function swapXY(line) {
  const out = new Array(line.length);
  for (let i = 0; i < line.length; i += 2) { out[i] = line[i + 1]; out[i + 1] = line[i]; }
  return out;
}

function sequenceTerms(obj, bounds) {
  if (obj.terms && !obj.seq) return obj.terms;
  const count = Math.max(12, Math.min(60, Math.ceil((bounds?.xmax ?? 25) - obj.n0 + 2)));
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = obj.seq ? obj.seq.get(obj.n0 + i) : NaN;
    out.push(v);
  }
  return out;
}

/**
 * 화면에 그려진 곡선들끼리의 교점.
 * 폴리라인 교차로 후보를 잡고, 두 식이 모두 잔차 함수를 갖고 있으면 뉴턴법으로 정련한다.
 */
export function intersectionsOf(objects, bounds) {
  const curves = objects.filter((o) =>
    o.visible !== false && o.data && (o.data.polylines || []).length
    && ['function', 'functionY', 'implicit', 'polar', 'parametric', 'union'].includes(o.kind));
  const scale = Math.max(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin);
  const groups = [];
  const all = [];
  for (let i = 0; i < curves.length; i++) {
    for (let j = i + 1; j < curves.length; j++) {
      const raw = polylineIntersections(curves[i].data.polylines, curves[j].data.polylines);
      if (!raw.length) continue;
      const F = residualOf(curves[i]);
      const G = residualOf(curves[j]);
      const pts = [];
      for (const p of raw) {
        let q = p;
        if (F && G) q = newton2D(F, G, p[0], p[1]) || p;
        if (!isFinite(q[0]) || !isFinite(q[1])) continue;
        if (pts.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < scale * 1e-6)) continue;
        pts.push(q);
      }
      if (!pts.length) continue;
      pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      groups.push({ labels: [curves[i].label, curves[j].label], points: pts });
      for (const q of pts) {
        if (!all.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < scale * 1e-6)) all.push(q);
      }
    }
  }
  all.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  // 배열로도, 쌍별 묶음으로도 쓸 수 있게 둘 다 돌려준다
  all.groups = groups;
  return all;
}

/** 객체를 f(x,y)=0 형태의 잔차 함수로 (가능한 경우) */
function residualOf(o) {
  if (o.kind === 'implicit' && o.f) return (x, y) => o.f({ x, y });
  if (o.kind === 'function' && o.fn) {
    const v = o.substitute || 'x';
    return (x, y) => y - o.fn({ [v]: x });
  }
  if (o.kind === 'functionY' && o.fn) return (x, y) => x - o.fn({ y });
  return null;
}

// ── 분석 ────────────────────────────────────────────────────
export function analyzeObject(obj, bounds, ctx) {
  try {
    if (obj.data && obj.data.empty) {
      // 왜 비었는지 말할 수 있으면 말한다 — sin(x+y) = 2 는 화면을 넓혀도 소용없다
      const fam = ctx && obj.exprAst && !polyOf(obj, ctx)
        ? levelFamily(obj.exprAst, ['x', 'y'], exactConstants(ctx)) : null;
      const why = fam && !fam.bases.length
        ? levelFamilyFinding(fam, bounds)
        : {
          type: 'empty', title: '해 없음', confidence: 1,
          detail: '식 자체에 실수해가 없거나, 해가 지금 화면 밖에 있습니다. 축소해서 다시 확인해 보세요.',
        };
      return {
        title: '해집합 분석',
        lead: '보이는 범위 안에서는 이 식을 만족하는 점이 하나도 없습니다.',
        findings: [why],
        summary: '해 없음',
      };
    }
    switch (obj.kind) {
      case 'union': {
        const parts = (obj.children || []).map((c) => ({ c, r: analyzeObject(c, bounds, ctx) }));
        return {
          title: '합집합 해집합 분석',
          lead: `${parts.length}개 식의 해를 모두 모은 집합입니다.`,
          findings: parts.flatMap(({ c, r }) =>
            (r?.findings || []).map((f) => ({ ...f, title: `[${c.label}] ${f.title}` }))),
          summary: parts.map(({ c }) => c.label).join('  ∪  '),
        };
      }
      case 'function': return analyzeFunctionObject(obj, bounds, ctx);
      case 'functionY': {
        const r = analyzeFunction((y) => obj.fn({ y }), { xmin: bounds.ymin, xmax: bounds.ymax, name: 'x' });
        return { title: '함수 분석 (y 에 대한 함수)', ...r };
      }
      case 'implicit': return analyzeImplicit(obj, bounds, ctx);
      case 'system': {
        const d = computeObject(obj, bounds);
        const r = analyzePointSet(d.points);
        return { title: '연립방정식의 해 (점열)', ...r,
          lead: `해가 ${d.points.length}개 있습니다: ` +
            d.points.slice(0, 8).map(([x, y]) => `(${pretty(x)}, ${pretty(y)})`).join(', ') };
      }
      case 'equation1d': {
        const d = computeObject(obj, bounds);
        if (d.dense) {
          return {
            title: `방정식의 해 (${obj.varName} 에 대한 점열)`,
            lead: `이 범위에는 해가 화면 해상도보다 촘촘하게 놓여 있습니다 (표본으로 잡힌 것만 ${d.total}개).`,
            findings: [{
              type: 'dense', title: '해가 너무 촘촘함', confidence: 1,
              detail: '지금 보이는 점들은 전체 해의 일부만 표본으로 잡은 것이라, 이 상태의 간격으로 규칙을 말하면 틀립니다. 확대해서 다시 분석해 주세요.',
            }],
            summary: '해가 너무 촘촘함',
          };
        }
        const vals = d.points.map((p) => (obj.varName === 'y' ? p[1] : p[0]));
        const seq = analyzeSequence(vals, { name: obj.varName });
        const ps = analyzePointSet(d.points);
        const findings = [...seq.findings, ...ps.findings.filter((f) => f.type !== 'grid-x')];

        // 다항방정식이면 근을 근호 그대로 정확히 적는다
        const uni = polyOf(obj, ctx, [obj.varName]);
        const exactRoots = uni ? polyRootsExact(uni.toUnivariate(obj.varName) || []) : null;
        if (Array.isArray(exactRoots)) {
          findings.unshift({
            type: 'exact-roots', confidence: 1,
            title: exactRoots.length ? `정확한 해 ${exactRoots.length}개` : '실수해 없음',
            detail: exactRoots.length
              ? exactRoots.map((r) => `${obj.varName} = ${r.text}`).join(',   ')
              : '이 다항방정식에는 실수해가 없습니다.',
            hint: '표본에서 찾은 값이 아니라 계수를 유리수로 놓고 정확히 푼 결과입니다.',
          });
        }
        return { title: `방정식의 해 (${obj.varName} 에 대한 점열)`,
          lead: `이 화면 범위에서 해가 ${vals.length}개 있습니다: ${vals.slice(0, 10).map((v) => pretty(v)).join(', ')}`,
          findings,
          summary: seq.summary };
      }
      case 'points':
      case 'point': {
        const r = analyzePointSet(obj.points);
        return { title: '점열 분석', ...r };
      }
      case 'regression': {
        const findings = obj.params.map((p, i) => ({
          type: 'param', title: `${p} = ${tn(obj.values[i], 8)}`, confidence: 1,
          detail: '자료에 가장 잘 맞도록 정한 값입니다. 다른 식에서 그대로 쓸 수 있습니다.',
        }));
        findings.unshift({
          type: 'quality',
          title: `결정계수 R² = ${obj.r2.toFixed(6)}`,
          confidence: obj.r2 > 0.99 ? 1 : obj.r2 > 0.9 ? 0.8 : 0.5,
          detail: `자료 ${obj.count}개, 잔차 제곱평균제곱근 RMSE = ${tn(obj.rmse, 6)}. `
            + (obj.r2 > 0.99 ? '모형이 자료를 거의 그대로 설명합니다.'
              : obj.r2 > 0.9 ? '대체로 잘 맞지만 흩어짐이 남아 있습니다.'
                : '이 모형으로는 자료를 잘 설명하지 못합니다. 다른 모형을 시험해 보세요.'),
        });
        const resid = obj.observed.map((v, i) => obj.predicted[i] - v);
        findings.push({
          type: 'residual', title: '잔차',
          confidence: 0.7,
          detail: resid.slice(0, 8).map((v) => tn(v, 4)).join(', ') + (resid.length > 8 ? ' …' : ''),
        });
        return { title: '회귀 분석', findings, summary: obj.label };
      }
      case 'list': {
        const r = analyzeSequence(obj.values, { name: obj.defName });
        return { title: '리스트 분석', ...r,
          lead: `${obj.values.length}개 값: ${obj.values.slice(0, 10).map((v) => pretty(v)).join(', ')}`
            + (obj.values.length > 10 ? ' …' : '') };
      }
      case 'pointseq': {
        const d = computeObject(obj, bounds);
        const r = analyzePointSet(d.points);
        const [lo, hi] = obj.nRange || [obj.n0, obj.n0 + 19];
        return { title: '점열 분석', ...r,
          lead: `${obj.varName} = ${lo}…${hi} 에서 얻은 점 ${d.points.length}개: `
            + d.points.slice(0, 5).map(([x, y]) => `(${pretty(x)}, ${pretty(y)})`).join(', ')
            + (d.points.length > 5 ? ' …' : '') };
      }
      case 'sequence': {
        const terms = obj.terms || sequenceTerms(obj, bounds);
        const r = analyzeSequence(terms.filter(isFinite), { n0: obj.n0, name: obj.name || 'a' });
        return { title: '수열 분석', ...r,
          lead: `${(obj.name || 'a')}_${obj.n0} 부터: ${terms.slice(0, 10).map((v) => pretty(v)).join(', ')}${terms.length > 10 ? ' …' : ''}` };
      }
      case 'tangent': {
        const d = computeObject(obj, bounds);
        const findings = [{
          type: 'line', title: `${obj.tangentKind}의 방정식`, confidence: 1,
          detail: d.equation, formula: d.equation,
        }];
        if (isFinite(d.slope)) {
          findings.push({ type: 'slope', title: '기울기', confidence: 1,
            detail: `${pretty(d.slope)}${obj.tangentKind === '접선' ? ` — 그 점에서의 순간변화율입니다.` : ''}` });
        }
        if (d.points.length) {
          findings.push({ type: 'point', title: '닿는 점', confidence: 1,
            detail: `(${pretty(d.points[0][0])}, ${pretty(d.points[0][1])})`, points: d.points });
        }
        return { title: `${obj.tangentKind} 분석`, findings, summary: d.equation };
      }
      case 'integral': {
        const d = computeObject(obj, bounds);
        const lo = obj.loFn({});
        const hi = obj.hiFn({});
        const findings = [{
          type: 'value', title: '정적분 값', confidence: 1,
          detail: `∫ 의 값은 ${pretty(d.value)} 입니다.`,
          formula: `∫[${pretty(lo)}, ${pretty(hi)}] ${format(obj.expr)} d${obj.varName} = ${pretty(d.value)}`,
        }];
        // 부호 있는 넓이와 실제 넓이는 다르다
        const abs = adaptiveAbsArea(obj, lo, hi);
        if (abs !== null && Math.abs(abs - Math.abs(d.value)) > Math.abs(abs) * 1e-6) {
          findings.push({
            type: 'signed', title: '축 아래 부분이 있습니다', confidence: 1,
            detail: `부호를 무시한 넓이는 약 ${trimNum(abs, 6)} 입니다. `
              + '정적분은 축 아래를 음수로 세므로 둘이 다릅니다.',
          });
        }
        return { title: '정적분 분석', findings, summary: `${pretty(d.value)}` };
      }
      case 'region': return analyzeRegion(obj, bounds);
      case 'parametric':
      case 'polar': {
        const d = computeObject(obj, bounds);
        const pts = [];
        for (const line of d.polylines) {
          for (let i = 0; i < line.length; i += Math.max(2, Math.floor(line.length / 60) * 2)) {
            pts.push([line[i], line[i + 1]]);
          }
        }
        // 곡선에서 뽑은 표본이므로 놓인 차례·간격에 기대는 검사는 건너뛴다
        const r = analyzePointSet(pts.slice(0, 60), { sampled: true });
        const geo = analyzeCurve(d.polylines, { bounds });
        return { title: '곡선 분석', ...r, findings: [...geo.findings, ...r.findings] };
      }
      default:
        return null;
    }
  } catch (e) {
    return { title: '분석 실패', findings: [], summary: e.message };
  }
}

function analyzeFunctionObject(obj, bounds, ctx) {
  const v = obj.substitute || 'x';
  const f = (x) => obj.fn({ [v]: x });
  let df = null, d2f = null;
  if (obj.expr) {
    const d1 = derivative(obj.expr, v);
    if (d1) {
      const c1 = compile(d1, ctx);
      df = (x) => c1({ [v]: x });
      const d2 = derivative(d1, v);
      if (d2) {
        const c2 = compile(d2, ctx);
        d2f = (x) => c2({ [v]: x });
      }
      obj.derivativeText = format(d1);
    }
  }
  const r = analyzeFunction(f, { xmin: bounds.xmin, xmax: bounds.xmax, df, d2f, name: 'f' });
  return {
    title: '함수 분석',
    lead: obj.derivativeText ? `도함수: f′(${v}) = ${obj.derivativeText}` : undefined,
    ...r,
  };
}

/**
 * 영역의 넓이를 경계 칸만 잘게 쪼개어 다시 잰다.
 *
 * 칸 단위로만 세면 경계에서 반 칸씩 어긋나 |x|+|y| < 1 의 넓이가 2 가 아니라 1.97 로
 * 나온다. 그러면서 소수점 아래 넷째 자리까지 적으면 있지도 않은 정확도를 주장하게 된다.
 * 경계에 걸친 칸만 6×6 으로 다시 재면(안쪽 칸은 이미 정확하다) 오차가 한 자리 줄어들고,
 * 남은 오차만큼만 유효숫자를 적는다.
 */
function refinedArea(obj, bounds, mask, cols, rows, coarse) {
  const pred = obj.pred;
  const w = (bounds.xmax - bounds.xmin) / cols;
  const h = (bounds.ymax - bounds.ymin) / rows;
  const at = (i, j) => (i < 0 || j < 0 || i >= cols || j >= rows ? 0 : mask[j * cols + i]);
  // 경계 칸은 가로줄 몇 개로 자르고, 각 줄에서 경계가 지나는 x 를 **이분법으로** 찾는다.
  // 잔칸을 세기만 하면 곧은 경계가 격자와 어긋나며 한쪽으로 치우친다
  // (|x|+|y| < 1 의 45° 변이 대표적이다). 이분법으로 자르면 곧은 경계는 오차가 없고,
  // 굽은 경계에도 가로줄 개수의 제곱만큼 정확해진다.
  const SUB = 8;
  let sum = 0;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = at(i, j);
      const boundary = v !== at(i - 1, j) || v !== at(i + 1, j)
        || v !== at(i, j - 1) || v !== at(i, j + 1);
      if (!boundary) { sum += v; continue; }
      const x0 = bounds.xmin + i * w;
      let covered = 0;
      for (let b = 0; b < SUB; b++) {
        const y = bounds.ymin + (j + (b + 0.5) / SUB) * h;
        covered += coveredFraction(pred, x0, w, y, SUB);
      }
      sum += covered / SUB;
    }
  }
  const value = sum * w * h;
  // 이렇게 재면 상대오차가 화면 크기와 모양에 관계없이 0.05% 안쪽이다
  // (반지름 0.5 인 작은 원부터 포물선으로 둘러싸인 띠까지 재어 확인했다).
  // 그래서 **유효숫자 셋**까지만 적는다. 1.9677 이라고 적으면 있지도 않은
  // 넷째 자리 정확도를 주장하는 셈이다.
  return { value, text: signif(value, 3), coarse };
}

/**
 * 가로줄 y 에서 [x0, x0+w] 중 영역에 드는 길이의 비율.
 * 표본 사이에서 부호가 바뀌면 그 자리를 이분법으로 좁혀 정확히 자른다.
 */
function coveredFraction(pred, x0, w, y, n) {
  const at = (t) => pred({ x: x0 + t * w, y });
  const edge = (a, b) => {                       // a 는 안, b 는 밖
    for (let k = 0; k < 30; k++) {
      const m = (a + b) / 2;
      if (at(m)) a = m; else b = m;
    }
    return (a + b) / 2;
  };
  let covered = 0;
  let prevT = 0;
  let prev = at(0);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const cur = at(t);
    if (cur !== prev) {
      const c = prev ? edge(prevT, t) : edge(t, prevT);
      covered += prev ? c - prevT : t - c;
    } else if (cur) covered += t - prevT;
    prevT = t; prev = cur;
  }
  return covered;
}

/** 유효숫자 n 자리로 (뒤의 0 은 남긴다 — 2.00 은 "2 쯤"이 아니라 "2.00" 이다) */
function signif(v, n) {
  if (!isFinite(v) || v === 0) return String(v);
  const e = Math.floor(Math.log10(Math.abs(v)));
  return trimNum(v, Math.max(0, n - 1 - e));
}

/** sin(u) = c 꼴이 만드는 곡선족을 한 줄로 */
function levelFamilyFinding(fam, bounds) {
  const { u, levelText, kind, bases, period, degenerateAt } = fam;
  const name = u.toString();
  if (!bases.length) {
    return { type: 'level-family', title: '해 없음', confidence: 1,
      detail: `${fam.fn}(${name}) 은 이 값을 가질 수 없습니다.` };
  }

  // 보이는 범위에서 u 가 가지는 값의 폭 → 몇 번째 곡선까지 보이는지
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i <= 40; i++) {
    for (let j = 0; j <= 40; j++) {
      const v = u.evaluate({
        x: bounds.xmin + ((bounds.xmax - bounds.xmin) * i) / 40,
        y: bounds.ymin + ((bounds.ymax - bounds.ymin) * j) / 40,
      });
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  let count = 0;
  let degenerate = false;
  for (const b of bases) {
    const k0 = Math.ceil((lo - b) / period);
    const k1 = Math.floor((hi - b) / period);
    count += Math.max(0, k1 - k0 + 1);
    if (degenerateAt) {
      for (let k = k0; k <= k1 && k - k0 < 400; k++) {
        if (Math.abs(b + k * period - degenerateAt.value) < 1e-9) degenerate = true;
      }
    }
  }

  let detail = `해집합은 ${name} = ${levelText} (k 는 정수) 를 만족하는 곡선들의 모임입니다.`;
  if (kind) detail += ` 하나하나는 ${kind} 입니다.`;
  if (degenerate) detail += ` 다만 ${name} = ${degenerateAt.toString()} 인 것은 퇴화합니다.`;
  detail += ` 보이는 범위에는 ${count}개가 들어옵니다.`;
  return {
    type: 'level-family', title: `곡선족: ${name} = ${levelText}`, confidence: 1,
    detail, formula: `${name} = ${levelText}`,
    hint: '등고선 추적은 이런 식을 "가지 몇 개" 로만 셉니다. 식을 풀어 얻은 답입니다.',
  };
}

/** 부등식 영역의 성질: 넓이·유계 여부·경계 곡선의 종류 */
function analyzeRegion(obj, bounds) {
  const d = computeObject(obj, bounds);
  const { mask, cols, rows } = d.mask;
  let inside = 0;
  for (let i = 0; i < mask.length; i++) inside += mask[i];
  const cellArea = ((bounds.xmax - bounds.xmin) / cols) * ((bounds.ymax - bounds.ymin) / rows);
  const viewArea = (bounds.xmax - bounds.xmin) * (bounds.ymax - bounds.ymin);
  const ratio = inside / (cols * rows);
  const area = refinedArea(obj, bounds, mask, cols, rows, inside * cellArea);

  // 화면 테두리에 닿아 있으면 화면 밖으로 이어지는(유계가 아닐 수 있는) 영역
  let touchesEdge = false;
  for (let i = 0; i < cols; i++) if (mask[i] || mask[(rows - 1) * cols + i]) touchesEdge = true;
  for (let j = 0; j < rows; j++) if (mask[j * cols] || mask[j * cols + cols - 1]) touchesEdge = true;

  const findings = [];
  if (ratio === 0) {
    findings.push({ type: 'empty', title: '해가 없는 부등식', confidence: 1,
      detail: '보이는 범위 안에서 이 부등식을 만족하는 점이 없습니다.' });
  } else if (ratio > 0.999) {
    findings.push({ type: 'all', title: '보이는 범위 전체가 해', confidence: 1,
      detail: '이 화면 안에서는 모든 점이 부등식을 만족합니다.' });
  } else if (touchesEdge) {
    findings.push({ type: 'unbounded', title: '화면 밖으로 이어지는 영역', confidence: 0.8,
      detail: `보이는 부분의 넓이는 약 ${area.text} 이고, 전체 화면의 ${(ratio * 100).toFixed(1)}% 입니다. 경계가 화면 끝에 닿아 있어 실제 영역은 더 넓을 수 있습니다.`,
      value: area.value });
  } else {
    findings.push({ type: 'bounded', title: '유계 영역', confidence: 0.9,
      detail: `넓이가 약 ${area.text} 인 닫힌 영역입니다 (화면의 ${(ratio * 100).toFixed(1)}%).`,
      value: area.value });
  }

  // 경계 곡선의 종류
  if (d.polylines.length) {
    const sample = [];
    for (const line of d.polylines) {
      const stride = Math.max(2, Math.floor(line.length / 40) * 2);
      for (let i = 0; i < line.length; i += stride) sample.push([line[i], line[i + 1]]);
    }
    if (sample.length >= 6) {
      const conic = fitConic(sample.slice(0, 120));
      if (conic && conic.residual < 1e-4) {
        findings.push({ type: 'boundary', title: `경계선은 ${conic.kind}`, confidence: 0.85,
          detail: '점선으로 그린 경계가 이 이차곡선입니다.', formula: conic.equation });
      }
    }
    findings.push({ type: 'branches', title: `경계 곡선 ${d.polylines.length}가지`, confidence: 0.6,
      detail: '보이는 범위에서 경계가 이만큼의 조각으로 나뉩니다.' });
  }
  void viewArea;
  return { title: '부등식 영역 분석', findings, summary: findings[0].title };
}

function analyzeImplicit(obj, bounds, ctx) {
  const d = computeObject(obj, bounds);
  const findings = [];
  const nPts = d.points.length;
  const nCurves = d.polylines.length;

  // 식이 다항식이면 표본에 기대지 않고 기호적으로 정확히 판정한다
  const poly = ctx ? polyOf(obj, ctx) : null;
  const exact = poly && poly.degree <= 2 ? classifyConicExact(poly) : null;
  if (exact) {
    // 조건이 걸린 식(x²+y²=4 ∧ x>0)은 곡선 **전체**가 아니라 그 일부만 그려진다.
    // 종류는 본래 식에서 정확히 알 수 있지만, 해집합과 같다고 말하면 안 된다.
    const part = obj.restricted ? '의 일부' : '';
    let detail = `계수를 정확히 따져 보면 ${exact.kind}${part} 입니다.`;
    if (exact.radiusSq) {
      const r2 = exact.radiusSq;
      detail += ` 반지름² = ${r2.toString()}`;
      const rv = Math.sqrt(r2.value);
      detail += ` (반지름 ${pretty(rv)})`;
    }
    if (exact.center) {
      detail += ` 중심 (${exact.center[0].toString()}, ${exact.center[1].toString()}).`;
    }
    detail += `  판별식 B²−4AC = ${exact.disc.toString()}`
      + `, 행렬식 = ${exact.det.toString()}`;
    // 직선·두 직선·한 점은 이차곡선이라 부르면 어색하다
    const proper = ['원', '타원', '포물선', '쌍곡선'].includes(exact.kind);
    findings.push({
      type: 'conic-exact',
      title: `${proper ? '이차곡선' : '해집합'}: ${exact.kind}${part}`, confidence: 1,
      detail, formula: conicEquation(poly),
      hint: obj.restricted
        ? '조건에 맞는 부분만 그렸습니다. 종류는 조건을 떼어 낸 본래 식에서 정확히 계산했습니다.'
        : '표본을 맞춰 본 것이 아니라 계수를 유리수로 정확히 계산한 결과입니다.',
    });
  } else if (poly && poly.degree > 2) {
    findings.push({
      type: 'poly', title: `${poly.degree}차 대수곡선`, confidence: 1,
      detail: `x, y 에 대한 ${poly.degree}차 다항식입니다.`,
      formula: `${poly.toString()} = 0`,
    });
  } else if (!poly && ctx && obj.exprAst) {
    // sin(x y) = 0 처럼 주기함수 안에 다항식이 든 식은 다항식이 아니지만,
    // 해집합은 x y = kπ 라는 **곡선족**이다. 등고선은 "가지 115개" 라고만 말한다.
    const fam = levelFamily(obj.exprAst, ['x', 'y'], exactConstants(ctx));
    if (fam) findings.push(levelFamilyFinding(fam, bounds));
  }

  if (nCurves && !exact) {
    // 곡선 위의 표본으로 이차곡선 판별
    const sample = [];
    for (const line of d.polylines) {
      const stride = Math.max(2, Math.floor(line.length / 40) * 2);
      for (let i = 0; i < line.length; i += stride) sample.push([line[i], line[i + 1]]);
    }
    if (sample.length >= 6) {
      const conic = fitConic(sample.slice(0, 120));
      // 등고선에서 뽑은 표본은 이산화 오차가 있으므로 임계값을 그에 맞춘다
      if (conic && conic.residual < 1e-4) {
        // 표본을 맞춰 본 것이므로 "해집합이 원이다" 가 아니라 "원 위에 놓인다" 로 적는다.
        // max(x,y) = 1 은 두 직선 위에 놓이지만 해집합은 그 일부(ㄱ 자)일 뿐이다.
        let detail = `그려진 곡선이 ${conic.kind} 위에 놓입니다.`;
        if (conic.radius) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}), 반지름 ${pretty(conic.radius)}.`;
        else if (conic.center) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}).`;
        // 원은 축이 없으므로 기울기를 말하지 않는다 (표본 잡음이 만든 각도다)
        if (conic.rotation && conic.kind !== '원') {
          detail += ` 축이 ${trimNum((conic.rotation * 180) / Math.PI, 3)}° 기울어져 있습니다.`;
        }
        findings.push({ type: 'conic', title: `이차곡선: ${conic.kind}`, detail,
          formula: conic.equation, confidence: 0.9,
          hint: '곡선 위 표본을 맞춰 본 결과입니다. 해집합이 이 곡선의 일부일 수 있습니다.' });
      }
    }
    findings.push({ type: 'branches', title: `곡선 가지 ${nCurves}개`, confidence: 0.7,
      detail: `보이는 범위에서 ${nCurves}개의 연결된 곡선 조각으로 이루어져 있습니다.` });
  }
  if (nCurves) {
    // 닫혀 있는가, 둘레와 넓이는 얼마인가, 스스로 가로지르는가 —
    // 계수만 봐서는 나오지 않고 그려 봐야 아는 것들이다
    findings.push(...analyzeCurve(d.polylines, { bounds }).findings);
  }

  if (nPts) {
    const ps = analyzePointSet(d.points);
    findings.push({ type: 'isolated', title: `고립해(점열) ${nPts}개`, confidence: 1,
      detail: `곡선이 아니라 점으로만 존재하는 해입니다: ` +
        d.points.slice(0, 8).map(([x, y]) => `(${pretty(x)}, ${pretty(y)})`).join(', ')
        + (nPts > 8 ? ' …' : ''),
      hint: '균일 격자 등고선법은 이런 해를 놓치지만, 이 계산기는 |f| 의 국소 최소를 따로 찾아 복원합니다.' });
    findings.push(...ps.findings.map((f) => ({ ...f, title: `점열 구조: ${f.title}` })));
  }

  return {
    title: '음함수 해집합 분석',
    findings,
    summary: `곡선 ${nCurves}조각 · 고립해 ${nPts}개`,
  };
}
