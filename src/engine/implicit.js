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

  // 셀마다 |f| 의 최솟값을 기록해 둔다 — 뒤에서 "국소 최소 셀"을 골라내는 데 쓴다.
  const cellMin = new Float64Array(nx * ny).fill(Infinity);
  const produced = new Uint8Array(nx * ny);

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
      cellMin[j * nx + i] = minAbs;
      const crosses = pos > 0 && neg > 0;

      const gx = (v[1] - v[0]) / hx;
      const gy = (v[3] - v[0]) / hy;
      const gradMag = Math.hypot(gx, gy);
      const nearZero = isFinite(minAbs) && minAbs <= gradMag * cellDiag * 1.2;

      if (!crosses && !nearZero && !nan) continue;
      const before = segments.length;
      marchCell(F, xmin + i * hx, ymin + j * hy, hx, hy, refine, segments);
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

  const tol = (Math.max(hx, hy) / refine) * 1.5;
  const polylines = stitch(segments, tol);
  const snap = (v) => (Math.abs(v) < cellDiag * 1e-9 ? 0 : v);
  // 곡선 위에 이미 그려진 자리는 고립해가 아니다.
  // 기준을 넉넉히 잡으면 y² = x²(x−0.1) 처럼 곡선에 가까이 붙은 진짜 고립해까지 잃는다.
  // 첨점(y³ = x² 의 원점)처럼 곡선 위에 정확히 놓인 점만 걸러내면 되므로 좁게 잡는다.
  const isolated = dropOnCurve(dedupe(points, Math.max(hx, hy) * 0.02), polylines, cellDiag * 0.15)
    .map(([x, y]) => [snap(x), snap(y)]);
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
