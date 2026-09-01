#!/bin/sh
# 이 꾸러미를 홈 디렉터리에 설치한다. 관리자 권한이 필요 없다.
#
#   ./install.sh            ~/.local 에 설치
#   ./install.sh --uninstall  지우기
#   PREFIX=/opt ./install.sh  다른 자리에 설치 (권한이 필요할 수 있다)
set -eu

PREFIX="${PREFIX:-$HOME/.local}"
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
APPDIR="$PREFIX/lib/graphcalc"
BIN="$PREFIX/bin/graphcalc"
DESKTOP="$PREFIX/share/applications/graphcalc.desktop"
ICONS="$PREFIX/share/icons/hicolor"

if [ "${1:-}" = "--uninstall" ]; then
    rm -rf "$APPDIR" "$BIN" "$DESKTOP"
    for s in 16 24 32 48 64 128 256 512; do
        rm -f "$ICONS/${s}x${s}/apps/graphcalc.png"
    done
    command -v update-desktop-database >/dev/null 2>&1 && \
        update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
    echo "지웠습니다."
    exit 0
fi

echo "설치 중 — $APPDIR"
rm -rf "$APPDIR"
mkdir -p "$APPDIR" "$PREFIX/bin" "$PREFIX/share/applications"
cp -a "$HERE/graphcalc/." "$APPDIR/"

ln -sf "$APPDIR/graphcalc" "$BIN"

for s in 16 24 32 48 64 128 256 512; do
    src="$APPDIR/_internal/assets/icons/icon-$s.png"
    [ -f "$src" ] || continue
    mkdir -p "$ICONS/${s}x${s}/apps"
    cp "$src" "$ICONS/${s}x${s}/apps/graphcalc.png"
done

sed "s|^Exec=graphcalc$|Exec=$BIN|" "$HERE/graphcalc.desktop" > "$DESKTOP"
chmod +x "$BIN" "$APPDIR/graphcalc" 2>/dev/null || true

command -v update-desktop-database >/dev/null 2>&1 && \
    update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && \
    gtk-update-icon-cache -f -t "$ICONS" 2>/dev/null || true

echo "끝났습니다. 터미널에서 graphcalc 로, 또는 앱 목록에서 '수학 탐구 계산기' 로 여세요."
case ":$PATH:" in
  *":$PREFIX/bin:"*) ;;
  *) echo "참고 — $PREFIX/bin 이 PATH 에 없습니다. 셸 설정에 넣어 두면 편합니다." ;;
esac
