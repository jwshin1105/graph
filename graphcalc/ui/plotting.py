"""그리기 거리 만들기 — 수학 층에서 화면 층으로 넘어가는 다리.

**렌더링은 정확도를 낮추지 못한다.** 이 모듈은 이미 정해진 해집합을 화면 크기와
허용 오차에 맞춰 선분과 점으로 옮길 뿐, 무엇을 그릴지는 바꾸지 않는다.
이산인 것은 여기서도 점으로 남고, 좌표는 마지막 순간에야 배정밀도가 된다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import sympy

from ..core.evaluate import numeric_fn
from ..core.precision import get_precision
from ..core.symbols import X, Y
from ..engine.curves import sample_explicit, sample_parametric, sample_polar
from ..engine.implicit import trace_implicit
from ..engine.region import region as region_mask
from ..objects.model import MathObject


@dataclass
class Drawing:
    paths: list = field(default_factory=list)     # [np.ndarray (m,2)]
    points: list = field(default_factory=list)    # [(x, y)] 화면에 찍을 점
    region: object = None                         # bool 배열
    extent: tuple = None
    color: str = "#2d70b3"
    connect: bool = False
    label: str = ""
    message: str = ""
    discrete: bool = False
    stats: dict = field(default_factory=dict)


def draw(obj: MathObject, view, width=900, height=650) -> Drawing:
    if obj is None or not obj.visible:
        return Drawing()
    eps = get_precision().epsilon
    d = Drawing(color=obj.color, label=obj.label, connect=obj.connect,
                discrete=obj.discrete)
    try:
        _draw_into(d, obj, view, width, height, eps)
    except Exception as exc:                       # 그리다 실패해도 앱은 살아 있어야 한다
        d.message = f"그리지 못했습니다: {exc}"
    return d


def _draw_into(d, obj, view, width, height, eps):
    k = obj.kind
    x0, x1, y0, y1 = view

    if k == "function":
        f = numeric_fn(obj.expr, (obj.var,))
        s = sample_explicit(f, x0, x1, view=view, epsilon_px=eps,
                            width=width, height=height)
        d.paths = s.paths
        d.stats = {"조각": len(s.paths), "계산 횟수": s.evals}
        return

    if k == "function_x":
        f = numeric_fn(obj.expr, (obj.var,))
        s = sample_explicit(f, y0, y1, view=(y0, y1, x0, x1), epsilon_px=eps,
                            width=height, height=width)
        d.paths = [p[:, ::-1].copy() for p in s.paths]
        return

    if k == "implicit":
        f = numeric_fn(obj.expr, (X, Y))
        t = trace_implicit(lambda A, B: f(A, B), view, epsilon_px=eps,
                           width=width, height=height)
        d.paths = t.paths
        d.points = t.points
        d.stats = {"조각": len(t.paths), "칸": t.cells, "세분 깊이": t.max_level}
        return

    if k == "inequality":
        f = numeric_fn(obj.expr, (X, Y))
        r = region_mask(lambda A, B: f(A, B), view, strict=obj.solution.strict,
                        width=width, height=height)
        d.region = r.mask
        d.extent = r.extent
        # 테두리도 함께 그린다
        t = trace_implicit(lambda A, B: f(A, B), view, epsilon_px=eps,
                           width=width, height=height)
        d.paths = t.paths
        return

    if k == "parametric":
        t0, t1 = _param_range(obj, 0, 2 * np.pi)
        fx = numeric_fn(obj.expr[0], (obj.var,))
        fy = numeric_fn(obj.expr[1], (obj.var,))
        s = sample_parametric(fx, fy, t0, t1, view=view, epsilon_px=eps,
                              width=width, height=height)
        d.paths = s.paths
        return

    if k == "polar":
        t0, t1 = _param_range(obj, 0, 2 * np.pi)
        fr = numeric_fn(obj.expr, (obj.var,))
        s = sample_polar(fr, t0, t1, view=view, epsilon_px=eps,
                         width=width, height=height)
        d.paths = s.paths
        return

    if k == "pointseq":
        pts = obj.pseq.visible(view, max_points=400)
        d.points = [(float(sympy.re(x)), float(sympy.re(y))) for _, x, y in pts]
        d.stats = {"보이는 점": len(d.points)}
        if len(d.points) >= 400:
            d.message = "점이 많아 400개까지만 그렸습니다"
        if obj.connect and len(d.points) >= 2:
            d.paths = [np.array(d.points, dtype=float)]
        return

    if k == "sequence":
        seq = obj.seq
        lo = seq.start()
        hi = int(min(x1 + 1, lo + 4000))
        lo = int(max(lo, x0 - 1))
        vals = []
        n = lo
        while n <= hi and len(vals) < 1200:
            v = seq.term(n)
            if v is not None and seq.domain is None or (seq.domain and seq.domain.contains(n)):
                v = seq.term(n)
                if v is not None:
                    try:
                        vals.append((float(n), float(sympy.re(v))))
                    except Exception:
                        pass
            n += 1
        d.points = vals
        d.stats = {"보이는 항": len(vals)}
        if obj.connect and len(vals) >= 2:
            d.paths = [np.array(vals, dtype=float)]
        return

    if k in ("point", "list"):
        pts = getattr(obj.solution, "points", [])
        d.points = [(float(sympy.re(a)), float(sympy.re(b))) for a, b in pts]
        if obj.connect and len(d.points) >= 2:
            d.paths = [np.array(d.points, dtype=float)]
        return

    if k == "lattice":
        from ..engine.lattice import integer_solutions
        vs = sorted(obj.expr.free_symbols, key=lambda s: s.name)
        if len(vs) == 2:
            sols, note = integer_solutions(obj.expr, vs[0], vs[1], view, obj.domains)
            d.points = [(float(a), float(b)) for a, b in sols]
            d.message = note
            d.stats = {"정수해": len(sols)}
        return

    if k == "equation":
        from ..core.evaluate import solve_exact
        sols, _ = solve_exact(sympy.Eq(obj.expr, 0), obj.var)
        d.points = []
        for s in sols[:40]:
            try:
                d.points.append((float(sympy.re(s)), 0.0))
            except Exception:
                pass
        return


def _param_range(obj, lo, hi):
    dom = obj.domains.get(str(obj.var))
    if dom is not None:
        if dom.lo is not None:
            lo = float(dom.lo)
        if dom.hi is not None:
            hi = float(dom.hi)
    return lo, hi
