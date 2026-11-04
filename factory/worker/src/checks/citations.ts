// 純関数: 出典 URL と引用の機械照合（契約 §F-1）。I/O を持たない。
// events は制作 session の events.list の結果（順序は問わない）。取得ページ本文は untrusted だが、ここでは部分文字列検査にしか使わない。

export interface CitationSourceInput {
  id: string;
  url: string;
  quoted_excerpt: string | null;
  is_primary: boolean;
}

export type CheckDetail = 'ok' | 'not_fetched' | 'quote_not_found' | 'no_excerpt' | 'result_unavailable' | 'secondary';

export interface CitationResult {
  sources: Array<{ source_id: string; url_was_fetched: 0 | 1; quote_found: 0 | 1; check_detail: CheckDetail }>;
  summary: { total: number; fetched: number; quoted: number };
}

/** 小文字 host、#fragment 除去、末尾 / 除去、http→https 同一視 */
export function normalizeUrl(raw: string): string {
  const s = String(raw ?? '').trim();
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return s.replace(/#.*$/, '').replace(/\/+$/, '');
  }
  const proto = u.protocol === 'http:' ? 'https:' : u.protocol;
  let out = `${proto}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  while (out.endsWith('/')) out = out.slice(0, -1);
  return out;
}

export function normalizeSpace(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

type AnyEvent = { id?: unknown; type?: unknown; name?: unknown; input?: unknown; tool_use_id?: unknown; content?: unknown };

function resultText(ev: AnyEvent): string | null {
  if (!Array.isArray(ev.content)) return null;
  const texts: string[] = [];
  for (const b of ev.content as Array<Record<string, unknown>>) {
    if (!b || typeof b !== 'object') continue;
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
    // document block（plain text source）にも本文が入りうる
    const src = b.source as Record<string, unknown> | undefined;
    if (b.type === 'document' && src && typeof src.data === 'string' && src.type === 'text') texts.push(src.data);
  }
  return texts.length ? texts.join('\n') : null;
}

/** 大きな結果がサンドボックスのファイルへ offload された（本文の代わりにファイルパスだけ）とみなせるか */
function looksOffloaded(text: string): boolean {
  return /\/(mnt|tmp|workspace)\/[^\s]+/.test(text) && text.length < 4000;
}

/**
 * events をページ単位で流し込める集計状態（JSON にして reconcile_state_json に保存できる）。順序に依存しない。
 * 本文そのものは持たず、出典照合の判定に要る値だけを URL 単位・出典単位で持つ（tool_result ごとの配列は持たない）:
 *   fetches: web_fetch の tool_use id → 正規化 URL（fetch 回数ぶん）
 *   urls:    正規化 URL → その URL の fetch 結果に本文があったか(t) / offload らしいか(o)（URL 数ぶん）
 *   q:       引用が「その出典の URL の fetch 結果」に見つかった出典 id の集合（出典数ぶん）
 *   nf:      web_fetch 以外の tool_use id（その結果は照合に使わないので、結果が来ても何も持たない。id だけ）
 *   pend:    tool_use より先に来た tool_result の要約（use が来た時点で urls / q へ移して消す。古い順に読めば空のまま）
 */
export interface CitationAcc {
  fetches: Record<string, string>;
  urls: Record<string, { t: 0 | 1; o: 0 | 1 }>;
  q: Record<string, 1>;
  nf: Record<string, 1>;
  pend: Record<string, { t: 0 | 1; o: 0 | 1; q: string[] }>;
}

export const newCitationAcc = (): CitationAcc => ({ fetches: {}, urls: {}, q: {}, nf: {}, pend: {} });

/** 保存済みの値が今の形か（旧形式 {fetches, results} は false → 呼び出し側が先頭から集計し直す） */
export function isCitationAcc(x: unknown): x is CitationAcc {
  const a = x as Record<string, unknown> | null;
  return !!a && typeof a === 'object' && ['fetches', 'urls', 'q', 'nf', 'pend'].every((k) => !!a[k] && typeof a[k] === 'object');
}

function markUrl(acc: CitationAcc, url: string, t: 0 | 1, o: 0 | 1): void {
  const prev = acc.urls[url];
  acc.urls[url] = { t: prev?.t === 1 || t === 1 ? 1 : 0, o: prev?.o === 1 || o === 1 ? 1 : 0 };
}

export function accumulateCitations(acc: CitationAcc, sources: CitationSourceInput[], events: unknown[]): CitationAcc {
  const excerpts = sources
    .map((s) => ({ id: s.id, url: normalizeUrl(s.url), ex: normalizeSpace(s.quoted_excerpt ?? '') }))
    .filter((x) => x.ex.length > 0);
  const byUrl = new Map<string, Array<{ id: string; ex: string }>>();
  for (const x of excerpts) {
    const arr = byUrl.get(x.url) ?? [];
    arr.push({ id: x.id, ex: x.ex });
    byUrl.set(x.url, arr);
  }
  const urlOf = new Map(excerpts.map((x) => [x.id, x.url]));

  for (const raw of events) {
    const ev = raw as AnyEvent;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'agent.tool_use' && typeof ev.id === 'string') {
      const url = (ev.input as Record<string, unknown> | undefined)?.url;
      const pending = acc.pend[ev.id];
      delete acc.pend[ev.id];
      if (ev.name === 'web_fetch' && typeof url === 'string') {
        const u = normalizeUrl(url);
        acc.fetches[ev.id] = u;
        if (pending) {
          if (pending.t === 1) markUrl(acc, u, pending.t, pending.o);
          for (const sid of pending.q) if (urlOf.get(sid) === u) acc.q[sid] = 1;
        }
      } else {
        acc.nf[ev.id] = 1;
      }
    } else if (ev.type === 'agent.tool_result' && typeof ev.tool_use_id === 'string') {
      const id = ev.tool_use_id;
      if (acc.nf[id]) continue;
      const t = resultText(ev);
      if (t === null) continue; // 本文の無い結果は「結果が無い」と同じ扱い（判定に影響しない）
      const norm = normalizeSpace(t);
      const o: 0 | 1 = looksOffloaded(t) ? 1 : 0;
      const u = acc.fetches[id];
      if (u !== undefined) {
        markUrl(acc, u, 1, o);
        for (const x of byUrl.get(u) ?? []) if (!acc.q[x.id] && norm.includes(x.ex)) acc.q[x.id] = 1;
      } else {
        // use がまだ来ていない（順序が逆）。どの URL か分からないので一致した出典 id を仮に持つ
        const prev = acc.pend[id];
        const q = excerpts.filter((x) => norm.includes(x.ex)).map((x) => x.id);
        acc.pend[id] = { t: 1, o: prev?.o === 1 || o === 1 ? 1 : 0, q: [...new Set([...(prev?.q ?? []), ...q])] };
      }
    }
  }
  return acc;
}

export function finishCitations(acc: CitationAcc, sources: CitationSourceInput[]): CitationResult {
  const fetchedUrls = new Set(Object.values(acc.fetches));
  const out: CitationResult['sources'] = [];
  for (const s of sources) {
    const target = normalizeUrl(s.url);
    const fetched: 0 | 1 = fetchedUrls.has(target) ? 1 : 0;
    let quote: 0 | 1 = 0;
    let detail: CheckDetail;
    const excerpt = normalizeSpace(s.quoted_excerpt ?? '');
    if (!fetched) {
      detail = 'not_fetched';
    } else if (!excerpt) {
      detail = 'no_excerpt';
    } else {
      const u = acc.urls[target];
      if (acc.q[s.id] === 1) {
        quote = 1;
        detail = 'ok';
      } else if (!u || u.t === 0 || u.o === 1) {
        detail = 'result_unavailable';
      } else {
        detail = 'quote_not_found';
      }
    }
    if (!s.is_primary) detail = 'secondary';
    out.push({ source_id: s.id, url_was_fetched: fetched, quote_found: quote, check_detail: detail });
  }
  return {
    sources: out,
    summary: {
      total: out.length,
      fetched: out.filter((x) => x.url_was_fetched === 1).length,
      quoted: out.filter((x) => x.quote_found === 1).length,
    },
  };
}

export function checkCitations(sources: CitationSourceInput[], events: unknown[]): CitationResult {
  return finishCitations(accumulateCitations(newCitationAcc(), sources, events), sources);
}
