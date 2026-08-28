// 기호(정확) 계산 층.
// 식이 다항식이면 수치 표본에 기대지 않고 정확히 판정한다.
//   · 이차곡선의 종류 — 판별식이 "정확히" 0 인지 알 수 있다
//   · 1변수 방정식의 근 — 유리근·이차근을 근호 그대로
//   · 파라미터가 든 이차곡선의 분기점 — 훑지 않고 방정식을 풀어서 바로

import { Rat, ratFromNumber } from '../math/rational.js';
import { toPoly } from '../math/poly.js';
import { pretty, trimNum } from '../math/numeric.js';

/** 이차곡선 계수 A x² + B xy + C y² + D x + E y + F */
export function conicCoeffs(poly) {
  if (!poly || poly.degree > 2 || poly.vars.length !== 2) return null;
  const [vx, vy] = poly.vars;
  void vx; void vy;
  const c = (ex, ey) => poly.coeff([ex, ey]);
  return { A: c(2, 0), B: c(1, 1), C: c(0, 2), D: c(1, 0), E: c(0, 1), F: c(0, 0) };
}

/**
 * 이차곡선의 종류를 정확히 판정한다.
 * @returns {{kind:string, degenerate:boolean, center?:[number,number], radius?:number,
 *            disc:Rat, det:Rat, note?:string}|null}
 */
export function classifyConicExact(poly) {
  const k = conicCoeffs(poly);
  if (!k) return null;
  const { A, B, C, D, E, F } = k;
  const two = Rat.of(2);
  const quadZero = A.isZero && B.isZero && C.isZero;

  if (quadZero) {
    if (D.isZero && E.isZero) {
      return { kind: F.isZero ? '평면 전체' : '해 없음', degenerate: true, disc: Rat.ZERO, det: Rat.ZERO };
    }
    return { kind: '직선', degenerate: true, disc: Rat.ZERO, det: Rat.ZERO };
  }

  const disc = B.mul(B).sub(A.mul(C).mul(Rat.of(4)));          // B² − 4AC
  // 3×3 행렬식 |A B/2 D/2; B/2 C E/2; D/2 E/2 F|
  const b2 = B.div(two), d2 = D.div(two), e2 = E.div(two);
  const det = A.mul(C.mul(F).sub(e2.mul(e2)))
    .sub(b2.mul(b2.mul(F).sub(e2.mul(d2))))
    .add(d2.mul(b2.mul(e2).sub(C.mul(d2))));

  const degenerate = det.isZero;
  let kind;
  if (disc.isZero) kind = degenerate ? twoParallel(A, B, C, D, E, F) : '포물선';
  else if (disc.sign < 0) {
    if (degenerate) kind = '한 점';
    else {
      const round = B.isZero && A.eq(C);
      // 실수 해가 있는지: A·det 의 부호로 판정 (A·Δ > 0 이면 허원)
      const empty = A.mul(det).sign > 0;
      kind = empty ? '해 없음' : (round ? '원' : '타원');
    }
  } else kind = degenerate ? '두 직선(교차)' : '쌍곡선';

  const out = { kind, degenerate, disc, det };
  if (!disc.isZero) {
    const cx = C.mul(D).mul(two).sub(B.mul(E)).div(disc);
    const cy = A.mul(E).mul(two).sub(B.mul(D)).div(disc);
    out.center = [cx, cy];
  }
  if (B.isZero && A.eq(C) && !A.isZero) {
    const cx = D.div(A.mul(two)).neg();
    const cy = E.div(A.mul(two)).neg();
    const r2 = cx.mul(cx).add(cy.mul(cy)).sub(F.div(A));
    if (r2.sign > 0) out.radiusSq = r2;
  }
  return out;
}

function twoParallel(A, B, C, D, E, F) {
  // 판별식 0 이면서 퇴화 — 두 평행선인지, 겹친 직선인지, 해가 없는지
  const two = Rat.of(2);
  if (A.isZero && B.isZero) {
    const disc = E.mul(E).sub(C.mul(F).mul(Rat.of(4)));
    return disc.isZero ? '겹친 직선' : disc.sign > 0 ? '두 평행선' : '해 없음';
  }
  const disc = D.mul(D).sub(A.mul(F).mul(Rat.of(4)));
  void two;
  return disc.isZero ? '겹친 직선' : disc.sign > 0 ? '두 평행선' : '해 없음';
}

/** 이차곡선 식을 사람이 읽는 꼴로 (계수를 정수로 맞춰서) */
export function conicEquation(poly) {
  const k = conicCoeffs(poly);
  if (!k) return null;
  const names = ['x²', 'xy', 'y²', 'x', 'y', ''];
  const vals = [k.A, k.B, k.C, k.D, k.E, k.F];
  // 분모를 없애고 최대공약수로 나눈다
  let mul = 1n;
  for (const v of vals) mul = lcm(mul, v.d);
  const ints = vals.map((v) => (v.n * mul) / v.d);
  let g = 0n;
  for (const v of ints) g = bgcd(g, v < 0n ? -v : v);
  if (g === 0n) g = 1n;
  const first = ints.find((v) => v !== 0n) ?? 1n;
  const sign = first < 0n ? -1n : 1n;
  const norm = ints.map((v) => (v / g) * sign);

  let s = '';
  norm.forEach((v, i) => {
    if (v === 0n) return;
    const mag = v < 0n ? -v : v;
    const body = names[i] ? (mag === 1n ? names[i] : `${mag}${names[i]}`) : String(mag);
    s += s === '' ? (v < 0n ? `-${body}` : body) : (v < 0n ? ` - ${body}` : ` + ${body}`);
  });
  return `${s || '0'} = 0`;
}

const bgcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
const lcm = (a, b) => (a === 0n ? b : (a * b) / bgcd(a, b));

// ── 1변수 다항방정식의 정확한 근 ────────────────────────────
/**
 * 계수(낮은 차수부터, 유리수)로 주어진 다항식의 실근을 정확히 구한다.
 * 유리근은 유리수 그대로, 이차 인수는 근호 꼴로 돌려준다.
 * @returns {{value:number, text:string, exact:boolean}[]|null}
 */
export function polyRootsExact(coeffs) {
  let c = coeffs.slice();
  while (c.length && c[c.length - 1].isZero) c.pop();
  if (c.length <= 1) return c.length === 0 ? null : [];       // 상수식

  const roots = [];
  // x = 0 인 근 먼저 뽑는다. 중근이어도 "해"로는 하나다 (x² = 0 의 해는 0 하나)
  if (c[0].isZero) {
    roots.push({ value: 0, text: '0', exact: true });
    while (c.length > 1 && c[0].isZero) c = c.slice(1);
  }
  // 유리근 정리로 후보를 훑는다
  let guard = 0;
  while (c.length > 3 && guard++ < 40) {
    const r = findRationalRoot(c);
    if (!r) break;
    roots.push({ value: r.value, text: r.toString(), exact: true });
    c = deflate(c, r);
  }
  if (c.length === 2) {
    const r = c[0].neg().div(c[1]);
    roots.push({ value: r.value, text: r.toString(), exact: true });
  } else if (c.length === 3) {
    roots.push(...quadraticRoots(c[2], c[1], c[0]));
  } else if (c.length > 3) {
    // 유리근이 더는 없으면 여기서부터는 수치로
    return { partial: roots, remaining: c };
  }
  roots.sort((a, b) => a.value - b.value);
  return roots;
}

function findRationalRoot(c) {
  const a0 = c[0];
  const an = c[c.length - 1];
  if (a0.isZero) return Rat.ZERO;
  const ps = divisors(a0.n * a0.d);
  const qs = divisors(an.n * an.d);
  for (const p of ps) {
    for (const q of qs) {
      for (const sgn of [1n, -1n]) {
        const cand = new Rat(sgn * p, q);
        if (evalPoly(c, cand).isZero) return cand;
      }
    }
  }
  return null;
}

function divisors(n) {
  n = n < 0n ? -n : n;
  if (n === 0n) return [1n];
  const out = [];
  for (let i = 1n; i * i <= n && out.length < 400; i++) {
    if (n % i === 0n) { out.push(i); if (i !== n / i) out.push(n / i); }
  }
  return out.sort((a, b) => (a < b ? -1 : 1));
}

function evalPoly(c, x) {
  let s = Rat.ZERO;
  for (let i = c.length - 1; i >= 0; i--) s = s.mul(x).add(c[i]);
  return s;
}

function deflate(c, r) {
  // (x − r) 로 나눈 몫 (조립제법)
  const out = new Array(c.length - 1);
  let carry = Rat.ZERO;
  for (let i = c.length - 1; i >= 1; i--) {
    carry = c[i].add(carry.mul(r));
    out[i - 1] = carry;
    carry = out[i - 1];
  }
  return out;
}

function quadraticRoots(a, b, cc) {
  const disc = b.mul(b).sub(a.mul(cc).mul(Rat.of(4)));
  if (disc.sign < 0) return [];
  const two = a.mul(Rat.of(2));
  if (disc.isZero) {
    const r = b.neg().div(two);
    return [{ value: r.value, text: r.toString(), exact: true }];
  }
  const sq = exactSqrt(disc);
  if (sq) {
    const r1 = b.neg().sub(sq).div(two);
    const r2 = b.neg().add(sq).div(two);
    return [r1, r2].map((r) => ({ value: r.value, text: r.toString(), exact: true }));
  }
  // 근호가 남는 경우 — 문자 그대로 적는다
  const texts = surdTexts(b.neg(), disc, two);
  return texts.map((t) => ({ value: t.value, text: t.text, exact: true }));
}

/** 유리수의 정확한 제곱근 (완전제곱일 때만) */
export function exactSqrt(r) {
  const isq = (n) => {
    if (n < 0n) return null;
    if (n < 2n) return n;
    let x = BigInt(Math.floor(Math.sqrt(Number(n))));
    for (let i = 0; i < 60; i++) {
      const nx = (x + n / x) / 2n;
      if (nx === x) break;
      x = nx;
    }
    while (x * x > n) x -= 1n;
    while ((x + 1n) * (x + 1n) <= n) x += 1n;
    return x * x === n ? x : null;
  };
  const n = isq(r.n);
  const d = isq(r.d);
  return n !== null && d !== null ? new Rat(n, d) : null;
}

/**
 * (p ± √disc) / q 를 보기 좋은 글로.
 * 정수로 통분한 뒤 최대공약수로 나눠 (-2√2)/2 같은 꼴이 -√2 로 정리되게 한다.
 */
function surdTexts(p, disc, q) {
  // √disc 를 (k/den)·√m 꼴로: disc = n/d = (n·d)/d²
  let m = disc.n * disc.d;
  let k = 1n;
  for (let i = 2n; i * i <= m && i < 1000000n; i++) {
    while (m % (i * i) === 0n) { m /= i * i; k *= i; }
  }
  const coef = new Rat(k, disc.d);           // √disc = coef·√m

  // (p ± coef√m) / q 를 정수 (N1 ± N2√m) / DEN 으로
  const L = lcm(p.d, coef.d);
  const P = (p.n * L) / p.d;
  const C = (coef.n * L) / coef.d;
  let N1 = P * q.d;
  let N2 = C * q.d;
  let DEN = L * q.n;
  if (DEN < 0n) { N1 = -N1; N2 = -N2; DEN = -DEN; }
  let g = bgcd(bgcd(N1 < 0n ? -N1 : N1, N2 < 0n ? -N2 : N2), DEN);
  if (g === 0n) g = 1n;
  N1 /= g; N2 /= g; DEN /= g;

  const out = [];
  for (const sign of [-1n, 1n]) {
    const s2 = N2 * sign;
    const value = (Number(N1) + Number(s2) * Math.sqrt(Number(m))) / Number(DEN);
    const rootPart = m === 1n
      ? String(s2 < 0n ? -s2 : s2)
      : (s2 === 1n || s2 === -1n ? `√${m}` : `${s2 < 0n ? -s2 : s2}√${m}`);
    let num;
    if (N1 === 0n) num = `${s2 < 0n ? '-' : ''}${rootPart}`;
    else num = `${N1} ${s2 < 0n ? '-' : '+'} ${rootPart}`;
    const text = DEN === 1n ? num : (N1 === 0n ? `${num}/${DEN}` : `(${num})/${DEN}`);
    out.push({ value, text });
  }
  return out;
}

// ── 파라미터가 든 이차곡선의 분기점 ─────────────────────────
/**
 * 식이 x, y 에 대해 2차이고 계수가 파라미터 p 의 다항식이면,
 * 분류가 바뀌는 p 값을 방정식을 풀어 정확히 구한다.
 * @returns {{at:number, text:string, reason:string}[]|null}
 */
export function conicTransitions(poly, param) {
  if (!poly || !poly.vars.includes(param)) return null;
  const others = poly.vars.filter((v) => v !== param);
  if (others.length !== 2) return null;
  if (poly.degreeIn(others[0]) > 2 || poly.degreeIn(others[1]) > 2) return null;
  // x, y 에 대한 전체 차수가 2 이하인지
  for (const key of poly.terms.keys()) {
    const e = key.split(',').map(Number);
    let d = 0;
    poly.vars.forEach((v, i) => { if (v !== param) d += e[i]; });
    if (d > 2) return null;
  }

  const [vx, vy] = others;
  const idx = (name) => poly.vars.indexOf(name);
  /** x^ex·y^ey 의 계수를 param 의 다항식으로 */
  const coefPoly = (ex, ey) => {
    const out = new Map();
    for (const [key, val] of poly.terms) {
      const e = key.split(',').map(Number);
      if (e[idx(vx)] !== ex || e[idx(vy)] !== ey) continue;
      const d = e[idx(param)];
      out.set(d, (out.get(d) || Rat.ZERO).add(val));
    }
    const arr = [];
    for (const [d, v] of out) arr[d] = v;
    for (let i = 0; i < arr.length; i++) if (!arr[i]) arr[i] = Rat.ZERO;
    while (arr.length && arr[arr.length - 1].isZero) arr.pop();
    return arr;
  };

  const A = coefPoly(2, 0), B = coefPoly(1, 1), C = coefPoly(0, 2);
  const D = coefPoly(1, 0), E = coefPoly(0, 1), F = coefPoly(0, 0);

  const events = [];
  const push = (coeffs, reason) => {
    const rs = polyRootsExact(coeffs);
    if (!rs || rs.partial) return;
    for (const r of rs) events.push({ at: r.value, text: r.text, reason });
  };

  // 판별식 B² − 4AC = 0 : 타원 ↔ 쌍곡선이 갈리는 자리
  push(sub(mulP(B, B), scaleP(mulP(A, C), Rat.of(4))), '판별식 B²−4AC = 0');
  // 원이 되는 조건 : B = 0 이고 A = C
  if (B.length === 0 || B.every((v) => v.isZero)) push(sub(A, C), '원이 되는 조건 A = C');
  // 퇴화하는 자리 : 3×3 행렬식 = 0
  push(conicDet(A, B, C, D, E, F), '퇴화 (행렬식 = 0)');
  // 이차항이 사라지는 자리 — 곡선이 직선·포물선으로 무너진다
  push(A, 'x² 항이 사라짐');
  push(C, 'y² 항이 사라짐');

  return dedupeEvents(events);       // 같은 값에서 나온 사유는 하나로 묶는다
}

// ── 파라미터가 든 다항함수 y = f(x) 의 분기점 ──────────────
/**
 * f(x) 의 계수가 파라미터 p 의 다항식이면, 실근·극값의 개수가 바뀌는 p 값을
 * 종결식(resultant)으로 정확히 구한다.
 *
 * 개수가 바뀌려면 근이 둘 붙었다가 떨어져야 하고, 그건 f 와 f′ 가 근을 공유하는
 * 순간이다 — 즉 판별식 Res(f, f′) = 0. 극값도 같은 이야기를 f′ 에 대고 하면 된다.
 * 훑기가 표본 사이에 숨은 자리를 놓치더라도 이쪽은 방정식을 풀어 바로 짚는다.
 *
 * @returns {{at:number, text:string, reason:string}[]|null}
 */
export function familyTransitions(poly, param, xvar) {
  if (!poly || !poly.vars.includes(param) || !poly.vars.includes(xvar)) return null;
  for (const v of poly.vars) if (v !== param && v !== xvar) return null;
  const deg = poly.degreeIn(xvar);
  if (!(deg >= 1) || deg > 6) return null;
  if (poly.degreeIn(param) < 1) return null;      // 파라미터에 기대지 않으면 분기점도 없다

  const ix = poly.vars.indexOf(xvar);
  const ip = poly.vars.indexOf(param);
  /** x^k 의 계수를 param 의 다항식(낮은 차수부터)으로 */
  const coefs = [];
  for (let k = 0; k <= deg; k++) coefs.push([]);
  for (const [key, val] of poly.terms) {
    const e = key.split(',').map(Number);
    const arr = coefs[e[ix]];
    const d = e[ip];
    while (arr.length <= d) arr.push(Rat.ZERO);
    arr[d] = arr[d].add(val);
  }
  const A = coefs.map(trimP);
  const dA = derivP(A);
  const ddA = derivP(dA);

  const events = [];
  const push = (coeffs, reason) => {
    if (!coeffs || !coeffs.length) return;
    const rs = polyRootsExact(coeffs);
    if (!rs || rs.partial) return;
    for (const r of rs) events.push({ at: r.value, text: r.text, reason });
  };

  push(resultantP(A, dA), '판별식 Res(f, f′) = 0 — 중근이 생기는 자리');
  push(resultantP(dA, ddA), '판별식 Res(f′, f″) = 0 — 극값이 붙었다 떨어지는 자리');
  if (A[deg].length > 1 || (A[deg].length === 1 && !A[deg][0].isZero)) {
    push(A[deg], `최고차항 x^${deg} 이 사라짐`);
  }
  return dedupeEvents(events);
}

/** x 에 대한 미분 (계수는 param 의 다항식) */
function derivP(A) {
  const out = [];
  for (let k = 1; k < A.length; k++) out.push(scaleP(A[k], Rat.of(k)));
  return out.map(trimP);
}
const trimP = (a) => {
  const out = a.slice();
  while (out.length && out[out.length - 1].isZero) out.pop();
  return out;
};

/**
 * 두 다항식의 종결식. 계수가 param 의 다항식이므로 실베스터 행렬의 행렬식을
 * ℚ[param] 위에서 그대로 전개한다 (나눗셈이 없어 정확하다).
 */
function resultantP(A, B) {
  const m = A.length - 1;
  const n = B.length - 1;
  if (m < 1 || n < 0) return null;
  const size = m + n;
  if (size < 1 || size > 8) return null;
  const M = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(size).fill(null);
    for (let k = 0; k <= m; k++) row[i + k] = A[m - k];
    M.push(row);
  }
  for (let i = 0; i < m; i++) {
    const row = new Array(size).fill(null);
    for (let k = 0; k <= n; k++) row[i + k] = B[n - k];
    M.push(row);
  }
  return detP(M);
}

/** ℚ[param] 성분 행렬의 행렬식 — 열 부분집합을 상태로 두고 라플라스 전개 */
function detP(M) {
  const n = M.length;
  let dp = new Map([[0, [Rat.ONE]]]);
  for (let r = 0; r < n; r++) {
    const next = new Map();
    for (const [mask, val] of dp) {
      for (let c = 0; c < n; c++) {
        if (mask & (1 << c)) continue;
        const e = M[r][c];
        if (!e || !e.length) continue;
        let before = 0;
        for (let j = 0; j < c; j++) if (!(mask & (1 << j))) before++;
        let term = mulP(val, e);
        if (before % 2) term = term.map((v) => v.neg());
        const key = mask | (1 << c);
        next.set(key, addP(next.get(key) || [], term));
      }
    }
    dp = next;
  }
  return dp.get((1 << n) - 1) || [];
}

/** 같은 파라미터 값에서 나온 사유를 하나로 묶는다 */
function dedupeEvents(events) {
  const seen = new Map();
  for (const e of events) {
    const key = e.at.toFixed(12);
    if (!seen.has(key)) seen.set(key, { ...e, reasons: [e.reason] });
    else if (!seen.get(key).reasons.includes(e.reason)) seen.get(key).reasons.push(e.reason);
  }
  return [...seen.values()]
    .map((e) => ({ ...e, reason: e.reasons.join(', ') }))
    .sort((a, b) => a.at - b.at);
}

// param 에 대한 1변수 다항식 산술 (계수 배열)
const addP = (a, b) => {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    out[i] = (a[i] || Rat.ZERO).add(b[i] || Rat.ZERO);
  }
  while (out.length && out[out.length - 1].isZero) out.pop();
  return out;
};
const sub = (a, b) => addP(a, b.map((v) => v.neg()));
const mulP = (a, b) => {
  if (!a.length || !b.length) return [];
  const out = new Array(a.length + b.length - 1).fill(Rat.ZERO);
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) out[i + j] = out[i + j].add(a[i].mul(b[j]));
  }
  while (out.length && out[out.length - 1].isZero) out.pop();
  return out;
};
const scaleP = (a, r) => a.map((v) => v.mul(r));
const halfP = (a) => a.map((v) => v.div(Rat.of(2)));

function conicDet(A, B, C, D, E, F) {
  const b = halfP(B), d = halfP(D), e = halfP(E);
  return addP(
    sub(mulP(A, sub(mulP(C, F), mulP(e, e))), mulP(b, sub(mulP(b, F), mulP(e, d)))),
    mulP(d, sub(mulP(b, e), mulP(C, d))),
  );
}

export { toPoly, ratFromNumber, pretty, trimNum };
