// 캔버스 렌더러: 격자·축·곡선·점열·영역을 그린다.

import { ticks, formatTick } from './view.js';

export const PALETTE = [
  '#2563eb', '#dc2626', '#059669', '#d97706',
  '#7c3aed', '#0891b2', '#db2777', '#65a30d',
];

export class Renderer {
  constructor(canvas, view) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.view = view;
    this.theme = 'light';
  }

  setTheme(t) { this.theme = t; }

  colors() {
    return this.theme === 'dark'
      ? { bg: '#0f1115', grid: '#1e2531', gridMinor: '#171c25', axis: '#8b98ad', text: '#9aa7bd', pointRing: '#0f1115' }
      : { bg: '#ffffff', grid: '#e3e8ef', gridMinor: '#f1f4f8', axis: '#64748b', text: '#64748b', pointRing: '#ffffff' };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.view.resize(rect.width, rect.height);
  }

  clear() {
    const c = this.colors();
    const { ctx, view } = this;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
    void view;
  }

  drawGrid() {
    const { ctx, view } = this;
    const c = this.colors();
    const tx = ticks(view.xmin, view.xmax, Math.max(4, view.width / 90));
    const ty = ticks(view.ymin, view.ymax, Math.max(4, view.height / 90));

    // 보조 격자
    ctx.lineWidth = 1;
    ctx.strokeStyle = c.gridMinor;
    ctx.beginPath();
    for (const v of subTicks(tx, view.xmin, view.xmax)) {
      const px = Math.round(view.toPxX(v)) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, view.height);
    }
    for (const v of subTicks(ty, view.ymin, view.ymax)) {
      const py = Math.round(view.toPxY(v)) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(view.width, py);
    }
    ctx.stroke();

    // 주 격자
    ctx.strokeStyle = c.grid;
    ctx.beginPath();
    for (const v of tx.values) {
      const px = Math.round(view.toPxX(v)) + 0.5;
      ctx.moveTo(px, 0); ctx.lineTo(px, view.height);
    }
    for (const v of ty.values) {
      const py = Math.round(view.toPxY(v)) + 0.5;
      ctx.moveTo(0, py); ctx.lineTo(view.width, py);
    }
    ctx.stroke();

    // 축
    const ax = Math.round(view.toPxX(0)) + 0.5;
    const ay = Math.round(view.toPxY(0)) + 0.5;
    ctx.strokeStyle = c.axis;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    if (ay > -50 && ay < view.height + 50) { ctx.moveTo(0, ay); ctx.lineTo(view.width, ay); }
    if (ax > -50 && ax < view.width + 50) { ctx.moveTo(ax, 0); ctx.lineTo(ax, view.height); }
    ctx.stroke();

    // 눈금 숫자
    ctx.fillStyle = c.text;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const labelY = Math.min(Math.max(ay + 4, 4), view.height - 16);
    for (const v of tx.values) {
      if (v === 0) continue;
      ctx.fillText(formatTick(v, tx.step), view.toPxX(v), labelY);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const labelX = Math.min(Math.max(ax - 6, 30), view.width - 4);
    for (const v of ty.values) {
      if (v === 0) continue;
      ctx.fillText(formatTick(v, ty.step), labelX, view.toPxY(v));
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('0', Math.min(Math.max(ax - 5, 12), view.width - 4), labelY);
  }

  drawPolylines(lines, color, width = 2, dash = null) {
    const { ctx, view } = this;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (dash) ctx.setLineDash(dash);
    const yLo = -1e4, yHi = view.height + 1e4;
    for (const line of lines) {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < line.length; i += 2) {
        const px = view.toPxX(line[i]);
        const py = view.toPxY(line[i + 1]);
        if (!isFinite(px) || !isFinite(py) || py < yLo || py > yHi) { pen = false; continue; }
        if (!pen) { ctx.moveTo(px, py); pen = true; } else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 고립해(점열)는 눈에 띄게 — 흰 테두리를 두른 원으로 */
  drawPoints(points, color, radius = 4.5, opts = {}) {
    const { ctx, view } = this;
    const c = this.colors();
    ctx.save();
    for (const p of points) {
      const px = view.toPxX(p[0]);
      const py = view.toPxY(p[1]);
      if (px < -20 || px > view.width + 20 || py < -20 || py > view.height + 20) continue;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fillStyle = opts.hollow ? c.bg : color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = opts.hollow ? color : c.pointRing;
      ctx.stroke();
    }
    ctx.restore();
  }

  drawLabels(items, color) {
    const { ctx, view } = this;
    ctx.save();
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    for (const { x, y, text } of items) {
      const px = view.toPxX(x), py = view.toPxY(y);
      if (px < -50 || px > view.width + 50 || py < -20 || py > view.height + 20) continue;
      const w = ctx.measureText(text).width;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = this.colors().bg;
      ctx.fillRect(px + 6, py - 15, w + 6, 14);
      ctx.restore();
      ctx.fillStyle = color;
      ctx.fillText(text, px + 9, py - 3);
    }
    ctx.restore();
  }

  /** 부등식 영역을 반투명하게 칠한다 */
  drawMask(maskInfo, color, bounds) {
    const { ctx, view } = this;
    const { mask, cols, rows } = maskInfo;
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    const w = (bounds.xmax - bounds.xmin) / cols;
    const h = (bounds.ymax - bounds.ymin) / rows;
    for (let j = 0; j < rows; j++) {
      let run = -1;
      for (let i = 0; i <= cols; i++) {
        const on = i < cols && mask[j * cols + i];
        if (on && run < 0) run = i;
        if (!on && run >= 0) {
          const x0 = view.toPxX(bounds.xmin + run * w);
          const x1 = view.toPxX(bounds.xmin + i * w);
          const y0 = view.toPxY(bounds.ymin + (j + 1) * h);
          const y1 = view.toPxY(bounds.ymin + j * h);
          ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
          run = -1;
        }
      }
    }
    ctx.restore();
  }

  drawCrosshair(px, py, text) {
    const { ctx, view } = this;
    const c = this.colors();
    ctx.save();
    ctx.strokeStyle = c.axis;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px, 0); ctx.lineTo(px, view.height);
    ctx.moveTo(0, py); ctx.lineTo(view.width, py);
    ctx.stroke();
    ctx.restore();
    if (text) {
      ctx.save();
      ctx.font = '12px ui-monospace, monospace';
      const w = ctx.measureText(text).width + 12;
      const bx = Math.min(px + 10, view.width - w - 4);
      const by = Math.max(py - 30, 4);
      ctx.fillStyle = c.bg;
      ctx.globalAlpha = 0.92;
      ctx.fillRect(bx, by, w, 22);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.grid;
      ctx.strokeRect(bx, by, w, 22);
      ctx.fillStyle = c.text;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bx + 6, by + 12);
      ctx.restore();
    }
  }
}

function subTicks(t, min, max) {
  const step = t.step / 5;
  const out = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max; v += step) out.push(v);
  return out.length < 400 ? out : [];
}
