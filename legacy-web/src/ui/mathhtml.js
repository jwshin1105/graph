// 수식 AST 를 "수학처럼 보이는" HTML 로 그린다.
// 분수는 위아래로 쌓고, 지수는 위첨자로, 근호는 웃선을 씌운다.
// LaTeX 엔진을 들이지 않고도 입력한 식을 훨씬 읽기 쉽게 만든다.

import { fmtNum } from '../math/parser.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };
const precOf = (n) => (n.type === 'bin' ? PREC[n.op] : n.type === 'un' ? 3 : 10);

// 분수를 몇 겹까지 위아래로 쌓을지. 더 깊어지면 한 줄(a/b)로 적어 높이가 치솟지 않게 한다.
const MAX_STACK = 2;

const FUNC_NAMES = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'ln', 'log', 'exp',
  'min', 'max', 'mod', 'gcd', 'lcm', 'sign', 'floor', 'ceil', 'round', 'mean', 'median',
  'total', 'stdev', 'length', 'sort', 'quantile', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh']);

export function renderMath(node) {
  return `<span class="mh">${walk(node, 0)}</span>`;
}

function wrap(node, prec, lv) {
  const s = walk(node, lv);
  return precOf(node) < prec ? `<span class="mh-paren">(</span>${s}<span class="mh-paren">)</span>` : s;
}

function walk(n, lv = 0) {
  if (!n || typeof n !== 'object') return '';
  switch (n.type) {
    case 'num':
      return `<i class="mh-n">${esc(n.sym || fmtNum(n.value))}</i>`;
    case 'var':
      return `<i class="mh-v">${esc(n.name)}</i>`;
    case 'index':
      return `${walk(n.base, lv)}<sub class="mh-sub">${walk(n.index, lv)}</sub>`;
    case 'un':
      return `−${wrap(n.a, 3, lv)}`;
    case 'bin': {
      if (n.op === '/' && lv < MAX_STACK) {
        return `<span class="mh-frac"><span class="mh-num">${walk(n.a, lv + 1)}</span>`
          + `<span class="mh-den">${walk(n.b, lv + 1)}</span></span>`;
      }
      if (n.op === '^') {
        return `${wrap(n.a, 5, lv)}<sup class="mh-sup">${walk(n.b, lv)}</sup>`;
      }
      const p = PREC[n.op];
      const a = wrap(n.a, p, lv);
      const b = wrap(n.b, p + 1, lv);
      if (n.op === '*') return `${a}<span class="mh-op">·</span>${b}`;
      if (n.op === '/') return `${a}<span class="mh-op">/</span>${b}`;
      return `${a}<span class="mh-op"> ${n.op === '-' ? '−' : '+'} </span>${b}`;
    }
    case 'call': {
      if (n.name === 'sqrt' && n.args.length === 1) {
        return `<span class="mh-sqrt">√<span class="mh-rad">${walk(n.args[0], lv)}</span></span>`;
      }
      if (n.name === 'abs' && n.args.length === 1) {
        return `<span class="mh-abs">${walk(n.args[0], lv)}</span>`;
      }
      if (n.name === 'fact' && n.args.length === 1) return `${wrap(n.args[0], 5, lv)}!`;
      const label = FUNC_NAMES.has(n.name) ? `<span class="mh-fn">${esc(n.name)}</span>`
        : `<i class="mh-v">${esc(n.name)}</i>`;
      const primes = n.primes ? "′".repeat(n.primes) : '';
      return `${label}${primes}<span class="mh-paren">(</span>`
        + n.args.map((c) => walk(c, lv)).join('<span class="mh-op">, </span>')
        + '<span class="mh-paren">)</span>';
    }
    case 'cmp': {
      const sym = { '=': '=', '<': '<', '>': '>', '<=': '≤', '>=': '≥', '!=': '≠', '~': '∼' }[n.op];
      return `${walk(n.a, lv)}<span class="mh-rel">${sym}</span>${walk(n.b, lv)}`;
    }
    case 'logic':
      return `${walk(n.a, lv)}<span class="mh-rel">${n.op === 'and' ? '∧' : '∨'}</span>${walk(n.b, lv)}`;
    case 'tuple':
      return `<span class="mh-paren">(</span>`
        + n.items.map((c) => walk(c, lv)).join('<span class="mh-op">, </span>')
        + '<span class="mh-paren">)</span>';
    case 'list':
      return '<span class="mh-paren">[</span>'
        + n.items.map((c) => walk(c, lv)).join('<span class="mh-op">, </span>')
        + '<span class="mh-paren">]</span>';
    case 'range':
      return '<span class="mh-paren">[</span>' + walk(n.from, lv)
        + (n.step ? `<span class="mh-op">, </span>${walk(n.step, lv)}` : '')
        + '<span class="mh-op">…</span>' + walk(n.to, lv) + '<span class="mh-paren">]</span>';
    case 'comp':
      return '<span class="mh-paren">[</span>' + walk(n.body, lv)
        + `<span class="mh-fn"> for </span><i class="mh-v">${esc(n.varName)}</i>`
        + '<span class="mh-rel">=</span>' + walk(n.source, lv) + '<span class="mh-paren">]</span>';
    case 'piece': {
      const parts = n.cases.map((c) =>
        `${walk(c.cond, lv)}<span class="mh-op">: </span>${walk(c.value, lv)}`);
      if (n.otherwise) parts.push(walk(n.otherwise, lv));
      return '<span class="mh-brace">{</span>' + parts.join('<span class="mh-op">, </span>')
        + '<span class="mh-brace">}</span>';
    }
    default:
      return '';
  }
}
