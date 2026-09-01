"""정의역 — 어떤 값들 위에서 이야기하고 있는가.

`n ∈ ℤ` 냐 `x ∈ ℝ` 냐는 그림이 완전히 달라진다. 앞은 **점들**이고 뒤는 **곡선**이다.
이 모듈은 그 갈림을 한 곳에서 관리한다. 렌더링이 알아서 짐작하게 두면
점열을 선으로 이어 버리는 잘못이 생긴다.
"""

from __future__ import annotations

from dataclasses import dataclass

import sympy

DISCRETE = (sympy.S.Integers, sympy.S.Naturals, sympy.S.Naturals0)

NAMES = {
    sympy.S.Integers: "ℤ (정수)",
    sympy.S.Naturals: "ℕ (자연수)",
    sympy.S.Naturals0: "ℕ₀ (0 이상의 정수)",
    sympy.S.Rationals: "ℚ (유리수)",
    sympy.S.Reals: "ℝ (실수)",
    sympy.S.Complexes: "ℂ (복소수)",
}

# 아래첨자로 쓰이는 이름은 아무 말이 없으면 정수로 본다 —  aₙ, Pₙ 의 n
INDEX_NAMES = {"n", "k", "m", "i", "j", "ℓ"}


@dataclass(frozen=True)
class Domain:
    """변수 하나의 정의역."""
    var: str
    base: object = sympy.S.Reals
    lo: object = None          # 아래 끝 (닫힌 구간)
    hi: object = None
    implied: bool = False      # 사용자가 적지 않고 우리가 짐작한 것인가

    @property
    def discrete(self) -> bool:
        return self.base in DISCRETE

    @property
    def countable(self) -> bool:
        return self.discrete or self.base is sympy.S.Rationals

    def text(self) -> str:
        base = NAMES.get(self.base, str(self.base))
        if self.lo is None and self.hi is None:
            s = f"{self.var} ∈ {base}"
        else:
            from .display import pretty
            lo = pretty(self.lo) if self.lo is not None else "−∞"
            hi = pretty(self.hi) if self.hi is not None else "∞"
            s = f"{self.var} ∈ {base}, {lo} ≤ {self.var} ≤ {hi}"
        return s + (" (기본값)" if self.implied else "")

    def contains(self, v) -> bool:
        if self.lo is not None and v < self.lo:
            return False
        if self.hi is not None and v > self.hi:
            return False
        if self.base is sympy.S.Integers:
            return int(v) == v
        if self.base is sympy.S.Naturals:
            return int(v) == v and v >= 1
        if self.base is sympy.S.Naturals0:
            return int(v) == v and v >= 0
        return True

    def start(self):
        """이산 정의역에서 첫 항의 번호."""
        if self.lo is not None:
            return sympy.ceiling(self.lo)
        if self.base is sympy.S.Naturals:
            return sympy.Integer(1)
        if self.base is sympy.S.Naturals0:
            return sympy.Integer(0)
        return sympy.Integer(1) if self.base is sympy.S.Integers else None


def domain_of(var: str, declared: dict | None = None, *, index_hint: bool = False) -> Domain:
    """선언된 것이 있으면 그것을, 없으면 이름과 쓰임새로 짐작한다."""
    declared = declared or {}
    if var in declared:
        d = declared[var]
        if isinstance(d, Domain):
            return d
        lo = hi = None
        base = d
        if isinstance(d, sympy.Interval):
            base, lo, hi = sympy.S.Reals, d.start, d.end
        elif isinstance(d, sympy.Range):
            base, lo, hi = sympy.S.Integers, d.start, d.stop - 1
        return Domain(var, base, lo, hi)
    if index_hint or var in INDEX_NAMES:
        return Domain(var, sympy.S.Integers, implied=True)
    return Domain(var, sympy.S.Reals, implied=True)


def bounds_from_conditions(var: str, conditions) -> tuple:
    """조건들에서 var 의 위·아래 끝을 뽑아낸다. (1 ≤ n ≤ 20 같은 것)"""
    lo = hi = None
    s = sympy.Symbol(var)
    for c in conditions or ():
        if not isinstance(c, sympy.core.relational.Relational):
            continue
        for rel in (c, c.reversed):
            if rel.lhs == s and not rel.rhs.free_symbols:
                if isinstance(rel, (sympy.GreaterThan, sympy.StrictGreaterThan)):
                    v = rel.rhs + (1 if isinstance(rel, sympy.StrictGreaterThan) else 0)
                    lo = v if lo is None else sympy.Max(lo, v)
                if isinstance(rel, (sympy.LessThan, sympy.StrictLessThan)):
                    v = rel.rhs - (1 if isinstance(rel, sympy.StrictLessThan) else 0)
                    hi = v if hi is None else sympy.Min(hi, v)
                break
    return lo, hi


def apply_conditions(dom: Domain, conditions) -> Domain:
    lo, hi = bounds_from_conditions(dom.var, conditions)
    if lo is None and hi is None:
        return dom
    return Domain(dom.var, dom.base,
                  lo if lo is not None else dom.lo,
                  hi if hi is not None else dom.hi, dom.implied)


def natural_domain(expr, var: sympy.Symbol):
    """식이 실수로 정의되는 곳. 못 구하면 ℝ 로 둔다."""
    try:
        return sympy.calculus.util.continuous_domain(expr, var, sympy.S.Reals)
    except Exception:
        return sympy.S.Reals


def singularities(expr, var: sympy.Symbol):
    """정의되지 않는 점들 (분모 0, ln 0 …). 못 구하면 빈 집합."""
    try:
        s = sympy.singularities(expr, var, sympy.S.Reals)
        return s if isinstance(s, sympy.Set) else sympy.S.EmptySet
    except Exception:
        return sympy.S.EmptySet


def domain_text(expr, var: sympy.Symbol) -> str:
    d = natural_domain(expr, var)
    if d == sympy.S.Reals:
        return "ℝ 전체"
    from .display import pretty
    try:
        gaps = sympy.S.Reals - d
        if gaps.is_FiniteSet and len(gaps) <= 6:
            return "ℝ, 단 " + ", ".join(f"{var} ≠ {pretty(g)}" for g in sorted(gaps, key=str)) + " 제외"
    except Exception:
        pass
    from .display import set_text
    return set_text(d)
