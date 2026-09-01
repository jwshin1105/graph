// 모델 적합(curve fitting) — 여러 함수족을 동시에 맞춰 보고 우열을 매긴다.
// 결정계수 R² 와 AIC(정보량 기준)를 함께 써서 "억지로 차수를 올린" 모델을 걸러낸다.

import { lstsq, pretty, trimNum, signed, sup } from '../math/numeric.js';

function stats(ys, pred, k) {
  const n = ys.length;
  const mean = ys.reduce((a, b) => a + b, 0) / n;
  let sse = 0, sst = 0;
  for (let i = 0; i < n; i++) {
    const d = ys[i] - pred[i];
    if (!isFinite(d)) return null;
    sse += d * d;
    sst += (ys[i] - mean) ** 2;
  }
  const r2 = sst > 0 ? 1 - sse / sst : sse < 1e-24 ? 1 : 0;
  const rmse = Math.sqrt(sse / n);
  const aic = n * Math.log(Math.max(sse, 1e-300) / n) + 2 * k + (2 * k * (k + 1)) / Math.max(1, n - k - 1);
  return { sse, r2, rmse, aic, k };
}

const term = (c, s, first) => {
  if (Math.abs(c) < 1e-14) return '';
  const sign = c < 0 ? (first ? '-' : ' - ') : first ? '' : ' + ';
  const mag = pretty(Math.abs(c));
  // 계수가 정수가 아니면 곱셈점을 넣어 1/2n² 같은 애매한 표기를 피한다
  const glue = /^\d+$/.test(mag) ? '' : '·';
  const body = s ? (mag === '1' ? s : `${mag}${glue}${s}`) : mag;
  return sign + body;
};

/** 다항식 계수 배열(오름차순)을 문자열로 */
export function polyString(coef, v = 'x') {
  let out = '';
  let first = true;
  for (let d = coef.length - 1; d >= 0; d--) {
    const c = coef[d];
    if (Math.abs(c) < 1e-12) continue;
    const sym = d === 0 ? '' : d === 1 ? v : `${v}${sup(d)}`;
    out += term(c, sym, first);
    first = false;
  }
  return out || '0';
}

/** 주어진 (x,y) 표본에 여러 모델을 맞추고 AIC 순으로 정렬해 돌려준다. */
export function fitModels(xs, ys, opts = {}) {
  const n = xs.length;
  const out = [];
  const maxDeg = Math.min(opts.maxDegree ?? 5, n - 2);
  const label = opts.variable || 'x';

  // 다항식 (1차 ~ maxDeg)
  for (let d = 1; d <= Math.max(1, maxDeg); d++) {
    const X = xs.map((x) => Array.from({ length: d + 1 }, (_, j) => Math.pow(x, j)));
    const b = lstsq(X, ys);
    if (!b || b.some((v) => !isFinite(v))) continue;
    const pred = xs.map((x) => b.reduce((s, c, j) => s + c * Math.pow(x, j), 0));
    const st = stats(ys, pred, d + 1);
    if (!st) continue;
    out.push({
      name: d === 1 ? '일차(선형)' : d === 2 ? '이차' : d === 3 ? '삼차' : `${d}차 다항식`,
      formula: `y = ${polyString(b, label)}`,
      params: b,
      predict: (x) => b.reduce((s, c, j) => s + c * Math.pow(x, j), 0),
      ...st,
    });
  }

  // 지수 y = a·e^{bx}
  if (ys.every((y) => y > 0)) {
    const X = xs.map((x) => [1, x]);
    const b = lstsq(X, ys.map(Math.log));
    if (b && b.every(isFinite)) {
      const a = Math.exp(b[0]);
      const predict = (x) => a * Math.exp(b[1] * x);
      const st = stats(ys, xs.map(predict), 2);
      if (st) out.push({
        name: '지수', formula: `y = ${pretty(a)}·${pretty(Math.exp(b[1]))}^${label}`,
        params: [a, b[1]], predict, ...st,
      });
    }
  }
  // 거듭제곱 y = a·x^b
  if (xs.every((x) => x > 0) && ys.every((y) => y > 0)) {
    const b = lstsq(xs.map((x) => [1, Math.log(x)]), ys.map(Math.log));
    if (b && b.every(isFinite)) {
      const a = Math.exp(b[0]);
      const predict = (x) => a * Math.pow(x, b[1]);
      const st = stats(ys, xs.map(predict), 2);
      if (st) out.push({ name: '거듭제곱', formula: `y = ${pretty(a)}·${label}^${pretty(b[1])}`,
        params: [a, b[1]], predict, ...st });
    }
  }
  // 로그 y = a·ln x + b
  if (xs.every((x) => x > 0)) {
    const b = lstsq(xs.map((x) => [1, Math.log(x)]), ys);
    if (b && b.every(isFinite)) {
      const predict = (x) => b[0] + b[1] * Math.log(x);
      const st = stats(ys, xs.map(predict), 2);
      if (st) out.push({ name: '로그', formula: `y = ${pretty(b[1])}·ln ${label}${signed(b[0])}`,
        params: b, predict, ...st });
    }
  }
  // 반비례 y = a/x + b
  if (xs.every((x) => Math.abs(x) > 1e-9)) {
    const b = lstsq(xs.map((x) => [1, 1 / x]), ys);
    if (b && b.every(isFinite)) {
      const predict = (x) => b[0] + b[1] / x;
      const st = stats(ys, xs.map(predict), 2);
      if (st) out.push({ name: '반비례', formula: `y = ${pretty(b[1])}/${label}${signed(b[0])}`,
        params: b, predict, ...st });
    }
  }
  // 삼각 y = A·sin(ωx) + B·cos(ωx) + C  — ω 를 훑어 최적값을 찾는다
  const sin = fitSinusoid(xs, ys, label);
  if (sin) out.push(sin);

  out.sort((a, b) => a.aic - b.aic);
  promoteSimplest(out);
  return out;
}

/**
 * AIC 차이가 2 이하면 통계적으로 가려낼 수 없는 정도다.
 * 그럴 때는 더 단순하고 흔한 꼴을 앞에 세운다.
 *
 * [2.1, 3.9, 6.2, 8.1, 9.8] 은 눈으로 봐도 직선인데, 거듭제곱 모형이 R² 를
 * 0.0002 만큼 더 잘 맞춘다는 이유로 "거듭제곱"이라고 답하고 있었다.
 * 잔차를 9% 줄인 것은 규칙을 바꿔 말할 근거가 못 된다.
 */
const SIMPLICITY = ['일차(선형)', '이차', '반비례', '지수', '로그', '거듭제곱', '삼차', '삼각(주기)'];
function promoteSimplest(out) {
  if (out.length < 2) return;
  const rank = (m) => {
    const i = SIMPLICITY.indexOf(m.name);
    return i >= 0 ? i : SIMPLICITY.length + (m.params || 0);
  };
  const best = out[0].aic;
  let pick = 0;
  for (let i = 1; i < out.length; i++) {
    if (out[i].aic > best + 2) continue;
    if (rank(out[i]) < rank(out[pick])) pick = i;
  }
  if (pick) out.unshift(...out.splice(pick, 1));
}

function fitSinusoid(xs, ys, label) {
  const n = xs.length;
  if (n < 5) return null;
  const span = Math.max(...xs) - Math.min(...xs);
  if (!(span > 0)) return null;

  // 표본 간격이 정하는 나이퀴스트 한계까지만 각진동수를 훑는다
  const spacing = span / (n - 1);
  const wMin = (2 * Math.PI) / (4 * span);
  const wMax = Math.PI / spacing;
  if (!(wMax > wMin)) return null;

  const evalAt = (omega) => {
    const X = xs.map((x) => [1, Math.sin(omega * x), Math.cos(omega * x)]);
    const b = lstsq(X, ys);
    if (!b || !b.every(isFinite)) return null;
    const predict = (x) => b[0] + b[1] * Math.sin(omega * x) + b[2] * Math.cos(omega * x);
    const st = stats(ys, xs.map(predict), 4);
    return st ? { omega, b, predict, st } : null;
  };

  const steps = 2000;
  let best = null;
  for (let i = 0; i <= steps; i++) {
    const r = evalAt(wMin + ((wMax - wMin) * i) / steps);
    if (r && (!best || r.st.sse < best.st.sse)) best = r;
  }
  if (!best) return null;
  // 국소 정련
  let lo = best.omega - (wMax - wMin) / steps;
  let hi = best.omega + (wMax - wMin) / steps;
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    const r1 = evalAt(m1), r2 = evalAt(m2);
    if (!r1 || !r2) break;
    if (r1.st.sse < r2.st.sse) { hi = m2; if (r1.st.sse < best.st.sse) best = r1; }
    else { lo = m1; if (r2.st.sse < best.st.sse) best = r2; }
  }

  const { omega, b, predict, st } = best;
  const A = Math.hypot(b[1], b[2]);
  const phase = Math.atan2(b[2], b[1]);
  return {
    name: '삼각(주기)',
    formula: `y = ${pretty(A)}·sin(${pretty(omega)}${label}${signed(phase)})${signed(b[0])}`,
    params: [A, omega, phase, b[0]],
    predict,
    period: (2 * Math.PI) / omega,
    ...st,
  };
}

/** 두 모델이 "실질적으로 같은 설명력"인지 (AIC 차이가 2 미만) */
export function comparable(a, b) {
  return Math.abs(a.aic - b.aic) < 2;
}
