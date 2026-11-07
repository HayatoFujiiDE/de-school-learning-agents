// §Q PR-Q1（Gemini 無し）: material.json の parts[].videos[] の検査（Q-1）・「利用条件」を自動 OK にしない（Q-9.6）・
// 確認画面の埋め込み（Q-5 の表示）・CSP の frame-src は /admin だけ（Q-5・Q-9.8）・allowlist と rubric（Q-2）。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { validateOutputs } from '../src/checks/schema';
import { triageVersion, type TriageInput } from '../src/checks/triage';
import type { Env } from '../src/env';
import { ALLOWLIST, RUBRIC_COMMON } from '../src/generated/claude-assets';
import worker from '../src/index';
import { serveVersionFile } from '../src/routes/library';
import { goodFiles, goodMaterial } from './helpers';

const YT = 'dQw4w9WgXcQ';
const YT2 = 'abcdefghij_';
const watch = (id: string) => `https://www.youtube.com/watch?v=${id}`;

type Obj = Record<string, unknown>;
const video = (o: Obj = {}): Obj => ({
  id: 'v1',
  youtube_id: YT,
  title: 'レッドストーンの基本',
  channel: '公式チャンネル',
  start_sec: 80,
  end_sec: 185,
  why: '粉の上を信号が進む様子が見える',
  rights_note: 'チャンネルの概要欄に本人の制作とある',
  source_id: 's9',
  ...o,
});

/** videos を part ごとに付けた一式。sources.json に YouTube の行を足す（extraSources で上書き） */
function filesWith(videosByPart: Array<unknown[] | undefined>, extraSources?: Obj[]) {
  const m = goodMaterial();
  const parts = m.parts as Obj[];
  const base = parts[0];
  m.parts = videosByPart.map((vs, i) => {
    const id = `p${i + 1}`;
    const p: Obj = {
      ...base,
      id,
      variants: (base.variants as Obj[]).map((v) => ({ ...v, path: String(v.path).replace('parts/p1/', `parts/${id}/`) })),
      files: (base.files as Obj[]).map((f) => ({ ...f, path: String(f.path).replace('parts/p1/', `parts/${id}/`) })),
    };
    if (vs !== undefined) p.videos = vs;
    return p;
  });
  const files = goodFiles(m);
  const enc = new TextEncoder();
  for (let i = 2; i <= videosByPart.length; i++) {
    for (const a of ['elementary', 'secondary']) for (const l of ['short', 'long']) files.set(`parts/p${i}/${a}-${l}.md`, enc.encode('見てみよう [c1]'));
    files.set(`parts/p${i}/game.md`, enc.encode('クイズ'));
    files.set(`parts/p${i}/figure-1.svg`, enc.encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'));
  }
  const srcs = JSON.parse(new TextDecoder().decode(files.get('sources.json')!)) as { sources: Obj[] };
  const yt = (id: string, sid: string): Obj => ({
    id: sid,
    url: watch(id),
    title: 'video',
    accessed_at: '2026-11-05',
    quoted_excerpt: 'channel description excerpt',
    license: 'YouTube 標準ライセンス（埋め込みで参照・複製しない）',
    is_primary: false,
  });
  srcs.sources.push(...(extraSources ?? [yt(YT, 's9'), yt(YT2, 's10')]));
  files.set('sources.json', enc.encode(JSON.stringify(srcs)));
  return files;
}
const detailOf = (files: Map<string, Uint8Array>) => {
  const r = validateOutputs(files);
  return r.ok ? 'ok' : r.detail;
};

describe('§Q-1 schema: parts[].videos[]', () => {
  it('正しい videos は通り、material の part に検査済みの videos が付く（他の part は videos キーを持たない）', () => {
    const r = validateOutputs(filesWith([[video(), video({ id: 'v2', youtube_id: YT2, source_id: 's10', start_sec: 0, end_sec: 600 })], undefined]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.material.parts[0].videos).toEqual([video(), video({ id: 'v2', youtube_id: YT2, source_id: 's10', start_sec: 0, end_sec: 600 })]);
    expect('videos' in r.material.parts[1]).toBe(false);
    // 動画は公開 manifest に入らない（ファイルではない）
    expect(r.publicPaths.some((p) => p.includes('youtube'))).toBe(false);
  });

  it('videos が無い素材は従来どおり通り、part に videos キーは付かない', () => {
    const r = validateOutputs(goodFiles());
    expect(r.ok).toBe(true);
    if (r.ok) expect('videos' in r.material.parts[0]).toBe(false);
    expect(detailOf(filesWith([[]]))).toBe('ok');
  });

  it('videos が配列でなければ bad_type', () => {
    expect(detailOf(filesWith([{} as unknown as unknown[]]))).toBe('bad_type:parts[0].videos');
  });

  it.each<[string, Obj, string]>([
    ['id の形（v + 1〜2 桁）', { id: 'video1' }, 'id'],
    ['id が 3 桁', { id: 'v100' }, 'id'],
    ['id が無い', { id: undefined }, 'id'],
    ['youtube_id が 10 文字', { youtube_id: 'dQw4w9WgXc' }, 'youtube_id'],
    ['youtube_id に使えない文字', { youtube_id: 'dQw4w9WgX<Q' }, 'youtube_id'],
    ['title が空', { title: '' }, 'text'],
    ['channel が 201 字', { channel: 'あ'.repeat(201) }, 'text'],
    ['why が 301 字', { why: 'あ'.repeat(301) }, 'text'],
    ['rights_note が無い', { rights_note: undefined }, 'text'],
    ['start = end', { start_sec: 80, end_sec: 80 }, 'range'],
    ['start > end', { start_sec: 90, end_sec: 80 }, 'range'],
    ['601 秒', { start_sec: 0, end_sec: 601 }, 'range'],
    ['負の start', { start_sec: -1, end_sec: 10 }, 'range'],
    ['整数でない', { start_sec: 1.5, end_sec: 10 }, 'range'],
    ['文字列の秒', { start_sec: '1', end_sec: 10 }, 'range'],
    ['出典 id が sources.json に無い', { source_id: 's404' }, 'source'],
    ['出典の url が別の動画', { source_id: 's10' }, 'source'],
    ['出典の url が minecraft.wiki', { source_id: 's1' }, 'source'],
  ])('%s → bad_video:p1:0:%s', (_n, o, reason) => {
    expect(detailOf(filesWith([[video(o)]]))).toBe(`bad_video:p1:0:${reason}`);
  });

  it('要素がオブジェクトでなければ id', () => {
    expect(detailOf(filesWith([['v1']]))).toBe('bad_video:p1:0:id');
  });

  it.each([
    ['https://www.youtube.com/watch?v=' + YT + '&t=80s', 'クエリに v 以外'],
    ['https://youtu.be/' + YT, 'youtu.be'],
    ['https://youtube.com/watch?v=' + YT, 'www なし'],
    ['http://www.youtube.com/watch?v=' + YT, 'http'],
    ['https://www.youtube.com/embed/' + YT, 'embed の形'],
  ])('出典の url が完全一致でない（%s・%s）→ source', (url) => {
    const s = { id: 's9', url, title: 't', accessed_at: '2026-11-05', quoted_excerpt: 'channel description excerpt', license: 'YouTube 標準ライセンス', is_primary: false };
    expect(detailOf(filesWith([[video()]], [s]))).toBe('bad_video:p1:0:source');
  });

  it('同じ id が 2 回（part をまたいでも）→ dup', () => {
    expect(detailOf(filesWith([[video(), video({ youtube_id: YT2, source_id: 's10' })]]))).toBe('bad_video:p1:1:dup');
    expect(detailOf(filesWith([[video()], [video({ youtube_id: YT2, source_id: 's10' })]]))).toBe('bad_video:p2:0:dup');
  });

  it('同じ youtube_id と同じ区間が 2 回 → dup。区間が違えば通る', () => {
    expect(detailOf(filesWith([[video(), video({ id: 'v2' })]]))).toBe('bad_video:p1:1:dup');
    expect(detailOf(filesWith([[video(), video({ id: 'v2', start_sec: 200, end_sec: 300 })]]))).toBe('ok');
  });

  it('素材全体で 4 本以上 → 4 本目で too_many。3 本は通る', () => {
    const v = (n: number) => video({ id: `v${n}`, start_sec: n * 10, end_sec: n * 10 + 5 });
    expect(detailOf(filesWith([[v(1), v(2), v(3)]]))).toBe('ok');
    expect(detailOf(filesWith([[v(1), v(2)], [v(3), v(4)]]))).toBe('bad_video:p2:1:too_many');
    expect(detailOf(filesWith([[v(1), v(2), v(3), v(4)]]))).toBe('bad_video:p1:3:too_many');
  });
});

// 契約 V-6（§Q-9.6 の「動画のある版は人が見る」に優先）: 動画のある版の「利用条件」は、公式の情報が取れて確認済みのチャンネルの時だけ自動 OK
describe('契約 V-6 triage: 動画のある版の「利用条件」', () => {
  const input = (material: unknown, o: Partial<TriageInput> = {}): TriageInput => ({
    claims: { claims: [{ id: 'c1', source_ids: ['s1'] }] },
    report: { id: 'w1', result: { verdicts: [{ claim_id: 'c1', verdict: 'confirmed', opened_urls: [] }], overall_note: '' } },
    sources: [{ source_id: 's1', url: 'https://minecraft.wiki/w/x', license: 'CC BY-NC-SA 3.0', url_was_fetched: 1, quote_found: 1 }],
    checks: { forbidden: [], app_html: [], kakunin_zumi: [], missing_source_refs: [], missing_claim_refs: [] },
    material,
    autoReverified: 0,
    ...o,
  });
  const legacy3 = (a: Record<string, string>) => ({ content_and_evidence: a.content_and_evidence, terms_of_use: a.terms_of_use, artifact_behavior: a.artifact_behavior });
  const withVideos = (vs: unknown) => {
    const m = goodMaterial();
    (m.parts as Obj[])[0].videos = vs;
    return m;
  };

  it('videos のない版は機械の 3 項目が ok', () => {
    expect(legacy3(triageVersion(input(goodMaterial())).auto)).toEqual({ content_and_evidence: 'ok', terms_of_use: 'ok', artifact_behavior: 'ok' });
    expect(triageVersion(input(withVideos([]))).auto.terms_of_use).toBe('ok');
  });

  it('videos が 1 本あり公式の情報が取れていなければ terms_of_use は review（video_meta_unknown の ask。他の 2 項目は変わらない）', () => {
    const t = triageVersion(input(withVideos([video()])));
    expect(legacy3(t.auto)).toEqual({ content_and_evidence: 'ok', terms_of_use: 'review', artifact_behavior: 'ok' });
    expect(t.items.filter((i) => i.key === 'terms_of_use').map((i) => [i.cause, i.severity])).toEqual([['video_meta_unknown', 'ask']]);
    expect(t.action).toBe('none');
  });

  it('公式の情報が取れて、チャンネルが確認済みなら terms_of_use は ok（trusted_keys にその key）', () => {
    const meta = [{ video_id: 'v1', outcome: 'ok', author_name: 'X', author_url: 'https://www.youtube.com/@x', channel_match: 'match' }];
    const t = triageVersion(input(withVideos([video()]), { videoMeta: meta, trustedChannels: ['https://www.youtube.com/@x'] }));
    expect(t.auto.terms_of_use).toBe('ok');
    expect(t.trusted_keys).toEqual(['https://www.youtube.com/@x']);
  });
});

describe('§Q-5 確認画面: 「説明と表現」の動画', () => {
  interface ReviewUi {
    reviewHtml(d: unknown, st: unknown, ctx: unknown): string;
    newReviewState(): unknown;
  }
  const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
  const win: Record<string, unknown> = { __FACTORY_ADMIN_NO_BOOT__: true };
  vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
  const R = win.FactoryAdminReview as ReviewUi;
  const n = (html: string, re: RegExp) => (html.match(re) || []).length;
  const d = (videos: unknown[] | undefined, o: Obj = {}) => {
    const m = goodMaterial();
    if (videos !== undefined) (m.parts as Obj[])[0].videos = videos;
    return {
      version: { id: 'v1', material_id: 'm1', version: 1, status: 'review', verification_status: 'done', material: m, checks: {}, public_paths: [] },
      material: { id: 'm1', title: 't' },
      job: null,
      sources: [{ source_id: 's1', license: 'CC BY-NC-SA 3.0' }],
      claims: [],
      verification: null,
      verification_id: null,
      verification_history: [],
      triage: { auto: { content_and_evidence: 'ok', terms_of_use: 'review', artifact_behavior: 'ok' }, groups: [], ok_counts: { claims: 0, sources: 1 }, needs_review: 1, action: 'none', reasons: [] },
      ...o,
    };
  };
  const NOTE = '区間の指定と rel=0 は、区間の外への移動や関連動画を止めません。youtube-nocookie も、広告・追跡が無いことを保証しません。';
  const CHECK = '動画: 本人のアップか・区間が再生できて内容が合うかを見てください';

  it('iframe の src・属性が §Q-5 の形（youtube-nocookie・start/end・rel=0。& は HTML のエスケープ）', () => {
    const h = R.reviewHtml(d([video()]), R.newReviewState(), {});
    expect(n(h, /<iframe /g)).toBe(1);
    expect(h).toContain(
      `<iframe src="https://www.youtube-nocookie.com/embed/${YT}?start=80&amp;end=185&amp;rel=0" title="レッドストーンの基本" allow="encrypted-media; picture-in-picture; fullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`,
    );
    expect(h).not.toContain('youtube.com/embed');
  });

  it('「動画 N 本」・区間（分:秒）・チャンネル・見どころ・理由・注記・Gemini の欄（記録はまだありません）', () => {
    const h = R.reviewHtml(d([video(), video({ id: 'v2', youtube_id: YT2, start_sec: 5, end_sec: 600 })]), R.newReviewState(), {});
    expect(n(h, /data-videos="2"/g)).toBe(1);
    expect(h).toContain('動画 2 本');
    // §V-9 a: 区間・見どころは「説明と表現」の補足の動画のブロック、チャンネル・本人のアップと言える理由は「利用条件」の補足
    expect(h).toContain('<p>区間 1:20〜3:05</p>');
    expect(h).toContain('<p>区間 0:05〜10:00</p>');
    expect(h).toContain('<p><b>動画 v1</b> チャンネル 公式チャンネル');
    expect(h).toContain('見どころ: 粉の上を信号が進む様子が見える');
    expect(h).toContain('本人のアップと言える理由: チャンネルの概要欄に本人の制作とある');
    expect(h).toContain(NOTE);
    expect(h).toContain(CHECK);
    expect(n(h, /data-video-notes="1"/g)).toBe(2);
    expect(n(h, /data-video-verdict="1"/g)).toBe(2);
    expect(n(h, /動画の記録はまだありません/g)).toBe(4);
    // 図の行に動画の本数
    expect(h).toContain('図・画像 1 枚・動画 2 本（');
    // 「機械が確かめたこと」の「説明と表現」の補足の中（次の項目より前）
    const item = h.indexOf('data-mk="explanation_and_expression"');
    const at = h.indexOf('data-videos=');
    expect(item).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(item);
    expect(h.indexOf('data-mk="', item + 1)).toBeGreaterThan(at);
  });

  it('値はすべてエスケープする', () => {
    const x = '<script>x</script>"\'';
    const h = R.reviewHtml(d([video({ id: '"><b>', title: x, channel: x, why: x, rights_note: x })]), R.newReviewState(), {});
    expect(h).not.toContain('<script>x</script>');
    expect(h).toContain('data-video="&quot;&gt;&lt;b&gt;"');
    expect(h).toContain('title="&lt;script&gt;x&lt;/script&gt;&quot;&#39;"');
    expect(n(h, /&lt;script&gt;x&lt;\/script&gt;/g)).toBe(5); // 見出し・iframe の title・チャンネル・見どころ・理由
  });

  it.each<[string, Obj]>([
    ['youtube_id の形が違う（表示の前にもう一度確かめる）', { youtube_id: 'x" onload="alert(1)' }],
    ['youtube_id が 12 文字', { youtube_id: YT + 'a' }],
    ['区間が逆', { start_sec: 100, end_sec: 50 }],
    ['区間が文字列', { start_sec: '1', end_sec: 50 }],
  ])('%s → iframe を出さない', (_n, o) => {
    const h = R.reviewHtml(d([video(o)]), R.newReviewState(), {});
    expect(n(h, /<iframe /g)).toBe(0);
    expect(n(h, /data-video-bad="1"/g)).toBe(1);
    expect(h).not.toContain('onload="alert');
  });

  it('動画の無い版は今までどおり（動画の欄・注記・本数を出さない）', () => {
    const h = R.reviewHtml(d(undefined), R.newReviewState(), {});
    expect(h).not.toContain('data-videos=');
    expect(h).not.toContain('動画 ');
    expect(h).not.toContain(NOTE);
    expect(h).toContain('図・画像 1 枚（');
    // §V-9: 利用条件の補足の文は、利用条件が分からない出典がある時だけ（この版の出典は CC BY-NC-SA 3.0）
    expect(h).not.toContain('利用条件が分からない出典があります');
    expect(R.reviewHtml(d(undefined, { sources: [{ source_id: 's1', license: 'unknown' }] }), R.newReviewState(), {})).toContain('利用条件が分からない出典があります（1 件）');
  });

  it('「利用条件」の項目の文は動画の文（§Q-9.6）。出典の利用条件が分かる時は従来の文を出さない', () => {
    const h = R.reviewHtml(d([video()]), R.newReviewState(), {});
    const item = h.indexOf('data-mk="terms_of_use"');
    expect(item).toBeGreaterThanOrEqual(0);
    expect(h.indexOf('data-video-terms="1"')).toBeGreaterThan(item);
    expect(h).not.toContain('利用条件が分からない出典があります');
    const unk = R.reviewHtml(d([video()], { sources: [{ source_id: 's1', license: 'unknown' }] }), R.newReviewState(), {});
    expect(unk).toContain('利用条件が分からない出典があります');
    expect(n(unk, /data-video-terms="1"/g)).toBe(1);
  });
});

describe('§Q-5・§Q-9.8 CSP: frame-src の youtube-nocookie は /admin だけ', () => {
  // §AJ-4: 立体モデルの公式の埋め込みの 2 つのホストを frame-src に足した（それ以外は §Q-5 のまま）
  // §AJ2-3: model-viewer + Draco のため script-src 'wasm-unsafe-eval'・style-src の hash・connect-src blob:・worker-src blob: を足した（frame-src・img-src は変えない）
  const ADMIN_CSP_EXPECTED =
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'sha256-PXtZZkJMMyc18o/DN1ZEFOJ2qEGq95IQbVaJFMOXOb0='; img-src 'self' data:; connect-src 'self' blob:; worker-src blob:; frame-src 'self' https://www.youtube-nocookie.com https://sketchfab.com https://3d-api.si.edu; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

  it('/admin の HTML の CSP は frame-src に https://www.youtube-nocookie.com を足しただけ', async () => {
    const env = {
      ACCESS_DEV_BYPASS_EMAIL: 'ops@example.invalid',
      ASSETS: { fetch: async () => new Response('<!doctype html><title>x</title>', { status: 200, headers: { 'content-type': 'text/html' } }) },
    } as unknown as Env;
    const res = await worker.fetch(new Request('http://localhost/admin/'), env, {} as ExecutionContext);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(ADMIN_CSP_EXPECTED);
  });

  it('生成物の配信（library と確認画面の共通関数）の CSP は変えない（youtube を含まない）', async () => {
    const r2 = new Map<string, Uint8Array>();
    const prefix = 'materials/m1/j1/';
    const paths = ['parts/p1/app.html', 'parts/p1/figure-1.svg', 'parts/p1/a.png', 'parts/p1/b.webp'];
    for (const p of paths) r2.set(prefix + p, new Uint8Array([1]));
    const env = { R2: { get: async (k: string) => (r2.has(k) ? { body: r2.get(k) } : null) } } as unknown as Env;
    const row = { r2_prefix: prefix, public_paths_json: JSON.stringify(paths) };
    const expected: Record<string, string> = {
      'parts/p1/app.html': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:",
      'parts/p1/figure-1.svg': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      'parts/p1/a.png': "default-src 'none'; sandbox",
      'parts/p1/b.webp': "default-src 'none'; sandbox",
    };
    for (const p of paths) {
      const res = await serveVersionFile(env, row, p);
      expect(res.status, p).toBe(200);
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp, p).toBe(expected[p]);
      expect(csp, p).not.toContain('youtube');
    }
  });
});

describe('§Q-2 allowlist と rubric（生成ファイルに反映済み）', () => {
  it('domains に youtube.com。hosts（作業場）は youtube.com と *.youtube.com だけ（Q-9.10 改め）。youtu.be は入れない', () => {
    expect(ALLOWLIST.domains).toContain('youtube.com');
    // §Q-9.10 改め（2026-11-05）: API は web ツールの allowed_domains が limited 環境の allowed_hosts の中にあることを求める（無いと sessions.create が 400）。
    // YouTube は youtube.com と *.youtube.com だけを作業場に入れる。動画の本体（googlevideo.com）と画像（ytimg.com）は入れない。
    expect(ALLOWLIST.hosts).toContain('youtube.com');
    expect(ALLOWLIST.hosts).toContain('*.youtube.com');
    expect(ALLOWLIST.hosts.some((h) => /googlevideo|ytimg|youtu\.be/.test(h))).toBe(false);
    expect([...ALLOWLIST.domains, ...ALLOWLIST.hosts].some((h) => h.includes('youtu.be'))).toBe(false);
    const src = JSON.parse(readFileSync(new URL('../../claude/allowlist.json', import.meta.url), 'utf8')) as { domains: string[]; primary_hosts: string[]; hosts: string[] };
    expect(ALLOWLIST).toEqual({ domains: src.domains, primary_hosts: src.primary_hosts, hosts: src.hosts });
  });

  it('rubric common.md の 13 が videos の形式（why・rights_note・出典の行）を見る', () => {
    expect(RUBRIC_COMMON).toMatch(/\n13\. [^\n]*videos[^\n]*why[^\n]*rights_note[^\n]*https:\/\/www\.youtube\.com\/watch\?v=\{youtube_id\}/);
    expect(RUBRIC_COMMON).toBe(readFileSync(new URL('../../claude/rubrics/common.md', import.meta.url), 'utf8'));
  });
});
