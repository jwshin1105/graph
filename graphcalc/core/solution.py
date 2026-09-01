"""해집합 — "이 식이 뜻하는 점들의 모임" 을 수학적으로 적어 둔다.

그림을 그리기 **전에** 무엇을 그릴 것인지가 정해져 있어야 한다. 그래야
`P(n) = (n, sin n), n ∈ ℤ` 를 곡선으로 이어 버리는 잘못이 생기지 않는다.
샘플링은 이 표현을 화면에 옮기는 마지막 단계일 뿐이고, 여기 적힌 성질
(이산인가 연속인가, 유한인가 무한인가)을 바꾸지 못한다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy


@dataclass
class SolutionSet:
    """해집합의 밑바탕. discrete 가 참이면 점으로 그린다."""
    discrete: bool = False
    finite: bool = False
    note: str = ""

    def describe(self) -> str:
        return "해집합"


@dataclass
class Empty(SolutionSet):
    finite: bool = True

    def describe(self) -> str:
        return "빈 집합 — 조건을 만족하는 점이 없습니다"


@dataclass
class PointSet(SolutionSet):
    """유한개의 점. 좌표는 **정확한 식** 으로 들고 있는다."""
    points: list = field(default_factory=list)     # [(sympy, sympy), …]
    discrete: bool = True
    finite: bool = True

    def describe(self) -> str:
        return f"점 {len(self.points)}개"


@dataclass
class DiscretePoints(SolutionSet):
    """번호로 매겨지는 점들 — 점열. 끝이 없을 수 있으므로 필요한 항만 꺼내 쓴다."""
    index: str = "n"
    x_rule: object = None
    y_rule: object = None
    domain: object = None                       # core.domain.Domain
    discrete: bool = True
    sequence: bool = False                      # 수열(값 하나)인가 점열(점 하나)인가

    def describe(self) -> str:
        if self.sequence:
            return f"수열 — 번호 {self.index} 마다 값 하나, 그래프에서는 점 ({self.index}, a_{self.index})"
        return f"점열 — 번호 {self.index} 마다 점 하나 (선으로 잇지 않습니다)"


@dataclass
class Curve(SolutionSet):
    """연속인 곡선. kind ∈ {explicit, implicit, parametric, polar}"""
    kind: str = "explicit"
    expr: object = None
    var: str = "x"
    extra: dict = field(default_factory=dict)

    def describe(self) -> str:
        return {"explicit": "함수의 그래프 (연속인 곡선)",
                "implicit": "음함수 곡선 F(x, y) = 0",
                "parametric": "매개변수 곡선",
                "polar": "극좌표 곡선"}.get(self.kind, "곡선")


@dataclass
class Region(SolutionSet):
    """부등식이 정하는 영역 (넓이를 가진 부분)."""
    expr: object = None          # ≥ 0 이면 참인 식
    strict: bool = False

    def describe(self) -> str:
        return "부등식이 정하는 영역"


@dataclass
class Lattice(SolutionSet):
    """격자점 해 — 정수해처럼 이산인 정의역 위의 해."""
    equation: object = None
    domains: dict = field(default_factory=dict)
    discrete: bool = True

    def describe(self) -> str:
        return "이산 정의역 위의 해 (격자점)"


@dataclass
class Value(SolutionSet):
    """수 하나."""
    result: object = None
    finite: bool = True
    discrete: bool = True

    def describe(self) -> str:
        return "값"


def as_finite_points(sol: SolutionSet, limit: int = 400):
    """해집합에서 실제 점 목록을 뽑는다 (뽑을 수 있는 것만)."""
    if isinstance(sol, PointSet):
        return list(sol.points[:limit])
    return []


def float_points(points):
    """정확한 좌표를 그림용 배정밀도로. **정확값은 그대로 남겨 둔다.**"""
    out = []
    for px, py in points:
        try:
            fx, fy = float(sympy.re(px)), float(sympy.re(py))
        except Exception:
            continue
        if fx == fx and fy == fy:
            out.append((fx, fy))
    return out
