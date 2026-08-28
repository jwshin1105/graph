// 정확한 유리수 산술 (BigInt 기반).
// 부동소수로는 x² + a y² = 1 의 판별식이 정확히 0 인지 알 수 없다.
// 기호 계산 층은 전부 이 위에서 돌아간다.

const abs = (a) => (a < 0n ? -a : a);

function gcd(a, b) {
  a = abs(a); b = abs(b);
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

export class Rat {
  /** @param {bigint} n @param {bigint} d */
  constructor(n, d = 1n) {
    if (d === 0n) throw new Error('0 으로 나눌 수 없습니다');
    if (d < 0n) { n = -n; d = -d; }
    const g = gcd(n, d) || 1n;
    this.n = n / g;
    this.d = d / g;
  }
  static of(n, d = 1n) { return new Rat(BigInt(n), BigInt(d)); }
  static get ZERO() { return RZERO; }
  static get ONE() { return RONE; }

  get isZero() { return this.n === 0n; }
  get isOne() { return this.n === 1n && this.d === 1n; }
  get isInt() { return this.d === 1n; }
  get sign() { return this.n === 0n ? 0 : this.n < 0n ? -1 : 1; }

  add(o) { return new Rat(this.n * o.d + o.n * this.d, this.d * o.d); }
  sub(o) { return new Rat(this.n * o.d - o.n * this.d, this.d * o.d); }
  mul(o) { return new Rat(this.n * o.n, this.d * o.d); }
  div(o) {
    if (o.isZero) throw new Error('0 으로 나눌 수 없습니다');
    return new Rat(this.n * o.d, this.d * o.n);
  }
  neg() { return new Rat(-this.n, this.d); }
  abs() { return new Rat(abs(this.n), this.d); }
  pow(k) {
    if (k < 0) return RONE.div(this.pow(-k));
    let r = RONE;
    let b = this;
    let e = k;
    while (e > 0) {
      if (e & 1) r = r.mul(b);
      b = b.mul(b);
      e >>= 1;
    }
    return r;
  }
  eq(o) { return this.n === o.n && this.d === o.d; }
  cmp(o) {
    const l = this.n * o.d;
    const r = o.n * this.d;
    return l < r ? -1 : l > r ? 1 : 0;
  }
  get value() { return Number(this.n) / Number(this.d); }
  toString() { return this.d === 1n ? String(this.n) : `${this.n}/${this.d}`; }
}

const RZERO = new Rat(0n, 1n);
const RONE = new Rat(1n, 1n);

/**
 * 실수를 정확한 유리수로. 소수 표기에서 온 값(0.85 → 17/20)을 되살린다.
 * 무리수라면 null.
 *
 * 되살릴 수 있는 값에는 두 조건을 함께 건다.
 *   1. 분모가 maxDen 이하일 것
 *   2. 그 분수를 부동소수로 되돌리면 원래 값과 **완전히** 같을 것
 * 배정밀도 실수는 어차피 전부 유리수라서 2번만으로는 부족하다 —
 * π 도 분모를 8천만까지 키우면 245850922/78256779 로 정확히 맞아떨어진다.
 * 사람이 소수로 적거나 슬라이더가 만들어 내는 값은 분모가 그렇게까지 크지 않으므로
 * 1번이 무리수를 걸러 내는 문턱이 된다.
 */
export function ratFromNumber(x, maxDen = 1e7) {
  if (!isFinite(x)) return null;
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return Rat.of(Math.round(x));
  const sign = x < 0 ? -1n : 1n;
  let v = Math.abs(x);
  let h1 = 1n, h0 = 0n, k1 = 0n, k0 = 1n;
  for (let i = 0; i < 40; i++) {
    const a = BigInt(Math.floor(v));
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > BigInt(maxDen)) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const frac = v - Math.floor(v);
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return k1 !== 0n && Number(h1) / Number(k1) === Math.abs(x)
    ? new Rat(sign * h1, k1) : null;
}
