"""0 인지 아닌지를 빠르고 정확하게 가른다.

sympy.simplify 는 정확하지만 느리다. 규칙을 찾는 동안에는 "0 이 아니다" 를
수없이 물어보게 되는데, 그때마다 정리하고 앉아 있을 수는 없다.

그래서 두 걸음으로 나눈다.

  1. 고정밀 수치로 값을 잰다. 0 에서 뚜렷이 멀면 **그것으로 끝** — 0 이 아니다.
  2. 0 에 아주 가까울 때만 기호로 정리해 정말 0 인지 확인한다.

빠른 걸음이 "아니다" 를 말할 때는 틀릴 일이 없고, "그럴지도" 를 말할 때만
느린 걸음이 나선다. 그래서 빠르면서도 결론은 정확하다.
"""

from __future__ import annotations

import sympy

_GUARD = 30
_cache: dict = {}


def is_zero(expr, dps: int = _GUARD) -> bool:
    """식이 정말 0 인가."""
    e = sympy.sympify(expr)
    if e == 0:
        return True
    if e.is_number:
        key = sympy.srepr(e)
        hit = _cache.get(key)
        if hit is not None:
            return hit
        try:
            v = complex(sympy.N(e, dps))
        except Exception:
            v = None
        if v is not None and abs(v) > 10.0 ** (-dps // 2):
            _cache[key] = False
            return False
        try:
            ok = sympy.simplify(sympy.expand_trig(sympy.expand(e))) == 0
        except Exception:
            ok = v is not None and abs(v) < 1e-25
        if len(_cache) > 50000:
            _cache.clear()
        _cache[key] = ok
        return ok
    try:
        return sympy.simplify(e) == 0
    except Exception:
        return False


def same(a, b) -> bool:
    return is_zero(sympy.sympify(a) - sympy.sympify(b))


def all_same(values) -> bool:
    if len(values) < 2:
        return True
    first = values[0]
    return all(same(v, first) for v in values[1:])


def tidy(v):
    """보기 좋은 꼴로. 정리에 실패하면 원래 식 그대로 (틀린 값을 내놓지는 않는다)."""
    best = sympy.sympify(v)
    for f in (sympy.simplify,
              lambda e: sympy.simplify(e.rewrite(sympy.exp)),
              lambda e: sympy.simplify(sympy.trigsimp(e, method="fu"))):
        try:
            c = f(best)
        except Exception:
            continue
        if sympy.count_ops(c) < sympy.count_ops(best):
            best = c
    return best


def light(e):
    """가볍게만 정리한다.

    cos 2 − cos 1 같은 식은 그대로 두어도 읽을 만하고, 값도 정확하다.
    여기에 sympy.simplify 를 부르면 삼각함수 항등식을 죄다 훑느라 백 배쯤
    느려진다. 비교는 is_zero 가 수치로 먼저 걸러 주므로 굳이 정리할 까닭이 없다.
    """
    x = sympy.sympify(e)
    if x.is_Atom or x.is_Rational:
        return x
    try:
        return sympy.cancel(sympy.expand(x))
    except Exception:
        return x
