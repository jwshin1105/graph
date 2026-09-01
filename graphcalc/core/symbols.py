"""변수는 모두 **실수**로 둔다.

SymPy 는 아무 말이 없으면 변수를 복소수로 본다. 그러면 |x| 의 도함수가
re(x)·re′(x)/|x| 같은 모양으로 나오고, √(x²) 도 x 로 줄지 않는다. 이 프로그램은
실수 위의 그래프를 다루므로 처음부터 실수라고 못을 박는다.

한 이름에는 반드시 **같은 기호 객체**를 써야 한다. Symbol('x') 와
Symbol('x', real=True) 는 SymPy 에서 서로 다른 기호라서, 섞어 쓰면 대입이
조용히 실패한다. 그래서 이 모듈 하나만 거쳐 기호를 만든다.
"""

from __future__ import annotations

import sympy

_cache: dict[str, sympy.Symbol] = {}


def sym(name: str) -> sympy.Symbol:
    s = _cache.get(name)
    if s is None:
        s = sympy.Symbol(name, real=True)
        _cache[name] = s
    return s


def syms(names: str):
    return tuple(sym(n) for n in names.split())


X = sym("x")
Y = sym("y")
T = sym("t")
N = sym("n")
R = sym("r")
THETA = sym("theta")
