// 입력 한 줄 → 그릴 수 있는 객체로 해석하고, 그 객체의 해집합을 계산·분석한다.

import { parse, freeVars, format, ParseError } from '../math/parser.js';
import { compile, residual, residualList, predicate, makeContext } from '../math/evaluator.js';
import { derivative } from '../math/derivative.js';
import { FUNCTIONS } from '../math/functions.js';
import { traceImplicit } from '../engine/implicit.js';
import { sampleFunction, sampleParametric, samplePolar } from '../engine/sampler.js';
import { solve1D, solveSystem2D, solveSystemN, intersectRoots, regionMask } from '../engine/solvers.js';
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

  // ── 수열 정의: a_n = …  (앞선 조각들은 초기값 a_1 = 1 처럼 취급)
  const seqDef = asts.find((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index');
  if (seqDef) return buildSequence(obj, asts, ctx);

  // ── 함수 정의: f(x) = …
  const distinctVarArgs = (n) =>
    n.type === 'call' && n.args.length > 0 && n.args.every((p) => p.type === 'var')
    && new Set(n.args.map((p) => p.name)).size === n.args.length;
  if (main.type === 'cmp' && main.op === '=' && main.a.type === 'call' && !isBuiltin(main.a.name)
      && distinctVarArgs(main.a) && !ctx.defs.has(main.a.name)) {
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
      obj.kind = 'point';
      obj.points = [[x, y]];
      obj.label = `(${pretty(x)}, ${pretty(y)})`;
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

/** "a <= t <= b" 또는 "a < t < b" 를 [a, b] 범위로 해석 */
function asRange(node) {
  if (node.type !== 'logic' || node.op !== 'and') return null;
  const { a, b } = node;
  if (a.type !== 'cmp' || b.type !== 'cmp') return null;
  const varOf = (n) => (n.type === 'var' ? n.name : null);
  const name = varOf(a.b) || varOf(b.a);
  if (!name || !ANGLE_VARS.has(name)) return null;
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
  const entry = {
    values: cache,
    get(n) {
      const k = Math.round(n);
      if (cache.has(k)) return cache.get(k);
      if (k < (seeds.size ? Math.min(...seeds.keys()) : 1) - 50 || k > 100000) return NaN;
      cache.set(k, NaN);                                  // 순환 참조 방지
      const env = Object.create(null);
      env[idxVar] = k - shift;
      const v = body(env);
      cache.set(k, v);
      return v;
    },
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
  return obj;
}

// ── 해집합 계산 ─────────────────────────────────────────────
/**
 * 현재 보이는 영역에 맞춰 객체의 그릴 거리를 계산한다.
 * @returns {{polylines?:number[][], points?:number[][], mask?:object, labels?:Array}}
 */
export function computeObject(obj, bounds) {
  const b = bounds;
  switch (obj.kind) {
    case 'union2': {
      return { polylines: [], points: [] };
    }
    case 'function': {
      const f = obj.substitute
        ? (x) => obj.fn({ [obj.substitute]: x })
        : (x) => obj.fn({ x });
      const r = sampleFunction(f, b.xmin, b.xmax, { ymin: b.ymin, ymax: b.ymax });
      return { polylines: r.polylines, points: [] };
    }
    case 'functionY': {
      const r = sampleFunction((y) => obj.fn({ y }), b.ymin, b.ymax, { ymin: b.xmin, ymax: b.xmax });
      return { polylines: r.polylines.map(swapXY), points: [] };
    }
    case 'implicit': {
      const r = traceImplicit((x, y) => obj.f({ x, y }), b);
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
        const t = traceImplicit((x, y) => bf({ x, y }), b, { findIsolated: false });
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
      const s = fns.length === 2
        ? solveSystem2D(fns[0], fns[1], b)
        : solveSystemN(fns, b);
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
        const d = computeObject(child, bounds);
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
      case 'sequence': {
        const terms = obj.terms || sequenceTerms(obj, bounds);
        const r = analyzeSequence(terms.filter(isFinite), { n0: obj.n0, name: obj.name || 'a' });
        return { title: '수열 분석', ...r,
          lead: `${(obj.name || 'a')}_${obj.n0} 부터: ${terms.slice(0, 10).map((v) => pretty(v)).join(', ')}${terms.length > 10 ? ' …' : ''}` };
      }
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
      if (conic && conic.residual < 1e-6) {
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
