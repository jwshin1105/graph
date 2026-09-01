"""색과 글꼴을 한곳에 모아 둔다.

색을 쓰는 자리마다 값을 적어 두면 밝은 테마와 어두운 테마를 함께 갖기 어렵고,
같은 뜻의 회색이 조금씩 다른 값으로 흩어진다. 그래서 **뜻으로 이름 붙인 토큰**을
여기서 정하고, 화면 쪽은 그 이름만 부른다.

밝은 테마의 값은 디자인 원본(oklch)을 sRGB 로 옮긴 것이다. 어두운 테마는 그 값을
뒤집은 것이 아니라 같은 말씨로 다시 골랐다 — 그래프의 여덟 색은 흰 바탕에 맞춰
고른 것이라 검은 바탕에서는 가라앉기 때문이다.

수식은 세리프로 앉힌다. 다만 한 벌로는 ∈ 나 ℤ 나 aₙ 의 아래첨자를 다 그리지
못하므로, 세리프 세 벌을 차례로 이어 두고 앞의 것에 없는 글자만 뒤가 그리게 한다.
"""

from __future__ import annotations

from dataclasses import dataclass

from PySide6.QtGui import QColor, QFont, QFontDatabase

from ..resources import asset, exists


@dataclass(frozen=True)
class Theme:
    name: str
    app: str          # 창 바탕
    card: str         # 카드
    row: str          # 카드 안의 줄
    field: str        # 입력칸·고르개
    track: str        # 스테퍼 배경
    divider: str      # 카드 안의 옅은 선
    hover: str        # 누를 수 있는 것 위에 손이 올라갔을 때
    rule: str         # 또렷한 선
    scroll: str
    dot_empty: str    # 아직 색이 없는 점
    axis: str
    grid: str
    grid_fine: str
    tick: str
    caret: str
    ink5: str         # 가장 흐린 글자
    ink4: str
    ink3: str
    label: str        # 섹션 이름표
    ink2: str
    ink: str          # 가장 진한 글자
    accent: str
    on_accent: str
    plot: tuple
    fact_bg: str
    fact_fg: str
    hyp_bg: str
    hyp_fg: str
    bad_bg: str
    bad_fg: str
    quiet_bg: str
    quiet_fg: str
    shadow: tuple     # (r, g, b, a)

    def q(self, key: str) -> QColor:
        return QColor(getattr(self, key))


# 디자인 원본의 oklch 값을 sRGB 로 옮긴 것 (주석은 원본 표기)
LIGHT = Theme(
    name="light",
    app="#f9fafb",        # oklch(0.985 0.002 260)
    card="#ffffff",
    row="#f5f7f9",        # oklch(0.975 0.003 260)
    field="#f4f6f8",      # oklch(0.972 0.003 260)
    track="#f2f3f5",      # oklch(0.965 0.003 260)
    divider="#eff0f2",    # oklch(0.955 0.003 260)
    hover="#edeef1",      # oklch(0.95  0.004 260)
    rule="#e6e8ea",       # oklch(0.93  0.004 260)
    scroll="#dcdee1",     # oklch(0.90  0.005 260)
    dot_empty="#d5d8db",  # oklch(0.88  0.006 260)
    axis="#bbbec3",       # oklch(0.80  0.008 262)
    grid="#ecedef",       # oklch(0.945 0.003 260)
    grid_fine="#f6f7f8",  # oklch(0.975 0.002 260)
    tick="#82868e",       # oklch(0.62  0.012 262)
    caret="#aaaeb4",      # oklch(0.75  0.010 262)
    ink5="#9b9fa5",       # oklch(0.70  0.010 262)
    ink4="#8e929a",       # oklch(0.66  0.012 262)
    ink3="#7c8088",       # oklch(0.60  0.012 262)
    label="#767a82",      # oklch(0.58  0.012 262)
    ink2="#494d56",       # oklch(0.42  0.015 262)
    ink="#252930",        # oklch(0.28  0.015 262)
    accent="#4369a2",     # oklch(0.52  0.10  258)
    on_accent="#ffffff",
    plot=("#c74440", "#2d70b3", "#388c46", "#6042a6",
          "#fa7e19", "#3e434b", "#b8389c", "#0f9b8e"),
    fact_bg="#e8f1ea", fact_fg="#1d6b3d",
    hyp_bg="#fbf0e3", hyp_fg="#8f5418",
    bad_bg="#fbe9e9", bad_fg="#a02b2b",
    quiet_bg="#f2f3f5", quiet_fg="#767a82",
    shadow=(30, 40, 70, 30),
)

DARK = Theme(
    name="dark",
    app="#101318",
    card="#171b22",
    row="#1c212a",
    field="#1e2430",
    track="#1e2430",
    divider="#242a34",
    hover="#262d38",
    rule="#2a313c",
    scroll="#333b47",
    dot_empty="#3a424e",
    axis="#5b6472",
    grid="#232a34",
    grid_fine="#1b2028",
    tick="#98a1ae",
    caret="#6b7481",
    ink5="#7d8794",
    ink4="#8b94a1",
    ink3="#a3acb8",
    label="#98a1ae",
    ink2="#c3cad4",
    ink="#e7ebf1",
    accent="#7aa5e0",
    on_accent="#0e1116",
    plot=("#e56a66", "#5b9ede", "#5cb371", "#9b83d6",
          "#ffa14f", "#d6dde4", "#e069c4", "#3fc4b5"),
    fact_bg="#152a1d", fact_fg="#79cf99",
    hyp_bg="#2c2317", hyp_fg="#dda469",
    bad_bg="#2c1a1a", bad_fg="#e08b8b",
    quiet_bg="#232a34", quiet_fg="#98a1ae",
    shadow=(0, 0, 0, 110),
)

THEMES = {"light": LIGHT, "dark": DARK}
_current = LIGHT

# ──────────────────────────────────────────────────────────── 글꼴

_SERIF = ["Source Serif 4", "STIX Two Text", "DejaVu Serif",
          "Iowan Old Style", "Georgia", "Times New Roman", "serif"]
_MONO = ["IBM Plex Mono", "DejaVu Sans Mono", "Consolas", "Menlo", "monospace"]
_UI = ["Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Nanum Gothic"]

_BUNDLED = ("SourceSerif4-Regular.ttf", "SourceSerif4-Italic.ttf",
            "SourceSerif4-SemiBold.ttf", "STIXTwoText-Regular.ttf",
            "STIXTwoText-Italic.ttf", "DejaVuSerif.ttf",
            "IBMPlexMono-Regular.ttf", "IBMPlexMono-Medium.ttf")


def load_fonts() -> list[str]:
    """함께 넣어 둔 글꼴을 등록한다. 없으면 시스템 글꼴로 물러선다."""
    loaded = []
    for f in _BUNDLED:
        if exists("fonts", f):
            i = QFontDatabase.addApplicationFont(str(asset("fonts", f)))
            loaded += QFontDatabase.applicationFontFamilies(i)
    return loaded


def _font(families: list[str], size: float, weight=QFont.Normal, italic=False) -> QFont:
    f = QFont()
    f.setFamilies(families)          # 앞에 없는 글자는 뒤가 그린다
    f.setPointSizeF(size)
    f.setWeight(weight)
    f.setItalic(italic)
    return f


def math_font(size: float = 15, *, italic: bool = True, weight=QFont.Normal) -> QFont:
    """수식과 값 — 세리프. 변수는 기울여 쓰는 것이 수학의 관례다."""
    return _font(_SERIF, size, weight, italic)


def mono_font(size: float = 11, weight=QFont.Normal) -> QFont:
    """자리를 맞춰야 하는 수 — 자릿수, 오차, 좌표."""
    return _font(_MONO, size, weight)


def ui_font(size: float = 10, weight=QFont.Normal) -> QFont:
    """한글이 섞인 본문. 한글 글꼴은 시스템 것을 따른다."""
    f = QFont()
    f.setFamilies(_UI + [QFont().defaultFamily()])
    f.setPointSizeF(size)
    f.setWeight(weight)
    return f


def serif_css() -> str:
    return ", ".join(f"'{n}'" for n in _SERIF)


def mono_css() -> str:
    return ", ".join(f"'{n}'" for n in _MONO)


def ui_css() -> str:
    return ", ".join(f"'{n}'" for n in _UI) + ", system-ui, sans-serif"


# ──────────────────────────────────────────────────────────── 고르기

def theme() -> Theme:
    return _current


def set_theme(name: str) -> Theme:
    global _current
    _current = THEMES.get(name, LIGHT)
    return _current


def toggle_theme() -> Theme:
    return set_theme("dark" if _current.name == "light" else "light")


# ──────────────────────────────────────────────────────────── 스타일시트

def qss(t: Theme | None = None) -> str:
    t = t or _current
    return f"""
    QWidget {{ color: {t.ink}; }}
    QMainWindow, #page {{ background: {t.app}; }}
    #card {{ background: {t.card}; border-radius: 20px; }}
    #row {{ background: transparent; border-radius: 16px; }}
    #row:hover {{ background: {t.row}; }}
    #row[picked="true"] {{ background: {t.row}; }}
    #field {{ background: {t.field}; border-radius: 14px; }}
    #track {{ background: {t.track}; border-radius: 14px; }}
    #label {{ color: {t.label}; font-weight: 700; letter-spacing: 1.2px; }}
    #hint {{ color: {t.ink4}; }}
    #muted {{ color: {t.ink3}; }}

    QLineEdit {{ background: transparent; border: none; color: {t.ink};
                 selection-background-color: {t.accent}; selection-color: {t.on_accent}; }}
    QLineEdit[state="error"] {{ color: {t.bad_fg}; }}
    QLineEdit[state="off"] {{ color: {t.ink5}; }}

    QPushButton {{ background: transparent; border: none; border-radius: 999px;
                   color: {t.ink2}; }}
    QPushButton:hover {{ background: {t.hover}; }}
    QPushButton:disabled {{ color: {t.axis}; background: transparent; }}
    QPushButton#pill {{ background: {t.track}; padding: 5px 14px; color: {t.ink2}; }}
    QPushButton#pill:hover {{ background: {t.hover}; }}
    QPushButton#stepper {{ background: transparent; color: {t.ink2}; }}
    QPushButton#stepper:hover {{ background: {t.card}; }}

    QComboBox {{ background: {t.field}; border: none; border-radius: 14px;
                 padding: 9px 14px; color: {t.ink}; }}
    QComboBox::drop-down {{ border: none; width: 22px; }}
    QComboBox QAbstractItemView {{ background: {t.card}; border: 1px solid {t.rule};
                                   border-radius: 12px; padding: 6px;
                                   selection-background-color: {t.row};
                                   selection-color: {t.ink}; outline: none; }}

    QCheckBox {{ spacing: 0; }}
    QCheckBox::indicator {{ width: 10px; height: 10px; border-radius: 5px;
                            background: {t.dot_empty}; border: none; }}

    QTextBrowser {{ background: {t.card}; border: none; }}
    QScrollArea {{ background: transparent; border: none; }}
    QScrollArea > QWidget > QWidget {{ background: transparent; }}

    QScrollBar:vertical {{ background: transparent; width: 10px; margin: 2px; }}
    QScrollBar::handle:vertical {{ background: {t.scroll}; border-radius: 5px; min-height: 30px; }}
    QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
    QScrollBar::add-page, QScrollBar::sub-page {{ background: transparent; }}

    QToolTip {{ background: {t.ink}; color: {t.card}; border: none;
                padding: 5px 8px; border-radius: 6px; }}
    """


def report_css(t: Theme | None = None) -> str:
    """분석 보고서(HTML)의 css — 화면 쪽과 같은 토큰을 쓴다."""
    t = t or _current
    return f"""
<style>
 body {{ font-family: {ui_css()}; font-size: 12.5px; color: {t.ink};
        line-height: 1.72; background: {t.card}; margin: 0; }}
 .m {{ font-family: {serif_css()}; font-size: 14.5px; font-style: italic; }}
 .sec {{ font-size: 11px; letter-spacing: 1.2px; font-weight: 700;
        margin: 20px 0 9px; color: {t.label}; }}
 .sec.fact {{ color: {t.fact_fg}; }}
 .sec.hyp {{ color: {t.hyp_fg}; }}
 .kind {{ color: {t.ink3}; font-size: 12px; margin: 0 0 2px; }}
 .item {{ margin: 0 0 13px; }}
 .badge {{ font-size: 10px; font-weight: 700; }}
 .b-fact {{ background: {t.fact_bg}; color: {t.fact_fg}; }}
 .b-hyp  {{ background: {t.hyp_bg}; color: {t.hyp_fg}; }}
 .b-bad  {{ background: {t.bad_bg}; color: {t.bad_fg}; }}
 .b-none {{ background: {t.quiet_bg}; color: {t.quiet_fg}; }}
 .detail {{ color: {t.ink2}; font-size: 12px; margin: 4px 0 0; }}
 .check {{ font-size: 11.5px; margin: 5px 0 0; }}
 .ok {{ color: {t.fact_fg}; }}
 .partial {{ color: {t.bad_fg}; }}
 .unchecked {{ color: {t.ink4}; }}
 .how {{ color: {t.ink3}; font-size: 11.5px; margin: 6px 0 0;
        background: {t.row}; border-radius: 12px; padding: 9px 12px; }}
 table {{ border-collapse: separate; border-spacing: 0; margin: 6px 0 12px;
         font-family: {serif_css()}; font-size: 13px; }}
 th, td {{ padding: 5px 9px; text-align: right; color: {t.ink};
          border-bottom: 1px solid {t.divider}; }}
 th {{ color: {t.ink3}; font-weight: 400; font-size: 12px;
      border-bottom: 1px solid {t.rule}; }}
 td.h, th.h {{ text-align: left; color: {t.ink3}; font-style: normal; }}
 .note {{ color: {t.ink3}; font-size: 11.5px; margin: 10px 0;
         background: {t.row}; border-radius: 12px; padding: 10px 12px; }}
 .empty {{ color: {t.ink4}; }}
</style>
"""
