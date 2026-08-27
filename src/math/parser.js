// 수식 파서: 토크나이저 + Pratt 파서.
// GeoGebra 스타일의 암묵적 곱(2x, xy, 3sin x), 절댓값 |x|, 첨자 a_n,
// 비교식(=, <, ≤ …), 논리 결합(and/or), 리스트 {…}, 점 (a,b) 를 지원한다.

import { FUNCTIONS, CONSTANTS } from './functions.js';

const LETTER = /[A-Za-zΑ-ω]/;
const DIGIT = /[0-9]/;

const COMPARE = new Set(['=', '==', '<', '>', '<=', '>=', '!=']);
const RELMAP = { '≤': '<=', '≥': '>=', '≠': '!=', '≟': '=' };

export class ParseError extends Error {
  constructor(message, pos) {
    super(message);
    this.pos = pos;
  }
}

/**
 * 문자열을 토큰 배열로 자른다.
 * knownNames 에 들어 있는 이름은 통째로 하나의 토큰이 되고,
 * 그렇지 않은 알파벳 나열은 한 글자씩 쪼개져 암묵적 곱으로 해석된다. (xy -> x*y)
 */
export function tokenize(src, knownNames = new Set()) {
  const known = new Set([
    ...knownNames,
    ...Object.keys(FUNCTIONS),
    ...Object.keys(CONSTANTS),
    'and', 'or', 'not',
  ]);
  const tokens = [];
  let i = 0;
  const push = (type, value, pos) => tokens.push({ type, value, pos });

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && DIGIT.test(src[j])) j++;
      if (src[j] === '.') { j++; while (j < src.length && DIGIT.test(src[j])) j++; }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (DIGIT.test(src[k] || '')) { k++; while (k < src.length && DIGIT.test(src[k])) k++; j = k; }
      }
      push('num', parseFloat(src.slice(i, j)), i);
      i = j;
      continue;
    }

    if (LETTER.test(c)) {
      // 알파벳 덩어리를 모은 뒤, 뒤에 '(' 가 오면 통째로(사용자 함수 호출),
      // 아니면 알려진 이름 중 가장 긴 것을 우선 매칭한다.
      let j = i;
      while (j < src.length && (LETTER.test(src[j]) || DIGIT.test(src[j]))) j++;
      const run = src.slice(i, j);
      let k = j;
      while (k < src.length && src[k] === ' ') k++;
      if (src[k] === '(' && !known.has(run)) { push('name', run, i); i = j; continue; }

      let matched = null;
      for (let len = run.length; len >= 1; len--) {
        const cand = run.slice(0, len);
        if (known.has(cand)) { matched = cand; break; }
      }
      if (!matched) matched = run[0];
      push('name', matched, i);
      i += matched.length;
      continue;
    }

    if (RELMAP[c]) { push('op', RELMAP[c], i); i++; continue; }
    if (c === '≈') { push('op', '=', i); i++; continue; }

    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '!=' || two === '==') {
      push('op', two === '==' ? '=' : two, i);
      i += 2;
      continue;
    }
    if ("+-*/^%!'".includes(c)) { push('op', c, i); i++; continue; }
    if (c === '\u2032') { push('op', "'", i); i++; continue; }
    if (c === '·' || c === '×') { push('op', '*', i); i++; continue; }
    if (c === '÷') { push('op', '/', i); i++; continue; }
    if (c === '<' || c === '>' || c === '=') { push('op', c, i); i++; continue; }
    if ('()[]{},|_'.includes(c)) { push('punct', c, i); i++; continue; }
    if (c === '∧') { push('name', 'and', i); i++; continue; }
    if (c === '∨') { push('name', 'or', i); i++; continue; }
    if (c === '√') { push('name', 'sqrt', i); i++; continue; }
    throw new ParseError(`알 수 없는 문자 '${c}'`, i);
  }
  push('eof', null, src.length);
  return tokens;
}

// ── AST 생성 헬퍼 ───────────────────────────────────────────────
export const num = (v) => ({ type: 'num', value: v });
export const vari = (name) => ({ type: 'var', name });
export const bin = (op, a, b) => ({ type: 'bin', op, a, b });
export const un = (op, a) => ({ type: 'un', op, a });
export const call = (name, args) => ({ type: 'call', name, args });

class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.p = 0;
    this.barDepth = 0;
  }
  peek(k = 0) { return this.t[this.p + k]; }
  next() { return this.t[this.p++]; }
  at(type, value) {
    const tk = this.peek();
    return tk.type === type && (value === undefined || tk.value === value);
  }
  eat(type, value) {
    if (this.at(type, value)) return this.next();
    return null;
  }
  expect(type, value) {
    const tk = this.eat(type, value);
    if (!tk) throw new ParseError(`'${value ?? type}' 가 필요합니다`, this.peek().pos);
    return tk;
  }

  parseStatement() {
    const e = this.parseOr();
    if (!this.at('eof')) throw new ParseError('예상치 못한 토큰', this.peek().pos);
    return e;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.at('name', 'or')) {
      this.next();
      left = { type: 'logic', op: 'or', a: left, b: this.parseAnd() };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseCompare();
    while (this.at('name', 'and')) {
      this.next();
      left = { type: 'logic', op: 'and', a: left, b: this.parseCompare() };
    }
    return left;
  }

  parseCompare() {
    const left = this.parseAdd();
    const tk = this.peek();
    if (tk.type === 'op' && COMPARE.has(tk.value)) {
      this.next();
      const mid = this.parseAdd();
      const tk2 = this.peek();
      if (tk2.type === 'op' && COMPARE.has(tk2.value)) {
        // a < b < c  →  (a<b) and (b<c)
        this.next();
        const right = this.parseAdd();
        return {
          type: 'logic',
          op: 'and',
          a: { type: 'cmp', op: tk.value, a: left, b: mid },
          b: { type: 'cmp', op: tk2.value, a: mid, b: right },
        };
      }
      return { type: 'cmp', op: tk.value, a: left, b: mid };
    }
    return left;
  }

  parseAdd() {
    let left = this.parseMul();
    for (;;) {
      if (this.at('op', '+')) { this.next(); left = bin('+', left, this.parseMul()); }
      else if (this.at('op', '-')) { this.next(); left = bin('-', left, this.parseMul()); }
      else return left;
    }
  }

  startsFactor() {
    const tk = this.peek();
    if (tk.type === 'num') return true;
    if (tk.type === 'name') return !['and', 'or'].includes(tk.value);
    if (tk.type === 'punct') {
      if (tk.value === '|') return this.barDepth === 0;
      return tk.value === '(' || tk.value === '{' || tk.value === '[';
    }
    return false;
  }

  parseMul() {
    let left = this.parseUnary();
    for (;;) {
      if (this.at('op', '*')) { this.next(); left = bin('*', left, this.parseUnary()); }
      else if (this.at('op', '/')) { this.next(); left = bin('/', left, this.parseUnary()); }
      else if (this.at('op', '%')) { this.next(); left = call('mod', [left, this.parseUnary()]); }
      else if (this.startsFactor()) {
        // 암묵적 곱: 2x, xy, 3sin x, (x+1)(x-1)
        left = bin('*', left, this.parseUnary());
      } else return left;
    }
  }

  parseUnary() {
    if (this.at('op', '-')) { this.next(); return un('-', this.parseUnary()); }
    if (this.at('op', '+')) { this.next(); return this.parseUnary(); }
    return this.parsePower();
  }

  parsePower() {
    const base = this.parsePostfix();
    if (this.at('op', '^')) {
      this.next();
      // 지수는 오른쪽 결합, 단항 마이너스 허용: 2^-x
      return bin('^', base, this.parseUnary());
    }
    return base;
  }

  parsePostfix() {
    let e = this.parsePrimary();
    for (;;) {
      if (this.at('op', '!')) { this.next(); e = call('fact', [e]); continue; }
      if (this.at('punct', '_')) {
        this.next();
        let idx;
        if (this.eat('punct', '{')) { idx = this.parseAdd(); this.expect('punct', '}'); }
        else idx = this.parsePrimary();
        e = { type: 'index', base: e, index: idx };
        continue;
      }
      break;
    }
    return e;
  }

  parsePrimary() {
    const tk = this.peek();
    if (tk.type === 'num') { this.next(); return num(tk.value); }

    if (tk.type === 'punct' && tk.value === '(') {
      this.next();
      const first = this.parseOr();
      if (this.at('punct', ',')) {
        const items = [first];
        while (this.eat('punct', ',')) items.push(this.parseOr());
        this.expect('punct', ')');
        return { type: 'tuple', items };
      }
      this.expect('punct', ')');
      return first;
    }

    if (tk.type === 'punct' && (tk.value === '{' || tk.value === '[')) {
      const close = tk.value === '{' ? '}' : ']';
      this.next();
      const items = [];
      if (!this.at('punct', close)) {
        items.push(this.parseOr());
        while (this.eat('punct', ',')) items.push(this.parseOr());
      }
      this.expect('punct', close);
      return { type: 'list', items };
    }

    if (tk.type === 'punct' && tk.value === '|') {
      this.next();
      this.barDepth++;
      const inner = this.parseAdd();
      this.barDepth--;
      this.expect('punct', '|');
      return call('abs', [inner]);
    }

    if (tk.type === 'name') {
      this.next();
      const name = tk.value;
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) return num(CONSTANTS[name]);

      // 도함수 표기 f'(x)
      let primes = 0;
      while (this.at('op', "'")) { this.next(); primes++; }

      if (this.at('punct', '(')) {
        this.next();
        const args = [];
        if (!this.at('punct', ')')) {
          args.push(this.parseOr());
          while (this.eat('punct', ',')) args.push(this.parseOr());
        }
        this.expect('punct', ')');
        return primes ? { type: 'call', name, args, primes } : call(name, args);
      }
      if (FUNCTIONS[name]) {
        // sin x 처럼 괄호 없는 호출 — 인자는 거듭제곱까지만 묶는다 (sin x^2 = sin(x^2))
        const arg = this.parsePower();
        return call(name, [arg]);
      }
      return vari(name);
    }

    throw new ParseError('수식이 필요한 자리입니다', tk.pos);
  }
}

/** 문자열을 AST 로 파싱한다. */
export function parse(src, knownNames = new Set()) {
  const cleaned = src.replace(/'/g, "'");
  const tokens = tokenize(cleaned, knownNames);
  const p = new Parser(tokens);
  return p.parseStatement();
}

/** AST 에 등장하는 자유 변수 이름 집합 */
export function freeVars(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  switch (node.type) {
    case 'var': out.add(node.name); break;
    case 'index': freeVars(node.base, out); freeVars(node.index, out); break;
    case 'call': node.args.forEach((a) => freeVars(a, out)); break;
    case 'bin': case 'cmp': case 'logic': freeVars(node.a, out); freeVars(node.b, out); break;
    case 'un': freeVars(node.a, out); break;
    case 'list': case 'tuple': node.items.forEach((a) => freeVars(a, out)); break;
    default: break;
  }
  return out;
}

const PREC = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 };

function precOf(node) {
  if (node.type === 'bin') return PREC[node.op];
  if (node.type === 'un') return 3;
  return 10;
}

/** AST 를 사람이 읽는 수식 문자열로 되돌린다. */
export function format(node) {
  if (!node) return '';
  switch (node.type) {
    case 'num': return fmtNum(node.value);
    case 'var': return node.name;
    case 'index': {
      const idx = format(node.index);
      return `${format(node.base)}_${idx.length > 1 ? `{${idx}}` : idx}`;
    }
    case 'call': return `${node.name}(${node.args.map(format).join(', ')})`;
    case 'un': return `-${wrap(node.a, 3)}`;
    case 'bin': {
      const p = PREC[node.op];
      const right = node.op === '^' ? p : p + 1;
      const a = wrap(node.a, p);
      const b = wrap(node.b, right);
      if (node.op === '^') return `${a}^${b}`;
      if (node.op === '*') return `${a}·${b}`;
      if (node.op === '/') return `${a}/${b}`;
      return `${a} ${node.op} ${b}`;
    }
    case 'cmp': return `${format(node.a)} ${node.op} ${format(node.b)}`;
    case 'logic': return `${format(node.a)} ${node.op === 'and' ? '∧' : '∨'} ${format(node.b)}`;
    case 'tuple': return `(${node.items.map(format).join(', ')})`;
    case 'list': return `{${node.items.map(format).join(', ')}}`;
    default: return '?';
  }
}

function wrap(node, prec) {
  const s = format(node);
  return precOf(node) < prec ? `(${s})` : s;
}

export function fmtNum(v) {
  if (!isFinite(v)) return v > 0 ? '∞' : '-∞';
  if (Number.isInteger(v)) return String(v);
  const r = Math.round(v * 1e10) / 1e10;
  return String(r);
}
