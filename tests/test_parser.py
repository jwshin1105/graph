"""사람이 적는 표기를 그대로 읽는지."""

import pytest
import sympy

from graphcalc.core.parser import parse
from graphcalc.core.symbols import sym
from graphcalc.core.syntax import Bare, Definition, DomainDecl, ParseError, Relation, Setting

x, y, n, t = sym("x"), sym("y"), sym("n"), sym("t")


def body(src):
    return parse(src).body


def test_소수는_유리수로_읽는다():
    assert body("0.1 + 0.2") == sympy.Rational(3, 10)
    assert body("0.1") == sympy.Rational(1, 10)
    assert body("1.5e-3") == sympy.Rational(15, 10000)


def test_암묵적_곱셈():
    assert body("2x") == 2 * x
    assert body("x y") == x * y
    assert body("1/2x") == x / 2
    assert body("2x²+3") == 2 * x ** 2 + 3


def test_함수_적용():
    assert body("sin 2x") == sympy.sin(2 * x)
    assert body("sin x cos x") == sympy.sin(x) * sympy.cos(x)
    assert body("sin^2 x") == sympy.sin(x) ** 2
    assert body("sqrt(2)^2") == 2


def test_절댓값과_계승():
    assert body("|x-1|") == sympy.Abs(x - 1)
    assert body("5!") == 120


def test_아래첨자는_함수_적용으로():
    st = parse("a_n = 2n-1")
    assert isinstance(st, Definition) and st.subscript
    assert st.name == "a" and st.params == (n,)
    st = parse("a_{n+1} = a_n + 2")
    assert st.params == (n + 1,)


def test_정의역과_조건():
    st = parse("P(n) = (n, n^2), n ∈ Z")
    assert isinstance(st, Definition)
    assert st.domains["n"] is sympy.S.Integers
    assert isinstance(st.body, sympy.Tuple)
    st = parse("n ∈ N")
    assert isinstance(st, DomainDecl) and st.domain is sympy.S.Naturals


def test_점은_조건절과_헷갈리지_않는다():
    st = parse("(3, 4)")
    assert isinstance(st.body, sympy.Tuple) and len(st.body) == 2


def test_관계와_설정():
    st = parse("x^2 + y^2 = 4")
    assert isinstance(st, Relation) and st.op == "="
    st = parse("|x-1| < 2")
    assert isinstance(st, Relation) and st.op == "<"
    st = parse("precision = 60")
    assert isinstance(st, Setting) and st.name == "precision"


def test_in_은_sin_을_망가뜨리지_않는다():
    assert body("sin x") == sympy.sin(x)
    assert body("min(1,2)") == 1


def test_틀린_식은_읽지_못했다고_말한다():
    with pytest.raises(ParseError):
        parse("2 + * 3")
