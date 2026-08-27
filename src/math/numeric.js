// 수치 도구 모음: 근 찾기, 뉴턴법(1D/2D), 선형대수, 최소제곱, 수 인식.

export const EPS = 1e-12;

/** 부호가 바뀌는 구간 [a,b] 에서 Brent 법으로 근을 찾는다. */
export function brent(f, a, b, tol = 1e-13, maxIter = 100) {
  let fa = f(a);
  let fb = f(b);
  if (!isFinite(fa) || !isFinite(fb) || fa * fb > 0) return null;
  if (Math.abs(fa) < Math.abs(fb)) { [a, b] = [b, a]; [fa, fb] = [fb, fa]; }
  let c = a, fc = fa, d = b - a, e = d;
  for (let i = 0; i < maxIter; i++) {
    if (fb === 0) return b;
    if (fa * fb > 0) { a = c; fa = fc; d = e = b - a; }
    if (Math.abs(fa) < Math.abs(fb)) { c = b; b = a; a = c; fc = fb; fb = fa; fa = fc; }
    const m = 0.5 * (a - b);
    if (Math.abs(m) <= tol * (1 + Math.abs(b))) return b;
    if (Math.abs(e) < tol || Math.abs(fc) <= Math.abs(fb)) { d = e = m; }
    else {
      let p, q;
      const s = fb / fc;
      if (a === c) { p = 2 * m * s; q = 1 - s; }
      else {
        const r = fb / fa, t = fc / fa;
        p = s * (2 * m * t * (t - r) - (b - c) * (r - 1));
        q = (t - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * m * q - Math.abs(tol * q), Math.abs(e * q))) { e = d; d = p / q; }
      else { d = e = m; }
    }
    c = b; fc = fb;
    b += Math.abs(d) > tol ? d : (m > 0 ? tol : -tol);
    fb = f(b);
    if (!isFinite(fb)) return null;
  }
  return b;
}

/**
 * 구간 [a,b] 에서 f 의 실근을 모두 찾는다.
 * 부호 변화 + (부호 변화 없는) 접점(중근)까지 함께 찾아내는 것이 핵심.
 * 극점(1/x, tan x 등)에서 생기는 가짜 근은 걸러낸다.
 */
export function findRoots(f, a, b, samples = 2000, tol = 1e-9) {
  const roots = [];
  const h = (b - a) / samples;
  let px = a, pv = f(a);
  const add = (r) => {
    if (r === null || !isFinite(r)) return;
    if (r < a - h || r > b + h) return;
    const v = f(r);
    const scale = Math.max(1, Math.abs(derivNum(f, r)));
    if (Math.abs(v) > 1e-6 * scale) return;              // 극점 근처 가짜 근 제거
    if (roots.some((q) => Math.abs(q - r) < Math.max(tol, 1e-7 * (1 + Math.abs(r))))) return;
    roots.push(r);
  };
  for (let i = 1; i <= samples; i++) {
    const x = a + i * h;
    const v = f(x);
    if (isFinite(pv) && isFinite(v)) {
      if (pv === 0) add(px);
      if (pv * v < 0) {
        // 값이 폭발하며 부호가 뒤집히면 극점(점근선)이지 근이 아니다
        const jump = Math.abs(v - pv);
        const local = Math.max(Math.abs(v), Math.abs(pv));
        if (!(local > 1e3 && jump > 1e3)) add(brent(f, px, x));
      } else if (pv * v > 0) {
        // 부호가 유지되어도 |f| 가 국소 최소이고 거의 0 이면 중근(접점)
        const m = 0.5 * (px + x);
        const vm = f(m);
        if (isFinite(vm) && Math.abs(vm) < Math.abs(pv) && Math.abs(vm) < Math.abs(v)) {
          const r = minimizeAbs(f, px, x);
          if (r !== null && Math.abs(f(r)) < 1e-10 * (1 + Math.abs(r))) add(r);
        }
      }
    }
    px = x; pv = v;
  }
  return roots.sort((p, q) => p - q);
}

/** 황금분할법으로 [a,b] 에서 |f| 를 최소화하는 점 */
export function minimizeAbs(f, a, b, iter = 200) {
  const g = (x) => Math.abs(f(x));
  const phi = (Math.sqrt(5) - 1) / 2;
  let c = b - phi * (b - a), d = a + phi * (b - a);
  let fc = g(c), fd = g(d);
  for (let i = 0; i < iter && b - a > 1e-15 * (1 + Math.abs(a)); i++) {
    if (fc < fd) { b = d; d = c; fd = fc; c = b - phi * (b - a); fc = g(c); }
    else { a = c; c = d; fc = fd; d = a + phi * (b - a); fd = g(d); }
  }
  return 0.5 * (a + b);
}

export function derivNum(f, x, h) {
  h = h || Math.max(1e-6, Math.abs(x) * 1e-6);
  const d = (f(x + h) - f(x - h)) / (2 * h);
  return isFinite(d) ? d : 0;
}

/** 1변수 뉴턴법 */
export function newton1D(f, x0, maxIter = 60) {
  let x = x0;
  for (let i = 0; i < maxIter; i++) {
    const v = f(x);
    if (!isFinite(v)) return null;
    if (Math.abs(v) < 1e-14) return x;
    const d = derivNum(f, x);
    if (Math.abs(d) < 1e-14) return null;
    const nx = x - v / d;
    if (!isFinite(nx)) return null;
    if (Math.abs(nx - x) < 1e-14 * (1 + Math.abs(x))) return nx;
    x = nx;
  }
  return Math.abs(f(x)) < 1e-9 ? x : null;
}

/**
 * 2변수 연립방정식 F(x,y)=0, G(x,y)=0 의 뉴턴법.
 * 야코비안은 수치 미분으로 구한다.
 */
export function newton2D(F, G, x0, y0, maxIter = 60) {
  let x = x0, y = y0;
  for (let i = 0; i < maxIter; i++) {
    const f = F(x, y), g = G(x, y);
    if (!isFinite(f) || !isFinite(g)) return null;
    if (Math.abs(f) < 1e-13 && Math.abs(g) < 1e-13) return [x, y];
    const h = Math.max(1e-7, Math.hypot(x, y) * 1e-7);
    const fx = (F(x + h, y) - F(x - h, y)) / (2 * h);
    const fy = (F(x, y + h) - F(x, y - h)) / (2 * h);
    const gx = (G(x + h, y) - G(x - h, y)) / (2 * h);
    const gy = (G(x, y + h) - G(x, y - h)) / (2 * h);
    const det = fx * gy - fy * gx;
    if (!isFinite(det) || Math.abs(det) < 1e-16) return null;
    const dx = (f * gy - g * fy) / det;
    const dy = (g * fx - f * gx) / det;
    const nx = x - dx, ny = y - dy;
    if (!isFinite(nx) || !isFinite(ny)) return null;
    if (Math.hypot(dx, dy) < 1e-14 * (1 + Math.hypot(x, y))) { x = nx; y = ny; break; }
    x = nx; y = ny;
  }
  return Math.abs(F(x, y)) < 1e-8 && Math.abs(G(x, y)) < 1e-8 ? [x, y] : null;
}

/** f(x,y)=0 위에서 |∇f| 가 0 인 고립점을 가우스-뉴턴으로 정련 */
export function refineIsolated(f, x0, y0, scale = 1) {
  let x = x0, y = y0;
  for (let i = 0; i < 80; i++) {
    const h = Math.max(1e-9, scale * 1e-6);
    const v = f(x, y);
    if (!isFinite(v)) return null;
    const fx = (f(x + h, y) - f(x - h, y)) / (2 * h);
    const fy = (f(x, y + h) - f(x, y - h)) / (2 * h);
    const g2 = fx * fx + fy * fy;
    if (g2 < 1e-30) break;
    // 가우스-뉴턴 스텝 (최소제곱 의미의 최소노름 해)
    const dx = (v * fx) / g2;
    const dy = (v * fy) / g2;
    const nx = x - dx, ny = y - dy;
    if (!isFinite(nx) || !isFinite(ny)) break;
    x = nx; y = ny;
    if (Math.hypot(dx, dy) < 1e-15 * scale) break;
  }
  return [x, y];
}

/** 가우스 소거법으로 A z = b 를 푼다 (A 는 행 배열). 특이하면 null. */
export function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / M[c][c];
      if (k === 0) continue;
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  return M.map((row, i) => row[n] / row[i][i] ?? 0).map((v, i) => M[i][n] / M[i][i]);
}

/** 최소제곱: X(m×n) 계수, y(m) → 정규방정식으로 β(n) */
export function lstsq(X, y) {
  const m = X.length;
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < n; j++) {
      b[j] += X[i][j] * y[i];
      for (let k = 0; k < n; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let j = 0; j < n; j++) A[j][j] += 1e-12;   // 티코노프 안정화
  return solveLinear(A, b);
}

/** 대칭행렬의 최소 고윳값에 대응하는 고유벡터 (역거듭제곱법) — 원뿔곡선 적합용 */
export function smallestEigenvector(A, iters = 400) {
  const n = A.length;
  const S = A.map((r, i) => r.map((v, j) => v + (i === j ? 1e-9 : 0)));
  let v = new Array(n).fill(0).map((_, i) => Math.sin(i + 1));
  for (let it = 0; it < iters; it++) {
    const w = solveLinear(S, v);
    if (!w) break;
    const norm = Math.hypot(...w);
    if (!isFinite(norm) || norm === 0) break;
    const nv = w.map((x) => x / norm);
    const diff = Math.hypot(...nv.map((x, i) => x - v[i]));
    v = nv;
    if (diff < 1e-14) break;
  }
  return v;
}

// ── 수 인식 ────────────────────────────────────────────────────
/** 연분수로 유리수 근사. 분모가 maxDen 이하이고 오차가 tol 이하면 반환. */
export function toRational(x, maxDen = 10000, tol = 1e-10) {
  if (!isFinite(x)) return null;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, v = x;
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(v);
    const h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    if (Math.abs(h1 / k1 - x) < tol * Math.max(1, x)) return { p: sign * h1, q: k1 };
    const frac = v - a;
    if (frac < 1e-15) break;
    v = 1 / frac;
  }
  return Math.abs(h1 / k1 - x) < tol * Math.max(1, x) ? { p: sign * h1, q: k1 } : null;
}

const SYMBOLS = [
  { v: Math.PI, s: 'π' },
  { v: Math.E, s: 'e' },
  { v: Math.sqrt(2), s: '√2' },
  { v: Math.sqrt(3), s: '√3' },
  { v: Math.sqrt(5), s: '√5' },
  { v: (1 + Math.sqrt(5)) / 2, s: 'φ' },
  { v: (1 - Math.sqrt(5)) / 2, s: '(1−√5)/2' },
  { v: Math.LN2, s: 'ln2' },
  { v: Math.log(3), s: 'ln3' },
];

/** 실수를 가능하면 정수·분수·π 배수 등 기호 형태로 예쁘게 표현한다. */
export function pretty(x, tol = 1e-9) {
  if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
  if (Math.abs(x) < tol) return '0';
  if (Math.abs(x - Math.round(x)) < tol * Math.max(1, Math.abs(x))) return String(Math.round(x));
  const r = toRational(x, 1000, tol);
  if (r && r.q <= 100) return `${r.p}/${r.q}`;
  for (const { v, s } of SYMBOLS) {
    const q = toRational(x / v, 100, tol * 10);
    if (q && Math.abs(q.p) <= 200 && q.q <= 100) {
      const mag = Math.abs(q.p) === 1 ? s : `${Math.abs(q.p)}${s}`;
      const body = q.q === 1 ? mag : `${mag}/${q.q}`;
      return q.p < 0 ? `-${body}` : body;
    }
  }
  const s = toRational(x * x, 1000, tol * 10);
  if (s && s.q === 1 && s.p > 0 && !Number.isInteger(Math.sqrt(s.p))) {
    return `${x < 0 ? '-' : ''}√${s.p}`;
  }
  return trimNum(x);
}

export function trimNum(x, digits = 6) {
  if (!isFinite(x)) return x > 0 ? '∞' : '-∞';
  if (Math.abs(x) >= 1e6 || (Math.abs(x) < 1e-4 && x !== 0)) return x.toExponential(4);
  const s = x.toFixed(digits).replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}

const SUPS = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', '(': '', ')': '' };
/** 지수를 위첨자로 (간단한 형태만) */
export function sup(e) {
  const s = String(e);
  if (/^-?\d+$/.test(s)) return [...s].map((c) => SUPS[c] || c).join('');
  if (/^[A-Za-z]\w*$/.test(s)) return `^${s}`;
  return `^(${s})`;
}

/** 괄호가 필요 없는 밑(base)인지 */
export function baseStr(x) {
  const s = pretty(x);
  return /^[A-Za-z0-9π√φ]+$/.test(s) ? s : `(${s})`;
}

/** " + 3" / " − 3" 처럼 부호를 앞세운 표기 */
export function signed(x) {
  const s = pretty(Math.abs(x));
  return `${x < 0 ? ' - ' : ' + '}${s}`;
}

/** 계수·기호 곱 표기 (1·x → x, -1·x → -x, 0 → '') */
export function coefTerm(c, sym) {
  if (Math.abs(c) < 1e-14) return '';
  if (!sym) return pretty(c);
  const a = Math.abs(c);
  const body = Math.abs(a - 1) < 1e-14 ? sym : `${pretty(a)}·${sym}`;
  return c < 0 ? `-${body}` : body;
}
