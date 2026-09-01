"""AST — 파서가 내놓는 문장 층.

식 자체는 SymPy 식으로 두고(그래야 정확한 계산을 그대로 이어갈 수 있다),
그 식들이 무엇을 뜻하는지를 이 문장들이 감싼다.

    y = x^2 + 1        →  Definition('y', [], x**2 + 1)
    a_n = 2n - 1       →  Definition('a', [n], 2*n - 1)
    P(n) = (n, n^2)    →  Definition('P', [n], Tuple(n, n**2))
    x^2 + y^2 = 4      →  Relation('=', x**2 + y**2, 4)
    n ∈ Z              →  DomainDecl('n', Integers)
    precision = 60     →  Setting('precision', 60)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import sympy


class ListExpr(sympy.Tuple):
    """[1, 2, 3] — 순서 있는 목록. 점 (a, b) 와 구분하려고 따로 둔다."""


@dataclass
class Statement:
    text: str = ""                       # 사용자가 적은 그대로
    conditions: list = field(default_factory=list)   # {x > 0} 같은 제한
    domains: dict = field(default_factory=dict)      # {'n': Integers}


@dataclass
class Definition(Statement):
    """이름 = 식. 매개변수가 있으면 함수·수열·점열."""
    name: str = ""
    params: tuple = ()
    body: Any = None
    subscript: bool = False              # a_n 처럼 아래첨자로 적었는가


@dataclass
class Relation(Statement):
    """등식·부등식. op ∈ {=, <, >, <=, >=, !=}"""
    op: str = "="
    lhs: Any = None
    rhs: Any = None


@dataclass
class DomainDecl(Statement):
    var: str = ""
    domain: Any = None


@dataclass
class Setting(Statement):
    name: str = ""
    value: Any = None


@dataclass
class Bare(Statement):
    """그냥 계산할 식."""
    body: Any = None


class ParseError(ValueError):
    def __init__(self, message: str, pos: int = -1):
        super().__init__(message)
        self.message = message
        self.pos = pos
