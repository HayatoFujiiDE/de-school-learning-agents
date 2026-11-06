// お題の fake（contract-T T-14 c の smoke と手元の確認だけ）。src/fake/anthropic.ts 経由でだけ読み込まれる（src/anthropic.ts の fakeAllowed() ガード内）。
// 決定論: 生成の本文は「それまでに受けたお題の生成の回数 n」と種類で決まり、検査の答えは本文の中身で決まる。外へは出ない。
//   - news: 2 本（1 本目は普通、2 本目は「地震」を含む = 検査が heavy と答える）
//   - talk: 2 本（1 本目は普通、2 本目は出典の URL が /missing/ = 開くと引用が無い → source_not_found）
//   - philo / make: 1 本
//   - 見直し（system 文に「見直し:」）: 「元のお題」の本文をそのまま返す（題が親と同じ）
//   - 発展（system 文に「発展:」）: philo を 1 本
// 出典のページは PAGES の本文を返す（引用を含む）。/missing/ は引用の無いページ、/gone/ は 404。

import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages';
import { TOPIC_FEEDS } from '../generated/topic-sources';

export const FAKE_SOURCE_HOST = 'fake-source.example.org';

/** 出典のページ（path → 本文）。生成の fake の quote はここから取る */
const PAGES: Record<string, { title: string; text: string }> = {
  '/p/mmx': { title: 'MMX', text: '火星衛星探査計画（MMX）は、火星の衛星フォボスに着陸して砂を採取し、地球に持ち帰ることを目指す探査計画です。打ち上げは2026年度に予定されています。' },
  '/p/quake': { title: '地震の備え', text: '大きな地震が起きたときに備えて、家具を固定し、水や食料を3日分以上用意しておくことが勧められています。避難場所を家族で確認しておきましょう。' },
  '/p/ai-school': { title: '学校とAI', text: '学校で生成AIを使うときは、出てきた答えをそのまま使わずに、自分で確かめることが大切だとガイドラインに書かれています。' },
  '/p/ship': { title: 'テセウスの船', text: 'テセウスの船とは、部品をすべて取り替えた船が元の船と同じと言えるかを問う、古くからある思考実験のことです。' },
  '/p/stopmotion': { title: 'コマ撮り', text: 'コマ撮りアニメは、物を少しずつ動かしながら一枚ずつ写真を撮り、続けて再生することで動いているように見せる方法です。' },
};
const MISSING_PAGE = '<html><body><p>このページは移転しました。新しいページをご覧ください。</p></body></html>';

const src = (id: string, path: string, name: string) => ({ id, url: `https://${FAKE_SOURCE_HOST}${path}`, name, quote: PAGES[path]?.text.slice(0, 60) ?? 'このページの本文から写した二十字以上の引用の文です。' });
const loc = (s: string, e: string) => ({ s, e });
const asks3 = (s: string, e: string) => [
  { level: 'check', text: loc(`${s}は何ですか`, `${e}はなに？`) },
  { level: 'self', text: loc(`自分なら${s}をどう使いますか`, `じぶんなら${e}をどうする？`) },
  { level: 'open', text: loc(`${s}はこれからどうなると思いますか`, `${e}はこれからどうなるかな？`) },
];
const next = { talk: loc('友だちと話してみよう', 'ともだちとはなそう'), make_title: loc('図にまとめる', 'えにかく'), make_steps: [loc('調べる', 'しらべる'), loc('書く', 'かく'), loc('見せる', 'みせる')] };

const NEWS_TITLES = ['火星の月の砂を持ち帰る探査機', '海の水温が上がるとどうなる', '新しい図書館が駅にできる', '星の観察会が全国で開かれる', '古い橋を直す工事が始まる'];
const NEWS_HEAVY_TITLES = ['大きな地震への備えを見直す日', '台風のあとの町の片付け', '災害の時に助け合うしくみ'];
const TALK_TITLES = ['学校でAIを使うときのきまり', '班の係をどう決めるか', '給食の残りをどうするか'];
const TALK_MISSING_TITLES = ['休み時間のボールはだれのもの', '教室の本棚の使い方', '掃除当番の順番'];
const PHILO_TITLES = ['全部の部品を取り替えた船は同じ船か', '友だちとは何だろう', '時間はどこから来るのか', 'うそをついてよい時はあるか'];
const MAKE_TITLES = ['消しゴムでコマ撮りアニメを作る', 'ダンボールで迷路を作る', '4コマ漫画でできごとを描く'];

/** 生成の本文（kind と通し番号で決まる） */
export function fakeTopicBody(kind: string, n: number, slotDay: string, variant: 'normal' | 'heavy' | 'missing' = 'normal'): Record<string, unknown> {
  const base = { schema_version: 1, kind, locale: 'ja-JP', premises: [], views: [], stances: [], tags: { interests: ['basics'], concept_codes: [] } };
  if (kind === 'news') {
    const heavy = variant === 'heavy';
    const title = heavy ? NEWS_HEAVY_TITLES[n % NEWS_HEAVY_TITLES.length] : NEWS_TITLES[n % NEWS_TITLES.length];
    const s1 = heavy ? src('s1', '/p/quake', '防災の手引き') : src('s1', '/p/mmx', 'JAXA');
    return {
      ...base,
      title: loc(title, title),
      lead: loc(heavy ? '地震に備えて家でできることを考えます' : '探査機が遠い星の砂を持ち帰る計画を知ります', heavy ? 'じしんにそなえてできることをかんがえよう' : 'たんさきがほしのすなをもちかえるよ'),
      event_day: slotDay,
      facts: [
        { id: 'f1', text: loc(heavy ? '家具の固定が勧められている' : '探査機はフォボスの砂を採る', heavy ? 'かぐをとめるとよい' : 'フォボスのすなをとる'), source_ids: ['s1'] },
        { id: 'f2', text: loc(heavy ? '水や食料を3日分用意する' : '砂を地球に持ち帰る', heavy ? 'みずとたべものを3日ぶん' : 'すなをちきゅうにもってくる'), source_ids: ['s1'] },
      ],
      asks: asks3(heavy ? '地震の備え' : '探査計画', heavy ? 'じしんのそなえ' : 'たんさ'),
      stances: [
        { id: 'a', label: loc('賛成', 'さんせい') },
        { id: 'b', label: loc('迷う', 'まよう') },
      ],
      next,
      make: null,
      sources: [s1],
    };
  }
  if (kind === 'talk') {
    const missing = variant === 'missing';
    const title = missing ? TALK_MISSING_TITLES[n % TALK_MISSING_TITLES.length] : TALK_TITLES[n % TALK_TITLES.length];
    const s1 = missing ? src('s1', '/missing/rule', '学校のきまり') : src('s1', '/p/ai-school', '文部科学省');
    return {
      ...base,
      title: loc(title, title),
      lead: loc('みんなで決めるきまりについて話し合います', 'みんなできまりをきめよう'),
      event_day: null,
      premises: [{ text: loc('ある日の教室での場面です', 'あるひのきょうしつ') }],
      facts: [{ id: 'f1', text: loc('答えを自分で確かめることが大切とされる', 'こたえはじぶんでたしかめる'), source_ids: ['s1'] }],
      views: [
        { id: 'v1', who: { name: '使ってよいという考え', type: 'position' }, side: 'a', stance: loc('道具として使ってよい', 'つかってよい'), source_ids: [] },
        { id: 'v2', who: { name: '使わないという考え', type: 'position' }, side: 'b', stance: loc('自分の力で考えたい', 'じぶんでかんがえたい'), source_ids: [] },
      ],
      asks: asks3('このきまり', 'このきまり'),
      stances: [
        { id: 'a', label: loc('使う', 'つかう') },
        { id: 'b', label: loc('使わない', 'つかわない') },
      ],
      next,
      make: null,
      sources: [s1],
    };
  }
  if (kind === 'philo') {
    const title = PHILO_TITLES[n % PHILO_TITLES.length];
    return {
      ...base,
      title: loc(title, title),
      lead: loc('同じとは何かを考えます', 'おなじってなんだろう'),
      event_day: null,
      facts: [{ id: 'f1', text: loc('昔から考えられてきた問いである', 'むかしからあるといだよ'), source_ids: ['s1'] }],
      views: [
        { id: 'v1', who: { name: 'テセウスの船の説明', type: 'org' }, side: 'a', stance: loc('同じと言えるか問われている', 'おなじかといわれている'), source_ids: ['s1'] },
        { id: 'v2', who: { name: '別の船だという考え', type: 'position' }, side: 'b', stance: loc('部品が違えば別の船', 'ぶひんがちがえばべつ'), source_ids: [] },
      ],
      asks: asks3('同じであること', 'おなじこと'),
      stances: [
        { id: 'a', label: loc('同じ', 'おなじ') },
        { id: 'b', label: loc('違う', 'ちがう') },
      ],
      next,
      make: null,
      sources: [src('s1', '/p/ship', '百科事典')],
    };
  }
  const title = MAKE_TITLES[n % MAKE_TITLES.length];
  return {
    ...base,
    kind: 'make',
    title: loc(title, title),
    lead: loc('身近な物で動く映像を作ります', 'みぢかなものでうごくえをつくろう'),
    event_day: null,
    facts: [],
    asks: [],
    next: null,
    make: {
      category: 'basics',
      line: loc('物を少しずつ動かして撮る', 'すこしずつうごかしてとる'),
      first_step: loc('動かす物を1つ選ぶ', 'うごかすものをえらぶ'),
      need: loc('タブレットと消しゴム', 'タブレットとけしゴム'),
      minutes: 45,
      steps: [loc('置く', 'おく'), loc('撮る', 'とる'), loc('つなぐ', 'つなぐ')],
      safety: false,
      thumb_prompt: '机の上に並んだ消しゴムと小さな紙の背景の写真',
    },
    // make は facts・views を持たないので、出典を置くと「どこからも指されていない出典」で不合格になる（T-1）。出典は 0 本
    sources: [],
  };
}

const textOf = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? (content as Array<{ type?: string; text?: string }>).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n') : '';

const slotFromHeadlines = (): string => new Date(Date.now() + 9 * 3600_000 + 86_400_000).toISOString().slice(0, 10);

/** お題の生成の応答か（save_topics を持つ） */
export const isTopicGenParams = (p: MessageCreateParamsNonStreaming): boolean => (p.tools ?? []).some((t) => (t as { name?: string }).name === 'save_topics');
/** お題の検査の応答か（save_check を持つ） */
export const isTopicCheckParams = (p: MessageCreateParamsNonStreaming): boolean => (p.tools ?? []).some((t) => (t as { name?: string }).name === 'save_check');

/** 生成の fake の応答（n = それまでに受けたお題の生成の回数） */
export function fakeTopicGenReply(params: MessageCreateParamsNonStreaming, n: number): Message {
  const system = typeof params.system === 'string' ? params.system : '';
  const user = textOf(params.messages[0]?.content);
  const slotDay = slotFromHeadlines();
  let bodies: Array<Record<string, unknown>>;
  if (system.includes('見直し:')) {
    const m = /【元のお題】\n([^\n]+)/.exec(user);
    let parent: Record<string, unknown> | null = null;
    try {
      parent = m ? (JSON.parse(m[1].replace(/〔/g, '【').replace(/〕/g, '】')) as Record<string, unknown>) : null;
    } catch {
      parent = null;
    }
    bodies = parent ? [{ ...parent, lead: { s: '新しい情報で書き直しました', e: 'あたらしくかきなおしたよ' } }] : [];
  } else if (system.includes('発展:')) bodies = [fakeTopicBody('philo', n, slotDay)];
  else if (system.includes('作る種類: ニュースから')) bodies = [fakeTopicBody('news', n, slotDay), fakeTopicBody('news', n, slotDay, 'heavy')];
  else if (system.includes('作る種類: 話し合い')) bodies = [fakeTopicBody('talk', n, slotDay), fakeTopicBody('talk', n, slotDay, 'missing')];
  else if (system.includes('作る種類: 答えのない問い')) bodies = [fakeTopicBody('philo', n, slotDay)];
  else bodies = [fakeTopicBody('make', n, slotDay)];
  // 1 本目の出典は生成の中で web_fetch した結果として返す（T-4 の gen_fetch の照合を通す）
  const first = (bodies[0]?.sources as Array<{ url: string }> | undefined)?.[0];
  const page = first ? PAGES[new URL(first.url).pathname] : undefined;
  const content: unknown[] = [];
  if (first && page) {
    content.push({ type: 'server_tool_use', id: 'srvtoolu_fake_1', name: 'web_fetch', input: { url: first.url }, caller: { type: 'direct' } });
    content.push({
      type: 'web_fetch_tool_result',
      tool_use_id: 'srvtoolu_fake_1',
      caller: { type: 'direct' },
      content: { type: 'web_fetch_result', url: first.url, retrieved_at: new Date().toISOString(), content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: page.text }, title: page.title, citations: null } },
    });
  }
  content.push({ type: 'tool_use', id: 'toolu_fake_topics', name: 'save_topics', input: { topics: bodies }, caller: { type: 'direct' } });
  return {
    id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    container: null,
    content,
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 20000, output_tokens: 3000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: { web_search_requests: 2, web_fetch_requests: 1 } },
  } as unknown as Message;
}

/** 検査の fake の応答: 渡された抜き書きの出典は全部 supported。本文に「地震」があれば heavy、「（気になる）」があれば flags one_sided */
export function fakeTopicCheckReply(params: MessageCreateParamsNonStreaming): Message {
  const blocks = (Array.isArray(params.messages[0]?.content) ? params.messages[0].content : []) as Array<{ type?: string; text?: string }>;
  const ids: string[] = [];
  let topicText = '';
  for (const b of blocks) {
    const t = b.text ?? '';
    const m = /^【出典の抜き書き ([^】]+)】/.exec(t);
    if (m) ids.push(m[1]);
    if (t.startsWith('【お題】')) topicText = t;
  }
  const heavy = topicText.includes('地震');
  return {
    id: `msg_fake_${crypto.randomUUID().slice(0, 8)}`,
    type: 'message',
    role: 'assistant',
    model: params.model,
    container: null,
    content: [
      {
        type: 'tool_use',
        id: 'toolu_fake_check',
        name: 'save_check',
        input: {
          sources: ids.map((source_id) => ({ source_id, support: 'supported' })),
          sensitivity: heavy ? 'heavy' : 'normal',
          heavy_reasons: heavy ? ['disaster'] : [],
          flags: topicText.includes('（気になる）') ? ['one_sided'] : [],
          note: 'fake: 抜き書きと照らした',
        },
        caller: { type: 'direct' },
      },
    ],
    stop_reason: 'tool_use',
    stop_sequence: null,
    usage: { input_tokens: 3000, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Message;
}

function feedXml(now: Date): string {
  const d = (n: number) => new Date(now.getTime() - n * 86_400_000).toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>fake</title>
<item><title>探査機の打ち上げが決まる</title><link>https://${FAKE_SOURCE_HOST}/p/mmx</link><pubDate>${d(0)}</pubDate></item>
<item><title>防災の日の訓練</title><link>https://${FAKE_SOURCE_HOST}/p/quake</link><pubDate>${d(1)}</pubDate></item>
<item><title>古いニュース</title><link>https://${FAKE_SOURCE_HOST}/p/old</link><pubDate>${d(10)}</pubDate></item>
</channel></rss>`;
}

/** お題の RSS と出典の fetch の fake（外へ出ない） */
export const topicFetch: typeof fetch = async (input) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (TOPIC_FEEDS.includes(url)) {
    return TOPIC_FEEDS.indexOf(url) === 0
      ? new Response(feedXml(new Date()), { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } })
      : new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return new Response('bad', { status: 400 });
  }
  if (u.hostname !== FAKE_SOURCE_HOST) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (u.pathname.startsWith('/gone/')) return new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } });
  if (u.pathname.startsWith('/missing/')) return new Response(MISSING_PAGE, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  const p = PAGES[u.pathname];
  if (!p) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  return new Response(`<html><head><title>${p.title}</title><script>var x = 1;</script></head><body><article><p>${p.text}</p></article></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
};
