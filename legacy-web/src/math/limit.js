// 극한 — 대입해서 되면 정확히, 0/0 이면 로피탈로, 그마저 안 되면 수치로 좁힌다.
//
// 수치로만 재면 sin(x)/x 의 x → 0 을 0.9999999999999999 라고 답하게 된다.
// 대입과 로피탈은 기호 계산이라 그런 오차가 없다.

import { derivative } from './derivative.js';
import { toExact, evalBig } from './exactval.js';

const num = (v) => ({ type: 'num', value: v, text: String(v) });

/** 식 안의 변수 v 를 다른 식으로 바꿔 끼운다 */
export function substitute(node, v, repl) {
  const walk = (n) => {
    if (!n || typeof n !== 'object') return n;
    if (n.type === 'var' && n.name === v) return repl;
    const out = { ...n };
    for (const k of ['a', 'b']) if (n[k] && n[k].type) out[k] = walk(n[k]);
    if (Array.isArray(n.args)) out.args = n.args.map(walk);
    if (Array.isArray(n.items)) out.items = n.items.map(walk);
    return out;
  };
  return walk(node);
}

/**
 * lim_{v → at} body
 *
 * @param {object} body   식 AST
 * @param {string} v      변수 이름
 * @param {number} at     다가가는 값 (±Infinity 허용)
 * @param {object} opts   {fn: (env)=>number, consts: Map, digits: number}
 * @returns {{value:number, exact:object|null, text:string, method:string,
 *            error:number, sided:{left:number, right:number}|null, steps:string[]}}
 */
export function limitOf(body, v, at, opts = {}) {
  const steps = [];
  const consts = opts.consts || new Map();
  const digits = opts.digits || 30;

  // 1) 그냥 대입해 본다
  if (isFinite(at)) {
    const sub = substitute(body, v, numOf(at));
    const ex = safeExact(sub, consts);
    if (ex) {
      const n = ex.toNumber();
      if (isFinite(n)) {
        steps.push(`${v} = ${fmt(at)} 을 그대로 대입할 수 있습니다.`);
        return done(ex, n, 'substitute', 0, steps);
      }
    }
  }

  // 2) 0/0 · ∞/∞ 이면 로피탈
  const lh = lhopital(body, v, at, consts, steps, digits);
  if (lh) return lh;

  // 3) 수치로 좁힌다 — 양쪽에서 다가가 값이 모이는지 본다
  const f = opts.fn;
  if (!f) return null;
  const probe = (dir) => {
    const seq = [];
    for (let k = 2; k <= 12; k++) {
      const h = Math.pow(10, -k);
      const x = isFinite(at) ? at + dir * h : dir * Math.pow(10, k);
      const y = f({ [v]: x });
      if (isFinite(y)) seq.push(y);
    }
    if (seq.length < 4) return null;
    const raw = seq[seq.length - 1];
    const prevRaw = seq[seq.length - 2];
    // 발산하는가 — 값이 계속 커지기만 하면 극한이 없다.
    // 이걸 먼저 가르지 않으면 에이트킨이 1/x 의 발산 수열을 0 으로 "가속" 한다.
    if (Math.abs(raw) > 1e8 && Math.abs(raw) > Math.abs(prevRaw) * 2) {
      return { diverges: Math.sign(raw), value: raw, spread: Infinity };
    }
    // 모이는 수열일 때만 에이트킨 Δ² 로 당긴다 ((1+1/x)^x 처럼 1/x 로 천천히 모이는 경우)
    const d0 = Math.abs(seq[1] - seq[0]);
    const dn = Math.abs(raw - prevRaw);
    const converging = dn < d0 * 0.5 || dn < 1e-8;
    if (!converging) {
      // ln x 처럼 천천히 발산하는 것과 sin x 처럼 진동하는 것을 가른다
      const dir = seq[1] - seq[0];
      const mono = seq.every((y, i) => i === 0 || (y - seq[i - 1]) * dir >= 0);
      if (mono) return { diverges: Math.sign(raw - seq[0]) || 1, value: raw, spread: Infinity };
      return { unstable: true, value: raw, spread: Infinity };
    }
    const acc = aitken(seq);
    const last = acc.length ? acc[acc.length - 1] : raw;
    const prev = acc.length > 1 ? acc[acc.length - 2] : prevRaw;
    const spread = Math.min(Math.abs(last - prev), dn);
    return { value: isFinite(last) ? last : raw, spread: isFinite(spread) ? spread : Infinity };
  };
  const at2 = isFinite(at) ? at : Math.sign(at);
  const right = probe(isFinite(at) ? 1 : (at2 || 1));
  const left = isFinite(at) ? probe(-1) : null;
  if (!right) return null;
  if (right.unstable || (left && left.unstable)) {
    steps.push('값이 한 곳으로 모이지 않고 흔들립니다.');
    return {
      value: NaN, exact: null, text: '극한이 없습니다 (값이 모이지 않음)',
      method: 'numeric', error: Infinity, sided: null, steps,
    };
  }
  if (right.diverges || (left && left.diverges)) {
    const same = !left || left.diverges === right.diverges;
    if (same && right.diverges) {
      steps.push('값이 한없이 커집니다.');
      const t = right.diverges > 0 ? '∞' : '−∞';
      return {
        value: right.diverges * Infinity, exact: null, text: t,
        method: 'numeric', error: 0, sided: null, steps,
      };
    }
    steps.push('왼쪽과 오른쪽에서 서로 다른 무한대로 갑니다.');
    return {
      value: NaN, exact: null, text: '극한이 없습니다 (좌우가 다름)',
      method: 'numeric', error: Infinity,
      sided: left ? { left: left.value, right: right.value } : null, steps,
    };
  }
  if (left && Math.abs(left.value - right.value) > 1e-6 * Math.max(1, Math.abs(right.value))) {
    steps.push('왼쪽과 오른쪽에서 다가간 값이 다릅니다.');
    return {
      value: NaN, exact: null, text: '극한이 없습니다 (좌우가 다름)',
      method: 'numeric', error: Infinity,
      sided: { left: left.value, right: right.value }, steps,
    };
  }
  steps.push(`${v} 를 ${fmt(at)} 에 가깝게 하며 값이 모이는지 보았습니다.`);
  const err = Math.max(right.spread, left ? left.spread : 0);
  let value = right.value;
  // 오차보다 작은 값은 0 으로 본다. sin(x)/x 의 x → ∞ 를 −6×10⁻¹³ 이라 적으면 안 된다
  if (Math.abs(value) <= Math.max(err * 4, 1e-9)) {
    value = 0;
    steps.push('값이 오차 범위 안에서 0 으로 모입니다.');
  }
  return {
    value, exact: null, text: value === 0 ? '0' : trim(value, err),
    method: 'numeric', error: err, sided: null, steps,
  };
}

/** 0/0, ∞/∞ 꼴이면 분자·분모를 미분해 다시 본다 */
function lhopital(body, v, at, consts, steps, digits) {
  if (body.type !== 'bin' || body.op !== '/') return null;
  let p = body.a;
  let q = body.b;
  for (let i = 0; i < 8; i++) {
    const pv = valueAt(p, v, at, consts, digits);
    const qv = valueAt(q, v, at, consts, digits);
    if (pv === null || qv === null) return null;
    const zeroZero = Math.abs(pv) < 1e-12 && Math.abs(qv) < 1e-12;
    const infInf = !isFinite(pv) && !isFinite(qv);
    if (!zeroZero && !infInf) {
      if (i === 0) return null;                 // 처음부터 부정형이 아니면 로피탈이 아니다
      if (Math.abs(qv) < 1e-300) return null;
      const ex = ratioExact(p, q, v, at, consts);
      const val = pv / qv;
      steps.push(`${i}번 미분한 뒤 대입하면 값이 정해집니다.`);
      return done(ex, ex ? ex.toNumber() : val, `l'hopital×${i}`, 0, steps);
    }
    const dp = derivative(p, v);
    const dq = derivative(q, v);
    if (!dp || !dq) return null;
    if (i === 0) {
      steps.push(zeroZero ? '0/0 꼴이라 분자와 분모를 각각 미분했습니다 (로피탈).'
        : '∞/∞ 꼴이라 분자와 분모를 각각 미분했습니다 (로피탈).');
    }
    p = dp;
    q = dq;
  }
  return null;
}

function ratioExact(p, q, v, at, consts) {
  if (!isFinite(at)) return null;
  const a = safeExact(substitute(p, v, numOf(at)), consts);
  const b = safeExact(substitute(q, v, numOf(at)), consts);
  if (!a || !b || b.isZero) return null;
  return a.div(b);
}

function valueAt(node, v, at, consts, digits) {
  if (isFinite(at)) {
    const sub = substitute(node, v, numOf(at));
    const ex = safeExact(sub, consts);
    if (ex) return ex.toNumber();
    const b = safeBig(sub, consts, digits);
    if (b) return b.toNumber();
    return null;
  }
  // ±∞ 는 아주 큰 값으로 가늠한다
  const sub = substitute(node, v, num(at > 0 ? 1e8 : -1e8));
  const b = safeBig(sub, consts, 25);
  return b ? b.toNumber() : null;
}

const numOf = (v) => {
  if (Number.isInteger(v)) return num(v);
  return num(v);
};
const safeExact = (n, c) => { try { return toExact(n, c); } catch { return null; } };
const safeBig = (n, c, d) => { try { return evalBig(n, c, d); } catch { return null; } };

function done(exact, value, method, error, steps) {
  return {
    value, exact, text: exact ? exact.toString() : trim(value, error),
    method, error, sided: null, steps,
  };
}

function trim(v, err) {
  if (!isFinite(v)) return String(v);
  const d = err > 0 ? Math.max(2, Math.floor(-Math.log10(err / Math.max(1, Math.abs(v)))) - 1) : 12;
  return String(Number(v.toPrecision(Math.min(15, d))));
}

const fmt = (v) => (v === Infinity ? '∞' : v === -Infinity ? '−∞' : String(v));

/** 에이트킨 Δ² 가속 */
function aitken(seq) {
  const out = [];
  for (let i = 0; i + 2 < seq.length; i++) {
    const d1 = seq[i + 1] - seq[i];
    const d2 = seq[i + 2] - seq[i + 1];
    const den = d2 - d1;
    if (Math.abs(den) < 1e-300) continue;
    const v = seq[i] - (d1 * d1) / den;
    if (isFinite(v)) out.push(v);
  }
  return out;
}
