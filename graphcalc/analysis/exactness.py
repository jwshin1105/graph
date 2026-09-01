"""0 인지 아닌지를 빠르고 정확하게 가르고, 식을 값 그대로 짧게 만든다.

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
from sympy.functions.elementary.hyperbolic import HyperbolicFunction
from sympy.functions.elementary.trigonometric import TrigonometricFunction

_GUARD = 30
_cache: dict = {}
_short: dict = {}


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
        # 여기서부터는 기호로 증명해야 한다. 싼 길부터 밟는다.
        #
        # cos·sin 을 지수꼴로 바꿔 펴기만 해도 삼각함수 항등식은 저절로 풀린다.
        # cos 4 − cos 1 cos 3 + sin 1 sin 3 = 0 을 밝히는 데 sympy.simplify 는
        # 0.16초가 들지만 expand(rewrite(exp)) 는 0.003초면 된다. 쉰 배 차이다.
        # 그러면서도 어림이 아니라 **증명** 이다.
        ok = False
        for route in (sympy.expand,
                      lambda z: sympy.expand(z.rewrite(sympy.exp)),
                      lambda z: sympy.simplify(sympy.expand_trig(sympy.expand(z))),
                      lambda z: sympy.simplify(z.rewrite(sympy.exp))):
            try:
                if route(e) == 0:
                    ok = True
                    break
            except Exception:
                continue
        if len(_cache) > 50000:
            _cache.clear()
        _cache[key] = ok
        return ok
    try:
        return sympy.simplify(e) == 0
    except Exception:
        return False


def probably_zero(expr, dps: int = _GUARD) -> bool:
    """수치로만 본 판정 — **거르는 데만** 쓴다.

    "0 이 아니다" 는 이것만으로도 틀릴 일이 없다. 반대로 "0 이다" 는 아직
    증거일 뿐이므로, 이 함수의 참을 결론으로 삼아서는 안 된다. 비싼 증명에
    들어가기 전에 가망 없는 후보를 쳐내는 데 쓴다.
    """
    e = sympy.sympify(expr)
    if e == 0:
        return True
    if not e.is_number:
        return True
    try:
        return abs(complex(sympy.N(e, dps))) <= 10.0 ** (-dps // 2)
    except Exception:
        return True


def same(a, b) -> bool:
    return is_zero(sympy.sympify(a) - sympy.sympify(b))


def all_same(values) -> bool:
    if len(values) < 2:
        return True
    first = values[0]
    return all(same(v, first) for v in values[1:])


def light(e):
    """가볍게만 정리한다.

    cos 2 − cos 1 같은 식은 그대로 두어도 읽을 만하고, 값도 정확하다.
    여기에 sympy.simplify 를 부르면 삼각함수 항등식을 죄다 훑느라 백 배쯤
    느려진다. 비교는 is_zero 가 수치로 먼저 걸러 주므로 굳이 정리할 까닭이 없다.

    나눗셈이 없으면 cancel 도 부르지 않는다. 약분할 것이 없는 식에 대고
    약분을 시키면 인수분해까지 들어가 공연히 느려진다.
    """
    x = sympy.sympify(e)
    if x.is_Atom or x.is_Rational:
        return x
    try:
        x = sympy.expand(x)
        return sympy.cancel(x) if _has_division(x) else x
    except Exception:
        return x


def _has_division(x) -> bool:
    return any(getattr(q.exp, "is_negative", False) for q in x.atoms(sympy.Pow))


def shorten(e):
    """값은 그대로 두고 식만 짧게. 싼 길부터 밟고, 한 번 눈에 띄게 줄면 멈춘다.

    "짧아졌으니 됐다" 로 멈추면 안 된다. sin 2/(2 sin 1) 은 항이 넷뿐이지만
    실은 cos 1 이다. 그래서 **줄어든 정도** 를 보고 멈춘다 — 절반 아래로
    떨어졌으면 그 길이 통한 것이고, 찔끔 줄었을 뿐이면 아직 덜 풀린 것이다.

    같은 식을 두 번 줄이지 않도록 기억해 둔다. 규칙을 찾다 보면 똑같은 식을
    여러 번 만나게 된다.
    """
    x = sympy.sympify(e)
    if x.is_Atom or x.is_Rational:
        return x
    key = sympy.srepr(x)
    hit = _short.get(key)
    if hit is not None:
        return hit
    trig = x.has(TrigonometricFunction, HyperbolicFunction, sympy.exp)
    routes = ([lambda z: sympy.trigsimp(sympy.expand(z)),
               lambda z: sympy.trigsimp(z, method="fu"),
               lambda z: sympy.simplify(z.rewrite(sympy.exp)),
               sympy.simplify]
              if trig else [sympy.simplify])
    start = sympy.count_ops(x)
    best, best_ops = x, start
    for f in routes:
        try:
            r = f(x)
        except Exception:
            continue
        ops = sympy.count_ops(r)
        if ops >= best_ops:
            continue                       # 이 길로는 줄지 않았다 — 다음 길
        best, best_ops = r, ops
        if best.is_Number or best_ops <= 1 or best_ops * 2 <= start:
            break
    # 한 번 줄인 결과가 또 줄어들기도 한다 — sin2/(2sin1) 처럼.
    # 더 줄지 않을 때까지 되풀이하되, 캐시 덕에 값은 거의 공짜다.
    if best is not x and sympy.count_ops(best) > 1:
        again = shorten(best)
        if sympy.count_ops(again) < best_ops:
            best = again
    if len(_short) > 20000:
        _short.clear()
    _short[key] = best
    return best


# 이름이 둘인 까닭 — 부르는 자리에서 뜻이 다르기 때문이다.
# norm 은 "견주기 전에 꼴을 맞춘다", tidy 는 "화면에 적기 전에 다듬는다".
norm = shorten
tidy = shorten
