// 기호 미분 + 가벼운 단순화.
// 도함수는 극값·변곡점 탐색과 뉴턴법 수렴 향상에 쓰인다.

import { num, vari, bin, un, call } from './parser.js';

const ZERO = num(0);
const ONE = num(1);

const isNum = (n, v) => n.type === 'num' && (v === undefined || n.value === v);

export function simplify(n) {
  if (!n || typeof n !== 'object') return n;
  switch (n.type) {
    case 'bin': {
      const a = simplify(n.a);
      const b = simplify(n.b);
      if (isNum(a) && isNum(b)) {
        const v = { '+': a.value + b.value, '-': a.value - b.value, '*': a.value * b.value,
                    '/': a.value / b.value, '^': Math.pow(a.value, b.value) }[n.op];
        if (isFinite(v)) return num(v);
      }
      switch (n.op) {
        case '+':
          if (isNum(a, 0)) return b;
          if (isNum(b, 0)) return a;
          break;
        case '-':
          if (isNum(b, 0)) return a;
          if (isNum(a, 0)) return simplify(un('-', b));
          break;
        case '*':
          if (isNum(a, 0) || isNum(b, 0)) return ZERO;
          if (isNum(a, 1)) return b;
          if (isNum(b, 1)) return a;
          if (isNum(a, -1)) return un('-', b);
          if (isNum(b, -1)) return un('-', a);
          break;
        case '/':
          if (isNum(a, 0)) return ZERO;
          if (isNum(b, 1)) return a;
          break;
        case '^':
          if (isNum(b, 0)) return ONE;
          if (isNum(b, 1)) return a;
          if (isNum(a, 1)) return ONE;
          break;
        default: break;
      }
      return bin(n.op, a, b);
    }
    case 'un': {
      const a = simplify(n.a);
      if (isNum(a)) return num(-a.value);
      if (a.type === 'un') return a.a;
      return un('-', a);
    }
    case 'call':
      return { ...n, args: n.args.map(simplify) };
    case 'cmp':
    case 'logic':
      return { ...n, a: simplify(n.a), b: simplify(n.b) };
    default:
      return n;
  }
}

/** node 를 변수 v 로 미분한 AST 를 돌려준다. 미분 불가 노드는 null. */
export function derivative(node, v) {
  const d = diff(node, v);
  return d ? simplify(d) : null;
}

function diff(n, v) {
  switch (n.type) {
    case 'num': return ZERO;
    case 'var': return n.name === v ? ONE : ZERO;
    case 'un': {
      const a = diff(n.a, v);
      return a && un('-', a);
    }
    case 'bin': {
      const { a, b, op } = n;
      const da = diff(a, v);
      const db = diff(b, v);
      if (!da || !db) return null;
      switch (op) {
        case '+': return bin('+', da, db);
        case '-': return bin('-', da, db);
        case '*': return bin('+', bin('*', da, b), bin('*', a, db));
        case '/':
          return bin('/', bin('-', bin('*', da, b), bin('*', a, db)), bin('^', b, num(2)));
        case '^': {
          if (isNum(b)) {
            // 멱함수: n·u^(n-1)·u'
            return bin('*', bin('*', num(b.value), bin('^', a, num(b.value - 1))), da);
          }
          // 일반형: u^v · (v'·ln u + v·u'/u)
          const lnu = call('ln', [a]);
          return bin('*', bin('^', a, b), bin('+', bin('*', db, lnu), bin('/', bin('*', b, da), a)));
        }
        default: return null;
      }
    }
    case 'call': {
      if (n.args.length !== 1) return null;
      const u = n.args[0];
      const du = diff(u, v);
      if (!du) return null;
      const outer = OUTER[n.name];
      if (!outer) return null;
      return bin('*', outer(u), du);
    }
    default:
      return null;
  }
}

const OUTER = {
  sin: (u) => call('cos', [u]),
  cos: (u) => un('-', call('sin', [u])),
  tan: (u) => bin('/', num(1), bin('^', call('cos', [u]), num(2))),
  cot: (u) => un('-', bin('/', num(1), bin('^', call('sin', [u]), num(2)))),
  sec: (u) => bin('*', call('sec', [u]), call('tan', [u])),
  csc: (u) => un('-', bin('*', call('csc', [u]), call('cot', [u]))),
  exp: (u) => call('exp', [u]),
  ln: (u) => bin('/', num(1), u),
  log10: (u) => bin('/', num(1), bin('*', u, num(Math.LN10))),
  log2: (u) => bin('/', num(1), bin('*', u, num(Math.LN2))),
  lg: (u) => bin('/', num(1), bin('*', u, num(Math.LN10))),
  sqrt: (u) => bin('/', num(1), bin('*', num(2), call('sqrt', [u]))),
  cbrt: (u) => bin('/', num(1), bin('*', num(3), bin('^', call('cbrt', [u]), num(2)))),
  abs: (u) => call('sign', [u]),
  sign: () => ZERO,
  sinh: (u) => call('cosh', [u]),
  cosh: (u) => call('sinh', [u]),
  tanh: (u) => bin('-', num(1), bin('^', call('tanh', [u]), num(2))),
  asin: (u) => bin('/', num(1), call('sqrt', [bin('-', num(1), bin('^', u, num(2)))])),
  acos: (u) => un('-', bin('/', num(1), call('sqrt', [bin('-', num(1), bin('^', u, num(2)))]))),
  atan: (u) => bin('/', num(1), bin('+', num(1), bin('^', u, num(2)))),
};
