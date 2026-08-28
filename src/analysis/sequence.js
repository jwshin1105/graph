// 수열 규칙성 자동 분석기.
//
// 주어진 수열 a_1, a_2, … 에 대해 다음을 차례로 시험한다.
//   상수 → 등차 → 계차(다항식) → 등비 → 등차등비 → 선형점화식 → 주기 → 알려진 수열
//   → (마지막으로) 함수족 적합
// 찾아낸 규칙마다 일반항·다음 항 예측·신뢰도를 함께 돌려준다.

import { toRational, pretty, trimNum, signed, coefTerm, sup, baseStr } from '../math/numeric.js';
import { fitModels, polyString } from './fitting.js';

// 절대 오차 여유(1e-12)를 두면 [1e-15, 2e-15, …] 같은 아주 작은 수열이
// 통째로 "상수"로 오판된다. 상대 오차만으로 판정한다.
const REL = (a, scale) => Math.abs(a) <= Math.max(scale, Number.MIN_VALUE) * 1e-9;

function scaleOf(v) {
  return Math.max(...v.map((x) => Math.abs(x)), Number.MIN_VALUE);
}

/**
 * 규칙이 몇 번 확인되었는지에 따른 확신도.
 * 항이 두세 개뿐이면 여러 규칙이 동시에 들어맞으므로 100% 라고 말해서는 안 된다.
 */
function conf(checks) {
  if (checks <= 1) return 0.5;
  if (checks === 2) return 0.7;
  if (checks === 3) return 0.85;
  if (checks === 4) return 0.95;
  return 1;
}

/** 계차 수열 */
export function differences(v) {
  const out = [];
  for (let i = 0; i + 1 < v.length; i++) out.push(v[i + 1] - v[i]);
  return out;
}

/** 모든 항이 (허용오차 안에서) 같은가 */
function allEqual(v, scale) {
  if (!v.length) return false;
  return v.every((x) => REL(x - v[0], scale));
}

/**
 * 뉴턴의 전진차분 공식으로 다항식 일반항을 복원한다.
 *   a_{n0+k} = Σ_j C(k,j)·Δ^j a_{n0}
 * 이를 n 에 대한 다항식 계수로 전개한다.
 */
export function polynomialFromDifferences(v, n0, degree) {
  const deltas = [];
  let cur = v.slice();
  for (let j = 0; j <= degree; j++) {
    deltas.push(cur[0]);
    cur = differences(cur);
  }
  // p(n) = Σ_j Δ^j a / j! · (n-n0)(n-n0-1)…(n-n0-j+1)
  let coef = [0];
  let fact = 1;
  for (let j = 0; j <= degree; j++) {
    if (j > 0) fact *= j;
    // (n-n0)(n-n0-1)…(n-n0-j+1) 를 전개
    let poly = [1];
    for (let t = 0; t < j; t++) poly = polyMul(poly, [-(n0 + t), 1]);
    const c = deltas[j] / fact;
    coef = polyAdd(coef, poly.map((p) => p * c));
  }
  return coef.map((c) => {
    const r = toRational(c, 5040, 1e-9);
    return r ? r.p / r.q : c;
  });
}

function polyMul(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  return out;
}
function polyAdd(a, b) {
  const out = new Array(Math.max(a.length, b.length)).fill(0);
  for (let i = 0; i < out.length; i++) out[i] = (a[i] || 0) + (b[i] || 0);
  return out;
}
const polyEval = (c, x) => c.reduce((s, k, i) => s + k * Math.pow(x, i), 0);

/** 선형 점화식 a_n = c1·a_{n-1} + … + ck·a_{n-k} 를 찾는다. */
export function findLinearRecurrence(v, maxOrder) {
  const N = v.length;
  const scale = scaleOf(v);
  const limit = Math.min(maxOrder ?? Math.floor((N - 1) / 2), Math.floor((N - 1) / 2), 6);
  for (let k = 1; k <= limit; k++) {
    const rows = [];
    const rhs = [];
    for (let n = k; n < N; n++) {
      rows.push(Array.from({ length: k }, (_, i) => v[n - 1 - i]));
      rhs.push(v[n]);
    }
    if (rows.length < k + 1) continue;      // 검증 여유분이 필요
    const c = solveLS(rows, rhs);
    if (!c || c.some((x) => !isFinite(x))) continue;
    let ok = true;
    for (let n = k; n < N; n++) {
      const pred = c.reduce((s, ci, i) => s + ci * v[n - 1 - i], 0);
      if (!REL(pred - v[n], scale * 1e3)) { ok = false; break; }
    }
    if (ok) {
      const clean = c.map((x) => {
        const r = toRational(x, 1000, 1e-8);
        return r ? r.p / r.q : x;
      });
      return { order: k, coef: clean };
    }
  }
  return null;
}

function solveLS(A, b) {
  const n = A[0].length;
  const M = Array.from({ length: n }, () => new Array(n).fill(0));
  const y = new Array(n).fill(0);
  for (let i = 0; i < A.length; i++) {
    for (let j = 0; j < n; j++) {
      y[j] += A[i][j] * b[i];
      for (let k = 0; k < n; k++) M[j][k] += A[i][j] * A[i][k];
    }
  }
  return gauss(M, y);
}

function gauss(A, b) {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}

// ── 복소수 최소 도구 (특성방정식의 근) ───────────────────────
const cx = (re, im = 0) => ({ re, im });
const cadd = (a, b) => cx(a.re + b.re, a.im + b.im);
const csub = (a, b) => cx(a.re - b.re, a.im - b.im);
const cmul = (a, b) => cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return cx((a.re * b.re + a.im * b.im) / d, (a.im * b.re - a.re * b.im) / d);
};
const cabs = (a) => Math.hypot(a.re, a.im);

/** Durand–Kerner 로 다항식(오름차순 계수)의 모든 복소근을 구한다. */
export function polyRoots(coef) {
  const c = coef.slice();
  while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-14) c.pop();
  const n = c.length - 1;
  if (n < 1) return [];
  const lead = c[n];
  const a = c.map((v) => v / lead);
  let roots = Array.from({ length: n }, (_, i) =>
    cx(0.4 * Math.cos((2 * Math.PI * i) / n + 0.5), 0.9 * Math.sin((2 * Math.PI * i) / n + 0.5) + 0.4));
  const evalP = (z) => {
    let s = cx(0);
    for (let i = n; i >= 0; i--) s = cadd(cmul(s, z), cx(a[i]));
    return s;
  };
  for (let it = 0; it < 500; it++) {
    let move = 0;
    for (let i = 0; i < n; i++) {
      let den = cx(1);
      for (let j = 0; j < n; j++) if (i !== j) den = cmul(den, csub(roots[i], roots[j]));
      const d = cdiv(evalP(roots[i]), den);
      roots[i] = csub(roots[i], d);
      move = Math.max(move, cabs(d));
    }
    if (move < 1e-14) break;
  }
  // 수치 오차로 생긴 미세 허수부를 정리하고, 사실상 같은 근은 하나로 맞춘다
  const mag = Math.max(...roots.map(cabs), 1);
  const cleaned = roots.map((r) =>
    (Math.abs(r.im) < 1e-6 * mag ? cx(round12(r.re), 0) : cx(round12(r.re), round12(r.im))));
  for (let i = 0; i < cleaned.length; i++) {
    for (let j = 0; j < i; j++) {
      if (cabs(csub(cleaned[i], cleaned[j])) < 1e-6 * mag) cleaned[i] = cleaned[j];
    }
  }
  return cleaned;
}
const round12 = (x) => (Math.abs(x - Math.round(x)) < 1e-9 ? Math.round(x) : x);

// ── 알려진 수열 사전 ────────────────────────────────────────
function primes(n) {
  const out = [];
  for (let x = 2; out.length < n; x++) {
    let p = true;
    for (let d = 2; d * d <= x; d++) if (x % d === 0) { p = false; break; }
    if (p) out.push(x);
  }
  return out;
}
function gen(n, f) { return Array.from({ length: n }, (_, i) => f(i + 1)); }

const CATALOG = (() => {
  const N = 40;
  const fib = [1, 1];
  while (fib.length < N) fib.push(fib[fib.length - 1] + fib[fib.length - 2]);
  const luc = [1, 3];
  while (luc.length < N) luc.push(luc[luc.length - 1] + luc[luc.length - 2]);
  const cat = [1];
  for (let i = 1; i < N; i++) cat.push((cat[i - 1] * 2 * (2 * i - 1)) / (i + 1));
  return [
    { name: '피보나치 수열', terms: fib, formula: 'a_n = a_{n-1} + a_{n-2},  a_1 = a_2 = 1' },
    { name: '루카스 수열', terms: luc, formula: 'a_n = a_{n-1} + a_{n-2},  a_1 = 1, a_2 = 3' },
    { name: '소수 수열', terms: primes(N), formula: 'a_n = n번째 소수 (닫힌 일반항 없음)' },
    { name: '카탈란 수', terms: cat, formula: 'a_n = C(2n, n)/(n+1)' },
    { name: '계승', terms: gen(N, (n) => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; }), formula: 'a_n = n!' },
    { name: '삼각수', terms: gen(N, (n) => (n * (n + 1)) / 2), formula: 'a_n = n(n+1)/2' },
    { name: '사각뿔수', terms: gen(N, (n) => (n * (n + 1) * (2 * n + 1)) / 6), formula: 'a_n = n(n+1)(2n+1)/6' },
    { name: '오각수', terms: gen(N, (n) => (n * (3 * n - 1)) / 2), formula: 'a_n = n(3n−1)/2' },
    { name: '제곱수', terms: gen(N, (n) => n * n), formula: 'a_n = n²' },
    { name: '세제곱수', terms: gen(N, (n) => n ** 3), formula: 'a_n = n³' },
    { name: '2의 거듭제곱', terms: gen(N, (n) => 2 ** (n - 1)), formula: 'a_n = 2^(n−1)' },
    { name: '메르센 수', terms: gen(N, (n) => 2 ** n - 1), formula: 'a_n = 2^n − 1' },
    { name: '조화수 Hₙ', terms: gen(N, (n) => { let s = 0; for (let i = 1; i <= n; i++) s += 1 / i; return s; }), formula: 'a_n = Σ_{k=1..n} 1/k' },
  ];
})();

function matchCatalog(v, scale) {
  const res = [];
  for (const entry of CATALOG) {
    for (let shift = 0; shift <= 4; shift++) {
      const t = entry.terms.slice(shift, shift + v.length);
      if (t.length < v.length) break;
      if (v.every((x, i) => REL(x - t[i], scale))) {
        res.push({ ...entry, shift });
        break;
      }
    }
  }
  return res;
}

/**
 * 수열 분석 본체.
 * @param {number[]} values a_{n0}, a_{n0+1}, …
 * @param {{n0?:number, name?:string}} opts
 */
export function analyzeSequence(values, opts = {}) {
  // 값이 비었거나 발산한 항이 섞여 있으면 인덱스가 어긋나므로,
  // 유한한 값이 연속으로 이어지는 가장 긴 구간만 골라 그 시작 위치를 기준으로 삼는다.
  const run = longestFiniteRun(values);
  const v = run.values;
  const dropped = values.length - v.length;
  const n0 = (opts.n0 ?? 1) + run.start;
  const nm = opts.name || 'a';
  const findings = [];
  const scale = scaleOf(v);
  if (v.length < 2) {
    return {
      findings, terms: v, n0,
      summary: dropped ? '값이 정의된 항이 두 개도 되지 않아 규칙을 볼 수 없습니다.'
        : '항이 두 개는 있어야 규칙을 볼 수 있습니다.',
    };
  }

  // exact: 식을 정확히(허용오차 안에서) 만족시키는 규칙. 근사 모형보다 항상 앞선다.
  const push = (f) => findings.push({ confidence: 0.9, exact: true, ...f });
  const idx = (k) => n0 + k;
  const nvar = 'n';
  const shiftStr = n0 === 1 ? nvar : n0 === 0 ? `(${nvar}+1)` : `(${nvar}-${n0 - 1})`;

  // 항이 둘뿐이면 등차로도 등비로도 읽힌다 — 하나를 고르지 않고 둘 다 알린다.
  if (v.length === 2) {
    const d = v[1] - v[0];
    push({ type: 'ambiguous', title: '항이 둘뿐이라 규칙을 정할 수 없음', confidence: 0.5,
      detail: `공차 ${pretty(d)} 인 등차수열로도, `
        + (Math.abs(v[0]) > 1e-15 ? `공비 ${pretty(v[1] / v[0])} 인 등비수열로도 ` : '')
        + '읽힙니다. 항을 더 주면 하나로 좁혀집니다.',
      formula: `${nm}_${nvar} = ${pretty(v[0])} ${d < 0 ? '-' : '+'} ${pretty(Math.abs(d))}(${nvar}−${n0})`
        + (Math.abs(v[0]) > 1e-15 ? `   또는   ${nm}_${nvar} = ${pretty(v[0])}·${pretty(v[1] / v[0])}^(${nvar}−${n0})` : '') });
    return withNote(finish(findings, v, n0, nm, opts), dropped, n0, v.length);
  }

  // 0) 정수 여부
  const allInt = v.every((x) => Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, Math.abs(x)));

  // 1) 상수
  if (allEqual(v, scale)) {
    push({ type: 'constant', title: '상수 수열',
      detail: `모든 항이 ${pretty(v[0])} 로 같습니다.`,
      formula: `${nm}_${nvar} = ${pretty(v[0])}`, next: [v[0], v[0], v[0]],
      confidence: conf(v.length - 1) });
    return finish(findings, v, n0, nm, opts);
  }

  // 2) 계차 → 다항식 (등차수열은 1차)
  const table = [v];
  for (let d = 1; d <= Math.min(8, v.length - 1); d++) table.push(differences(table[d - 1]));
  let polyDeg = -1;
  for (let d = 1; d < table.length; d++) {
    if (table[d].length >= 2 && allEqual(table[d], scale)) { polyDeg = d; break; }
    if (table[d].length >= 1 && table[d].every((x) => REL(x, scale))) { polyDeg = d - 1; break; }
  }
  if (polyDeg >= 1 && polyDeg <= 6 && v.length >= polyDeg + 2) {
    const coef = polynomialFromDifferences(v, n0, polyDeg);
    const body = polyString(coef, nvar);
    const predict = (n) => polyEval(coef, n);
    if (polyDeg === 1) {
      const d = table[1][0];
      push({ type: 'arithmetic', title: '등차수열',
        detail: `공차 d = ${pretty(d)} 인 등차수열입니다. 첫째항 ${pretty(v[0])}.`,
        formula: `${nm}_${nvar} = ${body}`,
        extra: `합 S_${nvar} = ${pretty(v[0])}·${nvar} + ${pretty(d / 2)}·${nvar}(${nvar}−1)`,
        predict, next: [1, 2, 3].map((k) => predict(idx(v.length - 1 + k))),
        confidence: conf(table[1].length) });
    } else {
      push({ type: 'polynomial', title: `${polyDeg}차 다항식 수열`,
        detail: `제${polyDeg}계 계차가 ${pretty(table[polyDeg][0])} 로 일정합니다 → 일반항이 ${polyDeg}차 다항식입니다.`,
        formula: `${nm}_${nvar} = ${body}`,
        extra: `계차 수열: ${table.slice(1, polyDeg + 1).map((t, i) => `Δ^${i + 1}: ${t.slice(0, 5).map((x) => pretty(x)).join(', ')}…`).join(' / ')}`,
        predict, next: [1, 2, 3].map((k) => predict(idx(v.length - 1 + k))),
        confidence: conf(v.length - polyDeg) });
    }
  }

  // 3) 등비
  if (v.every((x) => Math.abs(x) > 1e-14)) {
    const ratios = [];
    for (let i = 0; i + 1 < v.length; i++) ratios.push(v[i + 1] / v[i]);
    if (allEqual(ratios, scaleOf(ratios))) {
      const r = ratios[0];
      const rr = toRational(r, 1000, 1e-9);
      const rs = rr && rr.q <= 100 ? (rr.q === 1 ? String(rr.p) : `${rr.p}/${rr.q}`) : trimNum(r);
      const a1 = v[0];
      const predict = (n) => a1 * Math.pow(r, n - n0);
      push({ type: 'geometric', title: '등비수열',
        detail: `공비 r = ${rs} 인 등비수열입니다. 첫째항 ${pretty(a1)}.`,
        formula: `${nm}_${nvar} = ${coefTerm(a1, `${rr && rr.q === 1 ? baseStr(r) : `(${rs})`}${sup(n0 === 1 ? `${nvar}−1` : `${nvar}−${n0}`)}`)}`,
        extra: Math.abs(r) < 1 ? `|r| < 1 이므로 수렴하고, 무한합은 ${pretty(a1 / (1 - r))} 입니다.`
          : `|r| ≥ 1 이므로 발산합니다.`,
        predict, next: [1, 2, 3].map((k) => predict(idx(v.length - 1 + k))),
        confidence: conf(ratios.length) });
    }
  }

  // 4) 등차등비 a_{n+1} = r·a_n + d
  if (!findings.length && v.length >= 4) {
    const rows = [], rhs = [];
    for (let i = 0; i + 1 < v.length; i++) { rows.push([v[i], 1]); rhs.push(v[i + 1]); }
    const c = solveLS(rows, rhs);
    if (c && c.every(isFinite)) {
      const [r, d] = c.map((x) => { const q = toRational(x, 1000, 1e-8); return q ? q.p / q.q : x; });
      const ok = v.slice(1).every((x, i) => REL(r * v[i] + d - x, scale * 1e3));
      if (ok && Math.abs(r - 1) > 1e-9) {
        const fix = d / (1 - r);
        const predict = (n) => (v[0] - fix) * Math.pow(r, n - n0) + fix;
        push({ type: 'affine', title: '등차·등비 혼합형 점화식',
          detail: `${nm}_{${nvar}+1} = ${coefTerm(r, `${nm}_${nvar}`)}${signed(d)} 를 만족합니다.`,
          formula: `${nm}_${nvar} = ${coefTerm(v[0] - fix, `${baseStr(r)}${sup(`${nvar}−${n0}`)}`)}${signed(fix)}`,
          extra: `고정점 ${pretty(fix)} 로 ${Math.abs(r) < 1 ? '수렴' : '발산'}합니다.`,
          predict, next: [1, 2, 3].map((k) => predict(idx(v.length - 1 + k))), confidence: 0.95 });
      }
    }
  }

  // 4.5) 갈래 등차수열: 서로 엇갈려 놓인 여러 등차수열
  //  sin x = 1/2 의 해처럼 "x = π/6 + 2nπ 또는 x = 5π/6 + 2nπ" 꼴을 잡아낸다.
  if (!findings.some((f) => f.exact) && v.length >= 4) {
    const inter = interleaved(v, n0, nm, nvar);
    if (inter) push(inter);
  }

  // 5) 주기
  for (let p = 1; p <= Math.floor(v.length / 2); p++) {
    let ok = true;
    for (let i = 0; i + p < v.length; i++) if (!REL(v[i] - v[i + p], scale)) { ok = false; break; }
    if (ok) {
      push({ type: 'periodic', title: '주기수열',
        detail: `주기가 ${p} 입니다: ${v.slice(0, p).map((x) => pretty(x)).join(', ')} 가 반복됩니다.`,
        formula: `${nm}_${nvar} = ${nm}_{${nvar}+${p}}`,
        predict: (n) => v[(n - n0) % p],
        next: [0, 1, 2].map((k) => v[(v.length + k) % p]),
        confidence: conf(v.length - p) });
      break;
    }
  }

  // 6) 선형 점화식(고차)
  if (v.length >= 6) {
    const rec = findLinearRecurrence(v);
    // 다항식·등차·등비·등차등비는 이미 자기 자신을 설명하는 점화식을 함의하므로
    // 그런 규칙이 확정된 경우에는 중복 보고하지 않는다.
    const already = findings.some((f) =>
      f.confidence >= 1 && ['arithmetic', 'geometric', 'polynomial', 'affine'].includes(f.type));
    if (rec && !already) {
      const terms = rec.coef
        .map((c, i) => {
          const t = coefTerm(c, `${nm}_{${nvar}−${i + 1}}`);
          if (!t) return '';
          if (i === 0) return t;
          return t.startsWith('-') ? ` - ${t.slice(1)}` : ` + ${t}`;
        })
        .filter(Boolean).join('');
      // 특성방정식 x^k − c1 x^{k-1} − … − ck = 0
      const charCoef = new Array(rec.order + 1).fill(0);
      charCoef[rec.order] = 1;
      rec.coef.forEach((c, i) => { charCoef[rec.order - 1 - i] = -c; });
      const roots = polyRoots(charCoef);
      const rootStr = roots.map((r) => (Math.abs(r.im) < 1e-9 ? pretty(r.re)
        : `${trimNum(r.re)} ${r.im > 0 ? '+' : '−'} ${trimNum(Math.abs(r.im))}i`)).join(',  ');
      const closed = closedForm(v, n0, roots, nm, nvar);
      const predict = (n) => {
        const buf = v.slice();
        for (let m = n0 + v.length; m <= n; m++) {
          buf.push(rec.coef.reduce((s, c, i) => s + c * buf[buf.length - 1 - i], 0));
        }
        return buf[n - n0];
      };
      push({ type: 'recurrence', title: `${rec.order}계 선형 점화식`,
        detail: `${nm}_${nvar} = ${terms} 를 만족합니다.`,
        formula: closed ? `${nm}_${nvar} = ${closed}` : `특성근: ${rootStr}`,
        extra: `특성방정식의 근: ${rootStr}`,
        predict, next: [1, 2, 3].map((k) => predict(idx(v.length - 1 + k))),
        confidence: v.length >= 2 * rec.order + 3 ? 0.95 : 0.7 });
    }
  }

  // 7) 부호 교대
  if (v.length >= 4 && v.every((x, i) => (i === 0 ? true : x * v[i - 1] < 0))) {
    push({ type: 'alternating', title: '부호가 교대로 바뀜',
      detail: `이웃한 항의 부호가 계속 반대입니다. (−1)^${nvar} 꼴 인자를 포함합니다.`,
      confidence: 0.8 });
  }

  // 8) 알려진 수열
  if (allInt || v.length >= 4) {
    for (const m of matchCatalog(v, scale)) {
      push({ type: 'catalog', title: `${m.name} 과(와) 일치`,
        detail: m.shift ? `${m.shift + 1}번째 항부터 일치합니다.` : '처음부터 정확히 일치합니다.',
        formula: m.formula,
        next: m.terms.slice(m.shift + v.length, m.shift + v.length + 3),
        confidence: v.length >= 5 ? 0.9 : 0.6 });
    }
  }

  // 9) 정확한 규칙이 하나도 없을 때에만 함수족 적합으로 근사한다
  if (!findings.some((f) => f.exact)) {
    const xs = v.map((_, i) => idx(i));
    const models = fitModels(xs, v, { variable: nvar, maxDegree: Math.min(4, v.length - 2) });
    const best = models[0];
    if (best && best.r2 > 0.98) {
      push({ type: 'fit', title: `근사 모형: ${best.name}`,
        detail: `정확한 규칙은 찾지 못했지만 ${best.name} 모형이 R² = ${best.r2.toFixed(6)} 로 잘 맞습니다.`,
        formula: best.formula.replace(/^y = /, `${nm}_${nvar} = `),
        predict: best.predict,
        next: [1, 2, 3].map((k) => best.predict(idx(v.length - 1 + k))),
        exact: false, confidence: Math.min(0.6, best.r2) });
    }
  }

  return withNote(finish(findings, v, n0, nm, opts, shiftStr), dropped, n0, v.length);
}

function withNote(out, dropped, n0, len) {
  if (dropped) {
    out.note = `값이 없거나 발산한 항 ${dropped}개는 빼고, ${n0}번째 항부터 이어지는 ${len}개만 보았습니다.`;
  }
  return out;
}

/** 유한한 값이 연속으로 이어지는 가장 긴 구간 */
function longestFiniteRun(values) {
  let best = { start: 0, values: [] };
  let i = 0;
  while (i < values.length) {
    if (typeof values[i] !== 'number' || !isFinite(values[i])) { i++; continue; }
    let j = i;
    while (j < values.length && typeof values[j] === 'number' && isFinite(values[j])) j++;
    if (j - i > best.values.length) best = { start: i, values: values.slice(i, j) };
    i = j;
  }
  return best;
}

/**
 * m 갈래로 엇갈린 등차수열인지 본다.
 * v 를 인덱스 mod m 으로 쪼갰을 때 각 갈래가 모두 같은 공차의 등차수열이면 그렇다.
 */
function interleaved(v, n0, nm, nvar) {
  const scale = scaleOf(v);
  for (let m = 2; m <= 3; m++) {
    if (v.length < m * 2 + 1) continue;
    const parts = [];
    for (let r = 0; r < m; r++) {
      const part = [];
      for (let i = r; i < v.length; i += m) part.push(v[i]);
      if (part.length < 2) { parts.length = 0; break; }
      parts.push(part);
    }
    if (parts.length !== m) continue;
    const ds = parts.map((p) => p[1] - p[0]);
    const ok = parts.every((p, k) => p.every((x, i) => REL(x - (p[0] + ds[k] * i), scale)))
      && ds.every((d) => REL(d - ds[0], scale)) && Math.abs(ds[0]) > 1e-15;
    if (!ok) continue;
    const d = ds[0];
    // 대표항은 절댓값이 가장 작은 항으로 고른다.
    // 그래야 -11π/6 + 2πk 대신 교과서와 같은 π/6 + 2πk 로 적힌다.
    const heads = parts.map((p) => p.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a)));
    const forms = heads.map((h) => `${pretty(h)}${signed(d)}·k`);
    const checks = v.length - m;
    return {
      type: 'interleaved',
      title: `${m}갈래 등차수열`,
      detail: `한 줄로는 등차가 아니지만, ${m}개 수열이 번갈아 놓인 것으로 보면 `
        + `모두 공차 ${pretty(d)} 인 등차수열입니다.`,
      formula: forms.map((f2) => `${nm} = ${f2}`).join('   또는   ') + '   (k = 0, 1, 2, …)',
      predict: null,
      next: [0, 1, 2].map((k) => v[v.length - m + k] + d),
      confidence: conf(checks),
    };
  }
  return null;
}

function closedForm(v, n0, roots, nm, nvar) {
  const k = roots.length;
  if (k < 1 || v.length < k) return null;
  const mag = Math.max(...roots.map(cabs), 1);
  const allReal = roots.every((r) => Math.abs(r.im) < 1e-6 * mag);
  const distinct = roots.every((r, i) => roots.every((s, j) => i === j || cabs(csub(r, s)) > 1e-6 * mag));

  if (allReal && distinct) {
    const rs = roots.map((r) => r.re);
    if (rs.some((r) => Math.abs(r) < 1e-12)) return null;
    const A = [], b = [];
    for (let i = 0; i < k; i++) {
      A.push(rs.map((r) => Math.pow(r, n0 + i)));
      b.push(v[i]);
    }
    const c = gauss(A, b);
    if (!c || c.some((x) => !isFinite(x))) return null;
    const parts = [];
    c.forEach((ci, i) => {
      if (Math.abs(ci) < 1e-10) return;
      // 근이 1 이면 1ⁿ = 1 이므로 상수항으로 적는다
      const t = Math.abs(rs[i] - 1) < 1e-12
        ? coefTerm(ci, '') : coefTerm(ci, `${baseStr(rs[i])}${sup(nvar)}`);
      parts.push(parts.length === 0 ? t : (t.startsWith('-') ? ` - ${t.slice(1)}` : ` + ${t}`));
    });
    return parts.join('') || null;
  }
  if (k === 2 && !distinct && allReal) {
    const r = roots[0].re;
    if (Math.abs(r) < 1e-12) return null;
    const A = [[Math.pow(r, n0), n0 * Math.pow(r, n0)], [Math.pow(r, n0 + 1), (n0 + 1) * Math.pow(r, n0 + 1)]];
    const c = gauss(A, [v[0], v[1]]);
    if (!c) return null;
    const lin = Math.abs(c[0]) < 1e-12 ? coefTerm(c[1], nvar) : `${pretty(c[0])}${signed(c[1])}·${nvar}`;
    const head = Math.abs(c[0]) < 1e-12 ? lin : `(${lin})`;
    return `${head}·${baseStr(r)}${sup(nvar)}`;
  }
  if (k === 2 && !allReal) {
    const rho = cabs(roots[0]);
    const theta = Math.atan2(Math.abs(roots[0].im), roots[0].re);
    return `${baseStr(rho)}${sup(nvar)}·(A·cos(${pretty(theta)}${nvar}) + B·sin(${pretty(theta)}${nvar}))`;
  }
  return null;
}

function finish(findings, v, n0, nm, opts) {
  findings.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || b.confidence - a.confidence);
  const summary = summarize(findings, v, n0, nm);
  return { findings, terms: v, n0, name: nm, summary, opts };
}

function summarize(findings, v, n0, nm) {
  const head = `${nm}_${n0} = ${pretty(v[0])} 부터 ${v.length}개 항`;
  if (!findings.length) return `${head} — 뚜렷한 규칙을 찾지 못했습니다.`;
  const f = findings[0];
  const next = f.next && f.next.every((x) => typeof x === 'number' && isFinite(x))
    ? ` 다음 항 예측: ${f.next.map((x) => pretty(x)).join(', ')}` : '';
  return `${head} — ${f.title}.${next}`;
}
