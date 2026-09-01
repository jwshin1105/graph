"""점열 엔진 — Pₙ 은 곡선이 아니라 **점들**이다.

세 가지를 지킨다.

1. **필요한 항만 센다.** 화면에 n = 3‥40 만 들어온다면 400번째 항까지 굳이
   계산하지 않는다. xₙ 이 단조로우면 이분법으로 범위를 바로 찾고,
   그렇지 않으면 0 에서 바깥으로 넓혀 가며 화면을 벗어난 뒤에도 조금 더 본다.
2. **좌표는 정확하게.** (cos n, sin n) 의 좌표는 cos(3) 이라는 식 그대로 들고 있다가,
   그릴 때만 배정밀도로 낮춘다. 규칙을 찾을 때는 정확한 쪽을 쓴다.
3. **잇지 않는다.** 사용자가 잇자고 말하기 전에는 선을 긋지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy

from ..core.domain import Domain
from ..core.symbols import sym


@dataclass
class PointSequence:
    """Pₙ = (xₙ, yₙ), n ∈ 이산 정의역."""
    name: str = "P"
    index: sympy.Symbol = field(default_factory=lambda: sym("n"))
    x_rule: object = None
    y_rule: object = None
    domain: Domain = None
    connect: bool = False                 # 사용자가 이으라고 했는가
    seq_x: object = None                  # 점화식으로 정의된 경우
    seq_y: object = None
    _memo: dict = field(default_factory=dict, repr=False)

    def start(self) -> int:
        s = self.domain.start() if self.domain else None
        return int(s) if s is not None else 0

    def point(self, n: int):
        """n번째 점을 **정확한 좌표**로."""
        n = int(n)
        if n in self._memo:
            return self._memo[n]
        if self.domain and not self.domain.contains(n):
            return None
        try:
            if self.seq_x is not None:
                px = self.seq_x.term(n)
            else:
                px = sympy.simplify(self.x_rule.subs(self.index, n))
            if self.seq_y is not None:
                py = self.seq_y.term(n)
            else:
                py = sympy.simplify(self.y_rule.subs(self.index, n))
        except Exception:
            return None
        if px is None or py is None:
            return None
        self._memo[n] = (px, py)
        return self._memo[n]

    def points(self, lo: int, hi: int, cap: int = 4000):
        """번호 lo‥hi 의 점들. [(n, x, y)]"""
        out = []
        n = int(lo)
        hi = int(hi)
        while n <= hi and len(out) < cap:
            p = self.point(n)
            if p is not None:
                out.append((n, p[0], p[1]))
            n += 1
        return out

    # ── 뷰포트
    def _fx(self, n):
        p = self.point(n)
        if p is None:
            return None
        try:
            return float(sympy.re(p[0]))
        except Exception:
            return None

    def visible_range(self, view, max_points: int = 2000):
        """화면 view = (x0, x1, y0, y1) 에 들어오는 번호 범위를 찾는다."""
        x0, x1 = view[0], view[1]
        base = self.start()
        lo_limit = base if (self.domain and self.domain.lo is not None) or \
            (self.domain and self.domain.base is not sympy.S.Integers) else None

        mono = self._monotone_x()
        if mono:
            lo = self._search(x0, +1 if mono > 0 else -1, lo_limit)
            hi = self._search(x1, +1 if mono > 0 else -1, lo_limit)
            if mono < 0:
                lo, hi = hi, lo
        else:
            lo, hi = self._expand(view, lo_limit, max_points)
        if lo_limit is not None:
            lo = max(lo, lo_limit)
            hi = max(hi, lo)
        lo -= 1
        hi += 1
        if hi - lo > max_points:
            hi = lo + max_points
        return int(lo), int(hi)

    def _monotone_x(self):
        """xₙ 이 죽 늘거나 죽 주는가. 그러면 이분법으로 범위를 바로 찾는다."""
        if self.x_rule is None:
            return 0
        n = self.index
        try:
            d = sympy.simplify(self.x_rule.subs(n, n + 1) - self.x_rule)
            if d.is_number:
                return 1 if d > 0 else (-1 if d < 0 else 0)
            if d.free_symbols == {n}:
                if sympy.ask(sympy.Q.positive(d), sympy.Q.integer(n) & sympy.Q.positive(n)):
                    return 1
                if sympy.ask(sympy.Q.negative(d), sympy.Q.integer(n) & sympy.Q.positive(n)):
                    return -1
        except Exception:
            pass
        return 0

    def _search(self, target: float, direction: int, lo_limit):
        """xₙ = target 이 되는 번호를 이분법으로."""
        lo = lo_limit if lo_limit is not None else -1
        hi = lo + 1
        step = 1
        for _ in range(64):
            v = self._fx(hi)
            if v is None:
                break
            if (v - target) * direction >= 0:
                break
            lo, step = hi, step * 2
            hi = lo + step
        if lo_limit is None:
            lo2 = -1
            step = 1
            for _ in range(64):
                v = self._fx(lo2)
                if v is None:
                    break
                if (v - target) * direction <= 0:
                    break
                lo2 -= step
                step *= 2
            lo = lo2
        while hi - lo > 1:
            mid = (lo + hi) // 2
            v = self._fx(mid)
            if v is None:
                break
            if (v - target) * direction < 0:
                lo = mid
            else:
                hi = mid
        return hi

    def _expand(self, view, lo_limit, max_points):
        """단조롭지 않으면 가운데서 바깥으로 넓혀 간다."""
        x0, x1, y0, y1 = view
        inside = lambda p: p is not None and x0 <= _f(p[0]) <= x1 and y0 <= _f(p[1]) <= y1
        base = lo_limit if lo_limit is not None else 0
        lo = hi = base
        miss = 0
        n = base
        while n < base + max_points and miss < 200:
            p = self.point(n)
            if inside(p):
                hi = n
                miss = 0
            else:
                miss += 1
            n += 1
        if lo_limit is None:
            miss = 0
            n = base
            while n > base - max_points and miss < 200:
                p = self.point(n)
                if inside(p):
                    lo = n
                    miss = 0
                else:
                    miss += 1
                n -= 1
        return lo, hi

    def visible(self, view, max_points: int = 2000):
        lo, hi = self.visible_range(view, max_points)
        return self.points(lo, hi, cap=max_points)


def _f(v):
    try:
        return float(sympy.re(v))
    except Exception:
        return float("nan")
