# -*- mode: python ; coding: utf-8 -*-
"""하나로 묶기 — 윈도우·맥·리눅스가 같은 명세를 쓴다.

PySide6 는 웹 엔진부터 3D 까지 다 들고 있어서 그대로 묶으면 설치본이 배로 커진다.
이 앱이 쓰는 것은 위젯과 SVG 뿐이므로 나머지는 덜어 낸다. 크기를 줄이려고 덜어 내는
것이 아니라, **쓰지도 않는 것을 사용자 컴퓨터에 두지 않으려는** 것이다.
"""

import sys
from pathlib import Path

ROOT = Path(SPECPATH).resolve().parent
NAME = "graphcalc"
MAC = sys.platform == "darwin"
WIN = sys.platform == "win32"

datas = [
    (str(ROOT / "assets" / "fonts"), "assets/fonts"),
    (str(ROOT / "assets" / "icons"), "assets/icons"),
]

hiddenimports = [
    "scipy.optimize", "scipy.spatial", "scipy.integrate",
    "scipy._lib.array_api_compat.numpy.fft",
    "sympy.printing.str",
]

# 쓰지 않는 것들 — 있으면 설치본만 무거워진다
excludes = [
    # scipy 안쪽은 손대지 않는다. optimize·spatial 만 쓰지만 그 둘이 constants
    # 부터 unittest 까지 속으로 끌어다 쓴다 — 골라 빼면 조용히 깨진다.
    # (--smoke 검사가 두 번 잡아냈다. 30 MB 아끼자고 앱을 부술 값어치는 없다.)
    "matplotlib", "tkinter", "pydoc_data", "PIL", "pillow", "IPython", "pytest",
    "PySide6.QtWebEngineCore", "PySide6.QtWebEngineWidgets", "PySide6.QtWebEngineQuick",
    "PySide6.QtQuick", "PySide6.QtQuick3D", "PySide6.QtQml", "PySide6.Qt3DCore",
    "PySide6.Qt3DRender", "PySide6.Qt3DInput", "PySide6.Qt3DAnimation",
    "PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets", "PySide6.QtCharts",
    "PySide6.QtDataVisualization", "PySide6.QtBluetooth", "PySide6.QtNfc",
    "PySide6.QtPositioning", "PySide6.QtLocation", "PySide6.QtSerialPort",
    "PySide6.QtSensors", "PySide6.QtSpatialAudio", "PySide6.QtTextToSpeech",
    "PySide6.QtWebSockets", "PySide6.QtWebChannel", "PySide6.QtRemoteObjects",
    "PySide6.QtScxml", "PySide6.QtStateMachine", "PySide6.QtDesigner",
    "PySide6.QtHelp", "PySide6.QtUiTools", "PySide6.QtPdf", "PySide6.QtPdfWidgets",
    "PySide6.QtOpenGL", "PySide6.QtOpenGLWidgets", "PySide6.QtNetworkAuth",
    "PySide6.QtSql", "PySide6.QtTest", "PySide6.QtConcurrent",
]

a = Analysis(
    [str(ROOT / "packaging" / "entry.py")],
    pathex=[str(ROOT)],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

icon = None
if WIN and (ROOT / "assets" / "icons" / "graphcalc.ico").is_file():
    icon = str(ROOT / "assets" / "icons" / "graphcalc.ico")
elif MAC and (ROOT / "assets" / "icons" / "graphcalc.icns").is_file():
    icon = str(ROOT / "assets" / "icons" / "graphcalc.icns")

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name=NAME,
    console=False,          # 창만 띄운다 — 검은 콘솔이 함께 뜨지 않게
    icon=icon,
    disable_windowed_traceback=False,
)

def drop(items, needles):
    """이름에 이런 조각이 든 파일은 넣지 않는다."""
    out = []
    for entry in items:
        name = entry[0].replace("\\", "/")
        if any(n in name for n in needles):
            continue
        out.append(entry)
    return out


# 파이썬 모듈을 빼도 공유 라이브러리는 서로 물려 있어 따라 들어온다. 이름으로 걷어 낸다.
UNUSED = ["Qt6Quick", "Qt6Qml", "Qt6Pdf", "Qt63D", "Qt6Multimedia", "Qt6Charts",
          "Qt6DataVisualization", "Qt6WebEngine", "Qt6Designer", "Qt6Help",
          "Qt6Sql", "Qt6Test", "Qt6Bluetooth", "Qt6Nfc", "Qt6Sensors",
          "Qt6SerialPort", "Qt6Positioning", "Qt6TextToSpeech", "Qt6Scxml",
          "Qt6StateMachine", "Qt6RemoteObjects", "Qt6SpatialAudio",
          "PySide6/Qt/qml/", "libgtk-3", "libgdk-3", "qt6/plugins/sqldrivers",
          "plugins/multimedia", "plugins/position", "plugins/webview",
          "plugins/sceneparsers", "plugins/renderers", "plugins/geometryloaders"]
a.binaries = drop(a.binaries, UNUSED)
a.datas = drop(a.datas, UNUSED)

coll = COLLECT(exe, a.binaries, a.datas, name=NAME)

if MAC:
    app = BUNDLE(
        coll,
        name="수학 탐구 계산기.app",
        icon=icon,
        bundle_identifier="dev.graphcalc.explorer",
        info_plist={
            "CFBundleName": "수학 탐구 계산기",
            "CFBundleDisplayName": "수학 탐구 계산기",
            "CFBundleShortVersionString": "1.0.0",
            "CFBundleVersion": "1.0.0",
            "NSHighResolutionCapable": True,
            "LSMinimumSystemVersion": "11.0",
            "NSHumanReadableCopyright": "OFL 글꼴 포함 — assets/fonts/README.md 참고",
        },
    )
