// テスト用（契約 V-6〜V-8）: 確認待ちの版・検証・読み手係の結果・動画の公式の情報（R2 の作り物）を node:sqlite の実 DB に入れる。
import type { DatabaseSync } from 'node:sqlite';
import type { Env } from '../src/env';
import type { RouteCtx } from '../src/http';
import { versionVideosOf, videoMetaKey, videoMetaRecordOf } from '../src/videos';
import { d1, migratedDb } from './d1-shim';
import { goodMaterial } from './helpers';

export type V = 'confirmed' | 'hypothesis' | 'unverified' | 'contradicted';
type Obj = Record<string, any>;

export const GREEN_CHECKS = { schema: 'ok', forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [], unreferenced_files: [], child_text: [] };
export const YT = 'abcdefghijk';
export const WATCH = `https://www.youtube.com/watch?v=${YT}`;
export const CH = 'https://www.youtube.com/@official';
export const okReading = (o: Obj = {}) => ({ v: 1, model: 'claude-opus-5-5', findings: [], learning: { verdict: 'ok', reason: '' }, conditions: { verdict: 'ok', reason: '' }, summary: '', not_read: [], ...o });

export interface World {
  db: DatabaseSync;
  r2: Map<string, string>;
  env: Env;
  seq: number;
}

export function world(over: Record<string, string> = {}): World {
  const db = migratedDb();
  const r2 = new Map<string, string>();
  const R2 = {
    async get(k: string) {
      const v = r2.get(k);
      return v === undefined ? null : { text: async () => v };
    },
  };
  return { db, r2, env: { DB: d1(db), R2, ...over } as unknown as Env, seq: 0 };
}

export function material(o: { video?: boolean; app?: boolean } = {}): Obj {
  const m = goodMaterial() as Obj;
  if (o.app) m.parts[0].files.push({ path: 'parts/p1/app.html', role: 'app' });
  if (o.video) m.parts[0].videos = [{ id: 'v1', youtube_id: YT, title: '動画', channel: '公式チャンネル', start_sec: 10, end_sec: 70, why: '様子', rights_note: '本人', source_id: 's9' }];
  return m;
}

export interface Seed {
  mid: string;
  vid: string;
  created_at?: string;
  claims: Array<[V, string[]]> | Array<[V, string[], string | null]>;
  sources?: Record<string, { quote_found?: number; url_was_fetched?: number; license?: string; url?: string; is_primary?: number }>;
  fetchErrors?: Record<string, number>;
  /** 既存の素材・job を使う（rework の版） */
  jobId?: string;
  newMaterial?: boolean;
  version?: number;
  material?: Obj;
  /** 古い入力の検証（meta.evidence_v なし） */
  old?: boolean;
  reader?: 'done' | 'pending' | 'failed';
  readerJson?: unknown;
  videos?: unknown[];
  apps?: unknown[] | null;
  /** 動画の公式の情報の記録（R2）。'none' なら書かない */
  meta?: { author_url?: string; author_name?: string } | 'none';
}

/** 素材 + done の job + review / 検証 done の版 + sources + verification attempt 1 + 読み手係 done（既定） */
export function seed(w: World, s: Seed): { vid: string; wid: string; jid: string } {
  const at = s.created_at ?? '2026-11-07T00:00:00.000Z';
  if (s.newMaterial !== false) {
    w.db.prepare("INSERT INTO materials (id, slug, title, kinds_json, work_status, publish_status, brief_md, created_at, updated_at) VALUES (?, ?, 't', '[3]', 'review', 'none', 'b', ?, ?)").run(s.mid, `slug-${s.mid}`, at, at);
  }
  const jid = s.jobId ?? `job-${s.vid}`;
  if (!s.jobId) {
    w.db
      .prepare("INSERT INTO factory_jobs (id, material_id, kind, model, phase, status, session_id, brief_md, created_at, updated_at) VALUES (?, ?, 'draft', 'claude-sonnet-5-5', 'making', 'done', ?, '元の注文', ?, ?)")
      .run(jid, s.mid, `sesn-${s.vid}`, at, at);
  }
  const claims = s.claims.map(([, sids], i) => ({ id: `c${i + 1}`, text: `主張 ${i + 1}`, status: 'confirmed', source_ids: sids, used_in: ['p1'] }));
  const mat = s.material ?? material();
  const reader = s.reader ?? 'done';
  w.db
    .prepare(
      `INSERT INTO material_versions (id, material_id, version, job_id, session_id, r2_prefix, content_sha256, material_json, claims_json, adapt_rules_md,
       checks_json, public_paths_json, status, verification_status, verification_attempts, reader_status, reader_token, reader_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'a', ?, '[]', 'review', 'done', 1, ?, ?, ?, ?)`,
    )
    .run(
      s.vid,
      s.mid,
      s.version ?? 1,
      jid,
      `sesn-${s.vid}`,
      `p/${s.vid}/`,
      `sha-${s.vid}`,
      JSON.stringify(mat),
      JSON.stringify({ claims }),
      JSON.stringify(GREEN_CHECKS),
      reader,
      reader === 'pending' ? null : `rt-${s.vid}`,
      reader === 'done' ? JSON.stringify(s.readerJson ?? okReading()) : null,
      at,
    );
  for (const [sid, o] of Object.entries(s.sources ?? { s1: {} })) {
    w.db
      .prepare(`INSERT INTO sources (id, material_version_id, source_id, url, license, is_primary, url_was_fetched, quote_found) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`src-${++w.seq}`, s.vid, sid, o.url ?? `https://minecraft.wiki/w/${sid}`, o.license ?? 'CC BY-SA 3.0', o.is_primary ?? 0, o.url_was_fetched ?? 1, o.quote_found ?? 1);
  }
  if (s.meta !== 'none' && Array.isArray(mat.parts?.[0]?.videos)) {
    for (const v of versionVideosOf(JSON.stringify(mat)))
      w.r2.set(videoMetaKey(`p/${s.vid}/`, v.id), JSON.stringify(videoMetaRecordOf(v, { outcome: 'ok', title: '動画', author_name: s.meta?.author_name ?? '公式チャンネル', author_url: s.meta?.author_url ?? CH }, at)));
  }
  const wid = addVerification(w, s.vid, s.claims as Array<[V, string[], string | null]>, { fetchErrors: s.fetchErrors, old: s.old, videos: s.videos, apps: s.apps });
  return { vid: s.vid, wid, jid };
}

export function addVerification(
  w: World,
  vid: string,
  claims: Array<[V, string[], (string | null)?]> | V[],
  o: { fetchErrors?: Record<string, number>; old?: boolean; videos?: unknown[]; apps?: unknown[] | null; raw?: string } = {},
): string {
  const wid = `w-${vid}-${++w.seq}`;
  const list = claims.map((c) => (typeof c === 'string' ? ([c, [], 'hedged'] as [V, string[], string]) : c));
  const verdicts = list.map(([verdict, , pa], i) => ({ claim_id: `c${i + 1}`, verdict, reason: `理由 ${i + 1}`, opened_urls: [], presented_as: pa === undefined ? 'hedged' : pa }));
  const n = (k: V) => list.filter((x) => x[0] === k).length;
  const result =
    o.raw ??
    JSON.stringify({
      verdicts,
      overall_note: '',
      figures: [{ path: 'parts/p1/figure-1.svg', verdict: 'ok', reason: '' }],
      analogy_gaps: [],
      videos: o.videos ?? [{ id: 'v1', verdict: 'ok', reason: '' }],
      apps: o.apps === undefined ? [] : o.apps,
      meta: { mode: 'batch', turns: 1, fetch_errors: o.fetchErrors ?? {}, fetched_ok: [], ...(o.old ? {} : { evidence_v: 2 }) },
    });
  w.db
    .prepare(
      `INSERT INTO verifications (id, material_version_id, attempt, model, claims_total, confirmed, hypothesis, unverified, contradicted, result_json, created_at)
     VALUES (?, ?, (SELECT COALESCE(MAX(attempt), 0) + 1 FROM verifications WHERE material_version_id = ?), 'claude-opus-5-5', ?, ?, ?, ?, ?, ?, '2026-11-07T00:00:00.000Z')`,
    )
    .run(wid, vid, vid, list.length, n('confirmed'), n('hypothesis'), n('unverified'), n('contradicted'), result);
  return wid;
}

/** 全部通る版（confirmed 2 件・読み手 ok・図 ok） */
export const good = (mid: string, vid: string, extra: Partial<Seed> = {}): Seed => ({ mid, vid, claims: [['confirmed', ['s1']], ['confirmed', ['s1']]], ...extra });
/** 機械が直させる所がある版（unverified 1 件 → not_confirmed の fix） */
export const fixable = (mid: string, vid: string, extra: Partial<Seed> = {}): Seed => ({ mid, vid, claims: [['confirmed', ['s1']], ['unverified', ['s1']]], ...extra });

export function ctx(w: World, method: string, body?: unknown, url = 'http://localhost/api/review/x'): RouteCtx {
  const request = new Request(url, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    env: w.env,
    request,
    url: new URL(request.url),
    email: 'ops@example.invalid',
    exec: {} as ExecutionContext,
    port: async () => {
      throw new Error('port not used');
    },
  };
}

export const setSetting = (w: World, k: string, v: string) =>
  w.db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v, '2026-11-07T00:00:00.000Z');
