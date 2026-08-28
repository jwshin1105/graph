// 그려진 곡선 자체의 기하 — 닫혀 있는가, 길이는 얼마인가, 자기 자신과 만나는가.
//
// 식에서는 읽을 수 없고 그림에서만 보이는 것들이다. 심장형 r = 1+cos θ 가 닫힌
// 곡선이라는 것, 그 둘레가 8 이고 넓이가 3π/2 라는 것은 계수만 봐서는 나오지 않는다.

import { pretty, trimNum } from '../math/numeric.js';

/**
 * @param {number[][]} polylines  [x0,y0,x1,y1,…] 꼴의 폴리라인 목록
 * @param {object} [opts]
 * @param {object} [opts.bounds]  보이는 범위 (화면에 잘렸는지 판단하는 데 쓴다)
 * @returns {{findings:Array, closed:boolean, length:number, area:number|null}}
 */
export function analyzeCurve(polylines, opts = {}) {
  const findings = [];
  const lines = (polylines || []).filter((l) => l && l.length >= 4);
  if (!lines.length) return { findings, closed: false, length: 0, area: null };

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let length = 0;
  for (const l of lines) {
    for (let i = 0; i < l.length; i += 2) {
      if (l[i] < minX) minX = l[i];
      if (l[i] > maxX) maxX = l[i];
      if (l[i + 1] < minY) minY = l[i + 1];
      if (l[i + 1] > maxY) maxY = l[i + 1];
      if (i) length += Math.hypot(l[i] - l[i - 2], l[i + 1] - l[i - 1]);
    }
  }
  const extent = Math.max(maxX - minX, maxY - minY);
  if (!(extent > 0)) return { findings, closed: false, length, area: null };

  const b = opts.bounds;
  // 화면에 잘린 곡선은 "열려 있다" 고 말할 수 없다 — 밖에서 이어질 수 있다
  const clipped = !!b && (minX <= b.xmin + extent * 1e-6 || maxX >= b.xmax - extent * 1e-6
    || minY <= b.ymin + extent * 1e-6 || maxY >= b.ymax - extent * 1e-6);

  const one = lines.length === 1 ? lines[0] : null;
  const closed = !!one && Math.hypot(one[0] - one[one.length - 2], one[1] - one[one.length - 1])
    < extent * 1e-4;

  const hits = selfIntersections(lines, extent);
  const cross = hits.length;

  if (closed) {
    // 스스로 가로지르는 곡선은 신발끈 넓이가 상쇄되어 뜻이 흐려지므로 적지 않는다
    const area = Math.abs(shoelace(one)) / 2;
    findings.push({
      type: 'closed', title: '닫힌 곡선', confidence: 1,
      detail: `시작점으로 되돌아옵니다. 둘레는 약 ${pretty(round4(length))}`
        + (cross ? ` 이고, 자기 자신과 ${cross}곳에서 만납니다.`
          : `, 둘러싼 넓이는 약 ${pretty(round4(area))} 입니다.`),
    });
    if (cross) findings.push(crossFinding(hits));
    return { findings, closed, length, area: cross ? null : area, crossings: hits };
  }

  if (!clipped) {
    findings.push({
      type: 'open', title: '열린 곡선', confidence: 0.9,
      detail: `양 끝이 만나지 않습니다. 그려진 길이는 약 ${pretty(round4(length))} 입니다.`,
    });
  } else {
    findings.push({
      type: 'arc', title: '보이는 부분의 길이', confidence: 0.8,
      detail: `약 ${pretty(round4(length))} 입니다. 곡선이 화면 끝에 닿아 있어 실제로는 더 깁니다.`,
    });
  }
  if (cross) findings.push(crossFinding(hits));
  return { findings, closed, length, area: null, crossings: hits };
}

function crossFinding(hits) {
  return {
    type: 'selfcross', title: `자기교차 ${hits.length}곳`, confidence: 0.85,
    detail: hits.slice(0, 6).map(([x, y]) => `(${pretty(round4(x))}, ${pretty(round4(y))})`).join(', ')
      + (hits.length > 6 ? ' …' : ''),
    points: hits,
  };
}

const round4 = (v) => {
  if (!isFinite(v) || v === 0) return v;
  const p = Math.pow(10, 4 - Math.ceil(Math.log10(Math.abs(v))));
  return Math.round(v * p) / p;
};

/** 신발끈 공식 */
function shoelace(l) {
  let s = 0;
  for (let i = 0; i + 3 < l.length; i += 2) {
    s += l[i] * l[i + 3] - l[i + 2] * l[i + 1];
  }
  return s;
}

/**
 * 곡선이 스스로 만나는 **자리**.
 *
 * 선분 쌍을 모두 보면 표본 수의 제곱이라 무거우므로, 곡선을 격자에 담아 같은 칸에
 * 든 선분끼리만 견준다. 그리고 횟수가 아니라 자리를 센다 — 장미 곡선 r = sin 3θ 는
 * 원점에서 꽃잎들이 모두 만나므로 선분 교차는 수백 번이지만 만나는 자리는 하나다.
 */
function selfIntersections(lines, extent) {
  const segs = [];
  const closedOf = [];
  for (let k = 0; k < lines.length; k++) {
    const l = lines[k];
    closedOf[k] = Math.hypot(l[0] - l[l.length - 2], l[1] - l[l.length - 1]) < extent * 1e-4;
    for (let i = 0; i + 3 < l.length; i += 2) {
      segs.push([l[i], l[i + 1], l[i + 2], l[i + 3], k, i / 2, l.length / 2 - 1]);
    }
  }
  if (segs.length > 20000) return [];               // 너무 잘게 나뉜 곡선은 세지 않는다
  const cell = extent / 64;
  const buckets = new Map();
  const keysOf = (s) => {
    const out = [];
    const i0 = Math.floor(Math.min(s[0], s[2]) / cell), i1 = Math.floor(Math.max(s[0], s[2]) / cell);
    const j0 = Math.floor(Math.min(s[1], s[3]) / cell), j1 = Math.floor(Math.max(s[1], s[3]) / cell);
    if ((i1 - i0) > 64 || (j1 - j0) > 64) return out;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) out.push(`${i},${j}`);
    return out;
  };
  const hits = [];
  const seen = new Set();
  for (let n = 0; n < segs.length; n++) {
    const s = segs[n];
    for (const key of keysOf(s)) {
      const bucket = buckets.get(key);
      if (bucket) {
        for (const m of bucket) {
          const t = segs[m];
          if (t[4] === s[4] && adjacent(t, s, closedOf[s[4]])) continue;
          const pair = `${m}:${n}`;
          if (seen.has(pair)) continue;
          seen.add(pair);
          const p = crossPoint(s, t);
          if (p) hits.push(p);
        }
        bucket.push(n);
      } else buckets.set(key, [n]);
    }
  }
  // 같은 자리에서 만난 것은 하나로 (꽃잎이 모이는 원점 등)
  const tol = extent * 0.01;
  const out = [];
  for (const p of hits) {
    if (!out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < tol)) out.push(p);
  }
  return out;
}

/** 끝점을 공유하는 이웃 선분인가 (닫힌 곡선이면 처음과 끝도 이웃이다) */
function adjacent(a, b, closed) {
  const d = Math.abs(a[5] - b[5]);
  if (d <= 1) return true;
  return closed && d >= a[6] - 1;
}

/** 두 선분이 실제로 가로지르면 그 점, 아니면 null */
function crossPoint(a, b) {
  const r = [a[2] - a[0], a[3] - a[1]];
  const s = [b[2] - b[0], b[3] - b[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (den === 0) return null;                        // 나란하거나 겹친 선분은 "가로지름"이 아니다
  // 거의 나란한 선분이 스치는 것은 진짜 교차가 아니다.
  // 장미 곡선 r = sin 3θ 는 꽃잎을 두 번씩 되짚어 그리는데, 그때 거의 겹친 두 경로가
  // 표본 잡음만큼 엇갈리며 수백 번 "교차"한다. 15° 보다 얕게 만나면 세지 않는다 —
  // 실제로 가로지르는 자리(장미의 원점 60°, 매듭의 원점 90°)는 훨씬 크게 벌어진다.
  const sinTheta = Math.abs(den) / (Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1]));
  if (sinTheta < 0.26) return null;
  const qp = [b[0] - a[0], b[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

export { trimNum };
