#!/usr/bin/env bash
# 契約 §AJ2-3: 確認画面で GLB を回して見るための部品を npm から取り直して public/admin/vendor/ に置く（版は固定。repo に入れる）。
# - @google/model-viewer（Apache-2.0）: dist/model-viewer.min.js（three 同梱の ESM）
# - three（Apache-2.0。model-viewer の peer）: examples/jsm/libs/draco/gltf/ の Draco 復号器（wasm + wrapper）
# 使い方: bash factory/worker/scripts/vendor-model-viewer.sh  → 取り直した後に各ファイルの bytes を出す
set -euo pipefail
MV_VERSION=4.4.0
THREE_VERSION=0.183.2
HERE=$(cd "$(dirname "$0")/.." && pwd)
OUT="$HERE/public/admin/vendor"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
npm pack "@google/model-viewer@$MV_VERSION" "three@$THREE_VERSION" --pack-destination "$TMP" > "$TMP/pack.log" 2>&1
mkdir -p mv three
tar xzf google-model-viewer-"$MV_VERSION".tgz -C mv package/dist/model-viewer.min.js package/LICENSE
tar xzf three-"$THREE_VERSION".tgz -C three package/examples/jsm/libs/draco/gltf/draco_decoder.wasm package/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js package/LICENSE
mkdir -p "$OUT/draco"
cp mv/package/dist/model-viewer.min.js "$OUT/model-viewer.min.js"
cp three/package/examples/jsm/libs/draco/gltf/draco_decoder.wasm "$OUT/draco/draco_decoder.wasm"
cp three/package/examples/jsm/libs/draco/gltf/draco_wasm_wrapper.js "$OUT/draco/draco_wasm_wrapper.js"
{
  echo "# 確認画面の vendor（契約 §AJ2-3）"
  echo
  echo "取り直し: \`bash factory/worker/scripts/vendor-model-viewer.sh\`（$(date +%Y-%m-%d) 実行）"
  echo
  echo "| ファイル | 元 | 版 | ライセンス |"
  echo "|---|---|---|---|"
  echo "| model-viewer.min.js | npm @google/model-viewer（dist/model-viewer.min.js。three 同梱） | $MV_VERSION | Apache-2.0 |"
  echo "| draco/draco_decoder.wasm・draco/draco_wasm_wrapper.js | npm three（examples/jsm/libs/draco/gltf/） | $THREE_VERSION | Apache-2.0（Draco は Google） |"
  echo
  echo "## @google/model-viewer の LICENSE"
  echo
  echo '```'
  cat mv/package/LICENSE
  echo '```'
  echo
  echo "## three の LICENSE"
  echo
  echo '```'
  cat three/package/LICENSE
  echo '```'
} > "$OUT/LICENSES.md"
ls -l "$OUT" "$OUT/draco" | awk 'NF>=9 {print $5, $NF}'
