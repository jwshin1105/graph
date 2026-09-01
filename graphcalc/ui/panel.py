"""분석 보고서 — 무엇을 다루는지, 무엇이 사실이고 무엇이 가설인지, 어디서 나왔는지."""

from __future__ import annotations

import html

from ..analysis.finding import Report

CSS = """
<style>
 body { font-family: -apple-system, 'Noto Sans KR', sans-serif; font-size: 13px;
        color: #26313c; line-height: 1.55; }
 h2 { font-size: 14px; margin: 14px 0 6px; color: #10171e; }
 .kind { color: #5a6672; font-size: 12px; margin-bottom: 8px; }
 .item { margin: 5px 0 9px; }
 .badge { font-size: 11px; padding: 1px 6px; border-radius: 8px; margin-right: 6px; }
 .fact { background: #e6f2ea; color: #1d6b3d; }
 .hyp  { background: #fdf0e2; color: #96541a; }
 .hyp-bad { background: #fbe6e6; color: #a02b2b; }
 .detail { color: #4a5560; font-size: 12px; margin-left: 2px; }
 .how { color: #6b7683; font-size: 11.5px; margin: 2px 0 0 12px;
        border-left: 2px solid #dde3ea; padding-left: 8px; }
 table { border-collapse: collapse; margin: 6px 0 10px; font-size: 12px; }
 th, td { border: 1px solid #dfe5ec; padding: 2px 7px; text-align: right; }
 th { background: #f4f7fa; font-weight: 600; }
 td.h, th.h { text-align: left; background: #f8fafc; }
 .note { color: #6b7683; font-size: 12px; margin: 6px 0; }
 .empty { color: #8b95a1; }
</style>
"""


def to_html(rep: Report) -> str:
    if rep is None:
        return CSS + "<p class='empty'>왼쪽에서 식을 고르면 분석이 나옵니다.</p>"
    out = [CSS]
    if rep.title:
        out.append(f"<div class='kind'>{html.escape(rep.title)}</div>")

    facts = rep.facts
    hyps = rep.sorted_hypotheses()
    if facts:
        out.append("<h2>확인한 사실</h2>")
        out += [_item(f, "fact") for f in facts]
    if hyps:
        out.append("<h2>규칙 후보 (가설)</h2>")
        out.append("<p class='note'>유한한 항으로는 규칙이 하나로 정해지지 않습니다. "
                   "아래는 <b>본 값과 들어맞는</b> 후보이며, 확인에 쓴 여분의 항 수를 함께 적었습니다.</p>")
        out += [_item(f, "hyp") for f in hyps]
    for title, head, rows in rep.tables:
        out.append(_table(title, head, rows))
    for n in rep.notes:
        out.append(f"<p class='note'>· {html.escape(n)}</p>")
    if not facts and not hyps and not rep.tables:
        out.append("<p class='empty'>살펴볼 것이 없습니다.</p>")
    return "".join(out)


def _bold(text):
    """**이렇게** 적은 곳을 굵게. 그 밖의 글자는 모두 그대로 (HTML 로 새지 않게)."""
    parts = text.split("**")
    out = []
    for i, part in enumerate(parts):
        esc = html.escape(part)
        out.append(f"<b>{esc}</b>" if i % 2 else esc)
    return "".join(out)


def _item(f, cls):
    bad = f.kind == "hypothesis" and f.checked and f.passed < f.checked
    css = "hyp-bad" if bad else cls
    s = [f"<div class='item'><span class='badge {css}'>{html.escape(f.badge())}</span> "
         f"{_bold(f.text)}"]
    if f.detail:
        s.append(f"<div class='detail'>{_bold(f.detail)}</div>")
    if f.derivation:
        s.append(f"<div class='how'>어떻게 구했나 — {_bold(f.derivation)}</div>")
    s.append("</div>")
    return "".join(s)


MAX_COLS = 11


def _table(title, head, rows):
    # 너무 넓으면 옆으로 잘려 못 읽는다. 앞쪽만 보이고 나머지는 … 로 줄인다
    cut = len(head) > MAX_COLS
    if cut:
        head = list(head[:MAX_COLS]) + ["…"]
        rows = [list(r[:MAX_COLS]) + ["…"] for r in rows]
    s = [f"<h2>{html.escape(title)}</h2><table><tr>"]
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
