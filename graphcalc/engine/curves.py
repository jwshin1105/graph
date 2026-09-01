"""함수·매개변수·극좌표 곡선의 적응 샘플링.

고른 간격으로 점을 찍으면 두 가지가 어긋난다. 완만한 곳에서는 쓸데없이 촘촘하고,
급한 곳에서는 모자란다. 여기서도 기준은 하나다 — **선분으로 이었을 때 실제
곡선에서 몇 픽셀이나 떨어지는가.** 그 값이 ε 보다 크면 그 구간만 반으로 나눈다.

끊어야 할 곳(1/x 의 x = 0, tan x 의 π/2, floor x 의 정수)에서는 잇지 않는다.
이어 버리면 있지도 않은 수직선이 그려진다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Sampling:
    paths: list = field(default_factory=list)
    breaks: int = 0
    evals: int = 0
    depth: int = 0


def _call(f, t):
    with np.errstate(all="ignore"):
        try:
            v = f(t)
        except Exception:
            return np.full(np.shape(t), np.nan)
    v = np.asarray(v)
    if np.iscomplexobj(v):
        v = np.where(np.abs(v.imag) < 1e-12, v.real, np.nan)
    v = np.broadcast_to(np.asarray(v, dtype=float), np.shape(t)).astype(float).copy()
    v[~np.isfinite(v)] = np.nan
    return v


def sample_explicit(f, x0, x1, *, view=None, epsilon_px=0.08, width=900, height=650,
                    max_depth=18, budget=300_000):
    """y = f(x) 를 적응적으로 훑는다.

    구간을 반으로 나눠 가운데 값을 재고, 그 값이 양 끝을 이은 선분에서 ε 픽셀보다
    멀면 그 구간만 다시 나눈다. 완만한 곳은 몇 점으로 끝나고, 급한 곳은 저절로
    촘촘해진다. 아무리 나눠도 어긋남이 줄지 않는 구간은 **끊긴 자리**로 표시한다 —
    floor x 의 정수, tan x 의 π/2 가 그런 곳이다.
    """
    y0, y1 = (view[2], view[3]) if view else (x0, x1)
    py = (y1 - y0) / max(1, height)
    tol = epsilon_px * abs(py)
    span_y = abs(y1 - y0)

    n0 = max(48, width // 8)
    xs = np.linspace(float(x0), float(x1), n0 + 1)
    ys = _call(f, xs)
    evals = xs.size
    px = np.array(xs)
    py_ = np.array(ys)
    a, b = xs[:-1], xs[1:]
    ya, yb = ys[:-1], ys[1:]
    cuts = []                     # 끊어야 할 자리 (x 좌표)
    depth = 0

    for depth in range(1, max_depth + 1):
        if a.size == 0 or px.size > budget:
            break
        m = (a + b) / 2
        ym = _call(f, m)
        evals += m.size
        px = np.concatenate([px, m])
        py_ = np.concatenate([py_, ym])
        mid = (ya + yb) / 2
        err = np.abs(ym - mid)
        nan_edge = np.isnan(ya) ^ np.isnan(yb)
        nan_hole = np.isnan(ym) & ~np.isnan(ya) & ~np.isnan(yb)
        need = (err > tol) | nan_edge | nan_hole
        # 화면 밖으로 한참 나간 구간은 아무리 쪼개도 보이지 않는다. 1/x 의 x = 0
        # 근처를 스무 번 쪼개 봐야 그림은 그대로고 시간만 든다.
        far_lo = y0 - span_y * 2
        far_hi = y1 + span_y * 2
        gone = ((ya > far_hi) & (yb > far_hi)) | ((ya < far_lo) & (yb < far_lo))
        need &= ~gone
        tiny = (b - a) <= np.maximum(np.abs(a), 1.0) * 1e-14
        if depth == max_depth or tiny.any():
            # 더 나눌 수 없는데도 어긋남이 남았다면 그건 끊긴 자리다
            # 끊긴 자리로 볼 만한 곳은 **화면 안에서** 값이 튀는 구간뿐이다
            visible = (ya > far_lo) & (ya < far_hi) & (yb > far_lo) & (yb < far_hi)
            stuck = need & visible & (tiny | (depth == max_depth))
            cuts.extend(m[stuck].tolist())
            need = need & ~tiny
        if not need.any():
            break
        a2 = np.concatenate([a[need], m[need]])
        b2 = np.concatenate([m[need], b[need]])
        ya2 = np.concatenate([ya[need], ym[need]])
        yb2 = np.concatenate([ym[need], yb[need]])
        a, b, ya, yb = a2, b2, ya2, yb2

    order = np.argsort(px, kind="stable")
    xs, ys = px[order], py_[order]
    keep = np.ones(xs.size, dtype=bool)
    keep[1:] = np.diff(xs) > 0
    xs, ys = xs[keep], ys[keep]

    dx_min = abs(x1 - x0) / max(1, width) * 1e-2
    paths = _split(xs, ys, y0, y1, span_y, tol, sorted(cuts), dx_min, abs(py) * 2)
    return Sampling(paths=paths, breaks=max(0, len(paths) - 1), evals=evals, depth=depth)


def _merge(xs, ys, m, ym, take):
    """가운데 점들을 끼워 넣어 정렬된 표본으로."""
    nx = np.empty(xs.size + int(take.sum()))
    ny = np.empty_like(nx)
    nx[0::2] = xs
    ny[0::2] = ys
    nx[1::2] = m
    ny[1::2] = ym
    return nx, ny


def _split(xs, ys, y0, y1, span_y, tol, cuts=(), dx_min=0.0, dy_jump=0.0):
    """이으면 안 되는 곳에서 끊는다."""
    cut_at = np.searchsorted(xs, np.array(cuts, dtype=float)) if len(cuts) else np.array([], int)
    cut_set = set(int(c) for c in cut_at)
    paths = []
    cur_x, cur_y = [], []

    def flush():
        if len(cur_x) >= 2:
            paths.append(np.stack([np.array(cur_x), np.array(cur_y)], axis=1))
        del cur_x[:], cur_y[:]

    for i in range(xs.size):
        y = ys[i]
        if not np.isfinite(y):
            flush()
            continue
        if i in cut_set and cur_x:
            flush()
        if cur_x:
            prev = cur_y[-1]
            crossed = (prev < y0 and y > y1) or (prev > y1 and y < y0)
            if crossed and abs(y - prev) > span_y:
                flush()                 # 화면을 통째로 뛰어넘으면 이어진 것이 아니다
            elif (dx_min > 0 and xs[i] - cur_x[-1] < dx_min
                  and abs(y - prev) > dy_jump):
                flush()                 # 가로로는 픽셀의 백분의 일, 세로로는 몇 픽셀 — 계단이다
        cur_x.append(xs[i])
        cur_y.append(y)
    flush()
    return [_clip_tails(p, y0, y1, span_y) for p in paths]


def _clip_tails(p, y0, y1, span_y):
    """화면 밖으로 한참 나간 부분은 잘라 낸다 (그리는 양을 줄이려고)."""
    lo, hi = y0 - span_y * 4, y1 + span_y * 4
    p = p.copy()
    p[:, 1] = np.clip(p[:, 1], lo, hi)
    return p


def sample_parametric(fx, fy, t0, t1, *, epsilon_px=0.08, width=900, height=650,
                      view=None, max_depth=16, budget=200_000):
    """(x(t), y(t)) 를 적응적으로. 어긋남은 두 좌표를 함께 재어 픽셀로 옮긴다."""
    if view:
        px = (view[1] - view[0]) / max(1, width)
        py = (view[3] - view[2]) / max(1, height)
    else:
        px = py = 1.0 / max(1, width)
    tol = epsilon_px

    n0 = max(128, width // 4)
    ts = np.linspace(float(t0), float(t1), n0 + 1)
    X = _call(fx, ts)
    Y = _call(fy, ts)
    evals = 2 * ts.size
    depth = 0

    while depth < max_depth and ts.size < budget:
        a, b = ts[:-1], ts[1:]
        m = (a + b) / 2
        xm, ym = _call(fx, m), _call(fy, m)
        evals += 2 * m.size
        mx = (X[:-1] + X[1:]) / 2
        my = (Y[:-1] + Y[1:]) / 2
        err = np.hypot((xm - mx) / px, (ym - my) / py)
        newt = np.empty(ts.size + m.size)
        newx = np.empty_like(newt)
        newy = np.empty_like(newt)
        newt[0::2], newt[1::2] = ts, m
        newx[0::2], newx[1::2] = X, xm
        newy[0::2], newy[1::2] = Y, ym
        ts, X, Y = newt, newx, newy
        depth += 1
        if np.nanmax(err) <= tol if np.isfinite(err).any() else True:
            break

    paths = []
    cur = []
    for i in range(ts.size):
        if np.isfinite(X[i]) and np.isfinite(Y[i]):
            cur.append((X[i], Y[i]))
        else:
            if len(cur) >= 2:
                paths.append(np.array(cur))
            cur = []
    if len(cur) >= 2:
        paths.append(np.array(cur))
    return Sampling(paths=paths, breaks=max(0, len(paths) - 1), evals=evals, depth=depth)


def sample_polar(fr, t0, t1, **kw):
    """r = f(θ) 를 (r cos θ, r sin θ) 로 옮겨 같은 방법으로."""
    fx = lambda t: _call(fr, t) * np.cos(t)
    fy = lambda t: _call(fr, t) * np.sin(t)
    return sample_parametric(fx, fy, t0, t1, **kw)
