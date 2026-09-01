"""이산과 연속을 가르는 자리."""

import sympy

from graphcalc.core.domain import Domain, apply_conditions, domain_of, domain_text
from graphcalc.core.symbols import sym

x, n = sym("x"), sym("n")


def test_아무_말_없으면_n_은_정수_x_는_실수():
    assert domain_of("n").discrete
    assert not domain_of("x").discrete
    assert domain_of("n").implied


def test_선언한_정의역이_이긴다():
    d = domain_of("n", {"n": sympy.S.Reals})
    assert not d.discrete


def test_조건으로_범위를_좁힌다():
    d = apply_conditions(domain_of("n"), [sympy.Ge(n, 1), sympy.Le(n, 20)])
    assert d.lo == 1 and d.hi == 20
    assert d.contains(5) and not d.contains(21) and not d.contains(2.5)


def test_자연수의_첫_항():
    assert Domain("n", sympy.S.Naturals).start() == 1
    assert Domain("n", sympy.S.Naturals0).start() == 0


def test_식이_정의되는_곳():
    assert domain_text(sympy.sqrt(x), x) == "[0, ∞)"
    assert "x ≠ 0" not in domain_text(sympy.sqrt(x), x)
    assert "≠" in domain_text(1 / x, x)
