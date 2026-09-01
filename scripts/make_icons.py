#!/usr/bin/env python3
"""아이콘 만들기 — 디자인의 마크를 플랫폼마다 필요한 꼴로 뽑는다.

마크는 둥근 사각형에 세리프 이탤릭 f 다. 글자를 그림으로 그리는 대신 **함께 넣어 둔
글꼴로 직접 그린다** — 어느 컴퓨터에서 만들든 같은 모양이 나오게 하려는 것이다.

작은 크기에서는 글자를 조금 키우고 모서리를 덜 둥글게 한다. 큰 그림을 그대로
줄이면 16 px 에서는 획이 뭉개져 얼룩으로만 보이기 때문이다.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):   # 윈도우 콘솔은 cp1252 라 한글에서 넘어진다
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from PySide6.QtCore import QBuffer, QByteArray, QRectF, Qt
from PySide6.QtGui import (QColor, QFont, QFontDatabase, QGuiApplication, QImage,
                           QPainter, QPainterPath)
from PySide6.QtSvg import QSvgGenerator

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"
OUT = ROOT / "assets" / "icons"

ACCENT = QColor("#4369a2")        # oklch(0.52 0.10 258) — 디자인의 강조색
GLYPH = QColor("#ffffff")

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def serif_family() -> str:
    for f in ("SourceSerif4-Italic.ttf", "SourceSerif4-Regular.ttf"):
        p = FONTS / f
        if p.is_file():
            i = QFontDatabase.addApplicationFont(str(p))
            fams = QFontDatabase.applicationFontFamilies(i)
            if fams:
                return fams[0]
    return "Georgia"


def paint(p: QPainter, size: float, family: str) -> None:
    p.setRenderHint(QPainter.Antialiasing, True)
    p.setRenderHint(QPainter.TextAntialiasing, True)

    # 모서리: 디자인은 32 px 에 10 px. 아주 작을 때는 조금 덜 둥글게 해야 각이 산다
    ratio = 10 / 32 if size >= 32 else 9 / 32
    path = QPainterPath()
    path.addRoundedRect(QRectF(0, 0, size, size), size * ratio, size * ratio)
    p.fillPath(path, ACCENT)

    f = QFont(family)
    f.setItalic(True)
    f.setPixelSize(max(6, round(size * (0.60 if size >= 32 else 0.72))))
    p.setFont(f)
    p.setPen(GLYPH)
    # f 는 위아래로 길고 왼쪽이 비어 보이는 글자라 눈으로 가운데를 잡아 준다
    box = QRectF(0, -size * 0.015, size, size)
    p.drawText(box, Qt.AlignCenter, "f")


def render(size: int, family: str) -> QImage:
    img = QImage(size, size, QImage.Format_RGBA8888)
    img.fill(Qt.transparent)
    p = QPainter(img)
    paint(p, size, family)
    p.end()
    return img


def png_bytes(img: QImage) -> bytes:
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def dib_bytes(img: QImage) -> bytes:
    """아이콘용 DIB (BITMAPINFOHEADER + BGRA + AND 마스크).

    ico 안에 PNG 를 넣는 것은 비스타부터 되지만, 작은 크기까지 PNG 로 채우면
    탐색기나 작업 표시줄이 판에 따라 빈 칸을 보여 준다. 그래서 48 px 이하는
    옛날부터 쓰던 DIB 로 넣는다 — 어디서나 확실하다.
    """
    img = img.convertToFormat(QImage.Format_ARGB32)
    w, h = img.width(), img.height()
    head = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, w * h * 4,
                       0, 0, 0, 0)
    rows = []
    for y in range(h - 1, -1, -1):          # DIB 는 아래에서 위로 쌓는다
        line = bytearray()
        for x in range(w):
            c = img.pixel(x, y)             # 0xAARRGGBB
            line += bytes(((c) & 0xFF, (c >> 8) & 0xFF, (c >> 16) & 0xFF,
                           (c >> 24) & 0xFF))   # B G R A
        rows.append(bytes(line))
    xor = b"".join(rows)
    # 32비트 아이콘은 알파를 쓰므로 AND 마스크는 전부 0(불투명)으로 둔다
    stride = ((w + 31) // 32) * 4
    return head + xor + b"\x00" * (stride * h)


def build_ico(entries: dict[int, tuple[bool, bytes]], path: Path) -> None:
    """ico 컨테이너. 크기마다 DIB 인지 PNG 인지 함께 받는다.

    Pillow 에 맡기면 가장 작은 판을 늘려 채우기 때문에 크기마다 따로 그린 그림이
    버려진다. 그래서 손으로 쓴다.
    """
    n = len(entries)
    offset = 6 + 16 * n
    head, body = b"", b""
    for size in sorted(entries):
        _is_png, data = entries[size]
        head += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0,
                            1, 32, len(data), offset)
        body += data
        offset += len(data)
    path.write_bytes(struct.pack("<HHH", 0, 1, n) + head + body)


def build_icns(pngs: dict[int, bytes], path: Path) -> None:
    """PNG 를 담는 icns 컨테이너 (macOS 가 읽는 최신 형식)."""
    types = {"icp4": 16, "icp5": 32, "ic07": 128, "ic08": 256,
             "ic09": 512, "ic10": 1024, "ic11": 32, "ic12": 64,
             "ic13": 256, "ic14": 512}
    body = b""
    for tag, size in types.items():
        data = pngs.get(size)
        if data is None:
            continue
        body += tag.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def build_svg(path: Path, family: str) -> None:
    gen = QSvgGenerator()
    gen.setFileName(str(path))
    gen.setSize(gen.size().__class__(128, 128))
    gen.setViewBox(QRectF(0, 0, 128, 128))
    gen.setTitle("수학 탐구 계산기")
    gen.setDescription("둥근 사각형에 세리프 이탤릭 f")
    p = QPainter(gen)
    paint(p, 128, family)
    p.end()


def main() -> int:
    app = QGuiApplication.instance() or QGuiApplication(sys.argv[:1])
    OUT.mkdir(parents=True, exist_ok=True)
    family = serif_family()

    images = {s: render(s, family) for s in SIZES}
    for s, img in images.items():
        img.save(str(OUT / f"icon-{s}.png"))
    pngs = {s: png_bytes(img) for s, img in images.items()}

    # 48 px 이하는 DIB, 그보다 크면 PNG — 윈도우가 가장 확실하게 읽는 짜임새
    build_ico({s: (s > 48, pngs[s] if s > 48 else dib_bytes(images[s]))
               for s in ICO_SIZES}, OUT / "graphcalc.ico")
    build_icns(pngs, OUT / "graphcalc.icns")
    (OUT / "graphcalc.png").write_bytes(pngs[512])
    build_svg(ROOT / "assets" / "icon.svg", family)

    made = sorted(p.name for p in OUT.iterdir())
    print(f"'{family}' 로 {len(made)}개 만들었습니다")
    del app
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
