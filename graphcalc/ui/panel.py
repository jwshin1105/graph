"""분석 보고서 — 무엇을 다루는지, 무엇이 사실이고 무엇이 가설인지, 어디서 나왔는지.

수식은 세리프로 앉힌다. 다만 결론은 "모든 점이 x² + y² = 1 을 만족합니다" 처럼
한글과 수식이 한 문장에 섞여 있어서, 어디까지가 수식인지 가려내야 한다.
mathize() 가 그 일을 하되 **의심스러우면 건드리지 않는다** — 한글을 세리프
이탤릭으로 눕히는 것이 수식을 본문체로 두는 것보다 훨씬 나쁘기 때문이다.
"""

from __future__ import annotations

import html
import re

from ..analysis.finding import Report
from .theme import report_css

# 이 가운데 하나라도 있으면 수식으로 본다
MATH_MARK = set("=≤≥≠∈∉⊂⊆∅∪∩∖∞√∛≈≡±×÷·−→∫∑∏∂⌊⌋⌈⌉"
                "²³⁴⁵⁶⁷⁸⁹⁰ⁿ⁺⁻₀₁₂₃₄₅₆₇₈₉₊₋ₙₖₘₕₗₚₛₜₓₐₑₒᵢⱼ"
                "πεδθφλμσωΔΣΠΩℤℕℚℝℂ")
HANGUL = re.compile(r"[가-힣ㄱ-ㅎㅏ-ㅣ]")
OPEN, CLOSE = "([{", ")]}"


def mathize(text: str) -> str:
    """한글 문장 속의 수식 토막만 세리프로 감싼다 (이스케이프까지 마친 결과).

    띄어쓰기로 끊어 놓고, **한글이 없는 낱말이 이어지는 동안**을 한 토막으로 본다.
    그 토막 안에 수학 기호가 하나라도 있어야 수식으로 인정한다. 의심스러우면
    건드리지 않는다 — 한글을 이탤릭 세리프로 눕히는 쪽이 훨씬 나쁘기 때문이다.

    글자는 하나도 잃지 않는다. 감싸지 못한 것은 그대로 흘려보낸다.
    """
    out: list[str] = []
    buf: list[str] = []

    def flush() -> None:
        if not buf:
            return
        raw = "".join(buf)
        buf.clear()
        lead, core, tail = _balance(raw)
        if len(core) >= 2 and any(c in MATH_MARK for c in core):
            out.append(html.escape(lead))
            out.append(f"<span class='m'>{html.escape(core)}</span>")
            out.append(html.escape(tail))
        else:
            out.append(html.escape(raw))

    for token in re.split(r"(\s+)", text):
        if not token:
            continue
        if token.isspace():
            (buf if buf else out).append(token if buf else html.escape(token))
        elif HANGUL.search(token):
            flush()
            out.append(html.escape(token))
        else:
            buf.append(token)
    flush()
    return "".join(out)


def _balance(run: str):
    """토막의 앞뒤에서 수식이 아닌 것(공백·줄표·짝 없는 괄호)을 밖으로 밀어낸다."""
    i, j = 0, len(run)
    while i < j and (run[i] in CLOSE or run[i] in "—–" or run[i].isspace()):
        i += 1
    while j > i and (run[j - 1] in OPEN or run[j - 1] in "—–" or run[j - 1].isspace()):
        j -= 1
    lead, core, tail = run[:i], run[i:j], run[j:]
    while core.count("(") < core.count(")") and core.endswith(")"):
        core, tail = core[:-1], ")" + tail
    while core.count("(") > core.count(")") and core.startswith("("):
        lead, core = lead + "(", core[1:]
    return lead, core, tail


def rich(text: str) -> str:
    """**이렇게** 적은 곳은 굵게, 수식 토막은 세리프로."""
    parts = text.split("**")
    return "".join(f"<b>{mathize(p)}</b>" if i % 2 else mathize(p)
                   for i, p in enumerate(parts))


def to_html(rep: Report) -> str:
    if rep is None:
        return report_css() + "<p class='empty'>왼쪽에서 식을 고르면 분석이 나옵니다.</p>"
    out = [report_css()]
    facts = rep.facts
    hyps = rep.sorted_hypotheses()
    if facts:
        out.append("<div class='sec fact'>확인한 사실</div>")
        out += [_item(f) for f in facts]
    if hyps:
        out.append("<div class='sec hyp'>규칙 후보 · 가설</div>")
        out.append("<p class='note'>유한한 항으로는 규칙이 하나로 정해지지 않습니다. "
                   "아래는 본 값과 들어맞는 후보이며, 규칙을 세울 때 <b>쓰지 않은</b> 항으로 "
                   "확인한 결과를 함께 적었습니다.</p>")
        out += [_item(f) for f in hyps]
    for title, head, rows in rep.tables:
        out.append(_table(title, head, rows))
    for n in rep.notes:
        out.append(f"<p class='note'>{rich(n)}</p>")
    if not facts and not hyps and not rep.tables:
        out.append("<p class='empty'>살펴볼 것이 없습니다.</p>")
    return "".join(out)


def _item(f):
    if f.kind == "fact":
        cls, word = "b-fact", "사실"
    elif f.checked and f.passed < f.checked:
        cls, word = "b-bad", "가설"
    elif f.checked:
        cls, word = "b-hyp", "가설"
    else:
        cls, word = "b-none", "가설"
    # Qt 리치텍스트는 inline 요소의 padding 을 그리지 않는다. 그래서 공백을
    # 글자로 넣어 배지 안쪽 여백을 만든다.
    s = [f"<div class='item'><span class='badge {cls}'>&nbsp;{word}&nbsp;</span>"
         f"&nbsp;&nbsp;{rich(f.text)}"]
    if f.detail:
        s.append(f"<div class='detail'>{rich(f.detail)}</div>")
    if f.kind == "hypothesis":
        s.append(f"<div class='check'>{_verdict(f)}</div>")
    if f.derivation:
        s.append(f"<div class='how'>어떻게 구했나 — {rich(f.derivation)}</div>")
    s.append("</div>")
    return "".join(s)


def _verdict(f) -> str:
    if not f.checked:
        return ("<span class='unchecked'>○ 확인하지 못했습니다 — "
                "여분의 항으로 걸러 내지 않았습니다</span>")
    if f.passed == f.checked:
        return (f"<span class='ok'>✓ 규칙을 세울 때 쓰지 않은 "
                f"{f.checked}항이 모두 들어맞음</span>")
    return (f"<span class='partial'>△ 여분 {f.checked}항 가운데 "
            f"{f.passed}항만 들어맞음</span>")


MAX_COLS = 11


def _table(title, head, rows):
    cut = len(head) > MAX_COLS
    if cut:
        head = list(head[:MAX_COLS]) + ["…"]
        rows = [list(r[:MAX_COLS]) + ["…"] for r in rows]
    s = [f"<div class='sec'>{html.escape(title)}</div><table><tr>"]
    for i, h in enumerate(head):
        s.append(f"<th class='{'h' if i == 0 else ''}'>{html.escape(str(h))}</th>")
    s.append("</tr>")
    for r in rows:
        s.append("<tr>")
        for i, c in enumerate(r):
            s.append(f"<td class='{'h' if i == 0 else ''}'>{html.escape(str(c))}</td>")
        s.append("</tr>")
    s.append("</table>")
    return "".join(s)
