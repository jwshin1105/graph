"""한 줄이 무엇인지 가려내는가, 그리고 점열·수열이 정확한 값을 들고 있는가."""

import sympy

from graphcalc.core.parser import parse_all
from graphcalc.core.symbols import sym
from graphcalc.objects.model import Context, build
from graphcalc.objects.pointseq import PointSequence
from graphcalc.objects.sequence import Sequence
from graphcalc.core.domain import Domain

n = sym("n")
a = sympy.Function("a")


def kinds(lines):
    ctx = Context()
    return [(o.kind if o else None) for o in build(parse_all(lines, ctx.names()), ctx)]


def test_객체_유형_가려내기():
    assert kinds(["y = x^2 - 3"]) == ["function"]
    assert kinds(["x^2 + y^2 = 4"]) == ["implicit"]
    assert kinds(["y > x"]) == ["inequality"]
    assert kinds(["P(n) = (n, n^2), n ∈ Z"]) == ["pointseq"]
    assert kinds(["C(t) = (cos t, sin t)"]) == ["parametric"]
    assert kinds(["r = 1 + cos theta"]) == ["polar"]
    assert kinds(["(3, 4)"]) == ["point"]
    assert kinds(["[1,4,9,16]"]) == ["sequence"]
    assert kinds(["x^2+y^2=25, x ∈ Z, y ∈ Z"]) == ["lattice"]
    assert kinds(["2x - 6 = 0"]) == ["equation"]
    assert kinds(["2 + 3*4"]) == ["value"]


def test_이산이면_점_연속이면_곡선():
    ctx = Context()
    objs = build(parse_all(["P(n) = (n, sin n), n ∈ Z", "C(t) = (t, sin t)"], ctx.names()), ctx)
    assert objs[0].discrete and not objs[0].connect
    assert not objs[1].discrete


def test_규칙과_씨앗은_적힌_순서가_아니라_아래첨자로_가른다():
    ctx = Context()
    objs = build(parse_all(["a_{n+1} = a_n + 3", "a_1 = 1"], ctx.names()), ctx)
    seq = objs[0].seq
    assert seq.values(5) == [1, 4, 7, 10, 13]


def test_수열은_정확한_값을_들고_있다():
    s = Sequence(rule=sympy.sqrt(n))
    assert s.term(2) == sympy.sqrt(2)          # 1.4142… 가 아니다
    fib = Sequence(recurrence=a(n) + a(n - 1), shift=1, seeds={1: 1, 2: 1})
    assert fib.values(10) == [1, 1, 2, 3, 5, 8, 13, 21, 34, 55]
    assert sympy.simplify(fib.closed_form().subs(n, 10)) == 55


def test_점열은_보이는_번호만_센다():
    P = PointSequence(x_rule=n, y_rule=n ** 2, domain=Domain("n", sympy.S.Integers))
    lo, hi = P.visible_range((-5, 5, -2, 30))
    assert lo >= -7 and hi <= 7                 # 400번째 항까지 세지 않는다
    pts = P.points(1, 3)
    assert [(k, x, y) for k, x, y in pts] == [(1, 1, 1), (2, 2, 4), (3, 3, 9)]


def test_점열_좌표는_기호로_남는다():
    P = PointSequence(x_rule=sympy.cos(n), y_rule=sympy.sin(n),
                      domain=Domain("n", sympy.S.Integers))
    x, y = P.point(3)
    assert x == sympy.cos(3) and y == sympy.sin(3)
    assert sympy.simplify(x ** 2 + y ** 2) == 1


def test_앞_줄의_정의를_뒷_줄이_쓴다():
    ctx = Context()
    objs = build(parse_all(["f(x) = sin x", "y = f(x) + 1"], ctx.names()), ctx)
    assert objs[1].expr == sympy.sin(sym("x")) + 1
