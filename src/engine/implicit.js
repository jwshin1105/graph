// 음함수 f(x,y)=0 의 해집합 추적 엔진.
//
// GeoGebra 류의 균일 격자 marching squares 를 세 가지 방향으로 보완했다.
//   1) 2단 적응 격자   — 해가 지나갈 가능성이 있는 셀만 8~32배로 세분한다.
//      (같은 배율로 세분하므로 셀 경계에 T-접합 틈이 생기지 않는다)
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
    refine = 10,            // 활성 셀 세분 배율 (모든 활성 셀에 동일하게 적용해
                            //  이웃 셀과 모서리 표본이 정확히 일치 → 이음매 없음)
    findIsolated = true,    // 고립해(점열) 탐색 여부
    maxCoarse = 200,
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

  // ── 1단계: 성긴 격자 표본 ──────────────────────────────────
  const g = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    const y = ymin + j * hy;
    for (let i = 0; i <= nx; i++) g[j * (nx + 1) + i] = F(xmin + i * hx, y);
  }
  const at = (i, j) => g[j * (nx + 1) + i];

  const segments = [];
  const points = [];
  const cellDiag = Math.hypot(hx, hy);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      const nan = v.some((t) => !isFinite(t));
      let pos = 0, neg = 0, minAbs = Infinity;
      for (const t of v) {
        if (!isFinite(t)) continue;
        if (t > 0) pos++; else if (t < 0) neg++; else { pos++; neg++; }
        minAbs = Math.min(minAbs, Math.abs(t));
      }
      const crosses = pos > 0 && neg > 0;

      // 기울기 추정으로 "부호는 안 바뀌지만 해가 있을 수 있는" 셀을 골라낸다
      const gx = (v[1] - v[0]) / hx;
      const gy = (v[3] - v[0]) / hy;
      const gradMag = Math.hypot(gx, gy);
      const nearZero = isFinite(minAbs) && minAbs <= Math.max(gradMag * cellDiag * 1.2, 0);

      if (!crosses && !nearZero && !nan) continue;

      const x0 = xmin + i * hx;
      const y0 = ymin + j * hy;
      const before = segments.length;
      marchCell(F, x0, y0, hx, hy, refine, segments);

      // 곡선 조각이 하나도 안 나왔는데 |f| 가 유난히 작다면 고립해 후보
      const degenerate = isFinite(minAbs) && minAbs <= gradMag * cellDiag * 0.7;
      if (findIsolated && segments.length === before && degenerate && !nan) {
        const p = findIsolatedZero(F, x0, y0, hx, hy);
        if (p) points.push(p);
      }
    }
  }

  const tol = (Math.max(hx, hy) / refine) * 1.5;
  const polylines = stitch(segments, tol);
  const isolated = dropOnCurve(dedupe(points, Math.max(hx, hy) * 0.02), polylines, cellDiag * 0.5);
  return { polylines, points: isolated, evals };
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
  if (p && q) out.push([p[0], p[1], q[0], q[1]]);
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

  // 두 가지 검증을 통과해야 진짜 고립해로 인정한다.
  //   (a) |f(p)| 가 주변 값에 비해 무시할 만큼 작다 (실제로 해)
  //   (b) ∇f(p) ≈ 0     (부호가 안 바뀌는 해 = 접하는 해이므로 기울기가 0.
  //       이 검사가 없으면 곡선 바로 옆 셀에서 곡선 위의 점을 고립해로 오인한다)
  const v0 = Math.abs(F(bx, by));
  const ex = hx * 0.5, ey = hy * 0.5;
  const fxp = F(bx + ex, by), fxm = F(bx - ex, by);
  const fyp = F(bx, by + ey), fym = F(bx, by - ey);
  const probe = Math.max(Math.abs(fxp), Math.abs(fxm), Math.abs(fyp), Math.abs(fym));
  if (!isFinite(v0) || !isFinite(probe) || probe === 0) return null;
  if (v0 >= probe * 1e-6) return null;
  const gradStep = Math.hypot((fxp - fxm) / 2, (fyp - fym) / 2);
  if (gradStep > probe * 0.2) return null;
  return [bx, by];
}

/** 선분 조각들을 이어 폴리라인으로 만든다. */
export function stitch(segments, tol) {
  if (!segments.length) return [];
  const key = (x, y) => `${Math.round(x / tol)},${Math.round(y / tol)}`;
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

  const neighbours = (x, y, self) => {
    const res = [];
    const bx = Math.round(x / tol), by = Math.round(y / tol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = map.get(`${bx + dx},${by + dy}`);
        if (!list) continue;
        for (const idx of list) if (idx !== self && !used[idx]) res.push(idx);
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
    out.push(line);
  }
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
