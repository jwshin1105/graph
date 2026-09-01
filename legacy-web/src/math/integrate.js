// 적분 — 정확한 답을 먼저 구하고, 안 되면 오차를 관리하는 수치법으로 물러선다.
//
// 기존에는 무조건 적응 심프슨이었다. 그 방법은 끝점에서 도함수가 발산하는 적분
// (∫₋₁¹ √(1−x²) dx = π/2) 에서 상대오차가 4×10⁻¹⁰ 까지 벌어진다. 끝점의 특이성은
// 심프슨이 다루도록 만들어진 모양이 아니기 때문이다.
//
//   1. 부정적분을 기호로 구해 F(b) − F(a) 를 정확값으로  →  ∫₀¹ x² dx = 1/3
//   2. 안 되면 이중지수(tanh–sinh) 구적법  →  끝점 특이성에서도 기계정밀도까지

import { derivative } from './derivative.js';
import { format } from './parser.js';

const num = (v) => ({ type: 'num', value: v, text: String(v) });
const V = (name) => ({ type: 'var', name });
const bin = (op, a, b) => ({ type: 'bin', op, a, b });
const call = (name, ...args) => ({ type: 'call', name, args });
const neg = (a) => ({ type: 'un', op: '-', a });

/** 식이 변수 v 에 기대는가 */
function usesVar(n, v) {
  if (!n || typeof n !== 'object') return false;
  if (n.type === 'var') return n.name === v;
  for (const k of ['a', 'b']) if (n[k] && usesVar(n[k], v)) return true;
  if (Array.isArray(n.args)) return n.args.some((x) => usesVar(x, v));
  if (Array.isArray(n.items)) return n.items.some((x) => usesVar(x, v));
  return false;
}

/** 식이 a·v + b 꼴이면 [a, b] (상수 AST), 아니면 null */
function asLinear(n, v) {
  if (!usesVar(n, v)) return null;
  if (n.type === 'var' && n.name === v) return [num(1), num(0)];
  if (n.type === 'un' && n.op === '-') {
    const r = asLinear(n.a, v);
    return r ? [neg(r[0]), neg(r[1])] : null;
  }
  if (n.type === 'bin') {
    const { op, a, b } = n;
    const ua = usesVar(a, v);
    const ub = usesVar(b, v);
    if (op === '+' || op === '-') {
      if (ua && !ub) {
        const r = asLinear(a, v);
        return r ? [r[0], op === '+' ? bin('+', r[1], b) : bin('-', r[1], b)] : null;
      }
      if (!ua && ub) {
        const r = asLinear(b, v);
        if (!r) return null;
        return op === '+' ? [r[0], bin('+', a, r[1])] : [neg(r[0]), bin('-', a, r[1])];
      }
      return null;
    }
    if (op === '*') {
      if (ua && !ub) { const r = asLinear(a, v); return r ? [bin('*', r[0], b), bin('*', r[1], b)] : null; }
      if (!ua && ub) { const r = asLinear(b, v); return r ? [bin('*', a, r[0]), bin('*', a, r[1])] : null; }
      return null;
    }
    if (op === '/' && ua && !ub) {
      const r = asLinear(a, v);
      return r ? [bin('/', r[0], b), bin('/', r[1], b)] : null;
    }
  }
  return null;
}

/**
 * 부정적분을 기호로. 구할 수 없으면 null.
 * 다항식·거듭제곱·지수·삼각·1/(1+x²)·√(1−x²) 와 그것들의 일차 대입까지 다룬다.
 */
export function antiderivative(node, v) {
  const F = (n) => antiderivative(n, v);
  if (!node) return null;
  if (!usesVar(node, v)) return bin('*', node, V(v));           // 상수 c → c·x

  switch (node.type) {
    case 'var': return bin('/', bin('^', V(v), num(2)), num(2));
    case 'un': {
      if (node.op !== '-') return null;
      const a = F(node.a);
      return a ? neg(a) : null;
    }
    case 'bin': {
      const { op, a, b } = node;
      if (op === '+' || op === '-') {
        const fa = F(a);
        const fb = F(b);
        return fa && fb ? bin(op, fa, fb) : null;
      }
      if (op === '*') {
        if (!usesVar(a, v)) { const fb = F(b); return fb ? bin('*', a, fb) : null; }
        if (!usesVar(b, v)) { const fa = F(a); return fa ? bin('*', fa, b) : null; }
        return null;
      }
      if (op === '/') {
        if (!usesVar(b, v)) { const fa = F(a); return fa ? bin('/', fa, b) : null; }
        // 1/(a·x+b) → ln|a·x+b| / a
        if (!usesVar(a, v)) {
          const lin = asLinear(b, v);
          if (lin) {
            return bin('/', bin('*', a, call('ln', call('abs', b))), lin[0]);
          }
          // 1/(x² + c) → atan(x/√c)/√c
          const sq = asSquarePlus(b, v);
          if (sq) {
            const s = call('sqrt', sq);
            return bin('/', bin('*', a, call('atan', bin('/', V(v), s))), s);
          }
          // 1/√(1−x²) → asin x
          if (b.type === 'call' && b.name === 'sqrt') {
            const one = asOneMinusSquare(b.args[0], v);
            if (one) return bin('*', a, call('asin', bin('/', V(v), call('sqrt', one))));
          }
        }
        return null;
      }
      if (op === '^') {
        // x^n
        if (a.type === 'var' && a.name === v && !usesVar(b, v)) {
          if (b.type === 'num' && b.value === -1) return call('ln', call('abs', V(v)));
          const k = bin('+', b, num(1));
          return bin('/', bin('^', V(v), k), k);
        }
        // (a·x+b)^n
        const lin = asLinear(a, v);
        if (lin && !usesVar(b, v)) {
          if (b.type === 'num' && b.value === -1) {
            return bin('/', call('ln', call('abs', a)), lin[0]);
          }
          const k = bin('+', b, num(1));
          return bin('/', bin('^', a, k), bin('*', k, lin[0]));
        }
        // c^(a·x+b)
        if (!usesVar(a, v)) {
          const l2 = asLinear(b, v);
          if (l2) return bin('/', node, bin('*', l2[0], call('ln', a)));
        }
        return null;
      }
      return null;
    }
    case 'call': {
      const arg = node.args && node.args[0];
      if (!arg) return null;
      const lin = asLinear(arg, v);
      const scale = (inner) => (lin ? bin('/', inner, lin[0]) : null);
      switch (node.name) {
        case 'sin': return lin ? scale(neg(call('cos', arg))) : null;
        case 'cos': return lin ? scale(call('sin', arg)) : null;
        case 'exp': return lin ? scale(call('exp', arg)) : null;
        case 'ln': {
          // ∫ln x = x·ln x − x
          if (arg.type === 'var' && arg.name === v) {
            return bin('-', bin('*', V(v), call('ln', V(v))), V(v));
          }
          return null;
        }
        case 'sqrt': {
          // ∫√(c − x²) = (x√(c−x²) + c·asin(x/√c))/2
          const c = asOneMinusSquare(arg, v);
          if (c) {
            const s = call('sqrt', c);
            return bin('/', bin('+', bin('*', V(v), node),
              bin('*', c, call('asin', bin('/', V(v), s)))), num(2));
          }
          return null;
        }
        default: return null;
      }
    }
    default: return null;
  }
}

/** x² + c 꼴이면 c (상수 AST) */
function asSquarePlus(n, v) {
  if (n.type !== 'bin' || n.op !== '+') return null;
  const [sq, c] = isSquareOf(n.a, v) ? [n.a, n.b] : isSquareOf(n.b, v) ? [n.b, n.a] : [null, null];
  if (!sq || usesVar(c, v)) return null;
  return c;
}
/** c − x² 꼴이면 c (상수 AST) */
function asOneMinusSquare(n, v) {
  if (n.type !== 'bin' || n.op !== '-') return null;
  if (!isSquareOf(n.b, v) || usesVar(n.a, v)) return null;
  return n.a;
}
function isSquareOf(n, v) {
  return n && n.type === 'bin' && n.op === '^' && n.a.type === 'var' && n.a.name === v
    && n.b.type === 'num' && n.b.value === 2;
}

/**
 * 이중지수(tanh–sinh) 구적법.
 *
 * x = c + r·tanh(½π·sinh t) 로 바꾸면 끝점이 t → ±∞ 로 밀려나고 가중치가
 * 이중지수로 줄어든다. 그래서 √(1−x²) 처럼 **끝점에서 도함수가 발산하는** 적분도
 * 기계정밀도까지 간다. 심프슨은 같은 적분에서 상대오차 4×10⁻¹⁰ 에 머문다.
 *
 * @returns {{value:number, error:number, evals:number}}
 */
export function tanhSinh(f, a, b, tol = 1e-14, maxLevel = 10) {
  if (!isFinite(a) || !isFinite(b)) return { value: NaN, error: Infinity, evals: 0 };
  if (a === b) return { value: 0, error: 0, evals: 0 };
  const sign = b < a ? -1 : 1;
  if (b < a) [a, b] = [b, a];
  const c = (a + b) / 2;
  const r = (b - a) / 2;
  const HP = Math.PI / 2;
  let evals = 0;

  // 격자점을 c + r·tanh(z) 로 잡으면 끝점 근처에서 x 가 a 나 b 로 반올림되어
  // 1/√x 같은 적분이 깨진다. 대신 **끝점에서의 거리** 를 상쇄 없이 구해
  // a + d, b − d 로 잡는다.  1 − tanh w = 2e^(−2w)/(1 + e^(−2w))
  const at = (t) => {
    const z = HP * Math.sinh(t);
    const az = Math.abs(z);
    const ez = Math.exp(-2 * az);
    const d = (r * 2 * ez) / (1 + ez);
    const x = t > 0 ? b - d : a + d;
    const ch = Math.cosh(z);
    const w = (HP * Math.cosh(t)) / (ch * ch);
    if (!(w > 0) || !isFinite(w)) return { w: 0, v: 0 };
    if (x <= a || x >= b) return { w, v: 0 };
    const y = f(x);
    evals++;
    return { w, v: isFinite(y) ? y * w : 0 };
  };

  // 가중치가 배정밀도에서 사라지는 자리까지만 본다
  const TMAX = 4.2;
  let h = 1;
  let sum = at(0).v;
  for (let t = h; t <= TMAX; t += h) sum += at(t).v + at(-t).v;
  let value = sign * r * h * sum;
  let error = Infinity;

  for (let level = 1; level <= maxLevel; level++) {
    h /= 2;
    let add = 0;
    for (let t = h; t <= TMAX; t += 2 * h) add += at(t).v + at(-t).v;
    sum += add;
    const next = sign * r * h * sum;
    error = Math.abs(next - value);
    value = next;
    if (error <= tol * Math.max(1, Math.abs(value))) break;
  }
  return { value, error, evals };
}

/** 부정적분을 글로 (분석 패널의 "어떻게 구했나" 용) */
export function antiderivativeText(node, v) {
  const F = antiderivative(node, v);
  return F ? format(F) : null;
}

export { derivative, usesVar };
