#!/usr/bin/env python3
"""설치본 만들기 — 아이콘부터 설치 파일까지 한 번에.

    python3 scripts/package.py

지금 돌고 있는 운영체제에 맞는 것을 만든다. 다른 운영체제의 설치본은 그 운영체제에서
만들어야 한다 (파이썬을 통째로 넣기 때문에 서로 옮겨 쓸 수 없다).

**묶은 뒤에는 반드시 실행해 본다.** 묶는 데 성공했다는 것과 실행된다는 것은 다른
이야기다. 안 쓰는 모듈을 덜어 냈다가 scipy 가 조용히 깨진 적이 실제로 있었다.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

# 윈도우의 파이썬은 콘솔 인코딩을 cp1252 로 잡는다. 그대로 두면 한글은 물론
# ── 하나에도 UnicodeEncodeError 로 빌드가 통째로 멈춘다(실제로 멈췄다).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DIST = BUILD / "dist"
OUT = BUILD / "installer"
VERSION = "1.0.0"
NAME = "graphcalc"
KOREAN = "수학탐구계산기"


def run(cmd: list[str], **kw) -> None:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run(cmd, check=True, cwd=kw.pop("cwd", ROOT), **kw)


def step(text: str) -> None:
    print(f"\n── {text}", flush=True)


def make_icons() -> None:
    step("아이콘")
    env = dict(os.environ)
    env.setdefault("QT_QPA_PLATFORM", "offscreen")
    run([sys.executable, str(ROOT / "scripts" / "make_icons.py")], env=env)


def freeze() -> None:
    step("하나로 묶기 (PyInstaller)")
    shutil.rmtree(DIST, ignore_errors=True)
    run([sys.executable, "-m", "PyInstaller", str(ROOT / "packaging" / "graphcalc.spec"),
         "--noconfirm", "--distpath", str(DIST), "--workpath", str(BUILD / "work")])


def smoke() -> None:
    """묶은 것을 실제로 띄워 본다. 여기서 걸러 내지 못하면 사용자가 걸린다.

    윈도우에서 창만 있는 실행 파일은 stdout 이 없다. print 가 소리 없이 사라지므로
    출력만 보고 판단하면 **아무것도 확인하지 않고 통과**한다. 그래서 앱이 파일에
    적게 하고, 그 파일이 있는지·무슨 말이 적혔는지를 본다.
    """
    step("실행해 보기")
    if sys.platform == "darwin":
        exe = DIST / "수학 탐구 계산기.app" / "Contents" / "MacOS" / NAME
    elif sys.platform == "win32":
        exe = DIST / NAME / f"{NAME}.exe"
    else:
        exe = DIST / NAME / NAME
    if not exe.is_file():
        raise SystemExit(f"실행 파일을 찾지 못했습니다: {exe}")

    env = dict(os.environ)
    if not env.get("DISPLAY") and sys.platform != "darwin":
        env.setdefault("QT_QPA_PLATFORM", "offscreen")
    report = BUILD / "smoke.txt"
    report.unlink(missing_ok=True)
    log = BUILD / "smoke-log.txt"

    # 프로세스가 스스로 끝나기를 기다리지 않는다. 윈도우에서 앱은 네 줄을 모두
    # 제대로 그려 놓고도 부모가 끝을 보지 못했다 — 앱을 os._exit 으로 끊어도
    # 마찬가지였으니, 막히는 곳은 앱이 아니라 출력 파이프다. 확인해야 할 것은
    # "그렸는가"이지 "곱게 끝났는가"가 아니다. 파이프 대신 파일로 받고, 앱이
    # 남기는 말을 지켜보다가 다 적히면 그때 끊는다.
    끝 = ("잘 뜹니다.", "그려지지 않았습니다", "막혔습니다", "닫혔습니다")
    with open(log, "w", encoding="utf-8") as sink:
        proc = subprocess.Popen([str(exe), f"--smoke-out={report}"],
                                stdout=sink, stderr=subprocess.STDOUT, env=env)
        said = ""
        for _ in range(300):                       # 최대 300초
            if report.is_file():
                said = report.read_text(encoding="utf-8", errors="replace").strip()
                if any(w in said for w in 끝):
                    break
            if proc.poll() is not None:            # 말도 없이 죽었다
                break
            time.sleep(1)
        스스로_끝났다 = proc.poll() is not None
        if not 스스로_끝났다:
            proc.kill()
        try:
            proc.wait(30)
        except Exception:
            pass

    print(said or (log.read_text(encoding="utf-8", errors="replace").strip()
                   or "(아무 말도 남기지 않았습니다)"))
    if not said:
        raise SystemExit("앱이 확인 결과를 남기지 않았습니다. 아예 뜨지 못한 것입니다.")
    if not any(w in said for w in 끝):
        raise SystemExit("앱이 확인을 끝내지 못했습니다. 위가 마지막으로 남긴 말입니다.")
    if "잘 뜹니다." not in said:
        raise SystemExit("묶은 앱이 제대로 돌지 않습니다. 위 줄을 보세요.")
    if 스스로_끝났다 and proc.returncode != 0:
        raise SystemExit(f"앱이 종료 코드 {proc.returncode} 로 끝났습니다.")
    if not 스스로_끝났다:
        print("  (그림은 다 그렸으나 스스로 끝나지 않아 여기서 끊었습니다)")


def size_of(path: Path) -> str:
    n = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return f"{n / 1024 / 1024:.0f} MB"


# ─────────────────────────────────────────────────────────── 리눅스

def linux() -> list[Path]:
    made = []
    OUT.mkdir(parents=True, exist_ok=True)
    src = DIST / NAME

    step("tar.gz (어느 배포판에서나)")
    stage = BUILD / "stage-tar" / f"{KOREAN}-{VERSION}"
    shutil.rmtree(stage.parent, ignore_errors=True)
    stage.mkdir(parents=True)
    shutil.copytree(src, stage / NAME, symlinks=True)
    shutil.copy2(ROOT / "packaging" / "linux" / "install.sh", stage)
    shutil.copy2(ROOT / "packaging" / "linux" / "graphcalc.desktop", stage)
    (stage / "install.sh").chmod(0o755)
    tar = OUT / f"{KOREAN}-{VERSION}-linux-x86_64.tar.gz"
    with tarfile.open(tar, "w:gz") as t:
        t.add(stage, arcname=stage.name)
    made.append(tar)

    if shutil.which("dpkg-deb"):
        step("deb (데비안·우분투)")
        made.append(build_deb(src))
    else:
        print("dpkg-deb 가 없어 deb 는 건너뜁니다.")
    return made


def build_deb(src: Path) -> Path:
    root = BUILD / "stage-deb"
    shutil.rmtree(root, ignore_errors=True)
    app = root / "usr" / "lib" / "graphcalc"
    app.parent.mkdir(parents=True)
    shutil.copytree(src, app, symlinks=True)

    (root / "usr" / "bin").mkdir(parents=True)
    (root / "usr" / "bin" / "graphcalc").symlink_to("/usr/lib/graphcalc/graphcalc")

    apps = root / "usr" / "share" / "applications"
    apps.mkdir(parents=True)
    shutil.copy2(ROOT / "packaging" / "linux" / "graphcalc.desktop",
                 apps / "graphcalc.desktop")

    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        icon = ROOT / "assets" / "icons" / f"icon-{s}.png"
        if not icon.is_file():
            continue
        d = root / "usr" / "share" / "icons" / "hicolor" / f"{s}x{s}" / "apps"
        d.mkdir(parents=True, exist_ok=True)
        shutil.copy2(icon, d / "graphcalc.png")

    doc = root / "usr" / "share" / "doc" / "graphcalc"
    doc.mkdir(parents=True)
    shutil.copy2(ROOT / "assets" / "fonts" / "README.md", doc / "FONTS.md")
    for lic in (ROOT / "assets" / "fonts").glob("*OFL*"):
        shutil.copy2(lic, doc / lic.name)
    for lic in (ROOT / "assets" / "fonts").glob("LICENSE*"):
        shutil.copy2(lic, doc / lic.name)

    size_kb = sum(f.stat().st_size for f in root.rglob("*") if f.is_file()) // 1024
    ctrl = root / "DEBIAN"
    ctrl.mkdir()
    (ctrl / "control").write_text(
        "Package: graphcalc\n"
        f"Version: {VERSION}\n"
        "Section: math\n"
        "Priority: optional\n"
        "Architecture: amd64\n"
        f"Installed-Size: {size_kb}\n"
        "Maintainer: graphcalc\n"
        "Depends: libc6, libglib2.0-0, libgl1, libegl1, libxkbcommon0, "
        "libdbus-1-3, libfontconfig1, libfreetype6\n"
        "Description: 수학 탐구 계산기\n"
        " 정확한 계산, 적응형 그래프, 규칙성 탐색.\n"
        " 유리수와 근호를 그대로 두고 계산하며, 허용 오차 안에서 그래프를 그리고,\n"
        " 수열과 점열에서 규칙을 찾아 사실과 가설을 갈라 적습니다.\n",
        encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    deb = OUT / f"graphcalc_{VERSION}_amd64.deb"
    run(["dpkg-deb", "--root-owner-group", "--build", str(root), str(deb)])
    return deb


# ─────────────────────────────────────────────────────────── 윈도우·맥

def windows() -> list[Path]:
    step("설치 프로그램 (Inno Setup)")
    iscc = shutil.which("iscc") or shutil.which("ISCC")
    if not iscc:
        for guess in (r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
                      r"C:\Program Files\Inno Setup 6\ISCC.exe"):
            if Path(guess).is_file():
                iscc = guess
                break
    if not iscc:
        print("Inno Setup 을 찾지 못했습니다. 풀어서 바로 쓰는 판만 만듭니다.")
        return [zip_folder()]
    OUT.mkdir(parents=True, exist_ok=True)
    run([iscc, str(ROOT / "packaging" / "windows" / "graphcalc.iss")])
    return sorted(OUT.glob("*설치*.exe")) + [zip_folder()]


def zip_folder() -> Path:
    """설치하지 않고 풀어서 바로 쓰는 판."""
    OUT.mkdir(parents=True, exist_ok=True)
    base = OUT / f"{KOREAN}-{VERSION}-windows-x64-portable"
    shutil.make_archive(str(base), "zip", DIST, NAME)
    return base.with_suffix(".zip")


def macos() -> list[Path]:
    step("디스크 이미지 (dmg)")
    env = dict(os.environ, VERSION=VERSION)
    run(["bash", str(ROOT / "packaging" / "macos" / "make_dmg.sh")], env=env)
    return sorted(OUT.glob("*.dmg"))


def main() -> int:
    make_icons()
    freeze()
    smoke()

    step(f"꾸리기 — {platform.system()} {platform.machine()}")
    if sys.platform == "win32":
        made = windows()
    elif sys.platform == "darwin":
        made = macos()
    else:
        made = linux()

    print("\n── 다 됐습니다")
    for p in made:
        mb = p.stat().st_size / 1024 / 1024
        print(f"   {p.relative_to(ROOT)}  ({mb:.0f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
