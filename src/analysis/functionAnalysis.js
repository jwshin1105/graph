// 함수 f(x) 의 성질을 자동으로 읽어 내는 분석기.
// 근·극값·변곡점을 찾은 뒤, 그렇게 얻은 "점열"을 수열 분석기에 다시 넘겨
// 근이 등차수열을 이룬다는 식의 상위 규칙까지 찾아낸다.

import { findRoots, pretty, trimNum, coefTerm, signed } from '../math/numeric.js';
import { analyzeSequence } from './sequence.js';

const S = (x) => pretty(x);

export function analyzeFunction(f, opts = {}) {
  const xmin = opts.xmin ?? -10;
  const xmax = opts.xmax ?? 10;
  const df = opts.df || ((x) => central(f, x));
  const d2f = opts.d2f || ((x) => central2(f, x));
  const name = opts.name || 'f';
  const findings = [];
  const push = (f2) => findings.push({ confidence: 0.9, ...f2 });

  const N = 2000;
  const xs = [], ys = [];
  for (let i = 0; i <= N; i++) {
    const x = xmin + ((xmax - xmin) * i) / N;
    xs.push(x);
    ys.push(f(x));
  }
  const defined = ys.filter(isFinite);
  if (!defined.length) return { findings, summary: '이 구간에서 정의되지 않습니다.' };

  // 정의역 구멍
  const holes = [];
  const step = (xmax - xmin) / N;
  for (let i = 1; i <= N; i++) {
    if (isFinite(ys[i - 1]) !== isFinite(ys[i])) {
      const x = isFinite(ys[i]) ? xs[i - 1] : xs[i];
      if (!holes.length || Math.abs(holes[holes.length - 1] - x) > 2.5 * step) holes.push(x);
    }
  }
  if (holes.length) {
    push({ type: 'domain', title: '정의역이 끊깁니다', confidence: 1,
      detail: `대략 x ≈ ${holes.slice(0, 6).map((h) => trimNum(h, 3)).join(', ')} 부근에서 정의되지 않습니다.` });
  }

  // y 절편
  if (xmin <= 0 && xmax >= 0) {
    const y0 = f(0);
    if (isFinite(y0)) push({ type: 'yint', title: 'y절편', confidence: 1, detail: `(0, ${S(y0)})` });
  }

  // 근 (x 절편) → 점열로 다시 분석
  const roots = findRoots(f, xmin, xmax, 4000);
  if (roots.length) {
    push({ type: 'roots', title: `실근 ${roots.length}개`, confidence: 1,
      detail: roots.slice(0, 12).map((r) => S(r)).join(', ') + (roots.length > 12 ? ' …' : ''),
      points: roots.map((r) => [r, 0]) });
    if (roots.length >= 3) {
      const sub = analyzeSequence(roots, { name: 'x' });
      const top = sub.findings[0];
      if (top && top.confidence >= 0.95) {
        push({ type: 'root-pattern', title: `근이 이루는 규칙: ${top.title}`, confidence: 0.95,
          detail: top.detail, formula: top.formula ? top.formula.replace(/^x_n/, '근 x_n') : undefined });
      }
    }
  }

  // 극값
  const crit = findRoots(df, xmin, xmax, 3000);
  const maxima = [], minima = [];
  for (const c of crit) {
    const s = d2f(c);
    const y = f(c);
    if (!isFinite(y)) continue;
    if (s < -1e-9) maxima.push([c, y]);
    else if (s > 1e-9) minima.push([c, y]);
  }
  if (maxima.length) push({ type: 'max', title: `극대 ${maxima.length}곳`, confidence: 0.95,
    detail: maxima.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: maxima });
  if (minima.length) push({ type: 'min', title: `극소 ${minima.length}곳`, confidence: 0.95,
    detail: minima.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: minima });

  // 변곡점
  const inflex = findRoots(d2f, xmin, xmax, 2000)
    .map((x) => [x, f(x)])
    .filter(([, y]) => isFinite(y));
  if (inflex.length) push({ type: 'inflection', title: `변곡점 ${inflex.length}곳`, confidence: 0.85,
    detail: inflex.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: inflex });

  // 대칭성
  const parity = checkParity(f, xmin, xmax);
  if (parity) push(parity);

  // 주기성
  const per = checkPeriod(f, xmin, xmax);
  if (per) push(per);

  // 점근선
  for (const a of asymptotes(f, xmin, xmax, holes)) push(a);

  // 단조성
  const mono = monotonicity(xs, ys);
  if (mono) push(mono);

  findings.sort((a, b) => b.confidence - a.confidence);
  return {
    findings,
    summary: `${name}(x): ` + (findings.length
      ? findings.slice(0, 3).map((x) => x.title).join(' · ')
      : '특별한 성질을 찾지 못했습니다.'),
    roots, maxima, minima, inflex,
  };
}

function central(f, x, h) {
  const s = h || Math.max(1e-6, Math.abs(x) * 1e-6);
  return (f(x + s) - f(x - s)) / (2 * s);
}
function central2(f, x) {
  const s = Math.max(1e-4, Math.abs(x) * 1e-4);
  return (f(x + s) - 2 * f(x) + f(x - s)) / (s * s);
}

function checkParity(f, xmin, xmax) {
  const R = Math.min(Math.abs(xmin), Math.abs(xmax), 8);
  if (R < 1e-6) return null;
  let even = true, odd = true, count = 0;
  for (let i = 1; i <= 60; i++) {
    const x = (R * i) / 60;
    const a = f(x), b = f(-x);
    if (!isFinite(a) || !isFinite(b)) continue;
    count++;
    const sc = Math.max(1, Math.abs(a), Math.abs(b));
    if (Math.abs(a - b) > 1e-9 * sc) even = false;
    if (Math.abs(a + b) > 1e-9 * sc) odd = false;
  }
  if (count < 10) return null;
  if (even) return { type: 'parity', title: '우함수 (y축 대칭)', confidence: 1, detail: 'f(−x) = f(x) 가 성립합니다.' };
  if (odd) return { type: 'parity', title: '기함수 (원점 대칭)', confidence: 1, detail: 'f(−x) = −f(x) 가 성립합니다.' };
  return null;
}

function checkPeriod(f, xmin, xmax) {
  const span = xmax - xmin;
  const base = [];
  for (let i = 0; i <= 200; i++) {
    const x = xmin + (span * i) / 200;
    base.push([x, f(x)]);
  }
  const scale = Math.max(...base.map(([, y]) => (isFinite(y) ? Math.abs(y) : 0)), 1);
  const test = (T) => {
    let cnt = 0;
    for (const [x, y] of base) {
      if (x + T > xmax) break;
      const y2 = f(x + T);
      if (!isFinite(y) || !isFinite(y2)) continue;
      if (Math.abs(y - y2) > 1e-8 * scale) return false;
      cnt++;
    }
    return cnt >= 30;
  };
  // 후보 주기: π 의 유리수배와 정수배를 훑는다
  const cands = [];
  for (let k = 1; k <= 12; k++) {
    for (const b of [Math.PI, 1, 2 * Math.PI]) {
      cands.push((b * k) / 1, b / k);
    }
  }
  cands.sort((a, b) => a - b);
  for (const T of cands) {
    if (T < span / 100 || T > span / 2) continue;
    if (test(T)) {
      return { type: 'period', title: `주기함수 (주기 ${S(T)})`, confidence: 1,
        detail: `f(x + ${S(T)}) = f(x) 가 성립합니다.` };
    }
  }
  return null;
}

function asymptotes(f, xmin, xmax, holes) {
  const out = [];
  // 수직 점근선 = 1/f 의 영점. tan x 처럼 표본이 극점을 정확히 비껴가도 놓치지 않는다.
  const poles = findRoots((x) => 1 / f(x), xmin, xmax, 4000)
    .filter((x) => {
      const e = Math.max(1e-9, Math.abs(x) * 1e-9);
      const l = f(x - e), r = f(x + e);
      return (isFinite(l) && Math.abs(l) > 1e6) || (isFinite(r) && Math.abs(r) > 1e6)
        || !isFinite(l) || !isFinite(r);
    });
  for (const h of holes) {
    const e = 1e-7;
    const l = f(h - e), r = f(h + e);
    const big = (isFinite(l) && Math.abs(l) > 1e5) || (isFinite(r) && Math.abs(r) > 1e5);
    if (big && !poles.some((p) => Math.abs(p - h) < (xmax - xmin) / 500)) poles.push(h);
  }
  poles.sort((a, b) => a - b);
  if (poles.length) {
    out.push({ type: 'vasym', title: `수직 점근선 ${poles.length}개`, confidence: 0.9,
      detail: poles.slice(0, 8).map((x) => `x = ${S(x)}`).join(', ') + (poles.length > 8 ? ' …' : ''),
      values: poles });
  }

  // 수평·사선 점근선: |x| 를 단계적으로 키우며 극한을 살핀다
  for (const dir of [1, -1]) {
    const scales = [1e5, 1e7, 1e9, 1e11, 1e13];
    let x1 = null, y1 = null;
    for (const sc of scales) {
      const y = f(sc * dir);
      if (isFinite(y)) { x1 = sc * dir; y1 = y; } else break;
    }
    if (x1 === null) continue;
    const x2 = x1 / 2, y2 = f(x2);
    const x3 = x1 / 4, y3 = f(x3);
    if (![y2, y3].every(isFinite)) continue;
    const m = (y1 - y2) / (x1 - x2);
    const at = dir > 0 ? '+∞' : '−∞';
    if (Math.abs(m) < 1e-9) {
      // 진동하는 함수(sin x 등)가 우연히 같은 값에 걸리는 것을 막기 위해
      // 여러 배율에서 값이 모두 같은 극한으로 모이는지 확인한다
      const tol = 1e-6 * Math.max(1, Math.abs(y1));
      const converges = [2, 4, 8, 16, 32, 128].every((k) => {
        const y = f(x1 / k);
        return isFinite(y) && Math.abs(y - y1) < tol;
      });
      if (converges) {
        out.push({ type: 'hasym', title: `수평 점근선 (x → ${at})`, confidence: 0.85,
          detail: `y = ${S(round(y1))}`, value: y1 });
      }
      continue;
    }
    const b = y1 - m * x1;
    if (Math.abs(y3 - (m * x3 + b)) < 1e-4 * Math.max(1, Math.abs(y3))) {
      const bb = round(b);
      out.push({ type: 'oasym', title: `사선 점근선 (x → ${at})`, confidence: 0.8,
        detail: `y = ${coefTerm(round(m), 'x')}${Math.abs(bb) < 1e-12 ? '' : signed(bb)}`,
        slope: m, intercept: b });
    }
  }
  return out;
}
const round = (x) => (Math.abs(x - Math.round(x)) < 1e-4 ? Math.round(x) : x);

function monotonicity(xs, ys) {
  let inc = true, dec = true, seen = 0;
  for (let i = 1; i < ys.length; i++) {
    if (!isFinite(ys[i - 1]) || !isFinite(ys[i])) continue;
    seen++;
    if (ys[i] < ys[i - 1] - 1e-12) inc = false;
    if (ys[i] > ys[i - 1] + 1e-12) dec = false;
  }
  if (seen < 50) return null;
  if (inc) return { type: 'mono', title: '구간 전체에서 증가', confidence: 0.9, detail: '단조증가 함수입니다.' };
  if (dec) return { type: 'mono', title: '구간 전체에서 감소', confidence: 0.9, detail: '단조감소 함수입니다.' };
  return null;
}
