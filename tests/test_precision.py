"""계산에 쓰는 값과 화면에 보이는 값이 서로 섞이지 않는지."""

import sympy

from graphcalc.core.display import approx, value_text
from graphcalc.core.evaluate import evaluate
from graphcalc.core.precision import get_precision, reset_precision, set_precision


def setup_function(_):
    reset_precision()


def teardown_function(_):
    reset_precision()


def test_표시_자릿수를_줄여도_계산은_그대로다():
    e = sympy.pi
    set_precision(internal=60, display=3)
    short = approx(e)
    set_precision(display=40)
    long = approx(e)
    assert short == "3.14"
    assert long.startswith("3.14159265358979323846264338327950288419")
    # 짧게 보여 준 값이 다음 계산으로 흘러들지 않았다
    assert long[:4] == short[:4]


def test_고정밀_거듭제곱():
    # float64 는 2.7182804690957534 를 준다 — 열 번째 자리부터 틀리다
    set_precision(internal=40, display=20)
    r = evaluate(sympy.Pow(1 + sympy.Rational(1, 10 ** 6), 10 ** 6, evaluate=False))
    assert r.text().startswith("2.7182804693193768")


def test_자릿수_설정_범위():
    p = set_precision(internal=5)       # 아래 한계로 눌린다
    assert p.internal >= 15
    p = set_precision(display=10 ** 6)
    assert p.display <= p.internal
