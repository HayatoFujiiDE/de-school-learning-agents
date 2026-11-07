// 権利の確認と止める / 戻す（契約 §AK-5。Access の中・人だけ）。
// service token はこの 3 本の route では Access の層で 401（allowCommonName に入れない）。handler でも c.service なら 403 human_only（二重の守り）。
// 画面・API から url を受け取らない（id は一覧の id だけ。取りに行く url は一覧と台帳の定数）。
import { first, stmt } from '../db';
import { json, type RouteCtx } from '../http';
import { model3dEntryOf } from '../models3d';
import { assetKey, licenseLabelOf, rightsModes, subjectSha256 } from '../rights';
import { runRightsCheck } from '../rights-check';
import { rightsRecordOf, setRightsBlocked } from '../rights-store';

/** POST /api/rights/models3d/<id>/check: runRightsCheck(env, e, c.email)。結果は 200（失敗・busy も応答の status で返す） */
export async function checkRights(c: RouteCtx, id: string, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (c.service) return json(403, { error: 'human_only' });
  const e = model3dEntryOf(id);
  if (!e) return json(404, { error: 'not_found' });
  const o = await runRightsCheck(c.env, e, c.email, fetchImpl);
  // modes は確認の後の D1 の行から（止めている・指紋違いも含めて今の見せ方）
  const key = assetKey('models3d', e.id);
  const row = await first<Record<string, unknown>>(c.env.DB, stmt('SELECT * FROM rights_records WHERE asset_key = ?', key));
  const modes = rightsModes(row ? rightsRecordOf(row) : undefined, await subjectSha256(e));
  switch (o.kind) {
    case 'skipped':
      return json(200, { status: 'skipped', reason: o.reason, modes });
    case 'lost_claim':
      return json(200, { status: 'lost_claim', modes });
    case 'failed':
      return json(200, { status: 'failed', fail_code: o.fail_code, fail_class: o.fail_class, modes });
    case 'human':
      return json(200, { status: o.result, code: o.record.license_code, label: licenseLabelOf(o.record.license_code, o.record.license_url), modes });
    case 'verified': {
      const imp = o.import === null ? undefined : o.import.ok ? { status: o.import.status, bytes: o.import.bytes } : { status: 'failed', error: o.import.error };
      return json(200, {
        status: 'verified',
        code: o.record.license_code,
        label: licenseLabelOf(o.record.license_code, o.record.license_url),
        modes,
        ...(imp ? { import: imp } : {}),
      });
    }
  }
}

/** POST /api/rights/models3d/<id>/block・…/unblock: setRightsBlocked。応答 { blocked } */
export async function blockRights(c: RouteCtx, id: string, blocked: boolean): Promise<Response> {
  if (c.service) return json(403, { error: 'human_only' });
  const e = model3dEntryOf(id);
  if (!e) return json(404, { error: 'not_found' });
  return json(200, await setRightsBlocked(c.env, e, blocked, c.email));
}
