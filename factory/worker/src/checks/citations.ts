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
 * events をページ単位で流し込める集計状態（JSON にして reconcile_state_json に保存できる）。
 * 本文そのものは持たず、tool_result ごとに「本文があったか / offload らしいか / 引用が見つかった出典 id」だけを持つ。順序に依存しない。
 */
export interface CitationAcc {
  fetches: Record<string, string>; // web_fetch の tool_use id → 正規化 URL
  results: Record<string, { t: 0 | 1; o: 0 | 1; q: string[] }>; // tool_use_id → 要約
}

export const newCitationAcc = (): CitationAcc => ({ fetches: {}, results: {} });

export function accumulateCitations(acc: CitationAcc, sources: CitationSourceInput[], events: unknown[]): CitationAcc {
  const excerpts = sources.map((s) => ({ id: s.id, ex: normalizeSpace(s.quoted_excerpt ?? '') })).filter((x) => x.ex.length > 0);
  for (const raw of events) {
    const ev = raw as AnyEvent;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'agent.tool_use' && ev.name === 'web_fetch' && typeof ev.id === 'string') {
      const url = (ev.input as Record<string, unknown> | undefined)?.url;
      if (typeof url === 'string') acc.fetches[ev.id] = normalizeUrl(url);
    } else if (ev.type === 'agent.tool_result' && typeof ev.tool_use_id === 'string') {
      const t = resultText(ev);
      const prev = acc.results[ev.tool_use_id];
      const norm = t === null ? '' : normalizeSpace(t);
      const q = t === null ? [] : excerpts.filter((x) => norm.includes(x.ex)).map((x) => x.id);
      acc.results[ev.tool_use_id] = {
        t: prev?.t === 1 || t !== null ? 1 : 0,
        o: prev?.o === 1 || (t !== null && looksOffloaded(t)) ? 1 : 0,
        q: [...new Set([...(prev?.q ?? []), ...q])],
      };
    }
  }
  return acc;
}

export function finishCitations(acc: CitationAcc, sources: CitationSourceInput[]): CitationResult {
  const out: CitationResult['sources'] = [];
  for (const s of sources) {
    const target = normalizeUrl(s.url);
    const matchIds = Object.entries(acc.fetches)
      .filter(([, u]) => u === target)
      .map(([id]) => id);
    const fetched: 0 | 1 = matchIds.length > 0 ? 1 : 0;
    let quote: 0 | 1 = 0;
    let detail: CheckDetail;
    const excerpt = normalizeSpace(s.quoted_excerpt ?? '');
    if (!fetched) {
      detail = 'not_fetched';
    } else if (!excerpt) {
      detail = 'no_excerpt';
    } else {
      let anyText = false;
      let offloaded = false;
      for (const id of matchIds) {
        const r = acc.results[id];
        if (!r || r.t === 0) continue;
        anyText = true;
        if (r.q.includes(s.id)) {
          quote = 1;
          break;
        }
        if (r.o === 1) offloaded = true;
      }
      if (quote) detail = 'ok';
      else if (!anyText || offloaded) detail = 'result_unavailable';
      else detail = 'quote_not_found';
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
