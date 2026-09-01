"""정확값을 먼저, 안 되면 오차를 관리하는 고정밀로."""

import sympy

from graphcalc.core.evaluate import (derivative, evaluate, integrate_definite, limit,
                                     solve_exact)
from graphcalc.core.precision import reset_precision
from graphcalc.core.symbols import sym

x = sym("x")


def setup_function(_):
    reset_precision()


def test_유리수는_유리수로():
    assert evaluate(sympy.Rational(1, 10) + sympy.Rational(2, 10)).exact == sympy.Rational(3, 10)


def test_근호는_정확히_없어진다():
    assert evaluate(sympy.sqrt(2) ** 2).exact == 2
    assert evaluate(sympy.sin(sympy.pi)).exact == 0


def test_큰_수의_덧셈뺄셈():
    e = sympy.Integer(10) ** 16 + 1 - sympy.Integer(10) ** 16
    assert evaluate(e).exact == 1


def test_정적분은_정확값을_먼저():
    r = integrate_definite(sympy.sqrt(1 - x ** 2), x, -1, 1)
    assert r.is_exact and sympy.simplify(r.exact - sympy.pi / 2) == 0
    r = integrate_definite(x ** 2, x, 0, 1)
    assert r.exact == sympy.Rational(1, 3)


def test_기호로_안_되면_구적법이_오차를_들고_온다():
    r = integrate_definite(sympy.exp(-x ** 2) * sympy.sin(x ** 3), x, 0, 2)
    assert r.method == "quadrature"
    assert 0 < r.error < 1e-20
    assert abs(float(r.value) - 0.19981480773478) < 1e-12


def test_극한():
    assert limit(sympy.sin(x) / x, x, 0).exact == 1
    assert limit((1 + 1 / x) ** x, x, sympy.oo).exact == sympy.E
    r = limit(1 / x, x, 0)
    assert "극한이 없습니다" in r.note


def test_미분은_기호로():
    assert derivative(sympy.sin(x ** 2), x).exact == 2 * x * sympy.cos(x ** 2)
    # 변수는 실수라고 두었으므로 |x| 의 도함수가 sign x 로 깔끔하게 나온다
    assert derivative(sympy.Abs(x), x).exact == sympy.sign(x)


def test_방정식_풀이():
    sols, how = solve_exact(sympy.Eq(x ** 2 - 2, 0), x)
    assert set(sols) == {sympy.sqrt(2), -sympy.sqrt(2)}


def test_오차가_허락하는_자릿수만_적는다():
    from graphcalc.core.evaluate import Result
    import mpmath
    # 값 ±0.001 이면 믿을 수 있는 것은 세 자리뿐이다
    r = Result(value=mpmath.mpf("1.23456789"), error=1e-3, method="numeric")
    assert r.text(12) == "1.23"
    r = Result(value=mpmath.mpf("1.23456789"), error=1e-7, method="numeric")
    assert r.text(12) == "1.234568"
