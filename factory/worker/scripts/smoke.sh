#!/usr/bin/env bash
# smoke: wrangler dev（--local --port 8787、fake）をバックグラウンドで起動し、scripts/smoke.mjs で受け入れ基準を叩く（契約 §I、§K-8）。
# 入口: 週次・月 2 回の自動起動は SCOUT_DAY=9 / MEETING_DAYS= で止め、手動起動で確かめる。月次上限は 1 セント（1 回目の費用で上限に達し (s) を確かめる）
# 状態は一時ディレクトリに置く（.wrangler/state や手元の .dev.vars には触らない）。終了時に必ず dev を止める。
# 出力: PASS / FAIL 行と SMOKE_RESULT=PASS|FAIL。rc: 0=PASS / 1=FAIL / 2=起動できなかった
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE" || exit 2
PORT=8787
BASE="http://localhost:${PORT}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/factory-smoke.XXXXXX")" || exit 2
DEV_PID=""

cleanup() {
  if [ -n "$DEV_PID" ]; then
    pkill -P "$DEV_PID" 2>/dev/null
    kill "$DEV_PID" 2>/dev/null
    wait "$DEV_PID" 2>/dev/null
  fi
  # wrangler の子プロセス（workerd）が残っていないことを確かめる
  for _ in 1 2 3 4 5; do
    if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then sleep 1; else break; fi
  done
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

if lsof -iTCP:"$PORT" -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "FAIL port_${PORT}_in_use"
  echo "SMOKE_RESULT=FAIL"
  exit 2
fi

# smoke 専用の値（本物の秘密ではない。署名鍵は毎回ランダム）
KEY="whsec_$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64'))")"
cat > "$TMP/dev.env" <<ENV
ANTHROPIC_FAKE=1
ACCESS_DEV_BYPASS_EMAIL=smoke@example.invalid
ANTHROPIC_WEBHOOK_SIGNING_KEY=${KEY}
ANTHROPIC_API_KEY=sk-ant-fake-not-a-key
FACTORY_AGENT_ID=agent_fake
FACTORY_ENV_ID=env_fake
MAX_CONCURRENT_JOBS=20
DAILY_CAP_CENTS=1000000
XAI_API_KEY=xai-fake-not-a-key
SCOUT_MONTHLY_CAP_CENTS=1
MEETING_MONTHLY_CAP_CENTS=1
SCOUT_DAY=9
MEETING_DAYS=
ENV

bash scripts/sync-claude-assets.sh > "$TMP/assets.log" 2>&1 || { echo "FAIL build_assets"; echo "SMOKE_RESULT=FAIL"; exit 2; }
npx wrangler d1 migrations apply factory --local --persist-to "$TMP/state" > "$TMP/migrate.log" 2>&1 || { echo "FAIL migrate_local"; echo "SMOKE_RESULT=FAIL"; exit 2; }

npx wrangler dev --local --port "$PORT" --ip 127.0.0.1 --persist-to "$TMP/state" --env-file "$TMP/dev.env" \
  --test-scheduled --show-interactive-dev-session=false > "$TMP/dev.log" 2>&1 &
DEV_PID=$!

ready=0
for _ in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "$BASE/api/library/available" || true)"
  if [ "$code" = "200" ]; then ready=1; break; fi
  if ! kill -0 "$DEV_PID" 2>/dev/null; then break; fi
  sleep 1
done
if [ "$ready" != "1" ]; then
  echo "FAIL dev_not_ready"
  if grep -qiE 'login|authenticate' "$TMP/dev.log"; then echo "FAIL wrangler_requested_login"; fi
  echo "SMOKE_RESULT=FAIL"
  exit 2
fi
echo "dev ready: $BASE"

SMOKE_BASE="$BASE" SMOKE_WEBHOOK_KEY="$KEY" node scripts/smoke.mjs
rc=$?

# dev ログに例外が無いこと（本文は出さず件数だけ）
errs="$(grep -c 'fetch_error' "$TMP/dev.log" || true)"
echo "dev_log_fetch_errors=${errs}"
exit $rc
