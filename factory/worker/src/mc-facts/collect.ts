// パッチノートを取ってきて R2 等へ置く。上限つき（版の数・応答の大きさ・1 回の待ち時間・締め切り）で、
// Mojang の 2 つのホスト以外へは一切取りに行かない。cron へはまだつないでいない（オーナー承認待ち）。
import {
  EDITIONS,
  MANIFEST_URL,
  MOJANG_HOSTS,
  PATCH_NOTES_BASE,
  PATCH_NOTES_INDEX_URL,
  factsKey,
  indexKey,
  parseManifest,
  parsePatchNoteDetail,
  parsePatchNotesIndex,
  parseStoredIndex,
  type Edition,
  type ManifestVersion,
} from './parse';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type PutFn = (key: string, body: string) => Promise<void>;
export type GetFn = (key: string) => Promise<string | null>;

export interface CollectOptions {
  editions: Edition[];
  /** 1 回で詳細を取りに行く版の最大数（全 edition 合計） */
  limit: number;
  /** 締め切り（epoch ms）。これを過ぎたら次の取得を始めない */
  deadline: number;
  /** 保存済み index.json を読む関数。無ければ毎回すべて書く */
  get?: GetFn;
  /** 取りに行く版の種類（例: ['release']）。省略時はすべて */
  types?: string[];
  timeoutMs?: number;
  maxIndexBytes?: number;
  maxDetailBytes?: number;
  now?: () => number;
}

export type VersionStatus = 'written' | 'unchanged' | 'error';

export interface CollectResult {
  versions: { edition: Edition; version: string; status: VersionStatus; change_count?: number; reason?: string }[];
  errors: { edition: Edition | null; version: string | null; reason: string }[];
  stopped_by_deadline: boolean;
  stopped_by_limit: boolean;
  indexes_written: Edition[];
}

export class FetchRejected extends Error {}

const ALLOWED_HOSTS = new Set<string>(MOJANG_HOSTS);

/** https かつ Mojang の 2 ホストだけ通す。ユーザー情報・ポート指定つきも通さない */
export function isAllowedUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname) && u.port === '' && u.username === '' && u.password === '';
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get('content-length') ?? '');
  if (Number.isFinite(len) && len > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new FetchRejected('too_large');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new FetchRejected('too_large');
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder('utf-8').decode(buf);
}

/** 許可ホスト・時間・大きさの上限つきで JSON を 1 つ取る */
export async function fetchJsonBounded(
  fetchImpl: FetchLike,
  url: string,
  opts: { maxBytes: number; timeoutMs: number; deadline: number; now: () => number },
): Promise<unknown> {
  if (!isAllowedUrl(url)) throw new FetchRejected('host_not_allowed');
  const remaining = opts.deadline - opts.now();
  if (remaining <= 0) throw new FetchRejected('deadline');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.min(opts.timeoutMs, remaining));
  try {
    let res: Response;
    try {
      res = await fetchImpl(url, { method: 'GET', redirect: 'manual', signal: ctrl.signal, headers: { accept: 'application/json' } });
    } catch {
      throw new FetchRejected(ctrl.signal.aborted ? 'timeout' : 'network');
    }
    // 転送（3xx）は追わない。転送先が許可ホストかどうかを確かめる手段を持たないため
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => {});
      throw new FetchRejected(`http_${res.status}`);
    }
    if (res.url && !isAllowedUrl(res.url)) throw new FetchRejected('host_not_allowed');
    let text: string;
    try {
      text = await readCapped(res, opts.maxBytes);
    } catch (e) {
      if (e instanceof FetchRejected) throw e;
      throw new FetchRejected(ctrl.signal.aborted ? 'timeout' : 'read_failed');
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new FetchRejected('bad_json');
    }
  } finally {
    clearTimeout(timer);
  }
}

const reasonOf = (e: unknown) => (e instanceof FetchRejected ? e.message : 'internal');

export async function collectPatchNotes(fetchImpl: FetchLike, put: PutFn, options: CollectOptions): Promise<CollectResult> {
  const now = options.now ?? Date.now;
  const limit = Math.max(0, Math.floor(options.limit));
  const fo = {
    timeoutMs: options.timeoutMs ?? 10_000,
    deadline: options.deadline,
    now,
  };
  const maxIndexBytes = options.maxIndexBytes ?? 4 * 1024 * 1024;
  const maxDetailBytes = options.maxDetailBytes ?? 2 * 1024 * 1024;
  const types = options.types ? new Set(options.types) : null;
  const result: CollectResult = { versions: [], errors: [], stopped_by_deadline: false, stopped_by_limit: false, indexes_written: [] };
  let used = 0;
  const editions = options.editions.filter((e, i, a) => EDITIONS.includes(e) && a.indexOf(e) === i);

  for (const edition of editions) {
    if (now() >= options.deadline) {
      result.stopped_by_deadline = true;
      break;
    }
    if (used >= limit) {
      result.stopped_by_limit = true;
      break;
    }
    let manifest: Map<string, ManifestVersion> | undefined;
    if (edition === 'java') {
      try {
        manifest = parseManifest(await fetchJsonBounded(fetchImpl, MANIFEST_URL, { ...fo, maxBytes: maxIndexBytes }));
      } catch (e) {
        // manifest が無くても、パッチノート側の type で続ける
        result.errors.push({ edition, version: null, reason: 'manifest_' + reasonOf(e) });
      }
    }
    let entries;
    try {
      entries = parsePatchNotesIndex(edition, await fetchJsonBounded(fetchImpl, PATCH_NOTES_INDEX_URL[edition], { ...fo, maxBytes: maxIndexBytes }));
    } catch (e) {
      result.errors.push({ edition, version: null, reason: 'index_' + reasonOf(e) });
      continue;
    }
    const nowIso = new Date(now()).toISOString();
    let stored = parseStoredIndex(edition, null, nowIso);
    if (options.get) {
      try {
        stored = parseStoredIndex(edition, await options.get(indexKey(edition)), nowIso);
      } catch {
        result.errors.push({ edition, version: null, reason: 'stored_index_unreadable' });
      }
    }
    let indexChanged = false;

    for (const entry of entries) {
      const t = (edition === 'java' ? manifest?.get(entry.version)?.type : undefined) ?? entry.type ?? 'unknown';
      if (types && !types.has(t)) continue;
      if (used >= limit) {
        result.stopped_by_limit = true;
        break;
      }
      if (now() >= options.deadline) {
        result.stopped_by_deadline = true;
        break;
      }
      used++;
      const fail = (reason: string) => {
        result.versions.push({ edition, version: entry.version, status: 'error', reason });
        result.errors.push({ edition, version: entry.version, reason });
      };
      // 一覧に書かれたリンクでも、許可ホスト（の /v2/ 配下）以外は取りに行かない
      if (!entry.detail_url || !isAllowedUrl(entry.detail_url) || !entry.detail_url.startsWith(PATCH_NOTES_BASE)) {
        fail('host_not_allowed');
        continue;
      }
      let detail: unknown;
      try {
        detail = await fetchJsonBounded(fetchImpl, entry.detail_url, { ...fo, maxBytes: maxDetailBytes });
      } catch (e) {
        const reason = reasonOf(e);
        if (reason === 'deadline') {
          used--;
          result.stopped_by_deadline = true;
          break;
        }
        fail(reason);
        continue;
      }
      const record = await parsePatchNoteDetail({ entry, detail, manifest });
      if (!record) {
        fail('bad_detail');
        continue;
      }
      const key = factsKey(edition, record.version);
      if (stored.versions[record.version]?.content_hash === record.content_hash) {
        result.versions.push({ edition, version: record.version, status: 'unchanged', change_count: record.changes.length });
        continue;
      }
      try {
        await put(key, JSON.stringify(record));
      } catch {
        fail('put_failed');
        continue;
      }
      stored.versions[record.version] = { type: record.type, date: record.date, content_hash: record.content_hash, key, change_count: record.changes.length };
      indexChanged = true;
      result.versions.push({ edition, version: record.version, status: 'written', change_count: record.changes.length });
    }

    if (indexChanged) {
      stored = { ...stored, updated_at: new Date(now()).toISOString() };
      try {
        await put(indexKey(edition), JSON.stringify(stored));
        result.indexes_written.push(edition);
      } catch {
        result.errors.push({ edition, version: null, reason: 'index_put_failed' });
      }
    }
    if (result.stopped_by_deadline || result.stopped_by_limit) break;
  }
  return result;
}
