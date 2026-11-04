// mc-facts（段階 A: 公式パッチノート）の純関数と取得の上限。フィクスチャは手書きの合成データ（Mojang の本文は使わない）
import { describe, expect, it } from 'vitest';
import {
  collectPatchNotes,
  factId,
  factsKey,
  htmlToBlocks,
  indexKey,
  isAllowedUrl,
  parseManifest,
  parsePatchNoteDetail,
  parsePatchNotesIndex,
  type FetchLike,
} from '../src/mc-facts';

const MANIFEST = {
  latest: { release: '9.2', snapshot: '9.3-snap-1' },
  versions: [
    { id: '9.3-snap-1', type: 'snapshot', url: 'https://piston-meta.mojang.com/x.json', releaseTime: '2030-02-01T00:00:00+00:00' },
    { id: '9.2', type: 'release', url: 'https://piston-meta.mojang.com/y.json', releaseTime: '2030-01-01T00:00:00+00:00' },
    { id: '9.1', type: 'release', url: 'https://piston-meta.mojang.com/z.json', releaseTime: '2029-12-01T00:00:00+00:00' },
    { id: '../evil', type: 'release' },
  ],
};

const JAVA_INDEX = {
  version: 1,
  entries: [
    { title: 'Test 9.2', version: '9.2', type: 'release', contentPath: 'javaPatchNotes/9-2.json', id: '9-2', date: '2030-01-01T00:00:00.000Z' },
    { title: 'Test snap', version: '9.3-snap-1', type: 'snapshot', contentPath: 'javaPatchNotes/9-3-snap-1.json', id: 'x', date: '2030-02-01T00:00:00.000Z' },
    { title: 'Test 9.1', version: '9.1', type: 'release', contentPath: 'javaPatchNotes/9-1.json', id: '9-1', date: '2029-12-01T00:00:00.000Z' },
  ],
};

const BODY_92 =
  '<h1>New Features</h1><p>Added the <strong>test block</strong> &amp; a <a href="https://example.com/x">link</a>.</p>' +
  '<h2>Commands</h2><ul><li>Changed <code>/give</code> syntax<ul><li>Count is now optional</li></ul></li><li>Fixed &lt;target&gt; parsing</li></ul>' +
  '<script>alert(1)</script><img src="https://evil.example/a.png" onerror="alert(1)"><p>Line<br>two</p>';

const detail = (version: string, body: string) => ({ title: `Test ${version}`, version, type: 'release', id: version, date: '2030-01-01T00:00:00.000Z', body });

function fakeFetch(routes: Record<string, () => Response>, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const r = routes[url];
    return r ? r() : new Response('not found', { status: 404 });
  };
}
const json = (v: unknown) => () => new Response(JSON.stringify(v), { status: 200 });

const BASE = 'https://launchercontent.mojang.com/v2/';
const ROUTES = (extra: Record<string, () => Response> = {}) => ({
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json': json(MANIFEST),
  [BASE + 'javaPatchNotes.json']: json(JAVA_INDEX),
  [BASE + 'javaPatchNotes/9-2.json']: json(detail('9.2', BODY_92)),
  [BASE + 'javaPatchNotes/9-1.json']: json(detail('9.1', '<h1>Fixes</h1><ul><li>Fixed a thing</li></ul>')),
  [BASE + 'javaPatchNotes/9-3-snap-1.json']: json(detail('9.3-snap-1', '<p>Snap</p>')),
  ...extra,
});

function memStore() {
  const m = new Map<string, string>();
  const puts: string[] = [];
  return {
    m,
    puts,
    put: async (k: string, v: string) => {
      puts.push(k);
      m.set(k, v);
    },
    get: async (k: string) => m.get(k) ?? null,
  };
}

describe('mc-facts parse', () => {
  it('htmlToBlocks: 見出しの道筋と平文を取り、タグ・script・属性を残さない', () => {
    const blocks = htmlToBlocks(BODY_92);
    expect(blocks).toEqual([
      { heading_path: ['New Features'], text: 'Added the test block & a link.' },
      { heading_path: ['New Features', 'Commands'], text: 'Changed /give syntax' },
      { heading_path: ['New Features', 'Commands', 'Changed /give syntax'], text: 'Count is now optional' },
      { heading_path: ['New Features', 'Commands'], text: 'Fixed <target> parsing' },
      { heading_path: ['New Features', 'Commands'], text: 'Line two' },
    ]);
    const all = JSON.stringify(blocks);
    expect(all).not.toContain('alert');
    expect(all).not.toContain('evil.example');
    expect(all).not.toContain('href');
  });

  it('htmlToBlocks: 同じ段の見出しが来たら深い段を捨てる', () => {
    const b = htmlToBlocks('<h1>A</h1><h2>B</h2><p>x</p><h1>C</h1><p>y</p>');
    expect(b.map((x) => x.heading_path)).toEqual([['A', 'B'], ['C']]);
  });

  it('parseManifest / parsePatchNotesIndex: 版名の安全確認と新しい順', () => {
    const m = parseManifest(MANIFEST);
    expect([...m.keys()]).toEqual(['9.3-snap-1', '9.2', '9.1']);
    expect(m.get('9.2')?.type).toBe('release');
    const idx = parsePatchNotesIndex('java', JAVA_INDEX);
    expect(idx.map((e) => e.version)).toEqual(['9.3-snap-1', '9.2', '9.1']);
    expect(idx[1].detail_url).toBe(BASE + 'javaPatchNotes/9-2.json');
    const bed = parsePatchNotesIndex('bedrock', { entries: [{ version: '5.10', patchNoteType: 'beta', contentPath: 'bedrockPatchNotes/abc.json', date: '2030-01-02' }] });
    expect(bed[0].type).toBe('beta');
  });

  it('parsePatchNoteDetail: 正規化レコードを作り、fact_id は入力が同じなら安定', async () => {
    const entry = parsePatchNotesIndex('java', JAVA_INDEX)[1];
    const r1 = await parsePatchNoteDetail({ entry, detail: detail('9.2', BODY_92), manifest: parseManifest(MANIFEST) });
    const r2 = await parsePatchNoteDetail({ entry, detail: detail('9.2', BODY_92), manifest: parseManifest(MANIFEST) });
    expect(r1).not.toBeNull();
    expect(r1).toMatchObject({ edition: 'java', version: '9.2', type: 'release', fact_strength: 'primary_doc', source_url: BASE + 'javaPatchNotes/9-2.json' });
    expect(r1!.changes).toHaveLength(5);
    expect(r1!.changes.map((c) => c.fact_id)).toEqual(r2!.changes.map((c) => c.fact_id));
    expect(r1!.content_hash).toBe(r2!.content_hash);
    expect(r1!.changes[0].fact_id).toBe(await factId('java', '9.2', ['New Features'], 'Added the test block & a link.'));
    expect(r1!.changes[0].fact_id).toMatch(/^mcf_[0-9a-f]{32}$/);
    // 版・見出し・本文のどれかが違えば別の ID
    expect(await factId('java', '9.1', ['New Features'], 'Added the test block & a link.')).not.toBe(r1!.changes[0].fact_id);
    expect(await factId('bedrock', '9.2', ['New Features'], 'Added the test block & a link.')).not.toBe(r1!.changes[0].fact_id);
    expect(await factId('java', '9.2', ['Other'], 'Added the test block & a link.')).not.toBe(r1!.changes[0].fact_id);
  });

  it('parsePatchNoteDetail: 一覧と詳細の版が食い違えば捨てる', async () => {
    const entry = parsePatchNotesIndex('java', JAVA_INDEX)[1];
    expect(await parsePatchNoteDetail({ entry, detail: detail('9.1', '<p>x</p>') })).toBeNull();
  });

  it('R2 のキー: facts/{edition}/{version}/patch-notes.json と index、危険な版名は拒否', () => {
    expect(factsKey('java', '9.2')).toBe('facts/java/9.2/patch-notes.json');
    expect(indexKey('bedrock')).toBe('facts/bedrock/index.json');
    expect(() => factsKey('java', '../x')).toThrow();
    expect(() => factsKey('java', 'a/b')).toThrow();
  });
});

describe('mc-facts collect', () => {
  const far = Date.now() + 60_000;

  it('host allowlist: https の Mojang 2 ホスト以外は拒否する', () => {
    expect(isAllowedUrl('https://launchercontent.mojang.com/v2/javaPatchNotes.json')).toBe(true);
    expect(isAllowedUrl('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toBe(true);
    expect(isAllowedUrl('http://launchercontent.mojang.com/v2/x.json')).toBe(false);
    expect(isAllowedUrl('https://evil.example/x.json')).toBe(false);
    expect(isAllowedUrl('https://launchercontent.mojang.com.evil.example/x.json')).toBe(false);
    expect(isAllowedUrl('https://user@launchercontent.mojang.com/x.json')).toBe(false);
    expect(isAllowedUrl('https://launchercontent.mojang.com:8443/x.json')).toBe(false);
  });

  it('host allowlist: 一覧の contentPath が別ホストを指していても取りに行かない', async () => {
    const calls: string[] = [];
    const index = { entries: [{ version: '9.2', type: 'release', contentPath: 'https://evil.example/9-2.json', date: '2030-01-01' }, { version: '9.1', type: 'release', contentPath: '//evil.example/9-1.json', date: '2029-01-01' }] };
    const s = memStore();
    const r = await collectPatchNotes(fakeFetch(ROUTES({ [BASE + 'javaPatchNotes.json']: json(index) }), calls), s.put, { editions: ['java'], limit: 5, deadline: far });
    expect(calls.some((c) => c.includes('evil'))).toBe(false);
    expect(r.versions.map((v) => [v.version, v.status, v.reason])).toEqual([
      ['9.2', 'error', 'host_not_allowed'],
      ['9.1', 'error', 'host_not_allowed'],
    ]);
    expect(s.puts).toEqual([]);
  });

  it('byte cap: 上限を超える応答は読み切らずに捨てる', async () => {
    const big = () => new Response(JSON.stringify(detail('9.2', '<p>' + 'x'.repeat(5000) + '</p>')), { status: 200 });
    const s = memStore();
    const r = await collectPatchNotes(fakeFetch(ROUTES({ [BASE + 'javaPatchNotes/9-2.json']: big })), s.put, { editions: ['java'], limit: 1, deadline: far, types: ['release'], maxDetailBytes: 1000 });
    expect(r.versions).toEqual([{ edition: 'java', version: '9.2', status: 'error', reason: 'too_large' }]);
    expect(s.puts).toEqual([]);
  });

  it('limit と types: release だけを新しい順に最大 N 件書き、index も書く', async () => {
    const s = memStore();
    const r = await collectPatchNotes(fakeFetch(ROUTES()), s.put, { editions: ['java'], limit: 1, deadline: far, types: ['release'], get: s.get });
    expect(r.versions.map((v) => [v.version, v.status])).toEqual([['9.2', 'written']]);
    expect(r.stopped_by_limit).toBe(true);
    expect(s.puts).toEqual(['facts/java/9.2/patch-notes.json', 'facts/java/index.json']);
    const idx = JSON.parse(s.m.get('facts/java/index.json')!);
    expect(Object.keys(idx.versions)).toEqual(['9.2']);
  });

  it('idempotent: 保存済みと内容ハッシュが同じ版は書かない', async () => {
    const s = memStore();
    const opts = { editions: ['java' as const], limit: 2, deadline: far, types: ['release'], get: s.get };
    await collectPatchNotes(fakeFetch(ROUTES()), s.put, opts);
    expect(s.puts).toHaveLength(3);
    s.puts.length = 0;
    const r = await collectPatchNotes(fakeFetch(ROUTES()), s.put, opts);
    expect(r.versions.map((v) => v.status)).toEqual(['unchanged', 'unchanged']);
    expect(s.puts).toEqual([]);
    // 本文が変われば、その版と index だけ書き直す
    const changed = ROUTES({ [BASE + 'javaPatchNotes/9-1.json']: json(detail('9.1', '<h1>Fixes</h1><ul><li>Fixed two things</li></ul>')) });
    const r3 = await collectPatchNotes(fakeFetch(changed), s.put, opts);
    expect(r3.versions.map((v) => [v.version, v.status])).toEqual([['9.2', 'unchanged'], ['9.1', 'written']]);
    expect(s.puts).toEqual(['facts/java/9.1/patch-notes.json', 'facts/java/index.json']);
  });

  it('deadline: 締め切りを過ぎたら次の版を取りに行かない', async () => {
    let t = 1000;
    const calls: string[] = [];
    const base = fakeFetch(ROUTES(), calls);
    // 1 回取るごとに時計を 100ms 進める
    const ticking: FetchLike = async (u, i) => {
      t += 100;
      return base(u, i);
    };
    const s = memStore();
    const r = await collectPatchNotes(ticking, s.put, { editions: ['java'], limit: 10, deadline: 1350, now: () => t });
    // manifest(1100) → index(1200) → 詳細 1 件目(1300) → 1300 < 1350 なので 2 件目を試すが、残り時間 50ms で取得して 1400 → 3 件目は始めない
    expect(r.stopped_by_deadline).toBe(true);
    expect(calls.filter((c) => c.includes('javaPatchNotes/'))).toHaveLength(2);
    const r0 = await collectPatchNotes(ticking, s.put, { editions: ['java'], limit: 10, deadline: t, now: () => t });
    expect(r0.stopped_by_deadline).toBe(true);
    expect(r0.versions).toEqual([]);
  });

  it('timeout: 応答が来ない取得は打ち切ってエラーにする', async () => {
    const hang: FetchLike = (url, init) =>
      url.includes('9-2')
        ? new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))
        : fakeFetch(ROUTES())(url, init);
    const s = memStore();
    const r = await collectPatchNotes(hang, s.put, { editions: ['java'], limit: 2, deadline: far, types: ['release'], timeoutMs: 20 });
    expect(r.versions.map((v) => [v.version, v.status, v.reason ?? null])).toEqual([['9.2', 'error', 'timeout'], ['9.1', 'written', null]]);
  });

  it('転送（3xx）は追わない', async () => {
    const redirect = () => new Response(null, { status: 302, headers: { location: 'https://evil.example/x' } });
    const s = memStore();
    const r = await collectPatchNotes(fakeFetch(ROUTES({ [BASE + 'javaPatchNotes/9-2.json']: redirect })), s.put, { editions: ['java'], limit: 1, deadline: far, types: ['release'] });
    expect(r.versions[0]).toMatchObject({ status: 'error', reason: 'http_302' });
  });
});
