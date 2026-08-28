// 파라미터 훑기 — 슬라이더를 움직이며 해집합의 "생김새"가 바뀌는 지점을 찾는다.
//
// 아이디어: 파라미터 t 마다 해집합에서 **이산적인 특징**만 뽑아 서명(signature)을 만든다.
// 곡선 가지 수, 고립해 개수, 이차곡선의 종류, 실근·극값 개수처럼 연속적으로 변하지 않고
// 어느 순간 툭 바뀌는 값들이다. 서명이 달라지는 두 표본 사이를 이분법으로 좁히면
// 타원 → 포물선 → 쌍곡선 같은 분기점의 위치를 소수점 아래까지 짚어낼 수 있다.

import { pretty, trimNum } from '../math/numeric.js';
import { fitConic } from './conic.js';

// 훑기는 화면에 그릴 때와 **같은 해상도**로 계산한다.
// 성기게 훑으면 두 배쯤 빨라지지만, 원·두 평행선처럼 허용오차로 갈리는 분류의
// 경계가 화면에서 보이는 것과 어긋난다. 훑기가 알려 주는 분류는 눈으로 보는 것과
// 같아야 하므로 속도보다 일치를 택했다.
export const SWEEP_OPTS = {};


/**
 * 객체 하나의 이산 특징.
 * @returns {{key:string, label:string}|null}
 */
export function objectSignature(obj, bounds, compute, opts = SWEEP_OPTS) {
  let d;
  try {
    d = compute(obj, bounds, opts);
  } catch {
    return null;
  }
  if (!d) return null;

  switch (obj.kind) {
    case 'implicit': {
      const branches = (d.polylines || []).length;
      const pts = (d.points || []).length;
      const kind = conicKind(d);
      const parts = [];
      if (kind) parts.push(kind);
      if (branches) parts.push(`가지 ${branches}개`);
      if (pts) parts.push(`고립해 ${pts}개`);
      if (!parts.length) parts.push('해 없음');
      return { key: `i|${kind || ''}|${branches}|${pts}`, label: parts.join(' · ') };
    }
    case 'function':
    case 'functionY': {
      const v = obj.substitute || (obj.kind === 'functionY' ? 'y' : 'x');
      const lo = obj.kind === 'functionY' ? bounds.ymin : bounds.xmin;
      const hi = obj.kind === 'functionY' ? bounds.ymax : bounds.xmax;
      const f = (x) => obj.fn({ [v]: x });
      const c = countFeatures(f, lo, hi);
      if (!c) return null;
      return {
        key: `f|${c.roots}|${c.extrema}`,
        label: `실근 ${c.roots}개 · 극값 ${c.extrema}개`,
      };
    }
    case 'equation1d': {
      const n = (d.points || []).length;
      return { key: `e|${n}`, label: `해 ${n}개` };
    }
    case 'system': {
      const n = (d.points || []).length;
      return { key: `s|${n}`, label: `연립해 ${n}개` };
    }
    case 'points':
    case 'pointseq':
    case 'point': {
      const n = (d.points || []).length;
      return { key: `p|${n}`, label: `점 ${n}개` };
    }
    case 'region': {
      if (!d.mask) return null;
      const { mask, cols, rows } = d.mask;
      let inside = 0;
      for (let i = 0; i < mask.length; i++) inside += mask[i];
      let edge = false;
      for (let i = 0; i < cols; i++) if (mask[i] || mask[(rows - 1) * cols + i]) edge = true;
      for (let j = 0; j < rows; j++) if (mask[j * cols] || mask[j * cols + cols - 1]) edge = true;
      const state = inside === 0 ? '해 없음' : edge ? '열린 영역' : '유계 영역';
      return { key: `r|${state}`, label: state };
    }
    default:
      return null;
  }
}

/** 추적된 곡선이 이차곡선이면 그 종류 */
function conicKind(d) {
  const lines = d.polylines || [];
  if (!lines.length) return null;
  const sample = [];
  for (const line of lines) {
    const stride = Math.max(2, Math.floor(line.length / 30) * 2);
    for (let i = 0; i < line.length; i += stride) sample.push([line[i], line[i + 1]]);
  }
  if (sample.length < 6) return null;
  const c = fitConic(sample.slice(0, 120));
  return c && c.residual < 1e-3 ? c.kind : null;
}

/**
 * 실근·극값의 개수만 빠르게 센다 (부호 변화 기준).
 * 표본을 반 칸 어긋나게 잡는다 — 격자가 x = 0 을 정확히 밟으면 f = 0 이 되어
 * 부호 변화가 사라지고 근을 통째로 놓친다.
 */
function countFeatures(f, lo, hi, samples = 700) {
  const h = (hi - lo) / samples;
  let roots = 0, extrema = 0;
  let finite = 0;
  let lastSign = 0;      // 부호가 정해진 마지막 값의 부호
  let lastSlope = 0;     // 0 이 아닌 마지막 기울기
  let prev = NaN;

  for (let i = 0; i < samples; i++) {
    const x = lo + (i + 0.5) * h;   // 반 칸 어긋난 격자 — x = 0 을 정확히 밟아 근을 놓치는 일을 막는다
    const v = f(x);
    if (!isFinite(v)) { prev = NaN; lastSign = 0; lastSlope = 0; continue; }
    finite++;

    // 극점을 사이에 두고 뒤집힌 부호는 근이 아니다
    const jump = isFinite(prev) && Math.abs(v - prev) > 1e3
      && Math.max(Math.abs(v), Math.abs(prev)) > 1e3;

    const sign = v > 0 ? 1 : v < 0 ? -1 : 0;
    if (sign !== 0) {
      if (lastSign !== 0 && sign !== lastSign && !jump) roots++;
      lastSign = sign;
    }

    if (isFinite(prev) && !jump) {
      const slope = v - prev;
      // 기울기가 정확히 0 인 표본(대칭점 등)에서 부호 변화가 묻히지 않도록
      // 0 이 아닌 마지막 기울기와 비교한다
      if (slope !== 0) {
        if (lastSlope !== 0 && lastSlope * slope < 0) extrema++;
        lastSlope = slope;
      }
    }
    prev = v;
  }
  return finite > samples * 0.1 ? { roots, extrema } : null;
}

/** 여러 객체의 서명을 하나로 묶는다 */
export function combinedSignature(objects, bounds, compute, opts = SWEEP_OPTS) {
  const parts = [];
  const labels = [];
  for (const o of objects) {
    const s = objectSignature(o, bounds, compute, opts);
    if (!s) continue;
    parts.push(`${o.id}:${s.key}`);
    labels.push(objects.length > 1 ? `${shortLabel(o)} → ${s.label}` : s.label);
  }
  if (!parts.length) return null;
  return { key: parts.join('#'), label: labels.join('  |  ') };
}

function shortLabel(o) {
  const t = (o.label || o.source || '').replace(/\s+/g, ' ');
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
}

/**
 * 파라미터를 훑으며 분류가 바뀌는 지점을 찾는다.
 *
 * @param {object} cfg
 * @param {object[]} cfg.objects   이 파라미터에 영향을 받는 객체들
 * @param {(t:number)=>void} cfg.setParam  파라미터 값을 바꾸는 함수
 * @param {number} cfg.min
 * @param {number} cfg.max
 * @param {object} cfg.bounds
 * @param {Function} cfg.compute   (obj, bounds, opts) => 계산 결과
 * @param {number} [cfg.samples]
 * @returns {{stages:Array, transitions:Array, samples:Array}}
 */
export function* sweepSteps(cfg) {
  const { objects, setParam, min, max, bounds, compute, budgetMs = 6000 } = cfg;
  const span = max - min;
  if (!(span > 0) || !objects.length) return { stages: [], transitions: [], events: [], samples: [] };

  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  let done = 0;
  const sigAt = (t) => {
    setParam(t);
    done++;
    return combinedSignature(objects, bounds, compute);
  };

  // 표본 수는 고정한다. 시간에 맞춰 줄이면 실행할 때마다 결과가 달라지고,
  // 특히 "정확히 원이 되는 a = 1" 처럼 얇은 띠를 통째로 건너뛰게 된다.
  const samples = cfg.samples ?? 41;
  // 이분법은 14번이면 훑는 범위의 1/16000 까지 좁힌다. 어차피 마지막에
  // 깔끔한 수로 맞추므로(범위의 0.1%) 그보다 더 좁힐 실익이 없다.
  const bisect = cfg.bisect ?? 14;
  const probeSig = sigAt(min);
  const total = samples + bisect * 2 + 20;

  // 1) 성기게 훑는다
  const pts = [{ t: min, sig: probeSig }];
  for (let i = 1; i < samples; i++) {
    const t = min + (span * i) / (samples - 1);
    pts.push({ t, sig: sigAt(t) });
    yield Math.min(0.9, done / total);
  }

  // 2) 서명이 달라지는 구간마다 이분법으로 경계를 좁힌다
  const raw = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a.sig || !b.sig || a.sig.key === b.sig.key) continue;
    let lo = a.t, hi = b.t;
    let loSig = a.sig, hiSig = b.sig;
    const stop = overBudget();
    for (let k = 0; k < (stop ? 5 : bisect) && hi - lo > span * 1e-7; k++) {
      const mid = (lo + hi) / 2;
      const sg = sigAt(mid);
      if (!sg) break;
      if (sg.key === loSig.key) { lo = mid; loSig = sg; }
      else { hi = mid; hiSig = sg; }
      if (k % 5 === 4) yield Math.min(0.95, done / total);
    }
    // 경계 위에서만 나타나는 분류(정확히 포물선이 되는 순간 등)를 확인한다.
    // 이분법이 멈춘 자리가 아니라 "깔끔한 수로 맞춘 자리"에서 재야 한다 —
    // a = 1e-7 은 아주 작은 원이지만 a = 0 은 점 하나이기 때문이다.
    const snapped = snapNiceInfo(lo, hi, span);
    const at = snapped.v;
    const onEdge = sigAt(at);
    const isolated = onEdge && onEdge.key !== loSig.key && onEdge.key !== hiSig.key ? onEdge : null;
    raw.push({ at, before: loSig, after: hiSig, isolated, snapped: snapped.snapped });
  }

  // 3) 구간별로 묶는다
  let stages = [];
  let start = min;
  let sig = pts[0].sig;
  for (const tr of raw) {
    stages.push({ from: start, to: tr.at, sig: tr.before || sig });
    start = tr.at;
    sig = tr.after;
  }
  stages.push({ from: start, to: max, sig });

  // 4) 아주 좁은 구간은 "그 순간에만 나타나는 모습"으로 접는다.
  //    타원이 원이 되는 a = 1, 쌍곡선이 두 직선으로 무너지는 a = 0 처럼
  //    수학적으로는 한 점인데 수치 허용오차 때문에 폭이 생긴 구간이다.
  const narrow = span * 0.02;
  const events = [];
  const kept = [];
  for (const st of stages) {
    const prev = kept[kept.length - 1];
    if (st.to - st.from < narrow && prev && st.sig && prev.sig && st.sig.key !== prev.sig.key) {
      const snap = snapNiceInfo(st.from, st.to, span);
      events.push({ at: snap.v, snapped: snap.snapped, sig: st.sig, band: [st.from, st.to] });
      prev.to = st.to;
      continue;
    }
    kept.push({ ...st });
  }
  // 같은 분류가 이어지면 하나로 합친다 (사이에 끼어 있던 "순간"은 위에서 따로 뽑았다)
  stages = [];
  for (const st of kept) {
    const prev = stages[stages.length - 1];
    if (prev && prev.sig && st.sig && prev.sig.key === st.sig.key) prev.to = st.to;
    else stages.push(st);
  }

  // 4.5) 구간의 대표 분류는 안쪽 여러 곳에서 재어 가장 많이 나온 것으로 정한다.
  //      경계 바로 옆은 두 모습이 섞이는 자리고, 한가운데는 하필 특이값일 수 있다
  //      (x² + a y² = 1 을 [0, 2] 에서 보면 가운데가 정확히 원이 되는 a = 1 이다).
  for (const st of stages) {
    const tally = new Map();
    const probes = overBudget() ? [0.5] : [0.25, 0.5, 0.75];
    for (const f of probes) {
      const sg = sigAt(st.from + (st.to - st.from) * f);
      if (!sg) continue;
      const e = tally.get(sg.key) || { n: 0, sig: sg };
      e.n++;
      tally.set(sg.key, e);
    }
    let best = null;
    for (const e of tally.values()) if (!best || e.n > best.n) best = e;
    if (best) st.sig = best.sig;
    yield Math.min(0.98, done / total);
  }

  // 5) 남은 경계를 분기점으로 정리한다
  const transitions = [];
  for (let i = 1; i < stages.length; i++) {
    const a = stages[i - 1];
    const b = stages[i];
    if (!a.sig || !b.sig || a.sig.key === b.sig.key) continue;
    const ev = events.find((e) => Math.abs(e.at - b.from) <= narrow);
    const near = raw.find((t) => Math.abs(t.at - b.from) < span * 1e-6);
    const snap = ev ? { v: ev.at, snapped: ev.snapped }
      : (near ? { v: near.at, snapped: near.snapped } : snapNiceInfo(b.from, b.from, span));
    transitions.push({
      at: snap.v, before: a.sig, after: b.sig,
      isolated: ev ? ev.sig : (near ? near.isolated : null),
      raw: b.from,
      atText: pretty(snap.v),
      // 깔끔한 수로 맞추지 못했으면 이분법이 짚은 자리 그대로라 오차가 남아 있다
      approx: !snap.snapped,
    });
  }
  // 앞뒤 분류가 같아 분기점으로는 잡히지 않지만, 그 순간에만 나타나는 모습도 알린다
  const soloEvents = events.filter((e) => !transitions.some((t) => Math.abs(t.at - e.at) <= narrow));
  for (const e of soloEvents) e.atText = pretty(e.at);

  for (const st of stages) {
    st.fromText = pretty(snapNice(st.from, st.from, span));
    st.toText = pretty(snapNice(st.to, st.to, span));
  }

  setParam(cfg.restore ?? min);       // 훑기 전 값으로 되돌린다
  return {
    stages, transitions, events: soloEvents, samples: pts,
    elapsedMs: Date.now() - started,
    truncated: overBudget(),
    resolution: span / (samples - 1),
  };
}

/** 한 번에 끝까지 돌리는 동기 버전 */
export function sweepParameter(cfg) {
  const it = sweepSteps(cfg);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

/**
 * 불확실 구간 [lo, hi] 안(과 그 언저리)에 "깔끔한 수"가 있으면 그 값을 분기점으로 삼는다.
 *
 * 이분법이 짚어 낸 자리는 방법의 분해능만큼 흔들린다. 예컨대 y = x³ + a·x 의 근 개수는
 * 표본 간격보다 가까운 두 근을 구별하지 못해 a = 0 대신 −8.6e−5 로 잡힌다.
 * 그래서 훑는 범위의 0.1% 안에 깔끔한 수가 있으면 그것을 답으로 본다.
 */
function snapNiceInfo(lo, hi, span = 0) {
  if (hi < lo) [lo, hi] = [hi, lo];
  const pad = Math.max((hi - lo) * 0.5, span * 1e-3, Math.abs(hi) * 1e-9, 1e-12);
  const a = lo - pad;
  const b = hi + pad;
  const inRange = (v) => v >= a && v <= b;
  const denoms = [1, 2, 3, 4, 5, 6, 8, 10];
  for (const q of denoms) {
    const k = Math.round(((lo + hi) / 2) * q);
    if (inRange(k / q)) return { v: k === 0 ? 0 : k / q, snapped: true };
  }
  for (const base of [Math.PI, Math.E, Math.SQRT2]) {
    for (const q of [1, 2, 3, 4]) {
      const k = Math.round(((lo + hi) / 2) / (base / q));
      if (k !== 0 && Math.abs(k) <= 12 && inRange((k * base) / q)) {
        return { v: (k * base) / q, snapped: true };
      }
    }
  }
  const mid = (lo + hi) / 2;
  return { v: mid === 0 ? 0 : mid, snapped: false };
}

function snapNice(lo, hi, span = 0) {
  return snapNiceInfo(lo, hi, span).v;
}

export { trimNum };
