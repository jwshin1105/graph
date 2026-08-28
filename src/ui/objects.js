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
import { analyzeFunction } from '../analysis/functionAnalysis.js';
import { fitConic } from '../analysis/conic.js';
import { pretty, trimNum } from '../math/numeric.js';

const ANGLE_VARS = new Set(['t', 'θ', 'theta']);
const isBuiltin = (n) => Object.prototype.hasOwnProperty.call(FUNCTIONS, n);

export function createContext() {
  return makeContext();
}

/** ctx 에 이미 정의된 이름들 (토크나이저가 통째로 인식하도록) */
export function knownNames(ctx) {
  return new Set([...ctx.defs.keys(), ...ctx.seqs.keys(), 'x', 'y', 'n', 'k', 't', 'r', 'θ', 'and', 'or']);
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
      obj.label = format(main);
      return obj;
    }
    // 한 변수 방정식 → 해가 점열
    if (free.size === 1) {
      const v = [...free][0];
      obj.kind = 'equation1d';
      obj.varName = v;
      obj.f = residual(main, ctx);
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
    const v = compile(main, ctx)({});
    obj.kind = 'value';
    obj.value = v;
    obj.label = `${format(main)} = ${pretty(v)}`;
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
    obj.kind = 'implicit';
    obj.f = residual({ type: 'cmp', op: '=', a: main, b: { type: 'num', value: 0 } }, ctx);
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

// ── 수열 ────────────────────────────────────────────────────
function buildSequence(obj, asts, ctx) {
  const defs = asts.filter((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index');
  const main = defs[defs.length - 1];
  const name = main.a.base.type === 'var' ? main.a.base.name : 'a';
  const idxVar = main.a.index.type === 'var' ? main.a.index.name : 'n';

  const seeds = new Map();
  for (const d of defs.slice(0, -1)) {
    if (d.a.index.type === 'num') seeds.set(d.a.index.value, compile(d.b, ctx)({}));
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
      if (obj.oneVar) {
        const v = obj.oneVar;
        const lo = v === 'y' ? b.ymin : b.xmin;
        const hi = v === 'y' ? b.ymax : b.xmax;
        const roots = intersectRoots(obj.residuals.map((f) => (t) => f({ [v]: t })), lo, hi);
        const pts = roots.map((t) => (v === 'y' ? [0, t] : [t, 0]));
        return { points: pts, isolated: pts, polylines: [], empty: pts.length === 0 };
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
        return {
          points: pts, isolated: pts, polylines: [], empty: pts.length === 0, ghost: true,
        };
      }

      const s = fns.length === 2
        ? solveSystem2D(fns[0], fns[1], b, opts)
        : solveSystemN(fns, b, opts);
      return {
        points: s.points,
        polylines: s.curves.flatMap((c) => c.polylines),
        ghost: true,
        isolated: s.points,
        empty: s.points.length === 0,
      };
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
      return {
        title: '해집합 분석',
        lead: '보이는 범위 안에서는 이 식을 만족하는 점이 하나도 없습니다.',
        findings: [{
          type: 'empty', title: '해 없음', confidence: 1,
          detail: '식 자체에 실수해가 없거나, 해가 지금 화면 밖에 있습니다. 축소해서 다시 확인해 보세요.',
        }],
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
      case 'implicit': return analyzeImplicit(obj, bounds);
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
        return { title: `방정식의 해 (${obj.varName} 에 대한 점열)`,
          lead: `이 화면 범위에서 해가 ${vals.length}개 있습니다: ${vals.slice(0, 10).map((v) => pretty(v)).join(', ')}`,
          findings: [...seq.findings, ...ps.findings.filter((f) => f.type !== 'grid-x')],
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
        const r = analyzePointSet(pts.slice(0, 60));
        return { title: '곡선 분석', ...r };
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

/** 부등식 영역의 성질: 넓이·유계 여부·경계 곡선의 종류 */
function analyzeRegion(obj, bounds) {
  const d = computeObject(obj, bounds);
  const { mask, cols, rows } = d.mask;
  let inside = 0;
  for (let i = 0; i < mask.length; i++) inside += mask[i];
  const cellArea = ((bounds.xmax - bounds.xmin) / cols) * ((bounds.ymax - bounds.ymin) / rows);
  const viewArea = (bounds.xmax - bounds.xmin) * (bounds.ymax - bounds.ymin);
  const ratio = inside / (cols * rows);

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
      detail: `보이는 부분의 넓이는 약 ${trimNum(inside * cellArea, 4)} 이고, 전체 화면의 ${(ratio * 100).toFixed(1)}% 입니다. 경계가 화면 끝에 닿아 있어 실제 영역은 더 넓을 수 있습니다.` });
  } else {
    findings.push({ type: 'bounded', title: '유계 영역', confidence: 0.9,
      detail: `넓이가 약 ${trimNum(inside * cellArea, 4)} 인 닫힌 영역입니다 (화면의 ${(ratio * 100).toFixed(1)}%).` });
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

function analyzeImplicit(obj, bounds) {
  const d = computeObject(obj, bounds);
  const findings = [];
  const nPts = d.points.length;
  const nCurves = d.polylines.length;

  if (nCurves) {
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
        let detail = `해집합이 ${conic.kind} 입니다.`;
        if (conic.radius) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}), 반지름 ${pretty(conic.radius)}.`;
        else if (conic.center) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}).`;
        if (conic.rotation) detail += ` 축이 ${trimNum((conic.rotation * 180) / Math.PI, 3)}° 기울어져 있습니다.`;
        findings.push({ type: 'conic', title: `이차곡선: ${conic.kind}`, detail,
          formula: conic.equation, confidence: 0.9 });
      }
    }
    findings.push({ type: 'branches', title: `곡선 가지 ${nCurves}개`, confidence: 0.7,
      detail: `보이는 범위에서 ${nCurves}개의 연결된 곡선 조각으로 이루어져 있습니다.` });
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
