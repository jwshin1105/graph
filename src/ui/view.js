// 좌표계 · 눈금 계산

export class View {
  constructor(width = 800, height = 600) {
    this.width = width;
    this.height = height;
    this.cx = 0;          // 화면 중심의 수학 좌표
    this.cy = 0;
    this.scale = 60;      // 1 단위당 픽셀
  }
  get xmin() { return this.cx - this.width / 2 / this.scale; }
  get xmax() { return this.cx + this.width / 2 / this.scale; }
  get ymin() { return this.cy - this.height / 2 / this.scale; }
  get ymax() { return this.cy + this.height / 2 / this.scale; }

  toPxX(x) { return (x - this.cx) * this.scale + this.width / 2; }
  toPxY(y) { return this.height / 2 - (y - this.cy) * this.scale; }
  toMathX(px) { return (px - this.width / 2) / this.scale + this.cx; }
  toMathY(py) { return (this.height / 2 - py) / this.scale + this.cy; }

  resize(w, h) { this.width = w; this.height = h; }

  zoomAt(px, py, factor) {
    const mx = this.toMathX(px);
    const my = this.toMathY(py);
    this.scale = Math.min(1e7, Math.max(1e-6, this.scale * factor));
    this.cx = mx - (px - this.width / 2) / this.scale;
    this.cy = my + (py - this.height / 2) / this.scale;
  }

  panPx(dx, dy) {
    this.cx -= dx / this.scale;
    this.cy += dy / this.scale;
  }

  bounds() {
    return {
      xmin: this.xmin, xmax: this.xmax, ymin: this.ymin, ymax: this.ymax,
      width: this.width, height: this.height,
    };
  }

  fit(xmin, xmax, ymin, ymax, pad = 0.15) {
    const w = Math.max(xmax - xmin, 1e-9);
    const h = Math.max(ymax - ymin, 1e-9);
    this.cx = (xmin + xmax) / 2;
    this.cy = (ymin + ymax) / 2;
    this.scale = Math.min(this.width / (w * (1 + pad)), this.height / (h * (1 + pad)));
    if (!isFinite(this.scale) || this.scale <= 0) this.scale = 60;
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

export function formatTick(v, step) {
  if (v === 0) return '0';
  const digits = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  if (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-4) return v.toExponential(1);
  return parseFloat(v.toFixed(Math.min(10, digits))).toString();
}
