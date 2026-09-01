"""곁딸린 파일을 찾는 곳.

소스에서 그냥 실행할 때와, 하나로 묶어 설치했을 때 파일이 놓이는 자리가 다르다.
PyInstaller 는 풀어 놓은 자리를 sys._MEIPASS 에 적어 두므로 그것을 먼저 본다.
"""

from __future__ import annotations

import sys
from pathlib import Path

_ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))


def asset(*parts: str) -> Path:
    return _ROOT.joinpath("assets", *parts)


def exists(*parts: str) -> bool:
    return asset(*parts).is_file()
