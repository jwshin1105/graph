"""분석 배분 — 객체 하나를 받아 알맞은 분석기로 보낸다.

화면에 보여 줄 것은 늘 같은 뼈대다.

    객체 유형 / 정의역 / 사실 / 가설 / 표 / 어떻게 구했나

무엇을 분석하는지, 어디서 나온 값인지, 확인은 했는지를 한 자리에서 볼 수 있어야
사용자가 결과를 곧이곧대로 믿지 않고 스스로 따져 볼 수 있다.
"""

from __future__ import annotations

import sympy

from ..core.display import pretty, set_text
from ..core.evaluate import evaluate
from ..core.symbols import X, Y
from ..objects.model import MathObject
from .finding import Report, fact, guess
from .function import analyze_function
from .pointset import analyze_points
from .sequence import analyze_sequence

MAX_TERMS = 14        # 표와 그림에 쓸 항
POOL_TERMS = 60       # 관계식을 찾는 데만 더 쓸 항 — 차수가 높을수록 점이 많이 든다


def analyze(obj: MathObject, view=None) -> Report:
    if obj is None:
        return Report()
    kind = obj.kind
    rep = _dispatch(obj, view)
    rep.kind = kind
    rep.title = obj.label
    if obj.solution is not None and not rep.notes:
        pass
    head = [f"객체 유형 — {obj.kind_text()}"]
    desc = obj.solution.describe() if obj.solution is not None else ""
    if desc and desc != "점 0개":
        head.append(desc)
    rep.facts.insert(0, fact(" · ".join(head), weight=1000,
                             derivation="입력을 읽어 무엇에 대한 이야기인지 먼저 가렸습니다. "
                                        "이산이면 점으로, 연속이면 곡선으로 다룹니다."))
    if obj.domains and not rep.domain:
        rep.domain = " , ".join(d.text() for d in obj.domains.values())
    if rep.domain:
        rep.facts.insert(1, fact(f"정의역 — {rep.domain}", weight=999))
    return rep


def _dispatch(obj: MathObject, view) -> Report:
    k = obj.kind
    if k == "sequence" and obj.seq is not None:
        return analyze_sequence(obj.seq, count=MAX_TERMS)
    if k == "pointseq" and obj.pseq is not None:
        lo = obj.pseq.start()
        pool = obj.pseq.points(lo, lo + POOL_TERMS - 1)
        return analyze_points(pool[:MAX_TERMS], title=obj.label, pool=pool)
    if k in ("list", "point") and obj.solution is not None:
        pts = getattr(obj.solution, "points", [])
        if len(pts) >= 2:
            return analyze_points(pts[:MAX_TERMS], title=obj.label, pool=pts)
        return _single_point(obj, pts)
    if k in ("function", "function_x"):
        return analyze_function(obj.expr, obj.var, view=view, title=obj.label)
    if k == "implicit":
        return _implicit(obj, view)
    if k == "inequality":
        return _inequality(obj, view)
    if k == "lattice":
        return _lattice(obj, view)
    if k == "parametric":
        return _parametric(obj, view)
    if k == "polar":
        return _polar(obj, view)
    if k == "equation":
        return _equation(obj)
    if k == "value":
        return _value(obj)
    return Report()


def _single_point(obj, pts):
    rep = Report()
    if not pts:
        return rep
    x, y = pts[0]
    rep.add(fact(f"점 ({pretty(x)}, {pretty(y)})", weight=90,
                 derivation="좌표를 정확한 식으로 들고 있습니다."))
    r = sympy.simplify(sympy.sqrt(x ** 2 + y ** 2))
    rep.add(fact(f"원점에서의 거리 — {pretty(r)}", weight=60))
    return rep


def _implicit(obj, view):
    rep = Report()
    e = sympy.expand(obj.expr)
    rep.add(fact(f"음함수 식 — {pretty(e)} = 0", weight=90))
    try:
        p = sympy.Poly(e, X, Y)
    except Exception:
        p = None
    if p is not None and p.total_degree() == 2:
        _conic(rep, p)
    if p is not None:
        rep.add(fact(f"x, y 에 대한 {p.total_degree()}차 다항식입니다", weight=70,
                     derivation="식을 펴서 차수를 세었습니다."))
    for v, other in ((Y, X), (X, Y)):
        try:
            sols = sympy.solve(sympy.Eq(e, 0), v)
        except Exception:
            continue
        if sols and len(sols) <= 4:
            rep.add(fact(f"{v} 에 대해 풀면 — " + " ,  ".join(f"{v} = {pretty(s)}" for s in sols),
                         weight=65, derivation="식을 한 변수에 대해 기호로 풀었습니다."))
            break
    _symmetry_expr(rep, e)
    return rep


def _conic(rep, p):
    A = p.coeff_monomial(X ** 2)
    B = p.coeff_monomial(X * Y)
    C = p.coeff_monomial(Y ** 2)
    D = p.coeff_monomial(X)
    E = p.coeff_monomial(Y)
    F = p.coeff_monomial(1)
    disc = sympy.simplify(B ** 2 - 4 * A * C)
    M = sympy.Matrix([[A, B / 2, D / 2], [B / 2, C, E / 2], [D / 2, E / 2, F]])
    det = sympy.simplify(M.det())
    if det == 0:
        name = "퇴화한 이차곡선 (두 직선·한 점·빈 집합 가운데 하나)"
    elif disc == 0:
        name = "포물선"
    elif disc.is_negative:
        name = "원" if sympy.simplify(A - C) == 0 and B == 0 else "타원"
    else:
        name = "쌍곡선"
    rep.add(fact(f"이차곡선의 종류 — {name}", weight=88,
                 derivation=f"판별식 B² − 4AC = {pretty(disc)} 와 3×3 행렬식 {pretty(det)} 로 "
                            "갈랐습니다. 수치가 아니라 정확한 값으로 판단했습니다."))
    if name in ("원", "타원", "쌍곡선", "포물선") and det != 0:
        _center(rep, A, B, C, D, E)


def _center(rep, A, B, C, D, E):
    try:
        sol = sympy.solve([sympy.Eq(2 * A * X + B * Y + D, 0),
                           sympy.Eq(B * X + 2 * C * Y + E, 0)], [X, Y], dict=True)
    except Exception:
        return
    if sol and X in sol[0] and Y in sol[0]:
        cx, cy = sympy.simplify(sol[0][X]), sympy.simplify(sol[0][Y])
        rep.add(fact(f"중심 — ({pretty(cx)}, {pretty(cy)})", weight=75,
                     derivation="∂F/∂x = 0, ∂F/∂y = 0 을 정확히 풀었습니다."))


def _symmetry_expr(rep, e):
    checks = [(lambda z: z.subs({X: -X}, simultaneous=True), "y축"),
              (lambda z: z.subs({Y: -Y}, simultaneous=True), "x축"),
              (lambda z: z.subs({X: -X, Y: -Y}, simultaneous=True), "원점"),
              (lambda z: z.subs({X: Y, Y: X}, simultaneous=True), "직선 y = x")]
    for f, name in checks:
        try:
            if sympy.simplify(f(e) - e) == 0 or sympy.simplify(f(e) + e) == 0:
                rep.add(fact(f"{name} 에 대해 대칭입니다", weight=60,
                             derivation="변수를 바꿔 넣은 식이 원래 식과 (부호까지 보아) 같습니다."))
        except Exception:
            continue


def _inequality(obj, view):
    from ..engine.region import area
    from ..core.evaluate import numeric_fn
    rep = Report()
    rep.add(fact(f"조건 — {pretty(obj.expr)} {'>' if obj.solution.strict else '≥'} 0", weight=90,
                 derivation="부등식을 '이 식이 0 이상' 꼴로 옮겨 두었습니다."))
    if view:
        f = numeric_fn(obj.expr, (X, Y))
        try:
            a, err = area(f, view, strict=obj.solution.strict, rows=400, cols=400)
        except Exception:
            return rep
        digits = max(1, min(6, int(-sympy.log(max(err, 1e-12), 10)) if err > 0 else 6))
        rep.add(fact(f"보이는 화면 안의 넓이 — 약 {round(a, digits)}", weight=70,
                     detail=f"오차 가늠 ±{err:.1e}",
                     derivation="줄마다 안쪽 토막의 양 끝을 이분법으로 잡아 길이를 더했습니다. "
                                "칸을 세는 방식이 아니라서 경계에서도 어긋나지 않습니다. "
                                "줄 수를 반으로 줄인 값과 견주어 오차를 가늠했습니다."))
        rep.notes.append("넓이는 지금 보이는 화면 안에서만 잰 것입니다. 화면을 옮기면 달라집니다.")
    return rep


def _lattice(obj, view):
    from ..engine.lattice import diophantine_form, integer_solutions
    rep = Report()
    vs = sorted(obj.expr.free_symbols, key=lambda s: s.name)
    if len(vs) != 2:
        return rep
    xv, yv = vs
    box = view or (-20, 20, -20, 20)
    sols, note = integer_solutions(obj.expr, xv, yv, box, obj.domains)
    if note:
        rep.notes.append(note)
    rep.add(fact(f"정수해 {len(sols)}개를 찾았습니다",
                 detail="  ".join(f"({pretty(a)}, {pretty(b)})" for a, b in sols[:12])
                        + (" …" if len(sols) > 12 else ""),
                 weight=95,
                 derivation=f"{xv} 를 하나씩 넣고 {yv} 를 **정확히** 풀어, 정수인 것만 골랐습니다. "
                            "그림에서 눈으로 고른 것이 아닙니다."))
    gen = diophantine_form(obj.expr, xv, yv)
    if gen:
        free = set().union(*[set(a.free_symbols) | set(b.free_symbols) for a, b in gen])
        body = " , ".join(f"({pretty(a)}, {pretty(b)})" for a, b in sorted(gen, key=str))
        if free:
            rep.add(fact("일반해 — " + body + "  (매개변수는 정수)", weight=90,
                         derivation="디오판토스 방정식으로 풀어 정수해 전체의 꼴을 구했습니다."))
        else:
            rep.add(fact(f"정수해는 이 {len(gen)}개가 전부입니다 — " + body, weight=92,
                         derivation="디오판토스 방정식으로 풀었더니 해가 유한개였습니다. "
                                    "화면 밖까지 통틀어 이것뿐입니다."))
    if len(sols) >= 3:
        pts = [(a, b) for a, b in sols]
        sub = analyze_points(pts[:MAX_TERMS], title=obj.label, pool=pts)
        for f in sub.all():
            if f.weight >= 60 and "점 " not in f.text[:3]:
                rep.add(f)
    return rep


def _parametric(obj, view):
    rep = Report()
    t = obj.var
    fx, fy = obj.expr[0], obj.expr[1]
    rep.add(fact(f"x({t}) = {pretty(fx)} ,  y({t}) = {pretty(fy)}", weight=90))
    try:
        dx, dy = sympy.diff(fx, t), sympy.diff(fy, t)
        rep.add(fact(f"속도 — (x′, y′) = ({pretty(dx)}, {pretty(dy)})", weight=60,
                     derivation="매개변수로 미분했습니다."))
        speed = sympy.simplify(sympy.sqrt(dx ** 2 + dy ** 2))
        rep.add(fact(f"빠르기 — |(x′, y′)| = {pretty(speed)}", weight=58))
    except Exception:
        pass
    try:
        p = sympy.periodicity(fx, t), sympy.periodicity(fy, t)
        if all(v is not None and v != 0 and not v.has(sympy.oo) for v in p):
            per = sympy.lcm(p[0], p[1])
            rep.add(fact(f"주기 — {pretty(per)} 마다 되풀이됩니다", weight=70,
                         derivation="두 좌표의 주기를 각각 구해 최소공배수를 잡았습니다."))
    except Exception:
        pass
    # 음함수 관계 — 매개변수를 없앨 수 있으면
    try:
        rel = sympy.resultant(sympy.numer(sympy.together(X - fx)),
                              sympy.numer(sympy.together(Y - fy)), t)
        rel = sympy.factor(sympy.simplify(rel))
        if rel != 0 and not rel.has(t) and len(str(rel)) < 200:
            rep.add(fact(f"매개변수를 없앤 식 — {pretty(rel)} = 0", weight=85,
                         derivation="x − x(t) 와 y − y(t) 의 종결식(resultant)을 구해 t 를 없앴습니다."))
    except Exception:
        pass
    return rep


def _polar(obj, view):
    rep = Report()
    th = obj.var
    r = obj.expr
    rep.add(fact(f"r({th}) = {pretty(r)}", weight=90))
    try:
        zeros = sympy.solveset(sympy.Eq(r, 0), th, sympy.Interval(0, 2 * sympy.pi))
        if isinstance(zeros, sympy.FiniteSet) and len(zeros):
            rep.add(fact("원점을 지나는 각 — " + ", ".join(pretty(z) for z in sorted(zeros, key=str)),
                         weight=70, derivation="r(θ) = 0 을 [0, 2π] 에서 풀었습니다."))
    except Exception:
        pass
    try:
        area = sympy.simplify(sympy.integrate(r ** 2 / 2, (th, 0, 2 * sympy.pi)))
        if not area.has(sympy.Integral):
            rep.add(fact(f"한 바퀴가 감싸는 넓이 — {pretty(area)}", weight=75,
                         derivation="½∫r²dθ 를 기호로 계산했습니다."))
    except Exception:
        pass
    return rep


def _equation(obj):
    from ..core.evaluate import solve_exact
    rep = Report()
    sols, how = solve_exact(sympy.Eq(obj.expr, 0), obj.var)
    if sols:
        rep.add(fact("해 — " + ", ".join(f"{obj.var} = {pretty(s)}" for s in sols[:10]),
                     weight=95, derivation="방정식을 기호로 정확히 풀었습니다."))
        for s in sols[:4]:
            r = evaluate(s)
            if r.value is not None and not sympy.sympify(s).is_Rational:
                rep.add(fact(f"{obj.var} = {pretty(s)} ≈ {r.text()}", weight=50,
                             derivation=r.steps[0] if r.steps else ""))
    else:
        rep.notes.append("기호로 풀지 못했습니다.")
    return rep


def _value(obj):
    rep = Report()
    r = evaluate(obj.expr)
    rep.add(fact(f"값 — {r.text()}", detail=r.error_text(), weight=95,
                 derivation=" ".join(r.steps) or "정확한 값으로 계산했습니다."))
    return rep
