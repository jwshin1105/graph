"""부등식이 정하는 영역 — 칠할 곳과 그 넓이.

넓이를 "참인 칸의 개수 × 칸 넓이" 로 세면 경계에 걸친 칸에서 통째로 틀린다.
격자를 촘촘히 해도 오차는 격자 간격에 비례해서만 줄어든다. 그래서 경계에 걸친
칸은 **줄마다 경계의 위치를 이분법으로 찾아** 걸친 만큼만 더한다.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class RegionMask:
    mask: np.ndarray = None          # (ny, nx) bool — 화면에 칠할 곳
    extent: tuple = (0, 1, 0, 1)
    area: float = float("nan")
    area_error: float = float("inf")


def region(f, view, *, strict=False, width=900, height=650, samples=None):
    """f(x, y) ≥ 0 (strict 이면 > 0) 인 곳."""
    x0, x1, y0, y1 = view
    nx, ny = samples or (min(width, 700), min(height, 520))
    xs = np.linspace(x0, x1, nx)
    ys = np.linspace(y0, y1, ny)
    X, Y = np.meshgrid(xs, ys)
    with np.errstate(all="ignore"):
        try:
            V = np.asarray(f(X, Y), dtype=float)
        except Exception:
            V = np.full(X.shape, np.nan)
    V = np.where(np.isfinite(V), V, np.nan)
    mask = (V > 0) if strict else (V >= 0)
    mask &= np.isfinite(V)
    a, err = area(f, view, strict=strict)
    return RegionMask(mask=mask, extent=(x0, x1, y0, y1), area=a, area_error=err)


def area(f, view, *, strict=False, rows=600, cols=600, refine=50):
    """영역의 넓이.

    줄마다 "안쪽인 토막" 을 찾고, 토막의 **양 끝을 이분법으로** 정확히 잡아
    길이를 더한다. 칸을 세는 방식은 경계에 걸친 칸에서 통째로 틀리지만
    이 방식은 경계를 찾아 자르므로 줄 방향의 오차만 남는다.

    @returns (넓이, 오차의 가늠)
    """
    a1 = _area_rows(f, view, strict, rows, cols, refine)
    a2 = _area_rows(f, view, strict, rows // 2, cols, refine)
    # 줄 수를 반으로 줄인 값과 견주어 남은 오차를 가늠한다
    err = abs(a1 - a2)
    return a1, err


def _area_rows(f, view, strict, rows, cols, refine):
    import numpy as np
    x0, x1, y0, y1 = view
    dy = (y1 - y0) / rows
    xs = np.linspace(x0, x1, cols)
    test = (lambda v: v > 0) if strict else (lambda v: v >= 0)
    total = 0.0
    for r in range(rows):
        y = y0 + (r + 0.5) * dy          # 가운데 값으로 — 사다리꼴보다 오차가 작다
        with np.errstate(all="ignore"):
            try:
                v = np.asarray(f(xs, np.full_like(xs, y)), dtype=float)
            except Exception:
                continue
        inside = test(v) & np.isfinite(v)
        if not inside.any():
            continue
        total += _row_length(f, xs, v, inside, y, test, refine) * dy
    return total


def _row_length(f, xs, v, inside, y, test, refine):
    import numpy as np
    idx = np.flatnonzero(inside)
    splits = np.flatnonzero(np.diff(idx) > 1)
    runs = np.split(idx, splits + 1)
    length = 0.0
    for run in runs:
        i, j = int(run[0]), int(run[-1])
        left = xs[i] if i == 0 else _edge(f, xs[i - 1], xs[i], v[i - 1], y, test, refine)
        right = xs[j] if j == len(xs) - 1 else _edge(f, xs[j], xs[j + 1], v[j], y, test, refine)
        length += right - left
    return length


def _edge(f, a, b, va, y, test, refine):
    """[a, b] 안에서 안팎이 바뀌는 자리를 이분법으로."""
    import numpy as np
    inside_a = test(va) and np.isfinite(va)
    lo, hi = a, b
    for _ in range(refine):
        mid = (lo + hi) / 2
        try:
            vm = float(np.asarray(f(np.array([mid]), np.array([y])))[0])
        except Exception:
            break
        if (test(vm) and np.isfinite(vm)) == inside_a:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2
