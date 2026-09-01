"""정밀도 — 계산에 쓰는 값과 화면에 보이는 값을 갈라 놓는다.

화면에 12자리로 줄여 적었다고 해서 그 값으로 다음 계산을 이어가면 안 된다.
반올림한 값이 계산에 섞여 들어가면 오차가 쌓이기 때문이다. 그래서 이 모듈은
**내부 자릿수**(계산용)와 **표시 자릿수**(화면용)를 따로 둔다. 화면 쪽 설정을
아무리 바꿔도 내부 계산은 흔들리지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import mpmath


@dataclass(frozen=True)
class Precision:
    """계산·표시·그래프의 정밀도 설정."""

    internal: int = 50   # 내부 계산 유효자릿수 (mpmath)
    display: int = 12    # 화면에 적을 유효자릿수
    epsilon: float = 0.08  # 그래프 허용 오차 (화면 픽셀)

    def with_internal(self, d: int) -> "Precision":
        return replace(self, internal=max(15, min(1000, int(d))))

    def with_display(self, d: int) -> "Precision":
        return replace(self, display=max(1, min(self.internal, int(d))))

    def with_epsilon(self, e: float) -> "Precision":
        return replace(self, epsilon=max(1e-4, min(4.0, float(e))))


_current = Precision()


def get_precision() -> Precision:
    return _current


def set_precision(**kw) -> Precision:
    """internal / display / epsilon 중 주어진 것만 바꾼다."""
    global _current
    p = _current
    if "internal" in kw and kw["internal"] is not None:
        p = p.with_internal(kw["internal"])
    if "display" in kw and kw["display"] is not None:
        p = p.with_display(kw["display"])
    if "epsilon" in kw and kw["epsilon"] is not None:
        p = p.with_epsilon(kw["epsilon"])
    _current = p
    return p


def reset_precision() -> Precision:
    global _current
    _current = Precision()
    return _current


class workdps:
    """내부 자릿수보다 여유 있게 잡아 계산하는 mpmath 문맥.

    표시 자릿수까지 **정확히** 맞으려면 계산은 그보다 넉넉해야 한다.
    보호 자릿수 guard 를 더해 둔다.
    """

    def __init__(self, digits: int | None = None, guard: int = 10):
        base = _current.internal if digits is None else int(digits)
        self.dps = max(15, base + guard)
        self._saved = None

    def __enter__(self):
        self._saved = mpmath.mp.dps
        mpmath.mp.dps = self.dps
        return self.dps

    def __exit__(self, *exc):
        mpmath.mp.dps = self._saved
        return False
