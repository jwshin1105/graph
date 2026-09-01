// 점들이 함께 만족하는 **대수적 관계**를 찾는다.
//
//   (cos n, sin n)  →  x² + y² = 1
//   (n, n²)         →  y − x² = 0
//   (n, 2n+1)       →  2x − y + 1 = 0
//
// 이차곡선 맞추기(conic.js)는 "얼마나 비슷한가"를 재지만, 여기서는 한 걸음 더 가서
// **계수를 유리수로 되돌리고**, 되돌린 식이 모든 점에서 정말 0 인지 다시 확인한다.
// 그렇게 확인된 것만 관계로 인정하고, 그마저도 "가설"이라고 적는다 —
// 유한한 점으로는 규칙을 하나로 정할 수 없기 때문이다.

import { ratFromNumber } from '../math/rational.js';

/** 총차수 d 이하의 단항식 지수쌍 */
function basisOf(d) {
  const out = [];
  for (let t = 0; t <= d; t++) {
    for (let i = t; i >= 0; i--) out.push([i, t - i]);
  }
  return out;                                   // [0,0], [1,0], [0,1], [2,0], [1,1], [0,2], …
}

const monText = (i, j) => {
  const p = (name, k) => (k === 0 ? '' : k === 1 ? name : `${name}^${k}`);
  const s = `${p('x', i)}${i && j ? '' : ''}${p('y', j)}`;
  return s || '1';
};

/**
 * 대칭행렬의 가장 작은 고유값에 딸린 고유벡터 (야코비 회전).
 * 점의 개수보다 단항식이 적으므로 6×6 안팎이라 이 방법으로 충분하다.
 */
function smallestEigen(A, n) {
  const a = A.map((r) => r.slice());
  const v = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] * a[i][j];
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let i = 1; i < n; i++) if (a[i][i] < a[best][best]) best = i;
  return { value: a[best][best], vector: v.map((row) => row[best]) };
}

/**
 * 점들이 함께 만족하는 관계를 찾는다.
 *
 * @param {number[][]} points   찾는 데 쓸 점
 * @param {number[][]} [check]  확인에만 쓸 점 (찾는 데는 안 쓴다 — 가설 검증용)
 * @param {object} [opts]
 * @returns {{degree, text, coeffs, residual, exact, checked, passed}|null}
 */
export function findInvariant(points, check = [], opts = {}) {
  const maxDegree = opts.maxDegree ?? 3;
  const pts = points.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
  if (pts.length < 3) return null;
  const scale = Math.max(
    1e-12,
    ...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))),
  );

  for (let d = 1; d <= maxDegree; d++) {
    const basis = basisOf(d);
    // 단항식 수보다 점이 넉넉히 많아야 "우연히 맞는" 관계를 걸러낼 수 있다
    if (pts.length < basis.length + 2) break;
    const m = basis.length;
    // 단항식마다 크기가 천차만별이라(x 는 16, x⁴ 은 65536) 그대로 두면 행렬이
    // 몹시 나빠져 가장 작은 고유벡터의 자릿수가 날아간다.
    // 열마다 제곱평균으로 나눠 크기를 맞춘다.
    const raws = pts.map(([x, y]) => basis.map(([i, j]) => Math.pow(x, i) * Math.pow(y, j)));
    const norm = basis.map((_, k) => {
      let s2 = 0;
      for (const r of raws) s2 += r[k] * r[k];
      const v = Math.sqrt(s2 / pts.length);
      return v > 1e-300 ? v : 1;
    });
    const G = Array.from({ length: m }, () => new Array(m).fill(0));
    for (const r of raws) {
      const row = r.map((v, k) => v / norm[k]);
      for (let a = 0; a < m; a++) for (let b = 0; b < m; b++) G[a][b] += row[a] * row[b];
    }
    const { value, vector } = smallestEigen(G, m);
    // 딱 맞는 관계가 있으면 최소 고유값이 0 인데, 반올림 때문에 −1e−16 처럼
    // 아주 작은 음수로 나오기도 한다. 음수라고 버리면 정작 찾던 관계를 놓친다.
    if (!isFinite(value) || !vector.every(isFinite)) continue;
    // 절대 크기가 아니라 **가장 큰 쪽과 견주어** 판단한다.
    // 그램 행렬의 크기는 점의 개수와 좌표 크기에 따라 얼마든지 달라지기 때문이다.
    let trace = 0;
    for (let a = 0; a < m; a++) trace += G[a][a];
    const rel = trace > 0 ? Math.max(0, value) / trace : Infinity;
    const rms = Math.sqrt(Math.max(0, value) / pts.length);
    if (!(rel < 1e-10)) continue;                    // 이 차수로는 안 맞는다

    // 원래 크기로 되돌리고, 가장 큰 계수로 나눠 모양을 맞춘다
    const raw = vector.map((c, k) => c / norm[k]);
    let big = 0;
    for (const c of raw) if (Math.abs(c) > Math.abs(big)) big = c;
    if (!big) continue;
    const unit = raw.map((c) => c / big);

    // 계수를 유리수로 되돌린다. 고유벡터는 자릿수가 조금 깎여 있으므로 넉넉히 보고,
    // 되돌린 뒤 **모든 점에서 정말 0 인지** 다시 확인해 걸러낸다.
    const coeffs = unit.map((c) => nearRat(c));
    if (coeffs.some((c) => c === null)) continue;

    // 되돌린 식이 **정말** 0 인지 모든 점에서 다시 확인한다
    const evalAt = ([x, y]) => coeffs.reduce(
      (s, c, k) => s + c.value * Math.pow(x, basis[k][0]) * Math.pow(y, basis[k][1]), 0,
    );
    // 다시 확인할 때의 허용치는 항들의 실제 크기에 맞춘다
    let mag = 1;
    for (const r of raws) for (let k = 0; k < m; k++) mag = Math.max(mag, Math.abs(r[k]));
    const tol = 1e-9 * mag;
    if (!pts.every((p) => Math.abs(evalAt(p)) <= tol)) continue;

    const others = check.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
    const passed = others.filter((p) => Math.abs(evalAt(p)) <= tol).length;

    return {
      degree: d,
      coeffs,
      basis,
      text: relationText(coeffs, basis),
      residual: rms,
      exact: true,
      derivation: `총차수 ${d} 이하의 단항식 ${m}개를 늘어놓고, 점들을 넣어 만든 그램 행렬의 `
        + '가장 작은 고유벡터를 구했습니다. 그 계수를 유리수로 되돌린 뒤, 되돌린 식이 '
        + '모든 점에서 정말 0 이 되는지 다시 확인한 것만 관계로 인정합니다.',
      checked: others.length,
      passed,
      evaluate: evalAt,
    };
  }
  return null;
}

/** 배정밀도 계수를 작은 분모의 유리수로 (그럴 수 없으면 null) */
function nearRat(c, maxDen = 64) {
  if (!isFinite(c)) return null;
  if (Math.abs(c) < 1e-8) return { value: 0, n: 0n, d: 1n, text: '0' };
  for (let d = 1; d <= maxDen; d++) {
    const n = Math.round(c * d);
    if (n !== 0 && Math.abs(c - n / d) < 1e-9 * Math.max(1, Math.abs(c))) {
      const r = ratFromNumber(n / d);
      return { value: n / d, n: BigInt(n), d: BigInt(d), text: r ? r.toString() : String(n / d) };
    }
  }
  return null;
}

/** 계수와 단항식을 사람이 읽는 식으로 — "x^2 + y^2 = 1" */
function relationText(coeffs, basis) {
  // 분모를 없애 정수 계수로
  let lcm = 1n;
  for (const c of coeffs) lcm = (lcm * c.d) / bgcd(lcm, c.d);
  const ints = coeffs.map((c) => (c.n * lcm) / c.d);
  let g = 0n;
  for (const v of ints) g = bgcd(g, v < 0n ? -v : v);
  if (g === 0n) g = 1n;
  // 부호는 **차수가 가장 높은 항** 기준으로 맞춘다.
  // 상수항 기준으로 맞추면 x² + y² = 1 이 −x² − y² = −1 로 나온다.
  let lead = 1n;
  let leadDeg = -1;
  ints.forEach((v, k) => {
    const deg = basis[k][0] + basis[k][1];
    if (v !== 0n && deg > leadDeg) { leadDeg = deg; lead = v; }
  });
  const sign = lead < 0n ? -1n : 1n;
  const norm = ints.map((v) => (v / g) * sign);

  // 상수항은 오른쪽으로 넘긴다
  const constIdx = basis.findIndex(([i, j]) => i === 0 && j === 0);
  const rhs = constIdx >= 0 ? -norm[constIdx] : 0n;
  // 차수가 높은 항부터 적는다 (x^2 - y = 0 이지 -y + x^2 = 0 이 아니다)
  const order = norm.map((v, k) => k)
    .filter((k) => norm[k] !== 0n && k !== constIdx)
    .sort((a, c) => (basis[c][0] + basis[c][1]) - (basis[a][0] + basis[a][1]) || a - c);
  let lhs = '';
  for (const k of order) {
    const v = norm[k];
    const mag = v < 0n ? -v : v;
    const mono = monText(basis[k][0], basis[k][1]);
    const body = mag === 1n ? mono : `${mag}${mono}`;
    lhs += lhs === '' ? (v < 0n ? `-${body}` : body) : (v < 0n ? ` - ${body}` : ` + ${body}`);
  }
  return `${lhs || '0'} = ${rhs}`;
}

const bgcd = (a, b) => { let x = a < 0n ? -a : a; let y = b < 0n ? -b : b; while (y) { [x, y] = [y, x % y]; } return x; };

export { basisOf };
