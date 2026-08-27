// 방정식·연립방정식의 해집합을 구하는 층.
// "해가 곡선이면 곡선으로, 점이면 점열로" 표현하는 것이 이 모듈의 목표.

import { findRoots, newton2D } from '../math/numeric.js';
import { traceImplicit } from './implicit.js';

/**
 * 한 변수 방정식 f(x)=0 의 해 (점열).
 * 삼각방정식처럼 해가 무한 등차수열이면 화면 범위 안의 것을 모두 돌려준다.
 */
export function solve1D(f, xmin, xmax, samples = 4000) {
  return findRoots(f, xmin, xmax, samples).map((x) => [x, 0]);
}

/** 두 폴리라인 집합의 교점 */
export function polylineIntersections(A, B) {
  const out = [];
  for (const la of A) {
    for (const lb of B) {
      for (let i = 0; i + 3 < la.length; i += 2) {
        const p1 = [la[i], la[i + 1]], p2 = [la[i + 2], la[i + 3]];
        for (let j = 0; j + 3 < lb.length; j += 2) {
          const q1 = [lb[j], lb[j + 1]], q2 = [lb[j + 2], lb[j + 3]];
          const p = segIntersect(p1, p2, q1, q2);
          if (p) out.push(p);
        }
      }
    }
  }
  return out;
}

function segIntersect(p1, p2, q1, q2) {
  const r = [p2[0] - p1[0], p2[1] - p1[1]];
  const s = [q2[0] - q1[0], q2[1] - q1[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-18) return null;
  const t = ((q1[0] - p1[0]) * s[1] - (q1[1] - p1[1]) * s[0]) / den;
  const u = ((q1[0] - p1[0]) * r[1] - (q1[1] - p1[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [p1[0] + t * r[0], p1[1] + t * r[1]];
}

/**
 * 연립 음함수 F(x,y)=0 ∧ G(x,y)=0 의 해 (일반적으로 점열).
 * 각 곡선을 추적한 뒤 교점을 구하고 뉴턴법으로 정련한다.
 */
export function solveSystem2D(F, G, view, opts = {}) {
  const a = traceImplicit(F, view, opts);
  const b = traceImplicit(G, view, opts);
  const raw = polylineIntersections(a.polylines, b.polylines);

  // 한쪽의 고립해가 다른 쪽도 만족하면 그것도 연립해
  const tolScale = (view.xmax - view.xmin) * 1e-6;
  for (const p of a.points) if (Math.abs(G(p[0], p[1])) < 1e-8) raw.push(p);
  for (const p of b.points) if (Math.abs(F(p[0], p[1])) < 1e-8) raw.push(p);

  const refined = [];
  for (const p of raw) {
    const q = newton2D(F, G, p[0], p[1]) || p;
    if (!isFinite(q[0]) || !isFinite(q[1])) continue;
    if (refined.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < Math.max(tolScale, 1e-9))) continue;
    refined.push(q);
  }
  return { points: refined, curves: [a, b] };
}

/**
 * y=f(x) 와 y=g(x) 의 교점.
 */
export function intersectFunctions(f, g, xmin, xmax) {
  return findRoots((x) => f(x) - g(x), xmin, xmax, 4000).map((x) => [x, f(x)]);
}

/** f 의 극값(도함수의 근) — 도함수가 주어지면 정확히, 없으면 수치적으로 */
export function criticalPoints(f, df, xmin, xmax) {
  const d = df || ((x) => {
    const h = Math.max(1e-6, Math.abs(x) * 1e-6);
    return (f(x + h) - f(x - h)) / (2 * h);
  });
  return findRoots(d, xmin, xmax, 3000)
    .map((x) => [x, f(x)])
    .filter((p) => isFinite(p[1]));
}

/** 부등식 영역을 셀 단위로 판정해 채우기용 마스크를 만든다. */
export function regionMask(pred, view, cols = 240) {
  const rows = Math.max(1, Math.round(cols * (view.height || 600) / (view.width || 800)));
  const mask = new Uint8Array(cols * rows);
  const hx = (view.xmax - view.xmin) / cols;
  const hy = (view.ymax - view.ymin) / rows;
  for (let j = 0; j < rows; j++) {
    const y = view.ymin + (j + 0.5) * hy;
    for (let i = 0; i < cols; i++) {
      mask[j * cols + i] = pred(view.xmin + (i + 0.5) * hx, y) ? 1 : 0;
    }
  }
  return { mask, cols, rows, hx, hy };
}

/** 국소 최소·최대를 훑어 함수의 봉우리/골을 찾는다 (도함수 없이) */
export function scanExtrema(f, xmin, xmax, samples = 2000) {
  const out = [];
  const h = (xmax - xmin) / samples;
  let ym = f(xmin), y0 = f(xmin + h);
  for (let i = 2; i <= samples; i++) {
    const x = xmin + i * h;
    const y1 = f(x);
    if (isFinite(ym) && isFinite(y0) && isFinite(y1)) {
      if (y0 <= ym && y0 <= y1 && (y0 < ym || y0 < y1)) {
        const xs = goldenMin((t) => f(t), x - 2 * h, x);
        out.push({ x: xs, y: f(xs), kind: 'min' });
      } else if (y0 >= ym && y0 >= y1 && (y0 > ym || y0 > y1)) {
        const xs = goldenMin((t) => -f(t), x - 2 * h, x);
        out.push({ x: xs, y: f(xs), kind: 'max' });
      }
    }
    ym = y0; y0 = y1;
  }
  return out;
}

function goldenMin(g, a, b, iter = 120) {
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = g(c), fd = g(d);
  for (let i = 0; i < iter && b - a > 1e-14 * (1 + Math.abs(a)); i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = g(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = g(d); }
  }
  return 0.5 * (a + b);
}
