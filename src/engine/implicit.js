// 음함수 f(x,y)=0 의 해집합 추적 엔진.
//
// GeoGebra 류의 균일 격자 marching squares 를 세 가지 방향으로 보완했다.
//   1) 적응 격자 — 셀마다 f 가 휘는 정도를 재어 필요한 만큼만 세분한다.
//      허용 오차 ε(화면 픽셀 단위)을 정하면 그 아래로 내려갈 배율을 스스로 고른다.
//      이웃과 한 단계 넘게 차이 나지 않게 다듬어 셀 경계의 이음매를 막는다.
//      셀 안에 통째로 든 작은 고리를 놓치지 않도록 반 칸 격자(9점)로 훑는다.
//   2) 점근선 판별      — 부호가 뒤집혀도 값이 폭발하면 근이 아니라 극점으로 보고 버린다.
//   3) 고립해(점열) 탐색 — 부호 변화가 전혀 없는 셀에서도 |f| 의 국소 최소를 찾아
//      x²+y²=0, sin²x+sin²y=0 처럼 "점"으로만 이루어진 해집합을 복원한다.
//      균일 격자 등고선법은 이런 해를 원리적으로 놓친다.

import { refineIsolated } from '../math/numeric.js';

const CORNER_DX = [0, 1, 1, 0];
const CORNER_DY = [0, 0, 1, 1];

// 각 case 마다 이어야 할 (edgeA, edgeB) 쌍. edge: 0=아래 1=오른쪽 2=위 3=왼쪽
const CASES = {
  1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]],
  6: [[0, 2]], 7: [[2, 3]], 8: [[2, 3]], 9: [[0, 2]],
  11: [[1, 2]], 12: [[3, 1]], 13: [[0, 1]], 14: [[3, 0]],
};

/**
 * @param {(x:number,y:number)=>number} f
 * @param {{xmin,xmax,ymin,ymax,width,height}} view 화면 영역(픽셀 크기 포함)
 * @param {object} [opts]
 * @returns {{polylines:number[][], points:number[][], evals:number}}
 */
export function traceImplicit(f, view, opts = {}) {
  const {
    coarsePx = 14,          // 성긴 셀의 화면상 크기(px)
    refine = null,          // 세분 배율을 손으로 정하고 싶을 때 (null 이면 ε 로 자동)
    epsilonPx = 0.08,       // 허용 오차 — 곡선이 화면에서 이만큼(px)보다 어긋나지 않게
    findIsolated = true,
    maxCoarse = 200,
    maxRefine = 64,
    budget = 250000,        // 세분 표본 수 상한 (넘으면 모든 단계를 함께 낮춘다)
  } = opts;

  const { xmin, xmax, ymin, ymax } = view;
  const W = Math.max(1, view.width || 800);
  const H = Math.max(1, view.height || 600);
  const nx = Math.min(maxCoarse, Math.max(8, Math.round(W / coarsePx)));
  const ny = Math.min(maxCoarse, Math.max(8, Math.round(H / coarsePx)));
  const hx = (xmax - xmin) / nx;
  const hy = (ymax - ymin) / ny;

  let evals = 0;
  const F = (x, y) => {
    evals++;
    const v = f(x, y);
    return typeof v === 'number' ? v : NaN;
  };

  // ── 1단계: 반 칸 격자로 훑는다 ────────────────────────────
  // 꼭짓점만 보면 셀 하나에 통째로 든 작은 고리를 놓친다 (부호가 안 바뀐다).
  // 모서리 중점과 셀 중심까지 함께 보면 그런 것도 걸린다.
  const mx = 2 * nx;
  const my = 2 * ny;
  const g = new Float64Array((mx + 1) * (my + 1));
  const sx2 = hx / 2;
  const sy2 = hy / 2;
  for (let b = 0; b <= my; b++) {
    const y = ymin + b * sy2;
    for (let a = 0; a <= mx; a++) g[b * (mx + 1) + a] = F(xmin + a * sx2, y);
  }
  const half = (a, b) => g[b * (mx + 1) + a];
  const at = (i, j) => half(2 * i, 2 * j);

  const segments = [];
  const points = [];
  const cellDiag = Math.hypot(hx, hy);
  const worldPerPx = Math.max((xmax - xmin) / W, (ymax - ymin) / H);
  const eps = Math.max(1e-12, epsilonPx * worldPerPx);

  const cellMin = new Float64Array(nx * ny).fill(Infinity);
  const produced = new Uint8Array(nx * ny);
  const level = new Int8Array(nx * ny).fill(-1);      // -1 = 비활성

  // ── 2단계: 셀마다 필요한 세분 정도를 정한다 ──────────────
  // 조각선분이 참 곡선에서 벗어나는 정도는 칸 크기의 제곱에 비례한다.
  // 한 칸 안에서 f 가 얼마나 휘는지를 (중심값 − 꼭짓점 평균) 으로 재고,
  // 기울기로 나눠 길이 단위의 오차로 바꾼 뒤, 그 오차가 ε 아래로 내려갈 배율을 고른다.
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const st = [];
      for (let b = 0; b <= 2; b++) for (let a = 0; a <= 2; a++) st.push(half(2 * i + a, 2 * j + b));
      const nan = st.some((t) => !isFinite(t));
      let pos = 0, neg = 0, minAbs = Infinity;
      for (const t of st) {
        if (!isFinite(t)) continue;
        if (t > 0) pos++; else if (t < 0) neg++; else { pos++; neg++; }
        minAbs = Math.min(minAbs, Math.abs(t));
      }
      cellMin[j * nx + i] = minAbs;
      const crosses = pos > 0 && neg > 0;

      const c00 = st[0], c10 = st[2], c01 = st[6], c11 = st[8], center = st[4];
      const gx = (c10 - c00) / hx;
      const gy = (c01 - c00) / hy;
      const gradMag = Math.hypot(gx, gy);
      // 부호가 안 바뀌어도 셀 안에서 f 가 0 을 스칠 수 있다. 그 가능성은
      // **셀 안에서 실제로 관찰된 변화폭**으로 가늠한다. 꼭짓점 두 개로 기울기를
      // 어림하면 y = sin 50x 처럼 한 칸에 한 주기가 들어가는 식에서 크게 어긋나
      // 화면 전체가 활성 셀이 된다.
      let lo9 = Infinity, hi9 = -Infinity;
      for (const t of st) if (isFinite(t)) { lo9 = Math.min(lo9, t); hi9 = Math.max(hi9, t); }
      const swing = isFinite(lo9) ? hi9 - lo9 : 0;
      const nearZero = isFinite(minAbs) && minAbs <= swing * 0.75;
      if (!crosses && !nearZero && !nan) continue;

      let k;
      if (refine) k = refine;
      else {
        // 휘어짐을 길이 오차로: |f(중심) − 꼭짓점 평균| / |∇f|
        const bend = Math.abs(center - (c00 + c10 + c01 + c11) / 4);
        const errAt1 = gradMag > 0 && isFinite(bend) ? bend / gradMag : cellDiag;
        const need = Math.sqrt(Math.max(errAt1, 0) / eps);
        k = Math.pow(2, Math.ceil(Math.log2(Math.max(2, Math.min(maxRefine, need)))));
        if (!isFinite(k)) k = maxRefine;
      }
      level[j * nx + i] = Math.round(Math.log2(Math.max(2, Math.min(maxRefine, k))));
    }
  }

  // ── 3단계: 이웃과 한 단계 넘게 차이 나지 않도록 고른다 ────
  // 세분 배율이 크게 어긋나면 셀 경계에서 이음매가 벌어진다.
  balanceLevels(level, nx, ny);
  scaleToBudget(level, nx, ny, budget);

  // ── 4단계: 활성 셀을 각자의 배율로 세분한다 ──────────────
  let maxK = 2;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const lv = level[j * nx + i];
      if (lv < 0) continue;
      const k = 1 << lv;
      maxK = Math.max(maxK, k);
      const before = segments.length;
      marchCell(F, xmin + i * hx, ymin + j * hy, hx, hy, k, segments);
      if (segments.length > before) produced[j * nx + i] = 1;
    }
  }

  // ── 고립해(점열) 탐색 ────────────────────────────────────
  // |f| 가 격자 위에서 국소 최소가 되는 셀만 골라 Nelder–Mead 로 파고든다.
  // 셀이 영점을 정확히 가운데 품으면 유한차분 기울기가 0 이 되어 버리므로,
  // 기울기 기준만으로는 이런 해를 놓친다. 국소 최소 판정이 그 빈틈을 메운다.
  if (findIsolated) {
    const finite = Array.from(cellMin).filter((v) => isFinite(v)).sort((a, b) => a - b);
    const median = finite.length ? finite[finite.length >> 1] : 0;
    // |f| 가 유난히 작은 셀만 후보로 삼는다. 문턱을 넉넉히 두면 곡선 주변 셀이
    // 전부 후보가 되어 느려지기만 한다.
    const thr = median * 0.2;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const m = cellMin[k];
        // 곡선 조각이 나온 셀도 건너뛰지 않는다. 고립해가 곡선 시작점과 같은 셀에
        // 들어 있는 경우(y² = x²(x−0.1) 의 원점)를 놓치기 때문이다.
        // 진짜 해인지는 아래 findIsolatedZero 의 부호 검사가 가려낸다.
        if (!isFinite(m) || !(m <= thr)) continue;
        // 이웃과 견주어 |f| 가 가장 작은 셀만 고른다.
        // 다만 곡선이 지나간 이웃은 견주지 않는다 — 곡선 옆에 붙은 고립해가
        // 곡선 쪽 셀에 가려 후보에서 빠지기 때문이다.
        let isMin = true;
        for (let dj = -1; dj <= 1 && isMin; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const a = i + di, b = j + dj;
            if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
            const nk = b * nx + a;
            if (produced[nk]) continue;
            if (cellMin[nk] < m) { isMin = false; break; }
          }
        }
        if (!isMin) continue;
        const p = findIsolatedZero(F, xmin + i * hx, ymin + j * hy, hx, hy);
        if (p) points.push(p);
      }
    }
  }

  // 잇는 허용치. 같은 단계의 이웃 셀은 모서리 표본이 정확히 같은 값이라 딱 맞고,
  // 한 단계 다른 이웃은 ε 만큼만 어긋난다. 그러니 ε 의 몇 배면 넉넉하다.
  // 이걸 성긴 쪽 칸 크기로 잡으면 촘촘한 곡선에서 한 칸에 수백 개가 들어가
  // 잇는 데만 몇 백 ms 가 든다.
  const tol = Math.max(8 * eps, (Math.max(hx, hy) / maxK) * 6);
  const polylines = stitch(segments, tol);
  const snap = (v) => (Math.abs(v) < cellDiag * 1e-9 ? 0 : v);
  // 곡선 위에 이미 그려진 자리는 고립해가 아니다.
  // 기준을 넉넉히 잡으면 y² = x²(x−0.1) 처럼 곡선에 가까이 붙은 진짜 고립해까지 잃는다.
  // 첨점(y³ = x² 의 원점)처럼 곡선 위에 정확히 놓인 점만 걸러내면 되므로 좁게 잡는다.
  const isolated = dropOnCurve(dedupe(points, Math.max(hx, hy) * 0.02), polylines, cellDiag * 0.15)
    .map(([x, y]) => [snap(x), snap(y)]);
  return { polylines, points: isolated, evals, epsilon: eps };
}

/**
 * 이웃한 활성 셀의 세분 단계가 1 을 넘게 차이 나지 않도록 다듬는다.
 * 4:1 로 어긋나면 경계에서 조각선분이 서로 어긋나 이음매가 보인다.
 */
function balanceLevels(level, nx, ny) {
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (level[k] < 0) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const a = i + di, b = j + dj;
          if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
          const nk = b * nx + a;
          if (level[nk] < 0) continue;
          if (level[nk] < level[k] - 1) { level[nk] = level[k] - 1; changed = true; }
        }
      }
    }
    if (!changed) break;
  }
}

/** 계획한 표본 수가 예산을 넘으면 모든 단계를 함께 낮춘다 */
function scaleToBudget(level, nx, ny, budget) {
  for (let guard = 0; guard < 8; guard++) {
    let work = 0;
    for (let k = 0; k < level.length; k++) if (level[k] >= 0) work += (1 << level[k]) ** 2;
    if (work <= budget) return;
    let any = false;
    for (let k = 0; k < level.length; k++) {
      if (level[k] > 1) { level[k] -= 1; any = true; }
    }
    if (!any) return;
  }
}

/** 하나의 성긴 셀을 k×k 로 세분해 marching squares 를 돌린다. */
function marchCell(F, x0, y0, hx, hy, k, out) {
  const sx = hx / k;
  const sy = hy / k;
  const vals = new Float64Array((k + 1) * (k + 1));
  for (let b = 0; b <= k; b++) {
    const y = y0 + b * sy;
    for (let a = 0; a <= k; a++) vals[b * (k + 1) + a] = F(x0 + a * sx, y);
  }
  const V = (a, b) => vals[b * (k + 1) + a];

  for (let b = 0; b < k; b++) {
    for (let a = 0; a < k; a++) {
      const v = [V(a, b), V(a + 1, b), V(a + 1, b + 1), V(a, b + 1)];
      if (v.some((t) => !isFinite(t))) continue;       // 불연속 → 끊는다
      let idx = 0;
      for (let c = 0; c < 4; c++) if (v[c] >= 0) idx |= 1 << c;
      if (idx === 0 || idx === 15) continue;

      const px = x0 + a * sx;
      const py = y0 + b * sy;
      const edgePt = (e) => crossing(F, v, e, px, py, sx, sy);

      if (idx === 5 || idx === 10) {
        // 안장점 모호 case: 셀 중심값으로 연결 방향을 결정한다
        const c = F(px + sx / 2, py + sy / 2);
        const centerPositive = isFinite(c) ? c >= 0 : (v[0] + v[1] + v[2] + v[3]) >= 0;
        const pairs = (idx === 5) === centerPositive ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]];
        for (const [e1, e2] of pairs) pushSeg(out, edgePt(e1), edgePt(e2));
      } else {
        for (const [e1, e2] of CASES[idx]) pushSeg(out, edgePt(e1), edgePt(e2));
      }
    }
  }
}

function pushSeg(out, p, q) {
  if (!p || !q) return;
  // 격자점 위에 해가 정확히 놓이면 길이 0 짜리 조각이 생긴다 — 버린다
  if (p[0] === q[0] && p[1] === q[1]) return;
  out.push([p[0], p[1], q[0], q[1]]);
}

/**
 * 셀 모서리 위의 영점 위치.
 * 선형성 검사를 통과하지 못하면(=중점값이 선형보간과 크게 어긋나면) 극점으로 보고 버린다.
 */
function crossing(F, v, edge, px, py, sx, sy) {
  const [c1, c2] = [[0, 1], [1, 2], [3, 2], [0, 3]][edge];
  const v1 = v[c1];
  const v2 = v[c2];
  if (v1 === v2) return null;
  const t = v1 / (v1 - v2);
  if (!(t >= 0 && t <= 1)) return null;
  const x1 = px + CORNER_DX[c1] * sx, y1 = py + CORNER_DY[c1] * sy;
  const x2 = px + CORNER_DX[c2] * sx, y2 = py + CORNER_DY[c2] * sy;

  const mid = F((x1 + x2) / 2, (y1 + y2) / 2);
  if (!isFinite(mid)) return null;
  // 매끄러운 영점 근처에서 f 는 거의 선형이므로 중점값 ≈ 양 끝값의 평균이다.
  // 두 값의 차 |v1-v2| 로 정규화해서 비교하면, 점근선을 사이에 둔 가짜 부호 변화
  // (한쪽 값만 폭발하는 경우)를 확실히 걸러낼 수 있다.
  const span = Math.abs(v1 - v2);
  if (Math.abs(mid - (v1 + v2) / 2) > 0.35 * span + 1e-300) return null;
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t];
}

/**
 * 부호 변화가 없는 셀에서 |f| 의 국소 최소를 찾아 고립해(점)를 복원한다.
 * Nelder–Mead 로 대략 위치를 잡고 가우스-뉴턴으로 정련한다.
 */
export function findIsolatedZero(F, x0, y0, hx, hy) {
  const g = (p) => {
    const v = F(p[0], p[1]);
    return isFinite(v) ? Math.abs(v) : Infinity;
  };
  const cx = x0 + hx / 2, cy = y0 + hy / 2;
  let simplex = [[cx, cy], [cx + hx * 0.4, cy], [cx, cy + hy * 0.4]].map((p) => ({ p, v: g(p) }));

  for (let it = 0; it < 120; it++) {
    simplex.sort((a, b) => a.v - b.v);
    const [best, mid, worst] = simplex;
    if (!isFinite(best.v)) return null;
    const spread = Math.hypot(best.p[0] - worst.p[0], best.p[1] - worst.p[1]);
    if (spread < 1e-13 * Math.max(1, Math.abs(cx) + Math.abs(cy))) break;
    const c = [(best.p[0] + mid.p[0]) / 2, (best.p[1] + mid.p[1]) / 2];
    const refl = [2 * c[0] - worst.p[0], 2 * c[1] - worst.p[1]];
    const vr = g(refl);
    if (vr < best.v) {
      const exp = [3 * c[0] - 2 * worst.p[0], 3 * c[1] - 2 * worst.p[1]];
      const ve = g(exp);
      simplex[2] = ve < vr ? { p: exp, v: ve } : { p: refl, v: vr };
    } else if (vr < mid.v) {
      simplex[2] = { p: refl, v: vr };
    } else {
      const con = [(c[0] + worst.p[0]) / 2, (c[1] + worst.p[1]) / 2];
      const vc = g(con);
      if (vc < worst.v) simplex[2] = { p: con, v: vc };
      else {
        simplex = simplex.map((s, i) =>
          i === 0 ? s : { p: [(s.p[0] + best.p[0]) / 2, (s.p[1] + best.p[1]) / 2], v: 0 });
        simplex.forEach((s, i) => { if (i > 0) s.v = g(s.p); });
      }
    }
  }
  simplex.sort((a, b) => a.v - b.v);
  let [bx, by] = simplex[0].p;

  const scale = Math.max(hx, hy);
  const polished = refineIsolated((x, y) => F(x, y), bx, by, scale);
  if (polished && isFinite(polished[0]) && isFinite(polished[1])) {
    const [rx, ry] = polished;
    if (Math.abs(rx - bx) < scale && Math.abs(ry - by) < scale &&
        Math.abs(F(rx, ry)) <= Math.abs(F(bx, by))) { bx = rx; by = ry; }
  }
  if (bx < x0 - hx * 0.05 || bx > x0 + hx * 1.05 || by < y0 - hy * 0.05 || by > y0 + hy * 1.05) return null;

  // 세 가지를 통과해야 진짜 고립해로 인정한다.
  //   (a) |f(p)| 가 주변 값에 비해 무시할 만큼 작다 — 실제로 해다
  //   (b) 각 방향에서 양옆의 부호가 같다 — 부호가 바뀌면 곡선이 지나는 점이지 고립해가 아니다
  //   (c) 두 배율에서 모두 그렇다 — 한 배율만 보면 표본 간격에 속을 수 있다
  const v0 = Math.abs(F(bx, by));
  if (!isFinite(v0)) return null;

  const sameSignAt = (r) => {
    const ex = hx * r, ey = hy * r;
    const fxp = F(bx + ex, by), fxm = F(bx - ex, by);
    const fyp = F(bx, by + ey), fym = F(bx, by - ey);
    if (![fxp, fxm, fyp, fym].every(isFinite)) return null;
    const probe = Math.max(Math.abs(fxp), Math.abs(fxm), Math.abs(fyp), Math.abs(fym));
    if (probe === 0) return null;
    // 양옆의 부호가 갈리면 그 방향으로 곡선이 지나간다는 뜻
    const ok = fxp * fxm >= 0 && fyp * fym >= 0
      && (fxp + fxm) * (fyp + fym) >= 0;      // 두 방향이 같은 쪽으로 부풀어야 한다
    return { ok, probe };
  };

  // 부호 검사는 가까이에서 한다. 넓게 재면 y² = x²(x−0.1) 처럼 곡선이 0.1 밖에
  // 안 떨어진 고립해에서 탐침이 곡선을 넘어가 부호가 갈려 버린다.
  // 곡선이 가로지르는 점은 어느 반지름에서든 부호가 갈리므로 좁게 재도 안전하다.
  const wide = sameSignAt(0.5);
  const near = sameSignAt(0.12);
  const closer = sameSignAt(0.03);
  if (!near || !closer) return null;
  const probeScale = Math.max(wide ? wide.probe : 0, near.probe);
  if (v0 >= probeScale * 1e-6) return null;
  if (!near.ok || !closer.ok) return null;
  return [bx, by];
}

/** 선분 조각들을 이어 폴리라인으로 만든다. */
export function stitch(segments, tol) {
  if (!segments.length) return [];
  // 칸 이름을 문자열로 만들면 이음 한 번에 9개씩 새 문자열이 생긴다.
  // 표본이 2만 개쯤 되는 곡선에서는 그 할당과 청소가 전체 시간의 6할을 먹었다.
  // 두 정수를 하나의 수로 접어 Map 의 키로 쓴다.
  const SPAN = 1 << 22;
  const cellKey = (bx, by) => (by + (SPAN >> 1)) * SPAN + (bx + (SPAN >> 1));
  const key = (x, y) => cellKey(Math.round(x / tol), Math.round(y / tol));
  const map = new Map();
  const addEnd = (k, idx) => {
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(idx);
  };
  segments.forEach((s, i) => {
    addEnd(key(s[0], s[1]), i);
    addEnd(key(s[2], s[3]), i);
  });
  const used = new Uint8Array(segments.length);
  const out = [];

  // 이미 쓴 선분은 칸에서 걷어낸다. 그러지 않으면 촘촘한 곡선에서 같은 칸을
  // 몇 번이고 훑게 되어, 표본이 2만 개쯤 되면 잇는 데만 몇 백 ms 가 든다.
  const neighbours = (x, y, self) => {
    const res = [];
    const bx = Math.round(x / tol), by = Math.round(y / tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = cellKey(bx + dx, by + dy);
        const list = map.get(k);
        if (!list) continue;
        let w = 0;
        for (let r = 0; r < list.length; r++) {
          const idx = list[r];
          if (used[idx]) continue;
          list[w++] = idx;
          if (idx !== self) res.push(idx);
        }
        list.length = w;
        if (w === 0) map.delete(k);
      }
    }
    return res;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const s = segments[i];
    const line = [s[0], s[1], s[2], s[3]];
    // 양쪽 끝으로 확장
    for (const dir of [1, 0]) {
      for (;;) {
        const n = line.length;
        const ex = dir ? line[n - 2] : line[0];
        const ey = dir ? line[n - 1] : line[1];
        let picked = -1, pickPt = null, bestD = Infinity;
        for (const idx of neighbours(ex, ey, i)) {
          const t = segments[idx];
          const d1 = Math.hypot(t[0] - ex, t[1] - ey);
          const d2 = Math.hypot(t[2] - ex, t[3] - ey);
          const d = Math.min(d1, d2);
          if (d < bestD && d <= tol * 1.5) {
            bestD = d;
            picked = idx;
            pickPt = d1 <= d2 ? [t[2], t[3]] : [t[0], t[1]];
          }
        }
        if (picked < 0) break;
        used[picked] = 1;
        if (dir) line.push(pickPt[0], pickPt[1]);
        else line.unshift(pickPt[0], pickPt[1]);
      }
    }
    if (line.length >= 4) out.push(line);
  }
  // 마무리: 끝점이 맞닿은 폴리라인끼리 한 번 더 이어 붙인다
  return mergeChains(out, tol * 2);
}

function mergeChains(lines, tol) {
  const res = lines.slice();
  for (let i = 0; i < res.length; i++) {
    if (!res[i]) continue;
    let changed = true;
    while (changed) {
      changed = false;
      const a = res[i];
      const ax = a[0], ay = a[1], bx = a[a.length - 2], by = a[a.length - 1];
      if (Math.hypot(ax - bx, ay - by) < tol) break;      // 이미 닫힌 곡선
      for (let j = 0; j < res.length; j++) {
        if (i === j || !res[j]) continue;
        const b = res[j];
        const cx = b[0], cy = b[1], dx = b[b.length - 2], dy = b[b.length - 1];
        if (Math.hypot(bx - cx, by - cy) < tol) { res[i] = a.concat(b.slice(2)); res[j] = null; changed = true; break; }
        if (Math.hypot(bx - dx, by - dy) < tol) { res[i] = a.concat(reverseLine(b).slice(2)); res[j] = null; changed = true; break; }
        if (Math.hypot(ax - dx, ay - dy) < tol) { res[i] = b.concat(a.slice(2)); res[j] = null; changed = true; break; }
        if (Math.hypot(ax - cx, ay - cy) < tol) { res[i] = reverseLine(b).concat(a.slice(2)); res[j] = null; changed = true; break; }
      }
    }
  }
  return res.filter(Boolean);
}

function reverseLine(l) {
  const out = [];
  for (let i = l.length - 2; i >= 0; i -= 2) out.push(l[i], l[i + 1]);
  return out;
}

/** 이미 곡선으로 그려진 곳에 찍힌 점은 고립해가 아니다. */
function dropOnCurve(pts, polylines, tol) {
  if (!pts.length || !polylines.length) return pts;
  return pts.filter((p) => {
    for (const line of polylines) {
      for (let i = 0; i < line.length; i += 2) {
        if (Math.hypot(line[i] - p[0], line[i + 1] - p[1]) < tol) return false;
      }
    }
    return true;
  });
}

function dedupe(pts, tol) {
  const out = [];
  for (const p of pts) {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= tol)) out.push(p);
  }
  return out;
}
