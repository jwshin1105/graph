"""그래프 화면 — 좌표축, 눈금, 그리고 그려진 것들.

점열은 점으로, 곡선은 선으로 그린다. 그 구분은 여기서 정하는 것이 아니라
수학 층이 정해 준 것을 따를 뿐이다.
"""

from __future__ import annotations

import math

import numpy as np
from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (QBrush, QColor, QImage, QPainter, QPainterPath,
                           QPen, QPixmap)
from PySide6.QtWidgets import QWidget

from .theme import math_font, theme

RADIUS = 20        # 카드 모서리 — 그 안쪽으로만 그린다


def nice_step(span, target=8):
    """1, 2, 5 × 10ⁿ 가운데 눈금 간격을 고른다."""
    if span <= 0 or not math.isfinite(span):
        return 1.0
    raw = span / max(1, target)
    e = math.floor(math.log10(raw))
    base = 10 ** e
    for m in (1, 2, 5, 10):
        if raw <= m * base:
            return m * base
    return 10 * base


def fmt_tick(v, step):
    if abs(v) < step * 1e-6:
        return "0"
    d = max(0, -int(math.floor(math.log10(step))) + (1 if step < 1 else 0))
    s = f"{v:.{d}f}".rstrip("0").rstrip(".") if d else f"{v:.0f}"
    return s.replace("-", "−")


class GraphCanvas(QWidget):
    view_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setMinimumSize(420, 320)
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.view = [-10.0, 10.0, -6.5, 6.5]
        self.drawings = []
        self._drag = None
        self._cursor = None

    # ── 좌표 옮기기
    def to_px(self, x, y):
        x0, x1, y0, y1 = self.view
        w, h = self.width(), self.height()
        return ((x - x0) / (x1 - x0) * w, h - (y - y0) / (y1 - y0) * h)

    def to_world(self, px, py):
        x0, x1, y0, y1 = self.view
        w, h = self.width(), self.height()
        return (x0 + px / w * (x1 - x0), y0 + (h - py) / h * (y1 - y0))

    def set_drawings(self, drawings):
        self.drawings = drawings
        self.update()

    def keep_aspect(self):
        """가로세로 비율을 맞춰 원이 찌그러지지 않게 한다."""
        x0, x1, y0, y1 = self.view
        w, h = max(1, self.width()), max(1, self.height())
        cy = (y0 + y1) / 2
        half = (x1 - x0) / 2 * h / w
        self.view[2], self.view[3] = cy - half, cy + half

    def resizeEvent(self, e):
        self.keep_aspect()
        super().resizeEvent(e)
        self.view_changed.emit()

    # ── 조작
    def wheelEvent(self, e):
        k = 0.8 if e.angleDelta().y() > 0 else 1.25
        wx, wy = self.to_world(e.position().x(), e.position().y())
        x0, x1, y0, y1 = self.view
        self.view = [wx + (x0 - wx) * k, wx + (x1 - wx) * k,
                     wy + (y0 - wy) * k, wy + (y1 - wy) * k]
        self.update()
        self.view_changed.emit()

    def mousePressEvent(self, e):
        if e.button() == Qt.LeftButton:
            self._drag = (e.position().x(), e.position().y(), list(self.view))

    def mouseMoveEvent(self, e):
        self._cursor = (e.position().x(), e.position().y())
        if self._drag:
            px, py, v = self._drag
            dx = (e.position().x() - px) / max(1, self.width()) * (v[1] - v[0])
            dy = (e.position().y() - py) / max(1, self.height()) * (v[3] - v[2])
            self.view = [v[0] - dx, v[1] - dx, v[2] + dy, v[3] + dy]
        self.update()

    def mouseReleaseEvent(self, e):
        if self._drag:
            self._drag = None
            self.view_changed.emit()

    def leaveEvent(self, e):
        self._cursor = None
        self.update()

    def reset_view(self):
        self.view = [-10.0, 10.0, -6.5, 6.5]
        self.keep_aspect()
        self.update()
        self.view_changed.emit()

    # ── 화면 밖으로 알려 주는 것
    def range_text(self) -> str:
        x0, x1 = self.view[0], self.view[1]
        step = nice_step(x1 - x0)
        return f"x ∈ [{fmt_tick(x0, step)}, {fmt_tick(x1, step)}]"

    def span_text(self) -> str:
        step = nice_step(self.view[1] - self.view[0])
        return f"1칸 = {fmt_tick(step, step)}"

    def zoom(self, k: float) -> None:
        """가운데를 잡고 확대·축소한다 (단추로 눌렀을 때)."""
        x0, x1, y0, y1 = self.view
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        self.view = [cx + (x0 - cx) * k, cx + (x1 - cx) * k,
                     cy + (y0 - cy) * k, cy + (y1 - cy) * k]
        self.update()
        self.view_changed.emit()

    # ── 그리기
    def paintEvent(self, e):
        t = theme()
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing, True)
        # 카드 안에 앉아 있으므로 모서리 밖으로 넘치지 않게 오려 낸다
        clip = QPainterPath()
        clip.addRoundedRect(QRectF(self.rect()), RADIUS, RADIUS)
        p.setClipPath(clip)
        p.fillPath(clip, t.q("card"))
        self._grid(p)
        for d in self.drawings:
            self._one(p, d)
        self._readout(p)
        p.end()

    def _grid(self, p):
        t = theme()
        x0, x1, y0, y1 = self.view
        w, h = self.width(), self.height()
        step = nice_step(x1 - x0)
        small = step / 5
        p.setPen(QPen(t.q("grid_fine"), 1))
        for i in range(int(math.floor(x0 / small)), int(math.ceil(x1 / small)) + 1):
            gx = self.to_px(i * small, 0)[0]
            p.drawLine(QPointF(gx, 0), QPointF(gx, h))
        for j in range(int(math.floor(y0 / small)), int(math.ceil(y1 / small)) + 1):
            gy = self.to_px(0, j * small)[1]
            p.drawLine(QPointF(0, gy), QPointF(w, gy))
        p.setPen(QPen(t.q("grid"), 1))
        for i in range(int(math.floor(x0 / step)), int(math.ceil(x1 / step)) + 1):
            gx = self.to_px(i * step, 0)[0]
            p.drawLine(QPointF(gx, 0), QPointF(gx, h))
        for j in range(int(math.floor(y0 / step)), int(math.ceil(y1 / step)) + 1):
            gy = self.to_px(0, j * step)[1]
            p.drawLine(QPointF(0, gy), QPointF(w, gy))

        ax, ay = self.to_px(0, 0)
        p.setPen(QPen(t.q("axis"), 1.2))
        if 0 <= ay <= h:
            p.drawLine(QPointF(0, ay), QPointF(w, ay))
        if 0 <= ax <= w:
            p.drawLine(QPointF(ax, 0), QPointF(ax, h))

        f = math_font(italic=False)
        f.setPixelSize(12)
        p.setFont(f)
        p.setPen(QPen(t.q("tick")))
        ly = min(max(ay + 12, 12), h - 4)
        for i in range(int(math.floor(x0 / step)), int(math.ceil(x1 / step)) + 1):
            if i == 0:
                continue
            gx = self.to_px(i * step, 0)[0]
            gx = min(max(gx, 22), w - 22)          # 가장자리에서 글씨가 잘리지 않게
            p.drawText(QRectF(gx - 40, ly - 10, 80, 14), Qt.AlignCenter, fmt_tick(i * step, step))
        lx = min(max(ax - 6, 4), w - 4)
        for j in range(int(math.floor(y0 / step)), int(math.ceil(y1 / step)) + 1):
            if j == 0:
                continue
            gy = self.to_px(0, j * step)[1]
            p.drawText(QRectF(lx - 84, gy - 8, 80, 16),
                       Qt.AlignRight | Qt.AlignVCenter, fmt_tick(j * step, step))

    def _one(self, p, d):
        t = theme()
        col = QColor(d.color)
        if d.region is not None:
            self._region(p, d, col)
        pen = QPen(col, 2.0)
        pen.setJoinStyle(Qt.RoundJoin)
        pen.setCapStyle(Qt.RoundCap)
        p.setPen(pen)
        for arr in d.paths:
            path = QPainterPath()
            first = True
            for x, y in arr:
                sx, sy = self.to_px(x, y)
                if not (math.isfinite(sx) and math.isfinite(sy)):
                    first = True
                    continue
                if first:
                    path.moveTo(sx, sy)
                    first = False
                else:
                    path.lineTo(sx, sy)
            p.drawPath(path)
        if d.points:
            p.setBrush(QBrush(col))
            p.setPen(QPen(t.q("card"), 1.2))
            r = 4.0 if len(d.points) < 400 else 2.5
            for x, y in d.points:
                sx, sy = self.to_px(x, y)
                if -20 <= sx <= self.width() + 20 and -20 <= sy <= self.height() + 20:
                    p.drawEllipse(QPointF(sx, sy), r, r)
            p.setBrush(Qt.NoBrush)

    def _region(self, p, d, col):
        m = d.region
        if m is None or m.size == 0:
            return
        h, w = m.shape
        rgba = np.zeros((h, w, 4), dtype=np.uint8)
        rgba[..., 0] = col.red()
        rgba[..., 1] = col.green()
        rgba[..., 2] = col.blue()
        rgba[..., 3] = np.where(m, 60, 0).astype(np.uint8)
        rgba = np.ascontiguousarray(rgba[::-1])          # 화면은 위가 y 큰 쪽
        img = QImage(rgba.data, w, h, 4 * w, QImage.Format_RGBA8888).copy()
        p.drawPixmap(self.rect(), QPixmap.fromImage(img))

    def _readout(self, p):
        """손이 가리키는 자리의 좌표. 눈금 간격이 허락하는 자릿수까지만 적는다."""
        if not self._cursor:
            return
        t = theme()
        wx, wy = self.to_world(*self._cursor)
        step = nice_step(self.view[1] - self.view[0])
        d = max(2, -int(math.floor(math.log10(step))) + 2)
        s = f"({wx:.{d}f}, {wy:.{d}f})".replace("-", "−")
        f = math_font(italic=False)
        f.setPixelSize(12)
        p.setFont(f)
        box = QRectF(self.width() - 214, self.height() - 46, 190, 30)
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(t.q("card")))
        p.drawRoundedRect(box, 15, 15)
        p.setPen(QPen(t.q("ink2")))
        p.drawText(box, Qt.AlignCenter, s)
