"""수열 — 번호마다 값 하나. 닫힌 식으로 적히기도 하고, 점화식으로 적히기도 한다.

항은 **정확한 값**으로 계산해 기억해 둔다. aₙ = (1+√5)/2 처럼 무리수인 항을
부동소수로 눌러 두면 나중에 규칙을 찾을 때 그 오차가 그대로 방해가 된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy

from ..core.domain import Domain
from ..core.symbols import sym


@dataclass
class Sequence:
    """aₙ. rule 이 있으면 닫힌 식, recurrence 가 있으면 점화식."""
    name: str = "a"
    index: sympy.Symbol = field(default_factory=lambda: sym("n"))
    rule: object = None                     # aₙ = f(n)
    recurrence: object = None               # a_{n+k} = … (이동량 shift 만큼 앞의 항으로)
    shift: int = 1
    seeds: dict = field(default_factory=dict)   # {1: 1, 2: 1}
    domain: Domain = None
    _memo: dict = field(default_factory=dict, repr=False)

    # ── 항
    def start(self) -> int:
        if self.seeds:
            return min(self.seeds)
        s = self.domain.start() if self.domain else None
        return int(s) if s is not None else 1

    def term(self, n: int):
        """n번째 항을 **정확하게**."""
        n = int(n)
        if n in self._memo:
            return self._memo[n]
        if n in self.seeds:
            v = sympy.sympify(self.seeds[n])
            self._memo[n] = v
            return v
        if self.rule is not None:
            v = _simp(self.rule.subs(self.index, n))
            self._memo[n] = v
            return v
        if self.recurrence is not None:
            v = self._from_recurrence(n)
            self._memo[n] = v
            return v
        return None

    def _from_recurrence(self, n: int):
        """a_{n+shift} = F(a_n, …) 을 앞에서부터 굴린다."""
        base = self.start()
        if n < base:
            return None
        # 씨앗 다음부터 차례로 채운다
        need = [k for k in range(base, n + 1) if k not in self._memo and k not in self.seeds]
        for k in need:
            src = k - self.shift
            expr = self.recurrence.subs(self.index, src)
            expr = self._resolve(expr, k)
            if expr is None:
                return None
            self._memo[k] = _simp(expr)
        return self._memo.get(n)

    def _resolve(self, expr, upto: int):
        """식 안의 a(j) 를 이미 아는 항으로 바꿔 끼운다."""
        for f in sorted(expr.atoms(sympy.core.function.AppliedUndef), key=str):
            if f.func.__name__ != self.name:
                continue
            j = f.args[0]
            if not j.is_Integer:
                return None
            j = int(j)
            v = self.seeds.get(j, self._memo.get(j))
            if v is None:
                if j < upto:
                    v = self.term(j)
                if v is None:
                    return None
            expr = expr.subs(f, v)
        return expr

    def terms(self, count: int = 12, start: int | None = None):
        """앞에서부터 count 개. [(n, 값)]"""
        s = self.start() if start is None else int(start)
        out = []
        n = s
        while len(out) < count:
            if self.domain and not self.domain.contains(n):
                n += 1
                if n > s + 10 * count + 100:
                    break
                continue
            v = self.term(n)
            if v is None:
                break
            out.append((n, v))
            n += 1
        return out

    def values(self, count: int = 12):
        return [v for _, v in self.terms(count)]

    # ── 닫힌 식
    def closed_form(self):
        """점화식으로 적힌 수열의 일반항을 구해 본다 (SymPy rsolve)."""
        if self.rule is not None:
            return self.rule
        if self.recurrence is None:
            return None
        n = self.index
        a = sympy.Function(self.name)
        try:
            eq = a(n + self.shift) - self.recurrence
            sol = sympy.rsolve(eq, a(n), {a(k): sympy.sympify(v) for k, v in self.seeds.items()})
        except Exception:
            return None
        if sol is None:
            return None
        try:
            return sympy.simplify(sympy.expand(sol))
        except Exception:
            return sol


def _simp(v):
    try:
        s = sympy.simplify(v)
        return sympy.nsimplify(s) if s.is_Float else s
    except Exception:
        return v
