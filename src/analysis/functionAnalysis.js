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

  // ── 퇴화 판정: 상수인가, 직선인가 ────────────────────────
  // 이걸 먼저 걸러내지 않으면 f′ ≡ 0, f″ ≡ 0 위에서 근을 찾다가
  // "변곡점 2000곳" 같은 헛된 결과가 쏟아진다.
  const fScale = Math.max(...defined.map(Math.abs), 1e-300);
  const yLo = Math.min(...defined), yHi = Math.max(...defined);
  const isConstant = yHi - yHi === 0 && yHi - yLo <= 1e-12 * Math.max(1, fScale);
  const isLinear = !isConstant && linearFit(xs, ys, fScale);

  if (isConstant) {
    const c = defined[0];
    push({ type: 'constant', title: '상수함수', confidence: 1,
      detail: `이 구간에서 값이 늘 ${S(c)} 입니다. 도함수는 0 이고 극값도 변곡점도 없습니다.` });
    if (Math.abs(c) < 1e-12) {
      push({ type: 'allroots', title: '모든 점이 해', confidence: 1,
        detail: 'f(x) = 0 이 항상 성립하므로 해가 특정한 점들이 아니라 구간 전체입니다.' });
    }
    return { findings, summary: `f(x) = ${S(c)} (상수함수)`, roots: [], maxima: [], minima: [], inflex: [] };
  }

  // ── 정의역 ──────────────────────────────────────────────
  // √x 의 x < 0 은 "구멍"이 아니라 정의역 밖이다. 표본 하나 폭의 빈틈(1/x 의 x = 0)만
  // 구멍이라 부르고, 넓게 이어진 빈틈은 정의역의 경계로 보고 **경계값을 이분법으로 좁힌다**.
  const step = (xmax - xmin) / N;
  const dom = domainOf(f, xs, ys, step);
  const holes = dom.holes;
  if (dom.holes.length) {
    push({ type: 'domain', title: '정의역에 구멍', confidence: 1,
      detail: `x = ${dom.holes.slice(0, 6).map((h) => S(h)).join(', ')} 에서 정의되지 않습니다.` });
  }
  if (dom.intervals.length && !(dom.intervals.length === 1 && dom.full)) {
    // 화면 끝에 닿은 쪽은 경계가 아니라 "여기까지밖에 못 봤다" 는 뜻이므로 적지 않는다
    const txt = dom.intervals.slice(0, 4).map(([a, b]) => {
      const openL = a <= xmin + step * 0.5;
      const openR = b >= xmax - step * 0.5;
      if (openL && openR) return '전 구간';
      if (openL) return `x ≤ ${S(b)}`;
      if (openR) return `x ≥ ${S(a)}`;
      return `${S(a)} ≤ x ≤ ${S(b)}`;
    }).join(', 또는 ');
    push({ type: 'domain-range', title: '정의역', confidence: 1,
      detail: dom.intervals.length
        ? `보이는 범위에서 ${txt} 에서만 정의됩니다.`
        : '보이는 범위에서 정의되는 곳이 없습니다.' });
  }

  // y 절편
  if (xmin <= 0 && xmax >= 0) {
    const y0 = f(0);
    if (isFinite(y0)) push({ type: 'yint', title: 'y절편', confidence: 1, detail: `(0, ${S(y0)})` });
  }

  // 근 (x 절편) → 점열로 다시 분석
  const ROOT_SAMPLES = 4000;
  const roots = findRoots(f, xmin, xmax, ROOT_SAMPLES);
  // 근끼리 표본 간격만큼 다닥다닥 붙어 있으면 "점"이 아니라 "구간"이 해다
  const sampleStep = (xmax - xmin) / ROOT_SAMPLES;
  let adjacent = 0;
  for (let i = 1; i < roots.length; i++) if (roots[i] - roots[i - 1] < 3 * sampleStep) adjacent++;
  if (roots.length > 20 && adjacent > roots.length * 0.3) {
    // 해가 점이 아니라 구간을 이루는 경우 (예: floor x 는 [0,1) 전체가 해)
    push({ type: 'rootband', title: '해가 구간을 이룹니다', confidence: 0.9,
      detail: `f 가 0 인 곳이 낱개의 점이 아니라 구간입니다 (표본에서만 ${roots.length}개). `
        + '점열로 보기 어려우니 확대해서 확인해 주세요.' });
  } else if (roots.length) {
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

  // 극값 — 도함수의 "부호가 바뀌는" 영점만 본다 (접하는 영점은 안장점이라 극값이 아니다)
  // 도함수의 영점만 보면 **미분할 수 없는 극값**을 놓친다.
  // |sin x| 의 x = π 에서 도함수는 −1 에서 +1 로 뛰기만 할 뿐 0 을 지나지 않는다.
  // 그래서 표본 배열에서 봉우리·골을 직접 집어 후보에 더한다.
  const crit = mergeCandidates(
    findRoots(df, xmin, xmax, 3000, 1e-9, { tangential: false }),
    sampleExtrema(f, xs, ys),
    (xmax - xmin) / 1000,
  );
  const maxima = [], minima = [];
  // 이계도함수의 부호로 가르면 두 가지를 놓친다.
  //   · y = −|x| 의 꼭짓점 — 기호 미분이 f″ ≡ 0 을 주어 극대가 통째로 사라졌다
  //   · y = floor x 의 뜀 — 도함수가 튀어 없는 극값이 생겼다
  // 그래서 **양옆의 값**으로 직접 가른다. 간격은 이웃한 임계점까지의 거리에 맞춘다.
  for (let i = 0; i < crit.length; i++) {
    const c = crit[i];
    const y = f(c);
    if (!isFinite(y)) continue;
    const gapL = i > 0 ? c - crit[i - 1] : Infinity;
    const gapR = i < crit.length - 1 ? crit[i + 1] - c : Infinity;
    const h = Math.min((xmax - xmin) / 500, gapL / 3, gapR / 3);
    const isMax = smoothExtremum(f, c, h, -1);
    const isMin = smoothExtremum(f, c, h, 1);
    if (isMax && !isMin) maxima.push([c, y]);
    else if (isMin && !isMax) minima.push([c, y]);
  }
  if (maxima.length) push({ type: 'max', title: `극대 ${maxima.length}곳`, confidence: 0.95,
    detail: maxima.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: maxima });
  if (minima.length) push({ type: 'min', title: `극소 ${minima.length}곳`, confidence: 0.95,
    detail: minima.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: minima });

  // 변곡점 — 이차 도함수의 부호가 실제로 바뀌는 곳만.
  // 직선은 f″ ≡ 0 이므로 아예 건너뛴다.
  const inflex = isLinear ? [] : findRoots(d2f, xmin, xmax, 2000, 1e-9, { tangential: false })
    // 수치 이차미분은 잡음이 커서 직선 구간에서도 부호가 흔들린다.
    // "곡선이 자기 접선을 실제로 가로지르는가"로 다시 확인한다.
    .filter((x) => crossesTangent(f, df, x, (xmax - xmin) / 200, fScale))
    .map((x) => [x, f(x)])
    .filter(([, y]) => isFinite(y));
  if (isLinear) {
    push({ type: 'linear', title: '일차함수 (직선)', confidence: 1,
      detail: '기울기가 일정하므로 극값도 변곡점도 없습니다.' });
  }
  if (inflex.length) push({ type: 'inflection', title: `변곡점 ${inflex.length}곳`, confidence: 0.85,
    detail: inflex.slice(0, 8).map(([x, y]) => `(${S(x)}, ${S(y)})`).join(', '), points: inflex });

  // 대칭성
  const parity = checkParity(f, xmin, xmax);
  if (parity) push(parity);

  // 주기성 — 상수·직선은 의미가 없다
  const per = isLinear ? null : checkPeriod(f, xmin, xmax);
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

/**
 * 표본 배열에서 봉우리·골이 되는 자리를 집어 황금분할로 다듬는다.
 * 도함수가 0 을 지나지 않고 뛰기만 하는 꼭짓점(|x|, |sin x| 의 x = π)을 잡기 위한 것이다.
 */
function sampleExtrema(f, xs, ys, limit = 500) {
  const out = [];
  for (let i = 1; i < xs.length - 1 && out.length < limit; i++) {
    const a = ys[i - 1], b = ys[i], c = ys[i + 1];
    if (!isFinite(a) || !isFinite(b) || !isFinite(c)) continue;
    const low = b <= a && b <= c && (b < a || b < c);
    const high = b >= a && b >= c && (b > a || b > c);
    if (low || high) out.push(goldenSearch(f, xs[i - 1], xs[i + 1], low));
  }
  return out;
}

/** [lo, hi] 안에서 최소(또는 최대)가 되는 자리 */
function goldenSearch(f, lo, hi, wantMin) {
  const better = (u, v) => (wantMin ? u < v : u > v);
  const R = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - R * (b - a), d = a + R * (b - a);
  let fc = f(c), fd = f(d);
  for (let i = 0; i < 60 && b - a > Math.abs(b) * 1e-15 + 1e-15; i++) {
    if (better(fc, fd)) { b = d; d = c; fd = fc; c = b - R * (b - a); fc = f(c); }
    else { a = c; c = d; fc = fd; d = a + R * (b - a); fd = f(d); }
  }
  return (a + b) / 2;
}

/** 두 후보 목록을 합치되 tol 안에 있는 것은 하나로 */
function mergeCandidates(a, b, tol) {
  const all = [...a, ...b].filter(isFinite).sort((p, q) => p - q);
  const out = [];
  for (const x of all) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
}

/**
 * 보이는 범위에서 함수가 정의되는 곳.
 * 표본 한두 칸짜리 빈틈은 **구멍**(1/x 의 x = 0), 그보다 넓으면 **정의역의 경계**로 보고
 * 경계 위치는 이분법으로 좁힌다 (√x → x = 0 을 소수점 아래까지 정확히).
 */
function domainOf(f, xs, ys, step) {
  const N = xs.length - 1;
  const ok = ys.map(isFinite);
  const runs = [];
  for (let i = 0; i <= N; i++) {
    if (!ok[i]) continue;
    if (runs.length && runs[runs.length - 1][1] === i - 1) runs[runs.length - 1][1] = i;
    else runs.push([i, i]);
  }
  if (!runs.length) return { holes: [], intervals: [], full: false };

  // 경계를 이분법으로 좁힌다 — 정의된 쪽에서 정의되지 않은 쪽으로
  const edge = (iIn, iOut) => {
    let a = xs[iIn], b = xs[iOut];
    for (let k = 0; k < 60; k++) {
      const m = (a + b) / 2;
      if (isFinite(f(m))) a = m; else b = m;
    }
    return a;
  };

  const holes = [];
  const intervals = [];
  for (let r = 0; r < runs.length; r++) {
    const [i0, i1] = runs[r];
    const lo = i0 === 0 ? xs[0] : edge(i0, i0 - 1);
    const hi = i1 === N ? xs[N] : edge(i1, i1 + 1);
    intervals.push([lo, hi]);
    // 다음 구간과의 빈틈이 표본 두 칸 이하면 "구멍"
    if (r + 1 < runs.length && xs[runs[r + 1][0]] - xs[i1] <= 3 * step) {
      holes.push((hi + edge(runs[r + 1][0], runs[r + 1][0] - 1)) / 2);
    }
  }
  // 구멍만 있는 경우(1/x)는 정의역을 따로 적지 않는다
  const merged = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv[0] - prev[1] <= 3 * step) prev[1] = iv[1];
    else merged.push(iv.slice());
  }
  const full = merged.length === 1
    && merged[0][0] <= xs[0] + step * 0.5 && merged[0][1] >= xs[N] - step * 0.5;
  return { holes, intervals: merged, full };
}

/**
 * c 가 정말 매끄러운 극값인지.
 * 계단함수의 뜀은 양옆 값만 보면 극값처럼 보이지만, 간격을 4배 좁혀도 낙차가 줄지 않는다.
 * 매끄러운 극값이라면 낙차가 h² 에 비례해 확 줄고, 뾰족점(−|x|)도 h 에 비례해 줄어든다.
 * @param {number} sign  −1 이면 극대, +1 이면 극소
 */
function smoothExtremum(f, c, h, sign) {
  const m = f(c);
  if (!isFinite(m)) return false;
  const drop = (t) => {
    const a = f(c - t), b = f(c + t);
    if (!isFinite(a) || !isFinite(b)) return null;
    return [sign * (a - m), sign * (b - m)];
  };
  const big = drop(h);
  const small = drop(h / 4);
  if (!big || !small) return false;
  // 봐 주는 폭은 반올림 잡음의 크기, 곧 값의 ulp 몇 배까지다.
  // 더 크게 잡으면 y = 10¹⁰ − x² 처럼 값에 비해 낙차가 티끌인 극값을 놓친다.
  const eps = Math.abs(m) * Number.EPSILON * 4 + Number.MIN_VALUE;
  if (big[0] < -eps || big[1] < -eps) return false;      // 더 나은 값이 옆에 있으면 극값이 아니다
  // **양쪽 모두** 엄격히 낮아야(높아야) 극값이다.
  // floor x 는 도함수가 계단마다 0 이라 표본마다 임계점이 잡히는데,
  // 그중 어느 것도 봉우리가 아니다 — 계단의 오른쪽은 값이 같고 왼쪽만 한 칸 낮을 뿐이다.
  if (Math.min(big[0], big[1]) <= eps) return false;
  const shrinks = (a, b) => a <= eps || b / a < 0.4;
  return shrinks(big[0], small[0]) && shrinks(big[1], small[1]);
}

/**
 * x 에서 곡선이 접선을 가로지르는지 — 변곡점의 기하학적 정의.
 * 양옆에서 (곡선 − 접선) 의 부호가 반대이고, 그 크기가 잡음보다 확실히 커야 한다.
 */
function crossesTangent(f, df, x, delta, fScale) {
  const y = f(x);
  const m = df(x);
  if (!isFinite(y) || !isFinite(m)) return false;
  const eps = 1e-9 * Math.max(1, fScale);
  for (let k = 1; k <= 3; k++) {
    const d = delta / Math.pow(2, k - 1);
    const l = f(x - d) - (y - m * d);
    const r = f(x + d) - (y + m * d);
    if (!isFinite(l) || !isFinite(r)) continue;
    if (Math.abs(l) > eps && Math.abs(r) > eps && l * r < 0) return true;
  }
  return false;
}

/** 표본이 한 직선 위에 놓이는가 (양 끝을 잇는 직선과의 최대 편차로 판정) */
function linearFit(xs, ys, fScale) {
  const pts = xs.map((x, i) => [x, ys[i]]).filter(([, y]) => isFinite(y));
  if (pts.length < 10) return false;
  const [x0, y0] = pts[0];
  const [x1, y1] = pts[pts.length - 1];
  if (Math.abs(x1 - x0) < 1e-300) return false;
  const m = (y1 - y0) / (x1 - x0);
  let dev = 0;
  for (const [x, y] of pts) dev = Math.max(dev, Math.abs(y - (y0 + m * (x - x0))));
  return dev <= 1e-9 * Math.max(1, fScale);
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
    // 사선 점근선은 나머지 f(x) − (mx+b) 가 **0 으로 줄어들어야** 한다.
    // 상대오차로만 재면 floor x 도 y = x 를 점근선으로 갖게 된다 (나머지가 (−1, 0] 을 맴돌 뿐인데도).
    // 정수 자리만 짚으면 floor 가 딱 맞아떨어지므로 반 칸 어긋난 자리에서 잰다.
    const resid = [1e3, 1e5, 1e7, 1e9].map((sc) => {
      const x = dir * (sc + 0.5);
      const y = f(x);
      return isFinite(y) ? Math.abs(y - (m * x + b)) : NaN;
    });
    const shrinking = resid.every((r) => !Number.isNaN(r))
      && resid[3] <= Math.max(1e-6, resid[0] * 0.2);
    if (shrinking) {
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
  let inc = true, dec = true, seen = 0, moved = false;
  for (let i = 1; i < ys.length; i++) {
    if (!isFinite(ys[i - 1]) || !isFinite(ys[i])) continue;
    seen++;
    if (ys[i] < ys[i - 1] - 1e-12) { inc = false; moved = true; }
    if (ys[i] > ys[i - 1] + 1e-12) { dec = false; moved = true; }
  }
  if (seen < 50 || !moved) return null;    // 값이 전혀 안 변하면 증감을 말할 수 없다
  if (inc) return { type: 'mono', title: '구간 전체에서 증가', confidence: 0.9, detail: '단조증가 함수입니다.' };
  if (dec) return { type: 'mono', title: '구간 전체에서 감소', confidence: 0.9, detail: '단조감소 함수입니다.' };
  return null;
}
