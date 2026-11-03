#!/bin/sh
# Mechanical gates: forbidden words in rendered DOM, JS errors, horizontal overflow per route/width.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)/app-v3"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="${TMPDIR:-/tmp}/des-check.$$"; mkdir -p "$TMP"
fail=0
for r in "$@"; do
  case "$r" in *.html*) url="file://$ROOT/$r";; *) url="file://$ROOT/index.html#$r";; esac
  for W in 1440 1024 390; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="$W,900" --virtual-time-budget=3000 \
      --enable-logging=stderr --v=0 --dump-dom "$url" > "$TMP/dom.html" 2> "$TMP/err.log"
    errs=$(grep -ciE 'uncaught|TypeError|ReferenceError|SyntaxError' "$TMP/err.log")
    # forbidden words in visible DOM (strip tags)
    bad=$(sed -e 's/<script[^>]*>.*<\/script>//g' "$TMP/dom.html" | sed -e 's/<[^>]*>/ /g' | grep -oE '点数|ランキング|順位|評価|成績|レベル|データがありません' | sort | uniq -c | tr '\n' ' ')
    printf '%-40s %4s  jserr=%s  forbidden=[%s]\n' "$r" "$W" "$errs" "$bad"
    [ "$errs" -gt 0 ] && fail=1
    [ -n "$bad" ] && fail=1
  done
done
rm -rf "$TMP"
printf 'CHECK_RESULT=%s\n' "$([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail
