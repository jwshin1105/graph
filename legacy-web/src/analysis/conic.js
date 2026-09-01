// 점 집합에 이차곡선 Ax² + Bxy + Cy² + Dx + Ey + F = 0 을 맞추고 종류를 판별한다.
// 제약 |z| = 1 아래 |Mz|² 를 최소화 → 산포행렬의 최소 고유벡터.

import { smallestEigenvector, pretty, toRational } from '../math/numeric.js';

export function fitConic(pts) {
  if (pts.length < 5) return null;
  // 수치 안정을 위해 중심화·정규화
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  const sc = Math.max(1e-12, Math.sqrt(pts.reduce((s, p) => s + (p[0] - mx) ** 2 + (p[1] - my) ** 2, 0) / n));
  const rows = pts.map(([x, y]) => {
    const u = (x - mx) / sc, v = (y - my) / sc;
    return [u * u, u * v, v * v, u, v, 1];
  });
  const M = Array.from({ length: 6 }, () => new Array(6).fill(0));
  for (const r of rows) for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) M[i][j] += r[i] * r[j];
  const z = smallestEigenvector(M);
  if (!z || z.some((v) => !isFinite(v))) return null;

  // 잔차(정규화 좌표계 기준)
  let resid = 0;
  for (const r of rows) resid += Math.abs(r.reduce((s, v, i) => s + v * z[i], 0));
  resid /= n;

  // 원좌표계로 되돌리기: u=(x-mx)/sc
  const [a, b, c, d, e, f] = z;
  const A = a / (sc * sc);
  const B = b / (sc * sc);
  const C = c / (sc * sc);
  const D = (-2 * a * mx - b * my) / (sc * sc) + d / sc;
  const E = (-2 * c * my - b * mx) / (sc * sc) + e / sc;
  const F = (a * mx * mx + b * mx * my + c * my * my) / (sc * sc) - (d * mx + e * my) / sc + f;

  // 판정 허용오차는 적합 잔차에 맞춘다.
  // 곡선을 따라 뽑은 표본은 등고선 이산화 때문에 잔차가 1e-6 수준까지 커지는데,
  // 고정된 1e-8 잣대로는 멀쩡한 원도 타원으로 밀려난다.
  const tol = Math.max(1e-9, resid * 200);
  const deg = degeneracy(z[0], z[1], z[2], z[3], z[4], z[5], tol);
  return {
    coef: [A, B, C, D, E, F], residual: resid, tol,
    kind: deg || classify(z[0], z[1], z[2], tol), degenerate: !!deg,
    ...describe(A, B, C, D, E, F, tol),
  };
}

/**
 * 퇴화 여부 판정.
 * 이차형식 행렬 [[A, B/2, D/2], [B/2, C, E/2], [D/2, E/2, F]] 의 행렬식이 0 이면
 * 곡선이 두 직선·한 점 등으로 무너진 경우다.
 */
function degeneracy(A, B, C, D, E, F, tol = 1e-8) {
  const M = [[A, B / 2, D / 2], [B / 2, C, E / 2], [D / 2, E / 2, F]];
  const det =
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C), Math.abs(D), Math.abs(E), Math.abs(F), 1e-30);
  if (Math.abs(det) > tol * scale ** 3) return null;
  const disc = B * B - 4 * A * C;
  const q = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
  if (q < 1e-12 * scale) return '직선';
  if (disc > tol * q * q) return '두 직선(교차)';
  if (disc < -tol * q * q) return '한 점';
  return '두 평행선';
}

function classify(A, B, C, tol = 1e-9) {
  const disc = B * B - 4 * A * C;
  const quadScale = Math.max(Math.abs(A), Math.abs(B), Math.abs(C));
  if (quadScale < Math.max(1e-10, tol)) return '직선';
  if (Math.abs(disc) < tol * quadScale) return '포물선';
  if (disc < 0) {
    const round = Math.abs(A - C) < tol * quadScale && Math.abs(B) < tol * quadScale;
    return round ? '원' : '타원';
  }
  return '쌍곡선';
}

function describe(A, B, C, D, E, F, tol = 1e-9) {
  const disc = B * B - 4 * A * C;
  const out = {};
  if (Math.abs(disc) > 1e-12) {
    // 중심 (Ax+By/2+D/2=0 형태의 연립)
    const cx = (2 * C * D - B * E) / disc;
    const cy = (2 * A * E - B * D) / disc;
    if (isFinite(cx) && isFinite(cy)) out.center = [cx, cy];
  }
  if (Math.abs(B) < 1e-9 && Math.abs(A - C) < 1e-9 * Math.max(Math.abs(A), 1e-12) && Math.abs(A) > 1e-12) {
    const cx = -D / (2 * A), cy = -E / (2 * A);
    const r2 = cx * cx + cy * cy - F / A;
    if (r2 > 0) { out.center = [cx, cy]; out.radius = Math.sqrt(r2); }
  }
  // 회전각
  if (Math.abs(B) > 1e-12) out.rotation = 0.5 * Math.atan2(B, A - C);
  out.equation = conicString([A, B, C, D, E, F], tol);
  return out;
}

export function conicString(coef, tol = 1e-9) {
  const names = ['x²', 'xy', 'y²', 'x', 'y', ''];
  // 가장 큰 계수로 정규화한 뒤, 적합 정밀도만큼만 남기고 정리한다.
  // 그러지 않으면 0.250004·x² − 1.8e-6·xy 처럼 잡음이 그대로 식에 남는다.
  const m = Math.max(...coef.map(Math.abs));
  const snap = Math.max(tol * 20, 1e-9);
  const c = coef.map((v) => {
    const t = v / m;
    if (Math.abs(t) < snap) return 0;
    const r = toRational(t, 100, snap);
    return r ? r.p / r.q : t;
  });
  let s = '';
  c.forEach((v, i) => {
    if (v === 0) return;
    const mag = pretty(Math.abs(v));
    const body = names[i] ? (mag === '1' ? names[i] : `${mag}${/^\d+$/.test(mag) ? '' : '·'}${names[i]}`) : mag;
    s += s === '' ? (v < 0 ? `-${body}` : body) : (v < 0 ? ` - ${body}` : ` + ${body}`);
  });
  return `${s || '0'} = 0`;
}
