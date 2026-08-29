// 임의 정밀도 십진 부동소수.
//
// 배정밀도(float64)는 유효숫자가 15~16자리뿐이라 0.1 + 0.2 가 0.30000000000000004 이 되고,
// 10¹⁶ + 1 − 10¹⁶ 은 0 이 된다. 정확한 값이 유리수나 근호로 안 떨어지는 계산
// (∫e^(−x²)dx, sin 1, e^π …)에서는 자릿수를 원하는 만큼 늘려 계산해야 한다.
//
// 값은  sign · mantissa · 10^exp  로 담는다. mantissa 는 BigInt 라 자릿수 제한이 없고,
// 연산할 때마다 정해진 유효숫자로 반올림한다. 브라우저에서 돌아야 해서 mpmath 를 쓸 수
// 없으므로 그 자리를 대신하는 층이다.

const TEN = 10n;

/** 10^k (k ≥ 0) */
function pow10(k) {
  return TEN ** BigInt(k);
}

/** BigInt 의 십진 자릿수 */
function digitsOf(m) {
  if (m === 0n) return 1;
  let n = m < 0n ? -m : m;
  let d = 0;
  // 큰 수는 먼저 성큼성큼 줄인다
  while (n >= 10n ** 32n) { n /= 10n ** 32n; d += 32; }
  while (n > 0n) { n /= TEN; d++; }
  return d;
}

/** m 을 유효숫자 p 자리로 반올림해 [m', 버린 자릿수] 를 돌려준다 */
function roundDigits(m, p) {
  const d = digitsOf(m);
  if (d <= p) return [m, 0];
  const drop = d - p;
  const div = pow10(drop);
  const q = m / div;
  const r = m % div;
  const half = div / 2n;
  return [r >= half ? q + 1n : q, drop];
}

export class BigFloat {
  /**
   * @param {number} s  부호 (-1, 0, 1)
   * @param {bigint} m  가수 (0 이상)
   * @param {number} e  10 의 지수
   */
  constructor(s, m, e) {
    if (m === 0n) { this.s = 0; this.m = 0n; this.e = 0; return; }
    // 뒤쪽 0 은 지수로 옮겨 가수를 짧게 유지한다
    while (m % 10n === 0n) { m /= TEN; e += 1; }
    this.s = s;
    this.m = m;
    this.e = e;
  }

  static zero() { return new BigFloat(0, 0n, 0); }

  /** 정수·유리수·배정밀도에서 만든다 */
  static fromInt(n) {
    const b = BigInt(n);
    return b < 0n ? new BigFloat(-1, -b, 0) : new BigFloat(b === 0n ? 0 : 1, b, 0);
  }

  static fromBigInt(b) {
    return b < 0n ? new BigFloat(-1, -b, 0) : new BigFloat(b === 0n ? 0 : 1, b, 0);
  }

  /** 십진 문자열에서 — "0.1" 은 정확히 1/10 이 된다 (배정밀도를 거치지 않는다) */
  static parse(str) {
    const t = String(str).trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(t);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const int = m[2] || '0';
    const frac = m[3] || '';
    const exp = m[4] ? Number(m[4]) : 0;
    const digits = `${int}${frac}`;
    if (!/\d/.test(digits)) return null;
    const mant = BigInt(digits);
    return new BigFloat(mant === 0n ? 0 : sign, mant, exp - frac.length);
  }

  static fromNumber(v) {
    if (!isFinite(v)) return null;
    // 배정밀도 값을 짧은 십진 표기로 되돌린다 (0.1 → 1e-1)
    return BigFloat.parse(v.toPrecision(17)) || BigFloat.parse(String(v));
  }

  get isZero() { return this.s === 0; }
  get sign() { return this.s; }

  neg() { return new BigFloat(-this.s, this.m, this.e); }
  abs() { return this.s < 0 ? this.neg() : this; }

  /** 유효숫자 p 자리로 반올림 */
  round(p) {
    const d = digitsOf(this.m);
    if (d <= p) return this;
    // 99…9 가 100…0 으로 올라가면 자릿수가 하나 늘지만, 버린 자릿수는 그대로 d − p 다.
    // 반올림한 뒤의 자릿수로 계산하면 값이 10배 어긋난다.
    const [m] = roundDigits(this.m, p);
    return new BigFloat(this.s, m, this.e + (d - p));
  }

  cmp(o) {
    if (this.s !== o.s) return this.s < o.s ? -1 : 1;
    if (this.s === 0) return 0;
    const d = sub(this, o, 40);
    return d.s;
  }

  toNumber() {
    if (this.s === 0) return 0;
    const v = Number(`${this.m}e${this.e}`);
    return this.s < 0 ? -v : v;
  }

  /**
   * 사람이 읽는 십진 문자열. 유효숫자 p 자리까지.
   * 표시를 위한 반올림이지, 담고 있는 값을 바꾸지는 않는다.
   */
  toString(p = 30) {
    if (this.s === 0) return '0';
    const [m] = roundDigits(this.m, p);
    const drop = Math.max(0, digitsOf(this.m) - p);
    let e = this.e + drop;
    let ds = m.toString();
    const sign = this.s < 0 ? '-' : '';
    const pointAt = ds.length + e;          // 소수점이 놓일 자리
    if (e >= 0 && pointAt <= p + 6) return sign + ds + '0'.repeat(e);
    if (pointAt > 0 && pointAt <= ds.length) {
      return `${sign}${ds.slice(0, pointAt)}.${ds.slice(pointAt)}`.replace(/\.$/, '');
    }
    if (pointAt <= 0 && pointAt > -6) return `${sign}0.${'0'.repeat(-pointAt)}${ds}`;
    // 지수 표기
    const head = ds.length > 1 ? `${ds[0]}.${ds.slice(1)}` : ds;
    return `${sign}${head}e${pointAt - 1}`;
  }
}

// ── 사칙연산 ────────────────────────────────────────────
/** 두 값의 지수를 맞춘다 */
function align(a, b) {
  const e = Math.min(a.e, b.e);
  return [a.m * pow10(a.e - e), b.m * pow10(b.e - e), e];
}

export function add(a, b, p) {
  if (a.s === 0) return b.round(p);
  if (b.s === 0) return a.round(p);
  // 자릿수 차이가 정밀도보다 크면 작은 쪽은 반올림에 묻힌다 — 정렬 비용을 아낀다
  const scaleA = a.e + digitsOf(a.m);
  const scaleB = b.e + digitsOf(b.m);
  if (scaleA - scaleB > p + 4) return a.round(p);
  if (scaleB - scaleA > p + 4) return b.round(p);
  const [ma, mb, e] = align(a, b);
  const v = BigInt(a.s) * ma + BigInt(b.s) * mb;
  const s = v === 0n ? 0 : v < 0n ? -1 : 1;
  return new BigFloat(s, v < 0n ? -v : v, e).round(p);
}

export function sub(a, b, p) { return add(a, b.neg(), p); }

export function mul(a, b, p) {
  if (a.s === 0 || b.s === 0) return BigFloat.zero();
  return new BigFloat(a.s * b.s, a.m * b.m, a.e + b.e).round(p);
}

export function div(a, b, p) {
  if (b.s === 0) return null;
  if (a.s === 0) return BigFloat.zero();
  const need = p + 4 + digitsOf(b.m) - digitsOf(a.m);
  const shift = Math.max(0, need);
  const q = (a.m * pow10(shift)) / b.m;
  return new BigFloat(a.s * b.s, q, a.e - b.e - shift).round(p);
}

/** 정수 제곱근 (뉴턴법) */
function isqrt(n) {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(bitLength(n) / 2));
  for (;;) {
    const y = (x + n / x) >> 1n;
    if (y >= x) break;
    x = y;
  }
  return x;
}

function bitLength(n) {
  let b = 0;
  let v = n;
  while (v > 0n) { v >>= 32n; b += 32; }
  return b;
}

export function sqrt(a, p) {
  if (a.s < 0) return null;
  if (a.s === 0) return BigFloat.zero();
  // 가수의 자릿수를 짝수로 맞춘 뒤 넉넉히 늘려서 정수 제곱근을 구한다
  let m = a.m;
  let e = a.e;
  const want = 2 * (p + 4);
  const grow = Math.max(0, want - digitsOf(m));
  const even = grow + (((e - grow) % 2) !== 0 ? 1 : 0);
  m *= pow10(even);
  e -= even;
  if (e % 2 !== 0) { m *= TEN; e -= 1; }
  return new BigFloat(1, isqrt(m), e / 2).round(p);
}

// ── 상수 ────────────────────────────────────────────────
const piCache = new Map();

/** 작은 유리수 1/n 의 arctan (테일러 급수) */
function atanInv(n, p) {
  const wp = p + 10;
  const scale = pow10(wp);
  const nn = BigInt(n);
  let term = scale / nn;
  let sum = term;
  let k = 1n;
  const n2 = nn * nn;
  while (term !== 0n) {
    term = term / n2;
    const t = term / (2n * k + 1n);
    if (t === 0n) break;
    sum += (k % 2n === 0n) ? t : -t;
    k += 1n;
  }
  return new BigFloat(1, sum, -wp).round(p);
}

/** π — 마친 공식 π/4 = 4·atan(1/5) − atan(1/239) */
export function PI(p) {
  if (piCache.has(p)) return piCache.get(p);
  const wp = p + 10;
  const a = atanInv(5, wp);
  const b = atanInv(239, wp);
  const q = sub(mul(BigFloat.fromInt(4), a, wp), b, wp);
  const v = mul(BigFloat.fromInt(4), q, p);
  piCache.set(p, v);
  return v;
}

/** e */
export function E(p) { return exp(BigFloat.fromInt(1), p); }

// ── 초월함수 ────────────────────────────────────────────
/** exp — 인수를 반씩 줄여 테일러 급수가 빨리 모이게 한다 */
export function exp(x, p) {
  if (x.s === 0) return BigFloat.fromInt(1);
  const wp = p + 12;
  // 자릿수가 커지면 급수가 발산하듯 느려지므로 |x| < 2^-k 까지 반으로 접는다
  let k = 0;
  let t = x;
  while (Math.abs(t.toNumber()) > 0.25 && k < 200) {
    t = mul(t, BigFloat.parse('0.5'), wp);
    k++;
  }
  let term = BigFloat.fromInt(1);
  let sum = BigFloat.fromInt(1);
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, t, wp), BigFloat.fromInt(i), wp);
    if (term.s === 0) break;
    sum = add(sum, term, wp);
    if (term.e + digitsOf(term.m) < sum.e + digitsOf(sum.m) - wp) break;
  }
  for (let i = 0; i < k; i++) sum = mul(sum, sum, wp);
  return sum.round(p);
}

/** ln — 제곱근을 거듭 씌워 1 에 가깝게 만든 뒤 atanh 급수 */
export function ln(x, p) {
  if (x.s <= 0) return null;
  const wp = p + 14;
  let k = 0;
  let t = x;
  // 10 의 거듭제곱을 먼저 떼어 낸다
  const shift = t.e + digitsOf(t.m) - 1;
  if (shift !== 0) t = new BigFloat(t.s, t.m, t.e - shift);
  while (Math.abs(t.toNumber() - 1) > 0.01 && k < 80) { t = sqrt(t, wp); k++; }
  // ln t = 2·atanh((t−1)/(t+1))
  const one = BigFloat.fromInt(1);
  const z = div(sub(t, one, wp), add(t, one, wp), wp);
  const z2 = mul(z, z, wp);
  let term = z;
  let sum = z;
  for (let i = 1; i < 400; i++) {
    term = mul(term, z2, wp);
    if (term.s === 0) break;
    const t2 = div(term, BigFloat.fromInt(2 * i + 1), wp);
    if (t2.s === 0) break;
    sum = add(sum, t2, wp);
    if (t2.e + digitsOf(t2.m) < sum.e + digitsOf(sum.m) - wp) break;
  }
  let out = mul(sum, BigFloat.fromInt(2 << Math.min(k, 30)), wp);
  if (k > 30) out = mul(out, BigFloat.fromInt(2 ** (k - 30)), wp);
  if (shift !== 0) out = add(out, mul(BigFloat.fromInt(shift), LN10(wp), wp), wp);
  return out.round(p);
}

const ln10Cache = new Map();
/** ln 10 = 3·ln2 + ln(5/4).  ln 을 다시 부르면 무한재귀라 급수로 바로 구한다 */
function LN10(p) {
  if (ln10Cache.has(p)) return ln10Cache.get(p);
  const wp = p + 10;
  const ln2 = mul(atanhInv(3n, wp), BigFloat.fromInt(2), wp);        // 2·atanh(1/3) = ln 2
  const ln54 = mul(atanhInv(9n, wp), BigFloat.fromInt(2), wp);       // 2·atanh(1/9) = ln(5/4)
  const r = add(mul(ln2, BigFloat.fromInt(3), wp), ln54, p);
  ln10Cache.set(p, r);
  return r;
}

/** 2·atanh(1/n) 을 위한 급수 (n 은 홀수 BigInt) */
function atanhInv(n, p) {
  const wp = p + 10;
  const scale = pow10(wp);
  let term = scale / n;
  let sum = term;
  const n2 = n * n;
  let k = 1n;
  while (term !== 0n) {
    term /= n2;
    const t = term / (2n * k + 1n);
    if (t === 0n) break;
    sum += t;
    k += 1n;
  }
  return new BigFloat(1, sum, -wp).round(p);
}

/** sin / cos — 2π 로 줄인 뒤 테일러 */
function reduce2pi(x, p) {
  const wp = p + 12;
  const pi2 = mul(PI(wp), BigFloat.fromInt(2), wp);
  const q = div(x, pi2, wp);
  const n = Math.round(q.toNumber());
  if (!isFinite(n) || Math.abs(n) > 1e15) return x;
  return sub(x, mul(BigFloat.fromInt(n), pi2, wp), wp);
}

export function sin(x, p) {
  const wp = p + 12;
  const t = reduce2pi(x, wp);
  let term = t;
  let sum = t;
  const t2 = mul(t, t, wp);
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, t2, wp).neg(), BigFloat.fromInt(2 * i * (2 * i + 1)), wp);
    if (term.s === 0) break;
    sum = add(sum, term, wp);
    if (term.e + digitsOf(term.m) < sum.e + digitsOf(sum.m) - wp) break;
  }
  return sum.round(p);
}

export function cos(x, p) {
  const wp = p + 12;
  const t = reduce2pi(x, wp);
  let term = BigFloat.fromInt(1);
  let sum = term;
  const t2 = mul(t, t, wp);
  for (let i = 1; i < 400; i++) {
    term = div(mul(term, t2, wp).neg(), BigFloat.fromInt(2 * i * (2 * i - 1)), wp);
    if (term.s === 0) break;
    sum = add(sum, term, wp);
    if (term.e + digitsOf(term.m) < sum.e + digitsOf(sum.m) - wp) break;
  }
  return sum.round(p);
}

export function tan(x, p) {
  const wp = p + 8;
  const c = cos(x, wp);
  if (c.s === 0) return null;
  return div(sin(x, wp), c, p);
}

/** atan — 인수를 반각으로 줄인 뒤 테일러 */
export function atan(x, p) {
  const wp = p + 12;
  const one = BigFloat.fromInt(1);
  let t = x;
  let k = 0;
  while (Math.abs(t.toNumber()) > 0.05 && k < 60) {
    // atan x = 2·atan( x / (1 + √(1+x²)) )
    const r = sqrt(add(one, mul(t, t, wp), wp), wp);
    t = div(t, add(one, r, wp), wp);
    k++;
  }
  let term = t;
  let sum = t;
  const t2 = mul(t, t, wp);
  for (let i = 1; i < 400; i++) {
    term = mul(term, t2, wp).neg();
    const t3 = div(term, BigFloat.fromInt(2 * i + 1), wp);
    if (t3.s === 0) break;
    sum = add(sum, t3, wp);
    if (t3.e + digitsOf(t3.m) < sum.e + digitsOf(sum.m) - wp) break;
  }
  return mul(sum, BigFloat.fromInt(2 ** k), p);
}

/** a^b — 지수가 정수면 거듭제곱으로, 아니면 exp(b·ln a) */
export function pow(a, b, p) {
  const n = b.toNumber();
  if (Number.isInteger(n) && Math.abs(n) < 1e6 && b.e >= 0) {
    const wp = p + 8;
    let r = BigFloat.fromInt(1);
    let base = Math.abs(n) === n ? a : null;
    if (base === null) {
      const inv = div(BigFloat.fromInt(1), a, wp);
      if (!inv) return null;
      base = inv;
    }
    let k = Math.abs(n);
    while (k > 0) {
      if (k & 1) r = mul(r, base, wp);
      base = mul(base, base, wp);
      k >>= 1;
    }
    return r.round(p);
  }
  if (a.s <= 0) return null;
  const wp = p + 10;
  return exp(mul(b, ln(a, wp), wp), p);
}

export { digitsOf };
