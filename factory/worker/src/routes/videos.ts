// 動画の確認（Gemini）の運営の操作（契約 §Q-6・§Q-9.5）。認証は §B-1 の admin と同じ（index.ts の requireAccess。GET 以外は Origin 検証）。
// - GET  /api/videos/status … 有効か・鍵があるか（値は返さない）・今月の記帳（vv:*）
// - POST /api/videos/enable … settings video_gen_enabled を '1' にする（probe の結果を司令塔が確かめてから。鍵が無ければ 409）
// - POST /api/probe/video   … 一時 route（§Q-6）。取り置き vv:probe:{youtube_id}:{start}:{end} と月・日の上限を通してから 1 回だけ呼ぶ。
//   返すのは {status, clip_accepted, usage_present, text_head, error_code} だけ（観測値。clip が区間の中身に効いているかは司令塔が text_head で判断する）
// 鍵の値・応答本文はログにも応答にも出さない（text_head は記録の先頭 300 字だけ）。
import { getGeminiPort } from '../anthropic';
import { cas, first, getSetting, nowIso, setSetting, stmt, tokyoDay } from '../db';
import { cfg, type Env } from '../env';
import { GeminiError, capChars, type GeminiPort } from '../gemini';
import { json, readBody, type RouteCtx } from '../http';
import { tokyoMonth } from '../ledger';
import { VIDEO_MAX_RANGE_SEC, YOUTUBE_ID_RE } from '../checks/schema';
import { dailyReservedSql } from '../verify';
import { VIDEO_ENABLED_KEY, probeLedgerRef, videoPrompt, videoReserveStmt } from '../videos';

/** probe の返す本文の先頭（§Q-6） */
export const PROBE_TEXT_HEAD_CHARS = 300;
/** probe の呼び出しの締め切り */
export const PROBE_TIMEOUT_MS = 150_000;

/** Asia/Tokyo の暦月の動画の記帳（kind = 'verify' AND ref_id GLOB 'vv:*'。probe を含む） */
export async function videoMonthCents(db: D1Database, d: Date = new Date()): Promise<number> {
  const r = await first<{ c: number | null }>(db, stmt("SELECT SUM(cents) AS c FROM cost_ledger WHERE kind = 'verify' AND ref_id GLOB 'vv:*' AND substr(day, 1, 7) = ?", tokyoMonth(d)));
  return Number(r?.c ?? 0);
}

/** `GET /api/status` の `videos` と `GET /api/videos/status` */
export async function videoStatusSummary(
  env: Env,
  gemini: Pick<GeminiPort, 'configured'>,
): Promise<{ enabled: boolean; configured: boolean; month_cents: number; month_cap_cents: number; u_cents: number; model: string }> {
  const c = cfg(env);
  return {
    enabled: (await getSetting(env.DB, VIDEO_ENABLED_KEY)) === '1',
    configured: gemini.configured,
    month_cents: await videoMonthCents(env.DB),
    month_cap_cents: c.videoMonthlyCapCents,
    u_cents: c.videoUCents,
    model: c.videoModel,
  };
}

/** GET /api/videos/status */
export async function getVideosStatus(c: RouteCtx, gemini?: GeminiPort): Promise<Response> {
  return json(200, await videoStatusSummary(c.env, gemini ?? (await getGeminiPort(c.env, { hostname: c.url.hostname }))));
}

/** POST /api/videos/enable（§Q-9.5「動画の確認を有効にする」。止める操作は §Q に無い） */
export async function enableVideos(c: RouteCtx, gemini?: GeminiPort): Promise<Response> {
  const g = gemini ?? (await getGeminiPort(c.env, { hostname: c.url.hostname }));
  // 鍵が無いまま立てると、その間に検証した版の動画は記録なし（missing）のまま残る（§Q-9.1）ので断る
  if (!g.configured) return json(409, { error: 'not_configured' });
  await setSetting(c.env.DB, VIDEO_ENABLED_KEY, '1');
  console.log(JSON.stringify({ at: 'video_enable' }));
  return json(200, { enabled: true });
}

const isSec = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

/** POST /api/probe/video（§Q-6。一時 route。結果を確かめた後の PR で消す） */
export async function probeVideo(c: RouteCtx, gemini?: GeminiPort): Promise<Response> {
  const b = await readBody(c.request, 4096);
  const yt = b?.youtube_id;
  const s = b?.start_sec;
  const e = b?.end_sec;
  if (typeof yt !== 'string' || !YOUTUBE_ID_RE.test(yt) || !isSec(s) || !isSec(e) || s >= e || e - s > VIDEO_MAX_RANGE_SEC) return json(400, { error: 'invalid_input' });
  const g = gemini ?? (await getGeminiPort(c.env, { hostname: c.url.hostname }));
  // 鍵が無い時は呼ばず、取り置きもしない（§Q-4）
  if (!g.configured) return json(409, { error: 'not_configured' });
  const k = cfg(c.env);
  const at = new Date();
  const day = tokyoDay(at);
  const ref = probeLedgerRef(yt, s, e);
  const reserved = await cas(
    c.env.DB,
    videoReserveStmt({
      ledgerId: crypto.randomUUID(),
      day,
      ref,
      u: k.videoUCents,
      now: nowIso(at),
      monthCap: k.videoMonthlyCapCents,
      dailyCap: k.dailyCapCents,
      daily: dailyReservedSql(day, k.verifyTurnReserveCents),
    }),
  );
  if (!reserved) {
    // 0 行の理由は読み直して決める（決定は取り置きの 1 文で済んでいる）。同じ値の再 POST は 409
    const again = await first(c.env.DB, stmt('SELECT 1 AS x FROM cost_ledger WHERE ref_id = ?', ref));
    return json(409, { error: again ? 'already_probed' : 'cap_reached' });
  }
  let out: { status: number | null; clip_accepted: boolean | null; usage_present: boolean; text_head: string; error_code: string | null };
  try {
    const r = await g.watch({ youtubeId: yt, startSec: s, endSec: e, prompt: videoPrompt(s, e) }, { deadline: Date.now() + PROBE_TIMEOUT_MS });
    out = { status: r.httpStatus, clip_accepted: r.httpStatus >= 200 && r.httpStatus < 300, usage_present: !!r.usage, text_head: capChars(String(r.text ?? ''), PROBE_TEXT_HEAD_CHARS), error_code: null };
  } catch (err) {
    const ge = err instanceof GeminiError ? err : null;
    const status = ge?.responded && typeof ge.status === 'number' ? ge.status : null;
    out = {
      status,
      // clip の指定を付けた要求を API が受け付けたか（HTTP の観測値。応答が無ければ null）
      clip_accepted: status === null ? null : status >= 200 && status < 300,
      usage_present: ge?.usagePresent ?? false,
      text_head: '',
      error_code: ge?.kind ?? 'unknown',
    };
  }
  console.log(JSON.stringify({ at: 'video_probe', status: out.status, error_code: out.error_code }));
  return json(200, out);
}
