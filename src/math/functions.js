// 내장 함수 · 상수 테이블
// 모든 함수는 실수 영역에서 정의되며, 정의역 밖에서는 NaN 을 반환한다.
// (NaN 은 그래프 엔진에서 "정의되지 않음"으로 처리되어 자동으로 끊긴다.)

const gammaG = 7;
const gammaC = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function gamma(z) {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  z -= 1;
  let x = gammaC[0];
  for (let i = 1; i < gammaG + 2; i++) x += gammaC[i] / (z + i);
  const t = z + gammaG + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

export function factorial(n) {
  if (n < 0 && Number.isInteger(n)) return NaN;
  if (Number.isInteger(n) && n <= 170) {
    let r = 1;
    for (let i = 2; i <= n; i++) r *= i;
    return r;
  }
  return gamma(n + 1);
}

function erf(x) {
  // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return s * y;
}

function gcd2(a, b) {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 이름 -> { arity, fn }. arity 가 -1 이면 가변 인자. */
export const FUNCTIONS = {
  sin: { arity: 1, fn: Math.sin },
  cos: { arity: 1, fn: Math.cos },
  tan: { arity: 1, fn: Math.tan },
  cot: { arity: 1, fn: (x) => 1 / Math.tan(x) },
  sec: { arity: 1, fn: (x) => 1 / Math.cos(x) },
  csc: { arity: 1, fn: (x) => 1 / Math.sin(x) },
  asin: { arity: 1, fn: Math.asin },
  acos: { arity: 1, fn: Math.acos },
  atan: { arity: 1, fn: Math.atan },
  atan2: { arity: 2, fn: Math.atan2 },
  arcsin: { arity: 1, fn: Math.asin, alias: 'asin' },
  arccos: { arity: 1, fn: Math.acos, alias: 'acos' },
  arctan: { arity: 1, fn: Math.atan, alias: 'atan' },
  sinh: { arity: 1, fn: Math.sinh },
  cosh: { arity: 1, fn: Math.cosh },
  tanh: { arity: 1, fn: Math.tanh },
  asinh: { arity: 1, fn: Math.asinh },
  acosh: { arity: 1, fn: Math.acosh },
  atanh: { arity: 1, fn: Math.atanh },
  exp: { arity: 1, fn: Math.exp },
  ln: { arity: 1, fn: Math.log },
  log: { arity: -1, fn: (a, b) => (b === undefined ? Math.log(a) : Math.log(b) / Math.log(a)) },
  lg: { arity: 1, fn: Math.log10 },
  log2: { arity: 1, fn: Math.log2 },
  log10: { arity: 1, fn: Math.log10 },
  sqrt: { arity: 1, fn: Math.sqrt },
  cbrt: { arity: 1, fn: Math.cbrt },
  abs: { arity: 1, fn: Math.abs },
  sgn: { arity: 1, fn: Math.sign },
  sign: { arity: 1, fn: Math.sign },
  floor: { arity: 1, fn: Math.floor },
  ceil: { arity: 1, fn: Math.ceil },
  round: { arity: 1, fn: Math.round },
  trunc: { arity: 1, fn: Math.trunc },
  frac: { arity: 1, fn: (x) => x - Math.floor(x) },
  min: { arity: -1, fn: (...a) => Math.min(...a) },
  max: { arity: -1, fn: (...a) => Math.max(...a) },
  mod: { arity: 2, fn: (a, b) => ((a % b) + b) % b },
  gcd: { arity: -1, fn: (...a) => a.reduce(gcd2) },
  lcm: { arity: -1, fn: (...a) => a.reduce((x, y) => Math.abs(x * y) / (gcd2(x, y) || 1)) },
  hypot: { arity: -1, fn: (...a) => Math.hypot(...a) },
  pow: { arity: 2, fn: Math.pow },
  gamma: { arity: 1, fn: gamma },
  fact: { arity: 1, fn: factorial },
  erf: { arity: 1, fn: erf },
  nCr: { arity: 2, fn: (n, r) => Math.round(factorial(n) / (factorial(r) * factorial(n - r))) },
  nPr: { arity: 2, fn: (n, r) => Math.round(factorial(n) / factorial(n - r)) },
  if: { arity: 3, fn: (c, a, b) => (c ? a : b) },
  // 아래 셋은 컴파일러가 특수형으로 가로채 처리한다(인자를 지연 평가해야 하므로).
  // 여기에 등록해 두는 것은 토크나이저·파서가 함수 이름으로 알아보게 하기 위함이다.
  // 리스트 통계 — list:true 인 함수는 리스트를 통째로 받는다
  total: { arity: 1, list: true, fn: (v) => toList(v).reduce((a, b) => a + b, 0) },
  mean: { arity: 1, list: true, fn: (v) => { const l = toList(v); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : NaN; } },
  median: { arity: 1, list: true, fn: (v) => {
    const l = toList(v).slice().sort((a, b) => a - b);
    if (!l.length) return NaN;
    const m = l.length >> 1;
    return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
  } },
  variance: { arity: 1, list: true, fn: (v) => sampleVar(toList(v)) },
  stdev: { arity: 1, list: true, fn: (v) => Math.sqrt(sampleVar(toList(v))) },
  stdevp: { arity: 1, list: true, fn: (v) => { const l = toList(v); return Math.sqrt(sampleVar(l) * (l.length - 1) / l.length); } },
  length: { arity: 1, list: true, fn: (v) => toList(v).length },
  count: { arity: 1, list: true, fn: (v) => toList(v).length },
  sort: { arity: 1, list: true, fn: (v) => toList(v).slice().sort((a, b) => a - b) },
  reverse: { arity: 1, list: true, fn: (v) => toList(v).slice().reverse() },
  quantile: { arity: 2, list: true, fn: (v, p) => {
    const l = toList(v).slice().sort((a, b) => a - b);
    if (!l.length) return NaN;
    const i = (l.length - 1) * Math.min(1, Math.max(0, p));
    const lo = Math.floor(i), hi = Math.ceil(i);
    return l[lo] + (l[hi] - l[lo]) * (i - lo);
  } },
  sum: { arity: -1, special: true, fn: () => NaN },
  prod: { arity: -1, special: true, fn: () => NaN },
  integral: { arity: -1, special: true, fn: () => NaN },
};

/** 인자를 지연 평가해야 하는 특수형 이름 */
export const SPECIAL_FORMS = new Set(['sum', 'prod', 'integral']);

function toList(v) {
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'number' && isFinite(x));
  return typeof v === 'number' && isFinite(v) ? [v] : [];
}

function sampleVar(l) {
  if (l.length < 2) return NaN;
  const m = l.reduce((a, b) => a + b, 0) / l.length;
  return l.reduce((a, b) => a + (b - m) ** 2, 0) / (l.length - 1);
}

export const CONSTANTS = {
  pi: Math.PI,
  'π': Math.PI,
  tau: 2 * Math.PI,
  'τ': 2 * Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
  'φ': (1 + Math.sqrt(5)) / 2,
  inf: Infinity,
  '∞': Infinity,
};
