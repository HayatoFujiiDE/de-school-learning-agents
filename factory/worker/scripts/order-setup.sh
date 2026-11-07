#!/bin/zsh
# 機械用の注文の入口（契約 §U-5）の鍵を Mac に置き、工場に「この鍵だけ通す」と登録する。
# ふじさんが通常のターミナル（agent の会話の外）で 1 回だけ実行する。zsh / bash のどちらでも動く。
#   1. keychain（service de-factory-order）に client-id と client-secret を入れる。値は security が直接聞くので画面に出ない
#   2. keychain から Client ID を読み、パイプで `wrangler secret put ORDER_CLIENT_IDS` に渡す。値は表示しない・引数に置かない
# set -x は使わない。失敗しても値を含む文字列は出さない。
set -u

KC_SERVICE='de-factory-order'
HERE=$(cd "$(dirname "$0")/.." && pwd) || exit 1   # factory/worker

say() { printf '%s\n' "$1"; }

if ! command -v security >/dev/null 2>&1; then
  say 'security コマンドが見つかりません（macOS の keychain に入れます）' >&2
  exit 1
fi

say '1/2 鍵を keychain に入れます。値を貼って Enter（確認のため 2 回聞かれます。画面には出ません）'
for acct in client-id client-secret; do
  say "  $acct:"
  if ! security add-generic-password -U -s "$KC_SERVICE" -a "$acct" -w; then
    say "keychain への保存に失敗しました（$acct）" >&2
    exit 1
  fi
done
for acct in client-id client-secret; do
  if ! security find-generic-password -s "$KC_SERVICE" -a "$acct" -w >/dev/null 2>&1; then
    say "keychain から $acct を読めません" >&2
    exit 1
  fi
done
say '  入りました'

say '2/2 工場に Client ID を登録します（wrangler secret put ORDER_CLIENT_IDS。値は表示しません）'
umask 077
LOG=$(mktemp "${TMPDIR:-/tmp}/de-order-setup.XXXXXX") || { say '一時ファイルを作れません' >&2; exit 1; }
if security find-generic-password -s "$KC_SERVICE" -a client-id -w 2>/dev/null | (cd "$HERE" && npx wrangler secret put ORDER_CLIENT_IDS >"$LOG" 2>&1); then
  rm -f "$LOG"
  say '  登録しました'
  say '完了。Claude との会話で「やった」と返してください（値や出力は貼らないでください）'
  exit 0
fi
say "  登録に失敗しました（中を見て直すか、Claude にファイルの場所だけ伝えてください。値は含みません）。wrangler の出力: $LOG" >&2
exit 1
