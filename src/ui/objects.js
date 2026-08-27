// 입력 한 줄 → 그릴 수 있는 객체로 해석하고, 그 객체의 해집합을 계산·분석한다.

import { parse, freeVars, format, ParseError } from '../math/parser.js';
import { compile, residual, residualList, predicate, makeContext } from '../math/evaluator.js';
import { derivative } from '../math/derivative.js';
import { FUNCTIONS } from '../math/functions.js';
import { traceImplicit } from '../engine/implicit.js';
import { sampleFunction, sampleParametric, samplePolar } from '../engine/sampler.js';
import { solve1D, solveSystem2D, regionMask } from '../engine/solvers.js';
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
  const main = asts[asts.length - 1];
  obj.asts = asts;

  // ── 수열 정의: a_n = …  (앞선 조각들은 초기값 a_1 = 1 처럼 취급)
  const seqDef = asts.find((a) => a.type === 'cmp' && a.op === '=' && a.a.type === 'index');
  if (seqDef) return buildSequence(obj, asts, ctx);

  // ── 함수 정의: f(x) = …
  if (main.type === 'cmp' && main.op === '=' && main.a.type === 'call' && !isBuiltin(main.a.name)
      && main.a.args.every((p) => p.type === 'var')) {
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
    if (free.size === 1 && ANGLE_VARS.has(p)) {
      obj.kind = 'parametric';
      obj.varName = p;
      obj.fx = compile(main.items[0], ctx);
      obj.fy = compile(main.items[1], ctx);
      obj.label = `(${format(main.items[0])}, ${format(main.items[1])})`;
      obj.range = [0, 2 * Math.PI];
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
      obj.range = [0, 2 * Math.PI];
      obj.label = `r = ${format(main.b)}`;
      return obj;
    }
  }

  // ── 연립방정식 (등식 ∧ 등식) → 해는 점열
  if (main.type === 'logic' && main.op === 'and' && collectEqs(main).length >= 2
      && [...free].every((v) => v === 'x' || v === 'y')) {
    obj.kind = 'system';
    obj.residuals = residualList(main, ctx);
    obj.label = format(main);
    return obj;
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
      return { polylines: r.polylines, points: r.points, isolated: r.points };
    }
    case 'region': {
      const mask = regionMask((x, y) => obj.pred({ x, y }), b);
      const polylines = [];
      for (const bf of obj.boundaries) {
        const t = traceImplicit((x, y) => bf({ x, y }), b, { findIsolated: false });
        polylines.push(...t.polylines);
      }
      return { mask, polylines, dash: [6, 4], points: [] };
    }
    case 'system': {
      const [F, G] = obj.residuals;
      const s = solveSystem2D((x, y) => F({ x, y }), (x, y) => G({ x, y }), b);
      return {
        points: s.points,
        polylines: [...s.curves[0].polylines, ...s.curves[1].polylines],
        ghost: true,
        isolated: s.points,
      };
    }
    case 'equation1d': {
      const v = obj.varName;
      const lo = v === 'y' ? b.ymin : b.xmin;
      const hi = v === 'y' ? b.ymax : b.xmax;
      const roots = solve1D((t) => obj.f({ [v]: t }), lo, hi);
      const pts = v === 'y' ? roots.map(([t]) => [0, t]) : roots;
      return { points: pts, isolated: pts, polylines: [] };
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
      const r = sampleParametric((t) => obj.fx({ [v]: t }), (t) => obj.fy({ [v]: t }), t0, t1);
      return { polylines: r.polylines, points: [] };
    }
    case 'polar': {
      const [t0, t1] = obj.range;
      const v = obj.varName;
      const r = samplePolar((t) => obj.fr({ [v]: t }), t0, t1);
      return { polylines: r.polylines, points: [] };
    }
    default:
      return { polylines: [], points: [] };
  }
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
    switch (obj.kind) {
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
