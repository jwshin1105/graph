"""점열의 규칙성 — 점들이 어떻게 놓여 있는가.

수열은 값 하나가 어떻게 변하는지만 보면 되지만, 점열은 **두 좌표가 함께**
어떻게 움직이는지를 봐야 한다. 그래서 이렇게 나눠 살핀다.

  좌표마다:  xₙ 의 규칙,  yₙ 의 규칙
  움직임:    ΔPₙ,  Δ²Pₙ,  걸음의 길이,  기울기,  돌아간 각
  놓임새:    원점에서의 거리,  대칭,  회전,  평행이동
  관계:      모든 점이 함께 만족하는 식 (x² + y² = 1 같은)

여기서도 규칙은 앞의 항으로 세우고 **뒤의 항으로 확인한다.**
"""

from __future__ import annotations

import sympy

from ..core.display import pretty
from ..core.symbols import sym

_N = sym("n")
from ..objects.sequence import Sequence
from .exactness import all_same, is_zero, light, same, tidy
from .finding import Report, fact, guess
from .invariant import find_invariant
from .sequence import analyze_sequence, difference_table

MAXN = 16


def analyze_points(points, *, index=None, title="Pₙ", split=None) -> Report:
    """points: [(n, x, y)] 또는 [(x, y)] — 좌표는 SymPy 식(정확값)."""
    pts = []
    for p in points:
        if len(p) == 3:
            pts.append((sympy.sympify(p[0]), sympy.sympify(p[1]), sympy.sympify(p[2])))
        else:
            pts.append((sympy.Integer(len(pts) + 1), sympy.sympify(p[0]), sympy.sympify(p[1])))
    pts = pts[:MAXN]
    rep = Report(kind="pointset", title=title)
    if len(pts) < 2:
        rep.notes.append("점이 모자라 규칙을 살필 수 없습니다.")
        return rep

    ns = [n for n, _, _ in pts]
    xs = [x for _, x, _ in pts]
    ys = [y for _, _, y in pts]
    k = split if split is not None else max(3, (len(pts) * 2) // 3)
    k = min(k, len(pts))

    rep.add(fact(f"점 {len(pts)}개를 보았습니다 (n = {ns[0]}‥{ns[-1]})",
                 detail="  ".join(f"({pretty(x)}, {pretty(y)})" for x, y in zip(xs[:5], ys[:5]))
                        + (" …" if len(pts) > 5 else ""),
                 derivation="번호를 넣어 좌표를 정확한 식으로 계산했습니다.", weight=100))
    rep.tables.append(("좌표", ["n"] + [str(n) for n in ns],
                       [["xₙ"] + [pretty(x) for x in xs],
                        ["yₙ"] + [pretty(y) for y in ys]]))

    _coordinate_rules(rep, ns, xs, ys, k)
    _differences(rep, ns, xs, ys)
    _steps(rep, xs, ys, k)
    _radius(rep, ns, xs, ys)
    _symmetry(rep, xs, ys)
    _translation(rep, xs, ys, k)
    _rotation(rep, xs, ys, k)
    _relation(rep, xs, ys, k)
    _collinear(rep, xs, ys)
    return rep


# ── 좌표마다의 규칙

def _coordinate_rules(rep, ns, xs, ys, k):
    for name, vals in (("xₙ", xs), ("yₙ", ys)):
        seq = Sequence(name=name[0], index=_N,
                       seeds={int(n): v for n, v in zip(ns, vals)})
        sub = analyze_sequence(seq, count=len(vals), split=k)
        for f in sub.sorted_hypotheses()[:2]:
            if f.weight >= 70:
                rep.add(guess(f"{name} — {f.text}", used=f.used, checked=f.checked,
                              passed=f.passed, weight=f.weight - 5,
                              derivation=f"{name} 만 따로 수열로 보고 살폈습니다. " + f.derivation))


def _differences(rep, ns, xs, ys):
    dx = [light(xs[i + 1] - xs[i]) for i in range(len(xs) - 1)]
    dy = [light(ys[i + 1] - ys[i]) for i in range(len(ys) - 1)]
    rep.tables.append(("1차 차분 ΔPₙ = Pₙ₊₁ − Pₙ",
                       ["n"] + [str(n) for n in ns[:-1]],
                       [["Δx"] + [pretty(v) for v in dx],
                        ["Δy"] + [pretty(v) for v in dy]]))
    if len(dx) >= 2:
        d2x = [light(dx[i + 1] - dx[i]) for i in range(len(dx) - 1)]
        d2y = [light(dy[i + 1] - dy[i]) for i in range(len(dy) - 1)]
        rep.tables.append(("2차 차분 Δ²Pₙ", ["n"] + [str(n) for n in ns[:-2]],
                           [["Δ²x"] + [pretty(v) for v in d2x],
                            ["Δ²y"] + [pretty(v) for v in d2y]]))
        if all(is_zero(v) for v in d2x) and all(is_zero(v) for v in d2y):
            rep.add(fact("2차 차분이 모두 0 입니다 — 본 점들은 일정한 걸음으로 나아갑니다",
                         weight=88, derivation="ΔPₙ 이 모두 같다는 뜻입니다."))


def _steps(rep, xs, ys, k):
    """걸음의 길이와 기울기, 돌아간 각."""
    steps = [(light(xs[i + 1] - xs[i]), light(ys[i + 1] - ys[i]))
             for i in range(len(xs) - 1)]
    # 제곱을 먼저 정리하고 나서 √ 를 씌운다. √ 안에 든 채로 정리하면 훨씬 느리다
    dists = [sympy.sqrt(sympy.simplify(a ** 2 + b ** 2)) for a, b in steps]
    rep.tables.append(("걸음", ["|ΔPₙ|"], [[pretty(d) for d in dists]]))
    if len(dists) >= 2 and all_same(dists):
        rep.add(fact(f"걸음의 길이가 모두 {pretty(dists[0])} 로 같습니다", weight=86,
                     derivation="이웃한 두 점 사이의 거리를 정확히 계산해 견주었습니다."))
    slopes = []
    for a, b in steps:
        slopes.append(light(b / a) if not is_zero(a) else sympy.oo)
    if len(slopes) >= 2 and all_same(slopes):
        rep.add(fact(f"이웃한 점을 잇는 기울기가 모두 {pretty(slopes[0])} 입니다", weight=86,
                     derivation="Δy/Δx 를 정확히 계산해 견주었습니다."))
    # 돌아간 각
    if len(steps) >= 3:
        angs = []
        for i in range(len(steps) - 1):
            a1 = sympy.atan2(steps[i][1], steps[i][0])
            a2 = sympy.atan2(steps[i + 1][1], steps[i + 1][0])
            angs.append(light(a2 - a1))
        if all_same(angs):
            rep.add(fact(f"걸음의 방향이 늘 같은 각 {pretty(angs[0])} 만큼 돌아갑니다",
                         weight=84, derivation="이웃한 걸음벡터의 방향각 차를 구했습니다."))


def _radius(rep, ns, xs, ys):
    rs = [sympy.sqrt(sympy.simplify(x ** 2 + y ** 2)) for x, y in zip(xs, ys)]
    rep.tables.append(("원점에서의 거리 |Pₙ|", ["n"] + [str(n) for n in ns],
                       [["|Pₙ|"] + [pretty(r) for r in rs]]))
    if all_same(rs):
        rep.add(fact(f"모든 점이 원점에서 같은 거리 {pretty(rs[0])} 에 있습니다 — 원 위의 점입니다",
                     weight=95, derivation="√(xₙ² + yₙ²) 를 정확히 계산해 견주었습니다."))


def _symmetry(rep, xs, ys):
    pairs = list(zip(xs, ys))

    def has(fx, fy):
        for x, y in pairs:
            tx, ty = fx(x, y), fy(x, y)
            if not any(same(tx, a) and same(ty, b) for a, b in pairs):
                return False
        return True
    if len(pairs) >= 3:
        if has(lambda x, y: x, lambda x, y: -y):
            rep.add(fact("본 점들이 x축에 대해 대칭입니다", weight=70))
        if has(lambda x, y: -x, lambda x, y: y):
            rep.add(fact("본 점들이 y축에 대해 대칭입니다", weight=70))
        if has(lambda x, y: -x, lambda x, y: -y):
            rep.add(fact("본 점들이 원점에 대해 대칭입니다", weight=70))


def _translation(rep, xs, ys, k):
    """Pₙ₊₁ = Pₙ + v 인가."""
    if len(xs) < 4:
        return
    vx = light(xs[1] - xs[0])
    vy = light(ys[1] - ys[0])
    for i in range(k - 1):
        if not is_zero(xs[i + 1] - xs[i] - vx) or not is_zero(ys[i + 1] - ys[i] - vy):
            return
    ok = sum(1 for i in range(k - 1, len(xs) - 1)
             if is_zero(xs[i + 1] - xs[i] - vx) and is_zero(ys[i + 1] - ys[i] - vy))
    rep.add(guess(f"평행이동 — Pₙ₊₁ = Pₙ + ({pretty(vx)}, {pretty(vy)})",
                  used=k, checked=len(xs) - k, passed=ok, weight=92,
                  derivation=f"앞의 {k}개 점에서 걸음벡터가 늘 같았습니다. "
                             "그 규칙을 나머지 점에 넣어 확인했습니다."))


def _rotation(rep, xs, ys, k):
    """Pₙ₊₁ = R·Pₙ 인가 (회전과 크기 변화를 함께)."""
    if len(xs) < 5:
        return
    a, b, c, d = sympy.symbols("a b c d")
    eqs = []
    for i in range(2):
        eqs += [sympy.Eq(xs[i + 1], a * xs[i] + b * ys[i]),
                sympy.Eq(ys[i + 1], c * xs[i] + d * ys[i])]
    try:
        sol = sympy.solve(eqs, [a, b, c, d], dict=True)
    except Exception:
        return
    if not sol:
        return
    M = sol[0]
    A, B, C, D = (M.get(a), M.get(b), M.get(c), M.get(d))
    if None in (A, B, C, D) or any(v.free_symbols for v in (A, B, C, D)):
        return
    A, B, C, D = (tidy(v) for v in (A, B, C, D))
    for i in range(k - 1):
        if not is_zero(xs[i + 1] - A * xs[i] - B * ys[i]) or \
           not is_zero(ys[i + 1] - C * xs[i] - D * ys[i]):
            return
    ok = sum(1 for i in range(k - 1, len(xs) - 1)
             if is_zero(xs[i + 1] - A * xs[i] - B * ys[i])
             and is_zero(ys[i + 1] - C * xs[i] - D * ys[i]))
    det = tidy(A * D - B * C)
    kind = "회전" if is_zero(det - 1) and is_zero(A - D) else "일차변환"
    ang = ""
    if kind == "회전":
        try:
            th = sympy.simplify(sympy.atan2(C, A))
            ang = f" — {pretty(th)} 라디안만큼 돌립니다"
        except Exception:
            pass
    rep.add(guess(f"{kind} — Pₙ₊₁ = [[{pretty(A)}, {pretty(B)}], [{pretty(C)}, {pretty(D)}]]·Pₙ{ang}",
                  used=k, checked=len(xs) - k, passed=ok, weight=90,
                  derivation="앞의 두 점으로 2×2 행렬을 정확히 풀고, 나머지 점에서 그 식이 "
                             "성립하는지 확인했습니다."))


def _relation(rep, xs, ys, k):
    """모든 점이 함께 만족하는 대수적 관계."""
    pts = list(zip(xs, ys))
    inv = find_invariant(pts[:k], pts[k:])
    if inv is None:
        rep.notes.append("총차수 3 이하에서는 모든 점이 함께 만족하는 관계를 찾지 못했습니다.")
        return
    rep.add(guess(f"모든 점이 {inv.text} 을 만족합니다",
                  used=inv.used, checked=inv.checked, passed=inv.passed, weight=99,
                  derivation=inv.derivation))
    _name_curve(rep, inv.expr)


def _name_curve(rep, expr):
    """찾은 관계가 어떤 곡선인지 이름 붙이기."""
    from ..core.symbols import X as x, Y as y
    try:
        p = sympy.Poly(sympy.expand(expr), x, y)
    except Exception:
        return
    if p.total_degree() == 1:
        rep.add(fact("그 관계는 **직선**의 식입니다", weight=60))
        return
    if p.total_degree() != 2:
        return
    A = p.coeff_monomial(x ** 2)
    B = p.coeff_monomial(x * y)
    C = p.coeff_monomial(y ** 2)
    disc = sympy.simplify(B ** 2 - 4 * A * C)
    if C == 0 or A == 0:
        rep.add(fact("그 관계는 **포물선**의 식입니다", weight=60))
    elif disc == 0:
        rep.add(fact("그 관계는 **포물선**의 식입니다", weight=60))
    elif disc.is_negative:
        name = "원" if sympy.simplify(A - C) == 0 and B == 0 else "타원"
        rep.add(fact(f"그 관계는 **{name}**의 식입니다", weight=60))
    elif disc.is_positive:
        rep.add(fact("그 관계는 **쌍곡선**의 식입니다", weight=60))


def _collinear(rep, xs, ys):
    if len(xs) < 3:
        return
    x0, y0 = xs[0], ys[0]
    x1, y1 = xs[1], ys[1]
    for i in range(2, len(xs)):
        if not is_zero((x1 - x0) * (ys[i] - y0) - (y1 - y0) * (xs[i] - x0)):
            return
    rep.add(fact("본 점들이 모두 한 직선 위에 있습니다", weight=80,
                 derivation="세 점의 외적을 정확히 계산해 모두 0 임을 확인했습니다."))
