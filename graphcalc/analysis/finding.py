"""찾아낸 것 — **사실**과 **가설**을 갈라 적는다.

유한한 항 몇 개로는 규칙이 하나로 정해지지 않는다. 1, 4, 9, 16 다음에 25 가
와야 할 이유는 없다. 그러므로 이 프로그램은

  - 주어진 항에서 **계산해서 확인한 것**은 사실로,
  - 그 항들과 들어맞는 **규칙 후보**는 가설로 적는다.

가설은 반드시 "무엇으로 확인했는지" 를 함께 적는다. 규칙을 세울 때 쓰지 않은
여분의 항으로 확인했다면 그 개수를 밝히고, 확인하지 못했으면 확인하지 못했다고
적는다. "이 수열은 aₙ = n² 이다" 라고 잘라 말하지 않는다.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Finding:
    text: str = ""                 # 결론 한 줄
    kind: str = "fact"             # fact | hypothesis
    detail: str = ""               # 근거·값
    derivation: str = ""           # 어떻게 구했나
    used: int = 0                  # 규칙을 세우는 데 쓴 항 수
    checked: int = 0               # 확인에만 쓴 여분의 항 수
    passed: int = 0                # 그중 들어맞은 수
    weight: int = 0                # 정렬용 (클수록 위)
    group: str = ""

    @property
    def verified(self) -> bool:
        return self.checked > 0 and self.passed == self.checked

    def badge(self) -> str:
        if self.kind == "fact":
            return "사실"
        if self.checked == 0:
            return "가설 (확인 못 함)"
        if self.passed == self.checked:
            return f"가설 (여분 {self.checked}항 모두 들어맞음)"
        return f"가설 (여분 {self.checked}항 중 {self.passed}항만 들어맞음)"

    def line(self) -> str:
        return f"[{self.badge()}] {self.text}"


@dataclass
class Report:
    """한 대상에 대해 찾아낸 것 모두."""
    kind: str = ""
    title: str = ""
    domain: str = ""
    facts: list = field(default_factory=list)
    hypotheses: list = field(default_factory=list)
    tables: list = field(default_factory=list)      # (제목, 머리글, 행들)
    notes: list = field(default_factory=list)

    def add(self, f: Finding | None):
        if f is None:
            return
        (self.facts if f.kind == "fact" else self.hypotheses).append(f)

    def sorted_hypotheses(self):
        return sorted(self.hypotheses, key=lambda f: (-f.weight, -f.passed, f.text))

    def all(self):
        return self.facts + self.sorted_hypotheses()


def fact(text, detail="", derivation="", weight=0, group=""):
    return Finding(text=text, kind="fact", detail=detail, derivation=derivation,
                   weight=weight, group=group)


def guess(text, *, used=0, checked=0, passed=0, detail="", derivation="",
          weight=0, group=""):
    return Finding(text=text, kind="hypothesis", detail=detail, derivation=derivation,
                   used=used, checked=checked, passed=passed, weight=weight, group=group)
