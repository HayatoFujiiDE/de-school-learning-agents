#!/usr/bin/env bash
# 本番設定に fake / dev bypass が入っていないこと、fake の読み込みが src/anthropic.ts のガード内だけであることを確かめる（契約 §I）。
# rc: 0 = OK / 1 = 違反あり / 2 = 検査そのものが実行できなかった
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || exit 2
fail=0

[ -f wrangler.jsonc ] || { echo "ERROR: wrangler.jsonc が無い"; exit 2; }
[ -f src/anthropic.ts ] || { echo "ERROR: src/anthropic.ts が無い"; exit 2; }

# 1. wrangler.jsonc に ANTHROPIC_FAKE / ACCESS_DEV_BYPASS_EMAIL が無い
for name in ANTHROPIC_FAKE ACCESS_DEV_BYPASS_EMAIL; do
  grep -n "$name" wrangler.jsonc >/dev/null
  rc=$?
  if [ $rc -eq 0 ]; then echo "FAIL: wrangler.jsonc に $name がある"; fail=1
  elif [ $rc -ne 1 ]; then echo "ERROR: grep rc=$rc"; exit 2
  else echo "ok: wrangler.jsonc に $name は無い"; fi
done

# 2. src/fake/ を参照するのは src/anthropic.ts だけ（src/fake/ 自身を除く）
refs="$(grep -rnE "(from|import\()\s*['\"][^'\"]*fake/" src --include='*.ts' --exclude-dir=fake)"
rc=$?
if [ $rc -gt 1 ]; then echo "ERROR: grep rc=$rc"; exit 2; fi
others="$(printf '%s\n' "$refs" | grep -v '^src/anthropic\.ts:' | grep -v '^$')"
if [ -n "$others" ]; then echo "FAIL: src/anthropic.ts 以外が fake を参照している:"; printf '%s\n' "$others"; fail=1
else echo "ok: fake を参照するのは src/anthropic.ts だけ"; fi

# 3. src/anthropic.ts の fake 参照は動的 import 1 箇所だけで、その直前の行が fakeAllowed() ガード
imports="$(grep -nE "(from|import\()\s*['\"][^'\"]*fake/" src/anthropic.ts | grep -vE '^\s*[0-9]+:\s*//')"
count="$(printf '%s\n' "$imports" | grep -c "import('./fake/anthropic')")"
total="$(printf '%s\n' "$imports" | grep -c .)"
if [ "$count" -ne 1 ] || [ "$total" -ne 1 ]; then
  echo "FAIL: src/anthropic.ts の fake 参照が動的 import 1 箇所ではない（import=${count}, 参照=${total}）"; fail=1
else
  line="$(printf '%s\n' "$imports" | cut -d: -f1)"
  prev="$(sed -n "$((line - 1))p" src/anthropic.ts)"
  if printf '%s' "$prev" | grep -q "if (!fakeAllowed(env, ctx)) return null; // FAKE_GUARD"; then
    echo "ok: fake の動的 import（${line} 行目）は fakeAllowed() ガードの直後"
  else
    echo "FAIL: fake の動的 import の直前がガードではない"; fail=1
  fi
fi

# 4. 静的 import で fake を読んでいない
static="$(grep -rnE "^\s*import .*fake/" src --include='*.ts' --exclude-dir=fake)"
rc=$?
if [ $rc -gt 1 ]; then echo "ERROR: grep rc=$rc"; exit 2; fi
if [ -n "$static" ]; then echo "FAIL: fake を静的 import している:"; printf '%s\n' "$static"; fail=1; else echo "ok: fake の静的 import は無い"; fi

# 5. fakeAllowed は ANTHROPIC_FAKE === '1' と hostname を両方見る
if grep -q "env.ANTHROPIC_FAKE !== '1'" src/anthropic.ts && grep -q "isLocalHostname(ctx.hostname)" src/anthropic.ts; then
  echo "ok: fakeAllowed は ANTHROPIC_FAKE と hostname を見る"
else
  echo "FAIL: fakeAllowed の条件が見つからない"; fail=1
fi

if [ $fail -eq 0 ]; then echo "CHECK_NO_FAKE=PASS"; else echo "CHECK_NO_FAKE=FAIL"; fi
exit $fail
