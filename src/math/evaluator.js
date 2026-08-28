// AST → 클로저 트리 컴파일러.
// eval / new Function 을 쓰지 않으므로 안전하며, 플로팅에 필요한 수십만 회 호출에도
// 충분히 빠르다.

import { FUNCTIONS, CONSTANTS, SPECIAL_FORMS } from './functions.js';

export class EvalError2 extends Error {}

/**
 * @typedef {Object} Context
 * @property {Map<string, {params:string[], body:Object}>} defs  사용자 정의 함수/변수
 * @property {Map<string, {values:Map<number,number>, get:(n:number)=>number}>} seqs 수열
 */

export function makeContext() {
  return { defs: new Map(), seqs: new Map() };
}

const isList = Array.isArray;

/**
 * 두 자리 연산을 리스트에도 통하게 만든다.
 * 숫자끼리면 그대로, 한쪽이 리스트면 원소마다, 둘 다 리스트면 짝지어 계산한다.
 */
function lift2(f) {
  return (a, b) => {
    if (typeof a === 'number' && typeof b === 'number') return f(a, b);
    if (isList(a) && isList(b)) {
      const n = Math.min(a.length, b.length);
      const out = new Array(n);
      for (let i = 0; i < n; i++) out[i] = f(a[i], b[i]);
      return out;
    }
    if (isList(a)) return a.map((v) => f(v, b));
    if (isList(b)) return b.map((v) => f(a, v));
    return f(a, b);
  };
}

function lift1(f) {
  return (a) => (isList(a) ? a.map(f) : f(a));
}

const BINOPS = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': (a, b) => {
    // 음수의 홀수분모 유리수 거듭제곱을 실수로 확장: (-8)^(1/3) = -2
    if (a < 0 && !Number.isInteger(b)) {
      const inv = 1 / b;
      const r = Math.round(inv);
      if (Math.abs(inv - r) < 1e-9 && r % 2 !== 0) return -Math.pow(-a, b);
      return NaN;
    }
    return Math.pow(a, b);
  },
};

for (const k of Object.keys(BINOPS)) BINOPS[k] = lift2(BINOPS[k]);

const CMPOPS = {
  '=': (a, b) => (Math.abs(a - b) < 1e-12 ? 1 : 0),
  '<': (a, b) => (a < b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
  '!=': (a, b) => (a !== b ? 1 : 0),
};

for (const k of Object.keys(CMPOPS)) CMPOPS[k] = lift2(CMPOPS[k]);

/**
 * AST 를 (env) => number 형태의 함수로 컴파일한다.
 * env 는 { x: 1, y: 2 } 같은 평범한 객체.
 */
export function compile(node, ctx = makeContext()) {
  return build(node, ctx);
}

function build(node, ctx) {
  switch (node.type) {
    case 'num': {
      const v = node.value;
      return () => v;
    }
    case 'var': {
      const name = node.name;
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        const v = CONSTANTS[name];
        return () => v;
      }
      return (env) => {
        if (env && name in env) return env[name];
        const d = ctx.defs.get(name);
        if (d && d.params.length === 0) {
          if (!d.compiled) d.compiled = build(d.body, ctx);
          return guard(() => d.compiled(env));
        }
        return NaN;
      };
    }
    case 'un': {
      const a = build(node.a, ctx);
      const neg = lift1((v) => -v);
      return (env) => neg(a(env));
    }
    case 'bin': {
      const f = BINOPS[node.op];
      const a = build(node.a, ctx);
      const b = build(node.b, ctx);
      return (env) => f(a(env), b(env));
    }
    case 'cmp': {
      const f = CMPOPS[node.op];
      const a = build(node.a, ctx);
      const b = build(node.b, ctx);
      return (env) => f(a(env), b(env));
    }
    case 'logic': {
      const a = build(node.a, ctx);
      const b = build(node.b, ctx);
      return node.op === 'and'
        ? (env) => (a(env) && b(env) ? 1 : 0)
        : (env) => (a(env) || b(env) ? 1 : 0);
    }
    case 'index': {
      const name = node.base.type === 'var' ? node.base.name : null;
      const idx = build(node.index, ctx);
      // x_1 = [1,2,3] 처럼 첨자 이름으로 정의된 리스트를 먼저 찾는다
      const staticKey = name && node.index.type === 'num' ? `${name}_${node.index.value}` : null;
      return (env) => {
        if (staticKey) {
          const d0 = ctx.defs.get(staticKey);
          if (d0 && d0.params.length === 0) {
            if (!d0.compiled) d0.compiled = build(d0.body, ctx);
            return d0.compiled(env);
          }
        }
        const n = idx(env);
        const seq = name && ctx.seqs.get(name);
        if (seq) return seq.get(n);
        const d = name && ctx.defs.get(name);
        if (d && d.params.length === 1) return callUser(d, [n], ctx, env);
        return NaN;
      };
    }
    case 'call': {
      const name = node.name;
      if (SPECIAL_FORMS.has(name)) return buildSpecial(node, ctx);
      const args = node.args.map((a) => build(a, ctx));
      if (node.primes) {
        // f'(x), f''(x): 사용자 정의 함수의 수치 도함수.
        // 아래 일반 호출 분기보다 먼저 걸러야 프라임이 무시되지 않는다.
        const order = node.primes;
        return (env) => {
          const d = ctx.defs.get(name);
          if (!d || d.params.length !== 1) return NaN;
          const x = args[0](env);
          return numDeriv((t) => callUser(d, [t], ctx, env), x, order);
        };
      }
      const def = ctx.defs.get(name);
      if (def || !FUNCTIONS[name]) {
        return (env) => {
          const d = ctx.defs.get(name);
          if (!d) {
            const seq = ctx.seqs.get(name);
            if (seq && args.length === 1) return seq.get(args[0](env));
            return NaN;
          }
          return callUser(d, args.map((a) => a(env)), ctx, env);
        };
      }
      const spec = FUNCTIONS[name];
      const fn = spec.fn;
      if (spec.list) {
        // 리스트 전체를 받아 하나의 값을 내는 함수 (mean, total, …)
        return (env) => fn(...args.map((a) => a(env)));
      }
      if (spec.arity === 1 && args.length === 1) {
        const a0 = args[0];
        const lifted = lift1(fn);
        return (env) => lifted(a0(env));
      }
      if (spec.arity === 2 && args.length === 2) {
        const [a0, a1] = args;
        const lifted = lift2(fn);
        return (env) => lifted(a0(env), a1(env));
      }
      if (spec.arity === -1) {
        // min(list), max(1,2,3) 처럼 리스트와 낱개 인자를 함께 받는다
        return (env) => fn(...args.flatMap((a) => {
          const v = a(env);
          return isList(v) ? v : [v];
        }));
      }
      return (env) => fn(...args.map((a) => a(env)));
    }
    case 'tuple':
    case 'list': {
      const items = node.items.map((a) => build(a, ctx));
      return (env) => items.map((f) => f(env));
    }
    case 'range': {
      const from = build(node.from, ctx);
      const to = build(node.to, ctx);
      const step = node.step ? build(node.step, ctx) : null;
      return (env) => {
        const a = from(env);
        const b = to(env);
        const d = step ? step(env) - a : (b >= a ? 1 : -1);
        if (!isFinite(a) || !isFinite(b) || !isFinite(d) || d === 0) return [];
        const n = Math.floor((b - a) / d + 1e-9) + 1;
        if (n <= 0 || n > 100000) return [];
        const out = new Array(n);
        for (let i = 0; i < n; i++) out[i] = a + d * i;
        return out;
      };
    }
    case 'comp': {
      const body = build(node.body, ctx);
      const src = build(node.source, ctx);
      const vname = node.varName;
      return (env) => {
        const list = src(env);
        if (!isList(list)) return [];
        const sub = Object.create(env || null);
        return list.map((v) => { sub[vname] = v; return body(sub); });
      };
    }
    case 'piece': {
      const cases = node.cases.map((c) => ({ cond: build(c.cond, ctx), value: build(c.value, ctx) }));
      const other = node.otherwise ? build(node.otherwise, ctx) : null;
      return (env) => {
        for (const c of cases) {
          const t = c.cond(env);
          if (isList(t)) continue;
          if (t) return c.value(env);
        }
        return other ? other(env) : NaN;    // 어디에도 안 걸리면 "정의되지 않음"
      };
    }
    default:
      throw new EvalError2(`계산할 수 없는 노드: ${node.type}`);
  }
}

/**
 * 합·곱·정적분처럼 "속변수를 묶는" 형태.
 *   sum(k^2, k, 1, 10)        prod(k, k, 1, n)
 *   integral(x^2, x, 0, 1)    integral(x^2, 0, 1)   ← 변수를 생략하면 x
 */
function buildSpecial(node, ctx) {
  const name = node.name;
  const a = node.args;
  if (name === 'integral') {
    const hasVar = a.length === 4;
    const vname = hasVar && a[1].type === 'var' ? a[1].name : 'x';
    const body = build(a[0], ctx);
    const lo = build(a[hasVar ? 2 : 1], ctx);
    const hi = build(a[hasVar ? 3 : 2], ctx);
    return (env) => {
      const sub = Object.create(env || null);
      const f = (t) => { sub[vname] = t; return body(sub); };
      return simpson(f, lo(env), hi(env));
    };
  }
  if (a.length < 4) return () => NaN;
  const vname = a[1].type === 'var' ? a[1].name : 'k';
  const body = build(a[0], ctx);
  const from = build(a[2], ctx);
  const to = build(a[3], ctx);
  const isSum = name === 'sum';
  return (env) => {
    const lo = Math.round(from(env));
    const hi = Math.round(to(env));
    if (!isFinite(lo) || !isFinite(hi) || hi - lo > 200000) return NaN;
    const sub = Object.create(env || null);
    let acc = isSum ? 0 : 1;
    for (let k = lo; k <= hi; k++) {
      sub[vname] = k;
      const v = body(sub);
      if (isSum) acc += v; else acc *= v;
      if (!isFinite(acc)) return acc;
    }
    return acc;
  };
}

/** 적응 심프슨 적분 */
export function simpson(f, a, b, tol = 1e-10, depth = 20) {
  if (!isFinite(a) || !isFinite(b)) return NaN;
  if (a === b) return 0;
  const sign = b < a ? -1 : 1;
  if (b < a) [a, b] = [b, a];
  const S = (l, r, fl, fm, fr) => ((r - l) / 6) * (fl + 4 * fm + fr);
  const rec = (l, r, fl, fm, fr, whole, d) => {
    const m = (l + r) / 2;
    const lm = (l + m) / 2, rm = (m + r) / 2;
    const flm = f(lm), frm = f(rm);
    const left = S(l, m, fl, flm, fm);
    const right = S(m, r, fm, frm, fr);
    if (d <= 0 || Math.abs(left + right - whole) < 15 * tol) return left + right + (left + right - whole) / 15;
    return rec(l, m, fl, flm, fm, left, d - 1) + rec(m, r, fm, frm, fr, right, d - 1);
  };
  const fa = f(a), fb = f(b), fm = f((a + b) / 2);
  if (![fa, fb, fm].every(isFinite)) {
    // 끝점이 특이하면 조금 안쪽으로 밀어 넣고 리만 합으로 근사
    const N = 4000;
    let acc = 0, cnt = 0;
    for (let i = 0; i < N; i++) {
      const t = a + ((b - a) * (i + 0.5)) / N;
      const v = f(t);
      if (isFinite(v)) { acc += v; cnt++; }
    }
    return cnt ? sign * acc * ((b - a) / N) * (N / cnt) : NaN;
  }
  return sign * rec(a, b, fa, fm, fb, S(a, b, fa, fm, fb), depth);
}

// 사용자 정의가 서로를 부르는 순환(f = g+1, g = f+1)에서 스택이 터지지 않도록
// 호출 깊이를 제한한다. 한계를 넘으면 NaN 으로 물러난다.
let callDepth = 0;
const MAX_CALL_DEPTH = 200;

function guard(fn) {
  if (callDepth >= MAX_CALL_DEPTH) return NaN;
  callDepth++;
  try { return fn(); } finally { callDepth--; }
}

function callUser(def, values, ctx, outerEnv) {
  if (!def.compiled) def.compiled = build(def.body, ctx);
  const env = Object.create(outerEnv || null);
  def.params.forEach((p, i) => {
    env[p] = values[i];
  });
  return guard(() => def.compiled(env));
}

export function numDeriv(f, x, order = 1) {
  const h = Math.max(1e-5, Math.abs(x) * 1e-6);
  if (order === 1) return (f(x + h) - f(x - h)) / (2 * h);
  if (order === 2) return (f(x + h) - 2 * f(x) + f(x - h)) / (h * h);
  return numDeriv((t) => numDeriv(f, t, order - 1), x, 1);
}

/**
 * 등식/부등식 AST 를 "좌변 - 우변" 실함수로 바꾼다.
 * 음함수 그래프(등고선)와 고립해 탐색이 모두 이 잔차 함수 위에서 동작한다.
 */
export function residual(node, ctx) {
  if (node.type === 'cmp') {
    const a = build(node.a, ctx);
    const b = build(node.b, ctx);
    return (env) => a(env) - b(env);
  }
  return build(node, ctx);
}

/** 여러 등식을 한 번에 잔차 벡터로 (연립방정식용) */
export function residualList(node, ctx) {
  const out = [];
  (function walk(n) {
    if (n.type === 'logic' && n.op === 'and') {
      walk(n.a);
      walk(n.b);
    } else out.push(residual(n, ctx));
  })(node);
  return out;
}

/** 논리식/부등식을 참·거짓 판정 함수로 */
export function predicate(node, ctx) {
  const f = build(node, ctx);
  return (env) => !!f(env);
}
