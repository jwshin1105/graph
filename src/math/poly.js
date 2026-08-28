// 다변수 다항식 (계수는 정확한 유리수).
// 식이 다항식이면 기호적으로 정확히 다룰 수 있다 —
// 판별식이 정확히 0 인지, 원이 정확히 원인지 같은 판정은 이 층에서만 가능하다.

import { Rat, ratFromNumber } from './rational.js';

/** 지수 벡터를 키로 쓰는 희소 다항식 */
export class Poly {
  /**
   * @param {string[]} vars  변수 이름 (자리 순서를 정한다)
   * @param {Map<string, Rat>} [terms]  "1,0,2" → 계수
   */
  constructor(vars, terms = new Map()) {
    this.vars = vars;
    this.terms = terms;
  }

  static zero(vars) { return new Poly(vars); }
  static constant(vars, r) {
    const p = new Poly(vars);
    if (!r.isZero) p.terms.set(vars.map(() => 0).join(','), r);
    return p;
  }
  static variable(vars, name) {
    const i = vars.indexOf(name);
    if (i < 0) throw new Error(`모르는 변수: ${name}`);
    const e = vars.map((_, k) => (k === i ? 1 : 0));
    const p = new Poly(vars);
    p.terms.set(e.join(','), Rat.ONE);
    return p;
  }

  get isZero() { return this.terms.size === 0; }

  clone() { return new Poly(this.vars, new Map(this.terms)); }

  add(o) {
    const out = this.clone();
    for (const [k, v] of o.terms) {
      const cur = out.terms.get(k);
      const sum = cur ? cur.add(v) : v;
      if (sum.isZero) out.terms.delete(k);
      else out.terms.set(k, sum);
    }
    return out;
  }
  neg() {
    const out = new Poly(this.vars);
    for (const [k, v] of this.terms) out.terms.set(k, v.neg());
    return out;
  }
  sub(o) { return this.add(o.neg()); }

  mul(o) {
    const out = new Poly(this.vars);
    for (const [ka, va] of this.terms) {
      const ea = ka.split(',').map(Number);
      for (const [kb, vb] of o.terms) {
        const eb = kb.split(',').map(Number);
        const key = ea.map((x, i) => x + eb[i]).join(',');
        const cur = out.terms.get(key);
        const val = cur ? cur.add(va.mul(vb)) : va.mul(vb);
        if (val.isZero) out.terms.delete(key);
        else out.terms.set(key, val);
      }
    }
    return out;
  }

  pow(k) {
    if (k < 0) return null;
    let r = Poly.constant(this.vars, Rat.ONE);
    for (let i = 0; i < k; i++) r = r.mul(this);
    return r;
  }

  scale(r) {
    if (r.isZero) return Poly.zero(this.vars);
    const out = new Poly(this.vars);
    for (const [k, v] of this.terms) out.terms.set(k, v.mul(r));
    return out;
  }

  /** 전체 차수 */
  get degree() {
    let d = 0;
    for (const k of this.terms.keys()) {
      d = Math.max(d, k.split(',').reduce((a, b) => a + Number(b), 0));
    }
    return this.terms.size ? d : -Infinity;
  }

  /** 특정 변수에 대한 차수 */
  degreeIn(name) {
    const i = this.vars.indexOf(name);
    if (i < 0) return 0;
    let d = 0;
    for (const k of this.terms.keys()) d = Math.max(d, Number(k.split(',')[i]));
    return this.terms.size ? d : -Infinity;
  }

  /** 주어진 지수 조합의 계수 */
  coeff(exps) { return this.terms.get(exps.join(',')) || Rat.ZERO; }

  /** 한 변수만 남기고 나머지에 값을 넣어 1변수 계수 배열(낮은 차수부터)로 */
  toUnivariate(name, env = {}) {
    const i = this.vars.indexOf(name);
    if (i < 0) return null;
    const out = [];
    for (const [k, v] of this.terms) {
      const e = k.split(',').map(Number);
      let c = v;
      for (let j = 0; j < e.length; j++) {
        if (j === i) continue;
        if (e[j] === 0) continue;
        const val = env[this.vars[j]];
        if (val === undefined) return null;      // 값이 안 정해진 변수가 남았다
        c = c.mul(val.pow(e[j]));
      }
      const d = e[i];
      out[d] = (out[d] || Rat.ZERO).add(c);
    }
    for (let d = 0; d < out.length; d++) if (!out[d]) out[d] = Rat.ZERO;
    while (out.length && out[out.length - 1].isZero) out.pop();
    return out;
  }

  /** 변수 일부에 유리수를 대입해 남은 다항식 */
  substitute(env) {
    const keep = this.vars.filter((v) => env[v] === undefined);
    const out = new Poly(keep);
    for (const [k, v] of this.terms) {
      const e = k.split(',').map(Number);
      let c = v;
      const rest = [];
      this.vars.forEach((name, j) => {
        if (env[name] !== undefined) {
          if (e[j]) c = c.mul(env[name].pow(e[j]));
        } else rest.push(e[j]);
      });
      if (c.isZero) continue;
      const key = rest.join(',');
      const cur = out.terms.get(key);
      const sum = cur ? cur.add(c) : c;
      if (sum.isZero) out.terms.delete(key);
      else out.terms.set(key, sum);
    }
    return out;
  }

  /** 수치 평가 */
  evaluate(env) {
    let s = 0;
    for (const [k, v] of this.terms) {
      const e = k.split(',').map(Number);
      let t = v.value;
      for (let j = 0; j < e.length; j++) if (e[j]) t *= Math.pow(env[this.vars[j]] ?? 0, e[j]);
      s += t;
    }
    return s;
  }

  /** name 에 대한 편미분 */
  derivative(name) {
    const i = this.vars.indexOf(name);
    const out = new Poly(this.vars);
    if (i < 0) return out;
    for (const [k, v] of this.terms) {
      const e = k.split(',').map(Number);
      if (!e[i]) continue;
      const c = v.mul(Rat.of(e[i]));
      const ne = e.slice();
      ne[i] -= 1;
      const key = ne.join(',');
      const cur = out.terms.get(key);
      const sum = cur ? cur.add(c) : c;
      if (sum.isZero) out.terms.delete(key);
      else out.terms.set(key, sum);
    }
    return out;
  }

  toString() {
    if (this.isZero) return '0';
    const parts = [];
    const keys = [...this.terms.keys()].sort((a, b) => {
      const da = a.split(',').reduce((x, y) => x + Number(y), 0);
      const db = b.split(',').reduce((x, y) => x + Number(y), 0);
      return db - da || a.localeCompare(b);
    });
    for (const k of keys) {
      const v = this.terms.get(k);
      const e = k.split(',').map(Number);
      const mono = e.map((p, i) => (p === 0 ? '' : p === 1 ? this.vars[i] : `${this.vars[i]}^${p}`))
        .filter(Boolean).join('·');
      const c = v.toString();
      parts.push(mono ? (c === '1' ? mono : c === '-1' ? `-${mono}` : `${c}·${mono}`) : c);
    }
    return parts.join(' + ').replace(/\+ -/g, '- ');
  }
}

/**
 * AST 를 다항식으로. 다항식이 아니면 null.
 * @param {object} node
 * @param {string[]} vars   다항식의 변수로 볼 이름들
 * @param {Map<string,Rat>} [consts]  값이 정해진 이름 (슬라이더 등)
 */
export function toPoly(node, vars, consts = new Map()) {
  const P = (r) => Poly.constant(vars, r);
  const walk = (n) => {
    if (!n) return null;
    switch (n.type) {
      case 'num': {
        // π, e 처럼 이름이 붙은 상수는 유리수가 아니다.
        // (π 의 배정밀도 값은 245850922/78256779 와 정확히 같아서 그냥 두면 속는다)
        if (n.sym) return null;
        const r = ratFromNumber(n.value);
        return r ? P(r) : null;
      }
      case 'var': {
        if (vars.includes(n.name)) return Poly.variable(vars, n.name);
        const c = consts.get(n.name);
        return c ? P(c) : null;
      }
      case 'un': {
        const a = walk(n.a);
        return a ? a.neg() : null;
      }
      case 'bin': {
        const a = walk(n.a);
        if (!a) return null;
        if (n.op === '^') {
          // 지수는 음이 아닌 정수여야 한다
          if (n.b.type !== 'num' || !Number.isInteger(n.b.value) || n.b.value < 0
              || n.b.value > 24) return null;
          return a.pow(n.b.value);
        }
        const b = walk(n.b);
        if (!b) return null;
        if (n.op === '+') return a.add(b);
        if (n.op === '-') return a.sub(b);
        if (n.op === '*') return a.mul(b);
        if (n.op === '/') {
          // 상수로 나누는 것만 허용
          if (b.degree > 0 || b.isZero) return null;
          return a.scale(Rat.ONE.div(b.coeff(vars.map(() => 0))));
        }
        return null;
      }
      case 'cmp':
        if (n.op !== '=') return null;
        {
          const a = walk(n.a);
          const b = walk(n.b);
          return a && b ? a.sub(b) : null;
        }
      default:
        return null;
    }
  };
  return walk(node);
}
