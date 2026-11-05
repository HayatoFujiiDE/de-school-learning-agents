#!/bin/sh
# Mechanical gates: forbidden words in rendered DOM, JS errors, horizontal overflow per route/width.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)/app-v3"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
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
    # horizontal overflow: open the page in a W px iframe (tools/frame-measure.html; exact width, also 390) and compare
    # document.documentElement.scrollWidth with innerWidth. No measurement = FAIL (never treat "not measured" as clean)
    U=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$url")
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files --window-size=1500,1000 --virtual-time-budget=3000 \
      --dump-dom "file://$TOOLS/frame-measure.html#$W|$U" > "$TMP/frame.html" 2> "$TMP/frame-err.log"
    hs=$(grep -oE 'HSCROLL [0-9]+ [0-9]+' "$TMP/frame.html" | head -n 1)
    if [ -z "$hs" ]; then hsr="unmeasured"; fail=1
    else
      sw=$(printf '%s' "$hs" | awk '{print $2}'); iw=$(printf '%s' "$hs" | awk '{print $3}')
      if [ "$sw" -gt $((iw + 1)) ]; then hsr="OVER(${sw}>${iw})"; fail=1; else hsr="ok"; fi
    fi
    printf '%-40s %4s  jserr=%s  forbidden=[%s]  hscroll=%s\n' "$r" "$W" "$errs" "$bad" "$hsr"
    [ "$errs" -gt 0 ] && fail=1
    [ -n "$bad" ] && fail=1
  done
done
# 今日のお題の純関数テスト（CONTRACT-v3 §X-7）: today のルートを検査する時だけ
case " $* " in *" today"*)
  node "$(dirname "$0")/today-test.js" > "$TMP/today-test.log" 2>&1
  tv=$(grep -o 'TODAY_TEST=[A-Z]*' "$TMP/today-test.log")
  printf '%-40s %s\n' "today-test" "${tv:-TODAY_TEST=MISSING}"
  [ "$tv" = "TODAY_TEST=PASS" ] || fail=1
;; esac
# 作品展示の純関数テスト（contract-app §AF-7）: gallery のルートを検査する時だけ
case " $* " in *" gallery"*)
  node "$(dirname "$0")/gallery-test.js" > "$TMP/gallery-test.log" 2>&1
  gv=$(grep -o 'GALLERY_TEST=[A-Z]*' "$TMP/gallery-test.log")
  printf '%-40s %s\n' "gallery-test" "${gv:-GALLERY_TEST=MISSING}"
  [ "$gv" = "GALLERY_TEST=PASS" ] || fail=1
;; esac
# 学びマップの純関数テスト（CONTRACT-v3 §Y-8）: map のルートを検査する時だけ
case " $* " in *" map"*)
  node "$(dirname "$0")/map-test.js" > "$TMP/map-test.log" 2>&1
  mv=$(grep -o 'MAP_TEST=[A-Z]*' "$TMP/map-test.log")
  printf '%-40s %s\n' "map-test" "${mv:-MAP_TEST=MISSING}"
  [ "$mv" = "MAP_TEST=PASS" ] || fail=1
;; esac
# あしあとの純関数テスト（CONTRACT-v3 §Z-13）: trail のルートを検査する時だけ
case " $* " in *" trail"*)
  node "$(dirname "$0")/trail-test.js" > "$TMP/trail-test.log" 2>&1
  rv=$(grep -o 'TRAIL_TEST=[A-Z]*' "$TMP/trail-test.log")
  printf '%-40s %s\n' "trail-test" "${rv:-TRAIL_TEST=MISSING}"
  [ "$rv" = "TRAIL_TEST=PASS" ] || fail=1
;; esac
rm -rf "$TMP"
printf 'CHECK_RESULT=%s\n' "$([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail
