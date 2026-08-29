// 정확값 층 — 유리수·근호·π·e 를 부동소수로 바꾸지 않고 그대로 들고 다닌다.
//
// 0.1 + 0.2 는 0.30000000000000004 가 아니라 3/10 이고, (√2)² 는 2.0000000000000004 가
// 아니라 2 다. 정확히 답할 수 있는 계산은 정확히 답하고, 그러지 못할 때만 고정밀 수치로
// 물러선다. 브라우저에서 SymPy 를 쓸 수 없으므로 그 자리를 대신하는 층이다.
//
// 값의 꼴:  Σ cᵢ · mᵢ    (cᵢ 는 유리수, mᵢ 는 원자들의 곱)
//   원자 — π, e, √n (n 은 제곱인수 없는 정수), ln(유리수)
//   예)  (1 + √5)/2,  3√2/2,  π/4,  2 − 3π + √6
// 이 꼴을 벗어나는 값(sin 1, e^π …)은 정확값이 없다고 보고 고정밀 수치로 넘긴다.

import { Rat, ratFromNumber } from './rational.js';
import * as BF from './bigfloat.js';

const B = BF.BigFloat;

// ── 원자와 단항식 ───────────────────────────────────────
/** 원자 키: 'pi' | 'e' | 'sqrt:<n>' | 'ln:<p/q>' */
const sqrtKey = (n) => `sqrt:${n}`;
const lnKey = (r) => `ln:${r.toString()}`;

/** 단항식 = 원자 → 지수(정수). 빈 Map 은 1 을 뜻한다 */
function monKey(m) {
  return [...m.entries()].filter(([, e]) => e !== 0)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([k, e]) => (e === 1 ? k : `${k}^${e}`)).join('*');
}

/** n 에서 제곱인수를 뽑아 [밖으로 나온 수, 남은 근호 속] */
function splitSquare(n) {
  let out = 1n;
  let rest = n;
  for (let i = 2n; i * i <= rest && i < 100000n; i++) {
    while (rest % (i * i) === 0n) { rest /= i * i; out *= i; }
  }
  return [out, rest];
}

const bgcd = (a, b) => { let x = a < 0n ? -a : a; let y = b < 0n ? -b : b; while (y) { [x, y] = [y, x % y]; } return x; };

/**
 * 정확값. terms: Map<단항식키, {coef: Rat, mon: Map<원자, 지수>}>
 */
export class Exact {
  constructor(terms = new Map()) { this.terms = terms; }

  static zero() { return new Exact(); }
  static rat(r) {
    if (r.isZero) return Exact.zero();
    return new Exact(new Map([['', { coef: r, mon: new Map() }]]));
  }
  static int(n) { return Exact.rat(Rat.of(n)); }
  /** √n (n 은 양의 정수) */
  static sqrtInt(n) {
    const [out, rest] = splitSquare(n);
    const c = Rat.of(out);
    if (rest === 1n) return Exact.rat(c);
    const mon = new Map([[sqrtKey(rest), 1]]);
    return new Exact(new Map([[monKey(mon), { coef: c, mon }]]));
  }
  static atom(key) {
    const mon = new Map([[key, 1]]);
    return new Exact(new Map([[monKey(mon), { coef: Rat.ONE, mon }]]));
  }
  static get PI() { return Exact.atom('pi'); }
  static get E() { return Exact.atom('e'); }

  get isZero() { return this.terms.size === 0; }
  /** 유리수 하나뿐인가 */
  get asRat() {
    if (this.terms.size === 0) return Rat.ZERO;
    if (this.terms.size !== 1) return null;
    const t = this.terms.get('');
    return t ? t.coef : null;
  }
  get isRat() { return this.asRat !== null; }

  add(o) {
    const out = new Map();
    for (const [k, t] of this.terms) out.set(k, { coef: t.coef, mon: t.mon });
    for (const [k, t] of o.terms) {
      const cur = out.get(k);
      if (!cur) { out.set(k, { coef: t.coef, mon: t.mon }); continue; }
      const c = cur.coef.add(t.coef);
      if (c.isZero) out.delete(k); else out.set(k, { coef: c, mon: t.mon });
    }
    return new Exact(out);
  }
  neg() {
    const out = new Map();
    for (const [k, t] of this.terms) out.set(k, { coef: t.coef.neg(), mon: t.mon });
    return new Exact(out);
  }
  sub(o) { return this.add(o.neg()); }

  mul(o) {
    let out = new Exact();
    for (const [, a] of this.terms) {
      for (const [, b] of o.terms) {
        const [coef, mon] = mulMon(a.coef.mul(b.coef), a.mon, b.mon);
        if (coef.isZero) continue;
        const k = monKey(mon);
        const cur = out.terms.get(k);
        const c = cur ? cur.coef.add(coef) : coef;
        if (c.isZero) out.terms.delete(k);
        else out.terms.set(k, { coef: c, mon });
      }
    }
    return out;
  }

  /** 나누기 — 나누는 쪽이 한 항이거나 a + b√n 꼴일 때만 정확하다 */
  div(o) {
    if (o.isZero) return null;
    if (o.terms.size === 1) {
      const [, t] = [...o.terms][0];
      const inv = invMon(t.coef, t.mon);
      if (!inv) return null;
      return this.mul(inv);
    }
    if (o.terms.size === 2) {
      // (a + b√n) 의 켤레를 곱해 분모를 유리화한다
      const list = [...o.terms.values()];
      const conj = new Exact(new Map());
      let sqrtCount = 0;
      for (const t of list) {
        const isSqrt = [...t.mon.keys()].some((k) => k.startsWith('sqrt:'));
        if (isSqrt) sqrtCount++;
        const k = monKey(t.mon);
        conj.terms.set(k, { coef: isSqrt ? t.coef.neg() : t.coef, mon: t.mon });
      }
      if (sqrtCount !== 1) return null;
      const den = o.mul(conj);
      if (!den.isRat) return null;
      const r = den.asRat;
      if (r.isZero) return null;
      return this.mul(conj).mul(Exact.rat(Rat.ONE.div(r)));
    }
    return null;
  }

  /** 정수 거듭제곱 */
  pow(k) {
    if (!Number.isInteger(k)) return null;
    if (k === 0) return Exact.int(1);
    if (k < 0) {
      const p = this.pow(-k);
      return p ? Exact.int(1).div(p) : null;
    }
    if (k > 4096) return null;
    let r = Exact.int(1);
    let base = this;
    let n = k;
    while (n > 0) {
      if (n & 1) r = r.mul(base);
      base = base.mul(base);
      n >>= 1;
    }
    return r;
  }

  /** 제곱근 — 유리수 하나일 때만 정확하다 */
  sqrt() {
    const r = this.asRat;
    if (r === null || r.sign < 0) return null;
    if (r.isZero) return Exact.zero();
    // √(p/q) = √(p·q)/q
    const inner = Exact.sqrtInt(r.n * r.d);
    return inner.mul(Exact.rat(new Rat(1n, r.d)));
  }

  /** 고정밀 수치로 (BigFloat) */
  toBig(p) {
    let acc = B.zero();
    const wp = p + 8;
    for (const [, t] of this.terms) {
      let v = ratToBig(t.coef, wp);
      for (const [key, e] of t.mon) {
        const a = atomBig(key, wp);
        if (!a) return null;
        const pw = BF.pow(a, B.fromInt(e), wp);
        if (!pw) return null;
        v = BF.mul(v, pw, wp);
      }
      acc = BF.add(acc, v, wp);
    }
    return acc.round(p);
  }

  toNumber() {
    const b = this.toBig(25);
    return b ? b.toNumber() : NaN;
  }

  /** 사람이 읽는 꼴 — "(1 + √5)/2", "3√2/2", "π/4" */
  toString() { return exactText(this); }
}

function mulMon(coef, a, b) {
  const mon = new Map(a);
  let c = coef;
  for (const [k, e] of b) mon.set(k, (mon.get(k) || 0) + e);
  // √n · √n = n
  for (const [k, e] of [...mon]) {
    if (!k.startsWith('sqrt:')) continue;
    const n = BigInt(k.slice(5));
    const pairs = Math.floor(Math.abs(e) / 2) * Math.sign(e);
    if (pairs) {
      c = e > 0 ? c.mul(Rat.of(n).pow(pairs)) : c.div(Rat.of(n).pow(-pairs));
      mon.set(k, e - 2 * pairs);
    }
  }
  for (const [k, e] of [...mon]) if (e === 0) mon.delete(k);
  // √a · √b = √(ab) — 근호를 하나로 모은다
  const roots = [...mon.keys()].filter((k) => k.startsWith('sqrt:') && mon.get(k) === 1);
  if (roots.length > 1) {
    let prod = 1n;
    for (const k of roots) { prod *= BigInt(k.slice(5)); mon.delete(k); }
    const [out, rest] = splitSquare(prod);
    c = c.mul(Rat.of(out));
    if (rest !== 1n) mon.set(sqrtKey(rest), 1);
  }
  return [c, mon];
}

function invMon(coef, mon) {
  if (coef.isZero) return null;
  let c = Rat.ONE.div(coef);
  const out = new Map();
  for (const [k, e] of mon) {
    if (k.startsWith('sqrt:')) {
      // 1/√n = √n/n — 분모를 유리화한다
      if (e !== 1) return null;
      const n = BigInt(k.slice(5));
      c = c.div(Rat.of(n));
      out.set(k, 1);
    } else out.set(k, -e);
  }
  return new Exact(new Map([[monKey(out), { coef: c, mon: out }]]));
}

function ratToBig(r, p) {
  const n = B.fromBigInt(r.n);
  const d = B.fromBigInt(r.d);
  return r.d === 1n ? n : BF.div(n, d, p);
}

function atomBig(key, p) {
  if (key === 'pi') return BF.PI(p);
  if (key === 'e') return BF.E(p);
  if (key.startsWith('sqrt:')) return BF.sqrt(B.fromBigInt(BigInt(key.slice(5))), p);
  if (key.startsWith('ln:')) {
    const t = key.slice(3);
    const [n, d] = t.includes('/') ? t.split('/') : [t, '1'];
    const v = BF.div(B.fromBigInt(BigInt(n)), B.fromBigInt(BigInt(d)), p + 4);
    return BF.ln(v, p);
  }
  return null;
}

// ── 글로 옮기기 ─────────────────────────────────────────
function monText(mon) {
  const parts = [];
  for (const [k, e] of [...mon].sort()) {
    let base;
    if (k === 'pi') base = 'π';
    else if (k === 'e') base = 'e';
    else if (k.startsWith('sqrt:')) base = `√${k.slice(5)}`;
    else if (k.startsWith('ln:')) base = `ln ${k.slice(3)}`;
    else base = k;
    parts.push(e === 1 ? base : `${base}^${e}`);
  }
  return parts.join('·');
}

function exactText(v) {
  if (v.isZero) return '0';
  // 분모를 하나로 모아 (1 + √5)/2 처럼 적는다
  let den = 1n;
  for (const [, t] of v.terms) den = (den * t.coef.d) / bgcd(den, t.coef.d);
  const parts = [];
  for (const [, t] of [...v.terms].sort((a, b) => (a[0] > b[0] ? 1 : -1))) {
    const num = (t.coef.n * den) / t.coef.d;
    const mag = num < 0n ? -num : num;
    const mt = monText(t.mon);
    let body;
    if (!mt) body = String(mag);
    else if (mag === 1n) body = mt;
    // 2π, 3√2 처럼 기호 앞에는 곱셈 점을 찍지 않는다 (2·e^2 처럼 헷갈릴 때만 찍는다)
    else body = `${mag}${/^[√πe]/.test(mt) ? '' : '·'}${mt}`;
    parts.push({ neg: num < 0n, body });
  }
  let s = parts.map((p, i) => (i === 0 ? (p.neg ? `-${p.body}` : p.body)
    : (p.neg ? ` - ${p.body}` : ` + ${p.body}`))).join('');
  if (den !== 1n) s = parts.length > 1 ? `(${s})/${den}` : `${s}/${den}`;
  return s;
}

// ── AST 를 정확값으로 ───────────────────────────────────
/** 특별한 각의 삼각함수 값 (x 는 π 의 유리수배) */
function trigExact(name, arg) {
  // arg 가 π 의 유리수배인가
  const t = arg.terms.size === 1 ? [...arg.terms.values()][0] : null;
  let q = null;
  if (arg.isZero) q = Rat.ZERO;
  else if (t && t.mon.size === 1 && t.mon.get('pi') === 1) q = t.coef;
  if (q === null) return null;
  // 주기로 줄인다: sin, cos 는 2, tan 은 1
  const per = name === 'tan' ? Rat.ONE : Rat.of(2);
  let k = q;
  const times = Math.floor(k.div(per).value);
  k = k.sub(per.mul(Rat.of(times)));
  const num = Number(k.n);
  const den = Number(k.d);
  if (den > 12) return null;
  const key = `${name}:${num}/${den}`;
  const table = TRIG_TABLE[key];
  return table === undefined ? null : table;
}

const S = (str) => str;
/** 특수각 표. 값은 정확값을 만드는 함수로 담는다 */
const TRIG_TABLE = (() => {
  const half = Exact.rat(new Rat(1n, 2n));
  const r2 = Exact.sqrtInt(2n).mul(half);            // √2/2
  const r3 = Exact.sqrtInt(3n).mul(half);            // √3/2
  const one = Exact.int(1);
  const zero = Exact.zero();
  const t = {};
  const set = (name, q, v) => { t[`${name}:${q}`] = v; };
  // sin — [0, 2)π
  const sinVals = [['0/1', zero], ['1/6', half], ['1/4', r2], ['1/3', r3], ['1/2', one],
    ['2/3', r3], ['3/4', r2], ['5/6', half], ['1/1', zero],
    ['7/6', half.neg()], ['5/4', r2.neg()], ['4/3', r3.neg()], ['3/2', one.neg()],
    ['5/3', r3.neg()], ['7/4', r2.neg()], ['11/6', half.neg()]];
  for (const [q, v] of sinVals) set('sin', q, v);
  const cosVals = [['0/1', one], ['1/6', r3], ['1/4', r2], ['1/3', half], ['1/2', zero],
    ['2/3', half.neg()], ['3/4', r2.neg()], ['5/6', r3.neg()], ['1/1', one.neg()],
    ['7/6', r3.neg()], ['5/4', r2.neg()], ['4/3', half.neg()], ['3/2', zero],
    ['5/3', half], ['7/4', r2], ['11/6', r3]];
  for (const [q, v] of cosVals) set('cos', q, v);
  const tanVals = [['0/1', zero], ['1/6', Exact.sqrtInt(3n).mul(Exact.rat(new Rat(1n, 3n)))],
    ['1/4', one], ['1/3', Exact.sqrtInt(3n)],
    ['2/3', Exact.sqrtInt(3n).neg()], ['3/4', one.neg()],
    ['5/6', Exact.sqrtInt(3n).mul(Exact.rat(new Rat(1n, 3n))).neg()]];
  for (const [q, v] of tanVals) set('tan', q, v);
  set('tan', '1/2', null);          // 정의되지 않음
  return t;
})();
void S;

/**
 * AST 를 정확값으로. 정확히 다룰 수 없으면 null.
 * @param {object} node
 * @param {Map<string, Exact>} [consts]  이름 → 정확값
 */
export function toExact(node, consts = new Map()) {
  const walk = (n) => {
    if (!n) return null;
    switch (n.type) {
      case 'num': {
        if (n.sym === 'pi' || n.sym === 'π') return Exact.PI;
        if (n.sym === 'e') return Exact.E;
        if (n.sym) return null;
        // 원본 글자가 남아 있으면 그것으로 (0.1 은 정확히 1/10)
        if (n.text) {
          const bf = B.parse(n.text);
          if (bf) return Exact.rat(bigToRat(bf));
        }
        const r = ratFromNumber(n.value);
        return r ? Exact.rat(r) : null;
      }
      case 'var': {
        const c = consts.get(n.name);
        return c || null;
      }
      case 'un': {
        const a = walk(n.a);
        return a ? a.neg() : null;
      }
      case 'bin': {
        const a = walk(n.a);
        if (!a) return null;
        if (n.op === '^') {
          const b = walk(n.b);
          if (!b) return null;
          const r = b.asRat;
          if (r && r.isInt) return a.pow(Number(r.n));
          if (r && r.d === 2n) {                    // x^(k/2) = (√x)^k
            const s = a.sqrt();
            return s ? s.pow(Number(r.n)) : null;
          }
          return null;
        }
        const b = walk(n.b);
        if (!b) return null;
        if (n.op === '+') return a.add(b);
        if (n.op === '-') return a.sub(b);
        if (n.op === '*') return a.mul(b);
        if (n.op === '/') return a.div(b);
        return null;
      }
      case 'call': {
        const args = (n.args || []).map(walk);
        if (args.some((x) => !x)) return null;
        return callExact(n.name, args);
      }
      case 'cmp':
      case 'logic':
      default:
        return null;
    }
  };
  return walk(node);
}

function callExact(name, args) {
  const [a, b] = args;
  switch (name) {
    case 'sqrt': return a.sqrt();
    case 'abs': {
      const r = a.asRat;
      if (r) return Exact.rat(r.abs());
      const v = a.toNumber();
      return isFinite(v) ? (v < 0 ? a.neg() : a) : null;
    }
    case 'sin': case 'cos': case 'tan': return trigExact(name, a);
    case 'exp': return a.isZero ? Exact.int(1) : (isOne(a) ? Exact.E : null);
    case 'ln': case 'log': {
      if (name === 'log' && b) return null;
      const r = a.asRat;
      if (r && r.isOne) return Exact.zero();
      if (isE(a)) return Exact.int(1);
      if (r && r.sign > 0) {
        const mon = new Map([[lnKey(r), 1]]);
        return new Exact(new Map([[monKey(mon), { coef: Rat.ONE, mon }]]));
      }
      return null;
    }
    case 'fact': {
      const r = a.asRat;
      if (!r || !r.isInt || r.sign < 0 || r.n > 3000n) return null;
      let f = 1n;
      for (let i = 2n; i <= r.n; i++) f *= i;
      return Exact.rat(Rat.of(f));
    }
    case 'floor': case 'ceil': case 'round': {
      const r = a.asRat;
      if (!r) return null;
      const q = r.value;
      const v = name === 'floor' ? Math.floor(q) : name === 'ceil' ? Math.ceil(q) : Math.round(q);
      return Number.isFinite(v) ? Exact.int(v) : null;
    }
    case 'min': case 'max': {
      if (args.length !== 2) return null;
      const x = a.toNumber();
      const y = b.toNumber();
      if (!isFinite(x) || !isFinite(y)) return null;
      return (name === 'min') === (x < y) ? a : b;
    }
    default: return null;
  }
}

const isOne = (v) => { const r = v.asRat; return !!r && r.isOne; };
const isE = (v) => v.terms.size === 1 && [...v.terms.values()][0].mon.get('e') === 1
  && [...v.terms.values()][0].coef.isOne;

/**
 * 정확값이 없을 때 쓰는 고정밀 수치 평가.
 * 배정밀도로 한 번에 계산하는 것과 달리, 자릿수를 원하는 만큼 늘려 오차를 눌러 둔다.
 * @returns {BigFloat|null}
 */
export function evalBig(node, consts = new Map(), p = 30) {
  const wp = p + 8;
  const walk = (n) => {
    if (!n) return null;
    switch (n.type) {
      case 'num': {
        if (n.sym === 'pi' || n.sym === 'π') return BF.PI(wp);
        if (n.sym === 'tau' || n.sym === 'τ') return BF.mul(BF.PI(wp), B.fromInt(2), wp);
        if (n.sym === 'e') return BF.E(wp);
        if (n.sym === 'phi' || n.sym === 'φ') {
          return BF.div(BF.add(B.fromInt(1), BF.sqrt(B.fromInt(5), wp), wp), B.fromInt(2), wp);
        }
        if (n.sym) return null;
        return n.text ? B.parse(n.text) : B.fromNumber(n.value);
      }
      case 'var': {
        const c = consts.get(n.name);
        if (!c) return null;
        return c instanceof Exact ? c.toBig(wp) : c;
      }
      case 'un': { const a = walk(n.a); return a ? a.neg() : null; }
      case 'bin': {
        const a = walk(n.a);
        const b = walk(n.b);
        if (!a || !b) return null;
        if (n.op === '+') return BF.add(a, b, wp);
        if (n.op === '-') return BF.sub(a, b, wp);
        if (n.op === '*') return BF.mul(a, b, wp);
        if (n.op === '/') return BF.div(a, b, wp);
        if (n.op === '^') return BF.pow(a, b, wp);
        return null;
      }
      case 'call': {
        const args = (n.args || []).map(walk);
        if (args.some((x) => !x)) return null;
        const [a, b] = args;
        switch (n.name) {
          case 'sqrt': return BF.sqrt(a, wp);
          case 'abs': return a.abs();
          case 'sin': return BF.sin(a, wp);
          case 'cos': return BF.cos(a, wp);
          case 'tan': return BF.tan(a, wp);
          case 'atan': return BF.atan(a, wp);
          case 'exp': return BF.exp(a, wp);
          case 'ln': return BF.ln(a, wp);
          case 'log': {
            if (!b) return null;
            const num = BF.ln(b, wp);
            const den = BF.ln(a, wp);
            return num && den ? BF.div(num, den, wp) : null;
          }
          default: return null;
        }
      }
      default: return null;
    }
  };
  const v = walk(node);
  return v ? v.round(p) : null;
}

/** BigFloat(십진 유한소수) → 정확한 유리수 */
export function bigToRat(bf) {
  if (bf.s === 0) return Rat.ZERO;
  const m = BigInt(bf.s) * bf.m;
  if (bf.e >= 0) return Rat.of(m * 10n ** BigInt(bf.e));
  return new Rat(m, 10n ** BigInt(-bf.e));
}

export { Rat };
