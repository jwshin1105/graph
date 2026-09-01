"""데스크톱 앱 — 식 목록, 그래프, 분석 보고서.

계산과 그리기는 서로 다른 층에 있다. 이 파일은 그 둘을 잇고, 사람이 만질 수 있는
손잡이(정밀도, 허용 오차, 테마)를 붙일 뿐이다. 무거운 분석은 다른 갈래에서 돌려
화면이 멈추지 않게 한다.

화면은 카드 셋이다 — 왼쪽에 적고, 가운데에서 보고, 오른쪽에서 따진다.
"""

from __future__ import annotations

import sys

from PySide6.QtCore import QObject, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QColor, QFont, QIcon
from PySide6.QtWidgets import (QApplication, QComboBox, QFileDialog, QFrame,
                               QGraphicsDropShadowEffect, QHBoxLayout, QLabel,
                               QLineEdit, QMainWindow, QPushButton, QScrollArea,
                               QStackedWidget, QTextBrowser, QVBoxLayout, QWidget)

from ..analysis.finding import Report
from ..analysis.report import analyze
from ..core.parser import parse_all
from ..core.precision import get_precision, set_precision
from ..objects.model import Context, build
from ..resources import asset, exists
from .canvas import GraphCanvas
from .panel import to_html
from .plotting import draw
from .theme import (load_fonts, math_font, mono_font, qss, set_theme, symbol_font,
                    theme, toggle_theme, ui_font)

START = [
    "y = x^2 - 3",
    "x^2 + y^2 = 4",
    "P(n) = (cos n, sin n), n ∈ Z",
    "a_n = 2n - 1",
]

SIDE = 404          # 양옆 카드의 너비 — 디자인 값
GAP = 12
PAD = 20


def card(parent=None) -> QFrame:
    """모서리가 둥글고 그림자가 있는 흰 판."""
    f = QFrame(parent)
    f.setObjectName("card")
    f.setAttribute(Qt.WA_StyledBackground, True)
    return f


def shade(w: QWidget, blur: int = 18, dy: int = 3) -> None:
    e = QGraphicsDropShadowEffect(w)
    e.setBlurRadius(blur)
    e.setOffset(0, dy)
    e.setColor(QColor(*theme().shadow))
    w.setGraphicsEffect(e)


def icon_button(glyph: str, tip: str, size: int = 40, px: int = 16) -> QPushButton:
    b = QPushButton(glyph)
    b.setToolTip(tip)
    b.setFixedSize(size, size)
    b.setCursor(Qt.PointingHandCursor)
    f = symbol_font()          # 시스템 글꼴에 없는 기호는 함께 넣은 글꼴이 그린다
    f.setPixelSize(px)
    b.setFont(f)
    return b


def label(text: str, *, px: int = 13, color: str = "", weight=QFont.Normal,
          spacing: float = 0.0) -> QLabel:
    q = QLabel(text)
    f = ui_font()
    f.setPixelSize(px)
    f.setWeight(weight)
    if spacing:
        f.setLetterSpacing(QFont.AbsoluteSpacing, spacing)
    q.setFont(f)
    if color:
        q.setStyleSheet(f"color: {color};")
    return q


# ─────────────────────────────────────────────────────────────── 식 한 줄

class Row(QWidget):
    changed = Signal()
    removed = Signal(object)
    picked = Signal(object)

    def __init__(self, text: str = "", parent=None):
        super().__init__(parent)
        self.setObjectName("row")
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.visible_wanted = True
        self._color = ""

        lay = QHBoxLayout(self)
        lay.setContentsMargins(14, 12, 10, 12)
        lay.setSpacing(12)

        self.dot = QPushButton()
        self.dot.setFixedSize(10, 10)
        self.dot.setCursor(Qt.PointingHandCursor)
        self.dot.setToolTip("그래프에 그릴지 말지")
        self.dot.clicked.connect(self._toggle)

        self.edit = QLineEdit(text)
        f = math_font()
        f.setPixelSize(20)
        self.edit.setFont(f)
        self.edit.setPlaceholderText("식을 적으세요")
        self.edit.setClearButtonEnabled(False)

        self.kind = label("", px=11)
        self.kind.setAlignment(Qt.AlignRight | Qt.AlignVCenter)

        self.close = icon_button("×", "지우기", 24, 15)
        self.close.setVisible(False)

        lay.addWidget(self.dot)
        lay.addWidget(self.edit, 1)
        lay.addWidget(self.kind)
        lay.addWidget(self.close)

        self.edit.textChanged.connect(self.changed)
        self.edit.cursorPositionChanged.connect(lambda *_: self.picked.emit(self))
        self.close.clicked.connect(lambda: self.removed.emit(self))

    def _toggle(self):
        self.visible_wanted = not self.visible_wanted
        self.paint_dot()
        self.changed.emit()

    def enterEvent(self, e):
        self.close.setVisible(bool(self.edit.text().strip()))
        super().enterEvent(e)

    def leaveEvent(self, e):
        self.close.setVisible(False)
        super().leaveEvent(e)

    def set_color(self, c: str):
        self._color = c
        self.paint_dot()

    def paint_dot(self):
        t = theme()
        c = self._color if (self._color and self.visible_wanted) else t.dot_empty
        ring = "" if self.visible_wanted else f"border: 1.5px solid {t.dot_empty};"
        self.dot.setStyleSheet(
            f"background: {c if self.visible_wanted else 'transparent'};"
            f"border-radius: 5px; {ring}")

    def set_kind(self, text: str, *, error: str = "", note: str = ""):
        t = theme()
        self.kind.setText(text)
        self.kind.setStyleSheet(f"color: {t.bad_fg if error else t.ink4};")
        self.edit.setProperty("state", "error" if error else
                              ("off" if not self.visible_wanted else ""))
        self.edit.style().unpolish(self.edit)
        self.edit.style().polish(self.edit)
        self.setToolTip(error or note)

    def set_picked(self, on: bool):
        self.setProperty("picked", "true" if on else "false")
        self.style().unpolish(self)
        self.style().polish(self)


# ─────────────────────────────────────────────────────────────── 스테퍼

class Stepper(QWidget):
    """− 값 + — 디자인의 알약 모양 조절기."""
    changed = Signal(float)

    def __init__(self, value: float, lo: float, hi: float, step: float,
                 fmt: str = "{:.0f}", parent=None):
        super().__init__(parent)
        self.value, self.lo, self.hi, self.step, self.fmt = value, lo, hi, step, fmt
        box = QFrame()
        box.setObjectName("track")
        box.setAttribute(Qt.WA_StyledBackground, True)
        inner = QHBoxLayout(box)
        inner.setContentsMargins(3, 3, 3, 3)
        inner.setSpacing(2)
        self.minus = icon_button("−", "줄이기", 26, 14)
        self.minus.setObjectName("stepper")
        self.plus = icon_button("+", "늘리기", 26, 15)
        self.plus.setObjectName("stepper")
        self.text = QLabel(fmt.format(value))
        self.text.setAlignment(Qt.AlignCenter)
        self.text.setMinimumWidth(48)
        f = mono_font()
        f.setPixelSize(13)
        self.text.setFont(f)
        inner.addWidget(self.minus)
        inner.addWidget(self.text)
        inner.addWidget(self.plus)
        outer = QHBoxLayout(self)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.addWidget(box)
        self.minus.clicked.connect(lambda: self.nudge(-1))
        self.plus.clicked.connect(lambda: self.nudge(+1))

    def nudge(self, sign: int):
        self.set_value(self.value + sign * self.step)
        self.changed.emit(self.value)

    def set_value(self, v: float, quiet: bool = False):
        self.value = max(self.lo, min(self.hi, round(v, 6)))
        self.text.setText(self.fmt.format(self.value))
        self.minus.setEnabled(self.value > self.lo)
        self.plus.setEnabled(self.value < self.hi)


# ─────────────────────────────────────────────────────────────── 분석 갈래

class Worker(QObject):
    done = Signal(int, object)

    def run(self, token, obj, view):
        try:
            rep = analyze(obj, view=view)
        except Exception as exc:
            rep = Report()
            rep.notes.append(f"분석하다 막혔습니다: {exc}")
        self.done.emit(token, rep)


# ─────────────────────────────────────────────────────────────── 창

class Window(QMainWindow):
    analyse = Signal(int, object, object)

    def __init__(self):
        super().__init__()
        self.setWindowTitle("수학 탐구 계산기")
        self.resize(1440, 900)
        self.setMinimumSize(1040, 640)
        if exists("icons", "graphcalc.png"):
            self.setWindowIcon(QIcon(str(asset("icons", "graphcalc.png"))))

        self.rows: list[Row] = []
        self.objs: list = []
        self.current: Row | None = None
        self._token = 0
        self._cards: list[QWidget] = []

        page = QWidget()
        page.setObjectName("page")
        outer = QVBoxLayout(page)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)
        outer.addWidget(self._header())
        body = QHBoxLayout()
        body.setContentsMargins(PAD, 0, PAD, PAD)
        body.setSpacing(GAP)
        body.addWidget(self._left(), 0)
        body.addWidget(self._graph(), 1)
        body.addWidget(self._right(), 0)
        outer.addLayout(body, 1)
        self.setCentralWidget(page)

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
        self.canvas.view_changed.connect(self._view_moved)

        for t in START:
            self.add_row(t)
        self.canvas.keep_aspect()
        self.apply_theme()
        self.recompute()

    # ── 머리
    def _header(self) -> QWidget:
        bar = QWidget()
        bar.setFixedHeight(64)
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(24, 0, PAD, 0)
        lay.setSpacing(12)

        self.logo = QLabel("f")
        self.logo.setFixedSize(32, 32)
        self.logo.setAlignment(Qt.AlignCenter)
        lf = math_font(italic=True)
        lf.setPixelSize(18)
        self.logo.setFont(lf)

        self.title = label("수학 탐구 계산기", px=17, weight=QFont.Medium)
        lay.addWidget(self.logo)
        lay.addWidget(self.title)
        lay.addStretch(1)

        self.btn_theme = icon_button("◐", "밝기 전환")
        self.btn_png = icon_button("⤓", "그래프를 PNG 로 저장")
        self.btn_theme.clicked.connect(self.flip_theme)
        self.btn_png.clicked.connect(self.save_png)
        lay.addWidget(self.btn_theme)
        lay.addWidget(self.btn_png)
        return bar

    # ── 왼쪽
    def _left(self) -> QWidget:
        col = QWidget()
        col.setFixedWidth(SIDE)
        lay = QVBoxLayout(col)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(GAP)

        listing = card()
        lv = QVBoxLayout(listing)
        lv.setContentsMargins(8, 8, 8, 8)
        lv.setSpacing(0)

        head = QHBoxLayout()
        head.setContentsMargins(14, 10, 6, 8)
        self.lbl_count = label("", px=11)
        head.addWidget(self._section("식"))
        head.addWidget(self.lbl_count)
        head.addStretch(1)
        self.btn_add = icon_button("+", "식 더하기", 30, 17)
        self.btn_add.clicked.connect(lambda: self.add_row(""))
        head.addWidget(self.btn_add)
        lv.addLayout(head)

        self.list_box = QWidget()
        self.list_lay = QVBoxLayout(self.list_box)
        self.list_lay.setContentsMargins(4, 0, 4, 4)
        self.list_lay.setSpacing(6)
        self.list_lay.addStretch(1)
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setWidget(self.list_box)
        scroll.setFrameShape(QFrame.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        lv.addWidget(scroll, 1)

        self.hint1 = QLabel()
        self.hint1.setWordWrap(True)
        self.hint2 = QLabel()
        self.hint2.setWordWrap(True)
        foot = QVBoxLayout()
        foot.setContentsMargins(14, 10, 14, 4)
        foot.setSpacing(6)
        foot.addWidget(self.hint1)
        foot.addWidget(self.hint2)
        lv.addLayout(foot)

        lay.addWidget(listing, 1)
        lay.addWidget(self._precision(), 0)
        self._cards += [listing]
        return col

    def _section(self, text: str) -> QLabel:
        q = QLabel(text)
        q.setObjectName("label")
        f = ui_font()
        f.setPixelSize(11)
        f.setWeight(QFont.Bold)
        f.setLetterSpacing(QFont.AbsoluteSpacing, 1.2)
        q.setFont(f)
        return q

    def _precision(self) -> QWidget:
        box = card()
        lay = QVBoxLayout(box)
        lay.setContentsMargins(16, 14, 16, 16)
        lay.setSpacing(10)

        head = QHBoxLayout()
        head.setSpacing(8)
        head.addWidget(self._section("정밀도"))
        self.lbl_prec = label("계산하는 값과 보여 주는 값은 다릅니다", px=11)
        head.addWidget(self.lbl_prec)
        head.addStretch(1)
        lay.addLayout(head)

        p = get_precision()
        self.sp_internal = Stepper(p.internal, 15, 500, 5)
        self.sp_display = Stepper(p.display, 1, 200, 2)
        self.sp_eps = Stepper(p.epsilon, 0.005, 2.0, 0.02, "{:.3f}")
        self.prec_labels = []
        for text, w, tip in (
                ("계산 자릿수", self.sp_internal, "mpmath 가 쓰는 유효자릿수입니다."),
                ("표시 자릿수", self.sp_display,
                 "화면에만 씁니다. 낮춰도 계산은 흔들리지 않습니다."),
                ("그래프 허용 오차 ε (픽셀)", self.sp_eps,
                 "선분이 실제 곡선에서 이만큼보다 멀어지면 더 잘게 나눕니다.")):
            r = QHBoxLayout()
            r.setSpacing(12)
            lb = label(text, px=13)
            lb.setToolTip(tip)
            self.prec_labels.append(lb)
            r.addWidget(lb, 1)
            r.addWidget(w)
            lay.addLayout(r)
            w.changed.connect(self._precision_changed)
        self._cards.append(box)
        return box

    # ── 가운데
    def _graph(self) -> QWidget:
        box = card()
        self.graph_card = box
        lay = QVBoxLayout(box)
        lay.setContentsMargins(0, 0, 0, 0)
        self.canvas = GraphCanvas()
        lay.addWidget(self.canvas)

        self.zoom_pill = QFrame(box)
        self.zoom_pill.setObjectName("pill")
        self.zoom_pill.setAttribute(Qt.WA_StyledBackground, True)
        zl = QVBoxLayout(self.zoom_pill)
        zl.setContentsMargins(6, 6, 6, 6)
        zl.setSpacing(2)
        self.btn_in = icon_button("+", "확대", 40, 19)
        self.btn_out = icon_button("−", "축소", 40, 17)
        self.sep = QFrame()
        self.sep.setFixedHeight(1)
        self.btn_ratio = icon_button("□", "x·y 축 비율 1:1 로", 40, 15)
        self.btn_home = icon_button("⌂", "화면 처음으로", 40, 15)
        for w in (self.btn_in, self.btn_out, self.sep, self.btn_ratio, self.btn_home):
            zl.addWidget(w)
        self.btn_in.clicked.connect(lambda: self.canvas.zoom(0.8))
        self.btn_out.clicked.connect(lambda: self.canvas.zoom(1.25))
        self.btn_ratio.clicked.connect(self._equal_axes)
        self.btn_home.clicked.connect(self.canvas.reset_view)

        self.range_chip = QFrame(box)
        self.range_chip.setObjectName("pill")
        self.range_chip.setAttribute(Qt.WA_StyledBackground, True)
        rl = QHBoxLayout(self.range_chip)
        rl.setContentsMargins(14, 7, 14, 7)
        rl.setSpacing(8)
        self.lbl_range = QLabel()
        rf = mono_font()
        rf.setPixelSize(12)
        self.lbl_range.setFont(rf)
        self.chip_sep = QFrame()
        self.chip_sep.setFixedWidth(1)
        self.lbl_span = label("", px=11)
        rl.addWidget(self.lbl_range)
        rl.addWidget(self.chip_sep)
        rl.addWidget(self.lbl_span)

        self._cards.append(box)
        return box

    def _equal_axes(self):
        self.canvas.keep_aspect()
        self.canvas.update()
        self.timer.start()

    # ── 오른쪽
    def _right(self) -> QWidget:
        box = card()
        box.setFixedWidth(SIDE)
        lay = QVBoxLayout(box)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.setSpacing(0)

        head = QVBoxLayout()
        head.setContentsMargins(20, 16, 20, 12)
        head.setSpacing(10)
        head.addWidget(self._section("분석"))
        self.picker = QComboBox()
        self.picker.setFont(math_font())
        pf = self.picker.font()
        pf.setPixelSize(15)
        self.picker.setFont(pf)
        self.picker.currentIndexChanged.connect(self._picked)
        head.addWidget(self.picker)
        lay.addLayout(head)

        self.stack = QStackedWidget()
        self.panel = QTextBrowser()
        self.panel.setOpenExternalLinks(False)
        self.panel.setViewportMargins(20, 0, 12, 16)
        # 표가 길어도 가로 막대를 띄우지 않는다 — 앞쪽 열만 보이면 충분하다
        self.panel.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.stack.addWidget(self._empty_state())
        self.stack.addWidget(self.panel)
        lay.addWidget(self.stack, 1)
        self._cards.append(box)
        return box

    def _empty_state(self) -> QWidget:
        w = QWidget()
        lay = QVBoxLayout(w)
        lay.setContentsMargins(36, 24, 36, 60)
        lay.setSpacing(14)
        lay.addStretch(1)
        self.empty_mark = QLabel("?")
        self.empty_mark.setFixedSize(56, 56)
        self.empty_mark.setAlignment(Qt.AlignCenter)
        ef = math_font(italic=True)
        ef.setPixelSize(24)
        self.empty_mark.setFont(ef)
        self.empty_title = label("식을 고르면 분석이 나옵니다", px=14, weight=QFont.Medium)
        self.empty_title.setAlignment(Qt.AlignCenter)
        self.empty_body = label("확인한 사실과 규칙 후보를 갈라 적고,\n"
                                "결론마다 어떻게 구했는지 함께 붙입니다.", px=12)
        self.empty_body.setAlignment(Qt.AlignCenter)
        for x in (self.empty_mark, self.empty_title, self.empty_body):
            lay.addWidget(x, 0, Qt.AlignHCenter)
        lay.addStretch(1)
        return w

    # ── 테마
    def flip_theme(self):
        toggle_theme()
        self.apply_theme()
        self.recompute()

    def apply_theme(self):
        t = theme()
        app = QApplication.instance()
        app.setStyleSheet(qss(t))
        self.logo.setStyleSheet(
            f"background: {t.accent}; color: {t.on_accent}; border-radius: 10px;")
        self.title.setStyleSheet(f"color: {t.ink};")
        self.lbl_count.setStyleSheet(f"color: {t.ink4};")
        self.lbl_prec.setStyleSheet(f"color: {t.ink4};")
        for lb in self.prec_labels:
            lb.setStyleSheet(f"color: {t.ink};")
        self.hint1.setStyleSheet(f"color: {t.ink3}; font-size: 12px;")
        self.hint2.setStyleSheet(f"color: {t.ink4}; font-size: 11px;")
        self.hint1.setText(
            "<span style='font-family:serif;font-size:14px;font-style:italic;"
            f"color:{t.ink2}'>y = f(x) · F(x, y) = 0 · a<sub>n</sub> · P<sub>n</sub></span>"
            " — 무엇으로 읽었는지는 적고 나면 오른쪽에 적힙니다.")
        self.hint2.setText("Enter 로 다음 줄 · 정의역은 "
                           "<span style='font-family:serif;font-style:italic'>n ∈ Z</span> 처럼")
        for b in (self.btn_theme, self.btn_png, self.btn_add):
            b.setStyleSheet(f"color: {t.ink2};")
        pill = (f"#pill {{ background: {t.card}; border-radius: 22px; }}")
        self.zoom_pill.setStyleSheet(pill)
        self.range_chip.setStyleSheet(f"#pill {{ background: {t.card}; border-radius: 18px; }}")
        self.sep.setStyleSheet(f"background: {t.divider};")
        self.chip_sep.setStyleSheet(f"background: {t.divider};")
        self.lbl_range.setStyleSheet(f"color: {t.ink2};")
        self.lbl_span.setStyleSheet(f"color: {t.ink3};")
        self.empty_mark.setStyleSheet(
            f"background: {t.track}; color: {t.ink5}; border-radius: 28px;")
        self.empty_title.setStyleSheet(f"color: {t.ink2};")
        self.empty_body.setStyleSheet(f"color: {t.ink3};")
        self.btn_theme.setText("◑" if t.name == "dark" else "◐")
        for w in self._cards:
            shade(w)
        for r in self.rows:
            r.paint_dot()
        self.canvas.update()
        self._place_floats()

    def save_png(self):
        path, _ = QFileDialog.getSaveFileName(self, "그래프를 PNG 로 저장",
                                              "graph.png", "PNG (*.png)")
        if path:
            self.canvas.grab().save(path)

    # ── 자리 잡기
    def resizeEvent(self, e):
        super().resizeEvent(e)
        self._place_floats()

    def _place_floats(self):
        if not hasattr(self, "zoom_pill"):
            return
        box = self.graph_card
        self.zoom_pill.adjustSize()
        self.zoom_pill.move(box.width() - self.zoom_pill.width() - 16, 16)
        self.range_chip.adjustSize()
        self.range_chip.move(16, box.height() - self.range_chip.height() - 16)

    def _view_moved(self):
        self.lbl_range.setText(self.canvas.range_text())
        self.lbl_span.setText(self.canvas.span_text())
        self._place_floats()
        self.timer.start()

    # ── 줄 다루기
    def add_row(self, text: str = "") -> Row:
        r = Row(text)
        r.changed.connect(lambda: self.timer.start())
        r.removed.connect(self.remove_row)
        r.picked.connect(self._row_picked)
        self.rows.append(r)
        self.list_lay.insertWidget(self.list_lay.count() - 1, r)
        r.paint_dot()
        r.edit.setCursorPosition(0)
        if not text:
            r.edit.setFocus()
        return r

    def remove_row(self, r: Row):
        if r in self.rows:
            self.rows.remove(r)
            r.setParent(None)
            r.deleteLater()
            if self.current is r:
                self.current = None
            self.timer.start()

    def _row_picked(self, r: Row):
        if self.current is r:
            return
        self.current = r
        for other in self.rows:
            other.set_picked(other is r)
        self._sync_picker()
        self._refresh_panel()

    def _sync_picker(self):
        """오른쪽 고르개가 왼쪽에서 고른 줄을 따라가게 한다."""
        if self.current is None:
            return
        i = self.picker.findText(self.current.edit.text().strip())
        if i >= 0 and i != self.picker.currentIndex():
            self.picker.blockSignals(True)
            self.picker.setCurrentIndex(i)
            self.picker.blockSignals(False)

    def _precision_changed(self, *_):
        set_precision(internal=int(self.sp_internal.value),
                      display=int(self.sp_display.value),
                      epsilon=float(self.sp_eps.value))
        p = get_precision()
        self.sp_display.set_value(p.display)
        self.timer.start()

    # ── 다시 계산
    def recompute(self):
        lines = [r.edit.text() for r in self.rows]
        ctx = Context()
        stmts = parse_all(lines, ctx.names())
        for st in stmts:
            if st is not None and not isinstance(st, Exception) \
                    and st.__class__.__name__ == "Setting":
                self._apply_setting(st)
        self.objs = build(stmts, ctx)

        view = tuple(self.canvas.view)
        drawings = []
        alive = 0
        for row, obj in zip(self.rows, self.objs):
            if obj is None:
                row.set_color("")
                row.set_kind("")
                continue
            if obj.kind == "error":
                row.set_color("")
                row.set_kind("읽지 못함", error=obj.message)
                continue
            alive += 1
            row.set_color(obj.color)
            if not (row.visible_wanted and obj.visible):
                row.set_kind(obj.kind_text())
                continue
            d = draw(obj, view, self.canvas.width(), self.canvas.height())
            row.set_kind(obj.kind_text(), note=d.message)
            drawings.append(d)
        self.canvas.set_drawings(drawings)
        self.lbl_count.setText(f"{alive}개" if alive else "")
        self.lbl_range.setText(self.canvas.range_text())
        self.lbl_span.setText(self.canvas.span_text())
        self._fill_picker()
        self._sync_picker()
        self._refresh_panel()

    def _apply_setting(self, st):
        import sympy
        try:
            v = float(sympy.N(st.value))
        except Exception:
            return
        if st.name in ("precision", "정밀도"):
            self.sp_internal.set_value(v)
        elif st.name in ("digits", "자릿수"):
            self.sp_display.set_value(v)
        elif st.name in ("epsilon", "오차"):
            self.sp_eps.set_value(v)
        set_precision(internal=int(self.sp_internal.value),
                      display=int(self.sp_display.value),
                      epsilon=float(self.sp_eps.value))

    def _fill_picker(self):
        cur = self.picker.currentText()
        self.picker.blockSignals(True)
        self.picker.clear()
        for row, obj in zip(self.rows, self.objs):
            if obj is not None and obj.kind != "error" and row.edit.text().strip():
                self.picker.addItem(row.edit.text().strip())
        if self.picker.count() == 0:
            self.picker.addItem("고른 식이 없습니다")
        i = self.picker.findText(cur)
        if i >= 0:
            self.picker.setCurrentIndex(i)
        self.picker.blockSignals(False)

    def _picked(self, i):
        label_ = self.picker.currentText()
        for row in self.rows:
            if row.edit.text().strip() == label_:
                self._row_picked(row)
                return
        self._refresh_panel()

    def _refresh_panel(self):
        obj = None
        if self.current is not None and self.current in self.rows:
            k = self.rows.index(self.current)
            if k < len(self.objs):
                obj = self.objs[k]
        if obj is None:
            wanted = self.picker.currentText()
            for row, o in zip(self.rows, self.objs):
                if o is not None and row.edit.text().strip() == wanted:
                    obj = o
                    break
        if obj is None or obj.kind == "error":
            self.stack.setCurrentIndex(0)
            return
        self._token += 1
        self.stack.setCurrentIndex(1)
        self.panel.setHtml(to_html(None).replace(
            "왼쪽에서 식을 고르면 분석이 나옵니다.", "살펴보는 중입니다…"))
        self.analyse.emit(self._token, obj, tuple(self.canvas.view))

    def _report_ready(self, token, rep):
        if token != self._token:
            return
        self.panel.setHtml(to_html(rep))

    def closeEvent(self, e):
        self.thread.quit()
        self.thread.wait(2000)
        super().closeEvent(e)


def _arg(argv: list[str], flag: str) -> str:
    return next((a.split("=", 1)[1] for a in argv if a.startswith(flag)), "")


def main(argv: list[str] | None = None) -> int:
    argv = sys.argv if argv is None else argv
    # 설치본이 제대로 묶였는지 확인하는 길 — 창을 띄웠다가 스스로 닫고,
    # 원하면 그림도 한 장 남긴다. 사람이 눌러 보지 않아도 빌드를 검사할 수 있다.
    #
    # 윈도우에서 창만 있는 실행 파일은 stdout 이 아예 없다(print 가 소리 없이
    # 사라진다). 그러면 "확인했다" 는 말만 남고 실제로는 아무것도 확인하지 못한다.
    # 그래서 --smoke-out 으로 **파일에** 적는다.
    smoke = "--smoke" in argv or "--smoke-out=" in " ".join(argv)
    shot = _arg(argv, "--screenshot=")
    out = _arg(argv, "--smoke-out=")
    app = QApplication([a for a in argv if not a.startswith("--")])
    app.setStyle("Fusion")
    app.setApplicationName("수학 탐구 계산기")
    app.setApplicationDisplayName("수학 탐구 계산기")
    load_fonts()
    app.setFont(ui_font())
    if exists("icons", "graphcalc.png"):
        app.setWindowIcon(QIcon(str(asset("icons", "graphcalc.png"))))
    set_theme("light")
    w = Window()
    w.show()
    if smoke or shot:
        state = {"bad": 1, "report": "아직 확인하지 못했습니다."}

        def finish():
            try:
                if shot:
                    w.grab().save(shot)
                lines = [f"수학 탐구 계산기 — 식 {len(w.rows)}줄, "
                         f"그린 것 {len(w.canvas.drawings)}개"]
                bad = 0
                for row, d in zip(w.rows, w.canvas.drawings):
                    pieces = sum(len(x) for x in d.paths) + len(d.points)
                    ok = pieces or d.region is not None
                    bad += not ok
                    note = f"  {d.message}" if d.message else ""
                    lines.append(f"  {'·' if ok else '✗'} {row.edit.text():34s}"
                                 f" {row.kind.text():22s} 점·마디 {pieces}{note}")
                lines.append("잘 뜹니다." if not bad
                             else f"{bad}줄이 그려지지 않았습니다.")
                state["bad"], state["report"] = bad, "\n".join(lines)
            except Exception as exc:                # 확인하다 넘어져도 조용히 넘기지 않는다
                state["bad"], state["report"] = 1, f"확인하다 막혔습니다: {exc!r}"
            finally:
                _write(out, state["report"])
                print(state["report"])
                app.quit()

        QTimer.singleShot(6000, finish)
        app.exec()
        return 1 if state["bad"] else 0
    return app.exec()


def _write(path: str, text: str) -> None:
    if not path:
        return
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(text + "\n")
    except Exception:
        pass


if __name__ == "__main__":
    sys.exit(main())
