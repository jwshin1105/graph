"""함수의 구조 — 영점·극값·점근선·볼록성.

값을 잔뜩 찍어 보고 "여기가 가장 큰 것 같다" 고 말하는 대신, 될 수 있으면
**풀어서** 답한다. f′(x) = 0 을 정확히 풀면 극값의 위치가 √3/3 처럼 정확한 식으로
나온다. 풀 수 없을 때만 수치로 내려가고, 그때는 그렇게 구했다고 밝힌다.
"""

from __future__ import annotations

import sympy

from ..core.display import pretty, set_text
from ..core.domain import domain_text, natural_domain, singularities
from .finding import Report, fact, guess

LIMIT_ROOTS = 12


def analyze_function(expr, var, *, view=None, title="f(x)") -> Report:
    rep = Report(kind="function", title=title)
    x = var
    rep.domain = domain_text(expr, x)
    rep.add(fact(f"정의역 — {rep.domain}", weight=100,
                 derivation="식이 실수로 정의되는 곳을 SymPy 로 구했습니다."))

    _parity(rep, expr, x)
    _period(rep, expr, x)
    _roots(rep, expr, x, view)
    _extrema(rep, expr, x, view)
    _inflection(rep, expr, x, view)
    _asymptotes(rep, expr, x)
    _calculus(rep, expr, x)
    return rep


def _parity(rep, e, x):
    try:
        even = sympy.simplify(e.subs(x, -x) - e) == 0
        odd = sympy.simplify(e.subs(x, -x) + e) == 0
    except Exception:
        return
    if even:
        rep.add(fact("우함수입니다 — f(−x) = f(x), y축에 대해 대칭", weight=70,
                     derivation="f(−x) − f(x) 를 기호로 정리하니 0 이었습니다."))
    elif odd:
        rep.add(fact("기함수입니다 — f(−x) = −f(x), 원점에 대해 대칭", weight=70,
                     derivation="f(−x) + f(x) 를 기호로 정리하니 0 이었습니다."))


def _period(rep, e, x):
    try:
        p = sympy.periodicity(e, x)
    except Exception:
        return
    if p is not None and p != 0 and not p.has(sympy.oo):
        rep.add(fact(f"주기함수입니다 — 주기 {pretty(p)}", weight=80,
                     derivation="SymPy 로 주기를 구했습니다."))


def _roots(rep, e, x, view):
    sols, how = _solve_real(e, x)
    if sols == "infinite":
        rep.add(fact("영점 — " + how, weight=90,
                     derivation="f(x) = 0 을 기호로 풀었습니다."))
        return
    if sols is None:
        rep.notes.append("영점을 기호로 풀지 못했습니다.")
        return
    if not sols:
        rep.add(fact("영점이 없습니다 (실수 범위)", weight=85, derivation=how))
        return
    shown = sols[:LIMIT_ROOTS]
    rep.add(fact("영점 — " + ", ".join(f"x = {pretty(s)}" for s in shown)
                 + (" …" if len(sols) > LIMIT_ROOTS else ""),
                 weight=90, derivation=how))


def _solve_real(e, x):
    try:
        s = sympy.solveset(sympy.Eq(e, 0), x, sympy.S.Reals)
    except Exception:
        s = None
    if isinstance(s, sympy.FiniteSet):
        return sorted(s, key=lambda v: float(sympy.re(sympy.N(v)))), \
            "f(x) = 0 을 기호로 정확히 풀었습니다."
    if s is sympy.S.EmptySet:
        return [], "f(x) = 0 을 기호로 풀었더니 실수해가 없었습니다."
    if s is not None and not isinstance(s, sympy.ConditionSet):
        # 무한집합을 늘어놓으려 하면 끝나지 않는다. sin x = 0 의 해는 nπ 다.
        if s.is_finite_set is not True:
            return "infinite", f"해집합이 {set_text(s)} 입니다 — 무한히 많습니다."
        try:
            import itertools
            vals = sorted(itertools.islice(iter(s), LIMIT_ROOTS), key=str)
            return vals, f"해집합이 {set_text(s)} 로 나왔습니다."
        except Exception:
            pass
    return None, ""


def _extrema(rep, e, x, view):
    try:
        d1 = sympy.diff(e, x)
        crit = sympy.solveset(sympy.Eq(d1, 0), x, sympy.S.Reals)
    except Exception:
        return
    if not isinstance(crit, sympy.FiniteSet) or len(crit) == 0:
        if isinstance(crit, sympy.FiniteSet):
            rep.add(fact("f′(x) = 0 인 곳이 없습니다", weight=60,
                         derivation="도함수를 기호로 구해 풀었습니다."))
        return
    d2 = sympy.diff(e, x, 2)
    lines = []
    for c in sorted(crit, key=lambda v: float(sympy.re(sympy.N(v)))):
        if c.free_symbols:
            continue
        try:
            s2 = sympy.simplify(d2.subs(x, c))
            v = sympy.simplify(e.subs(x, c))
        except Exception:
            continue
        if s2.is_positive:
            lines.append(f"x = {pretty(c)} 에서 극소 {pretty(v)}")
        elif s2.is_negative:
            lines.append(f"x = {pretty(c)} 에서 극대 {pretty(v)}")
        else:
            near = _sign_change(e, x, c)
            if near:
                lines.append(f"x = {pretty(c)} 에서 {near} {pretty(v)}")
    if lines:
        rep.add(fact("극값 — " + ", ".join(lines[:8]), weight=88,
                     derivation="f′(x) = 0 을 정확히 풀고, 그 자리의 f″ 부호로 극대·극소를 갈랐습니다. "
                                "f″ 가 0 이면 좌우의 값을 견주어 판단했습니다."))


def _sign_change(e, x, c, h=sympy.Rational(1, 1000)):
    try:
        v = sympy.N(e.subs(x, c), 30)
        l = sympy.N(e.subs(x, c - h), 30)
        r = sympy.N(e.subs(x, c + h), 30)
    except Exception:
        return None
    if l > v and r > v:
        return "극소"
    if l < v and r < v:
        return "극대"
    return None


def _inflection(rep, e, x, view):
    try:
        d2 = sympy.diff(e, x, 2)
        s = sympy.solveset(sympy.Eq(d2, 0), x, sympy.S.Reals)
    except Exception:
        return
    if not isinstance(s, sympy.FiniteSet) or len(s) == 0:
        return
    d3 = sympy.diff(e, x, 3)
    pts = []
    for c in sorted(s, key=lambda v: float(sympy.re(sympy.N(v)))):
        if c.free_symbols:
            continue
        try:
            if sympy.simplify(d3.subs(x, c)) != 0:
                pts.append(c)
        except Exception:
            pass
    if pts:
        rep.add(fact("변곡점 — " + ", ".join(f"x = {pretty(c)}" for c in pts[:8]), weight=70,
                     derivation="f″(x) = 0 을 풀고 f‴ ≠ 0 인 것만 골랐습니다."))


def _asymptotes(rep, e, x):
    # 수직
    sing = singularities(e, x)
    if isinstance(sing, sympy.FiniteSet) and len(sing) > 0:
        vert = []
        for c in sorted(sing, key=str):
            try:
                L = sympy.limit(e, x, c, "+")
                R = sympy.limit(e, x, c, "-")
            except Exception:
                continue
            if L in (sympy.oo, -sympy.oo) or R in (sympy.oo, -sympy.oo):
                vert.append(c)
        if vert:
            rep.add(fact("수직점근선 — " + ", ".join(f"x = {pretty(c)}" for c in vert[:8]),
                         weight=82, derivation="분모가 0 이 되는 자리에서 좌·우 극한을 구해 확인했습니다."))
    # 수평·사선
    for direction, word in ((sympy.oo, "x → ∞"), (-sympy.oo, "x → −∞")):
        try:
            L = sympy.limit(e, x, direction)
        except Exception:
            continue
        if L is None or L.has(sympy.AccumBounds) or L.has(sympy.nan):
            continue
        if L not in (sympy.oo, -sympy.oo) and not L.free_symbols:
            rep.add(fact(f"수평점근선 — {word} 일 때 y → {pretty(L)}", weight=80,
                         derivation="극한을 기호로 구했습니다."))
            continue
        try:
            m = sympy.limit(e / x, x, direction)
            if m in (sympy.oo, -sympy.oo) or m == 0 or m.free_symbols:
                continue
            b = sympy.limit(e - m * x, x, direction)
            if b in (sympy.oo, -sympy.oo) or b.free_symbols:
                continue
            rep.add(fact(f"사선점근선 — {word} 일 때 y = {pretty(sympy.simplify(m * x + b))}",
                         weight=78, derivation="m = lim f(x)/x, b = lim (f(x) − m·x) 로 구했습니다."))
        except Exception:
            continue


def _calculus(rep, e, x):
    try:
        d = sympy.simplify(sympy.diff(e, x))
        rep.add(fact(f"도함수 — f′(x) = {pretty(d)}", weight=50,
                     derivation="기호 미분이라 오차가 없습니다."))
    except Exception:
        pass
    try:
        F = sympy.integrate(e, x)
        if not F.has(sympy.Integral):
            rep.add(fact(f"부정적분 — ∫f(x)dx = {pretty(sympy.simplify(F))} + C", weight=45,
                         derivation="부정적분을 기호로 구했습니다."))
    except Exception:
        pass
