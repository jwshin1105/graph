// 수식 파서: 토크나이저 + Pratt 파서.
// GeoGebra 스타일의 암묵적 곱(2x, xy, 3sin x), 절댓값 |x|, 첨자 a_n,
// 비교식(=, <, ≤ …), 논리 결합(and/or), 리스트 {…}, 점 (a,b) 를 지원한다.

import { FUNCTIONS, CONSTANTS } from './functions.js';

const LETTER = /[A-Za-zΑ-ω]/;
const DIGIT = /[0-9]/;

const COMPARE = new Set(['=', '==', '<', '>', '<=', '>=', '!=', '~']);
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
    'and', 'or', 'not', 'for', 'in',
  ]);
  const tokens = [];
  let i = 0;
  const push = (type, value, pos, text) => tokens.push({ type, value, pos, text });

  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    if (DIGIT.test(c) || (c === '.' && DIGIT.test(src[i + 1] || ''))) {
      let j = i;
      while (j < src.length && DIGIT.test(src[j])) j++;
      // 1...10 의 '.' 은 소수점이 아니라 범위 기호다
      if (src[j] === '.' && src[j + 1] !== '.') {
        j++;
        while (j < src.length && DIGIT.test(src[j])) j++;
      }
      if (src[j] === 'e' || src[j] === 'E') {
        let k = j + 1;
        if (src[k] === '+' || src[k] === '-') k++;
        if (DIGIT.test(src[k] || '')) { k++; while (k < src.length && DIGIT.test(src[k])) k++; j = k; }
      }
      // 적은 글자 그대로도 남겨 둔다 — 0.1 을 배정밀도로 바꾸면 1/10 이 아니게 된다
      push('num', parseFloat(src.slice(i, j)), i, src.slice(i, j));
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
      // 'in' 은 이름이 아니라 정의역을 가리키는 연산자다 (n in Z)
      if (matched === 'in') { push('op', '∈', i); i += 2; continue; }
      push('name', matched, i);
      i += matched.length;
      continue;
    }

    if (RELMAP[c]) { push('op', RELMAP[c], i); i++; continue; }


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
    if (c === '.' && src.slice(i, i + 3) === '...') { push('punct', '...', i); i += 3; continue; }
    if (c === '…') { push('punct', '...', i); i++; continue; }
    if (c === '~' || c === '≈') { push('op', '~', i); i++; continue; }
    if ('()[]{},|_:'.includes(c)) { push('punct', c, i); i++; continue; }
    if (c === '∈' || c === '∊') { push('op', '∈', i); i++; continue; }
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
    // n ∈ Z — 정의역 지정. 'in' 이라고 적어도 같다
    const isIn = (t) => t.type === 'op' && t.value === '∈';
    if (isIn(tk)) {
      this.next();
      const set = this.parseAdd();
      return { type: 'cmp', op: '∈', a: left, b: set };
    }
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
      if (this.at('op', '+')) { this.next(); left = bin('+', left, this.parseMul()); continue; }
      if (this.at('op', '-')) { this.next(); left = bin('-', left, this.parseMul()); continue; }
      // 정의역 제한: y = x^2 {0 < x < 3} 처럼 앞의 식 전체에 조건을 건다
      if (this.at('punct', '{') && this.braceIsPiece()) {
        const brace = this.parseBrace();
        const cases = brace.node.cases.map((c) => ({ cond: c.cond, value: c.value ?? left }));
        left = { type: 'piece', cases, otherwise: brace.node.otherwise };
        continue;
      }
      return left;
    }
  }

  startsFactor() {
    const tk = this.peek();
    if (tk.type === 'num') return true;
    if (tk.type === 'name') return !['and', 'or', 'for'].includes(tk.value);
    if (tk.type === 'punct') {
      if (tk.value === '|') return this.barDepth === 0;
      // 값 없는 조건 블록은 곱할 인수가 아니라 뒤따르는 정의역 제한이다.
      // {x<0: -1, 1} 처럼 값이 있는 조각별 식은 그냥 인수로 본다.
      if (tk.value === '{') return !this.braceIsPiece();
      return tk.value === '(' || tk.value === '[';
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

  /** 괄호 없는 함수 호출의 인자 */
  parseImplicitArg() {
    let arg = this.parsePower();
    while (this.startsFactor()) {
      const tk = this.peek();
      if (tk.type === 'name' && FUNCTIONS[tk.value]) break;   // 다른 함수는 인자에 넣지 않는다
      arg = bin('*', arg, this.parsePower());
    }
    return arg;
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

  /**
   * '[' 또는 '{' 로 시작하는 묶음을 읽는다.
   *   [1, 2, 3]              리스트
   *   [1...10]  [1,3,...,11] 범위
   *   [n^2 for n=[1...5]]    리스트 내포
   *   {x<0: -x, x^2}         조각별 정의
   *   {0<x<3}                조건(참인 곳만 남기는 제한)
   * @returns {{kind:'list'|'piece', node:object}}
   */
  /** 지금 위치의 '{' 가 조건/조각별 블록인지 미리 훑어본다 (위치는 되돌린다) */
  braceIsPiece() {
    const save = this.p;
    try {
      const r = this.parseBrace();
      this.p = save;
      return r.kind === 'piece' && r.pure;
    } catch {
      this.p = save;
      return false;
    }
  }

  parseBrace() {
    const open = this.next().value;           // '[' 또는 '{'
    const close = open === '[' ? ']' : '}';
    if (this.eat('punct', close)) return { kind: 'list', node: { type: 'list', items: [] } };

    const first = this.parseOr();

    // 범위: [a...b]
    if (this.at('punct', '...')) {
      this.next();
      const to = this.parseOr();
      this.expect('punct', close);
      return { kind: 'list', node: { type: 'range', from: first, step: null, to } };
    }
    // 리스트 내포: [expr for n = list]
    if (this.at('name', 'for')) {
      this.next();
      const v = this.expect('name').value;
      this.expect('op', '=');
      const src = this.parseOr();
      this.expect('punct', close);
      return { kind: 'list', node: { type: 'comp', body: first, varName: v, source: src } };
    }
    // 조각별 정의: 조건 : 값
    if (this.at('punct', ':')) {
      this.next();
      const cases = [{ cond: first, value: this.parseOr() }];
      let otherwise = null;
      while (this.eat('punct', ',')) {
        const e = this.parseOr();
        if (this.eat('punct', ':')) cases.push({ cond: e, value: this.parseOr() });
        else { otherwise = e; break; }
      }
      this.expect('punct', close);
      return { kind: 'piece', pure: false, node: { type: 'piece', cases, otherwise } };
    }
    // 조건 하나만 있는 제한: {0 < x < 3}
    if (this.at('punct', close) && (first.type === 'cmp' || first.type === 'logic')) {
      this.next();
      // 값이 없는 조건만 있는 블록 = "정의역 제한"
      return { kind: 'piece', pure: true, node: { type: 'piece', cases: [{ cond: first, value: null }], otherwise: null } };
    }
    // 그 밖에는 리스트
    const items = [first];
    while (this.eat('punct', ',')) {
      if (this.at('punct', '...')) {
        // [a, b, ..., c] — 간격이 정해진 범위
        this.next();
        this.eat('punct', ',');
        const to = this.parseOr();
        this.expect('punct', close);
        return { kind: 'list', node: { type: 'range', from: items[0], step: items[1] ?? null, to } };
      }
      items.push(this.parseOr());
    }
    this.expect('punct', close);
    return { kind: 'list', node: { type: 'list', items } };
  }

  parsePrimary() {
    const tk = this.peek();
    if (tk.type === 'num') { this.next(); return { type: 'num', value: tk.value, text: tk.text }; }

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
      const brace = this.parseBrace();
      return brace.node;
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
      if (Object.prototype.hasOwnProperty.call(CONSTANTS, name)) {
        // 값은 숫자로 쓰되 원래 이름을 남겨 두어 식을 다시 적을 때 π 로 보이게 한다
        return { type: 'num', value: CONSTANTS[name], sym: name };
      }

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
        // sin 2t 처럼 괄호 없는 호출.
        // 인자는 "곱해진 인수들"까지 묶되 다른 함수 이름이 나오면 거기서 끊는다.
        //   sin 2t      → sin(2t)
        //   sin x^2     → sin(x²)
        //   sin x cos x → sin(x)·cos(x)
        //   sin x + 1   → sin(x) + 1
        return call(name, [this.parseImplicitArg()]);
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
    case 'index':
      // x_1 처럼 첨자가 숫자면 'x_1' 자체가 하나의 이름이다
      if (node.base.type === 'var' && node.index.type === 'num') {
        out.add(`${node.base.name}_${node.index.value}`);
      } else {
        freeVars(node.base, out);
        freeVars(node.index, out);
      }
      break;
    case 'call': {
      node.args.forEach((a) => freeVars(a, out));
      // sum/prod/integral 의 둘째 인자는 묶인 변수이므로 자유변수가 아니다
      if (['sum', 'prod'].includes(node.name) && node.args.length === 4
          && node.args[1].type === 'var') out.delete(node.args[1].name);
      if (node.name === 'integral') {
        // 4인자면 둘째가 적분변수, 3인자면 x 가 묶인 변수
        if (node.args.length === 4 && node.args[1].type === 'var') out.delete(node.args[1].name);
        else if (node.args.length === 3) out.delete('x');
      }
      break;
    }
    case 'bin': case 'cmp': case 'logic': freeVars(node.a, out); freeVars(node.b, out); break;
    case 'un': freeVars(node.a, out); break;
    case 'list': case 'tuple': node.items.forEach((a) => freeVars(a, out)); break;
    case 'range':
      freeVars(node.from, out); freeVars(node.to, out);
      if (node.step) freeVars(node.step, out);
      break;
    case 'comp':
      freeVars(node.body, out); freeVars(node.source, out);
      out.delete(node.varName);
      break;
    case 'piece':
      node.cases.forEach((c) => { freeVars(c.cond, out); freeVars(c.value, out); });
      if (node.otherwise) freeVars(node.otherwise, out);
      break;
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
    case 'num': return node.sym || fmtNum(node.value);
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
    case 'list': return `[${node.items.map(format).join(', ')}]`;
    case 'range': return `[${format(node.from)}${node.step ? `, ${format(node.step)}` : ''}…${format(node.to)}]`;
    case 'comp': return `[${format(node.body)} for ${node.varName} = ${format(node.source)}]`;
    case 'piece': {
      const parts = node.cases.map((c) => `${format(c.cond)}: ${format(c.value)}`);
      if (node.otherwise) parts.push(format(node.otherwise));
      return `{${parts.join(', ')}}`;
    }
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
