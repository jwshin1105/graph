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

  const JUMP = 6;   // 화면 높이의 6배 이상 튀면 극점으로 간주

  const walk = (x0, y0, x1, y1, depth) => {
    const xm = 0.5 * (x0 + x1);
    const ym = f(xm);
    const bigJump = isFinite(y0) && isFinite(y1) && Math.abs((y1 - y0) / yspan) > JUMP;

    if (!isFinite(ym)) {
      if (depth < 10) {
        walk(x0, y0, xm, ym, depth + 1);
        cut(xm);
        walk(xm, ym, x1, y1, depth + 1);
      } else cut(xm);
      return;
    }
    if (depth >= MAX_DEPTH) {
      if (bigJump) cut(xm); else emit(xm, ym);
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

    if (dev > 0.0006 || bigJump || tooLong) {
      walk(x0, y0, xm, ym, depth + 1);
      emit(xm, ym);
      walk(xm, ym, x1, y1, depth + 1);
    }
  };

  const step = xspan / samples;
  let px = xmin, py = f(xmin);
  emit(px, py);
  for (let i = 1; i <= samples; i++) {
    const x = xmin + i * step;
    const y = f(x);
    if (!isFinite(py) && !isFinite(y)) { px = x; py = y; continue; }
    walk(px, py, x, y, 0);
    if (isFinite(y)) emit(x, y); else cut(x);
    px = x; py = y;
  }
  cut(NaN);
  return { polylines, breaks };
}

/** 매개변수 곡선 (x(t), y(t)) */
export function sampleParametric(fx, fy, tmin, tmax, samples = 2000) {
  const polylines = [];
  let cur = [];
  const step = (tmax - tmin) / samples;
  for (let i = 0; i <= samples; i++) {
    const t = tmin + i * step;
    const x = fx(t), y = fy(t);
    if (isFinite(x) && isFinite(y)) cur.push(x, y);
    else { if (cur.length >= 4) polylines.push(cur); cur = []; }
  }
  if (cur.length >= 4) polylines.push(cur);
  return { polylines };
}

/** 극좌표 r=f(θ) */
export function samplePolar(fr, tmin, tmax, samples = 3000) {
  return sampleParametric(
    (t) => fr(t) * Math.cos(t),
    (t) => fr(t) * Math.sin(t),
    tmin, tmax, samples,
  );
}
