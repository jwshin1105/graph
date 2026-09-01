"""화면 층 — 렌더링이 수학 층의 결론을 바꾸지 않는지."""

import numpy as np
import sympy

from graphcalc.analysis.report import analyze
from graphcalc.core.parser import parse_all
from graphcalc.objects.model import Context, build
from graphcalc.ui.canvas import fmt_tick, nice_step
from graphcalc.ui.panel import to_html
from graphcalc.ui.plotting import draw

VIEW = (-6, 6, -6, 6)


def objects(lines):
    ctx = Context()
    return build(parse_all(lines, ctx.names()), ctx)


def test_모든_유형을_그릴_수_있다():
    lines = ["y = x^2 - 3", "x^2 + y^2 = 4", "y > x^2 - 1",
             "P(n) = (n, n^2), n ∈ Z", "a_n = 2n-1", "C(t) = (cos t, sin t)",
             "r = 1 + cos theta", "x^2+y^2=25, x ∈ Z, y ∈ Z", "(3,4)", "[1,4,9,16]",
             "x = y^2"]
    for o in objects(lines):
        d = draw(o, VIEW)
        assert d.paths or d.points or d.region is not None
        assert not d.message or "많아" in d.message


def test_이산인_것은_선으로_잇지_않는다():
    o = objects(["P(n) = (n, sin n), n ∈ Z"])[0]
    d = draw(o, VIEW)
    assert d.points and not d.paths
    assert d.discrete


def test_이으라고_하면_잇는다():
    o = objects(["P(n) = (n, sin n), n ∈ Z, connect"])[0]
    d = draw(o, VIEW)
    assert d.paths and d.points


def test_허용_오차를_바꾸면_점의_수가_달라진다():
    from graphcalc.core.precision import reset_precision, set_precision
    o = objects(["y = sin x"])[0]
    try:
        set_precision(epsilon=1.0)
        coarse = sum(len(p) for p in draw(o, VIEW).paths)
        set_precision(epsilon=0.01)
        fine = sum(len(p) for p in draw(o, VIEW).paths)
    finally:
        reset_precision()
    assert fine > coarse * 1.5


def test_눈금_간격():
    assert nice_step(20) in (2, 2.0, 5, 5.0)
    assert nice_step(0.002) < 0.001 or nice_step(0.002) <= 0.0005
    assert fmt_tick(-5, 1) == "−5"
    assert fmt_tick(0, 1) == "0"


def test_보고서_html():
    o = objects(["P(n) = (n, n^2), n ∈ Z"])[0]
    html = to_html(analyze(o, view=VIEW))
    assert "규칙 후보 · 가설" in html
    assert "확인한 사실" in html
    assert "어떻게 구했나" in html
    assert "y = x²" in html
    assert "<script" not in html


def test_수식만_세리프로_감싼다():
    """한글은 건드리지 않고, 글자는 하나도 잃지 않는다."""
    import html as _h
    import re

    from graphcalc.ui.panel import mathize
    for text in ["모든 점이 x² + y² = 1 을 만족합니다",
                 "정의역 — n ∈ ℤ (정수), n ≥ 1",
                 "본 항이 모두 짝수입니다",
                 "점 14개를 보았습니다 (n = 1‥14)"]:
        out = mathize(text)
        assert _h.unescape(re.sub(r"<[^>]+>", "", out)) == text
    assert "<span class='m'>x² + y² = 1</span>" in mathize("모든 점이 x² + y² = 1 을 만족합니다")
    assert "<span" not in mathize("본 항이 모두 짝수입니다")


def test_테마를_바꿔도_같은_토큰을_쓴다():
    from graphcalc.ui.theme import DARK, LIGHT, qss, report_css
    for t in (LIGHT, DARK):
        assert t.card in qss(t) and t.card in report_css(t)
        assert len(t.plot) == 8
    assert LIGHT.plot != DARK.plot          # 어두운 바탕에서는 다른 짝을 쓴다


def test_보고서는_사실과_가설을_섞지_않는다():
    o = objects(["a_n = n^2"])[0]
    rep = analyze(o)
    assert all(f.kind == "fact" for f in rep.facts)
    assert all(f.kind == "hypothesis" for f in rep.hypotheses)
    assert any("가설" in f.badge() for f in rep.hypotheses)


def test_그리다_막혀도_앱은_살아_있다():
    o = objects(["y = 1/(x - x)"])[0]
    d = draw(o, VIEW)
    assert isinstance(d.paths, list)
