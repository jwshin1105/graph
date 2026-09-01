"""격자점 해 — 정수 정의역 위에서 방정식을 만족하는 점들.

x² + y² = 25 를 실수에서 풀면 원이지만, x, y ∈ ℤ 로 두면 열두 개의 점이다.
그 열두 점은 **정확히** 구할 수 있어야 한다. 원을 그린 다음 지나가는 정수점을
눈으로 고르는 방식은 경계에서 틀린다.
"""

from __future__ import annotations

import sympy

from ..core.domain import Domain


def integer_solutions(expr, xvar, yvar, view, doms: dict, limit: int = 2000):
    """F(x, y) = 0 의 정수해. x 를 하나씩 넣고 y 를 **정확히** 푼다."""
    x0, x1, y0, y1 = view
    dx: Domain = doms.get(str(xvar))
    dy: Domain = doms.get(str(yvar))
    lo = int(max(sympy.floor(x0), dx.lo if dx and dx.lo is not None else -10**9))
    hi = int(min(sympy.ceiling(x1), dx.hi if dx and dx.hi is not None else 10**9))
    if hi - lo > 20000:
        return [], "x 범위가 너무 넓어 정수해를 다 세지 못했습니다"
    out = []
    for xi in range(lo, hi + 1):
        if dx and not dx.contains(xi):
            continue
        e = sympy.simplify(expr.subs(xvar, xi))
        if e == 0:
            continue                      # y 가 무엇이든 성립 — 선으로 다뤄야 한다
        try:
            sols = sympy.solveset(sympy.Eq(e, 0), yvar, sympy.S.Integers)
        except Exception:
            sols = None
        vals = []
        if isinstance(sols, sympy.FiniteSet):
            vals = list(sols)
        elif sols is not None and sols is not sympy.S.EmptySet:
            try:
                vals = [v for v in sympy.solve(sympy.Eq(e, 0), yvar)
                        if v.is_integer]
            except Exception:
                vals = []
        for v in vals:
            if not v.is_integer:
                continue
            vi = int(v)
            if not (y0 - 1 <= vi <= y1 + 1):
                continue
            if dy and not dy.contains(vi):
                continue
            out.append((sympy.Integer(xi), sympy.Integer(vi)))
            if len(out) >= limit:
                return out, "너무 많아 일부만 보여 줍니다"
    return out, ""


def diophantine_form(expr, xvar, yvar):
    """SymPy 의 디오판토스 풀이로 일반해를 구해 본다 (구할 수 있을 때만)."""
    try:
        sol = sympy.diophantine(expr, syms=(xvar, yvar))
    except Exception:
        return None
    if not sol:
        return None
    return sol
