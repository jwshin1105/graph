"""적응형 등고선 — F(x, y) = 0 을 허용 오차 ε 안에서 그린다.

고른 격자로 훑으면 두 가지를 놓친다. 좁은 목(y² = x³ − x 의 잘록한 곳)과
작은 고리(x² + y² = 0.001)다. 격자를 통째로 촘촘하게 하면 느려진다.

그래서 **필요한 곳만 잘게 나눈다.**

  - 칸마다 아홉 점(네 꼭짓점·네 변의 중점·가운데)을 본다.
  - 가운데 값이 꼭짓점들의 평균과 얼마나 어긋나는지 재면(bend) 그 칸에서
    F 가 얼마나 휘어 있는지 알 수 있다. 그 휨을 기울기 |∇F| 로 나누면
    **선분으로 그렸을 때 실제 곡선에서 얼마나 떨어지는지**가 길이 단위로 나온다.
  - 그 거리가 화면에서 ε 픽셀보다 크면 칸을 넷으로 쪼갠다.

끝나는 조건이 "몇 번 쪼갠다" 가 아니라 "ε 보다 잘 맞을 때까지" 인 것이 핵심이다.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Trace:
    paths: list = field(default_factory=list)     # [np.ndarray (m,2)]
    points: list = field(default_factory=list)    # 고립된 해
    cells: int = 0
    evals: int = 0
    max_level: int = 0
    residual: float = 0.0                         # 남은 오차의 가늠 (길이 단위)


def trace_implicit(f, view, *, epsilon_px=0.08, width=900, height=650,
                   base=None, max_level=10, budget=1_200_000):
    """F(x, y) = 0 을 좇는다.

    @param f  numpy 배열을 받아 배열을 돌려주는 함수 f(X, Y)
    @param view (x0, x1, y0, y1)
    @param epsilon_px 화면에서 허용할 어긋남 (픽셀)
    """
    x0, x1, y0, y1 = view
    px = (x1 - x0) / max(1, width)                 # 픽셀 하나의 가로 길이
    py = (y1 - y0) / max(1, height)
    tol_dist = epsilon_px * max(px, py)            # 길이 단위 허용 오차

    # 첫 격자는 화면 열두 픽셀쯤으로. 너무 성글면 sin 50x 처럼 잘게 흔들리는
    # 그래프의 마루와 골을 처음부터 놓쳐, 나중에 아무리 쪼개도 살아나지 않는다.
    nx, ny = base or (max(24, int(width // 12)), max(18, int(height // 12)))
    ex = np.linspace(x0, x1, nx + 1)
    ey = np.linspace(y0, y1, ny + 1)
    GX, GY = np.meshgrid(ex, ey, indexing="ij")
    G = _ev(f, GX, GY)
    evals = G.size

    # 칸: 왼아래 좌표와 크기, 그리고 네 꼭짓점 값
    cx = np.repeat(ex[:-1], ny)
    cy = np.tile(ey[:-1], nx)
    hx = np.full(cx.shape, (x1 - x0) / nx)
    hy = np.full(cx.shape, (y1 - y0) / ny)
    v00 = G[:-1, :-1].reshape(-1)
    v10 = G[1:, :-1].reshape(-1)
    v01 = G[:-1, 1:].reshape(-1)
    v11 = G[1:, 1:].reshape(-1)

    leaves = []                 # (cx, cy, hx, hy, v00, v10, v01, v11)
    level = 0
    stray = []                  # 부호가 안 바뀌는데 0 에 아주 가까운 칸 (고립 해 후보)
    residual = 0.0

    while True:
        n = cx.size
        if n == 0:
            break
        # 아홉 점 가운데 새로 필요한 다섯 점
        mx = cx + hx / 2
        my = cy + hy / 2
        pts = [(mx, cy), (mx, cy + hy), (cx, my), (cx + hx, my), (mx, my)]
        vals = []
        for ax, ay in pts:
            vals.append(_ev(f, ax, ay))
            evals += ax.size
        vb, vt, vl, vr, vc = vals

        stack = np.stack([v00, v10, v01, v11, vb, vt, vl, vr, vc])
        vmin = np.nanmin(stack, axis=0)
        vmax = np.nanmax(stack, axis=0)
        crosses = (vmin <= 0) & (vmax >= 0)
        nan_here = np.isnan(stack).any(axis=0) & ~np.isnan(stack).all(axis=0)

        # 휨: 가운데 값이 네 꼭짓점의 평균과 얼마나 어긋나는가
        mean4 = (v00 + v10 + v01 + v11) / 4
        bend = np.abs(vc - mean4)
        # 기울기 — 중심차분
        gx = (vr - vl) / np.maximum(hx, 1e-300)
        gy = (vt - vb) / np.maximum(hy, 1e-300)
        grad = np.sqrt(gx * gx + gy * gy)
        # 길이 단위로 옮긴 오차. 기울기가 0 에 가까우면 칸 크기로 눌러 둔다
        err = np.where(grad > 1e-300, bend / np.maximum(grad, 1e-300),
                       np.hypot(hx, hy))
        err = np.nan_to_num(err, nan=np.hypot(hx, hy))

        small = np.hypot(hx, hy) <= tol_dist        # 더 쪼갤 값어치가 없는 크기
        need = (crosses | nan_here) & (err > tol_dist) & ~small
        # 작은 고리를 놓치지 않으려고: 부호는 안 바뀌지만 값이 아주 작은 칸도 본다
        span = vmax - vmin
        near = (~crosses) & (np.abs(vmin) <= span * 0.75) & (span > 0) & ~small
        need = need | near

        if level >= max_level or n * 4 > budget:
            residual = float(np.max(err[crosses])) if crosses.any() else 0.0
            need = np.zeros_like(need)

        keep = ~need
        if keep.any():
            leaves.append((cx[keep], cy[keep], hx[keep], hy[keep],
                           v00[keep], v10[keep], v01[keep], v11[keep]))
            k = keep & near & ~crosses
            if k.any():
                stray.append((cx[k] + hx[k] / 2, cy[k] + hy[k] / 2))
        if not need.any():
            break

        level += 1
        # 넷으로 쪼갠다. 아홉 점이 있으니 새 꼭짓점 값은 이미 다 안다
        i = need
        h2x, h2y = hx[i] / 2, hy[i] / 2
        X, Y = cx[i], cy[i]
        A, B, C, D = v00[i], v10[i], v01[i], v11[i]
        L, R2, Bt, Tp, Ct = vl[i], vr[i], vb[i], vt[i], vc[i]
        cx = np.concatenate([X, X + h2x, X, X + h2x])
        cy = np.concatenate([Y, Y, Y + h2y, Y + h2y])
        hx = np.concatenate([h2x] * 4)
        hy = np.concatenate([h2y] * 4)
        v00 = np.concatenate([A, Bt, L, Ct])
        v10 = np.concatenate([Bt, B, Ct, R2])
        v01 = np.concatenate([L, Ct, C, Tp])
        v11 = np.concatenate([Ct, R2, Tp, D])

    segs = []
    total = 0
    for (a, b, hxx, hyy, s00, s10, s01, s11) in leaves:
        total += a.size
        segs.append(_march(f, a, b, hxx, hyy, s00, s10, s01, s11))
    seg = np.concatenate([s for s in segs if s.size], axis=0) if segs else np.zeros((0, 4))

    paths = _stitch(seg, tol=min(px, py) * 0.5)
    pts = _isolated(f, stray, tol_dist)
    return Trace(paths=paths, points=pts, cells=total, evals=evals,
                 max_level=level, residual=residual)


def _ev(f, X, Y):
    with np.errstate(all="ignore"):
        try:
            v = f(X, Y)
        except Exception:
            return np.full(np.shape(X), np.nan)
    v = np.asarray(v, dtype=float) if not np.iscomplexobj(v) else np.where(
        np.abs(np.imag(v)) < 1e-12, np.real(v), np.nan)
    v = np.broadcast_to(np.asarray(v, dtype=float), np.shape(X)).copy()
    v[~np.isfinite(v)] = np.nan
    return v


def _cut(f, ax, ay, bx, by, va, vb, rounds=6):
    """변 위의 영점을 이분법으로 몇 번 더 조인다. 선형보간만으로는 ε 을 못 맞춘다."""
    t = np.where(np.abs(vb - va) > 0, va / np.where(vb - va == 0, 1.0, vb - va), 0.5)
    t = np.clip(t, 0.0, 1.0)
    lo = np.zeros_like(t)
    hi = np.ones_like(t)
    vlo, vhi = va.copy(), vb.copy()
    for _ in range(rounds):
        x = ax + (bx - ax) * t
        y = ay + (by - ay) * t
        vm = _ev(f, x, y)
        same = np.sign(vm) == np.sign(vlo)
        lo = np.where(same, t, lo)
        vlo = np.where(same, vm, vlo)
        hi = np.where(same, hi, t)
        vhi = np.where(same, vhi, vm)
        d = vhi - vlo
        t = np.where(np.abs(d) > 0, lo + (hi - lo) * (-vlo / np.where(d == 0, 1.0, d)),
                     (lo + hi) / 2)
        t = np.clip(t, lo, hi)
        t = np.where(np.isfinite(t), t, (lo + hi) / 2)
    return ax + (bx - ax) * t, ay + (by - ay) * t


def _march(f, cx, cy, hx, hy, v00, v10, v01, v11):
    """마칭 스퀘어 — 칸마다 부호가 바뀌는 변을 이어 선분을 만든다."""
    s = lambda v: (v > 0).astype(np.int8)
    code = (s(v00) | (s(v10) << 1) | (s(v11) << 2) | (s(v01) << 3))
    ok = np.isfinite(v00) & np.isfinite(v10) & np.isfinite(v01) & np.isfinite(v11)
    live = ok & (code != 0) & (code != 15)
    if not live.any():
        return np.zeros((0, 4))
    i = live
    X, Y, HX, HY = cx[i], cy[i], hx[i], hy[i]
    a, b, c, d = v00[i], v10[i], v11[i], v01[i]
    co = code[i]

    # 변 위의 점 (아래·오른·위·왼)
    eb = _cut(f, X, Y, X + HX, Y, a, b)
    er = _cut(f, X + HX, Y, X + HX, Y + HY, b, c)
    et = _cut(f, X, Y + HY, X + HX, Y + HY, d, c)
    el = _cut(f, X, Y, X, Y + HY, a, d)
    E = {0: eb, 1: er, 2: et, 3: el}

    TABLE = {
        1: [(0, 3)], 2: [(0, 1)], 3: [(1, 3)], 4: [(1, 2)],
        5: [(0, 1), (2, 3)], 6: [(0, 2)], 7: [(2, 3)], 8: [(2, 3)],
        9: [(0, 2)], 10: [(0, 3), (1, 2)], 11: [(1, 2)], 12: [(1, 3)],
        13: [(0, 1)], 14: [(0, 3)],
    }
    out = []
    for key, pairs in TABLE.items():
        m = co == key
        if not m.any():
            continue
        for (p, q) in pairs:
            out.append(np.stack([E[p][0][m], E[p][1][m], E[q][0][m], E[q][1][m]], axis=1))
    return np.concatenate(out, axis=0) if out else np.zeros((0, 4))


def _stitch(seg, tol):
    """선분들을 이어 붙여 이어진 곡선으로.

    끝점을 격자에 반올림해 맞추면, 1e−9 밖에 안 떨어진 두 점이 격자 경계를
    사이에 두고 서로 다른 칸으로 갈라진다. 그러면 이어져야 할 곡선이 끊기고,
    반대로 멀리 떨어진 점끼리 같은 칸에 들어가 엉뚱하게 이어지기도 한다.
    그래서 반올림 대신 **거리로** 맞춘다.
    """
    if seg.size == 0:
        return []
    from scipy.spatial import cKDTree
    good = np.isfinite(seg).all(axis=1)
    # 격자점 위를 곡선이 정확히 지나가면 길이 0 짜리 선분이 생긴다. 그림에는
    # 보이지 않지만 이어 붙이기를 방해하므로 여기서 걸러 낸다.
    span0 = float(max(np.ptp(seg[:, [0, 2]]) if seg.size else 0.0,
                      np.ptp(seg[:, [1, 3]]) if seg.size else 0.0, 1e-300))
    good &= np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1]) > span0 * 1e-12
    seg = seg[good]
    if seg.size == 0:
        return []
    m = len(seg)
    ends = np.concatenate([seg[:, :2], seg[:, 2:]], axis=0)   # 0..m-1 시작, m..2m-1 끝
    span = float(max(np.ptp(ends[:, 0]), np.ptp(ends[:, 1]), 1e-300))
    tree = cKDTree(ends)
    r = max(span * 1e-9, 1e-13)

    used = np.zeros(m, dtype=bool)
    paths = []
    for start in range(m):
        if used[start]:
            continue
        used[start] = True
        chain = [tuple(seg[start, :2]), tuple(seg[start, 2:])]
        for tail in (True, False):
            while True:
                px, py = chain[-1] if tail else chain[0]
                # 현재 끝점과 같은 자리에 있는 다른 선분의 끝점을 찾는다
                cand = tree.query_ball_point((px, py), r)
                nxt = None
                for c in cand:
                    k, side = (c % m), (c // m)
                    if used[k]:
                        continue
                    nxt = (k, side)
                    break
                if nxt is None:
                    break
                k, side = nxt
                used[k] = True
                ox, oy = (seg[k, 2], seg[k, 3]) if side == 0 else (seg[k, 0], seg[k, 1])
                if tail:
                    chain.append((ox, oy))
                else:
                    chain.insert(0, (ox, oy))
        if len(chain) >= 2:
            paths.append(np.array(chain, dtype=float))
    paths = _bridge(paths, tol)
    paths.sort(key=len, reverse=True)
    return paths


def _bridge(paths, gap):
    """세분 정도가 달라 생긴 아주 작은 틈을 잇는다.

    칸의 크기가 다른 두 이웃이 같은 변 위의 영점을 따로 구하면 값이 조금
    어긋난다. 그 어긋남은 눈에 보이지 않을 만큼 작지만, 그대로 두면 하나여야 할
    곡선이 여러 조각으로 남는다.
    """
    if len(paths) < 2 or gap <= 0:
        return paths
    from scipy.spatial import cKDTree
    paths = [p for p in paths if len(p) >= 2]
    open_ends = []
    for i, p in enumerate(paths):
        if np.hypot(*(p[0] - p[-1])) < gap:
            continue                      # 이미 닫힌 고리
        open_ends.append((i, 0, p[0]))
        open_ends.append((i, 1, p[-1]))
    if len(open_ends) < 2:
        return paths
    tree = cKDTree(np.array([e[2] for e in open_ends]))
    merged = {i: p for i, p in enumerate(paths)}
    alias = {i: i for i in merged}

    def root(i):
        while alias[i] != i:
            i = alias[i]
        return i

    for a, b in sorted(tree.query_pairs(gap)):
        ia, sa, _ = open_ends[a]
        ib, sb, _ = open_ends[b]
        ra, rb = root(ia), root(ib)
        if ra == rb or ra not in merged or rb not in merged:
            continue
        pa, pb = merged[ra], merged[rb]
        # 가장 가까운 끝끼리 붙인다
        opts = [(np.hypot(*(pa[-1] - pb[0])), pa, pb),
                (np.hypot(*(pa[-1] - pb[-1])), pa, pb[::-1]),
                (np.hypot(*(pa[0] - pb[-1])), pb, pa),
                (np.hypot(*(pa[0] - pb[0])), pb[::-1], pa)]
        d, first, second = min(opts, key=lambda o: o[0])
        if d > gap:
            continue
        merged[ra] = np.concatenate([first, second[1:]], axis=0)
        del merged[rb]
        alias[rb] = ra
    return list(merged.values())


def _isolated(f, stray, tol):
    """부호가 안 바뀌는데 0 에 가까운 자리 — 한 점짜리 해를 찾아본다."""
    if not stray:
        return []
    from scipy.optimize import minimize
    xs = np.concatenate([a for a, _ in stray])
    ys = np.concatenate([b for _, b in stray])
    if xs.size > 400:
        idx = np.argsort(np.abs(_ev(f, xs, ys)))[:400]
        xs, ys = xs[idx], ys[idx]
    g = lambda v: float(abs(_ev(f, np.array([v[0]]), np.array([v[1]]))[0]))
    out = []
    for x, y in zip(xs, ys):
        try:
            r = minimize(g, [x, y], method="Nelder-Mead",
                         options={"xatol": tol / 8, "fatol": 1e-14, "maxiter": 120})
        except Exception:
            continue
        if r.fun < 1e-10 and np.isfinite(r.x).all():
            if not any(abs(r.x[0] - a) < tol * 4 and abs(r.x[1] - b) < tol * 4 for a, b in out):
                out.append((float(r.x[0]), float(r.x[1])))
    return out
