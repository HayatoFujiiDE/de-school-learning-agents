#!/bin/zsh
# 指定の commit をそのまま書き出して、本番へ migration を当ててから deploy する（main checkout の HEAD に依存しない）。
# 使い方: scripts/deploy-ref.sh <commit>   ふじさんが実行する（本番を変える）。migration は当て済みなら何もしない。
set -e
R=~/Coding/DESystem/Learning-Agents
REF=${1:?commit を指定してください}
git -C $R fetch -q origin main
D=$(mktemp -d)
git -C $R archive "$REF" | tar -x -C "$D"
cd "$D/factory/worker"
ln -s $R/factory/worker/node_modules node_modules
echo "deploying $(git -C $R log --oneline -1 "$REF")"
CI=1 npx wrangler d1 migrations apply factory --remote
npm run deploy
