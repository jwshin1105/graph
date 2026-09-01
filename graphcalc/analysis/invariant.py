"""점들이 함께 만족하는 대수적 관계를 찾는다.

  (cos n, sin n) →  x² + y² = 1
  (n, n²)        →  y − x² = 0
  (n, 2n+1)      →  2x − y + 1 = 0

찾는 방법은 이렇다. 총차수 d 이하의 단항식을 늘어놓고, 점마다 그 값을 한 줄로
적어 행렬을 만든다. 그 행렬의 **가장 작은 특이값에 딸린 벡터**가 곧
"모든 점에서 0 이 되는 계수" 다.

여기서 두 가지를 더 한다.

1. **자릿수를 넉넉히.** x⁴ 은 x 보다 자릿수가 훨씬 커서 배정밀도로는 행렬이
   나빠진다. 열마다 크기를 맞추고, 계산은 mpmath 로 40자리쯤에서 한다.
2. **되돌린 식을 정확히 다시 확인한다.** 계수를 유리수로 되돌린 뒤, 그 식이
   원래의 **정확한 좌표**에서 정말 0 인지 SymPy 로 확인한다. 수치로 "거의 0"
   인 것과 정말 0 인 것은 다르다.

그렇게 확인된 것만 내놓고, 그마저도 가설이라고 적는다.
"""

from __future__ import annotations

from dataclasses import dataclass

import mpmath
import sympy

from ..core.display import pretty

from ..core.symbols import X, Y


@dataclass
class Invariant:
    degree: int = 0
    expr: object = None            # = 0 인 식
    text: str = ""
    used: int = 0
    checked: int = 0
    passed: int = 0
    derivation: str = ""


def monomials(d):
    out = []
    for t in range(d + 1):
        for i in range(t, -1, -1):
            out.append((i, t - i))
    return out                      # (0,0) (1,0) (0,1) (2,0) (1,1) (0,2) …


def find_invariant(fit_points, check_points=(), max_degree=3, dps=40):
    """fit_points 로 관계를 찾고, check_points 로 확인한다. 좌표는 SymPy 식."""
    fit = [p for p in fit_points if _finite(p)]
    if len(fit) < 3:
        return None
    for d in range(1, max_degree + 1):
        basis = monomials(d)
        if len(fit) < len(basis) + 2:
            break
        inv = _try_degree(fit, check_points, basis, d, dps)
        if inv is not None:
            return inv
    return None


def _finite(p):
    try:
        a, b = complex(sympy.N(p[0], 20)), complex(sympy.N(p[1], 20))
    except Exception:
        return False
    return abs(a.imag) < 1e-12 and abs(b.imag) < 1e-12 and \
        all(abs(z) < 1e100 for z in (a.real, b.real))


def _try_degree(fit, check, basis, d, dps):
    with mpmath.workdps(dps):
        rows = []
        for px, py in fit:
            xa = mpmath.mpf(str(sympy.N(sympy.re(px), dps)))
            ya = mpmath.mpf(str(sympy.N(sympy.re(py), dps)))
            rows.append([xa ** i * ya ** j for i, j in basis])
        m, k = len(rows), len(basis)
        # 열마다 크기를 맞춘다 — x 는 16, x⁴ 은 65536 이면 행렬이 몹시 나빠진다
        scale = []
        for c in range(k):
            s = mpmath.sqrt(sum(rows[r][c] ** 2 for r in range(m)) / m)
            scale.append(s if s > mpmath.mpf(10) ** (-dps) else mpmath.mpf(1))
        A = mpmath.matrix(m, k)
        for r in range(m):
            for c in range(k):
                A[r, c] = rows[r][c] / scale[c]
        try:
            _, S, V = mpmath.svd_r(A, compute_uv=True)
        except Exception:
            return None
        smallest = min(range(k), key=lambda i: abs(S[i]))
        if abs(S[smallest]) > abs(S[0]) * mpmath.mpf(10) ** (-dps // 3):
            return None                 # 이 차수로는 맞는 관계가 없다
        vec = [V[smallest, c] / scale[c] for c in range(k)]

    big = max(range(k), key=lambda i: abs(vec[i]))
    if abs(vec[big]) == 0:
        return None
    coeffs = []
    for v in vec:
        r = _rationalize(v / vec[big])
        if r is None:
            return None
        coeffs.append(r)

    expr = sum(c * X ** i * Y ** j for c, (i, j) in zip(coeffs, basis))
    expr = sympy.simplify(sympy.expand(expr * _denominator(coeffs)))
    if expr == 0:
        return None
    # **정확한 좌표로** 다시 확인한다. 여기서 걸러지는 후보가 적지 않다.
    if not all(_zero_at(expr, p) for p in fit):
        return None
    others = [p for p in check if _finite(p)]
    passed = sum(1 for p in others if _zero_at(expr, p))
    return Invariant(
        degree=d, expr=expr, text=_relation_text(expr),
        used=len(fit), checked=len(others), passed=passed,
        derivation=f"총차수 {d} 이하의 단항식 {len(basis)}개로 행렬을 만들어, 가장 작은 "
                   f"특이값에 딸린 벡터를 {40}자리로 구했습니다. 그 계수를 유리수로 되돌린 뒤 "
                   f"**정확한 좌표**를 넣어 정말 0 이 되는지 다시 확인했습니다.")


def _rationalize(v, max_den=64, tol=1e-9):
    x = float(v)
    if abs(x) < 1e-9:
        return sympy.Integer(0)
    r = sympy.Rational(x).limit_denominator(max_den)
    if abs(float(r) - x) < tol * max(1.0, abs(x)):
        return r
    return None


def _denominator(coeffs):
    den = 1
    for c in coeffs:
        den = sympy.ilcm(den, sympy.Rational(c).q)
    return den


def _zero_at(expr, p):
    from .exactness import is_zero
    try:
        return is_zero(expr.subs({X: p[0], Y: p[1]}))
    except Exception:
        return False


def _relation_text(expr):
    """x² + y² − 1 = 0 을 x² + y² = 1 로 적는다.

    y 에 대해 일차이면 y = … 로 푼다. x² − y = 0 보다 y = x² 가 읽기 쉽다.
    """
    try:
        py_ = sympy.Poly(sympy.expand(expr), Y)
        if py_.degree() == 1:
            sol = sympy.solve(sympy.Eq(expr, 0), Y)
            if len(sol) == 1:
                return f"y = {pretty(sympy.expand(sol[0]))}"
    except Exception:
        pass
    p = sympy.Poly(sympy.expand(expr), X, Y)
    const = p.coeff_monomial(1)
    lhs = sympy.expand(expr - const)
    lead = sympy.LT(sympy.Poly(lhs, X, Y)) if lhs != 0 else 1
    if sympy.Poly(lhs, X, Y).LC() < 0:
        lhs, const = -lhs, -const
    g = sympy.gcd(tuple(sympy.Poly(lhs, X, Y).coeffs()) + ((const,) if const else ()))
    if g and g != 0:
        lhs, const = sympy.cancel(lhs / g), sympy.cancel(const / g)
    return f"{pretty(lhs)} = {pretty(-const)}"
