#!/bin/sh
# 実サイト app/ の機械検査（contract-LS §LS-7）。tools/check.sh の写しで、file:// の代わりに live-serve.mjs の URL を見る。
# 使い方: sh tools/live-check.sh <route...>（先に node tools/live-serve.mjs を起動しておく。LIVE_URL で変えられる）
# 判定: 禁止語 0 件・JS エラー 0・横はみ出し無し・main[data-route="<base>"] がある・DOM 5KB 以上。最後に LIVE_CHECK=PASS|FAIL
set -u
BASE="${LIVE_URL:-http://127.0.0.1:4180}"
TOOLS="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP="${TMPDIR:-/tmp}/des-live-check.$$"; mkdir -p "$TMP"
fail=0
# サーバーが応答しなければ検査しない（「取れなかった」を「問題なし」と読まない）
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/app/index.html")
if [ "$code" != "200" ]; then
  printf 'server %s/app/index.html -> %s（node tools/live-serve.mjs を起動してから実行する）\n' "$BASE" "$code"
  rm -rf "$TMP"; printf 'LIVE_CHECK=FAIL\n'; exit 1
fi
for r in "$@"; do
  case "$r" in *.html*) url="$BASE/app/$r";; *) url="$BASE/app/index.html#$r";; esac
  rb="${r%%/*}"
  for W in 1440 1024 390; do
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size="$W,900" --virtual-time-budget=3000 \
      --enable-logging=stderr --v=0 --dump-dom "$url" > "$TMP/dom.html" 2> "$TMP/err.log"
    errs=$(grep -ciE 'uncaught|TypeError|ReferenceError|SyntaxError' "$TMP/err.log")
    # 禁止語（タグを外した見える文字）
    bad=$(sed -e 's/<script[^>]*>.*<\/script>//g' "$TMP/dom.html" | sed -e 's/<[^>]*>/ /g' | grep -oE '点数|ランキング|順位|評価|成績|レベル|データがありません|学びのバディ|モック|架空' | sort | uniq -c | tr '\n' ' ')
    # 横はみ出し: tools/frame-measure.html（同じ origin）の W px の iframe で開き、scrollWidth と innerWidth を比べる。測れない = FAIL
    U=$(python3 -I -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$url")
    "$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1500,1000 --virtual-time-budget=3000 \
      --dump-dom "$BASE/tools/frame-measure.html#$W|$U" > "$TMP/frame.html" 2> "$TMP/frame-err.log"
    hs=$(grep -oE 'HSCROLL [0-9]+ [0-9]+' "$TMP/frame.html" | head -n 1)
    if [ -z "$hs" ]; then hsr="unmeasured"; fail=1
    else
      sw=$(printf '%s' "$hs" | awk '{print $2}'); iw=$(printf '%s' "$hs" | awk '{print $3}')
      if [ "$sw" -gt $((iw + 1)) ]; then hsr="OVER(${sw}>${iw})"; fail=1; else hsr="ok"; fi
    fi
    # ルートの目印: <main> に data-route="<base>"（別のページへ落ちても通る、を防ぐ）・DOM 5KB 以上（白紙を通さない）
    if grep -o '<main[^>]*>' "$TMP/dom.html" | grep -q "data-route=\"$rb\""; then mark="ok"; else mark="MISSING($rb)"; fail=1; fi
    size=$(wc -c < "$TMP/dom.html" | tr -d ' ')
    if [ "$size" -ge 5120 ]; then sz="ok"; else sz="SMALL($size)"; fail=1; fi
    printf '%-28s %4s  jserr=%s  forbidden=[%s]  hscroll=%s  route=%s  dom=%s\n' "$r" "$W" "$errs" "$bad" "$hsr" "$mark" "$sz"
    [ "$errs" -gt 0 ] && fail=1
    [ -n "$bad" ] && fail=1
  done
done
# 各レーンの純関数テスト（tools/live-<page>-test.js があるルートだけ）。PASS の文字と終了コード 0 の両方を見る
for b in $(for r in "$@"; do printf '%s\n' "${r%%/*}"; done | sort -u); do
  t="$TOOLS/live-$b-test.js"
  [ -f "$t" ] || continue
  node "$t" > "$TMP/test-$b.log" 2>&1
  trc=$?
  U2=$(printf '%s' "$b" | tr '[:lower:]' '[:upper:]')
  tv=$(grep -o "LIVE_${U2}_TEST=[A-Z]*" "$TMP/test-$b.log" | tail -n 1)
  printf '%-28s %s rc=%s\n' "live-$b-test" "${tv:-LIVE_${U2}_TEST=MISSING}" "$trc"
  { [ "$tv" = "LIVE_${U2}_TEST=PASS" ] && [ "$trc" -eq 0 ]; } || fail=1
done
rm -rf "$TMP"
printf 'LIVE_CHECK=%s\n' "$([ $fail -eq 0 ] && echo PASS || echo FAIL)"
exit $fail
