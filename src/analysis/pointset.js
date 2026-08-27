// 점열(2차원 점 집합)의 구조를 자동으로 읽어 내는 분석기.
//   · 정렬 여부 / 등간격 / 격자 구조
//   · 공선성 · 이차곡선 · 대칭성
//   · x 가 등차이면 y 를 수열로 넘겨 일반항까지 찾아낸다
//   · 극좌표에서의 규칙성(등각 회전, 로그나선)

import { pretty, trimNum, coefTerm, signed, baseStr } from '../math/numeric.js';
import { analyzeSequence } from './sequence.js';
import { fitModels } from './fitting.js';
import { fitConic } from './conic.js';

const near = (a, b, s) => Math.abs(a - b) <= 1e-7 * Math.max(1, s);

function spread(v) {
  const mx = Math.max(...v), mn = Math.min(...v);
  return Math.max(mx - mn, 1e-12);
}

/**
 * @param {number[][]} points [[x,y], …]
 * @returns {{findings:Array, summary:string}}
 */
export function analyzePointSet(points, opts = {}) {
  const given = points.filter((p) => p && isFinite(p[0]) && isFinite(p[1]));
  // 대부분의 검사는 x 순으로 정렬해서 보고, 순서가 의미를 갖는 검사(닮음변환·나선)는
  // 입력된 차례 그대로 본다.
  const pts = given.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const findings = [];
  const n = pts.length;
  if (n === 0) return { findings, summary: '점이 없습니다.', points: pts };
  if (n === 1) {
    return { findings, points: pts, summary: `해가 한 점 (${pretty(pts[0][0])}, ${pretty(pts[0][1])}) 뿐입니다.` };
  }

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const sx = spread(xs), sy = spread(ys);
  const push = (f) => findings.push({ confidence: 0.9, ...f });

  // 1) x 좌표가 등차인가 → y 를 수열로 분석
  const dx = [];
  for (let i = 1; i < n; i++) dx.push(xs[i] - xs[i - 1]);
  const uniformX = n >= 3 && dx.every((d) => near(d, dx[0], sx)) && Math.abs(dx[0]) > 1e-12;
  if (uniformX) {
    push({ type: 'grid-x', title: 'x 좌표가 등간격', confidence: 1,
      detail: `x 가 ${pretty(xs[0])} 부터 간격 ${pretty(dx[0])} 로 일정하게 놓여 있습니다.`,
      formula: `x_k = ${pretty(xs[0])}${signed(dx[0])}·(k−1)`.replace(/ ([+-]) 1·/, ' $1 ') });
    const seq = analyzeSequence(ys, { name: 'y' });
    for (const f of seq.findings.slice(0, 3)) {
      push({ ...f, title: `y 값의 규칙: ${f.title}`, source: 'sequence' });
    }
  }

  // 2) 공선성
  const line = fitLine(pts);
  if (line && line.maxDev < 1e-8 * Math.max(sx, sy)) {
    push({ type: 'collinear', title: '한 직선 위에 있음', confidence: 1,
      detail: `모든 점이 같은 직선 위에 놓입니다.`, formula: line.equation });
  } else if (line && line.r2 > 0.999 && n >= 4) {
    push({ type: 'near-line', title: '거의 직선 (선형 추세)', confidence: 0.7,
      detail: `R² = ${line.r2.toFixed(6)} 로 강한 선형 관계가 보입니다.`, formula: line.equation });
  }

  // 3) 이차곡선
  if (n >= 5 && !findings.some((f) => f.type === 'collinear')) {
    const conic = fitConic(pts);
    if (conic && conic.residual < 1e-7 && !conic.degenerate) {
      let detail = `모든 점이 ${conic.kind} 위에 있습니다.`;
      if (conic.radius) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}), 반지름 ${pretty(conic.radius)}.`;
      else if (conic.center) detail += ` 중심 (${pretty(conic.center[0])}, ${pretty(conic.center[1])}).`;
      push({ type: 'conic', title: `이차곡선(${conic.kind}) 위의 점들`, confidence: 0.95,
        detail, formula: conic.equation });
    }
  }

  // 4) 격자 구조 (x, y 각각 유한 개의 등차 값)
  const gx = latticeInfo(xs), gy = latticeInfo(ys);
  if (gx && gy && n >= 4 && !uniformX) {
    push({ type: 'lattice', title: '격자 모양으로 배열', confidence: 0.9,
      detail: `x 는 ${pretty(gx.start)} 에서 간격 ${pretty(gx.step)}, y 는 ${pretty(gy.start)} 에서 간격 ${pretty(gy.step)} 인 격자 위의 점들입니다.`,
      formula: `(x, y) = (${pretty(gx.start)} + ${coefTerm(gx.step, 'i')},  ${pretty(gy.start)} + ${coefTerm(gy.step, 'j')})` });
  }

  // 5) 대칭성
  const sym = symmetries(pts, Math.max(sx, sy));
  for (const s of sym) push({ type: 'symmetry', title: s.title, detail: s.detail, confidence: 0.85 });

  // 6) 이웃 점 사이 거리의 규칙
  if (n >= 4) {
    const dists = [];
    for (let i = 1; i < n; i++) dists.push(Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
    const ds = analyzeSequence(dists, { name: 'd' });
    const top = ds.findings.find((f) => f.confidence >= 0.95 && f.type !== 'constant');
    if (top) push({ ...top, title: `이웃한 점 사이 거리의 규칙: ${top.title}`, confidence: 0.8 });
    else if (dists.every((d) => near(d, dists[0], spread(dists)))) {
      push({ type: 'equidistant', title: '이웃한 점 사이 거리가 일정', confidence: 1,
        detail: `간격이 모두 ${pretty(dists[0])} 입니다.` });
    }
  }

  // 7) 극좌표에서의 규칙 (정다각형 배치)
  const polar = polarRegularity(pts);
  if (polar) push(polar);

  // 8) 닮음변환 규칙: p_{k+1} = w·p_k + c (복소수) — 회전·확대·로그나선을 한 번에 잡는다
  const sim = similarityRule(given);
  if (sim) push(sim);

  // 9) 함수 관계 y = f(x)
  if (n >= 4 && new Set(xs.map((x) => Math.round(x * 1e9))).size === n) {
    const models = fitModels(xs, ys, { maxDegree: Math.min(4, n - 2) });
    const best = models[0];
    if (best && best.r2 > 0.9999 && !findings.some((f) => f.source === 'sequence' && f.confidence >= 1)) {
      push({ type: 'relation', title: `y 와 x 의 관계: ${best.name}`, confidence: Math.min(0.95, best.r2),
        detail: `R² = ${best.r2.toFixed(8)}`, formula: best.formula });
    }
  }

  findings.sort((a, b) => b.confidence - a.confidence);
  return {
    findings, points: pts,
    summary: buildSummary(findings, pts),
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

function buildSummary(findings, pts) {
  const head = `점 ${pts.length}개`;
  if (!findings.length) return `${head} — 뚜렷한 규칙을 찾지 못했습니다.`;
  return `${head} — ${findings.slice(0, 2).map((f) => f.title).join(', ')}`;
}

function fitLine(pts) {
  const n = pts.length;
  const mx = pts.reduce((s, p) => s + p[0], 0) / n;
  const my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  // 전직교 회귀(수직선도 다룰 수 있게)
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta), ny = Math.cos(theta);
  const c = -(nx * mx + ny * my);
  let maxDev = 0;
  for (const [x, y] of pts) maxDev = Math.max(maxDev, Math.abs(nx * x + ny * y + c));
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  let equation;
  if (Math.abs(ny) > 1e-9) {
    const m = -nx / ny, b = -c / ny;
    equation = `y = ${pretty(m)}${Math.abs(m) === 1 ? '' : '·'}x ${b < 0 ? '-' : '+'} ${pretty(Math.abs(b))}`
      .replace('= 1·x', '= x').replace('= 0·x + ', '= ').replace(/= 0x \+ /, '= ');
    if (Math.abs(m) < 1e-12) equation = `y = ${pretty(-c / ny)}`;
  } else {
    equation = `x = ${pretty(-c / nx)}`;
  }
  return { maxDev, r2, equation, normal: [nx, ny, c] };
}

function latticeInfo(v) {
  const uniq = [...new Set(v.map((x) => Math.round(x * 1e9) / 1e9))].sort((a, b) => a - b);
  if (uniq.length < 2) return null;
  const d = [];
  for (let i = 1; i < uniq.length; i++) d.push(uniq[i] - uniq[i - 1]);
  const s = spread(uniq);
  return d.every((x) => near(x, d[0], s)) ? { start: uniq[0], step: d[0], count: uniq.length } : null;
}

function symmetries(pts, scale) {
  const out = [];
  const tol = 1e-7 * Math.max(1, scale);
  const has = (x, y) => pts.some((p) => Math.abs(p[0] - x) < tol && Math.abs(p[1] - y) < tol);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

  if (pts.every(([x, y]) => has(2 * cx - x, y))) {
    out.push({ title: `직선 x = ${pretty(cx)} 에 대해 좌우 대칭`, detail: '모든 점의 거울상이 다시 점열에 속합니다.' });
  }
  if (pts.every(([x, y]) => has(x, 2 * cy - y))) {
    out.push({ title: `직선 y = ${pretty(cy)} 에 대해 상하 대칭`, detail: '모든 점의 거울상이 다시 점열에 속합니다.' });
  }
  if (pts.every(([x, y]) => has(2 * cx - x, 2 * cy - y)) && out.length < 2) {
    out.push({ title: `점 (${pretty(cx)}, ${pretty(cy)}) 에 대해 점대칭`, detail: '180° 회전에 대해 불변입니다.' });
  }
  if (pts.every(([x, y]) => has(y, x))) {
    out.push({ title: '직선 y = x 에 대해 대칭', detail: 'x 와 y 를 바꾸어도 같은 점열입니다.' });
  }
  return out;
}

/**
 * 점열이 "같은 닮음변환을 반복해서 얻어지는가"를 본다.
 * 복소수로 보면 z_{k+1} = w·z_k + c 이고, w 의 크기가 확대율, 편각이 회전각이다.
 * |w| = 1 이면 회전(정다각형·원 위 배치), |w| ≠ 1 이면 로그나선(등각나선)이다.
 */
function similarityRule(pts) {
  const n = pts.length;
  if (n < 4) return null;
  // 최소제곱: 미지수 (wr, wi, cr, ci)
  const A = Array.from({ length: 4 }, () => new Array(4).fill(0));
  const b = new Array(4).fill(0);
  const addRow = (row, rhs) => {
    for (let i = 0; i < 4; i++) {
      b[i] += row[i] * rhs;
      for (let j = 0; j < 4; j++) A[i][j] += row[i] * row[j];
    }
  };
  for (let k = 0; k + 1 < n; k++) {
    const [x, y] = pts[k];
    const [u, v] = pts[k + 1];
    addRow([x, -y, 1, 0], u);      // 실수부
    addRow([y, x, 0, 1], v);       // 허수부
  }
  const sol = gauss4(A, b);
  if (!sol) return null;
  const [wr, wi, cr, ci] = sol;
  const scale = Math.max(...pts.flat().map(Math.abs), 1);
  let err = 0;
  for (let k = 0; k + 1 < n; k++) {
    const [x, y] = pts[k];
    const [u, v] = pts[k + 1];
    err = Math.max(err, Math.hypot(wr * x - wi * y + cr - u, wi * x + wr * y + ci - v));
  }
  if (err > 1e-7 * scale) return null;
  const mod = Math.hypot(wr, wi);
  const ang = Math.atan2(wi, wr);
  if (Math.abs(mod - 1) < 1e-9 && Math.abs(ang) < 1e-9) return null;   // 평행이동은 이미 다른 규칙이 설명
  // 고정점 z* = c/(1−w)
  const dr = 1 - wr, di = -wi;
  const den = dr * dr + di * di;
  const fx = den > 1e-14 ? (cr * dr + ci * di) / den : NaN;
  const fy = den > 1e-14 ? (ci * dr - cr * di) / den : NaN;
  const degAng = (ang * 180) / Math.PI;

  if (Math.abs(mod - 1) < 1e-9) {
    return { type: 'rotation', title: '같은 각만큼 회전시켜 얻어지는 점열', confidence: 0.95,
      detail: `점 (${pretty(fx)}, ${pretty(fy)}) 을 중심으로 매번 ${trimNum(degAng, 4)}° 씩 회전한 점들입니다.`,
      formula: `z_{k+1} = e^(i·${pretty(ang)})·(z_k − z*) + z*,  z* = ${pretty(fx)} + ${pretty(fy)}i` };
  }
  return { type: 'log-spiral', title: '로그나선(등각나선) 위의 점열', confidence: 0.95,
    detail: `점 (${pretty(fx)}, ${pretty(fy)}) 을 중심으로 매번 ${trimNum(degAng, 4)}° 회전하며 거리가 ${pretty(mod)} 배씩 커집니다.`,
    formula: `r = r₀·${pretty(Math.exp(Math.log(mod) / (ang || 1)))}^θ  (극좌표, 중심 (${pretty(fx)}, ${pretty(fy)}))` };
}

function gauss4(A, b) {
  const n = 4;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((r, i) => r[n] / M[i][i]);
}

function polarRegularity(pts) {
  if (pts.length < 4) return null;
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const polar = pts.map(([x, y]) => ({ r: Math.hypot(x - cx, y - cy), t: Math.atan2(y - cy, x - cx) }))
    .sort((a, b) => a.t - b.t);
  const dt = [];
  for (let i = 1; i < polar.length; i++) dt.push(polar[i].t - polar[i - 1].t);
  if (!dt.length) return null;
  const uniform = dt.every((d) => Math.abs(d - dt[0]) < 1e-7 * Math.max(1, Math.abs(dt[0])));
  if (!uniform) return null;
  const rs = polar.map((p) => p.r);
  const sameR = rs.every((r) => Math.abs(r - rs[0]) < 1e-7 * Math.max(1, rs[0]));
  if (sameR) {
    return { type: 'regular-polygon', title: `정${pts.length}각형 배치`, confidence: 0.95,
      detail: `중심 (${pretty(cx)}, ${pretty(cy)}) 에서 반지름 ${pretty(rs[0])} 인 원 위에 ${pretty(360 / pts.length)}° 간격으로 놓여 있습니다.` };
  }
  return null;
}
