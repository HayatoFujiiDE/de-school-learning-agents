#!/bin/zsh
# 運用の依頼箱（契約 §W。docs/plans/ops-requests/contract-W.md）へ、お題の run の依頼を 1 件書く。zsh / bash のどちらでも動く。
# 使い方: scripts/ops-request.sh topic <news|talk|philo|make> [--wait]
#         scripts/ops-request.sh reingest <job_id>   （invalid_outputs で failed になった job の取り込み直し。§W-2。session は作らない）
#         scripts/ops-request.sh reverify <version_id>   （review の版の検証し直し。§W-3。検証を pending に戻すだけ）
#   本番の D1（factory）の ops_requests に 1 行 INSERT する。次の cron（最大 10 分）が拾い、管理画面の「今すぐ作る」と同じ経路で始める。
#   --wait: 30 秒ごとに依頼と run の status を読み、run が閉じるか 20 分で止まる。出すのは status・error・made・cents だけ。
# 鍵は使わない（wrangler の Cloudflare のログインで D1 に書く）。wrangler の出力は一時ファイルへ落とし、画面には出さない。
set -u

WRANGLER_VER='4.156.2'
WAIT_INTERVAL=30
WAIT_MAX_SEC=1200

say() { printf '%s\n' "$1"; }
# uuid の形（小文字 16 進 36 文字・ハイフンの位置）だけを通す。grep は行単位で判定するため改行を含む引数が通ってしまう（レビュー指摘 2026-11-07）ので使わない
is_uuid() {
  case "$1" in
    ''|*[!0123456789abcdef-]*) return 1 ;;  # 範囲（a-f）は locale で大文字を通すことがあるので文字を並べる
  esac
  [ "${#1}" -eq 36 ] || return 1
  case "$1" in
    ????????-????-????-????-????????????) return 0 ;;
    *) return 1 ;;
  esac
}
usage() {
  say '使い方: scripts/ops-request.sh topic <news|talk|philo|make> [--wait]' >&2
  say '        scripts/ops-request.sh reingest <job_id>' >&2
  say '        scripts/ops-request.sh reverify <version_id>' >&2
  exit 1
}

[ $# -ge 2 ] && [ $# -le 3 ] || usage
if [ "$1" = 'reingest' ]; then
  [ $# -eq 2 ] || usage
  JOB=$2
  # uuid の形だけを通してから SQL に入れる
  is_uuid "$JOB" || { say 'job_id は uuid の形にしてください' >&2; exit 1; }
  command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }
  cd "$(dirname "$0")/.." || exit 1
  ID=$(uuidgen | tr 'A-Z' 'a-z')
  umask 077
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
  SQL="INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('${ID}', 'job_reingest', '{\"job_id\":\"${JOB}\"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  if ! npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$SQL" >"$WORK/out.json" 2>"$WORK/wrangler.log"; then
    say "依頼を書けませんでした（wrangler の出力: ${WORK}/wrangler.log）" >&2
    exit 1
  fi
  rm -rf "$WORK"
  say "依頼: ${ID}（取り込み直し）"
  say '次の cron（最大 10 分）で failed → running に戻り、その後の reconcile で取り込みます'
  exit 0
fi
if [ "$1" = 'reverify' ]; then
  [ $# -eq 2 ] || usage
  VER=$2
  # uuid の形だけを通してから SQL に入れる
  is_uuid "$VER" || { say 'version_id は uuid の形にしてください' >&2; exit 1; }
  command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }
  cd "$(dirname "$0")/.." || exit 1
  ID=$(uuidgen | tr 'A-Z' 'a-z')
  umask 077
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
  SQL="INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('${ID}', 'version_reverify', '{\"version_id\":\"${VER}\"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  if ! npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$SQL" >"$WORK/out.json" 2>"$WORK/wrangler.log"; then
    say "依頼を書けませんでした（wrangler の出力: ${WORK}/wrangler.log）" >&2
    exit 1
  fi
  rm -rf "$WORK"
  say "依頼: ${ID}（検証し直し）"
  say '次の cron（最大 10 分）で検証が pending に戻り、その後の検証の段が走ります'
  exit 0
fi
[ "$1" = 'topic' ] || usage
KIND=$2
# 許可の一覧と照合してから SQL に入れる
case "$KIND" in
  news|talk|philo|make) ;;
  *) say "種類は news / talk / philo / make のどれかです（受け取った: 不正な値）" >&2; exit 1 ;;
esac
WAIT=0
if [ $# -eq 3 ]; then
  [ "$3" = '--wait' ] || usage
  WAIT=1
fi

command -v python3 >/dev/null 2>&1 || { say 'python3 が見つかりません（結果の読み取りに使います）' >&2; exit 1; }
command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }

cd "$(dirname "$0")/.." || exit 1   # factory/worker（wrangler.jsonc の D1 の名前 factory を使う）

ID=$(uuidgen | tr 'A-Z' 'a-z')
case "$ID" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-*) ;;
  *) say 'id を作れません' >&2; exit 1 ;;
esac

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
LOG="$WORK/wrangler.log"

d1() {
  npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$1" >"$WORK/out.json" 2>>"$LOG"
}

SQL="INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('${ID}', 'topic_run', '{\"purpose\":\"gen\",\"kind\":\"${KIND}\"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
if ! d1 "$SQL"; then
  say "依頼を書けませんでした（wrangler の出力: ${LOG}）" >&2
  exit 1
fi
say "依頼: ${ID}（お題の生成・${KIND}）"
say '次の cron（最大 10 分）で始まります'

if [ "$WAIT" -eq 0 ]; then
  rm -rf "$WORK"
  exit 0
fi

# --wait: 依頼の status と、取った run の status・error・made・cents だけを読む（id はこの道具が作った uuid）
Q="SELECT o.status AS req_status, o.result_json AS result_json, r.status AS run_status, r.error AS run_error, r.made AS made, r.cents AS cents FROM ops_requests o LEFT JOIN topic_runs r ON r.id = json_extract(o.result_json, '\$.run_id') WHERE o.id = '${ID}'"
START=$(date +%s)
LAST=''
while :; do
  if d1 "$Q"; then
    LINE=$(python3 -I - "$WORK/out.json" <<'PY'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        v = json.load(f)
    rows = v[0]['results'] if isinstance(v, list) else v['results']
    r = rows[0] if rows else None
except Exception:
    print('read_error')
    sys.exit(0)
if not r:
    print('missing')
    sys.exit(0)
req = r.get('req_status')
err = None
try:
    res = json.loads(r.get('result_json') or 'null') or {}
    err = res.get('error') or res.get('not_taken')
except Exception:
    err = None
run = r.get('run_status')
if run is None:
    out = f'依頼={req}' + (f' error={err}' if err else '')
    closed = req in ('failed', 'expired')
else:
    e = r.get('run_error')
    out = f'依頼={req} run={run}' + (f' error={e}' if e else '') + f" made={r.get('made')} cents={r.get('cents')}"
    closed = run in ('done', 'failed', 'skipped')
print(('CLOSED ' if closed else 'OPEN ') + out)
PY
)
  else
    LINE="OPEN 読めませんでした（wrangler の出力: ${LOG}）"
  fi
  MSG=${LINE#* }
  if [ "$MSG" != "$LAST" ]; then
    say "$(date +%H:%M:%S) $MSG"
    LAST=$MSG
  fi
  case "$LINE" in
    CLOSED*) break ;;
  esac
  NOW=$(date +%s)
  if [ $((NOW - START)) -ge $WAIT_MAX_SEC ]; then
    say '20 分たったので見るのをやめます（依頼と run はそのまま進みます）'
    break
  fi
  sleep "$WAIT_INTERVAL"
done
rm -rf "$WORK"
