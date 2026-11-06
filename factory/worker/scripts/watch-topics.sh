#!/bin/zsh
# 本番の Worker のログを見張り、お題の生成・検査の行だけを出す。使い方: scripts/watch-topics.sh [秒（既定 300）]
# ふじさんが実行する（読むだけ。本番は変えない）。
R=~/Coding/DESystem/Learning-Agents
SEC=${1:-300}
pkill -f "wrangler.*tail de-school-factory" 2>/dev/null
D=$(mktemp -d)
git -C $R fetch -q origin main
git -C $R archive origin/main factory/worker/wrangler.jsonc factory/worker/scripts/tail-topics.py | tar -x -C "$D"
cd "$D/factory/worker"
echo "=== ${SEC} 秒見張ります。15 秒待ってから操作してください ==="
( npx --yes wrangler@4.156.2 tail de-school-factory --format json 2>/dev/null | python3 -u scripts/tail-topics.py ) &
sleep $SEC
pkill -f "wrangler.*tail de-school-factory" 2>/dev/null
sleep 2
echo "=== 見張り終了 ==="
