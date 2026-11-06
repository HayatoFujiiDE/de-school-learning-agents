#!/bin/zsh
# 機械用の注文の入口（契約 §U-5）へ、新しい素材の注文を 1 件送る。zsh / bash のどちらでも動く。
# 使い方: scripts/order.sh <注文の JSON ファイル>
#   JSON: { request_id?, title, slug, kinds, brief_md, no_personal_data: true, catalog_item_id?, concept_codes? }
#   request_id が無ければこの道具が作って足す。
# 鍵は macOS の keychain（service de-factory-order の account client-id / client-secret）から読む。
# 鍵の値は引数・画面・ログ・一時ファイルに出さない: curl へは --config -（標準入力・builtin の printf からのパイプ）で header を渡す。
# set -x と curl の -v は使わない。curl の stderr は捨てる。
set -u

ORIGIN='https://de-school-factory.h-fujii.workers.dev'
KC_SERVICE='de-factory-order'

say() { printf '%s\n' "$1"; }

if [ $# -ne 1 ] || [ ! -f "$1" ]; then
  say '使い方: scripts/order.sh <注文の JSON ファイル>' >&2
  exit 1
fi
ORDER_FILE=$1

if ! command -v python3 >/dev/null 2>&1; then
  say 'python3 が見つかりません（JSON の検査に使います）' >&2
  exit 1
fi

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/de-order.XXXXXX") || { say '一時フォルダを作れません' >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT
trap 'rm -rf "$WORK"; exit 130' INT TERM
BODY="$WORK/body.json"
RESP="$WORK/resp"

# 1. 注文の JSON を検査し、request_id が無ければ足す（鍵は扱わない）
if ! python3 -I - "$ORDER_FILE" "$BODY" <<'PY'
import json, secrets, sys
src, dst = sys.argv[1], sys.argv[2]
try:
    with open(src, encoding='utf-8') as f:
        v = json.load(f)
except Exception:
    print('注文の JSON が読めません', file=sys.stderr)
    sys.exit(1)
if not isinstance(v, dict):
    print('注文の JSON はオブジェクト（{ ... }）にしてください', file=sys.stderr)
    sys.exit(1)
if 'request_id' not in v:
    v['request_id'] = secrets.token_hex(16)
with open(dst, 'w', encoding='utf-8') as f:
    json.dump(v, f, ensure_ascii=False)
PY
then
  exit 1
fi

# 送る request_id を先に出す（鍵ではない。通信が途中で切れた時に、同じ id をファイルへ書いて送り直せば replay になる）
python3 -I - "$BODY" <<'PY'
import json, sys
with open(sys.argv[1], encoding='utf-8') as f:
    rid = json.load(f).get('request_id')
if isinstance(rid, str):
    print('request_id: ' + rid)
PY

# 2. keychain から鍵を読む（値は変数に入れるだけ。export しない・表示しない）
# 親の環境で同じ名前が export されていても子プロセスへ渡らないよう、先に unset して export の属性を落とす
unset CF_ID CF_SECRET
CF_ID=$(security find-generic-password -s "$KC_SERVICE" -a client-id -w 2>/dev/null) || CF_ID=''
CF_SECRET=$(security find-generic-password -s "$KC_SERVICE" -a client-secret -w 2>/dev/null) || CF_SECRET=''
if [ -z "$CF_ID" ] || [ -z "$CF_SECRET" ]; then
  unset CF_ID CF_SECRET
  say 'keychain に注文の入口の鍵がありません。ふじさんが通常のターミナル（この会話の外）で次の 2 行を実行し、聞かれたら値を貼ってください:'
  say "security add-generic-password -U -s $KC_SERVICE -a client-id -w"
  say "security add-generic-password -U -s $KC_SERVICE -a client-secret -w"
  exit 2
fi
NL=$(printf '\n_'); NL=${NL%_}
case "$CF_ID$CF_SECRET" in
  *'"'* | *'\'* | *"$NL"*)
    unset CF_ID CF_SECRET
    say 'keychain の鍵に使えない文字（" \ 改行）が入っています。入れ直してください（値は表示しません）' >&2
    exit 1
    ;;
esac

# 3. 送る（header の鍵は標準入力の curl の設定で渡す。応答の本文は一時フォルダへ）
# -q は先頭に置く: ~/.curlrc を読まない（trace などの設定で header がファイルに残るのを防ぐ）
HTTP_CODE=$(printf 'header = "CF-Access-Client-Id: %s"\nheader = "CF-Access-Client-Secret: %s"\n' "$CF_ID" "$CF_SECRET" |
  curl -q --config - -s -o "$RESP" -w '%{http_code}' --max-time 120 \
    -H 'Content-Type: application/json' -H "Origin: $ORIGIN" \
    --data-binary "@$BODY" "$ORIGIN/api/orders" 2>/dev/null)
CURL_RC=$?
unset CF_ID CF_SECRET
if [ "$CURL_RC" -ne 0 ]; then
  say "入口に届いていない（送信に失敗しました）: HTTP ${HTTP_CODE:-000}"
  exit 1
fi

# 4. 出すもの: 送った request_id（送り直しに使う。鍵ではない）、status、material_id / job_id / replay / error / start_error だけ
python3 -I - "$RESP" "$HTTP_CODE" <<'PY'
import json, sys
path, code = sys.argv[1], sys.argv[2]
try:
    with open(path, encoding='utf-8') as f:
        v = json.load(f)
except Exception:
    v = None
if not isinstance(v, dict):
    print('入口に届いていない（応答が JSON ではありません）: HTTP ' + code)
    sys.exit(1)
print('HTTP ' + code)
for k in ('material_id', 'job_id', 'replay', 'error', 'start_error'):
    if k in v:
        x = v[k]
        print(k + ': ' + (json.dumps(x) if isinstance(x, bool) or x is None else str(x)))
sys.exit(0 if code in ('200', '201') else 1)
PY
