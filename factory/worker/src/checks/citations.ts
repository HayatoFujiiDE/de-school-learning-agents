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

export function resultText(ev: AnyEvent): string | null {
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
  v: 3;
  fetches: Record<string, string>;
  /** t=本文あり / o=offload らしい / e=エラーの結果を見た / s=エラーでない結果を見た（§R-48） */
  urls: Record<string, { t: 0 | 1; o: 0 | 1; e?: 0 | 1; s?: 0 | 1 }>;
  q: Record<string, 1>;
  nf: Record<string, 1>;
}

const KEY_PREFIX = 'k:';
const key = (raw: string): string => KEY_PREFIX + raw;
const has = (rec: Record<string, unknown>, raw: string): boolean => Object.hasOwn(rec, key(raw));
const get = <V>(rec: Record<string, V>, raw: string): V | undefined => (has(rec, raw) ? rec[key(raw)] : undefined);

export const newCitationAcc = (): CitationAcc => ({ v: 3, fetches: {}, urls: {}, q: {}, nf: {} });

const isPlainRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

/** 保存済みの値が今の形か（旧形式 {fetches, results} / {…, pend} は false → 呼び出し側が先頭から集計し直す） */
export function isCitationAcc(x: unknown): x is CitationAcc {
  if (!isPlainRecord(x) || x.v !== 3) return false; // v2 は「試みた fetch」も fetched に数えていた（§R-48）ので先頭から集計し直す
  return (['fetches', 'urls', 'q', 'nf'] as const).every((k) => Object.hasOwn(x, k) && isPlainRecord(x[k]));
}

function markUrl(acc: CitationAcc, url: string, t: 0 | 1, o: 0 | 1, e: 0 | 1 = 0, s: 0 | 1 = 0): void {
  const prev = get(acc.urls, url);
  const or = (a: unknown, b: 0 | 1): 0 | 1 => (a === 1 || b === 1 ? 1 : 0);
  acc.urls[key(url)] = { t: or(prev?.t, t), o: or(prev?.o, o), e: or(prev?.e, e), s: or(prev?.s, s) };
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
        markUrl(acc, u, 0, 0); // 試みた URL として残す。開けたか（s）は result で決まる。result が来ないまま終われば §F-1 の result_unavailable
      } else {
        acc.nf[key(ev.id)] = 1;
      }
    } else if (ev.type === 'agent.tool_result' && typeof ev.tool_use_id === 'string') {
      const id = ev.tool_use_id;
      if (has(acc.nf, id)) continue;
      const u = get(acc.fetches, id);
      if (u === undefined) continue; // 対応する web_fetch の use が未到着（古い順の契約では来ない）/ 処理済み → 無視
      delete acc.fetches[key(id)];
      // エラーの結果（url_not_accessible 等）は「開いた」に数えない（§R-48）。開けた時だけ url_was_fetched の根拠にする
      if ((ev as { is_error?: unknown }).is_error === true) {
        markUrl(acc, u, 0, 0, 1);
        continue;
      }
      markUrl(acc, u, 0, 0, 0, 1);
      const t = resultText(ev);
      if (t === null) continue; // 本文の無い結果（PDF の base64 等）は開けたが照合できない → result_unavailable
      const norm = normalizeSpace(t);
      markUrl(acc, u, 1, looksOffloaded(t) ? 1 : 0, 0, 1);
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
    // 開いた = エラーでない結果を見た、または結果がまだ来ていない fetch がある（§F-1 の result_unavailable）。
    // 試みた fetch が全部エラー（url_not_accessible 等）なら開いていない（§R-48）
    const pending = Object.values(acc.fetches).includes(target);
    const fetched: 0 | 1 = u !== undefined && (u.s === 1 || pending || u.e !== 1) ? 1 : 0;
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
