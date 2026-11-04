// 入口の形式検査（§K-6）と、提案箱の SQL（adopt の条件付き batch・similar_count）を node:sqlite の実 DB で確かめる（§K-8 (o)(p)）。
import { beforeEach, describe, expect, it } from 'vitest';
import { composeChildBody, sanitizeLlmProposal, validateProposalInput } from '../src/checks/intake';
import { insertProposalStmt } from '../src/proposals';
import { insertMaterial, type MaterialInput } from '../src/routes/materials';
import { stmt } from '../src/db';
import { d1, migratedDb, one, rows } from './d1-shim';
import type { DatabaseSync } from 'node:sqlite';

const okChild = () => ({
  title: '影の長さを測りたかった',
  body: '外で棒の影を見ていて、時間で長さが変わる理由を知りたくなった',
  concept_codes: ['SCI02'],
  age_band: 'elementary',
  missing: '影の長さと太陽の高さの関係を示す図',
  supporter_checked: true,
  supporter_email: 'staff@example.invalid',
});

describe('validateProposalInput（§K-6）', () => {
  it('manual: 正しい入力は ok', () => {
    const r = validateProposalInput({ title: '題', body: '本文', concept_codes: ['MATH1'], kinds: [4, 3, 3], age_band: 'both', evidence: [{ url: 'https://example.org/a' }] }, { source: 'manual' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kinds).toEqual([3, 4]);
      expect(r.value.evidence).toEqual([{ url: 'https://example.org/a', title: null, note: null }]);
    }
  });

  it.each([
    [{ title: 'x'.repeat(121), body: 'b' }, 'title'],
    [{ title: 't', body: 'b'.repeat(2001) }, 'body'],
    [{ title: 't', body: 'b', concept_codes: ['math'] }, 'concept_codes'],
    [{ title: 't', body: 'b', concept_codes: Array.from({ length: 21 }, (_, i) => `C${i + 10}`) }, 'concept_codes'],
    [{ title: 't', body: 'b', kinds: [0] }, 'kinds'],
    [{ title: 't', body: 'b', kinds: [1, 2, 3, 4, 5, 6, 7, 8, 1] }, 'kinds'],
    [{ title: 't', body: 'b', age_band: 'adult' }, 'age_band'],
    [{ title: 't', body: 'b', evidence: [{ url: 'http://example.org' }] }, 'evidence'],
    [{ title: 't', body: 'b', evidence: [{ url: 'javascript:alert(1)' }] }, 'evidence'],
    [{ title: 't', body: 'b', evidence: Array.from({ length: 11 }, () => ({ url: 'https://example.org' })) }, 'evidence'],
  ])('manual: 形の合わない field は invalid_field %#', (input, field) => {
    const r = validateProposalInput(input, { source: 'manual' });
    expect(r).toEqual({ ok: false, error: 'invalid_field', field });
  });

  it('禁止語（§F-2 の 13 語）を title / body に含めば forbidden_word', () => {
    expect(validateProposalInput({ title: 'ランキングで比べる', body: 'b' }, { source: 'manual' })).toEqual({ ok: false, error: 'forbidden_word', field: 'title' });
    expect(validateProposalInput({ title: 't', body: '集中力を高める' }, { source: 'manual' })).toEqual({ ok: false, error: 'forbidden_word', field: 'body' });
  });

  it('child: 正しい body は ok。保存する本文は「足りなかったこと」をまとめる', () => {
    const r = validateProposalInput(okChild(), { source: 'child' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.supporter_email).toBe('staff@example.invalid');
      expect(composeChildBody(r.value)).toContain('足りなかったこと: 影の長さと太陽の高さ');
    }
  });

  it('child: supporter_checked が true でなければ supporter_check_required（文字列 "true" も不可）', () => {
    const a = okChild() as Record<string, unknown>;
    delete a.supporter_checked;
    expect(validateProposalInput(a, { source: 'child' })).toEqual({ ok: false, error: 'supporter_check_required', field: 'supporter_checked' });
    expect(validateProposalInput({ ...okChild(), supporter_checked: 'true' }, { source: 'child' })).toMatchObject({ error: 'supporter_check_required' });
  });

  it('child: child_name 等のキーは値を読まずに forbidden_field。応答に値を含めない', () => {
    for (const k of ['child_id', 'name', 'child_name', 'student', 'conversation', 'transcript', 'log', 'photo']) {
      const r = validateProposalInput({ ...okChild(), [k]: 'SECRET-VALUE-123' }, { source: 'child' });
      expect(r).toEqual({ ok: false, error: 'forbidden_field', field: k });
      expect(JSON.stringify(r)).not.toContain('SECRET-VALUE-123');
    }
    // supporter_checked が無くても、禁止キーが先に効く
    const b = okChild() as Record<string, unknown>;
    delete b.supporter_checked;
    expect(validateProposalInput({ ...b, child_name: 'x' }, { source: 'child' })).toMatchObject({ error: 'forbidden_field', field: 'child_name' });
  });

  it('child: 許可されていない未知のキーも forbidden_field。形の怪しいキー名は名前も返さない', () => {
    expect(validateProposalInput({ ...okChild(), evidence: [] }, { source: 'child' })).toEqual({ ok: false, error: 'forbidden_field', field: 'evidence' });
    expect(validateProposalInput({ ...okChild(), 山田: 1 }, { source: 'child' })).toEqual({ ok: false, error: 'forbidden_field', field: null });
  });

  it('child: age_band・missing・supporter_email は必須', () => {
    expect(validateProposalInput({ ...okChild(), age_band: undefined }, { source: 'child' })).toMatchObject({ field: 'age_band' });
    expect(validateProposalInput({ ...okChild(), missing: '' }, { source: 'child' })).toMatchObject({ field: 'missing' });
    expect(validateProposalInput({ ...okChild(), supporter_email: 'no-at' }, { source: 'child' })).toMatchObject({ field: 'supporter_email' });
    expect(validateProposalInput({ ...okChild(), missing: '評価が欲しい' }, { source: 'child' })).toMatchObject({ error: 'forbidden_word', field: 'missing' });
  });

  it('composeChildBody は合計 2000 文字を超えたら null', () => {
    const r = validateProposalInput({ ...okChild(), body: 'b'.repeat(1990) }, { source: 'child' });
    expect(r.ok && composeChildBody(r.value)).toBe(null);
  });

  it('sanitizeLlmProposal: 長さを切り、形の合わない概念・型・http の URL を落とし、禁止語は null', () => {
    const v = sanitizeLlmProposal(
      { title: 't'.repeat(200), body: '本文', concept_codes: ['OK12', 'bad'], kinds: [3, 9, 'x'], age_band: 'adult', evidence: [{ url: 'http://a.example' }, { url: 'https://b.example/x', title: 'B' }] },
      'scout',
    );
    expect(v).not.toBeNull();
    expect(v?.title.length).toBe(120);
    expect(v?.concept_codes).toEqual(['OK12']);
    expect(v?.kinds).toEqual([3]);
    expect(v?.age_band).toBeNull();
    expect(v?.evidence).toEqual([{ url: 'https://b.example/x', title: 'B', note: null }]);
    expect(sanitizeLlmProposal({ title: '成績を上げる', body: 'b' }, 'meeting')).toBeNull();
  });
});

describe('proposals の SQL（node:sqlite の実 DB）', () => {
  let raw: DatabaseSync;
  let db: D1Database;
  const T = '2026-11-04T00:00:00.000Z';
  beforeEach(() => {
    raw = migratedDb();
    db = d1(raw);
  });

  const addProposal = async (id: string, concepts: string[], catalog: string | null = null) => {
    const r = validateProposalInput({ title: `題 ${id}`, body: '本文', concept_codes: concepts, catalog_item_id: catalog }, { source: 'manual' });
    if (!r.ok) throw new Error('fixture');
    const s = insertProposalStmt({ id, now: T, source_kind: 'manual', source_ref: 'r@example.invalid', value: r.value, body: r.value.body });
    await db.prepare(s.sql).bind(...s.params).run();
  };

  it('similar_count は concept_codes か catalog_item_id が重なる既存提案の数', async () => {
    await addProposal('p1', ['SCI01', 'MATH1']);
    await addProposal('p2', ['ART01'], 'mc-redstone');
    await addProposal('p3', ['MATH1']);
    await addProposal('p4', [], 'mc-redstone');
    await addProposal('p5', ['ZZZ9']);
    const sc = Object.fromEntries(rows(raw, 'SELECT id, similar_count FROM proposals').map((r) => [r.id, r.similar_count]));
    expect(sc).toEqual({ p1: 0, p2: 0, p3: 1, p4: 1, p5: 0 });
  });

  const input = (slug: string): MaterialInput => ({ title: '素材', slug, catalog_item_id: null, kinds: [3], concept_codes: [], brief_md: '注文票' });
  const adopt = (pid: string, slug: string) =>
    insertMaterial(db, input(slug), {
      budget_cents: 300,
      guard: {
        proposal_id: pid,
        exists: stmt("SELECT 1 FROM proposals gp WHERE gp.id = ? AND gp.status = 'proposed'", pid),
        last: (ids) =>
          stmt(
            "UPDATE proposals SET status = 'adopted', decided_by = ?, decided_at = ?, material_id = ?, updated_at = ? WHERE id = ? AND status = 'proposed'",
            'r@example.invalid',
            ids.now,
            ids.material_id,
            ids.now,
            pid,
          ),
        conflict: 'not_proposed',
      },
    });

  it('(o) adopt: materials + 下書き job + proposals adopted が 1 batch。2 回目は 409 not_proposed で 0 行', async () => {
    await addProposal('p1', ['SCI01']);
    const a = await adopt('p1', 'from-proposal');
    expect(a.status).toBe(201);
    const p = one(raw, 'SELECT status, material_id, decided_by FROM proposals WHERE id = ?', 'p1');
    expect(p.status).toBe('adopted');
    expect(p.material_id).toBe(a.body.material_id);
    expect(one(raw, 'SELECT proposal_id, work_status, publish_status FROM materials WHERE id = ?', a.body.material_id as string)).toEqual({
      proposal_id: 'p1',
      work_status: 'queued',
      publish_status: 'none',
    });
    expect(one(raw, 'SELECT status, kind FROM factory_jobs WHERE id = ?', a.body.job_id as string)).toEqual({ status: 'queued', kind: 'draft' });

    const b = await adopt('p1', 'from-proposal-2');
    expect(b).toEqual({ status: 409, body: { error: 'not_proposed' } });
    expect(one(raw, 'SELECT COUNT(*) AS c FROM materials').c).toBe(1);
    expect(one(raw, 'SELECT COUNT(*) AS c FROM factory_jobs').c).toBe(1);
  });

  it('adopt: slug 重複は 409 slug_taken で提案は proposed のまま（片方だけ commit しない）', async () => {
    await addProposal('p1', []);
    await addProposal('p2', []);
    expect((await adopt('p1', 'same-slug')).status).toBe(201);
    expect(await adopt('p2', 'same-slug')).toEqual({ status: 409, body: { error: 'slug_taken' } });
    expect(one(raw, 'SELECT status FROM proposals WHERE id = ?', 'p2').status).toBe('proposed');
    expect(one(raw, 'SELECT COUNT(*) AS c FROM factory_jobs').c).toBe(1);
  });

  it('guard 無しの insertMaterial（POST /api/materials）は従来と同じ 2 行', async () => {
    const r = await insertMaterial(db, input('plain'), { budget_cents: 300 });
    expect(r.status).toBe(201);
    expect(one(raw, 'SELECT proposal_id FROM materials WHERE id = ?', r.body.material_id as string).proposal_id).toBeNull();
  });

  it('0002 の作り直し後も cost_ledger は session/verify/scout/meeting だけを受ける', () => {
    for (const k of ['session', 'verify', 'scout', 'meeting']) raw.prepare("INSERT INTO cost_ledger VALUES (?, '2026-11-04', ?, 'r', 1, 't')").run(`id-${k}`, k);
    expect(() => raw.prepare("INSERT INTO cost_ledger VALUES ('x', '2026-11-04', 'other', 'r', 1, 't')").run()).toThrow(/CHECK/);
  });
});

describe('/api/intake の Access（JWT の email か service token の common_name。§K-3）', () => {
  const TEAM = 'https://team.example.cloudflareaccess.com';
  const AUD = 'aud-test';
  const b64u = (b: ArrayBuffer | Uint8Array | string) => Buffer.from(typeof b === 'string' ? b : b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64url');

  async function setup() {
    const kp = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
    const store = new Map<string, Response>();
    (globalThis as unknown as { caches: unknown }).caches = {
      default: { match: async (r: Request) => store.get(r.url)?.clone(), put: async (r: Request, res: Response) => void store.set(r.url, res) },
    };
    (globalThis as unknown as { fetch: unknown }).fetch = async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
    return async (payload: Record<string, unknown>) => {
      const h = b64u(JSON.stringify({ alg: 'RS256', kid: 'k1' }));
      const p = b64u(JSON.stringify({ iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 600, ...payload }));
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
      return `${h}.${p}.${b64u(sig)}`;
    };
  }

  it('common_name は allowCommonName の時だけ通る。email は常に通る。署名の合わない token は通らない', async () => {
    const realFetch = globalThis.fetch;
    try {
      const sign = await setup();
      const { verifyAccessJwt } = await import('../src/access');
      const cfgVars = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } as unknown as import('../src/env').Env;
      const svc = await sign({ common_name: 'buddy.access', sub: '' });
      expect(await verifyAccessJwt(svc, cfgVars)).toBeNull();
      expect(await verifyAccessJwt(svc, cfgVars, undefined, { allowCommonName: true })).toBe('service:buddy.access');
      const human = await sign({ email: 'op@example.invalid' });
      expect(await verifyAccessJwt(human, cfgVars)).toBe('op@example.invalid');
      expect(await verifyAccessJwt(human, cfgVars, undefined, { allowCommonName: true })).toBe('op@example.invalid');
      const parts = svc.split('.');
      const forged = `${parts[0]}.${b64u(JSON.stringify({ iss: TEAM, aud: [AUD], exp: Math.floor(Date.now() / 1000) + 600, common_name: 'evil' }))}.${parts[2]}`;
      expect(await verifyAccessJwt(forged, cfgVars, undefined, { allowCommonName: true })).toBeNull();
    } finally {
      (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    }
  });
});
