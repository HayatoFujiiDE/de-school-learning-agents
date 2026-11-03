#!/bin/sh
# Render routes at 1440 / 1024 / 390 with headless Chrome. Usage: tools/render.sh <out-dir> [route...]
# 390 is captured through a 390px iframe (headless Chrome clamps windows to 500px wide).
set -u
OUT="${1:?out dir}"; shift
TOOLS="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$TOOLS")/app-v3"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
for r in "$@"; do
  case "$r" in
    *.html*) url="file://$ROOT/$r"; name="$(printf '%s' "$r" | tr '#/?=' '____')" ;;
    *)       url="file://$ROOT/index.html#$r"; name="$(printf '%s' "$r" | tr '/?=' '___')" ;;
  esac
  for w in 1440x900 1024x768; do
    W="${w%x*}"; H="${w#*x}"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size="$W,$H" --virtual-time-budget=2500 \
      --screenshot="$OUT/${name}_${W}.png" "$url" >/dev/null 2>&1 || printf 'FAIL %s %s\n' "$r" "$w"
  done
  U=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$url")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --allow-file-access-from-files \
    --window-size=500,844 --virtual-time-budget=2500 \
    --screenshot="$OUT/${name}_390.png" "file://$TOOLS/frame390.html#$U" >/dev/null 2>&1 || printf 'FAIL %s 390\n' "$r"
done
ls "$OUT" | wc -l
