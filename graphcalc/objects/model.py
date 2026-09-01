"""객체 — 사용자가 적은 한 줄이 무엇인지 가려낸다.

여기서 정한 유형이 그 뒤의 모든 것을 가른다. 특히 **이산이냐 연속이냐** 는
그림에서 점을 찍을지 선을 그을지를 결정하므로, 렌더링이 짐작하게 두지 않고
여기서 못을 박는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import sympy

from ..core import solution as S
from ..core.domain import Domain, apply_conditions, domain_of
from ..core.display import pretty
from ..core.syntax import Bare, Definition, DomainDecl, ListExpr, Relation, Setting, Statement
from .pointseq import PointSequence
from .sequence import Sequence

X, Y, T, R, THETA = sympy.symbols("x y t r theta")

KIND_NAMES = {
    "function": "함수 y = f(x)",
    "function_x": "함수 x = g(y)",
    "implicit": "음함수 F(x, y) = 0",
    "inequality": "부등식 (영역)",
    "parametric": "매개변수 곡선",
    "polar": "극좌표 곡선",
    "point": "점",
    "pointseq": "점열 Pₙ",
    "sequence": "수열 aₙ",
    "lattice": "이산 정의역 위의 해 (격자점)",
    "list": "점·값의 목록",
    "value": "값",
    "equation": "방정식",
    "setting": "설정",
    "domain": "정의역 선언",
    "error": "읽지 못한 식",
}

COLORS = ["#c74440", "#2d70b3", "#388c46", "#6042a6", "#fa7e19",
          "#000000", "#b8389c", "#0f9b8e"]


@dataclass
class MathObject:
    kind: str = "value"
    label: str = ""
    statement: Statement = None
    solution: S.SolutionSet = None
    domains: dict = field(default_factory=dict)
    expr: object = None            # 유형마다 뜻이 다르다 (아래 build 참고)
    var: object = None
    name: str = ""
    seq: Sequence = None
    pseq: PointSequence = None
    connect: bool = False
    color: str = "#2d70b3"
    visible: bool = True
    message: str = ""

    @property
    def discrete(self) -> bool:
        return bool(self.solution and self.solution.discrete)

    def kind_text(self) -> str:
        return KIND_NAMES.get(self.kind, self.kind)


class Context:
    """앞 줄에서 정의한 것들을 뒷 줄이 쓸 수 있게 모아 둔다."""

    def __init__(self):
        self.funcs: dict[str, tuple] = {}       # name → (params, body)
        self.seqs: dict[str, Sequence] = {}
        self.consts: dict[str, object] = {}
        self.domains: dict[str, object] = {}

    def names(self) -> set:
        return set(self.funcs) | set(self.seqs)

    def resolve(self, expr, depth: int = 0):
        """f(x) 같은 이름을 실제 식으로 펴 준다."""
        if expr is None or depth > 8:
            return expr
        e = sympy.sympify(expr)
        changed = True
        rounds = 0
        while changed and rounds < 8:
            changed = False
            rounds += 1
            for f in list(e.atoms(sympy.core.function.AppliedUndef)):
                nm = f.func.__name__
                if nm in self.funcs:
                    params, body = self.funcs[nm]
                    if len(params) == len(f.args):
                        e = e.subs(f, body.subs(dict(zip(params, f.args))))
                        changed = True
            for s in list(e.free_symbols):
                if s.name in self.consts:
                    e = e.subs(s, self.consts[s.name])
                    changed = True
        return e


def build(statements, ctx: Context | None = None):
    """문장 목록 → 객체 목록. 정의는 문맥에 쌓인다."""
    ctx = ctx or Context()
    objs = []
    # 아래첨자로 적힌 정의들은 규칙과 씨앗을 함께 모아야 한다
    pending: dict[str, list] = {}
    for st in statements:
        if isinstance(st, Definition) and st.subscript:
            pending.setdefault(st.name, []).append(st)
    seqs = {nm: _make_sequence(nm, group, ctx) for nm, group in pending.items()}
    ctx.seqs.update(seqs)

    used = set()
    for i, st in enumerate(statements):
        color = COLORS[i % len(COLORS)]
        if st is None:
            objs.append(None)
            continue
        if isinstance(st, Exception):
            objs.append(MathObject(kind="error", label="", statement=None,
                                   message=str(st), color=color, visible=False))
            continue
        if isinstance(st, Definition) and st.subscript:
            nm = st.name
            if nm in used:
                objs.append(MathObject(kind="sequence", label=st.text, statement=st,
                                       seq=seqs[nm], color=color, visible=False,
                                       message="위에서 정의한 수열의 일부입니다",
                                       solution=S.DiscretePoints(index=str(seqs[nm].index), sequence=True)))
                continue
            used.add(nm)
            objs.append(_sequence_object(st, seqs[nm], color))
            continue
        objs.append(classify(st, ctx, color))
    return objs


def _make_sequence(name, group, ctx) -> Sequence:
    """a_n = …  와  a_1 = 1  을 한 수열로 묶는다.

    어느 쪽이 규칙이고 어느 쪽이 씨앗인지는 **적힌 순서가 아니라 아래첨자의 모양**
    으로 가른다. a_1 = 1 을 뒤에 적었다고 그게 규칙이 되면 안 된다.
    """
    idx = sympy.Symbol("n")
    rule = None
    recurrence = None
    shift = 1
    seeds = {}
    for st in group:
        arg = st.params[0]
        body = ctx.resolve(st.body)
        if arg.is_Integer:
            seeds[int(arg)] = body
            continue
        # a_n = …  또는  a_{n+1} = …
        syms = arg.free_symbols
        if len(syms) != 1:
            continue
        v = next(iter(syms))
        idx = v
        off = sympy.simplify(arg - v)
        uses_self = any(f.func.__name__ == name for f in body.atoms(sympy.core.function.AppliedUndef))
        if off == 0 and not uses_self:
            rule = body
        else:
            recurrence = body
            shift = int(off) if off.is_Integer and off != 0 else 1
    return Sequence(name=name, index=idx, rule=rule, recurrence=recurrence,
                    shift=shift, seeds=seeds)


def _sequence_object(st, seq: Sequence, color) -> MathObject:
    dom = domain_of(str(seq.index), st.domains, index_hint=True)
    dom = apply_conditions(dom, st.conditions)
    seq.domain = dom
    return MathObject(kind="sequence", label=st.text, statement=st, seq=seq,
                      name=seq.name, var=seq.index, color=color,
                      domains={str(seq.index): dom},
                      connect=_wants_connect(st),
                      solution=S.DiscretePoints(index=str(seq.index), sequence=True,
                                                y_rule=seq.rule, domain=dom))


def _wants_connect(st) -> bool:
    t = (st.text or "").lower()
    return "connect" in t or "연결" in t or "이어" in t


def classify(st: Statement, ctx: Context, color="#2d70b3") -> MathObject:
    if isinstance(st, Setting):
        return MathObject(kind="setting", label=st.text, statement=st,
                          name=st.name, expr=st.value, color=color, visible=False)
    if isinstance(st, DomainDecl):
        ctx.domains[st.var] = st.domain
        return MathObject(kind="domain", label=st.text, statement=st,
                          name=st.var, expr=st.domain, color=color, visible=False,
                          domains={st.var: domain_of(st.var, {st.var: st.domain})})
    if isinstance(st, Definition):
        return _definition(st, ctx, color)
    if isinstance(st, Relation):
        return _relation(st, ctx, color)
    if isinstance(st, Bare):
        return _bare(st, ctx, color)
    return MathObject(kind="error", label=getattr(st, "text", ""), statement=st,
                      color=color, visible=False, message="무엇인지 알 수 없습니다")


def _declared(st, ctx):
    d = dict(ctx.domains)
    d.update(st.domains)
    return d


def _definition(st: Definition, ctx: Context, color) -> MathObject:
    body = ctx.resolve(st.body)
    declared = _declared(st, ctx)

    # P(n) = (…, …)  또는  C(t) = (…, …)
    if len(st.params) == 1 and isinstance(body, sympy.Tuple) and len(body) == 2:
        v = st.params[0]
        dom = apply_conditions(domain_of(v.name, declared, index_hint=v.name in ("n", "k", "m")),
                               st.conditions)
        ctx.funcs[st.name] = (st.params, body)
        if dom.discrete:
            ps = PointSequence(name=st.name, index=v, x_rule=body[0], y_rule=body[1],
                               domain=dom, connect=_wants_connect(st))
            return MathObject(kind="pointseq", label=st.text, statement=st, pseq=ps,
                              name=st.name, var=v, color=color, domains={v.name: dom},
                              connect=ps.connect, expr=body,
                              solution=S.DiscretePoints(index=v.name, x_rule=body[0],
                                                        y_rule=body[1], domain=dom))
        return MathObject(kind="parametric", label=st.text, statement=st, name=st.name,
                          var=v, expr=body, color=color, domains={v.name: dom},
                          solution=S.Curve(kind="parametric", expr=body, var=v.name,
                                           extra={"domain": dom}))

    # f(x) = …
    if len(st.params) == 1:
        v = st.params[0]
        ctx.funcs[st.name] = (st.params, body)
        dom = apply_conditions(domain_of(v.name, declared, index_hint=v.name in ("n", "k", "m")),
                               st.conditions)
        if dom.discrete:
            seq = Sequence(name=st.name, index=v, rule=body, domain=dom)
            ctx.seqs[st.name] = seq
            return MathObject(kind="sequence", label=st.text, statement=st, seq=seq,
                              name=st.name, var=v, color=color, domains={v.name: dom},
                              connect=_wants_connect(st),
                              solution=S.DiscretePoints(index=v.name, y_rule=body, domain=dom, sequence=True))
        return MathObject(kind="function", label=st.text, statement=st, name=st.name,
                          var=v, expr=body, color=color, domains={v.name: dom},
                          solution=S.Curve(kind="explicit", expr=body, var=v.name))

    if len(st.params) >= 2:
        ctx.funcs[st.name] = (st.params, body)
        return MathObject(kind="value", label=st.text, statement=st, name=st.name,
                          expr=body, color=color, visible=False,
                          message="변수가 둘 이상인 함수입니다",
                          solution=S.Value(result=body))

    # y = … / x = … / r = … / 이름 = 값
    if st.name == "y":
        if body.free_symbols <= {X}:
            dom = apply_conditions(domain_of("x", declared), st.conditions)
            return MathObject(kind="function", label=st.text, statement=st, name="y",
                              var=X, expr=body, color=color, domains={"x": dom},
                              solution=S.Curve(kind="explicit", expr=body, var="x"))
        return _relation(Relation(text=st.text, conditions=st.conditions,
                                  domains=st.domains, op="=", lhs=Y, rhs=body), ctx, color)
    if st.name == "x" and body.free_symbols <= {Y}:
        return MathObject(kind="function_x", label=st.text, statement=st, name="x",
                          var=Y, expr=body, color=color,
                          solution=S.Curve(kind="explicit", expr=body, var="y"))
    if st.name in ("r", "ρ") and body.free_symbols <= {THETA, sympy.Symbol("t")}:
        v = THETA if THETA in body.free_symbols else sympy.Symbol("t")
        return MathObject(kind="polar", label=st.text, statement=st, name="r", var=v,
                          expr=body, color=color,
                          solution=S.Curve(kind="polar", expr=body, var=str(v)))
    ctx.consts[st.name] = body
    return MathObject(kind="value", label=st.text, statement=st, name=st.name,
                      expr=body, color=color, visible=False,
                      solution=S.Value(result=body))


def _relation(st: Relation, ctx: Context, color) -> MathObject:
    lhs = ctx.resolve(st.lhs)
    rhs = ctx.resolve(st.rhs)
    diff = sympy.together(lhs - rhs) if st.op != "∈" else None
    free = (lhs.free_symbols | rhs.free_symbols)
    declared = _declared(st, ctx)
    doms = {s.name: apply_conditions(domain_of(s.name, declared), st.conditions) for s in free}

    if st.op in ("<", ">", "<=", ">="):
        # ≥ 0 이면 참인 식으로 맞춘다
        expr = (rhs - lhs) if st.op in ("<", "<=") else (lhs - rhs)
        strict = st.op in ("<", ">")
        return MathObject(kind="inequality", label=st.text, statement=st, expr=expr,
                          color=color, domains=doms,
                          solution=S.Region(expr=expr, strict=strict))

    if st.op == "=":
        if any(d.discrete for d in doms.values()) and len(free) >= 1:
            return MathObject(kind="lattice", label=st.text, statement=st, expr=diff,
                              color=color, domains=doms,
                              solution=S.Lattice(equation=diff, domains=doms))
        if len(free) == 1:
            v = next(iter(free))
            return MathObject(kind="equation", label=st.text, statement=st, expr=diff,
                              var=v, color=color, domains=doms,
                              solution=S.PointSet())
        if free >= {X, Y} or len(free) == 2:
            return MathObject(kind="implicit", label=st.text, statement=st, expr=diff,
                              color=color, domains=doms,
                              solution=S.Curve(kind="implicit", expr=diff))
        return MathObject(kind="equation", label=st.text, statement=st, expr=diff,
                          color=color, domains=doms, solution=S.PointSet())

    return MathObject(kind="error", label=st.text, statement=st, color=color,
                      visible=False, message="다루지 못하는 관계입니다")


def _bare(st: Bare, ctx: Context, color) -> MathObject:
    body = ctx.resolve(st.body)
    declared = _declared(st, ctx)

    if isinstance(body, ListExpr):
        items = list(body)
        if items and all(isinstance(v, sympy.Tuple) and len(v) == 2 for v in items):
            pts = [(v[0], v[1]) for v in items]
            return MathObject(kind="list", label=st.text, statement=st, expr=pts,
                              color=color, connect=_wants_connect(st),
                              solution=S.PointSet(points=pts))
        pts = [(sympy.Integer(i + 1), v) for i, v in enumerate(items)]
        seq = Sequence(name="a", index=sympy.Symbol("n"),
                       seeds={i + 1: v for i, v in enumerate(items)},
                       domain=Domain("n", sympy.S.Naturals))
        return MathObject(kind="sequence", label=st.text, statement=st, seq=seq,
                          expr=items, color=color, connect=_wants_connect(st),
                          domains={"n": seq.domain},
                          solution=S.PointSet(points=pts))

    if isinstance(body, sympy.Tuple) and len(body) == 2:
        return MathObject(kind="point", label=st.text, statement=st,
                          expr=(body[0], body[1]), color=color,
                          solution=S.PointSet(points=[(body[0], body[1])]))

    if isinstance(body, sympy.FiniteSet):
        pts = [(v[0], v[1]) for v in body if isinstance(v, sympy.Tuple) and len(v) == 2]
        if pts:
            return MathObject(kind="list", label=st.text, statement=st, expr=pts,
                              color=color, solution=S.PointSet(points=pts))
        return MathObject(kind="value", label=st.text, statement=st, expr=body,
                          color=color, visible=False, solution=S.Value(result=body))

    free = body.free_symbols
    if not free:
        return MathObject(kind="value", label=st.text, statement=st, expr=body,
                          color=color, visible=False, solution=S.Value(result=body))
    if free == {X}:
        dom = apply_conditions(domain_of("x", declared), st.conditions)
        if dom.discrete:
            seq = Sequence(name="a", index=X, rule=body, domain=dom)
            return MathObject(kind="sequence", label=st.text, statement=st, seq=seq,
                              var=X, color=color, domains={"x": dom},
                              solution=S.DiscretePoints(index="x", y_rule=body, domain=dom, sequence=True))
        return MathObject(kind="function", label=st.text, statement=st, name="y",
                          var=X, expr=body, color=color, domains={"x": dom},
                          solution=S.Curve(kind="explicit", expr=body, var="x"))
    if len(free) == 1:
        v = next(iter(free))
        dom = apply_conditions(domain_of(v.name, declared), st.conditions)
        if dom.discrete:
            seq = Sequence(name="a", index=v, rule=body, domain=dom)
            return MathObject(kind="sequence", label=st.text, statement=st, seq=seq,
                              var=v, color=color, domains={v.name: dom},
                              solution=S.DiscretePoints(index=v.name, y_rule=body, domain=dom, sequence=True))
    return MathObject(kind="value", label=st.text, statement=st, expr=body, color=color,
                      visible=False, message="변수가 남아 있습니다",
                      solution=S.Value(result=body))
