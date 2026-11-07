#!/bin/sh
# 実サイト app/ のルートを 1440 / 1024 / 390 で撮る（contract-LS §LS-7）。tools/render.sh の写しで、live-serve.mjs の URL を見る。
# 使い方: sh tools/live-render.sh <out-dir> [route...]（LIVE_URL 既定 http://127.0.0.1:4180）
# 390 は 390px の iframe（tools/frame390.html・同じ origin）越しに撮る（headless Chrome は窓を 500px より狭くできない）
set -u
OUT="${1:?out dir}"; shift
BASE="${LIVE_URL:-http://127.0.0.1:4180}"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p "$OUT"
for r in "$@"; do
  case "$r" in
    *.html*) url="$BASE/app/$r"; name="$(printf '%s' "$r" | tr '#/?=' '____')" ;;
    *)       url="$BASE/app/index.html#$r"; name="$(printf '%s' "$r" | tr '/?=' '___')" ;;
  esac
  for w in 1440x900 1024x768; do
    W="${w%x*}"; H="${w#*x}"
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
      --window-size="$W,$H" --virtual-time-budget=2500 \
      --screenshot="$OUT/${name}_${W}.png" "$url" >/dev/null 2>&1 || printf 'FAIL %s %s\n' "$r" "$w"
  done
  U=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$url")
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size=500,844 --virtual-time-budget=2500 \
    --screenshot="$OUT/${name}_390.png" "$BASE/tools/frame390.html#$U" >/dev/null 2>&1 || printf 'FAIL %s 390\n' "$r"
done
ls "$OUT" | wc -l
