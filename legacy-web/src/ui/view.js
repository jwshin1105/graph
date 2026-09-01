// 좌표계 · 눈금 계산

export class View {
  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.cx = 0;          // 화면 중심의 수학 좌표
    this.cy = 0;
    // x·y 배율을 따로 둔다. 같게 두면 축이 정사각이고, 다르게 두면
    // y = 1000x 나 항이 수천까지 커지는 수열도 화면에 담을 수 있다.
    this.scaleX = 60;
    this.scaleY = 60;
    this.locked = true;   // 두 배율을 함께 움직일지
  }

  /** 이전 코드와의 호환: scale 은 x 배율을 가리킨다 */
  get scale() { return this.scaleX; }
  set scale(v) { this.scaleX = v; this.scaleY = v; }
  get aspect() { return this.scaleY / this.scaleX; }

  get xmin() { return this.cx - this.width / 2 / this.scaleX; }
  get xmax() { return this.cx + this.width / 2 / this.scaleX; }
  get ymin() { return this.cy - this.height / 2 / this.scaleY; }
  get ymax() { return this.cy + this.height / 2 / this.scaleY; }

  toPxX(x) { return (x - this.cx) * this.scaleX + this.width / 2; }
  toPxY(y) { return this.height / 2 - (y - this.cy) * this.scaleY; }
  toMathX(px) { return (px - this.width / 2) / this.scaleX + this.cx; }
  toMathY(py) { return (this.height / 2 - py) / this.scaleY + this.cy; }

  resize(w, h) { this.width = w; this.height = h; }

  /**
   * 한 점을 고정한 채 확대·축소한다.
   * axis: 'both' | 'x' | 'y'
   */
  zoomAt(px, py, factor, axis = 'both') {
    const mx = this.toMathX(px);
    const my = this.toMathY(py);
    const clamp = (v) => Math.min(1e9, Math.max(1e-9, v));
    if (axis !== 'y') this.scaleX = clamp(this.scaleX * factor);
    if (axis !== 'x') this.scaleY = clamp(this.scaleY * factor);
    if (axis !== 'both') this.locked = false;
    this.cx = mx - (px - this.width / 2) / this.scaleX;
    this.cy = my + (py - this.height / 2) / this.scaleY;
  }

  panPx(dx, dy) {
    this.cx -= dx / this.scaleX;
    this.cy += dy / this.scaleY;
  }

  /** 두 배율을 1:1 로 되돌린다 */
  squareUp() {
    const g = Math.sqrt(this.scaleX * this.scaleY);
    this.scaleX = g;
    this.scaleY = g;
    this.locked = true;
  }

  bounds() {
    return {
      xmin: this.xmin, xmax: this.xmax, ymin: this.ymin, ymax: this.ymax,
      width: this.width, height: this.height,
    };
  }

  /**
   * 주어진 영역이 화면에 들어오도록 맞춘다.
   * square 가 false 면 x·y 배율을 따로 잡아 세로로 긴 자료도 꽉 채운다.
   */
  fit(xmin, xmax, ymin, ymax, pad = 0.15, square = false) {
    const w = Math.max(xmax - xmin, 1e-12);
    const h = Math.max(ymax - ymin, 1e-12);
    this.cx = (xmin + xmax) / 2;
    this.cy = (ymin + ymax) / 2;
    const sx = this.width / (w * (1 + pad));
    const sy = this.height / (h * (1 + pad));
    if (square) {
      const s = Math.min(sx, sy);
      this.scaleX = this.scaleY = isFinite(s) && s > 0 ? s : 60;
      this.locked = true;
    } else {
      this.scaleX = isFinite(sx) && sx > 0 ? sx : 60;
      this.scaleY = isFinite(sy) && sy > 0 ? sy : 60;
      this.locked = Math.abs(Math.log(this.scaleY / this.scaleX)) < 1e-9;
    }
  }
}

/** 1·2·5 계열의 보기 좋은 눈금 간격 */
export function niceStep(rough) {
  const p = Math.pow(10, Math.floor(Math.log10(rough)));
  const r = rough / p;
  if (r < 1.5) return p;
  if (r < 3.5) return 2 * p;
  if (r < 7.5) return 5 * p;
  return 10 * p;
}

export function ticks(min, max, targetCount) {
  const step = niceStep((max - min) / targetCount);
  const out = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-6; v += step) {
    out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  }
  return { step, values: out };
}

/**
 * 눈금 표기.
 * 축 전체에서 표기 방식을 하나로 정한다. 값마다 따로 판단하면
 * 0.0002 옆에 1.0e-4 가 나란히 찍히는 일이 생긴다.
 */
export function formatTick(v, step, max) {
  if (v === 0) return '0';
  const big = Math.max(Math.abs(max ?? v), Math.abs(step));
  if (big >= 1e5 || big < 1e-3) {
    let e = Math.floor(Math.log10(step));
    let m = Math.round(v / Math.pow(10, e));
    if (Math.abs(m) >= 10 && m % 10 === 0) { m /= 10; e += 1; }
    return `${m}e${e}`;
  }
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return parseFloat(v.toFixed(Math.min(12, digits))).toString();
}
