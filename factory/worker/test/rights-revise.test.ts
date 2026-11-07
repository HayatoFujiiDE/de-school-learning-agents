// §AK v3.1（Astra 実装レビュー B1〜B4 の再現を回帰テストに）。fake・vitest。実物の提供元には繋がない。
// B1 HTML の誤読（属性値の中の <!-- や <script>・script の中の偽 h1 / リンク・単一引用符・data-href・閉じていない構造・DBCLS の CC の URL の混在）
// B2 claim を失った古い実行が取り込みの結果を上書きする / B3 確かめている途中に止めると、その後に取り込む / B4 cron の飢餓
// 申告分: (i) 同じ sha の成功→失敗→成功で last_import_fail が残る / (iv) 止める操作で作った行の初回確認が 1 日待つ / cron の時間の予約
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/env';
import { MODELS3D, type Model3dEntry } from '../src/generated/models3d-catalog';
import { MODELS3D_BY_ID } from '../src/models3d';
import { assetKey, failClass, offerableModels3d, subjectSha256 } from '../src/rights';
import { checkCcUrl, checkNasa, runRightsCheck } from '../src/rights-check';
import { rightsCandidates, rightsCronRows, rightsStep } from '../src/rights-cron';
import { lastRightsEvents, loadRightsGate, setRightsBlocked } from '../src/rights-store';
import { d1, migratedDb, one, rows } from './d1-shim';
import {
  dbclsPageOf,
  deferred,
  glbRes,
  goodRecord,
  htmlRes,
  insertRecord,
  NASA_HUB,
  nasaPageOf,
  nasaRoutesOf,
  statusRes,
  stubBy,
  tinyGlb,
  HUB_HTML,
  type NasaPageParts,
} from './rights-helpers';

const shaHex = (b: ArrayBuffer) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const ROVER = MODELS3D_BY_ID.get('nasa-perseverance-rover')!;
const DBCLS = MODELS3D_BY_ID.get('dbcls-bodyparts3d')!;
const GLB_URL = ROVER.download_url!;
const KEY = assetKey('models3d', ROVER.id);

let db: DatabaseSync;
let store: Map<string, Uint8Array>;
let putHook: ((k: string) => Promise<void>) | null;
let env: Env;

beforeEach(() => {
  db = migratedDb();
  store = new Map();
  putHook = null;
  const R2 = {
    async put(k: string, v: ArrayBuffer | Uint8Array) {
      if (putHook) await putHook(k);
      store.set(k, new Uint8Array(v instanceof ArrayBuffer ? v.slice(0) : v.slice()));
      return { key: k };
    },
    async head(k: string) {
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength } : null;
    },
    async get(k: string) {
      const b = store.get(k);
      return b ? { key: k, size: b.byteLength, body: b.slice() } : null;
    },
  };
  env = { DB: d1(db), R2 } as unknown as Env;
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

const nasa = (o: NasaPageParts = {}, e: Model3dEntry = ROVER) => checkNasa(e, stubBy(nasaRoutesOf(e, o)));
const hostedRows = () => rows(db, 'SELECT sha256, check_token FROM rights_hosted');
const fileRows = () => rows(db, 'SELECT sha256 FROM models3d_files');

// ---------------------------------------------------------------------------------------------

describe('B1 NASA: 属性値の中の区切り文字で第三者の印を読み飛ばさない', () => {
  it.each<[string, string]>([
    ['属性値の中の <!-- と -->', '<span data-x="<!--">© ThirdParty</span><span data-x="-->">x</span>'],
    ['属性値の中の <script> と </script>', '<span data-x="<script>">© ThirdParty</span><span data-x="</script>">x</span>'],
    ['単一引用符の属性値の中の <!--', "<span data-x='<!--'>Courtesy of ThirdParty</span><span data-x='-->'>x</span>"],
    ['script の中の <!-- の後ろの本文', '<script>var s = "<!--";</script><p>© ThirdParty</p>'],
  ])('%s → third_party_marker（Details の区画の可視テキスト）', async (_n, details) => {
    expect(await nasa({ details })).toEqual({ ok: false, fail_code: 'third_party_marker' });
  });

  it.each<[string, string]>([
    ['属性の中の &copy;', '<span title="&copy; ThirdParty">x</span>'],
    ['コメントの中の印', '<!-- Courtesy of ThirdParty -->'],
    ['script の中の印', '<script>var credit = "Used with permission";</script>'],
    ['数値の実体（; なし・先頭の 0）の ©', '<span data-c="&#0000000169 x">y</span>'],
  ])('生 HTML の区画（コメント・属性・script を含め実体を復号）に印があれば落とす: %s', async (_n, details) => {
    expect(await nasa({ details })).toEqual({ ok: false, fail_code: 'third_party_marker' });
  });

  it('実経路: 属性値の中の <!-- で隠した印は、取り込みも一覧への掲載も起きない', async () => {
    const details = '<span data-x="<!--">© ThirdParty</span><span data-x="-->">x</span>';
    const f = stubBy(nasaRoutesOf(ROVER, { details }, { [GLB_URL]: glbRes(tinyGlb()) }));
    const o = await runRightsCheck(env, ROVER, 'cron', f);
    expect(f.calls).not.toContain(GLB_URL);
    expect(store.size).toBe(0);
    expect(hostedRows()).toEqual([]);
    expect(offerableModels3d(await loadRightsGate(env))).toEqual([]);
    expect(o).toMatchObject({ kind: 'failed', fail_code: 'third_party_marker' });
  });
});

describe('B1 NASA: 正の判定は解析結果だけ（h1・リンク）', () => {
  it('script の中の偽 <h1> は数えない（通る）', async () => {
    const r = await nasa({ head: '<script>document.write("<h1>Fake title</h1>");</script>' });
    expect(r).toMatchObject({ ok: true, license_code: 'nasa-media' });
  });

  it('単一引用符・実体参照を含む href の <a> は通る', async () => {
    expect(await nasa({ downloads: `<a href='${GLB_URL}'>GLB</a>` })).toMatchObject({ ok: true });
    expect(await nasa({ downloads: `<a class="b" href="${GLB_URL.replace('.glb', '&#46;glb')}">GLB</a>` })).toMatchObject({ ok: true });
  });

  it.each<[string, string]>([
    ['data-href だけ', `<a data-href="${GLB_URL}">GLB</a>`],
    ['script の中だけのリンク', `<script>var a = '<a href="${GLB_URL}">GLB</a>';</script>`],
    ['<a> 以外の要素の href', `<link href="${GLB_URL}">`],
  ])('%s → download_url_not_linked', async (_n, downloads) => {
    expect(await nasa({ downloads })).toEqual({ ok: false, fail_code: 'download_url_not_linked' });
  });

  it.each<[string, NasaPageParts]>([
    ['閉じていないコメント', { after: '<!-- open' }],
    ['閉じていない属性の引用', { after: '<p class="x>' }],
    ['閉じていない script', { after: '<script>var a = 1;' }],
    ['閉じていないタグ', { after: '<div class="a"' }],
  ])('%s → unparseable（mismatch 側 = fail-closed）', async (_n, o) => {
    // 末尾に置くと </body></html> の手前で終わらないものを作るため、ページの最後を直接差し替える
    const html = nasaPageOf(ROVER, {}).replace('\n</body></html>', '') + o.after;
    const r = await checkNasa(ROVER, stubBy({ ...nasaRoutesOf(ROVER), [ROVER.page_url]: htmlRes(html) }));
    expect(r).toEqual({ ok: false, fail_code: 'unparseable' });
    expect(failClass('unparseable')).toBe('mismatch');
  });
});

describe('B1 DBCLS: CC の URL は生 HTML（実体を復号）・可視テキスト・href の和集合で一意を確かめる', () => {
  const ev = DBCLS.evidence_url!;
  const cc = (body: string) => checkCcUrl(DBCLS, stubBy({ [ev]: htmlRes(dbclsPageOf(body)) }));

  it('script の中の BY と、実体で書いた NC の実リンクが混ざる → ambiguous_cc_url', async () => {
    const body = '<script>var lic = "https://creativecommons.org/licenses/by/4.0/";</script><a href="https&#58;//creativecommons.org/licenses/by-nc/4.0/">ライセンス</a>';
    expect(await cc(body)).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
  });

  it('href は NC・表示の文字は BY → ambiguous_cc_url', async () => {
    expect(await cc('<a href="https://creativecommons.org/licenses/by-nc/4.0/">https://creativecommons.org/licenses/by/4.0/</a>')).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
  });

  it('コメントの中だけの CC の URL は「ある」の根拠にしない（no_cc_url）が、可視の URL と別の URL がコメントにあれば一意でない', async () => {
    expect(await cc('<!-- https://creativecommons.org/licenses/by/4.0/ -->')).toEqual({ ok: false, fail_code: 'no_cc_url' });
    expect(await cc('<a href="https://creativecommons.org/licenses/by/4.0/">BY</a><!-- https://creativecommons.org/licenses/by-nc/4.0/ -->')).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
  });

  it('実測の形（deed.ja と legalcode.ja の 2 つ）は 1 件に正規化されて通る', async () => {
    const body = '<a href="https://creativecommons.org/licenses/by/4.0/deed.ja">表示 4.0</a> <a href="https://creativecommons.org/licenses/by/4.0/legalcode.ja">legal</a>';
    expect(await cc(body)).toMatchObject({ ok: true, license_code: 'cc-by', license_url: 'https://creativecommons.org/licenses/by/4.0/' });
  });
});

// ---------------------------------------------------------------------------------------------

describe('B2 claim を失った古い実行は、取り込みの結果を上書きしない', () => {
  it('A が確認成功 → R2.put で待機 → lease 回収 → B が別の sha を取り込む → A が再開: A は lost_claim、D1 は B の sha のまま', async () => {
    const glbA = tinyGlb('A');
    const glbB = tinyGlb('B');
    const d = deferred();
    let puts = 0;
    putHook = async () => {
      if (++puts === 1) {
        d.enter();
        await d.gate;
      }
    };
    const pA = runRightsCheck(env, ROVER, 'opA', stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: glbRes(glbA) })));
    await d.entered;
    db.prepare('UPDATE rights_records SET claim_at = ? WHERE asset_key = ?').run(new Date(Date.now() - 11 * 60_000).toISOString(), KEY);
    const b = await runRightsCheck(env, ROVER, 'opB', stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: glbRes(glbB) })));
    expect(b).toMatchObject({ kind: 'verified', import: { ok: true, status: 'fetched', sha256: shaHex(glbB) } });
    d.release();
    const a = await pA;
    // D1 の取り込みの記録は B の sha のまま（A の古い sha に戻らない）。B の sha だけが認可され、一覧に出る
    expect(fileRows()).toEqual([{ sha256: shaHex(glbB) }]);
    expect(hostedRows().map((r) => r.sha256)).toEqual([shaHex(glbB)]);
    const offered = offerableModels3d(await loadRightsGate(env));
    expect(offered.map((o) => [o.entry.id, o.hosted?.sha256])).toEqual([[ROVER.id, shaHex(glbB)]]);
    expect(a).toEqual({ kind: 'lost_claim' });
    // A が put した object は R2 に残る（内容アドレスの key なので害はない）
    expect(store.size).toBe(2);
  });
});

describe('B3 確かめている途中に止めると、取り込まない', () => {
  it('提供元の検査の途中（トップのページを取っている間）に止める → GLB を取らず、取り込みの記録も無い。blocked は上書きされない', async () => {
    const f = stubBy(
      nasaRoutesOf(ROVER, {}, {
        [NASA_HUB]: async () => {
          await setRightsBlocked(env, ROVER, true, 'ops@example.invalid');
          return htmlRes(HUB_HTML)();
        },
        [GLB_URL]: glbRes(tinyGlb()),
      }),
    );
    const o = await runRightsCheck(env, ROVER, 'cron', f);
    expect(f.calls).not.toContain(GLB_URL);
    expect(store.size).toBe(0);
    expect(hostedRows()).toEqual([]);
    expect(fileRows()).toEqual([]);
    expect(one(db, 'SELECT status, blocked FROM rights_records WHERE asset_key = ?', KEY)).toEqual({ status: 'verified', blocked: 1 });
    expect(o).toMatchObject({ kind: 'verified', blocked: true, import: { ok: false, error: 'blocked' } });
  });

  it('GLB を取っている間に止める → 有効化の batch が原子的に失敗（models3d_files・rights_hosted とも書かない）', async () => {
    const f = stubBy(
      nasaRoutesOf(ROVER, {}, {
        [GLB_URL]: async () => {
          await setRightsBlocked(env, ROVER, true, 'ops@example.invalid');
          return glbRes(tinyGlb())();
        },
      }),
    );
    const o = await runRightsCheck(env, ROVER, 'cron', f);
    expect(hostedRows()).toEqual([]);
    expect(fileRows()).toEqual([]);
    expect(one(db, 'SELECT blocked, claim_token FROM rights_records WHERE asset_key = ?', KEY)).toEqual({ blocked: 1, claim_token: null });
    expect(o).toMatchObject({ kind: 'verified', blocked: true, import: { ok: false, error: 'blocked' } });
  });
});

// ---------------------------------------------------------------------------------------------

describe('B4 cron の飢餓: 失敗し続ける指紋違い (b) は 1 時間に 1 回しか枠を使わない', () => {
  const S = MODELS3D.filter((e) => e.kind === 'sketchfab').slice(0, 6);
  const seedOldSubjects = async (n: number) => {
    for (const e of S.slice(0, n)) insertRecord(db, await goodRecord(e, { subject_sha256: '0'.repeat(64), last_attempt_at: '2026-01-01T00:00:00.000Z' }));
  };
  const attempts = (e: Model3dEntry) => rows(db, 'SELECT id FROM rights_checks WHERE asset_key = ?', assetKey('models3d', e.id)).length;

  it('Astra の再現: 先頭 5 件が旧指紋で 503 でも、6 件目は 1 回目の cron で確かめられる', async () => {
    await seedOldSubjects(5);
    const f = stubBy({});
    await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: S });
    expect(attempts(S[5])).toBe(1);
  });

  it('失敗した (b) が k 件あっても、1 時間に k 回しか枠を使わない（2 回目の cron は未試行の 1 件だけ・1 時間後に k 件）', async () => {
    await seedOldSubjects(5);
    const f = stubBy({});
    const r1 = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: S });
    expect(r1).toMatchObject({ checked: 5, failed: 5 });
    const r2 = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: S });
    expect(r2).toMatchObject({ checked: 1 });
    expect(S.slice(0, 5).map(attempts)).toEqual([1, 1, 1, 1, 1]);
    const r3 = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: S, now: new Date(Date.now() + 61 * 60_000) });
    expect(r3).toMatchObject({ checked: 5 });
    expect(S.slice(0, 5).map(attempts)).toEqual([2, 2, 2, 2, 2]);
  });

  it('v3.2 並び: 最後の試行の古い順の 1 本（行なしは最古）。指紋違い (b) を (c)(d) より優先しない', async () => {
    const [A, B1, B2, D1] = S;
    const now = new Date('2026-12-20T00:00:00.000Z');
    const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
    insertRecord(db, await goodRecord(B1, { subject_sha256: '0'.repeat(64), last_attempt_at: ago(2 * 3600_000) }));
    insertRecord(db, await goodRecord(B2, { subject_sha256: '0'.repeat(64), last_attempt_at: ago(5 * 3600_000) }));
    insertRecord(db, await goodRecord(D1, { status: 'stale', last_attempt_at: ago(9 * 86_400_000) }));
    const subjects = new Map<string, string>();
    for (const e of [A, B1, B2, D1]) subjects.set(assetKey('models3d', e.id), await subjectSha256(e));
    const got = rightsCandidates([D1, B1, B2, A], await rightsCronRows(env.DB), subjects, now).map((e) => e.id);
    expect(got).toEqual([A.id, D1.id, B2.id, B1.id]);
    // 試行から 1 時間以内の (b) は対象外
    insertRecord(db, await goodRecord(S[4], { subject_sha256: '0'.repeat(64), last_attempt_at: ago(30 * 60_000) }));
    subjects.set(assetKey('models3d', S[4].id), await subjectSha256(S[4]));
    expect(rightsCandidates([S[4]], await rightsCronRows(env.DB), subjects, now)).toEqual([]);
  });

  it('段の時間: 新しい 1 件は締め切りの 330 秒前までにしか始めない', async () => {
    const f = stubBy({});
    expect(await rightsStep(env, { deadline: Date.now() + 300_000, fetchImpl: f, catalog: S })).toMatchObject({ checked: 0 });
    expect(await rightsStep(env, { deadline: Date.now() + 340_000, fetchImpl: f, catalog: S.slice(0, 1) })).toMatchObject({ checked: 1 });
  });
});

describe('申告分 (i)・(iv)', () => {
  it('(i) 同じ sha の成功 → 取り込みの失敗 → 成功（unchanged）で last_import_fail が消える', async () => {
    const glb = tinyGlb('same');
    await runRightsCheck(env, ROVER, 'cron', stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: glbRes(glb) })));
    await new Promise((r) => setTimeout(r, 5));
    await runRightsCheck(env, ROVER, 'cron', stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: statusRes(503) })));
    expect((await lastRightsEvents(env.DB, KEY)).last_import_fail).toMatchObject({ result: 'import:fetch_failed:503' });
    await new Promise((r) => setTimeout(r, 5));
    const o = await runRightsCheck(env, ROVER, 'cron', stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: glbRes(glb) })));
    expect(o).toMatchObject({ kind: 'verified', import: { ok: true, status: 'unchanged' } });
    expect((await lastRightsEvents(env.DB, KEY)).last_import_fail).toBeNull();
  });

  it('(iv) 確かめたことの無い項目を止めると、行は未試行（1970）で作られ、cron がすぐ確かめる', async () => {
    await setRightsBlocked(env, ROVER, true, 'ops@example.invalid');
    expect(one(db, 'SELECT last_attempt_at, blocked FROM rights_records WHERE asset_key = ?', KEY)).toEqual({ last_attempt_at: '1970-01-01T00:00:00.000Z', blocked: 1 });
    const subjects = new Map([[KEY, await subjectSha256(ROVER)]]);
    expect(rightsCandidates([ROVER], await rightsCronRows(env.DB), subjects, new Date()).map((e) => e.id)).toEqual([ROVER.id]);
  });
});


// ---------------------------------------------------------------------------------------------
// §AK v3.2（Astra 2 回目の残り。司令塔の裁定）

describe('v3.2 B1 第三者の印: 生 HTML は大文字小文字を区別せず・&copy の字面・語の間は \\s+（空白の実体は空白に）', () => {
  it.each<[string, string]>([
    ['大文字の &COPY;（可視の本文）', '<p>&COPY; ThirdParty</p>'],
    ['属性の中の ; なしの &COPY', '<span data-c="&COPY">x</span>'],
    ['属性の中の &nbsp; でつないだ All rights reserved', '<span title="All&nbsp;rights&nbsp;reserved">x</span>'],
    ['属性の中の 2 つの空白と改行の実体でつないだ USED WITH PERMISSION', '<span data-c="USED  WITH&#10;PERMISSION">x</span>'],
  ])('%s → third_party_marker', async (_n, details) => {
    expect(await nasa({ details })).toEqual({ ok: false, fail_code: 'third_party_marker' });
  });

  it('区画は広めに取る（負の判定だけ）: Details の直前の文のかたまりのコメントの印でも落とす = 安全側', async () => {
    expect(await nasa({ h1Block: `<h1 class="page-title">${ROVER.title_src}</h1><!-- © Other Footer -->` })).toEqual({ ok: false, fail_code: 'third_party_marker' });
  });
});

describe('v3.2 B1 構造: CDATA と生テキスト要素の自己終了は unparseable', () => {
  it('SVG の CDATA の中だけに h1 とリンクを置いても通らない（文書のどこかに <![CDATA[ があれば unparseable）', async () => {
    const h1Block = `<svg><![CDATA[><h1>${ROVER.title_src}</h1><a href="${GLB_URL}">GLB</a>]]></svg>`;
    expect(await nasa({ h1Block, downloads: '<p>none</p>' })).toEqual({ ok: false, fail_code: 'unparseable' });
    expect(await nasa({ after: '<svg><![CDATA[ x ]]></svg>' })).toEqual({ ok: false, fail_code: 'unparseable' });
  });

  it('生テキスト要素の開始タグの自己終了（<style/>）は unparseable（空要素として扱うと、後ろの </style> までの本文を隠せる）', async () => {
    expect(await nasa({ after: '<svg><style/></svg><p>visible</p><style>p{}</style>' })).toEqual({ ok: false, fail_code: 'unparseable' });
    expect(await nasa({ after: '<svg><style/></svg>' })).toEqual({ ok: false, fail_code: 'unparseable' });
  });

  it('対照: 引用なしの属性値の末尾の / は自己終了ではない（<script src=/a/></script> は通る）', async () => {
    expect(await nasa({ head: '<script src=/a/></script>' })).toMatchObject({ ok: true });
  });
});

describe('v3.2 B1 DBCLS: 一意の側は scheme の書き方に依存しない', () => {
  const ev = DBCLS.evidence_url!;
  const cc = (body: string) => checkCcUrl(DBCLS, stubBy({ [ev]: htmlRes(dbclsPageOf(body)) }));
  const BY = '<a href="https://creativecommons.org/licenses/by/4.0/">表示 4.0</a>';

  it('通常の BY のリンクと href="https&colon;//…/by-nc/4.0/" が混ざる → ambiguous_cc_url', async () => {
    expect(await cc(BY + '<a href="https&colon;//creativecommons.org/licenses/by-nc/4.0/">x</a>')).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
  });

  it('scheme の無い creativecommons.org/licenses/by-nc/4.0/（コメントの中）が混ざる → ambiguous_cc_url。&sol; で書いた path も拾う', async () => {
    expect(await cc(BY + '<!-- creativecommons.org/licenses/by-nc/4.0/ -->')).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
    expect(await cc(BY + '<span data-l="creativecommons&period;org&sol;licenses&sol;by-nc&sol;4.0&sol;">x</span>')).toEqual({ ok: false, fail_code: 'ambiguous_cc_url' });
  });

  it('対照: BY だけなら通る', async () => {
    expect(await cc(BY)).toMatchObject({ ok: true, license_code: 'cc-by' });
  });
});

describe('v3.2 B4 時間の制約の下でも飢餓にならない（前段が毎回 500 秒・1 回 1 件）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Astra の再現: Sketchfab 8 件のうち 7 件が旧指紋で毎回 503（19 秒）、8 件目は確認の期限切れ → 30 回の cron のうちに 8 件目を確かめる', async () => {
    const S8 = MODELS3D.filter((e) => e.kind === 'sketchfab').slice(0, 8);
    const T0 = Date.parse('2026-12-20T00:00:00.000Z');
    const twoDays = new Date(T0 - 2 * 86_400_000).toISOString();
    for (const e of S8.slice(0, 7)) insertRecord(db, await goodRecord(e, { subject_sha256: '0'.repeat(64), last_attempt_at: twoDays }));
    insertRecord(db, await goodRecord(S8[7], { checked_at: new Date(T0 - 31 * 86_400_000).toISOString(), last_attempt_at: twoDays }));
    vi.useFakeTimers({ toFake: ['Date'] });
    const slow503 = (async () => {
      vi.setSystemTime(Date.now() + 19_000);
      return new Response('x', { status: 503 });
    }) as unknown as typeof fetch;
    const counts: number[] = [];
    for (let k = 0; k < 30; k++) {
      const start = T0 + k * 600_000;
      vi.setSystemTime(start + 500_000);
      const r = await rightsStep(env, { deadline: start + 840_000, fetchImpl: slow503, catalog: S8 });
      counts.push(r === 'paused' ? -1 : r.checked);
    }
    expect(Math.max(...counts)).toBe(1);
    const eighth = rows(db, 'SELECT id FROM rights_checks WHERE asset_key = ?', assetKey('models3d', S8[7].id)).length;
    expect(eighth).toBeGreaterThanOrEqual(1);
  });
});

describe('v3.2 戻す（unblock）は未試行に戻し、止めている間に省いた取り込みを次の cron で行う', () => {
  it('止める → 確認は通るが取り込まない → 戻す → 次の cron の候補になり、取り込む', async () => {
    await setRightsBlocked(env, ROVER, true, 'ops@example.invalid');
    const glb = tinyGlb('after-unblock');
    const f = stubBy(nasaRoutesOf(ROVER, {}, { [GLB_URL]: glbRes(glb) }));
    expect(await runRightsCheck(env, ROVER, 'cron', f)).toMatchObject({ kind: 'verified', blocked: true, import: { ok: false, error: 'blocked' } });
    expect(hostedRows()).toEqual([]);
    await setRightsBlocked(env, ROVER, false, 'ops@example.invalid');
    expect(one(db, 'SELECT last_attempt_at, blocked, status FROM rights_records WHERE asset_key = ?', KEY)).toEqual({ last_attempt_at: '1970-01-01T00:00:00.000Z', blocked: 0, status: 'verified' });
    const subjects = new Map([[KEY, await subjectSha256(ROVER)]]);
    expect(rightsCandidates([ROVER], await rightsCronRows(env.DB), subjects, new Date()).map((e) => e.id)).toEqual([ROVER.id]);
    const r = await rightsStep(env, { deadline: Date.now() + 10 * 60_000, fetchImpl: f, catalog: [ROVER] });
    expect(r).toMatchObject({ checked: 1, verified: 1, imported: 1 });
    expect(hostedRows().map((h) => h.sha256)).toEqual([shaHex(glb)]);
  });
});
