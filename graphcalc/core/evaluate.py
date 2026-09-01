"""계산 엔진 — 정확한 답을 먼저, 안 되면 오차를 관리하는 고정밀 수치로.

순서가 중요하다.

1. **정확히**  — SymPy 로 기호 계산. √2·√2 는 2 이고, ∫₋₁¹√(1−x²)dx 는 π/2 다.
2. **고정밀로** — mpmath 로 원하는 자릿수까지. 답을 두 자릿수로 각각 구해
   서로 견주어 **실제 오차**를 잰다. "아마 맞겠지" 로 넘기지 않는다.
3. 그래도 안 되면 못 구했다고 말한다. 틀린 숫자를 내놓는 것보다 낫다.

배정밀도(float64)는 그림을 그릴 때만 쓴다. 화면의 한 픽셀보다 훨씬 작은
오차라 눈에 보이지 않고, 대신 아주 빠르기 때문이다. 계산 결과로는 쓰지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import mpmath
import sympy

from .display import approx, fmt_mp, pretty
from .precision import get_precision, workdps


@dataclass
class Result:
    """계산 하나의 결과 — 값과 함께 **어떻게 구했고 얼마나 믿을 수 있는지**를 담는다."""
    exact: object = None          # 정확한 식 (구했다면)
    value: object = None          # 고정밀 수치 (mpmath)
    error: float = 0.0            # 절대오차의 상한
    method: str = ""              # exact / high-precision / numeric
    steps: list = field(default_factory=list)
    note: str = ""

    @property
    def ok(self) -> bool:
        return self.exact is not None or self.value is not None

    @property
    def is_exact(self) -> bool:
        return self.exact is not None and self.error == 0.0

    def text(self, digits: int | None = None) -> str:
        d = digits or get_precision().display
        if self.exact is not None:
            s = pretty(self.exact)
            a = approx(self.exact, d)
            if a is not None and a != s and not sympy.sympify(self.exact).is_Integer:
                return f"{s} ≈ {a}"
            return s
        if self.value is None:
            return "구하지 못했습니다"
        return fmt_mp(self.value, self.significant(d))

    def significant(self, d: int) -> int:
        """오차가 허락하는 만큼만 적는다. 못 믿을 자릿수를 보여 주면 거짓말이다."""
        if self.error <= 0 or self.value is None:
            return d
        try:
            mag = abs(mpmath.mpf(self.value))
        except Exception:
            return d
        if mag == 0:
            return d
        good = int(mpmath.floor(mpmath.log10(mag / mpmath.mpf(self.error))))
        return max(1, min(d, good))

    def error_text(self) -> str:
        if self.is_exact:
            return "정확값"
        if self.error <= 0:
            return "정확값" if self.exact is not None else ""
        return f"오차 ≤ {fmt_mp(mpmath.mpf(self.error), 2)}"


def _relerr(a, b) -> float:
    try:
        d = abs(a - b)
        m = max(abs(a), abs(b), mpmath.mpf(1))
        return float(d / m * m)          # 절대오차
    except Exception:
        return float("inf")


def high_precision(expr, digits: int | None = None) -> Result:
    """자릿수를 두 번 달리 잡아 값을 구하고, 그 차이를 오차로 삼는다."""
    p = get_precision()
    d = digits or p.internal
    e = sympy.sympify(expr)
    if e.free_symbols:
        return Result(note="변수가 남아 있어 값을 정할 수 없습니다")
    try:
        with workdps(d, guard=5):
            lo = mpmath.mpf(str(sympy.N(e, d + 5)))
        with workdps(d, guard=20):
            hi = mpmath.mpf(str(sympy.N(e, d + 20)))
    except Exception as exc:
        return Result(note=f"수치로도 구하지 못했습니다 ({exc})")
    err = _relerr(lo, hi)
    return Result(value=hi, error=err if err > 0 else float(mpmath.mpf(10) ** (-d)),
                  method="high-precision",
                  steps=[f"{d}자리와 {d + 15}자리로 각각 계산해 견주었습니다."])


def evaluate(expr, subs: dict | None = None) -> Result:
    """식 하나의 값. 정확값을 먼저 노린다."""
    e = sympy.sympify(expr)
    steps = []
    if subs:
        e = e.subs(subs)
        steps.append("값을 대입했습니다.")
    if too_big(e):
        # (1 + 10⁻⁶)^(10⁶) 을 정확히 펴면 자릿수가 수백만이 된다.
        # 그런 건 처음부터 고정밀 수치로 간다 — 답은 같고, 기다릴 필요가 없다.
        steps.append("정확히 펴면 자릿수가 너무 커져, 고정밀 수치로 계산했습니다.")
        r = high_precision(e)
        r.steps = steps + r.steps
        return r
    try:
        s = sympy.simplify(e)
    except Exception:
        s = e
    if not s.free_symbols:
        if s.is_number and (s.is_rational or s.is_algebraic or _closed(s)):
            steps.append("기호 그대로 계산해 정확값을 얻었습니다.")
            return Result(exact=s, value=_num(s), error=0.0, method="exact", steps=steps)
        r = high_precision(s)
        r.steps = steps + r.steps
        return r
    return Result(exact=s, method="symbolic", steps=steps,
                  note="변수가 남아 있습니다")


def too_big(e, limit: int = 2000) -> bool:
    """정확히 계산하면 자릿수가 감당 못 하게 커지는 식인가."""
    big = sympy.Integer(10) ** 4000
    for q in e.atoms(sympy.Pow):
        base, ex = q.base, q.exp
        if ex.is_Integer and abs(int(ex)) > limit and base.is_Rational and base != 0:
            return True
    for n in e.atoms(sympy.Integer, sympy.Rational):
        if abs(n.p) > big or abs(n.q) > big:
            return True
    for f in e.atoms(sympy.factorial):
        if f.args[0].is_Integer and int(f.args[0]) > limit:
            return True
    return False


def _closed(s) -> bool:
    """π, e, √2, ln 2 처럼 '적어 둘 수 있는' 모양인가."""
    atoms = s.atoms(sympy.Function, sympy.NumberSymbol)
    return len(s.atoms(sympy.Symbol)) == 0 and len(atoms) <= 4


def _num(s):
    try:
        with workdps():
            return mpmath.mpf(str(sympy.N(sympy.re(s), get_precision().internal + 5)))
    except Exception:
        return None


# ──────────────────────────────────────────────── 미적분

def derivative(expr, var, order: int = 1) -> Result:
    e = sympy.sympify(expr)
    try:
        d = sympy.diff(e, var, order)
        d = sympy.simplify(d)
    except Exception as exc:
        return Result(note=f"미분하지 못했습니다 ({exc})")
    word = {1: "", 2: "두 번 ", 3: "세 번 "}.get(order, f"{order}번 ")
    return Result(exact=d, method="exact",
                  steps=[f"{var} 에 대해 {word}미분했습니다 (기호 미분이라 오차가 없습니다)."])


def integrate_definite(expr, var, a, b) -> Result:
    """정적분 — 부정적분을 먼저 구해 정확값을, 안 되면 이중지수 구적법으로."""
    e = sympy.sympify(expr)
    a, b = sympy.sympify(a), sympy.sympify(b)
    steps = []
    try:
        F = sympy.integrate(e, var)
        if not F.has(sympy.Integral):
            val = sympy.simplify(F.subs(var, b) - F.subs(var, a))
            val = sympy.simplify(sympy.nsimplify(val, rational=False)) if val.has(sympy.Subs) else val
            if not val.free_symbols and not val.has(sympy.Integral):
                steps.append(f"부정적분 F({var}) = {pretty(F)} 를 구해 F(b) − F(a) 로 계산했습니다.")
                return Result(exact=sympy.simplify(val), value=_num(val), error=0.0,
                              method="exact", steps=steps)
    except Exception:
        pass
    try:
        val = sympy.integrate(e, (var, a, b))
        if not val.has(sympy.Integral) and not val.free_symbols:
            steps.append("SymPy 가 정적분을 기호로 계산했습니다.")
            return Result(exact=sympy.simplify(val), value=_num(val), error=0.0,
                          method="exact", steps=steps)
    except Exception:
        pass
    return quadrature(e, var, a, b, steps)


def quadrature(e, var, a, b, steps=None) -> Result:
    """이중지수(tanh–sinh) 구적법. 끝점에서 도함수가 발산해도 자릿수를 지킨다."""
    steps = list(steps or [])
    p = get_precision()
    f = sympy.lambdify(var, e, modules=["mpmath"])
    try:
        with workdps() as dps:
            lo_a = mpmath.mpf("-inf") if a == -sympy.oo else mpmath.mpf(str(sympy.N(a, dps)))
            hi_b = mpmath.mpf("inf") if b == sympy.oo else mpmath.mpf(str(sympy.N(b, dps)))
            v1, err = mpmath.quad(f, [lo_a, hi_b], error=True, method="tanh-sinh")
            v2 = mpmath.quad(f, [lo_a, hi_b], method="gauss-legendre")
            gap = abs(v1 - v2)
    except Exception as exc:
        return Result(note=f"적분을 구하지 못했습니다 ({exc})", steps=steps)
    # 내부 자릿수보다 작은 오차를 주장하지 않는다 — 그건 잰 것이 아니라 우연이다
    bound = float(max(abs(err), gap, mpmath.mpf(10) ** (-p.internal)))
    steps.append("부정적분을 구할 수 없어 이중지수(tanh–sinh) 구적법으로 계산했습니다. "
                 "끝점에서 함수가 발산해도 자릿수를 지키는 방법입니다.")
    steps.append("가우스–르장드르 구적법으로 한 번 더 계산해 두 값을 견주었습니다.")
    r = Result(value=v1, error=bound, method="quadrature", steps=steps)
    guess = _recognize(v1, bound)
    if guess is not None:
        r.note = f"{pretty(guess)} 로 보입니다 (수치에서 알아본 것이라 가설입니다)"
    return r


def limit(expr, var, at, direction: str = "+-") -> Result:
    """극한 — 좌우를 따로 보고, 다르면 없다고 말한다."""
    e = sympy.sympify(expr)
    at = sympy.sympify(at)
    steps = []
    try:
        if direction == "+-" and at.is_finite:
            L = sympy.limit(e, var, at, "-")
            R = sympy.limit(e, var, at, "+")
            if L != R:
                steps.append(f"왼쪽 극한 {pretty(L)}, 오른쪽 극한 {pretty(R)} 이 서로 다릅니다.")
                return Result(note="극한이 없습니다 (좌우가 다름)", method="exact", steps=steps)
            val = L
            steps.append("좌·우 극한을 따로 구해 서로 같은지 확인했습니다.")
        else:
            val = sympy.limit(e, var, at, direction if direction != "+-" else "+")
            steps.append("SymPy 로 극한을 기호 계산했습니다.")
    except Exception as exc:
        return Result(note=f"극한을 구하지 못했습니다 ({exc})")
    if val.has(sympy.AccumBounds):
        return Result(note="극한이 없습니다 (값이 모이지 않고 흔들립니다)",
                      method="exact", steps=steps)
    if val in (sympy.oo, -sympy.oo):
        return Result(exact=val, error=0.0, method="exact", steps=steps + ["값이 한없이 커집니다."])
    if val.free_symbols:
        return Result(exact=val, method="symbolic", steps=steps)
    return Result(exact=sympy.simplify(val), value=_num(val), error=0.0, method="exact", steps=steps)


def solve_exact(eq, var) -> tuple[list, str]:
    """방정식을 정확히 푼다. 못 풀면 수치로 찾아 '가설' 이라 적는다."""
    e = eq.lhs - eq.rhs if isinstance(eq, sympy.Eq) else sympy.sympify(eq)
    try:
        sols = sympy.solve(sympy.Eq(e, 0), var, dict=False)
        sols = [s for s in sols if getattr(s, "is_real", True) is not False]
        if sols:
            return sorted(set(sols), key=lambda s: (str(s.free_symbols), str(s))), "exact"
    except Exception:
        pass
    try:
        sols = list(sympy.solveset(sympy.Eq(e, 0), var, sympy.S.Reals))
        if sols:
            return sorted(sols, key=str), "exact"
    except Exception:
        pass
    return [], "none"


def numeric_fn(expr, args):
    """그림용 빠른 함수 (float64). 계산 결과로는 쓰지 않는다."""
    import numpy as np
    f = sympy.lambdify(args, expr, modules=["numpy", {"Abs": np.abs}])

    def safe(*a):
        try:
            with np.errstate(all="ignore"):
                v = f(*a)
            return v
        except Exception:
            return np.nan
    return safe


def _recognize(v, tol: float):
    """수치를 보고 π/2, √2, ln 2 같은 낯익은 값인지 짚어 본다 (어디까지나 가설)."""
    if tol <= 0 or not mpmath.isfinite(v):
        return None
    try:
        with workdps(30):
            ident = mpmath.identify(v, ["pi", "log(2)", "sqrt(2)", "sqrt(3)", "exp(1)"],
                                    tol=max(tol, mpmath.mpf(10) ** -25))
    except Exception:
        return None
    if not ident:
        return None
    try:
        return sympy.nsimplify(sympy.sympify(str(ident).replace("log", "ln")
                                             .replace("ln", "log")), rational=False)
    except Exception:
        return None
