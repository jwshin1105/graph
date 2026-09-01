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
from .exactness import all_same, is_zero, light, norm, probably_zero, same, tidy
from .finding import Report, fact, guess
from .invariant import MAX_DEGREE, find_invariant
from .sequence import analyze_sequence, difference_table

MAXN = 16


def analyze_points(points, *, index=None, title="Pₙ", split=None, pool=None) -> Report:
    """점열을 살핀다.

    @param points 화면과 표에 쓸 점. [(n, x, y)] 또는 [(x, y)] — 좌표는 정확한 식.
    @param pool   관계식을 찾는 데만 더 쓸 점. 3차 이상의 관계를 말하려면
                  단항식 수보다 점이 넉넉해야 하는데, 표에 스무 줄을 늘어놓을
                  까닭은 없으므로 찾는 데 쓸 점을 따로 받는다.
    """
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
    moved = _translation(rep, xs, ys, k)
    if not moved:
        # 평행이동으로 이미 설명된 점열에 2×2 행렬까지 붙이면 군더더기다.
        # 같은 말을 두 번 하는 셈이고, 행렬 쪽이 오히려 알아보기 어렵다.
        _rotation(rep, xs, ys, k)
    _relation(rep, xs, ys, k, pool)
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
    sq = [light(a ** 2 + b ** 2) for a, b in steps]
    dists, equal = _lengths(sq)
    rep.tables.append(("걸음", ["|ΔPₙ|"], [[pretty(d) for d in dists]]))
    if len(dists) >= 2 and equal:
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
    rs, equal = _lengths([light(x ** 2 + y ** 2) for x, y in zip(xs, ys)])
    rep.tables.append(("원점에서의 거리 |Pₙ|", ["n"] + [str(n) for n in ns],
                       [["|Pₙ|"] + [pretty(r) for r in rs]]))
    if equal:
        rep.add(fact(f"모든 점이 원점에서 같은 거리 {pretty(rs[0])} 에 있습니다 — 원 위의 점입니다",
                     weight=95, derivation="√(xₙ² + yₙ²) 를 정확히 계산해 견주었습니다."))


def _lengths(squares):
    """제곱값 목록 → (거리 목록, 모두 같은가).

    **먼저 줄이고 나서 견준다.** 안 줄인 채로 견주면 "이 둘이 같은가" 를 묻는
    물음마다 삼각함수 항등식을 훑게 되어, 줄이는 것보다 훨씬 비싸진다.
    제곱을 다 줄인 뒤에 √ 를 씌우는 것도 같은 까닭이다 — √ 안에 든 채로
    정리하면 훨씬 느리다.
    """
    if not squares:
        return [], True
    # 같은지부터 묻는다. is_zero 가 수치로 먼저 거르므로, 다르면 여기서 끝난다.
    if all_same(squares):
        d = sympy.sqrt(norm(squares[0]))          # 같으니 한 번만 줄이면 된다
        return [d] * len(squares), True
    # 다 다르다면 굳이 다듬지 않는다. √(1 + (sin 2 − sin 1)²) 는 그대로도
    # 읽을 만하고 값도 정확하다. 줄지도 않을 식을 여덟 번 정리하느라
    # 열 몇 초를 쓰는 것이 훨씬 나쁘다.
    return [sympy.sqrt(q) for q in squares], False


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


def _translation(rep, xs, ys, k) -> bool:
    """Pₙ₊₁ = Pₙ + v 인가. 그렇다면 참을 돌려준다."""
    if len(xs) < 4:
        return False
    vx = light(xs[1] - xs[0])
    vy = light(ys[1] - ys[0])
    for i in range(k - 1):
        if not is_zero(xs[i + 1] - xs[i] - vx) or not is_zero(ys[i + 1] - ys[i] - vy):
            return False
    ok = sum(1 for i in range(k - 1, len(xs) - 1)
             if is_zero(xs[i + 1] - xs[i] - vx) and is_zero(ys[i + 1] - ys[i] - vy))
    rep.add(guess(f"평행이동 — Pₙ₊₁ = Pₙ + ({pretty(vx)}, {pretty(vy)})",
                  used=k, checked=len(xs) - k, passed=ok, weight=92,
                  derivation=f"앞의 {k}개 점에서 걸음벡터가 늘 같았습니다. "
                             "그 규칙을 나머지 점에 넣어 확인했습니다."))
    return True


def _rotation(rep, xs, ys, k):
    """Pₙ₊₁ = R·Pₙ 인가 (회전과 크기 변화를 함께)."""
    if len(xs) < 5:
        return
    # M·[P₀ P₁] = [P₁ P₂] 이므로 M = [P₁ P₂]·[P₀ P₁]⁻¹ 이다.
    # 미지수 넷을 sympy.solve 로 푸는 것보다 2×2 행렬을 바로 뒤집는 편이 빠르다.
    src = sympy.Matrix([[xs[0], xs[1]], [ys[0], ys[1]]])
    dst = sympy.Matrix([[xs[1], xs[2]], [ys[1], ys[2]]])
    det = tidy(light(src.det()))     # 이건 나눗셈에 쓰이니 먼저 줄여 둔다
    if is_zero(det):
        return                    # 앞의 두 점이 원점과 한 줄에 있어 정할 수 없다
    try:
        M = dst * src.adjugate() / det
    except Exception:
        return
    A, B, C, D = (light(M[0, 0]), light(M[0, 1]), light(M[1, 0]), light(M[1, 1]))
    if any(getattr(v, "free_symbols", set()) for v in (A, B, C, D)):
        return
    # 다듬기 전에 **한 점으로, 수치로만** 걸러 낸다. 행렬은 앞의 두 점으로
    # 맞췄으니 세 번째 점이 첫 시험대다. 여기서 어긋나면 다듬을 값어치가 없고,
    # 들어맞더라도 증명은 다듬은 뒤에 하는 편이 훨씬 싸다.
    if not probably_zero(xs[3] - A * xs[2] - B * ys[2]) or \
       not probably_zero(ys[3] - C * xs[2] - D * ys[2]):
        return
    # 살아남았으면 이제 다듬는다. 다듬어 둔 쪽이 나머지 확인도 훨씬 싸다.
    A, B, C, D = (tidy(A), tidy(B), tidy(C), tidy(D))
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


def _relation(rep, xs, ys, k, pool=None):
    """모든 점이 함께 만족하는 대수적 관계."""
    pts = list(zip(xs, ys))
    wide = _as_pairs(pool) if pool else []
    # 찾는 데는 넓은 쪽을, 확인에는 그 뒤를 쓴다. 넓은 쪽이 없으면 본 점을 나눈다.
    search = wide or pts[:k]
    verify = pts[k:] if not wide else []
    inv = find_invariant(search, verify)
    if inv is None:
        rep.notes.append(f"총차수 {MAX_DEGREE} 이하에서는 모든 점이 함께 만족하는 관계를 "
                         f"찾지 못했습니다 (점 {len(search) + len(verify)}개로 살폈습니다).")
        return
    rep.add(guess(f"모든 점이 {inv.text} 을 만족합니다",
                  used=inv.used, checked=inv.checked, passed=inv.passed, weight=99,
                  derivation=inv.derivation))
    _name_curve(rep, inv.expr)


def _as_pairs(points):
    out = []
    for q in points:
        if len(q) == 3:
            out.append((sympy.sympify(q[1]), sympy.sympify(q[2])))
        else:
            out.append((sympy.sympify(q[0]), sympy.sympify(q[1])))
    return out


def _name_curve(rep, expr):
    """찾은 관계가 어떤 곡선인지 이름 붙이기."""
    from ..core.symbols import X as x, Y as y
    try:
        p = sympy.Poly(sympy.expand(expr), x, y)
    except Exception:
        return
    deg = p.total_degree()
    if deg == 1:
        rep.add(fact("그 관계는 **직선**의 식입니다", weight=60))
        return
    if deg != 2:
        _name_higher(rep, expr, p, deg, x, y)
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


def _name_higher(rep, expr, poly, deg, x, y):
    """3차 이상의 곡선에 이름을 붙여 본다."""
    dy = sympy.Poly(expr, y).degree()
    if dy == 1:
        sol = sympy.solve(sympy.Eq(expr, 0), y)
        if len(sol) == 1:
            rep.add(fact(f"그 관계는 **{deg}차 함수의 그래프**입니다 — y = {pretty(sympy.expand(sol[0]))}",
                         weight=62))
            return
    if dy == 2 and deg == 3:
        # y² = (x 의 3차식) 꼴이면 판별식으로 매끈한지 아닌지가 갈린다
        rhs = _as_y2(expr, x, y)
        if rhs is not None:
            disc = sympy.simplify(sympy.discriminant(sympy.Poly(rhs, x)))
            if disc != 0:
                rep.add(fact("그 관계는 **타원곡선**의 식입니다 (특이점이 없는 3차곡선)",
                             weight=62,
                             derivation=f"y² = {pretty(rhs)} 꼴이고, 오른쪽 3차식의 판별식이 "
                                        f"{pretty(disc)} 로 0 이 아니므로 매끈합니다."))
            else:
                rep.add(fact("그 관계는 **특이점을 가진 3차곡선**의 식입니다 (첨점이나 마디가 있습니다)",
                             weight=62,
                             derivation="y² = (x 의 3차식) 꼴인데 오른쪽 3차식에 중근이 있습니다."))
            return
    rep.add(fact(f"그 관계는 **{deg}차 대수곡선**의 식입니다", weight=60,
                 derivation=f"x, y 에 대한 총차수가 {deg} 입니다."))


def _as_y2(expr, x, y):
    """식이 y² − g(x) = 0 꼴이면 g(x), 아니면 None."""
    try:
        p = sympy.Poly(expr, y)
    except Exception:
        return None
    if p.degree() != 2 or p.coeff_monomial(y) != 0:
        return None
    a2 = p.coeff_monomial(y ** 2)
    if a2 == 0 or a2.free_symbols:
        return None
    return sympy.expand(-p.coeff_monomial(1) / a2)


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
