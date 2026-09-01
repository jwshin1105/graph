"""규칙성 탐색 — 그리고 사실과 가설을 갈라 적는지."""

import sympy

from graphcalc.analysis.function import analyze_function
from graphcalc.analysis.invariant import find_invariant
from graphcalc.analysis.pointset import analyze_points
from graphcalc.analysis.sequence import analyze_sequence
from graphcalc.core.symbols import sym
from graphcalc.objects.sequence import Sequence

n, x = sym("n"), sym("x")
a = sympy.Function("a")


def texts(rep):
    return [f.text for f in rep.all()]


def has(rep, needle):
    return any(needle in t for t in texts(rep))


def points_of(fx, fy, m=14):
    return [(k, sympy.simplify(fx.subs(n, k)), sympy.simplify(fy.subs(n, k)))
            for k in range(1, m + 1)]


# ── 수열

def test_등차_등비_다항식():
    assert has(analyze_sequence(Sequence(rule=2 * n - 1)), "등차수열")
    assert has(analyze_sequence(Sequence(rule=3 * 2 ** n)), "등비수열")
    r = analyze_sequence(Sequence(rule=n ** 2))
    assert has(r, "2차 다항식") and has(r, "n²")


def test_점화식과_일반항():
    fib = Sequence(recurrence=a(n) + a(n - 1), shift=1, seeds={1: 1, 2: 1})
    r = analyze_sequence(fib)
    assert has(r, "점화식")
    assert has(r, "일반항")


def test_주기와_극한():
    assert has(analyze_sequence(Sequence(rule=(-1) ** n)), "주기 2")
    assert has(analyze_sequence(Sequence(rule=1 / n)), "aₙ → 0")


def test_규칙은_가설로_적고_확인_결과를_밝힌다():
    r = analyze_sequence(Sequence(rule=n ** 2))
    g = [f for f in r.hypotheses if "다항식" in f.text][0]
    assert g.kind == "hypothesis"
    assert g.checked > 0 and g.passed == g.checked
    assert "여분" in g.badge()
    # 사실 쪽에는 '이다' 라고 단정하는 규칙이 없다
    assert not any("다항식" in f.text for f in r.facts)


def test_아무_규칙_없는_수열에는_규칙을_지어내지_않는다():
    vals = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8]
    s = Sequence(seeds={i + 1: v for i, v in enumerate(vals)})
    r = analyze_sequence(s)
    assert not has(r, "등차수열")
    assert not has(r, "등비수열")
    assert not has(r, "다항식")


def test_어떻게_구했는지_적는다():
    r = analyze_sequence(Sequence(rule=2 * n - 1))
    assert all(f.derivation for f in r.hypotheses)


# ── 점열

def test_원_위의_점열():
    r = analyze_points(points_of(sympy.cos(n), sympy.sin(n)),
                       pool=points_of(sympy.cos(n), sympy.sin(n), 24))
    assert has(r, "x² + y² = 1")
    assert has(r, "원점에서 같은 거리 1")
    assert has(r, "회전")


def test_포물선_위의_점열():
    r = analyze_points(points_of(n, n ** 2))
    assert has(r, "y = x²")
    assert has(r, "포물선")


def test_직선_위의_점열():
    r = analyze_points(points_of(n, 2 * n + 1))
    assert has(r, "y = 2x + 1")
    assert has(r, "한 직선 위에")
    assert has(r, "기울기가 모두 2")


def test_평행이동():
    r = analyze_points(points_of(n, n + 3))
    assert has(r, "평행이동")


def test_관계가_없으면_없다고_말한다():
    r = analyze_points(points_of(2 ** n, sympy.factorial(n), 10))
    assert not has(r, "모든 점이")
    assert not has(r, "모든 점이")
    assert any("찾지 못했습니다" in s for s in r.notes)


# ── 관계식 찾기

def test_높은_차수의_관계도_찾는다():
    """점이 넉넉하면 3차 이상의 관계도 찾아낸다."""
    def pts(fx, fy, m):
        return [(sympy.simplify(fx.subs(n, k)), sympy.simplify(fy.subs(n, k)))
                for k in range(1, m + 1)]
    for fx, fy, m, want, deg in [
            (n, n ** 3, 30, "y = x³", 3),
            (n, n ** 4, 40, "y = x⁴", 4),
            (n, n ** 5, 50, "y = x⁵", 5),
            (n ** 2, n ** 3, 30, "x³ - y² = 0", 3),
            (sympy.cos(n), sympy.cos(3 * n), 40, "y = 4x³ - 3x", 3)]:
        inv = find_invariant(pts(fx, fy, m), [])
        assert inv is not None, want
        assert inv.text == want
        assert inv.degree == deg
        assert inv.checked > 0 and inv.passed == inv.checked


def test_점이_모자라면_말하지_않는다():
    """단항식 수만큼만 점이 있으면 관계는 늘 찾아진다 — 그건 발견이 아니다."""
    from graphcalc.analysis.invariant import margin, monomials
    assert margin(len(monomials(3))) >= 3
    P = [(sympy.Integer(k), sympy.Integer(k) ** 3) for k in range(1, 12)]
    assert find_invariant(P, []) is None          # 3차를 말하기엔 점이 모자라다
    P = [(sympy.Integer(k), sympy.Integer(k) ** 3) for k in range(1, 25)]
    assert find_invariant(P, []).text == "y = x³"


def test_아무_관계_없는_점에는_높은_차수도_붙이지_않는다():
    import random
    random.seed(7)
    rnd = [(sympy.Rational(random.randint(-40, 40), 7),
            sympy.Rational(random.randint(-40, 40), 5)) for _ in range(60)]
    assert find_invariant(rnd, []) is None


def test_곡선의_이름():
    def pts(fx, fy, m=30):
        return [(k, sympy.simplify(fx.subs(n, k)), sympy.simplify(fy.subs(n, k)))
                for k in range(1, m + 1)]
    r = analyze_points(pts(n ** 2, n ** 3)[:14], pool=pts(n ** 2, n ** 3))
    assert has(r, "특이점을 가진 3차곡선")
    ell = [(k, sympy.Integer(k), sympy.sqrt(sympy.Integer(k) ** 3 - 2 * k + 1))
           for k in range(2, 40)]
    r = analyze_points(ell[:14], pool=ell)
    assert has(r, "타원곡선")


def test_불변량_찾기():
    def pts(fx, fy, m=20):
        return [(sympy.simplify(fx.subs(n, k)), sympy.simplify(fy.subs(n, k)))
                for k in range(1, m)]
    for fx, fy, want in [(sympy.cos(n), sympy.sin(n), "x² + y² = 1"),
                         (n, n ** 2, "y = x²"),
                         (n, 2 * n + 1, "y = 2x + 1"),
                         (2 * sympy.cos(n), 3 * sympy.sin(n), "9x² + 4y² = 36")]:
        P = pts(fx, fy)
        inv = find_invariant(P[:12], P[12:])
        assert inv is not None and inv.text == want
        assert inv.checked > 0 and inv.passed == inv.checked


def test_관계가_없는_점들():
    P = [(sympy.Integer(k), sympy.Integer(2) ** k) for k in range(1, 16)]
    assert find_invariant(P[:10], P[10:]) is None


# ── 함수

def test_함수_구조():
    r = analyze_function(x ** 3 - 3 * x, x)
    assert has(r, "√3")
    assert has(r, "극대") and has(r, "극소")
    assert has(r, "기함수")
    r = analyze_function(1 / x, x)
    assert has(r, "수직점근선")
    assert has(r, "수평점근선")
    r = analyze_function((x ** 2 + 1) / x, x)
    assert has(r, "사선점근선")


def test_무한히_많은_영점은_늘어놓지_않는다():
    r = analyze_function(sympy.sin(x), x)
    assert has(r, "무한히 많습니다")
    assert has(r, "주기 2π")
