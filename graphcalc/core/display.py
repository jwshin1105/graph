"""표시 — 계산한 값을 사람이 읽는 글로.

여기서 하는 반올림은 **화면에만** 쓴다. 이 모듈이 내놓은 문자열이 다시 계산으로
들어가는 길은 없다. 그래서 표시 자릿수를 12 로 두든 3 으로 두든 내부 계산의
정확도는 그대로다.
"""

from __future__ import annotations

import re

import mpmath
import sympy
from sympy.printing.str import StrPrinter

from .precision import get_precision, workdps

SUP = str.maketrans("0123456789+-n", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻ⁿ")
SUB = str.maketrans("0123456789+-", "₀₁₂₃₄₅₆₇₈₉₊₋")


def _sup(s: str) -> str | None:
    return s.translate(SUP) if all(c in "0123456789+-n" for c in s) else None


class MathPrinter(StrPrinter):
    """√2, π, x², 3/10 처럼 수학책에 가까운 모양으로 적는다."""

    def _print_Pow(self, expr):
        b, e = expr.base, expr.exp
        if e == sympy.Rational(1, 2):
            return f"√{self._paren_atom(b)}"
        if e == -sympy.Rational(1, 2):
            return f"1/√{self._paren_atom(b)}"
        if e.is_Rational and e.q == 3 and e.p == 1:
            return f"∛{self._paren_atom(b)}"
        if e.is_Integer and e < 0:
            inner = b if -e == 1 else sympy.Pow(b, -e, evaluate=False)
            t = self.doprint(inner)
            return f"1/({t})" if (inner.is_Add or inner.is_Mul) else f"1/{t}"
        s = self._sup_of(e)
        if s is not None:
            return f"{self._paren_atom(b)}{s}"
        return f"{self._paren_atom(b)}^{self._paren_atom(e)}"

    def _sup_of(self, e):
        if e.is_Integer:
            return _sup(str(e))
        if e.is_Symbol:
            return _sup(e.name)
        return None

    def _paren_atom(self, e):
        s = self.doprint(e)
        if e.is_Rational and not e.is_Integer:
            return f"({s})"                       # e^(3/2) 이지 e^3/2 가 아니다
        if e.is_Number and e < 0:
            return f"({s})"
        if e.is_Atom or (e.is_Function and not e.args[0].is_Add):
            return s
        if e.is_Pow or e.is_Mul or e.is_Add:
            return f"({s})"
        return s

    def _print_Rational(self, expr):
        return f"{expr.p}/{expr.q}"

    def _print_Exp1(self, expr):
        return "e"

    def _print_Pi(self, expr):
        return "π"

    def _print_Infinity(self, expr):
        return "∞"

    def _print_NegativeInfinity(self, expr):
        return "−∞"

    def _print_ImaginaryUnit(self, expr):
        return "i"

    def _print_Abs(self, expr):
        return f"|{self.doprint(expr.args[0])}|"

    def _print_exp(self, expr):
        a = expr.args[0]
        sup = self._sup_of(a)
        return f"e{sup}" if sup is not None else f"e^{self._paren_atom(a)}"

    def _print_log(self, expr):
        if len(expr.args) == 1:
            return f"ln({self.doprint(expr.args[0])})"
        return f"log_{self.doprint(expr.args[1])}({self.doprint(expr.args[0])})"

    def _print_AppliedUndef(self, expr):
        name = expr.func.__name__
        if len(expr.args) == 1:
            a = self.doprint(expr.args[0])
            sub = a.translate(SUB) if all(c in "0123456789+-" for c in a) else None
            if sub is not None:
                return f"{name}{sub}"
        return f"{name}({', '.join(self.doprint(a) for a in expr.args)})"

    def _print_Tuple(self, expr):
        return "(" + ", ".join(self.doprint(a) for a in expr.args) + ")"

    def _print_Mul(self, expr):
        s = super()._print_Mul(expr).replace("*", "·")
        # 계수와 문자 사이의 곱셈점은 지운다:  2·x → 2x
        return re.sub(r"(\d)·(?=[^\d])", r"\1", s)


_printer = MathPrinter()


def pretty(expr) -> str:
    """식을 그대로(정확하게) 적는다."""
    if expr is None:
        return ""
    if isinstance(expr, str):
        return expr
    if isinstance(expr, (list, tuple)):
        return "(" + ", ".join(pretty(e) for e in expr) + ")"
    try:
        return _printer.doprint(sympy.sympify(expr))
    except Exception:
        return str(expr)


def approx(expr, digits: int | None = None) -> str | None:
    """고정밀로 값을 구한 뒤 **표시 자릿수만큼만** 잘라 적는다."""
    d = digits or get_precision().display
    try:
        e = sympy.sympify(expr)
    except Exception:
        return None
    if e.free_symbols:
        return None
    with workdps() as dps:
        try:
            v = sympy.N(e, dps)
            if v.has(sympy.zoo) or v.has(sympy.nan):
                return None
            c = complex(v)
        except Exception:
            return None
        if abs(c.imag) > 1e-20 * max(1.0, abs(c.real)):
            return f"{fmt_mp(mpmath.mpf(c.real), d)} + {fmt_mp(mpmath.mpf(c.imag), d)}i"
        try:
            m = mpmath.mpf(sympy.re(v).evalf(dps))
        except Exception:
            return None
        return fmt_mp(m, d)


def fmt_mp(v, digits: int) -> str:
    """mpmath 수를 유효자릿수 digits 로. 뒤에 붙는 0 은 지운다."""
    if mpmath.isnan(v):
        return "정의되지 않음"
    if mpmath.isinf(v):
        return "∞" if v > 0 else "−∞"
    if v == 0:
        return "0"
    s = mpmath.nstr(v, digits, strip_zeros=True, min_fixed=-4, max_fixed=digits + 4)
    if s.endswith(".0"):
        s = s[:-2]
    return s.replace("-", "−") if s.startswith("-") else s


def value_text(expr, digits: int | None = None) -> str:
    """정확한 모양과 근삿값을 함께.  '√2 ≈ 1.41421356237'"""
    exact = pretty(expr)
    a = approx(expr, digits)
    if a is None or a == exact:
        return exact
    # 유리수·정수는 근삿값을 덧붙일 값어치가 없다
    e = sympy.sympify(expr)
    if e.is_Integer:
        return exact
    return f"{exact} ≈ {a}"


def set_text(s) -> str:
    """집합을 수학 표기로.  Interval(0, oo) → [0, ∞)"""
    import sympy as sp
    if s is sp.S.Reals:
        return "ℝ"
    if s is sp.S.EmptySet:
        return "∅"
    if isinstance(s, sp.Interval):
        lo = "−∞" if s.start == -sp.oo else pretty(s.start)
        hi = "∞" if s.end == sp.oo else pretty(s.end)
        L = "(" if s.left_open or s.start == -sp.oo else "["
        R = ")" if s.right_open or s.end == sp.oo else "]"
        return f"{L}{lo}, {hi}{R}"
    if isinstance(s, sp.Union):
        return " ∪ ".join(set_text(a) for a in s.args)
    if isinstance(s, sp.Intersection):
        return " ∩ ".join(set_text(a) for a in s.args)
    if isinstance(s, sp.Complement):
        return f"{set_text(s.args[0])} ∖ {set_text(s.args[1])}"
    if isinstance(s, sp.ImageSet):
        lam = s.lamda
        v = lam.variables[0]
        body = pretty(lam.expr).replace(str(v), "n")
        return "{" + body + " : n ∈ ℤ}"
    if isinstance(s, sp.ConditionSet):
        return "{" + pretty(s.sym) + " : " + pretty(s.condition) + "}"
    if isinstance(s, sp.FiniteSet):
        return "{" + ", ".join(pretty(a) for a in sorted(s, key=str)) + "}"
    from .domain import NAMES
    return NAMES.get(s, str(s))
