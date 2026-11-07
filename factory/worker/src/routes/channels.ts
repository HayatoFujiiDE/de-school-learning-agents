// /api/channels（契約 V-8・V-7 f）: 人が「本人のアップ」と確かめた YouTube のチャンネルの一覧と、外す操作。認証は §B-1 の admin と同じ。
// 足すのは承認の batch の中だけ（src/publish.ts。契約 V-7 e）。外した後は確認待ちの版を仕分け直し、確認済みチャンネルの世代（trusted_gen）を進める。
import { all, conditionalBatch, nowIso, stmt } from '../db';
import { json, type RouteCtx } from '../http';
import { trustedGenBumpStmt } from '../publish';

/** channel_key（oEmbed の author_url）の長さの上限（クエリの値を DB に渡す前に切る目安） */
const CHANNEL_KEY_MAX = 2048;

/** GET /api/channels → {channels: [...]}（新しい順） */
export async function listChannels(c: RouteCtx): Promise<Response> {
  const rows = await all(
    c.env.DB,
    stmt('SELECT channel_key, channel_name, channel_url, first_version_id, approved_by, created_at FROM trusted_channels ORDER BY created_at DESC, channel_key ASC'),
  );
  return json(200, { channels: rows });
}

/**
 * DELETE /api/channels?key={channel_key} → {deleted: boolean}（契約 V-7 f）。1 つの条件付き batch:
 * 確認待ちの版の triaged_verification_id を NULL に → trusted_gen を 1 増やす → 行を消す（最後の 1 文が述語の行を消す。行が無ければどの文も 0 行で、何も変わらない）。
 * key は URL（信頼できない値）なので bind で渡す
 */
export async function deleteChannel(c: RouteCtx): Promise<Response> {
  const key = c.url.searchParams.get('key') ?? '';
  if (!key || key.length > CHANNEL_KEY_MAX) return json(400, { error: 'key_required' });
  const P = 'EXISTS (SELECT 1 FROM trusted_channels WHERE channel_key = ?)';
  const r = await conditionalBatch(c.env.DB, [
    stmt(`UPDATE material_versions SET triaged_verification_id = NULL WHERE status = 'review' AND ${P}`, key),
    trustedGenBumpStmt(P, [key], nowIso()),
    stmt('DELETE FROM trusted_channels WHERE channel_key = ?', key),
  ]);
  console.log(JSON.stringify({ at: 'channel_delete', deleted: r.ok }));
  return json(200, { deleted: r.ok });
}
