// 양함수 y=f(x) · 매개변수 · 극좌표 곡선의 적응 표본화.
// 꺾인 정도(각도)를 보며 재귀적으로 세분하고, 점근선·불연속은 끊는다.

const MAX_DEPTH = 14;

/**
 * y=f(x) 를 적응적으로 표본화한다.
 * 극점·불연속에서는 선을 끊어 세로 직선이 그려지는 것을 막는다.
 * @returns {{polylines:number[][], breaks:number[]}}
 */
export function sampleFunction(f, xmin, xmax, opts = {}) {
  const { samples = 400, ymin = -Infinity, ymax = Infinity } = opts;
  const yspan = isFinite(ymax - ymin) && ymax > ymin ? ymax - ymin : xmax - xmin;
  const xspan = xmax - xmin;
  const polylines = [];
  const breaks = [];
  let cur = [];

  const emit = (x, y) => { if (isFinite(y)) cur.push(x, y); };
  const cut = (x) => {
    if (cur.length >= 4) polylines.push(cur);
    if (cur.length && isFinite(x)) breaks.push(x);
    cur = [];
  };

  // 화면 밖 판정: 두 끝점이 모두 보이는 영역 훨씬 바깥이면 정밀하게 그릴 필요가 없다
  const outside = (a, c) => {
    const lo = ymin - yspan, hi = ymax + yspan;
    return (a < lo && c < lo) || (a > hi && c > hi);
  };

  const walk = (x0, y0, x1, y1, depth) => {
    const xm = 0.5 * (x0 + x1);
    const ym = f(xm);
    // 한 점 사이에서 y 가 화면 높이의 1% 이상 건너뛰면 "끊긴 곳"으로 본다.
    // 극점(1/x, tan x)뿐 아니라 계단함수(floor, sgn)의 도약도 이 기준에 걸린다.
    const dy = isFinite(y0) && isFinite(y1) ? Math.abs((y1 - y0) / yspan) : 0;
    // 좌표가 아주 큰 곳(x ≈ 1e15)에서는 부동소수 눈금 자체가 굵어서
    // 매끄러운 직선도 계단처럼 보인다. 그 눈금보다 확실히 큰 도약만 인정한다.
    const resolution = 1e-12 * Math.max(Math.abs(y0), Math.abs(y1), Math.abs(xm));
    const bigJump = dy > 0.01 && Math.abs(y1 - y0) > resolution;

    if (!isFinite(ym)) {
      if (depth < 10) {
        walk(x0, y0, xm, ym, depth + 1);
        cut(xm);
        walk(xm, ym, x1, y1, depth + 1);
      } else cut(xm);
      return;
    }
    if (depth >= MAX_DEPTH) {
      // 진짜 불연속인지, 그냥 아주 가파른 곳인지 가른다.
      // 불연속이면 y 의 변화가 한쪽 절반에 몰려 있어 반으로 쪼개도 간격이 안 줄고,
      // 매끄럽고 가파른 곳(sin(1/x) 등)이면 양쪽 절반에 절반씩 나뉜다.
      const gap = Math.abs(y1 - y0);
      const half = Math.max(Math.abs(ym - y0), Math.abs(y1 - ym));
      if (bigJump && half > 0.8 * gap) cut(xm); else emit(xm, ym);
      return;
    }
    if (isFinite(y0) && isFinite(y1) && outside(y0, y1) && depth >= 2) {
      emit(xm, ym);      // 화면 밖에서는 성기게 — 불필요한 세분으로 점 수가 폭증하지 않게
      return;
    }

    // 정규화 좌표에서 현으로부터 중점이 벗어난 거리(≈픽셀 오차)를 잰다
    const ax = (xm - x0) / xspan, ay = (ym - y0) / yspan;
    const bx = (x1 - xm) / xspan, by = (y1 - ym) / yspan;
    const chord = Math.hypot(ax + bx, ay + by);
    const cross = Math.abs(ax * by - ay * bx);
    const dev = chord > 1e-15 ? cross / chord : Math.hypot(ax, ay);
    // 진동이 빨라 중점이 우연히 현 위에 놓이는 앨리어싱 방지
    const tooLong = chord > 0.004 && depth < 6;
    void dev;

    if (dev > 0.0006 || bigJump || tooLong) {
      walk(x0, y0, xm, ym, depth + 1);
      emit(xm, ym);
      walk(xm, ym, x1, y1, depth + 1);
    }
  };

  const step = xspan / samples;
  const vals = new Array(samples + 1);
  for (let i = 0; i <= samples; i++) vals[i] = f(xmin + i * step);

  // 한 점만 값이 없고 양옆이 매끄럽게 이어지면(sin x / x 의 x = 0 처럼)
  // 없앨 수 있는 구멍이므로 양옆의 평균으로 메워 선을 끊지 않는다.
  for (let i = 1; i < samples; i++) {
    if (isFinite(vals[i])) continue;
    const l = vals[i - 1];
    const r = vals[i + 1];
    if (!isFinite(l) || !isFinite(r)) continue;
    if (Math.abs(r - l) < yspan * 0.02) vals[i] = (l + r) / 2;
  }

  let px = xmin, py = vals[0];
  emit(px, py);
  for (let i = 1; i <= samples; i++) {
    const x = xmin + i * step;
    const y = vals[i];
    if (!isFinite(py) && !isFinite(y)) { px = x; py = y; continue; }
    walk(px, py, x, y, 0);
    if (isFinite(y)) emit(x, y); else cut(x);
    px = x; py = y;
  }
  cut(NaN);
  return { polylines, breaks };
}

/**
 * 매개변수 곡선 (x(t), y(t)) 의 적응 표본화.
 * 화면 좌표에서 현으로부터 벗어난 거리를 보며 세분하므로,
 * 매개변수 간격이 일정해도 곡선이 가파른 곳에서 각지지 않는다.
 */
export function sampleParametric(fx, fy, tmin, tmax, opts = {}) {
  const {
    samples = 600,
    xmin = -Infinity, xmax = Infinity, ymin = -Infinity, ymax = Infinity,
    maxDepth = 12,
  } = typeof opts === 'number' ? { samples: opts } : opts;

  const xspan = isFinite(xmax - xmin) && xmax > xmin ? xmax - xmin : Math.max(1, tmax - tmin);
  const yspan = isFinite(ymax - ymin) && ymax > ymin ? ymax - ymin : xspan;
  const polylines = [];
  let cur = [];
  const at = (t) => [fx(t), fy(t)];
  const emit = (x, y) => { if (isFinite(x) && isFinite(y)) cur.push(x, y); };
  const cut = () => { if (cur.length >= 4) polylines.push(cur); cur = []; };

  const offscreen = (p) =>
    p[0] < xmin - xspan || p[0] > xmax + xspan || p[1] < ymin - yspan || p[1] > ymax + yspan;

  const walk = (t0, p0, t1, p1, depth) => {
    if (depth >= maxDepth) return;
    const tm = 0.5 * (t0 + t1);
    const pm = at(tm);
    if (!isFinite(pm[0]) || !isFinite(pm[1])) {
      if (depth < 8) {
        walk(t0, p0, tm, pm, depth + 1);
        cut();
        walk(tm, pm, t1, p1, depth + 1);
      } else cut();
      return;
    }
    // 세 점이 모두 화면 밖 같은 쪽이면 정밀도가 필요 없다
    if (depth >= 2 && offscreen(p0) && offscreen(pm) && offscreen(p1)) {
      emit(pm[0], pm[1]);
      return;
    }
    const ax = (pm[0] - p0[0]) / xspan, ay = (pm[1] - p0[1]) / yspan;
    const bx = (p1[0] - pm[0]) / xspan, by = (p1[1] - pm[1]) / yspan;
    const chord = Math.hypot(ax + bx, ay + by);
    const cross = Math.abs(ax * by - ay * bx);
    const dev = chord > 1e-15 ? cross / chord : Math.hypot(ax, ay);
    if (dev > 0.0006 || (chord > 0.006 && depth < 7)) {
      walk(t0, p0, tm, pm, depth + 1);
      emit(pm[0], pm[1]);
      walk(tm, pm, t1, p1, depth + 1);
    }
  };

  const step = (tmax - tmin) / samples;
  let pt = tmin, pp = at(tmin);
  emit(pp[0], pp[1]);
  for (let i = 1; i <= samples; i++) {
    const t = tmin + i * step;
    const p = at(t);
    if (!isFinite(pp[0]) && !isFinite(p[0])) { pt = t; pp = p; continue; }
    walk(pt, pp, t, p, 0);
    if (isFinite(p[0]) && isFinite(p[1])) emit(p[0], p[1]); else cut();
    pt = t; pp = p;
  }
  cut();
  return { polylines };
}

/** 극좌표 r=f(θ) */
export function samplePolar(fr, tmin, tmax, opts = {}) {
  return sampleParametric(
    (t) => fr(t) * Math.cos(t),
    (t) => fr(t) * Math.sin(t),
    tmin, tmax, opts,
  );
}
