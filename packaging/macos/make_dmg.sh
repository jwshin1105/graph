#!/bin/bash
# macOS 디스크 이미지 만들기 — PyInstaller 가 .app 을 만든 뒤에 돌린다.
# 애플 개발자 인증서가 없으면 서명은 건너뛴다 (처음 열 때 오른쪽 클릭 → 열기).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
APP="$ROOT/build/dist/수학 탐구 계산기.app"
OUT="$ROOT/build/installer"
VERSION="${VERSION:-1.0.0}"
# 애플 실리콘과 인텔은 서로 다른 파일이다. 이름이 같으면 한쪽이 다른 쪽을 덮는다.
ARCH=$(uname -m)
DMG="$OUT/수학탐구계산기-$VERSION-macos-$ARCH.dmg"

[ -d "$APP" ] || { echo "앱을 찾지 못했습니다: $APP" >&2; exit 1; }
mkdir -p "$OUT"
rm -f "$DMG"

if [ -n "${MACOS_SIGN_IDENTITY:-}" ]; then
  echo "서명 중 — $MACOS_SIGN_IDENTITY"
  codesign --deep --force --options runtime --timestamp \
           --sign "$MACOS_SIGN_IDENTITY" "$APP"
else
  # 서명이 없으면 최소한 임시 서명이라도 해 둔다. 애플 실리콘에서는
  # 서명이 아예 없는 앱이 바로 강제 종료되기 때문이다.
  echo "인증서가 없어 임시 서명(ad-hoc)만 합니다."
  codesign --deep --force --sign - "$APP"
fi

STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/읽어 주세요.txt" <<'TXT'
왼쪽의 앱을 오른쪽 Applications 폴더로 끌어다 놓으세요.

처음 열 때 "확인되지 않은 개발자" 라고 나오면,
앱을 오른쪽 클릭(또는 control-클릭) 한 뒤 [열기] 를 고르세요.
한 번만 그렇게 하면 그 뒤로는 그냥 열립니다.
TXT

hdiutil create -volname "수학 탐구 계산기" -srcfolder "$STAGE" \
               -ov -format UDZO "$DMG"
rm -rf "$STAGE"
echo "만들었습니다 — $DMG"
