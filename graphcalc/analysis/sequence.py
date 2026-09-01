"""수열의 규칙성 — 무엇이 사실이고 무엇이 가설인가.

항을 두 몫으로 나눈다. **앞의 몫으로 규칙을 세우고, 뒤의 몫으로 확인한다.**
확인에 쓴 항은 규칙을 만들 때 쓰지 않았으므로, 들어맞았다면 그건 우연이
아니라는 쪽으로 조금 더 기운 증거가 된다. 그래도 증명은 아니다.
"""

from __future__ import annotations

import sympy

from ..core.display import pretty
from ..core.symbols import sym

_N = sym("n")
from .exactness import all_same, is_zero, light, same
from .finding import Report, fact, guess

MAX_DIFF_LEVEL = 6


def _S(v):
    return sympy.nsimplify(v) if isinstance(v, float) else sympy.sympify(v)


def differences(values, level=1):
    out = list(values)
    for _ in range(level):
        out = [light(out[i + 1] - out[i]) for i in range(len(out) - 1)]
    return out


def difference_table(values, max_level=MAX_DIFF_LEVEL):
    """1차·2차·… 차분을 차례로. (레벨, 값들)"""
    rows = []
    cur = list(values)
    for lv in range(1, min(max_level, len(values) - 1) + 1):
        cur = [light(cur[i + 1] - cur[i]) for i in range(len(cur) - 1)]
        if not cur:
            break
        rows.append((lv, cur))
        if all(is_zero(v) for v in cur):
            break
    return rows


def constant_level(table):
    """몇 차 차분이 일정해지는가. 없으면 None."""
    for lv, row in table:
        if len(row) >= 2 and all_same(row):
            return lv, row[0]
    return None


def analyze_sequence(seq, count: int = 14, split: int | None = None) -> Report:
    """수열 하나를 살핀다.

    @param seq   objects.sequence.Sequence
    @param count 살펴볼 항의 수
    @param split 규칙을 세우는 데 쓸 항의 수 (나머지는 확인용)
    """
    pairs = seq.terms(count)
    ns = [n for n, _ in pairs]
    vs = [_S(v) for _, v in pairs]
    rep = Report(kind="sequence", title=f"{seq.name}ₙ")
    if len(vs) < 2:
        rep.notes.append("항이 모자라 규칙을 살필 수 없습니다.")
        return rep

    k = split if split is not None else max(3, (len(vs) * 2) // 3)
    k = min(k, len(vs))
    fit_n, fit_v = ns[:k], vs[:k]
    hold_n, hold_v = ns[k:], vs[k:]

    _basics(rep, ns, vs)
    table = difference_table(vs)
    rep.tables.append(("차분표", ["차수"] + [f"n={n}" for n in ns],
                       [[f"{lv}차"] + [""] * lv + [pretty(v) for v in row]
                        for lv, row in table]))
    _ratios(rep, ns, vs)

    _arithmetic(rep, fit_n, fit_v, hold_n, hold_v)
    _geometric(rep, fit_n, fit_v, hold_n, hold_v)
    _polynomial(rep, fit_n, fit_v, hold_n, hold_v, table)
    _exponential(rep, fit_n, fit_v, hold_n, hold_v)
    _periodic(rep, ns, vs)
    _recurrence(rep, fit_n, fit_v, hold_n, hold_v)
    _closed_form(rep, seq, ns, vs)
    _limit(rep, seq, ns, vs)
    _growth(rep, ns, vs)
    return rep


# ───────────────────────────────── 사실

def _basics(rep, ns, vs):
    rep.add(fact(f"항 {len(vs)}개를 보았습니다 (n = {ns[0]}‥{ns[-1]})",
                 detail=", ".join(pretty(v) for v in vs[:8]) + (" …" if len(vs) > 8 else ""),
                 derivation="정의에 번호를 넣어 정확한 값으로 계산했습니다.", weight=90))
    d = [light(vs[i + 1] - vs[i]) for i in range(len(vs) - 1)]
    if all(x.is_positive for x in d if x.is_number):
        rep.add(fact("본 항까지는 계속 커집니다 (증가)", weight=80,
                     derivation="이웃한 항의 차가 모두 양수입니다."))
    elif all(x.is_negative for x in d if x.is_number):
        rep.add(fact("본 항까지는 계속 작아집니다 (감소)", weight=80,
                     derivation="이웃한 항의 차가 모두 음수입니다."))
    elif all(is_zero(x) for x in d):
        rep.add(fact("본 항이 모두 같습니다 (상수)", weight=80))
    elif len(d) >= 3 and all(x.is_number for x in d) and \
            all(d[i] * d[i + 1] < 0 for i in range(len(d) - 1)):
        rep.add(fact("오르내림을 되풀이합니다 (교대)", weight=78,
                     derivation="이웃한 차의 부호가 번갈아 바뀝니다."))
    if all(v.is_integer for v in vs if v.is_number):
        rep.add(fact("본 항이 모두 정수입니다", weight=40))
        if all((v % 2) == 0 for v in vs if v.is_integer):
            rep.add(fact("본 항이 모두 짝수입니다", weight=30))
        elif all((v % 2) == 1 for v in vs if v.is_integer):
            rep.add(fact("본 항이 모두 홀수입니다", weight=30))


def _ratios(rep, ns, vs):
    if any(v == 0 for v in vs[:-1]):
        return
    r = [light(vs[i + 1] / vs[i]) for i in range(len(vs) - 1)]
    rep.tables.append(("이웃한 항의 비", [f"a{n+1}/a{n}" for n in ns[:-1]],
                       [[pretty(x) for x in r]]))


# ───────────────────────────────── 가설

def _verify(rule_fn, hold_n, hold_v):
    """규칙을 세울 때 쓰지 않은 항으로 확인한다."""
    ok = 0
    for n, v in zip(hold_n, hold_v):
        try:
            if is_zero(rule_fn(n) - v):
                ok += 1
        except Exception:
            pass
    return len(hold_n), ok


def _arithmetic(rep, fn, fv, hn, hv):
    if len(fv) < 3:
        return
    d = light(fv[1] - fv[0])
    if any(not is_zero(fv[i + 1] - fv[i] - d) for i in range(len(fv) - 1)):
        return
    a0, n0 = fv[0], fn[0]
    rule = lambda n: a0 + d * (n - n0)
    c, p = _verify(rule, hn, hv)
    closed = pretty(sympy.expand(a0 + d * (_N - n0)))
    rep.add(guess(f"등차수열 — 공차 {pretty(d)}, aₙ = {closed}",
                  used=len(fv), checked=c, passed=p, weight=100,
                  derivation=f"앞의 {len(fv)}항에서 이웃한 차가 모두 {pretty(d)} 로 같았습니다. "
                             f"그 규칙을 뒤의 {c}항에 넣어 확인했습니다."))


def _geometric(rep, fn, fv, hn, hv):
    if len(fv) < 3 or any(v == 0 for v in fv):
        return
    r = light(fv[1] / fv[0])
    if any(not is_zero(fv[i + 1] / fv[i] - r) for i in range(len(fv) - 1)):
        return
    a0, n0 = fv[0], fn[0]
    rule = lambda n: a0 * r ** (n - n0)
    c, p = _verify(rule, hn, hv)
    closed = pretty(a0 * r ** (_N - n0))
    rep.add(guess(f"등비수열 — 공비 {pretty(r)}, aₙ = {closed}",
                  used=len(fv), checked=c, passed=p, weight=100,
                  derivation=f"앞의 {len(fv)}항에서 이웃한 비가 모두 {pretty(r)} 로 같았습니다."))


def _polynomial(rep, fn, fv, hn, hv, table):
    """k차 차분이 일정하면 k차 다항식 후보."""
    if len(fv) < 4:
        return
    ft = difference_table(fv)
    hit = constant_level(ft)
    if not hit:
        return
    lv, val = hit
    if lv <= 1:
        return                       # 등차는 위에서 다뤘다
    n = _N
    try:
        poly = sympy.interpolate(list(zip(fn, fv)), n)
        poly = sympy.expand(poly)
    except Exception:
        return
    rule = lambda k: poly.subs(n, k)
    c, p = _verify(rule, hn, hv)
    rep.add(guess(f"{lv}차 다항식 — aₙ = {pretty(poly)}",
                  used=len(fv), checked=c, passed=p, weight=95,
                  derivation=f"{lv}차 차분이 {pretty(val)} 로 일정합니다. 그래서 {lv}차 다항식으로 "
                             f"보고 앞의 {len(fv)}항을 지나는 다항식을 구했습니다."))


def _exponential(rep, fn, fv, hn, hv):
    """aₙ = A·rⁿ 꼴 — 비가 일정하지는 않아도 성장이 지수인가."""
    if len(fv) < 4 or any(v <= 0 for v in fv if v.is_number):
        return
    r = light(fv[-1] / fv[-2])
    if r == 1 or not r.is_number:
        return
    ratios = [light(fv[i + 1] / fv[i]) for i in range(len(fv) - 1)]
    if all_same(ratios):
        return                        # 등비로 이미 적었다
    ok = all(abs(float(x) - float(r)) < 1e-9 for x in ratios if x.is_number)
    if not ok:
        return
    n = _N
    A = sympy.simplify(fv[0] / r ** fn[0])
    rule = lambda k: A * r ** k
    c, p = _verify(rule, hn, hv)
    if p == c and c:
        rep.add(guess(f"지수 성장 — aₙ ≈ {pretty(A)}·{pretty(r)}ⁿ",
                      used=len(fv), checked=c, passed=p, weight=70,
                      derivation="이웃한 항의 비가 거의 일정합니다."))


def _periodic(rep, ns, vs):
    m = len(vs)
    for T in range(1, m // 2 + 1):
        if all(is_zero(vs[i] - vs[i + T]) for i in range(m - T)):
            rep.add(fact(f"본 항 안에서 주기 {T} 로 되풀이됩니다",
                         detail=" , ".join(pretty(v) for v in vs[:T]), weight=85,
                         derivation=f"a(n+{T}) − a(n) 이 본 항 모두에서 0 이었습니다."))
            rep.add(guess(f"주기 {T} 인 수열",
                          used=m, checked=0, passed=0, weight=60,
                          derivation="본 항에서만 확인한 것이라, 그 뒤에도 되풀이될지는 모릅니다."))
            return


def _recurrence(rep, fn, fv, hn, hv):
    """a_{n+1} = p·aₙ + q  와  a_{n+2} = p·a_{n+1} + q·aₙ 를 정확히 풀어 본다."""
    n = _N
    p, q = sympy.symbols("p q")
    if len(fv) >= 4:
        try:
            sol = sympy.solve([sympy.Eq(fv[i + 1], p * fv[i] + q) for i in range(2)],
                              [p, q], dict=True)
        except Exception:
            sol = []
        if sol:
            P, Q = sol[0].get(p), sol[0].get(q)
            if P is not None and Q is not None and \
               all(is_zero(fv[i + 1] - P * fv[i] - Q) for i in range(len(fv) - 1)):
                if not (P == 1 and Q == 0):
                    ok = sum(1 for i in range(len(hv))
                             if is_zero(hv[i] - P * (hv[i - 1] if i else fv[-1]) - Q))
                    A = sympy.Function("a")
                    rep.add(guess(f"점화식 — aₙ₊₁ = {pretty(P * A(n) + Q)}",
                                  used=len(fv), checked=len(hv), passed=ok, weight=88,
                                  derivation="앞의 두 항으로 p, q 를 정확히 풀고, 나머지 항에서 "
                                             "그 식이 성립하는지 확인했습니다."))
                    return
    if len(fv) >= 5:
        try:
            sol = sympy.solve([sympy.Eq(fv[i + 2], p * fv[i + 1] + q * fv[i]) for i in range(2)],
                              [p, q], dict=True)
        except Exception:
            sol = []
        if sol:
            P, Q = sol[0].get(p), sol[0].get(q)
            if P is not None and Q is not None:
                P, Q = _tidy(P), _tidy(Q)
            if P is not None and Q is not None and \
               all(is_zero(fv[i + 2] - P * fv[i + 1] - Q * fv[i])
                   for i in range(len(fv) - 2)):
                seq_all = fv + hv
                ok = sum(1 for i in range(len(fv) - 2, len(seq_all) - 2)
                         if is_zero(seq_all[i + 2] - P * seq_all[i + 1] - Q * seq_all[i]))
                A = sympy.Function("a")
                rep.add(guess(f"점화식 — aₙ₊₂ = {pretty(P * A(n + 1) + Q * A(n))}",
                              used=len(fv), checked=max(0, len(hv)), passed=ok, weight=88,
                              derivation="앞의 세 항으로 p, q 를 정확히 풀고, 나머지 항에서 "
                                         "그 식이 성립하는지 확인했습니다."))


def _tidy(v):
    """(cos 3 − cos 1)/(cos 2 − 1) 은 사실 2cos 1 이다. 지수꼴로 한 번 돌리면 풀린다."""
    best = v
    for f in (lambda e: sympy.simplify(e),
              lambda e: sympy.simplify(e.rewrite(sympy.exp)),
              lambda e: sympy.simplify(sympy.trigsimp(e, method="fu"))):
        try:
            c = f(v)
        except Exception:
            continue
        if sympy.count_ops(c) < sympy.count_ops(best):
            best = c
    return best


def _closed_form(rep, seq, ns, vs):
    cf = seq.closed_form()
    if cf is None or seq.rule is not None:
        return
    rule = lambda k: cf.subs(seq.index, k)
    # 씨앗은 일반항을 구하는 데 이미 쓰였으므로 확인에서 뺀다
    free = [(n, v) for n, v in zip(ns, vs) if n not in seq.seeds]
    c, p = _verify(rule, [n for n, _ in free], [v for _, v in free])
    rep.add(guess(f"일반항 — aₙ = {pretty(cf)}",
                  used=len(seq.seeds), checked=c, passed=p, weight=98,
                  derivation="점화식을 풀어(rsolve) 일반항을 구하고, 실제 항과 맞춰 보았습니다."))


def _limit(rep, seq, ns, vs):
    if seq.rule is None:
        return
    try:
        L = sympy.limit(seq.rule, seq.index, sympy.oo)
    except Exception:
        return
    if L is None or L.has(sympy.AccumBounds) or L.has(sympy.nan) or L.has(sympy.zoo):
        rep.add(fact("극한이 없습니다 — 값이 한 곳으로 모이지 않습니다", weight=75,
                     derivation="일반항의 극한을 기호로 구했더니 정해지지 않았습니다."))
        return
    if L in (sympy.oo, -sympy.oo):
        rep.add(fact(f"n 이 커지면 한없이 {'커집니다' if L == sympy.oo else '작아집니다'}",
                     weight=50, derivation="일반항의 극한을 기호로 구했습니다."))
    elif not L.free_symbols:
        rep.add(fact(f"극한 — n → ∞ 일 때 aₙ → {pretty(L)}", weight=75,
                     derivation="일반항의 극한을 기호로 구했습니다 (수치로 어림한 것이 아닙니다)."))


def _growth(rep, ns, vs):
    """얼마나 빨리 커지는가 — 다항식인가 지수인가."""
    nums = [v for v in vs if v.is_number and v != 0]
    if len(nums) < 5:
        return
    try:
        import math
        xs = [float(n) for n in ns[-5:] if n > 0]
        ys = [abs(float(v)) for v in vs[-5:]]
        if len(xs) < 3 or any(y <= 0 for y in ys):
            return
        if any(ys[i + 1] < ys[i] for i in range(len(ys) - 1)) and \
           any(ys[i + 1] > ys[i] for i in range(len(ys) - 1)):
            return          # 오르내리는 수열에 '성장률' 을 붙이면 거짓말이다
        # log a_n vs log n → 다항식 차수,  log a_n vs n → 지수
        k = (math.log(ys[-1]) - math.log(ys[0])) / (math.log(xs[-1]) - math.log(xs[0]))
        e = (math.log(ys[-1]) - math.log(ys[0])) / (xs[-1] - xs[0])
    except Exception:
        return
    if abs(k - round(k)) < 0.05 and abs(k) > 0.5:
        word = "커집니다" if k > 0 else "작아집니다"
        rep.add(guess(f"성장률 — 대략 n^{round(k)} 에 비례해 {word}",
                      weight=30, derivation="마지막 항들의 log aₙ 과 log n 의 기울기를 재었습니다."))
    elif e > 0.05:
        rep.add(guess(f"성장률 — 지수적으로 커집니다 (밑 대략 {round(math.exp(e), 4)})",
                      weight=30, derivation="마지막 항들의 log aₙ 과 n 의 기울기를 재었습니다."))
