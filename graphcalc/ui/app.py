"""데스크톱 앱 — 입력 목록, 그래프, 분석 보고서.

계산과 그리기는 서로 다른 층에 있다. 이 파일은 그 둘을 잇고, 사람이 만질 수 있는
손잡이(정밀도, 허용 오차, 이어 그리기)를 붙일 뿐이다. 무거운 분석은 다른 갈래에서
돌려 화면이 멈추지 않게 한다.
"""

from __future__ import annotations

import sys

from PySide6.QtCore import QObject, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QAction, QColor, QFont, QKeySequence, QPalette
from PySide6.QtWidgets import (QApplication, QCheckBox, QComboBox, QDoubleSpinBox,
                               QFrame, QHBoxLayout, QLabel, QLineEdit, QMainWindow,
                               QPushButton, QScrollArea, QSpinBox, QSplitter,
                               QTextBrowser, QVBoxLayout, QWidget)

from ..analysis.report import analyze
from ..core.parser import ParseError, parse_all
from ..core.precision import get_precision, set_precision
from ..objects.model import Context, build
from .canvas import GraphCanvas
from .panel import to_html
from .plotting import draw

START = [
    "y = x^2 - 3",
    "x^2 + y^2 = 4",
    "P(n) = (cos n, sin n), n ∈ Z",
    "a_n = 2n - 1",
]


class Row(QWidget):
    """식 한 줄."""
    changed = Signal()
    removed = Signal(object)
    selected = Signal(object)

    def __init__(self, text="", parent=None):
        super().__init__(parent)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(6, 3, 6, 3)
        lay.setSpacing(6)
        self.swatch = QLabel()
        self.swatch.setFixedSize(10, 22)
        self.show_box = QCheckBox()
        self.show_box.setChecked(True)
        self.show_box.setToolTip("그래프에 그릴지 말지")
        self.edit = QLineEdit(text)
        self.edit.setFont(QFont("DejaVu Sans", 11))
        self.edit.setPlaceholderText("식을 적으세요 —  y = x^2,  P(n) = (n, n^2), n ∈ Z")
        self.kind = QLabel("")
        self.kind.setStyleSheet("color:#7a8794; font-size:11px;")
        self.kind.setMinimumWidth(96)
        self.close = QPushButton("×")
        self.close.setFixedSize(22, 22)
        self.close.setFlat(True)
        for w in (self.swatch, self.show_box, self.edit, self.kind, self.close):
            lay.addWidget(w)
        lay.setStretch(2, 1)
        self.edit.textChanged.connect(self.changed)
        self.show_box.toggled.connect(self.changed)
        self.edit.selectionChanged.connect(lambda: self.selected.emit(self))
        self.edit.cursorPositionChanged.connect(lambda *_: self.selected.emit(self))
        self.close.clicked.connect(lambda: self.removed.emit(self))

    def set_color(self, c):
        self.swatch.setStyleSheet(f"background:{c}; border-radius:3px;")

    def set_kind(self, t, err="", note=""):
        self.kind.setText(t)
        self.edit.setStyleSheet("color:#a02b2b;" if err else "")
        self.edit.setToolTip(err or note)


class Worker(QObject):
    """무거운 분석을 다른 갈래에서."""
    done = Signal(int, object)

    def run(self, token, obj, view):
        try:
            rep = analyze(obj, view=view)
        except Exception as exc:
            from ..analysis.finding import Report, fact
            rep = Report()
            rep.notes.append(f"분석하다 막혔습니다: {exc}")
        self.done.emit(token, rep)


class Window(QMainWindow):
    analyse = Signal(int, object, object)

    def __init__(self):
        super().__init__()
        self.setWindowTitle("수학 탐구 계산기")
        self.resize(1440, 900)
        self.rows: list[Row] = []
        self.objs: list = []
        self.current: Row | None = None
        self._token = 0

        self.canvas = GraphCanvas()
        split = QSplitter(Qt.Horizontal)
        split.addWidget(self._left())
        split.addWidget(self.canvas)
        split.addWidget(self._right())
        split.setSizes([390, 700, 380])
        self.setCentralWidget(split)

        self.thread = QThread(self)
        self.worker = Worker()
        self.worker.moveToThread(self.thread)
        self.analyse.connect(self.worker.run)
        self.worker.done.connect(self._report_ready)
        self.thread.start()

        self.timer = QTimer(self)
        self.timer.setSingleShot(True)
        self.timer.setInterval(180)
        self.timer.timeout.connect(self.recompute)
        self.canvas.view_changed.connect(lambda: self.timer.start())

        for t in START:
            self.add_row(t)
        self.canvas.keep_aspect()
        self.recompute()

    # ── 화면 뼈대
    def _left(self):
        box = QWidget()
        lay = QVBoxLayout(box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        head = QLabel("  식")
        head.setStyleSheet("padding:8px 4px; font-weight:600; color:#33404c;"
                           "border-bottom:1px solid #e3e8ee;")
        lay.addWidget(head)
        self.list_box = QWidget()
        self.list_lay = QVBoxLayout(self.list_box)
        self.list_lay.setContentsMargins(0, 4, 0, 4)
        self.list_lay.setSpacing(2)
        self.list_lay.addStretch(1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(self.list_box)
        scroll.setFrameShape(QFrame.NoFrame)
        lay.addWidget(scroll, 1)
        add = QPushButton("+  식 더하기")
        add.clicked.connect(lambda: self.add_row(""))
        lay.addWidget(add)
        lay.addWidget(self._settings())
        return box

    def _settings(self):
        box = QFrame()
        box.setFrameShape(QFrame.StyledPanel)
        lay = QVBoxLayout(box)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(4)
        title = QLabel("정밀도")
        title.setStyleSheet("font-weight:600; color:#33404c;")
        lay.addWidget(title)

        p = get_precision()
        r1 = QHBoxLayout()
        r1.addWidget(QLabel("계산 자릿수"))
        self.sp_internal = QSpinBox()
        self.sp_internal.setRange(15, 500)
        self.sp_internal.setValue(p.internal)
        self.sp_internal.setToolTip("내부 계산에 쓰는 유효자릿수. 화면 표시와는 따로입니다.")
        r1.addWidget(self.sp_internal)
        lay.addLayout(r1)

        r2 = QHBoxLayout()
        r2.addWidget(QLabel("표시 자릿수"))
        self.sp_display = QSpinBox()
        self.sp_display.setRange(1, 200)
        self.sp_display.setValue(p.display)
        self.sp_display.setToolTip("화면에 적을 유효자릿수. 이 값을 바꿔도 계산은 흔들리지 않습니다.")
        r2.addWidget(self.sp_display)
        lay.addLayout(r2)

        r3 = QHBoxLayout()
        r3.addWidget(QLabel("그래프 허용 오차 ε (픽셀)"))
        self.sp_eps = QDoubleSpinBox()
        self.sp_eps.setRange(0.005, 2.0)
        self.sp_eps.setSingleStep(0.02)
        self.sp_eps.setDecimals(3)
        self.sp_eps.setValue(p.epsilon)
        self.sp_eps.setToolTip("선분이 실제 곡선에서 이만큼보다 멀어지면 더 잘게 나눕니다.")
        r3.addWidget(self.sp_eps)
        lay.addLayout(r3)

        for w in (self.sp_internal, self.sp_display, self.sp_eps):
            w.valueChanged.connect(self._precision_changed)

        b = QPushButton("화면 처음으로")
        b.clicked.connect(self.canvas.reset_view)
        lay.addWidget(b)
        return box

    def _right(self):
        box = QWidget()
        lay = QVBoxLayout(box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)
        top = QHBoxLayout()
        top.setContentsMargins(8, 6, 8, 6)
        top.addWidget(QLabel("분석"))
        self.picker = QComboBox()
        self.picker.currentIndexChanged.connect(self._picked)
        top.addWidget(self.picker, 1)
        holder = QWidget()
        holder.setLayout(top)
        holder.setStyleSheet("border-bottom:1px solid #e3e8ee;")
        lay.addWidget(holder)
        self.panel = QTextBrowser()
        self.panel.setOpenExternalLinks(False)
        lay.addWidget(self.panel, 1)
        return box

    # ── 줄 다루기
    def add_row(self, text=""):
        r = Row(text)
        r.changed.connect(lambda: self.timer.start())
        r.removed.connect(self.remove_row)
        r.selected.connect(self._row_selected)
        self.rows.append(r)
        self.list_lay.insertWidget(self.list_lay.count() - 1, r)
        r.edit.setCursorPosition(0)          # 긴 식도 앞에서부터 보이게
        if not text:
            r.edit.setFocus()
        return r

    def remove_row(self, r):
        if r in self.rows:
            self.rows.remove(r)
            r.setParent(None)
            r.deleteLater()
            if self.current is r:
                self.current = None
            self.timer.start()

    def _row_selected(self, r):
        if self.current is not r:
            self.current = r
            self._refresh_panel()

    def _precision_changed(self):
        set_precision(internal=self.sp_internal.value(),
                      display=self.sp_display.value(),
                      epsilon=self.sp_eps.value())
        self.sp_display.setMaximum(self.sp_internal.value())
        self.timer.start()

    # ── 다시 계산
    def recompute(self):
        lines = [r.edit.text() for r in self.rows]
        ctx = Context()
        stmts = parse_all(lines, ctx.names())
        # 설정 줄이 있으면 먼저 반영한다
        for st in stmts:
            if st is not None and not isinstance(st, Exception) \
                    and st.__class__.__name__ == "Setting":
                self._apply_setting(st)
        self.objs = build(stmts, ctx)

        view = tuple(self.canvas.view)
        drawings = []
        for row, obj in zip(self.rows, self.objs):
            if obj is None:
                row.set_kind("")
                continue
            if obj.kind == "error":
                row.set_kind("읽지 못함", obj.message)
                continue
            row.set_color(obj.color)
            row.set_kind(obj.kind_text())
            if not row.show_box.isChecked() or not obj.visible:
                continue
            d = draw(obj, view, self.canvas.width(), self.canvas.height())
            if d.message:
                # 못 그린 것이 아니라 알려 주는 말은 빨갛게 적지 않는다
                row.set_kind(obj.kind_text(), note=d.message)
            drawings.append(d)
        self.canvas.set_drawings(drawings)
        self._fill_picker()
        self._refresh_panel()

    def _apply_setting(self, st):
        import sympy
        try:
            v = float(sympy.N(st.value))
        except Exception:
            return
        if st.name in ("precision", "정밀도"):
            self.sp_internal.blockSignals(True)
            self.sp_internal.setValue(int(v))
            self.sp_internal.blockSignals(False)
            set_precision(internal=int(v))
        elif st.name in ("digits", "자릿수"):
            self.sp_display.blockSignals(True)
            self.sp_display.setValue(int(v))
            self.sp_display.blockSignals(False)
            set_precision(display=int(v))
        elif st.name in ("epsilon", "오차"):
            self.sp_eps.blockSignals(True)
            self.sp_eps.setValue(v)
            self.sp_eps.blockSignals(False)
            set_precision(epsilon=v)

    def _fill_picker(self):
        cur = self.picker.currentText()
        self.picker.blockSignals(True)
        self.picker.clear()
        for row, obj in zip(self.rows, self.objs):
            if obj is not None and obj.kind != "error" and row.edit.text().strip():
                self.picker.addItem(row.edit.text().strip())
        i = self.picker.findText(cur)
        if i >= 0:
            self.picker.setCurrentIndex(i)
        self.picker.blockSignals(False)

    def _picked(self, i):
        self._refresh_panel(index=i)

    def _refresh_panel(self, index=None):
        obj = None
        if index is None and self.current is not None and self.current in self.rows:
            k = self.rows.index(self.current)
            if k < len(self.objs):
                obj = self.objs[k]
        if obj is None:
            label = self.picker.currentText()
            for row, o in zip(self.rows, self.objs):
                if o is not None and row.edit.text().strip() == label:
                    obj = o
                    break
        if obj is None or obj.kind == "error":
            self.panel.setHtml(to_html(None))
            return
        self._token += 1
        self.panel.setHtml(to_html(None).replace("왼쪽에서 식을 고르면 분석이 나옵니다.",
                                                 "살펴보는 중입니다…"))
        self.analyse.emit(self._token, obj, tuple(self.canvas.view))

    def _report_ready(self, token, rep):
        if token != self._token:
            return                     # 낡은 결과는 버린다
        self.panel.setHtml(to_html(rep))

    def closeEvent(self, e):
        self.thread.quit()
        self.thread.wait(2000)
        super().closeEvent(e)


def main():
    app = QApplication(sys.argv)
    app.setStyle("Fusion")
    w = Window()
    w.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
