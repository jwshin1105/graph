"""그림이 실제 곡선에서 얼마나 벗어나는가 — 허용 오차 ε 를 지키는지."""

import numpy as np

from graphcalc.engine.curves import sample_explicit, sample_parametric, sample_polar
from graphcalc.engine.implicit import trace_implicit
from graphcalc.engine.region import area


def total_length(paths):
    return sum(float(np.hypot(np.diff(p[:, 0]), np.diff(p[:, 1])).sum()) for p in paths)


def test_원의_둘레():
    t = trace_implicit(lambda X, Y: X ** 2 + Y ** 2 - 1, (-2, 2, -2, 2))
    assert len(t.paths) == 1                       # 한 조각으로 이어져야 한다
    assert abs(total_length(t.paths) - 2 * np.pi) / (2 * np.pi) < 1e-4


def test_아주_작은_고리도_놓치지_않는다():
    t = trace_implicit(lambda X, Y: X ** 2 + Y ** 2 - 0.0004, (-2, 2, -2, 2))
    assert len(t.paths) == 1
    assert abs(total_length(t.paths) - 2 * np.pi * 0.02) / (2 * np.pi * 0.02) < 0.01


def test_허용_오차를_줄이면_더_정확해진다():
    true = 2 * np.pi
    coarse = trace_implicit(lambda X, Y: X ** 2 + Y ** 2 - 1, (-2, 2, -2, 2), epsilon_px=1.0)
    fine = trace_implicit(lambda X, Y: X ** 2 + Y ** 2 - 1, (-2, 2, -2, 2), epsilon_px=0.01)
    assert abs(total_length(fine.paths) - true) <= abs(total_length(coarse.paths) - true)


def test_가지가_둘인_곡선():
    t = trace_implicit(lambda X, Y: X * Y - 1, (-5, 5, -5, 5))
    assert len(t.paths) == 2
    t = trace_implicit(lambda X, Y: Y ** 2 - X ** 3 + X, (-2, 3, -3, 3))
    assert len(t.paths) == 2


def test_모난_곡선도_정확히():
    t = trace_implicit(lambda X, Y: abs(X) + abs(Y) - 1, (-2, 2, -2, 2))
    assert abs(total_length(t.paths) - 4 * np.sqrt(2)) < 1e-9


def test_함수_그래프의_길이():
    from scipy.integrate import quad
    true = quad(lambda x: np.hypot(1, np.cos(x)), -10, 10, limit=400)[0]
    s = sample_explicit(np.sin, -10, 10, view=(-10, 10, -2, 2))
    assert len(s.paths) == 1
    assert abs(total_length(s.paths) - true) / true < 1e-4
    assert s.evals < 3000                          # 완만한 곳은 촘촘하게 찍지 않는다


def test_잘게_흔들리는_그래프도_한_조각으로():
    s = sample_explicit(lambda x: np.sin(50 * x), -10, 10, view=(-10, 10, -2, 2))
    assert len(s.paths) == 1


def test_끊긴_자리에서는_잇지_않는다():
    assert len(sample_explicit(np.tan, -5, 5, view=(-5, 5, -5, 5)).paths) == 5
    assert len(sample_explicit(lambda x: 1 / x, -5, 5, view=(-5, 5, -5, 5)).paths) == 2
    s = sample_explicit(np.floor, -5, 5, view=(-5, 5, -5, 5))
    assert len(s.paths) == 10
    assert abs(total_length(s.paths) - 10) < 1e-3   # 세로줄이 끼어들지 않았다
    assert len(sample_explicit(np.sign, -5, 5, view=(-5, 5, -2, 2)).paths) == 2


def test_매개변수와_극좌표():
    s = sample_parametric(np.cos, np.sin, 0, 2 * np.pi, view=(-2, 2, -2, 2))
    assert abs(total_length(s.paths) - 2 * np.pi) / (2 * np.pi) < 1e-4
    s = sample_polar(lambda t: 1 + np.cos(t), 0, 2 * np.pi, view=(-1, 3, -2, 2))
    assert abs(total_length(s.paths) - 8) / 8 < 1e-3      # 심장형의 둘레는 8


def test_넓이는_칸을_세지_않는다():
    a, err = area(lambda X, Y: 1 - X ** 2 - Y ** 2, (-2, 2, -2, 2))
    assert abs(a - np.pi) < 1e-3
    assert err < 1e-2 and abs(a - np.pi) <= err * 3      # 오차 가늠이 정직하다
    a, _ = area(lambda X, Y: 1 - abs(X) - abs(Y), (-2, 2, -2, 2))
    assert abs(a - 2.0) < 1e-3


def test_정수해는_풀어서_구한다():
    import sympy
    from graphcalc.core.domain import Domain
    from graphcalc.engine.lattice import integer_solutions
    x, y = sympy.symbols("x y")
    d = {"x": Domain("x", sympy.S.Integers), "y": Domain("y", sympy.S.Integers)}
    sols, _ = integer_solutions(x ** 2 + y ** 2 - 25, x, y, (-6, 6, -6, 6), d)
    assert len(sols) == 12
    assert (sympy.Integer(3), sympy.Integer(4)) in sols
    assert all(int(a) ** 2 + int(b) ** 2 == 25 for a, b in sols)
