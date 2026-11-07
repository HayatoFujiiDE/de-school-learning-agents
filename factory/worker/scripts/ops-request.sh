#!/bin/zsh
# 運用の依頼箱（契約 §W。docs/plans/ops-requests/contract-W.md）へ、お題の run の依頼を 1 件書く。zsh / bash のどちらでも動く。
# 使い方: scripts/ops-request.sh topic <news|talk|philo|make> [--wait]
#         scripts/ops-request.sh reingest <job_id>   （invalid_outputs で failed になった job の取り込み直し。§W-2。session は作らない）
#         scripts/ops-request.sh reverify <version_id>   （review の版の検証し直し。§W-3。検証を pending に戻すだけ）
#         scripts/ops-request.sh tip-retire <tip_id>   （自動で入った active の工夫をやめる。§W-4。理由は factory_fault 固定。人が入れた工夫は止めない）
#         scripts/ops-request.sh raise <job_id>   （予算で止まった job を $5 だけ増やして続ける。§W-6。管理画面の「$5 増やして続ける」と同じ上限を通す）
#         scripts/ops-request.sh redo <material_id> <注文票.md> [--wait]   （作り直し。§W-5・§MC-4。review の版を却下し、注文票で draft を 1 件 queue。注文票は 1〜32768 文字）
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
  say '        scripts/ops-request.sh tip-retire <tip_id>' >&2
  say '        scripts/ops-request.sh raise <job_id>' >&2
  say '        scripts/ops-request.sh redo <material_id> <注文票.md> [--wait]' >&2
  exit 1
}

# §W-5・§MC-4: 作り直し。注文票は python で読んで JSON にし、SQL の ' を '' にしてから入れる。中身は画面に出さない
if [ "${1:-}" = 'redo' ]; then
  [ $# -eq 3 ] || [ $# -eq 4 ] || usage
  MAT=$2
  BRIEF_FILE=$3
  WAIT=0
  if [ $# -eq 4 ]; then
    [ "$4" = '--wait' ] || usage
    WAIT=1
  fi
  is_uuid "$MAT" || { say 'material_id は uuid の形にしてください' >&2; exit 1; }
  [ -f "$BRIEF_FILE" ] && [ -r "$BRIEF_FILE" ] || { say '注文票のファイルを読めません' >&2; exit 1; }
  command -v python3 >/dev/null 2>&1 || { say 'python3 が見つかりません（注文票の読み取りに使います）' >&2; exit 1; }
  command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }
  # cd の前に注文票の場所を決める（相対パスが cd で変わらないように）
  BRIEF_DIR=$(cd "$(dirname "$BRIEF_FILE")" && pwd) || { say '注文票のファイルを読めません' >&2; exit 1; }
  BRIEF_ABS="${BRIEF_DIR}/$(basename "$BRIEF_FILE")"
  cd "$(dirname "$0")/.." || exit 1
  ID=$(uuidgen | tr 'A-Z' 'a-z')
  is_uuid "$ID" || { say 'id を作れません' >&2; exit 1; }
  umask 077
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
  # 文字数は code point（Worker の parseRedoPayload と同じ数え方）。2 = 長さ違い・3 = 読めない
  python3 -I - "$BRIEF_ABS" "$MAT" "$ID" "$WORK/redo.sql" <<'PYREDO'
import json, sys
path, mat, rid, out = sys.argv[1:5]
try:
    with open(path, encoding='utf-8') as f:
        brief = f.read()
except Exception:
    sys.exit(3)
if len(brief) < 1 or len(brief) > 32768:
    sys.exit(2)
payload = json.dumps({'material_id': mat, 'brief_md': brief}, ensure_ascii=False)
now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')"
sql = ("INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('" + rid
       + "', 'material_redo', '" + payload.replace("'", "''") + "', 'pending', NULL, " + now + ", " + now + ")")
with open(out, 'w', encoding='utf-8') as f:
    f.write(sql)
PYREDO
  PRC=$?
  if [ "$PRC" -eq 2 ]; then
    rm -rf "$WORK"
    say '注文票は 1〜32768 文字にしてください（送っていません）' >&2
    exit 1
  fi
  if [ "$PRC" -ne 0 ]; then
    rm -rf "$WORK"
    say '注文票を UTF-8 で読めません（送っていません）' >&2
    exit 1
  fi
  LOG="$WORK/wrangler.log"
  redo_d1() {
    npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$1" >"$WORK/out.json" 2>>"$LOG"
  }
  if ! redo_d1 "$(cat "$WORK/redo.sql")"; then
    rm -f "$WORK/redo.sql"
    say "依頼を書けませんでした（wrangler の出力: ${LOG}）" >&2
    exit 1
  fi
  rm -f "$WORK/redo.sql"
  say "依頼: ${ID}（作り直し）"
  say '次の cron（最大 10 分）で review の版を却下して draft を queue し、その次の cron で始まります'
  if [ "$WAIT" -eq 0 ]; then
    rm -rf "$WORK"
    exit 0
  fi
  # --wait: 依頼の status・result の理由コードと、queue した job の status・error だけを読む（id はこの道具が作った uuid）
  Q="SELECT o.status AS req_status, o.result_json AS result_json, j.status AS job_status, j.error AS job_error FROM ops_requests o LEFT JOIN factory_jobs j ON j.id = json_extract(o.result_json, '\$.job_id') WHERE o.id = '${ID}'"
  START=$(date +%s)
  LAST=''
  while :; do
    if redo_d1 "$Q"; then
      LINE=$(python3 -I - "$WORK/out.json" <<'PYWAIT'
import json, sys
try:
    with open(sys.argv[1], encoding='utf-8') as f:
        v = json.load(f)
    rows = v[0]['results'] if isinstance(v, list) else v['results']
    r = rows[0] if rows else None
except Exception:
    print('OPEN read_error')
    sys.exit(0)
if not r:
    print('OPEN missing')
    sys.exit(0)
req = r.get('req_status')
why = None
try:
    res = json.loads(r.get('result_json') or 'null') or {}
    why = res.get('error') or res.get('refused')
except Exception:
    why = None
job = r.get('job_status')
out = f'依頼={req}' + (f' 理由={why}' if why else '')
if job is not None:
    e = r.get('job_error')
    out += f' job={job}' + (f' error={e}' if e else '')
closed = req in ('failed', 'expired') or (req == 'done' and (job is None or job in ('done', 'failed', 'cancelled', 'needs_answer')))
print(('CLOSED ' if closed else 'OPEN ') + out)
PYWAIT
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
      say '20 分たったので見るのをやめます（依頼と job はそのまま進みます）'
      break
    fi
    sleep "$WAIT_INTERVAL"
  done
  rm -rf "$WORK"
  exit 0
fi

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
if [ "$1" = 'raise' ]; then
  [ $# -eq 2 ] || usage
  JOB=$2
  # uuid の形だけを通してから SQL に入れる。額は $5（500）固定
  is_uuid "$JOB" || { say 'job_id は uuid の形にしてください' >&2; exit 1; }
  command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }
  cd "$(dirname "$0")/.." || exit 1
  ID=$(uuidgen | tr 'A-Z' 'a-z')
  umask 077
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
  SQL="INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('${ID}', 'job_raise_budget', '{\"job_id\":\"${JOB}\",\"add_cents\":500}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  if ! npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$SQL" >"$WORK/out.json" 2>"$WORK/wrangler.log"; then
    say "依頼を書けませんでした（wrangler の出力: ${WORK}/wrangler.log）" >&2
    exit 1
  fi
  rm -rf "$WORK"
  say "依頼: ${ID}（予算を 5 ドル増やす）"
  say '次の cron（最大 10 分）で、予算で止まった job なら予算を上げ、session が自動で再開します'
  exit 0
fi
if [ "$1" = 'tip-retire' ]; then
  [ $# -eq 2 ] || usage
  TIP=$2
  # uuid の形だけを通してから SQL に入れる。理由は工場の不具合（factory_fault）だけ（自由文は受けない）
  is_uuid "$TIP" || { say 'tip_id は uuid の形にしてください' >&2; exit 1; }
  command -v uuidgen >/dev/null 2>&1 || { say 'uuidgen が見つかりません' >&2; exit 1; }
  cd "$(dirname "$0")/.." || exit 1
  ID=$(uuidgen | tr 'A-Z' 'a-z')
  umask 077
  WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-ops.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
  SQL="INSERT INTO ops_requests (id, kind, payload_json, status, result_json, created_at, updated_at) VALUES ('${ID}', 'tip_retire', '{\"tip_id\":\"${TIP}\",\"reason\":\"factory_fault\"}', 'pending', NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  if ! npx --yes "wrangler@${WRANGLER_VER}" d1 execute factory --remote --json --command "$SQL" >"$WORK/out.json" 2>"$WORK/wrangler.log"; then
    say "依頼を書けませんでした（wrangler の出力: ${WORK}/wrangler.log）" >&2
    exit 1
  fi
  rm -rf "$WORK"
  say "依頼: ${ID}（工夫をやめる）"
  say '次の cron（最大 10 分）で、自動で入った active の工夫なら retired になります'
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
