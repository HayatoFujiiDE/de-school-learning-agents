// 純関数: 出典 URL と引用の機械照合（契約 §F-1）。I/O を持たない。
// events は制作 session の events.list の結果を古い順に（§B-4-d）。取得ページ本文は untrusted だが、ここでは部分文字列検査にしか使わない。

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
 * events は古い順に流し込む前提（契約 §B-4-d / v3.4-37）。SDK の agent.tool_result は対応する agent.tool_use の後に来るので、
 * use がまだ来ていない result は無視する（順序逆転の仮集計は持たない）。
 * 本文そのものは持たず、出典照合の判定に要る値だけを URL 単位・出典単位で持つ（tool_result ごとの配列は持たない）:
 *   fetches: web_fetch の tool_use id → 正規化 URL（result がまだ来ていない fetch だけ。result を処理したら消す）
 *   urls:    正規化 URL → その URL の fetch 結果に本文があったか(t) / offload らしいか(o)（web_fetch の use を見た URL 数ぶん）
 *   q:       引用が「その出典の URL の fetch 結果」に見つかった出典 id の集合（出典数ぶん）
 *   nf:      web_fetch 以外の tool_use id（その結果は照合に使わない。id だけ）
 * 出典 id・tool_use id・URL は職人の出力（信頼できない入力）なので、キーは必ず KEY_PREFIX を付けて名前空間化し、
 * 読む時は Object.hasOwn で判定する（`constructor` / `__proto__` / `toString` 等の継承プロパティを踏まない。JSON 復元後も同じ形）。
 */
export interface CitationAcc {
  /** 形式の版（旧形式は false 判定 → 呼び出し側が先頭から集計し直す） */
  v: 2;
  fetches: Record<string, string>;
  urls: Record<string, { t: 0 | 1; o: 0 | 1 }>;
  q: Record<string, 1>;
  nf: Record<string, 1>;
}

const KEY_PREFIX = 'k:';
const key = (raw: string): string => KEY_PREFIX + raw;
const has = (rec: Record<string, unknown>, raw: string): boolean => Object.hasOwn(rec, key(raw));
const get = <V>(rec: Record<string, V>, raw: string): V | undefined => (has(rec, raw) ? rec[key(raw)] : undefined);

export const newCitationAcc = (): CitationAcc => ({ v: 2, fetches: {}, urls: {}, q: {}, nf: {} });

const isPlainRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** 保存済みの値が今の形か（旧形式 {fetches, results} / {…, pend} は false → 呼び出し側が先頭から集計し直す） */
export function isCitationAcc(x: unknown): x is CitationAcc {
  if (!isPlainRecord(x) || x.v !== 2) return false;
  return (['fetches', 'urls', 'q', 'nf'] as const).every((k) => Object.hasOwn(x, k) && isPlainRecord(x[k]));
}

function markUrl(acc: CitationAcc, url: string, t: 0 | 1, o: 0 | 1): void {
  const prev = get(acc.urls, url);
  acc.urls[key(url)] = { t: prev?.t === 1 || t === 1 ? 1 : 0, o: prev?.o === 1 || o === 1 ? 1 : 0 };
}

export function accumulateCitations(acc: CitationAcc, sources: CitationSourceInput[], events: unknown[]): CitationAcc {
  const byUrl = new Map<string, Array<{ id: string; ex: string }>>();
  for (const s of sources) {
    const ex = normalizeSpace(s.quoted_excerpt ?? '');
    if (ex.length === 0) continue;
    const url = normalizeUrl(s.url);
    const arr = byUrl.get(url) ?? [];
    arr.push({ id: s.id, ex });
    byUrl.set(url, arr);
  }

  for (const raw of events) {
    const ev = raw as AnyEvent;
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'agent.tool_use' && typeof ev.id === 'string') {
      const url = (ev.input as Record<string, unknown> | undefined)?.url;
      if (ev.name === 'web_fetch' && typeof url === 'string') {
        const u = normalizeUrl(url);
        acc.fetches[key(ev.id)] = u;
        delete acc.nf[key(ev.id)]; // 同じ id が先に url 無し / web_fetch 以外として来ていても、web_fetch として扱う
        markUrl(acc, u, 0, 0); // fetch した URL として残す（result を処理して fetches から消えた後も url_was_fetched の根拠になる）
      } else {
        acc.nf[key(ev.id)] = 1;
      }
    } else if (ev.type === 'agent.tool_result' && typeof ev.tool_use_id === 'string') {
      const id = ev.tool_use_id;
      if (has(acc.nf, id)) continue;
      const u = get(acc.fetches, id);
      if (u === undefined) continue; // 対応する web_fetch の use が未到着（古い順の契約では来ない）/ 処理済み → 無視
      delete acc.fetches[key(id)];
      const t = resultText(ev);
      if (t === null) continue; // 本文の無い結果は「結果が無い」と同じ扱い（判定に影響しない）
      const norm = normalizeSpace(t);
      markUrl(acc, u, 1, looksOffloaded(t) ? 1 : 0);
      for (const x of byUrl.get(u) ?? []) if (!has(acc.q, x.id) && norm.includes(x.ex)) acc.q[key(x.id)] = 1;
    }
  }
  return acc;
}

export function finishCitations(acc: CitationAcc, sources: CitationSourceInput[]): CitationResult {
  const out: CitationResult['sources'] = [];
  for (const s of sources) {
    const target = normalizeUrl(s.url);
    const u = get(acc.urls, target);
    const fetched: 0 | 1 = u !== undefined ? 1 : 0;
    let quote: 0 | 1 = 0;
    let detail: CheckDetail;
    const excerpt = normalizeSpace(s.quoted_excerpt ?? '');
    if (!fetched) {
      detail = 'not_fetched';
    } else if (!excerpt) {
      detail = 'no_excerpt';
    } else if (get(acc.q, s.id) === 1) {
      quote = 1;
      detail = 'ok';
    } else if (!u || u.t === 0 || u.o === 1) {
      detail = 'result_unavailable';
    } else {
      detail = 'quote_not_found';
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
