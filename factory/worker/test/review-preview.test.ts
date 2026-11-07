// 確認画面 v3（契約 §V-9・§V-11 (u9)）: 子どもの画面を主役に、見てほしい所・機械が確かめたこと・補足（出典カード）・固定フッター。
// admin.js の純関数を vm で読む（DOM は使わない）。作り物のデータ test/review-preview/fixtures.mjs（detail.json が土台）は、
// 見た目の確認（serve.mjs + headless Chrome）と共通。
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { triageVersion } from '../src/checks/triage';
// @ts-expect-error 素の JS の作り物のデータ（serve.mjs と共通）
import * as FX from './review-preview/fixtures.mjs';

type Obj = Record<string, any>;
const code = readFileSync(new URL('../public/admin/admin.js', import.meta.url), 'utf8');
const win: Obj = { __FACTORY_ADMIN_NO_BOOT__: true };
vm.runInNewContext(code, { window: win, console }, { timeout: 2000 });
const R = win.FactoryAdminReview as Obj;
const fixture = (): Obj => FX.attention();
const n = (h: string, re: RegExp) => (h.match(re) || []).length;
const md = (p: string) => readFileSync(new URL(`./review-preview/files/${p}`, import.meta.url), 'utf8');
const BASE = '/api/review/vfix-0001/files/';
/** 版の全部の変奏の本文（場所の決め方のテスト用） */
const allMd = (d: Obj) => {
  const out: Record<string, string> = {};
  for (const p of d.version.material.parts) for (const v of p.variants) out[v.path] = md(v.path);
  return out;
};
const idx = (d: Obj) => Object.fromEntries(d.claims.map((c: Obj, i: number) => [c.id, i]));
/** 見てほしい所 i を ok / redo にした状態 */
const pick = (d: Obj, st: Obj, i: number, to: 'ok' | 'redo') => R.toggleItem(st, d, R.triageOf(d).shown[i], to);
/** fix は「このまま出す」、ask は「OK にする」で全部決めた状態 */
const allOk = (d: Obj) => {
  const st = R.newReviewState();
  R.triageOf(d).shown.forEach((_x: Obj, i: number) => pick(d, st, i, 'ok'));
  return st;
};

describe('作り物のデータ（fixtures: 4 通り）', () => {
  it.each(['attention', 'clean', 'pending', 'readerWait'])('%s: triage.groups / ok_counts は triageVersion（§L-3 互換の出力）と同じ', (name) => {
    const d = (FX as Obj)[name]();
    const t = triageVersion({
      claims: { claims: d.claims.map((c: Obj) => ({ id: c.id, text: c.text, status: c.status, source_ids: c.source_ids, used_in: c.used_in })) },
      report: d.verification ? { id: d.verification.id, result: { verdicts: d.claims.map((c: Obj) => ({ claim_id: c.id, verdict: c.verdict, reason: c.reason, opened_urls: c.opened_urls })) } } : null,
      sources: d.sources,
      checks: d.version.checks,
      material: d.version.material,
      autoReverified: 0,
      autoDerived: true,
    } as never);
    expect({ groups: d.triage.groups, ok_counts: d.triage.ok_counts }).toEqual(JSON.parse(JSON.stringify({ groups: t.groups, ok_counts: t.ok_counts })));
  });

  it.each(['attention', 'clean', 'pending', 'readerWait'])('%s: §V-6 b の形（counts・needs_review・gate と pending_on の決まり）', (name) => {
    const t = (FX as Obj)[name]().triage;
    const sev = (s: string) => t.items.filter((x: Obj) => x.severity === s).length;
    expect(t.counts.fix).toBe(sev('fix'));
    expect(t.counts.ask).toBe(sev('ask'));
    expect(t.counts.note).toBe(sev('note'));
    expect(t.needs_review).toBe(t.counts.fix + t.counts.ask);
    expect(Object.keys(t.auto).sort()).toEqual([...R.MK_KEYS].sort());
    expect(t.pending_on.length > 0).toBe(t.gate === 'pending');
    if (t.gate === 'clean') {
      expect(t.counts.fix + t.counts.ask).toBe(0);
      expect(t.reasons).toEqual([]);
      expect(Object.values(t.auto).every((x) => x === 'ok')).toBe(true);
    }
  });
});

describe('判定帯のゲートの印（§V-9 a 1.）', () => {
  const gate = (d: Obj) => {
    const h = R.reviewHtml(d, R.newReviewState(), {});
    const m = /<span class="pill rv-gate (\w+)" id="rv-gate" data-gate="(\w+)">([^<]*)<\/span>/.exec(h);
    return m ? [m[2], m[1], m[3]] : null;
  };
  it('clean = 緑「機械の確認: 全部通りました」/ attention = 橙「見てほしい所 N 件」/ pending = 灰', () => {
    expect(gate(FX.clean())).toEqual(['clean', 'green', '機械の確認: 全部通りました']);
    expect(gate(FX.attention())).toEqual(['attention', 'orange', '見てほしい所 6 件']);
    expect(gate(FX.pending())).toEqual(['pending', 'gray', '機械の確認中']);
  });
  it('pending の文は pending_on で変える: reader だけ →「読み手チェック待ち（待たずに公開もできます）」/ 検証 failed →「検証ができていません（再検証を押してください）」', () => {
    expect(gate(FX.readerWait())).toEqual(['pending', 'gray', '読み手チェック待ち（待たずに公開もできます）']);
    const f = FX.pending();
    f.version.verification_status = 'failed';
    expect(gate(f)).toEqual(['pending', 'gray', '検証ができていません（再検証を押してください）']);
    // 検証と読み手の両方が待ち → 機械の確認中
    const both = FX.pending();
    both.triage.pending_on = ['verification', 'reader'];
    expect(gate(both)?.[2]).toBe('機械の確認中');
  });
  it('triage に items が無い古い応答・triage の無い応答は「機械の確認中」の見た目（落ちない）', () => {
    const old = fixture();
    delete old.triage.items;
    delete old.triage.gate;
    delete old.triage.pending_on;
    expect(gate(old)).toEqual(['pending', 'gray', '機械の確認中']);
    expect(R.triageOf(old).pending_on).toEqual(['verification']);
    const none = fixture();
    delete none.triage;
    expect(gate(none)?.[0]).toBe('pending');
    expect(R.approveState(old, R.newReviewState())).toMatchObject({ enabled: false, text: '検証が終わるのを待つ' });
    const h = R.reviewHtml(old, R.newReviewState(), {});
    expect(n(h, /data-mk-state="pending"/g)).toBeGreaterThan(0);
  });
});

describe('見てほしい所（§V-9 a 2.）: 0 件 / N 件・カードの中身', () => {
  it('N 件: fix / ask の項目だけ（note は出さない）。番号・title・場所・detail・直し方の案・ボタン', () => {
    const d = fixture();
    const h = R.itemsHtml(d, R.newReviewState(), { locs: R.locateAll(d, R.newReviewState(), allMd(d)) });
    expect(h).toContain('<h2 class="rv-rail-h">見てほしい所（6）</h2>');
    expect(n(h, /data-item-id="/g)).toBe(6);
    expect(n(h, /data-sev="fix"/g)).toBe(4);
    expect(n(h, /data-sev="ask"/g)).toBe(2);
    expect(n(h, /data-state="open"/g)).toBe(6);
    expect(h).not.toContain('仮説として書いてある');
    expect(h).toContain('<p class="rv-it-where">小学生・短い 7 段落目</p>');
    expect(h).toContain('<p class="rv-it-where">中学生・長い にあります</p>');
    expect(h).toContain('<p class="rv-it-where">動かせるもの</p>');
    expect(h).toContain('<p class="rv-it-where">動画</p>');
    expect(h).toContain('直し方の案: 「いきを するときに すいこむ 空気の 中の 大切な もの」と一言そえる');
    expect(h).toContain('チャンネル「作り物の科学チャンネル」');
    // ask は「OK にする」だけ、fix は「このまま出す」「直してもらう」
    expect(n(h, /data-it-ok="/g)).toBe(6);
    expect(n(h, /data-it-redo="/g)).toBe(4);
    expect(h).toContain('>OK にする</button>');
    expect(h).toContain('>このまま出す</button>');
    // 場所の決まらない項目（利用条件が分からない出典）には「場所を見る」が無い
    expect(n(h, /data-it-goto="/g)).toBe(5);
    expect(h).not.toContain('data-it-goto="1"');
  });

  it('0 件: 全部通った版は「見てほしい所はありません。子どもの画面を見て、よければ公開してください。」', () => {
    const h = R.reviewHtml(FX.clean(), R.newReviewState(), {});
    expect(h).toContain('<div id="rv-items-none" class="rv-none"><p>見てほしい所はありません。子どもの画面を見て、よければ公開してください。</p></div>');
    expect(n(h, /data-item-id="/g)).toBe(0);
  });

  it('0 件で pending: verification あり →「機械の確認が終わるのを待っています」と検証の状態 / reader だけ →「読み手チェックを待っています。待たずに公開することもできます。」', () => {
    const p = R.reviewHtml(FX.pending(), R.newReviewState(), {});
    expect(p).toContain('<p class="rv-wait-t">機械の確認が終わるのを待っています</p>');
    expect(p).toContain('検証: 検証中');
    const r = R.reviewHtml(FX.readerWait(), R.newReviewState(), {});
    expect(r).toContain('<p class="rv-wait-t">読み手チェックを待っています。待たずに公開することもできます。</p>');
    expect(r).toContain('読み手チェック: 動いています');
  });

  it('blocking の項目には「このまま出す」が無い（「直してもらう」だけ）', () => {
    const d = fixture();
    const c6 = d.triage.items.find((x: Obj) => x.id === 'claim:c6');
    Object.assign(c6, { cause: 'contradicted', title: '出典と食い違う', blocking: true });
    const h = R.itemsHtml(d, R.newReviewState(), {});
    const card = h.slice(h.indexOf('id="rv-it-0"'), h.indexOf('id="rv-it-1"'));
    expect(card).not.toContain('data-it-ok=');
    expect(card).toContain('data-it-redo="0"');
    expect(card).toContain('このまま出すことはできません');
    // ok にしようとしても状態は変わらない
    const st = R.newReviewState();
    pick(d, st, 0, 'ok');
    expect(R.statesFor(st, d)['claim:c6']).toBeUndefined();
  });

  it('確認待ちでない版は読むだけ（フッター・項目のボタンなし。場所を見るは残る）', () => {
    const d = fixture();
    d.version.status = 'approved';
    const h = R.reviewHtml(d, R.newReviewState(), {});
    expect(h).not.toContain('id="rv-foot"');
    expect(h).not.toContain('data-it-ok=');
    expect(h).not.toContain('data-it-redo=');
    expect(h).toContain('data-it-goto=');
    expect(h).toContain('この版は確認待ちではありません（approved）');
  });

  it('読み手チェックが failed の時だけ「読み手チェックをやり直す」', () => {
    const d = fixture();
    expect(R.reviewHtml(d, R.newReviewState(), {})).not.toContain('id="rv-reread"');
    d.reader.status = 'failed';
    expect(R.reviewHtml(d, R.newReviewState(), {})).toContain('<button type="button" class="btn small" id="rv-reread">読み手チェックをやり直す</button>');
  });
});

describe('項目の状態と「公開する」（§V-9 c）', () => {
  const W = (s: string) => R.WHY_TEXT[s];
  it('open が残る間は「見てほしい所があと N 件（OK にするか、直してもらうを選ぶ）」。OK にするたびに N が減り、全部決めると「公開できます」', () => {
    const d = fixture();
    const st = R.newReviewState();
    expect(R.approveState(d, st)).toMatchObject({ enabled: false, text: '見てほしい所があと 6 件（OK にするか、直してもらうを選ぶ）' });
    pick(d, st, 0, 'ok');
    expect(R.approveState(d, st).text).toBe('見てほしい所があと 5 件（OK にするか、直してもらうを選ぶ）');
    expect(R.approveState(d, st).why[0].target).toBe('rv-it-1');
    const all = allOk(d);
    expect(R.approveState(d, all)).toMatchObject({ enabled: true, text: '公開できます', readerWait: false });
    expect(R.reviewHtml(d, all, {})).toContain('id="approve-btn">公開する');
    expect(R.reviewHtml(d, st, {})).toContain('id="approve-btn" disabled>公開する');
  });

  it('「直してもらう」にした所があると押せない（「『直してもらう』にした所があります（直してもらうを押してください）」）。押し直すと戻る', () => {
    const d = fixture();
    const st = allOk(d);
    pick(d, st, 0, 'redo');
    expect(R.approveState(d, st)).toMatchObject({ enabled: false, text: W('redo') });
    expect(R.approveState(d, st).why[0].target).toBe('return-btn');
    expect(R.reviewHtml(d, st, {})).toContain('class="btn is-suggest" id="return-btn"');
    pick(d, st, 0, 'redo');
    expect(R.statesFor(st, d)['claim:c6']).toBe('open');
    pick(d, st, 0, 'ok');
    expect(R.approveState(d, st).enabled).toBe(true);
    // ok も押し直すと open
    pick(d, st, 0, 'ok');
    expect(R.statesFor(st, d)['claim:c6']).toBe('open');
    // ask の項目は「直してもらう」にならない
    pick(d, st, 2, 'redo');
    expect(R.statesFor(st, d)['app:parts/p2/p2-app.html']).toBe('ok');
  });

  it('押せない理由の文（verbatim）: 確認待ちでない・検証待ち・食い違い・一次資料・自動の再検証・自動の差し戻し', () => {
    const d = FX.clean();
    const st = R.newReviewState();
    const why = (x: Obj) => R.approveState(x, st).why.map((w: Obj) => w.text);
    expect(why({ ...d, version: { ...d.version, status: 'approved' } })).toEqual(['確認待ちの版ではありません']);
    expect(why({ ...d, version: { ...d.version, verification_status: 'running' } })).toEqual(['検証が終わるのを待つ']);
    expect(why(FX.pending())).toEqual(['検証が終わるのを待つ']);
    const blk = (cause: string) => {
      const x = FX.clean();
      x.triage.items.push({ id: 'claim:c1', kind: 'claim', key: 'content_and_evidence', severity: 'fix', cause, title: 't', detail: '', blocking: true, claim_id: 'c1' });
      return why(x);
    };
    expect(blk('contradicted')).toEqual(['食い違いの主張がある（直してもらってください）', '見てほしい所があと 1 件（OK にするか、直してもらうを選ぶ）']);
    expect(blk('primary_source_unfetched')[0]).toBe('職人が開けていない一次資料がある（直してもらってください）');
    expect(why({ ...d, triage: { ...d.triage, action: 'reverify' } })).toEqual(['自動の再検証を待っています']);
    expect(why({ ...d, triage: { ...d.triage, action: 'auto_return' } })).toEqual(['自動の差し戻しを待っています']);
    expect(R.approveState(d, st)).toMatchObject({ enabled: true, text: '公開できます' });
  });

  it('読み手チェック待ち（pending_on が reader だけ）では止めない:「公開できます（読み手チェックはまだです）」・ボタンは押せる・ダイアログにも書く', () => {
    const d = FX.readerWait();
    const st = R.newReviewState();
    expect(R.approveState(d, st)).toMatchObject({ enabled: true, readerWait: true, text: '公開できます（読み手チェックはまだです）' });
    const h = R.reviewHtml(d, st, {});
    expect(h).toContain('id="approve-btn">公開する');
    expect(h).toContain('>公開できます（読み手チェックはまだです）</button>');
    expect(h).not.toContain('読み手チェックが終わるのを待つ');
    expect(R.approveDialogBody(d, st, R.approveState(d, st))).toBe('公開すると配信 API に出ます。\n読み手チェックはまだです');
  });

  it('状態は「検証の id + 読み手係の世代」に結び付く: どちらかが変わると全部 open に戻る', () => {
    const d = fixture();
    const st = allOk(d);
    expect(R.approveState(d, st).enabled).toBe(true);
    const reverified = { ...d, verification_id: 'verfix-0002' };
    expect(R.approveState(reverified, st).text).toBe('見てほしい所があと 6 件（OK にするか、直してもらうを選ぶ）');
    const reread = { ...d, reader: { ...d.reader, gen: 'rd-fix-0002' } };
    expect(R.approveState(reread, st).enabled).toBe(false);
    R.syncItemGen(st, reread);
    expect(Object.keys(R.statesFor(st, reread))).toEqual([]);
    expect(R.approveState(d, st).enabled).toBe(false); // 古い OK は戻らない
  });
});

describe('送信の payload（§V-9 c・§V-7 e）', () => {
  it('approve: checklist は auto が ok でない項目だけ（note「見てほしい所を確認」）・trust_channels = ok にした初めてのチャンネル・reader_gen', () => {
    const d = fixture();
    const st = allOk(d);
    const p = R.decisionPayload(d, st, 'approve');
    expect(p).toEqual({
      decision: 'approve',
      checklist: {
        content_and_evidence: { result: 'ok', note: '見てほしい所を確認' },
        explanation_and_expression: { result: 'ok', note: '見てほしい所を確認' },
        artifact_behavior: { result: 'ok', note: '見てほしい所を確認' },
        terms_of_use: { result: 'ok', note: '見てほしい所を確認' },
      },
      note: '',
      verification_id: 'verfix-0001',
      trust_channels: ['https://www.youtube.com/@fixture-science'],
      reader_gen: 'rd-fix-0001',
    });
    expect(R.approveDialogBody(d, st, R.approveState(d, st))).toBe('公開すると配信 API に出ます。\n見てほしい所 6 件を OK にしました\nチャンネル『作り物の科学チャンネル』を確認済みにします');
    // チャンネルの項目を戻すと trust_channels から外れる
    pick(d, st, 4, 'ok');
    expect(R.decisionPayload(d, st, 'approve').trust_channels).toEqual([]);
  });

  it('全部通った版は checklist が空・trust_channels も空', () => {
    const d = FX.clean();
    expect(R.decisionPayload(d, R.newReviewState(), 'approve')).toMatchObject({ checklist: {}, trust_channels: [], reader_gen: 'rd-clean-0001' });
  });

  it('読み手チェック待ち: review のままの 3 項目は「読み手チェックなしで見た」', () => {
    const p = R.decisionPayload(FX.readerWait(), R.newReviewState(), 'approve');
    expect(p.checklist).toEqual({
      explanation_and_expression: { result: 'ok', note: '読み手チェックなしで見た' },
      relation_to_learning: { result: 'ok', note: '読み手チェックなしで見た' },
      conditions_of_use: { result: 'ok', note: '読み手チェックなしで見た' },
    });
    expect(p.reader_gen).toBe('rd-wait-0001');
  });

  it('return / reject は checklist を送らない（null）・trust_channels / reader_gen を付けない・return は注文票への追記', () => {
    const d = fixture();
    const st = { ...R.newReviewState(), note: '直して', append: '追記' };
    expect(R.decisionPayload(d, st, 'return')).toEqual({ decision: 'return', checklist: null, note: '直して', verification_id: 'verfix-0001', brief_append: '追記' });
    expect(R.decisionPayload(d, st, 'reject')).toEqual({ decision: 'reject', checklist: null, note: '直して', verification_id: 'verfix-0001' });
  });

  it('エラーの時の画面: 409 stale_reader / stale_verification / conflict と 400 checks_pending は読み直す・400 channel_trust_required は項目へ', () => {
    for (const c of ['stale_reader', 'stale_verification', 'conflict', 'checks_pending']) expect(R.decisionErrorAction(c)).toBe('reload');
    expect(R.decisionErrorAction('channel_trust_required')).toBe('channel');
    expect(R.decisionErrorAction('has_contradicted_claims')).toBe('stay');
    expect(code).toContain("channel_trust_required: '初めてのチャンネルを確かめてから公開してください'");
    expect(code).toContain("checks_pending: '機械の確認が終わってから公開してください'");
    expect(code).toContain("stale_reader: '読み手チェックが新しくなりました。画面を読み直します'");
    expect(code).toContain("reader_running: '読み手チェックが動いています'");
  });

  it('「直してもらう」の理由の行: `- {title}{（場所）}: {detail}`（1 回だけ。detail が空なら「: 」なし）', () => {
    const d = fixture();
    const st = R.newReviewState();
    pick(d, st, 0, 'redo');
    pick(d, st, 5, 'redo');
    const locs = R.locateAll(d, st, allMd(d));
    expect(R.redoLines(d, st, locs).map((x: Obj) => x.line)).toEqual([
      '- 出典が付いていない（小学生・短い 7 段落目）',
      '- 言葉がむずかしい（小学生・短い 2 段落目）: 小学 3 年生には「酸素」が何かの説明がないため、赤血球が何を運んでいるのか分からない',
    ]);
    st.redoFlowed = ['claim:c6'];
    expect(R.redoLines(d, st, locs).map((x: Obj) => x.id)).toEqual(['reader:p1es-word-1']);
    const r = R.appendLines('理由', ['- a', '- b']);
    expect(r).toEqual({ note: '理由\n- a\n- b', added: 2, lines: ['- a', '- b'] });
  });
});

describe('キー（§V-9 c）: A / R / X / J / K / N / P / O / ?。1〜3 はやめる', () => {
  const env = { inInput: false, dialogOpen: false, busy: false, draft: false };
  const key = (k: string, extra: Obj = {}) => R.keyCommand({ key: k, code: /^\d$/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, ...extra }, env);
  it('命令の対応', () => {
    expect(key('a')).toEqual({ cmd: 'approve' });
    expect(key('r')).toEqual({ cmd: 'return' });
    expect(key('x')).toEqual({ cmd: 'reject' });
    expect(key('j')).toEqual({ cmd: 'nav', dir: 1 });
    expect(key('n')).toEqual({ cmd: 'item_step', dir: 1 });
    expect(key('p')).toEqual({ cmd: 'item_step', dir: -1 });
    expect(key('o')).toEqual({ cmd: 'item_ok' });
    expect(R.keyCommand({ key: '?', code: 'Slash', shiftKey: true }, env)).toEqual({ cmd: 'help' });
    for (const k of ['1', '2', '3']) expect(key(k)).toBe(null);
    expect(key('1', { shiftKey: true })).toBe(null);
    expect(key('o', { repeat: true })).toBe(null);
    expect(R.keyCommand({ key: 'n', code: 'KeyN' }, { ...env, inInput: true })).toBe(null);
  });
  it('N / P で項目を選び（一周する）、O で OK（blocking には効かない）', () => {
    const d = fixture();
    const st = R.newReviewState();
    R.applyCommand(st, { cmd: 'item_ok' }, d);
    expect(Object.keys(R.statesFor(st, d))).toEqual([]); // 選ぶ前の O は何もしない
    R.applyCommand(st, { cmd: 'item_step', dir: 1 }, d);
    expect(st.cursor).toBe(0);
    R.applyCommand(st, { cmd: 'item_step', dir: -1 }, d);
    expect(st.cursor).toBe(5);
    R.applyCommand(st, { cmd: 'item_step', dir: 1 }, d);
    expect(st.cursor).toBe(0);
    R.applyCommand(st, { cmd: 'item_ok' }, d);
    expect(R.statesFor(st, d)['claim:c6']).toBe('ok');
    expect(R.itemsHtml(d, st, {})).toContain('class="rv-it sev-fix is-ok is-cur" id="rv-it-0"');
    d.triage.items.find((x: Obj) => x.id === 'source:s4:license').blocking = true;
    R.applyCommand(st, { cmd: 'item_step', dir: 1 }, d);
    R.applyCommand(st, { cmd: 'item_ok' }, d);
    expect(R.statesFor(st, d)['source:s4:license']).toBeUndefined();
  });
});

describe('子どもの画面（§V-9 b）: 記法・さわってみよう・印', () => {
  const d = fixture();
  const p1 = d.version.material.parts[0];
  const p2 = d.version.material.parts[1];
  const o = (x: Obj = {}) => ({ fileBase: BASE, marks: true, stick: true, pins: R.pinsOf(d, R.newReviewState()), claimIdx: idx(d), frame: 0, pi: 0, path: 'parts/p1/p1-elementary-short.md', ...x });

  it('太字（**…**）と番号つきの一覧（1. ）が出る。対にならない ** はそのまま。コードの中は太字にしない', () => {
    const h = R.previewBodyHtml(md('parts/p2/p2-elementary-short.md'), p2, o({ pi: 1, path: 'parts/p2/p2-elementary-short.md' }));
    expect(h).toContain('<strong>スライダー</strong>を 動かして');
    expect(n(h, /<ol class="mp-ol">/g)).toBe(1);
    expect(n(h, /<ol class="mp-ol">[\s\S]*?<\/ol>/g)).toBe(1);
    expect((/<ol class="mp-ol">([\s\S]*?)<\/ol>/.exec(h) || [''])[0].match(/<li /g)?.length).toBe(3);
    expect(R.inlineMd('**a** と `**b**` と **c', { bold: true })).toBe('<strong>a</strong> と <code>**b**</code> と **c');
    expect(R.inlineMd('**a**')).toBe('**a**'); // ほかの画面の md は今までどおり
    expect(R.mdBlocks('3. a\n4. b\n- c')).toEqual([{ t: 'ol', start: 3, items: ['a', 'b'] }, { t: 'ul', items: ['c'] }]);
    expect(R.previewBodyHtml('3. a', p1, o())).toContain('<ol class="mp-ol" start="3">');
  });

  it('動かせるもの（iframe）の上に子どもに見える見出し「さわってみよう」。sandbox は allow-scripts だけ（印 OFF でも出る）', () => {
    for (const marks of [true, false]) {
      const h = R.previewBodyHtml(md('parts/p2/p2-elementary-short.md'), p2, o({ pi: 1, marks, path: 'parts/p2/p2-elementary-short.md' }));
      expect(h).toContain('<p class="mp-app-cap">さわってみよう</p>');
      expect(h).toMatch(/<div class="mp-app[^"]*"[^>]*><p class="mp-app-cap">さわってみよう<\/p>(<span class="mp-pins">[\s\S]*?<\/span>)?<iframe class="mp-app-frame" sandbox="allow-scripts" title="動かせるもの" src="\/api\/review\/vfix-0001\/files\/parts\/p2\/p2-app.html"><\/iframe><\/div>/);
      expect(h.indexOf('mp-app-cap')).toBeLessThan(h.indexOf('data-para="0"'));
      expect(h).not.toContain('allow-same-origin');
    }
  });

  it('印 ON: 見てほしい所の段落・部品に番号の印（押すと一覧の項目へ）、note の主張の段落に点線と札', () => {
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    // 主張 c6（出典が付いていない = 1 番）・読み手係の quote（6 番）・動画のチャンネル（5 番）
    expect(h).toContain('<button type="button" class="mp-pin is-open" data-pin-goto="claim:c6" aria-label="見てほしい所 1（まだ決めていません）">1</button>');
    expect(h).toContain('data-pin-goto="reader:p1es-word-1"');
    expect(h).toMatch(/<div class="mp-video has-pin" data-media="video" data-media-key="v1" data-pin="5">/);
    expect(h).toMatch(/class="mp-para has-pin" id="mp-p-0-0-6" data-para="6"[^>]*data-pin="1"/);
    expect(h).toContain('<span class="mp-note-tag">仮説として書いてある</span>');
    expect(h).toContain('<span class="mp-note-tag">たとえ</span>');
    expect(n(h, /class="mp-para is-note"/g)).toBe(2);
    // 主張 id・出典 id は子どもの画面に出さない（補足の中だけ）
    expect(h).not.toMatch(/\[c\d|c5 →|mp-cite/);
    // 図（検証係が ok）には印が付かない
    expect(h).toMatch(/<figure class="mp-fig" data-media="figure"/);
  });

  it('項目を ok にしたら丸は緑のチェック、redo にしたら「直」', () => {
    const st = R.newReviewState();
    pick(d, st, 0, 'ok');
    pick(d, st, 5, 'redo');
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o({ pins: R.pinsOf(d, st) }));
    expect(h).toContain('class="mp-pin is-ok" data-pin-goto="claim:c6" aria-label="見てほしい所 1（OK にしました）">✓</button>');
    expect(h).toContain('class="mp-pin is-redo" data-pin-goto="reader:p1es-word-1" aria-label="見てほしい所 6（直してもらう）">直</button>');
    expect(h).toContain('class="mp-para has-pin pin-ok"');
  });

  it('印 OFF: 番号の印・点線・札・付箋のボタンを全部消す（子どもが見るのと同じ見た目）', () => {
    const on = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    const off = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o({ marks: false }));
    for (const x of ['mp-pin', 'data-pin', 'has-pin', 'is-note', 'mp-note-tag', 'data-stick-open']) {
      expect(on).toContain(x);
      expect(off).not.toContain(x);
    }
    expect(n(off, /data-para="/g)).toBe(7);
    const frame = R.previewFrameHtml(d, R.defaultPv(), 0, { marks: false, pins: R.pinsOf(d, R.newReviewState()) });
    expect(frame).not.toContain('mp-pin');
    expect(R.reviewHtml(d, R.newReviewState(), { marks: false })).toContain('data-mp-marks="1" aria-pressed="false"');
  });

  it('material.json の項目は枠の頭（要約・最初にやること・部品の題名）で quote を含む要素に印', () => {
    const x = fixture();
    x.triage.items.push({ id: 'reader:mj-1', kind: 'reader', key: 'explanation_and_expression', severity: 'fix', cause: 'word', title: '言葉がむずかしい', detail: '', path: 'material.json', quote: '赤い 丸を 数えてみよう' });
    const f = R.previewFrameHtml(x, R.defaultPv(), 0, { marks: true, pins: R.pinsOf(x, R.newReviewState()) });
    expect(f).toMatch(/<div class="mp-entry has-pin" data-head-k="entry" data-pin="7"><span class="mp-pins"><button[^>]*data-pin-goto="reader:mj-1"/);
    expect(R.locateItem(x.triage.items.at(-1), x, {}, [R.defaultPv()])).toMatchObject({ t: 'head', label: '要約・最初にやること' });
  });
});

describe('項目の場所（§V-9 b）', () => {
  const d = fixture();
  const items = R.triageOf(d).shown;
  const frames = [R.defaultPv()];
  it('主張 = その主張の印が付いた段落（表示中の変奏を先に）/ 変奏の quote = その段落 / 部品 = 図・動かせるもの・動画 / 表示中に無い = 「… にあります」', () => {
    const m = allMd(d);
    expect(R.locateItem(items[0], d, m, frames)).toMatchObject({ t: 'para', pi: 0, path: 'parts/p1/p1-elementary-short.md', para: 6, inView: true, label: '小学生・短い 7 段落目' });
    expect(R.locateItem(items[1], d, m, frames)).toBe(null); // 出典の利用条件は場所が決まらない
    expect(R.locateItem(items[2], d, m, frames)).toMatchObject({ t: 'media', media: 'app', label: '動かせるもの' });
    expect(R.locateItem(items[3], d, m, frames)).toMatchObject({ t: 'para', path: 'parts/p2/p2-secondary-long.md', para: 0, inView: false, label: '中学生・長い にあります', sel: { aud: 'secondary', len: 'long', game: false } });
    expect(R.locateItem(items[4], d, m, frames)).toMatchObject({ t: 'media', media: 'video', key: 'v1', label: '動画' });
    expect(R.locateItem(items[5], d, m, frames)).toMatchObject({ para: 1, label: '小学生・短い 2 段落目' });
    // 中学生・長いを表示している時は、同じ項目がその場所に
    expect(R.locateItem(items[3], d, m, [{ aud: 'secondary', len: 'long', game: false }])).toMatchObject({ inView: true, label: '中学生・長い 1 段落目' });
    // 本文を読む前は、主張の場所は出さない（quote の項目は変奏の名前だけ）
    expect(R.locateItem(items[0], d, null, frames)).toBe(null);
    expect(R.locateItem(items[5], d, null, frames)).toMatchObject({ para: -1, label: '小学生・短い' });
  });
});

describe('機械が確かめたこと（§V-9 a 2.）', () => {
  it('6 項目を 1 行ずつ（ok / review / pending）。要約の文', () => {
    const h = R.machineHtml(fixture());
    expect(n(h, /data-mk="/g)).toBe(6);
    expect(h).toContain('data-mk="content_and_evidence" data-mk-state="review"');
    expect(h).toContain('data-mk="relation_to_learning" data-mk-state="ok"');
    expect(h).toContain('主張 7 件: 確か 5・仮説として書いてある 1・たとえ 1');
    expect(h).toContain('読み手チェック: 直す所 1・気づき 1');
    expect(h).toContain('図 1 枚: 問題なし 1');
    expect(h).toContain('動画 1 本: 問題なし 1');
    expect(h).toContain('動かせるもの 1 個: 問題なし 0');
    expect(h).toContain('出典 6 件・動画のチャンネル: 初めて');
    expect(h).toContain('data-open-sources="1">根拠と出典を開く →</button>');
    // 使う条件の補足に material の conditions
    expect(h).toContain('<dt>道具</dt><dd>ブラウザ</dd>');
    expect(h).toContain('<dt>対象</dt><dd>小学生、中学生</dd>');
    expect(h).toContain('<dt>サポーターの見守り</dt><dd>不要</dd>');
    expect(R.machineHtml(FX.clean())).toContain('動画のチャンネル: 確認済み');
    expect(n(R.machineHtml(FX.clean()), /data-mk-state="ok"/g)).toBe(6);
  });

  it('pending は gate が pending で、その項目の前提（§V-6 d）がまだ成り立っていない時', () => {
    expect(R.machineStates(FX.readerWait())).toEqual({
      content_and_evidence: 'ok', explanation_and_expression: 'pending', relation_to_learning: 'pending', conditions_of_use: 'pending', artifact_behavior: 'ok', terms_of_use: 'ok',
    });
    expect(R.machineStates(FX.pending())).toEqual({
      content_and_evidence: 'pending', explanation_and_expression: 'pending', relation_to_learning: 'ok', conditions_of_use: 'ok', artifact_behavior: 'pending', terms_of_use: 'pending',
    });
  });

  it('今あるテストが数える DOM（図のサムネイル・判定・動画・たとえのずれ・利用条件の動画）は補足の中に出し続ける', () => {
    const d = fixture();
    d.verification.analogy_gaps = [{ claim_id: 'c5', where: 'p1', analogy: 'トラック', same: '運ぶ', differs: '燃料' }];
    const h = R.reviewHtml(d, R.newReviewState(), {});
    expect(n(h, /class="thumb"/g)).toBe(1);
    expect(n(h, /data-fig-verdict="/g)).toBe(1);
    expect(n(h, /data-videos="1"/g)).toBe(1);
    expect(n(h, /data-video="v1"/g)).toBe(1);
    expect(n(h, /data-video-notes="1"/g)).toBe(1);
    expect(n(h, /data-video-verdict="1"/g)).toBe(1);
    expect(n(h, /data-video-meta="ok"/g)).toBe(1);
    expect(n(h, /data-video-terms="1"/g)).toBe(1);
    expect(n(h, /data-analogy-gaps="1"/g)).toBe(1);
    const mk = (k: string) => h.indexOf(`data-mk="${k}"`);
    expect(h.indexOf('data-videos=')).toBeGreaterThan(mk('explanation_and_expression'));
    expect(h.indexOf('data-videos=')).toBeLessThan(mk('relation_to_learning'));
    expect(h.indexOf('data-video-terms=')).toBeGreaterThan(mk('terms_of_use'));
    expect(h).toContain('初めてのチャンネル</span>');
  });

  it('画面に内部の言葉（fix / ask / note・gate・triage・cause のコード）を出さない（属性と補足の表・機械検査の JSON は除く）', () => {
    const h = R.reviewHtml(fixture(), R.newReviewState(), {});
    const visible = h
      .slice(0, h.indexOf('id="rv-sup"'))
      .replace(/<[^>]*>/g, ' ');
    for (const w of ['fix', 'ask', 'triage', 'gate', 'no_source', 'license_unknown', 'video_channel_new', 'app_unclear', 'claim:', 'c6', 's4']) expect(visible).not.toContain(w);
  });
});

describe('並び（§V-9 a）: 判定帯 → 舞台（子どもの画面 → 右の一覧）→ 補足（畳んだ details）→ 固定フッター', () => {
  const h = R.reviewHtml(fixture(), R.newReviewState(), { queue: ['vfix-0001', 'vclean-0001'] });
  it('DOM の順と id', () => {
    const at = (s: string) => h.indexOf(s);
    const order = ['id="rv-band"', 'id="rv-stage"', 'id="rv-body"', 'id="mp-bar"', 'data-mp-marks', 'id="mp-frames"', 'id="rv-rail"', 'id="rv-items"', 'id="rv-machine"', 'id="mp-stickies"', 'id="rv-sup"', 'id="rv-sources"', 'id="rv-ok"', 'id="rv-detail"', 'id="rv-foot"', 'id="approve-why"', 'id="reject-btn"', 'id="return-btn"', 'id="approve-btn"'];
    order.forEach((s) => expect(at(s), s).toBeGreaterThan(-1));
    for (let i = 1; i < order.length; i++) expect(at(order[i]), order[i]).toBeGreaterThan(at(order[i - 1]));
    expect(h).toContain('<span class="muted">1 / 2</span>');
    expect(h).toContain('<details class="card rv-sec" id="rv-sources-sec"><summary><h2>根拠と出典（出典カード）</h2></summary>');
    expect(h).not.toMatch(/<details[^>]*id="rv-(sources-sec|ok|detail)"[^>]* open/);
    expect(h).toContain('却下する <span class="kbd">X</span>');
    expect(h).toContain('直してもらう <span class="kbd">R</span>');
    expect(h).toContain('公開する <span class="kbd">A</span>');
    expect(n(h, /class="mat-preview"/g)).toBe(1);
  });
  it('見比べ: 枠が 2 つ・右の枠に自分の切り替え（見比べのボタンは左だけ）', () => {
    const st = R.newReviewState();
    st.pv.compare = true;
    const c = R.reviewHtml(fixture(), st, {});
    expect(n(c, /class="mat-preview"/g)).toBe(2);
    expect(c).toContain('class="rv-stage is-compare"');
    expect(c).toContain('class="mp-frames is-compare"');
    expect(c).toContain('data-pv="aud" data-val="secondary" data-pvf="1" aria-pressed="true">中学生</button>');
    expect(n(c, /data-pv="compare"/g)).toBe(1);
  });
});

describe('一覧（§V-9 d）: 判断の数・自動公開のスイッチ・3 区画', () => {
  it('3 区画（空の区画は出さない）・列（見てほしい所・機械の確認 n / 6）', () => {
    const h = R.reviewListHtml({ versions: FX.listRows() });
    expect(n(h, /data-rl-sec="/g)).toBe(3);
    expect(h.indexOf('data-rl-sec="attention"')).toBeLessThan(h.indexOf('data-rl-sec="clean"'));
    expect(h.indexOf('data-rl-sec="clean"')).toBeLessThan(h.indexOf('data-rl-sec="pending"'));
    expect(h).toContain('<h2>全部通った（子どもの画面を見て公開するだけ）');
    expect(n(h, /tr data-rl-row="1"/g)).toBe(4);
    expect(h).toContain('<th>見てほしい所</th><th>機械の確認</th>');
    expect(h).toContain('<span class="pill orange">6 件</span>');
    expect(h).toContain('3 / 6');
    expect(h).toContain('読み手チェック待ち');
    const onlyClean = R.reviewListHtml({ versions: FX.listRows().filter((r: Obj) => r.gate === 'clean') });
    expect(n(onlyClean, /data-rl-sec="/g)).toBe(1);
    // gate の無い古い行は「機械の確認中」
    expect(R.reviewListHtml({ versions: [{ version_id: 'x', title: 't', version: 1, needs_review: 2, auto_ok: 1 }] })).toContain('data-rl-sec="pending"');
    expect(R.reviewListHtml({ versions: [] })).toContain('確認待ちの版はありません。');
  });
  it('判断の数の文とスイッチ（aria-pressed・ON の間は自動で公開した数）。0 本は「まだありません」', () => {
    const on = R.rlStatsHtml({ auto_publish: true, clean: { approve: 12, return: 1, reject: 0 }, streak: 9, auto_published: 3 });
    expect(on).toContain('機械が『全部通った』とした教材で、ふじさんの判断は 公開 12 本・直してもらう 1 本・却下 0 本（直近 9 本つづけて公開）');
    expect(on).toContain('id="rl-autopub" aria-pressed="true"');
    expect(on).toContain('全部通った教材は自動で公開する');
    expect(on).toContain('自動で公開した教材 3 本');
    const off = R.rlStatsHtml({ auto_publish: false, clean: { approve: 0, return: 0, reject: 0 }, streak: 0, auto_published: 0 });
    expect(off).toContain('ふじさんの判断は まだありません');
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain('自動で公開した教材');
    expect(R.rlStatsHtml({ auto_publish: false }, true)).toContain('id="rl-autopub" aria-pressed="false" disabled');
    expect(R.rlStatsHtml('x')).toContain('id="rl-stats-retry"');
    expect(code).toContain("'機械の確認が全部通った教材を、人を通さずに公開します。見てほしい所がある教材は、これまでどおり確認待ちに出ます。'");
  });
  it('確認済みのチャンネルの一覧（チャンネル名・URL・確かめた日・外す）。値はエスケープ', () => {
    const h = R.channelsHtml({ channels: [{ channel_key: 'https://www.youtube.com/@a', channel_name: '<b>A</b>', channel_url: 'https://www.youtube.com/@a', created_at: '2026-11-05T09:00:00Z' }, { channel_key: 'javascript:x', channel_name: 'B', channel_url: 'javascript:x', created_at: null }] });
    expect(n(h, /data-channel-key="/g)).toBe(2);
    expect(h).toContain('<a href="https://www.youtube.com/@a" rel="noopener noreferrer" target="_blank">&lt;b&gt;A&lt;/b&gt;</a>');
    expect(h).not.toContain('href="javascript:');
    expect(h).toContain('確かめた日 2026/11/5');
    expect(n(h, /data-channel-del="/g)).toBe(2);
    expect(R.channelsHtml({ channels: [] })).toContain('確認済みのチャンネルはまだありません。');
    expect(R.channelsHtml(null)).toContain('読み込み中…');
    expect(R.channelsHtml('404')).toContain('id="vc-retry"');
  });
});

describe('出典カード（補足の「根拠と出典」）: 並び順・主張の逆引き・状態文', () => {
  it('問題のある順（引用不一致 → 開けていない → 利用条件不明 → 問題なし → 二次）。同じ順位は出典一覧の順', () => {
    const m = R.sourceCardsOf(fixture());
    expect(m.cards.map((c: Obj) => c.source.source_id)).toEqual(['s2', 's6', 's4', 's1', 's5', 's3']);
    expect(m.cards.map((c: Obj) => c.head.text)).toEqual([
      '引用が本文と一致しません',
      '職人がこのページを開けていません',
      '利用条件が分かりません',
      '問題なし',
      '問題なし',
      '補助の出典（一次ではない）',
    ]);
    expect(m.total).toBe(6);
    expect(m.problems).toBe(3);
  });

  it('食い違いの主張は先頭。開けていないページの引用不一致は見出しを「開けていない」にまとめる。動画の出典は検査しない', () => {
    const d = fixture();
    d.triage.groups.push({ cause: 'contradicted', source_id: 's2', url: d.sources[1].url, verifier_opened_urls: [], claim_ids: ['c5'] });
    const m = R.sourceCardsOf(d);
    const by = (sid: string) => m.cards.find((c: Obj) => c.source.source_id === sid);
    expect(by('s2').issues).toEqual(['contradicted', 'quote_mismatch']);
    expect(m.cards[0].head.text).toBe('出典と食い違う主張があります');
    expect(by('s6').issues).toEqual(['maker_url_not_fetched']);
    expect(by('s5').video).toBe(true);
    expect(by('s5').issues).toEqual([]);
    expect(by('s2').opened).toEqual(['https://example.org/cells/nucleus-overview']);
  });

  it('主張の逆引き: 出典 id → 参照している主張（複数の出典を持つ主張は両方に出る）', () => {
    const by = R.claimsBySource(fixture().claims);
    expect(by.s1.map((c: Obj) => c.id)).toEqual(['c1', 'c3', 'c7']);
    expect(by.s3.map((c: Obj) => c.id)).toEqual(['c3']);
    expect('s5' in by).toBe(false);
    expect(Object.keys(R.claimsBySource([null, { id: 'x', source_ids: 's1' }, { id: 'y', source_ids: [1, 's2'] }]))).toEqual(['s2']);
  });

  it('出典の無い主張・一覧に無い出典を参照する主張は orphans', () => {
    const d = fixture();
    d.claims.find((c: Obj) => c.id === 'c7').source_ids = ['s9'];
    expect(R.sourceCardsOf(d).orphans.map((o: Obj) => [o.claim.id, o.why, o.missing])).toEqual([
      ['c6', 'no_source', []],
      ['c7', 'source_not_listed', ['s9']],
    ]);
  });

  it('groups の無い応答は出典の列と主張の判定から（同じ順）', () => {
    const d = fixture();
    delete d.triage;
    expect(R.sourceCardsOf(d).cards.map((c: Obj) => c.source.source_id)).toEqual(['s2', 's6', 's4', 's1', 's5', 's3']);
  });

  it('取得日と短い URL', () => {
    expect(R.accessedText('2026-11-04')).toBe('11/4 に取得');
    expect(R.accessedText('2026-11-04T10:00:00Z')).toBe('11/4 に取得');
    expect(R.accessedText('きのう')).toBe('きのう に取得');
    expect(R.accessedText(null)).toBe('');
    expect(R.shortUrl('https://www.example.org/')).toBe('example.org');
    expect(R.shortUrl('https://example.org/cells/nucleus-and-oxygen-capacity-of-mammalian-erythrocytes')).toBe('example.org/cells/nucleus-and-oxygen-capacity-of-ma…');
  });
});

describe('出典カードの HTML（補足の中）', () => {
  const h = R.reviewHtml(fixture(), R.newReviewState(), {});
  const panel = h.slice(h.indexOf('id="rv-sources"'), h.indexOf('id="rv-ok"'));

  it('「出典 M 件のうち 問題 K 件」・カードは出典の数 + 出典のない主張の 1 枚', () => {
    expect(panel).toContain('出典 6 件のうち 問題 3 件');
    expect(n(panel, /data-src-card="/g)).toBe(6);
    expect(n(panel, /data-src-orphan="1"/g)).toBe(1);
    expect(panel).toContain('出典のない主張が 1 件あります');
  });

  it('「問題なし」の中には問題の無い出典だけ', () => {
    const ok = panel.slice(panel.indexOf('id="rv-src-ok"'));
    expect(ok).toContain('問題なし（出典 3 件。うち補助の出典 1 件）');
    expect(n(ok, /data-src-card="/g)).toBe(3);
    for (const bad of ['引用が本文と一致しません', '職人がこのページを開けていません', '利用条件が分かりません', '出典のない主張']) expect(ok).not.toContain(bad);
    expect(h).toContain('主張と出典の一覧（全件・照合の記録。主張 7 件・出典 6 件）');
  });

  it('引用の本文・引用不一致の赤枠・取得日・一次/二次・利用条件「分からない」', () => {
    expect(panel).toContain('<blockquote class="sc-quote is-bad">哺乳類の赤血球は核を持たないため、酸素の運搬量が増える。</blockquote>');
    expect(panel).toContain('職人が開いたページの本文に、この引用は見つかりませんでした');
    expect(panel).toContain('職人がこのページを開けていないため、引用を照らし合わせられていません');
    expect(panel).toContain('<blockquote class="sc-quote">赤血球は肺で受け取った酸素を全身へ運ぶ。</blockquote>');
    expect(panel).toContain('動画の出典のため、引用はありません');
    expect(panel).toContain('11/4 に取得');
    expect(n(panel, /<span class="sc-tag">二次<\/span>/g)).toBe(1);
    expect(panel).toContain('<span class="sc-lic-bad">分からない</span>');
    expect(panel).toContain('検証係が開いた URL（職人の URL と違います）');
  });

  it('生の英語コード（check_detail）は「照合の記録」の中だけ', () => {
    const head = panel.replace(/<details class="sc-log">[\s\S]*?<\/details>/g, '');
    for (const codeName of ['quote_not_found', 'not_fetched', 'no_excerpt', 'secondary']) expect(head).not.toContain(codeName);
    expect(panel).toContain('<code>quote_not_found</code>');
  });

  it('出典カードの主張 id は本文の段落へ（data-goto-claim = 主張の番号）', () => {
    expect(h).toContain('<button type="button" class="linkish sc-cid" data-goto-claim="4" title="本文のこの主張の段落へ">c5</button>');
  });

  it('文字はすべてエスケープ・リンクは http(s) だけ', () => {
    const d = fixture();
    d.sources[0].title = '<b>x</b>';
    d.sources[0].quoted_excerpt = '<script>alert(1)</script>';
    d.sources[1].url = 'javascript:alert(1)';
    d.claims[0].text = '<img src=x onerror=alert(1)>';
    d.triage.items[2].title = '<i>t</i>';
    d.triage.items[2].detail = '<img src=y>';
    d.reader.findings[1].note = '<u>n</u>';
    const p = R.reviewHtml(d, R.newReviewState(), {});
    for (const x of ['<b>x</b>', '<script>alert(1)</script>', '<img src=x', '<img src=y', '<i>t</i>', '<u>n</u>', 'href="javascript:']) expect(p).not.toContain(x);
  });
});

describe('教材プレビュー: [cN] は教材として見る時は出さない（inlineMd の中で外す）', () => {
  it('opts.cites を渡すと参照を外して id を集める。渡さなければ今までどおり', () => {
    const cites: string[] = [];
    expect(R.inlineMd('さんそを はこぶ。[c1, c3] つぶ [c2]', { cites, known: {} })).toBe('さんそを はこぶ。 つぶ');
    expect(cites).toEqual(['c1', 'c3', 'c2']);
    expect(R.inlineMd('はこぶ [c1]')).toBe('はこぶ [c1]');
  });

  it('リンクの記法・コードの中・主張 id でない括弧は残す。known にある id（c 以外の形）も外す', () => {
    const cites: string[] = [];
    expect(R.inlineMd('[c1](https://example.org/a) と `[c2]` と [注] と [claim-a]', { cites, known: { 'claim-a': 0 } })).toBe(
      '<a href="https://example.org/a" rel="noopener noreferrer" target="_blank">c1</a> と <code>[c2]</code> と [注] と',
    );
    expect(cites).toEqual(['claim-a']);
  });

  it('エスケープした後に外す（参照の中の記号でタグを作れない）', () => {
    expect(R.inlineMd('<b>x</b> [c1]', { cites: [], known: {} })).toBe('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('教材プレビュー: 本文（previewBodyHtml）', () => {
  const d = fixture();
  const p1 = d.version.material.parts[0];
  const o = (x: Obj = {}) => ({ fileBase: BASE, marks: true, stick: true, claimIdx: idx(d), frame: 0, pi: 0, ...x });

  it('本文に [c1] 等が出ない（印 OFF でも ON でも）', () => {
    for (const marks of [false, true]) expect(R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o({ marks }))).not.toMatch(/\[c\d/);
  });

  it('図と動画は先頭の段落の直後（2 つ目の段落より前）', () => {
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    const fig = h.indexOf('<img alt="図" src="/api/review/vfix-0001/files/parts/p1/p1-figure-1.svg">');
    const first = h.indexOf('data-para="0"');
    const second = h.indexOf('data-para="1"');
    expect(fig).toBeGreaterThan(first);
    expect(fig).toBeLessThan(second);
    const vid = h.indexOf('<iframe src="https://www.youtube-nocookie.com/embed/abcdefghijk?start=30&amp;end=95&amp;rel=0"');
    expect(vid).toBeGreaterThan(fig);
    expect(vid).toBeLessThan(second);
    expect(h).toContain('見どころ</span>細い血管の中を');
    expect(h).not.toContain('youtube.com/embed');
  });

  it('型 4 以外の app.html は図と同じ位置。図の無い md（段落なし）でも図を出す', () => {
    const part = { ...p1, kind: 3, files: [{ path: 'parts/p1/x-app.html' }, { path: 'parts/p1/a.png', alt: '<図>' }], videos: [] };
    const h = R.previewBodyHtml('## 見出しだけ', part, o());
    expect(h).toContain('alt="&lt;図&gt;"');
    expect(h.indexOf('mp-app')).toBeGreaterThan(h.indexOf('見出しだけ'));
    expect(R.previewBodyHtml('', part, o())).toContain('mp-fig');
  });

  it('段落・箇条に data-para（0 始まり）・data-head（先頭 20 字）・data-cl（主張の番号）', () => {
    const h = R.previewBodyHtml(md('parts/p1/p1-elementary-short.md'), p1, o());
    expect(n(h, /data-para="/g)).toBe(7);
    expect(h).toContain('data-para="1" data-head="赤血球（せっけっきゅう）は、からだじゅう…" data-cl="0 2"');
    expect(h).toContain('id="mp-p-0-0-4" data-para="4"');
  });

  it('動画の id が正しくない時は埋め込まない', () => {
    const part = { ...p1, files: [], videos: [{ id: 'v1', youtube_id: 'bad"id', start_sec: 1, end_sec: 2 }] };
    const h = R.previewBodyHtml('a', part, o());
    expect(h).not.toContain('<iframe');
    expect(h).toContain('埋め込みません');
  });

  it('一覧に無い主張 id の参照も本文には出さない', () => {
    expect(R.previewBodyHtml('ふしぎ [c99]', p1, o({ claimIdx: {} }))).not.toContain('c99');
  });
});

describe('教材プレビュー: 枠（型の名前・最初にやること・要約・変奏の選び方）', () => {
  it('型の名前は日本語（数字でない）・最初にやること（種類つき）・子ども向けの要約', () => {
    const h = R.previewFrameHtml(fixture(), R.defaultPv(), 0);
    expect(h).toContain('<span class="mp-kind">説明と図解</span>');
    expect(h).toContain('<span class="mp-kind">動かせるもの</span>');
    expect(h).not.toContain('型 3');
    expect(h).toContain('最初にやること（見る）</span><p>図の 赤い 丸を 数えてみよう</p>');
    expect(h).toContain('最初にやること（さわる）');
    expect(h).toContain('<p class="mp-summary" data-head-k="summary">赤血球が からだじゅうに');
    expect(h).toContain('data-mode="es"');
    expect(h).toContain('いま表示: <b>小学生・短い</b>');
    const js = R.previewFrameHtml(fixture(), { aud: 'secondary', len: 'long', game: false }, 1);
    expect(js).toContain('data-mode="js"');
    expect(js).toContain('赤血球が酸素を全身へ運ぶ仕組みを');
    expect(js).toContain('id="mp-body-1-0"');
    expect(R.kindName(9)).toBe('型 9');
  });

  it('既定は「小学生・短い」1 枠。変奏は学年 × 長さ、ゲーム版は同じ学年を先に。無ければ null', () => {
    const p1 = fixture().version.material.parts[0];
    const p2 = fixture().version.material.parts[1];
    expect(R.defaultPv()).toMatchObject({ aud: 'elementary', len: 'short', game: false, compare: false });
    expect(R.pickVariant(p1, { aud: 'elementary', len: 'short', game: false }).path).toBe('parts/p1/p1-elementary-short.md');
    expect(R.pickVariant(p1, { aud: 'secondary', len: 'long', game: false }).path).toBe('parts/p1/p1-secondary-long.md');
    expect(R.pickVariant(p1, { aud: 'secondary', len: 'short', game: true }).path).toBe('parts/p1/p1-game.md');
    expect(R.pickVariant(p2, { aud: 'elementary', len: 'short', game: true })).toBe(null);
    expect(R.newReviewState().pv).toEqual(R.defaultPv());
  });

  it('reviewHtml には本文の骨組みだけ（子どもの画面の iframe・図は本文を読んでから入れる）', () => {
    const h = R.reviewHtml(fixture(), R.newReviewState(), {});
    expect(h).toContain('id="mp-frames"');
    expect(n(h, /<iframe /g)).toBe(1); // 「説明と表現」の補足の動画だけ
    expect(h).not.toContain('class="mp-fig');
    expect(h).toContain('aria-pressed="true">小学生</button>');
    expect(h).toContain('data-mp-marks="1" aria-pressed="true"');
    expect(h).toContain('印を見る<span class="mp-marks-state">ON</span>');
  });
});

describe('付箋 → 直してもらう理由の文', () => {
  const st1 = { id: 1, part_id: 'p1', part_title: '赤血球のしごと', part_index: 0, variant_path: 'parts/p1/p1-elementary-short.md', variant_label: '小学生・短い', para_index: 2, head: '赤血球は 血の中で いちばん 数が 多い…', kind: 'hard', text: '「いちばん」の根拠', flowed: false };
  const st2 = { ...st1, id: 2, para_index: 0, head: '図の', kind: 'other', text: '' };

  it('1 件 = 1 行（場所・段落の番号・先頭 20 字・分類・一言）', () => {
    expect(R.stickyLine(st1)).toBe('- parts/p1/p1-elementary-short.md 3 段落目「赤血球は 血の中で いちばん 数が 多い…」: 言葉が難しい — 「いちばん」の根拠');
    expect(R.stickyLine(st2)).toBe('- parts/p1/p1-elementary-short.md 1 段落目「図の」: その他');
    expect(R.STICK_KINDS.map((k: string[]) => k[1])).toEqual(['言葉が難しい', '長い', '図と合わない', '事実が心配', 'その他']);
  });

  it('既に書いてある理由は消さず、その後ろに箇条書きで足す（空なら付箋の行だけ）', () => {
    expect(R.stickyNoteText('出典を直してください\n', [st1, st2])).toEqual({
      note: '出典を直してください\n' + R.stickyLine(st1) + '\n' + R.stickyLine(st2),
      added: 2,
      lines: [R.stickyLine(st1), R.stickyLine(st2)],
    });
    expect(R.stickyNoteText('', [st1]).note).toBe(R.stickyLine(st1));
  });

  it('理由の上限 4000 字を超える行は足さない（added で何件入れたかを返す）', () => {
    const r = R.stickyNoteText('あ'.repeat(3950), [st1, st2]);
    expect(r.added).toBe(0);
    expect(r.note.length).toBe(3950);
    const r2 = R.stickyNoteText('あ'.repeat(3900), [st2, st1]);
    expect(r2.added).toBe(1);
    expect(r2.note.length).toBeLessThanOrEqual(4000);
  });

  it('一覧: 空の時の文・件数・まだ入れていない数・入れた印・1 件ずつの「消す」。文字はエスケープ', () => {
    expect(R.stickyListHtml([])).toContain('付箋はまだありません。「印を見る」を ON にして');
    const h = R.stickyListHtml([{ ...st1, text: '<b>x</b>' }, { ...st2, flowed: true }]);
    expect(h).toContain('<b>付箋 2 件</b>');
    expect(h).toContain('「直してもらう」を押すと、まだ入れていない 1 件を理由欄に箇条書きで足します');
    expect(n(h, /data-stick-del="/g)).toBe(2);
    expect(h).toContain('理由欄に入れました');
    expect(h).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(h).not.toContain('<b>x</b>');
    expect(R.stickyListHtml([{ ...st1, flowed: true }])).toContain('すべて理由欄に入れました');
  });

  it('付箋のある段落には「付箋 N」の印（印 ON の時だけ）。付箋の一覧は右の一覧の中', () => {
    const d = fixture();
    const src = md('parts/p1/p1-elementary-short.md');
    const on = R.previewBodyHtml(src, d.version.material.parts[0], { fileBase: BASE, marks: true, stickies: [st1, { ...st1, id: 3 }] });
    expect(on).toContain('class="mp-para has-stick" id="mp-p-0-0-2"');
    expect(on).toContain('<span class="mp-stuck" title="この段落の付箋">付箋 2</span>');
    const off = R.previewBodyHtml(src, d.version.material.parts[0], { fileBase: BASE, marks: false, stickies: [st1] });
    expect(off).not.toContain('has-stick');
    expect(off).not.toContain('mp-stuck');
    expect(R.newReviewState()).toMatchObject({ stickies: [], stickySeq: 0 });
    const withList = R.reviewHtml(d, { ...R.newReviewState(), stickies: [st1] }, { marks: false });
    expect(withList).toContain('<h2 class="rv-rail-h">付箋（<span id="rv-stick-n">1</span>）</h2>');
    expect(withList).toContain('<b>付箋 1 件</b>');
    expect(withList.indexOf('id="mp-stickies"')).toBeGreaterThan(withList.indexOf('id="rv-rail"'));
  });

  it('却下で送る理由には流し込んだ行を入れない（直してもらうは入れる）。外して空なら空', () => {
    const r = R.stickyNoteText('出典を直して', [st1, { ...st1, id: 2, para_index: 3, kind: 'fact', text: '' }]);
    const st = { ...R.newReviewState(), note: r.note, flowedLines: r.lines };
    expect(R.decisionNote(st, 'reject')).toBe('出典を直して');
    expect(R.decisionNote(st, 'return')).toBe(r.note);
    const only = R.stickyNoteText('', [st1]);
    expect(R.decisionNote({ note: only.note, flowedLines: only.lines }, 'reject').trim()).toBe('');
    const dup = R.stickyLine(st1);
    expect(R.noteWithoutStickyLines(`${dup}\n${dup}`, [dup])).toBe(dup);
    expect(R.decisionNote({ note: 'a', flowedLines: undefined }, 'reject')).toBe('a');
  });

  it('オーナーの理由の末尾の空白・改行は削らない。1 件も足せない時は元のまま', () => {
    expect(R.stickyNoteText('理由  ', [st1]).note).toBe('理由  \n' + R.stickyLine(st1));
    expect(R.stickyNoteText('理由\n\n', [st1]).note).toBe('理由\n\n' + R.stickyLine(st1));
    const full = 'あ'.repeat(3999) + ' ';
    expect(R.stickyNoteText(full, [st1])).toEqual({ note: full, added: 0, lines: [] });
  });

  it('段落の先頭 20 字はコードポイントで切る（サロゲートペアを割らない）', () => {
    const d = fixture();
    const h = R.previewBodyHtml('𠮷'.repeat(25) + ' [c1]', d.version.material.parts[0], { fileBase: BASE, marks: false });
    expect(h).toContain(`data-head="${'𠮷'.repeat(20)}…"`);
    expect(R.previewBodyHtml('😀'.repeat(20), d.version.material.parts[0], { fileBase: BASE, marks: false })).toContain(`data-head="${'😀'.repeat(20)}"`);
  });

  it('主張 id を外す処理は長い空白の行で 2 乗にならない（16 万個の空白で 100ms 以内）', () => {
    const spaces = ' '.repeat(160000);
    for (const line of [spaces + 'x', spaces + '[注', spaces + '[c1', 'a' + spaces + '[c1]', spaces]) {
      const t0 = performance.now();
      R.stripCites(line, {}, []);
      expect(performance.now() - t0).toBeLessThan(100);
    }
    const t1 = performance.now();
    R.inlineMd(spaces + 'x', { cites: [], known: {}, bold: true });
    expect(performance.now() - t1).toBeLessThan(100);
    const out: string[] = [];
    expect(R.stripCites('a \t　[c1]。b', {}, out)).toBe('a。b');
    expect(out).toEqual(['c1']);
  });

  it('付箋の一言欄の Enter は IME の変換中（isComposing・keyCode 229）は付けない', () => {
    expect(R.stickyKeyAction({ key: 'Enter' }, true)).toBe('add');
    expect(R.stickyKeyAction({ key: 'Enter' }, false)).toBe('need_kind');
    expect(R.stickyKeyAction({ key: 'Enter', isComposing: true }, true)).toBe(null);
    expect(R.stickyKeyAction({ key: 'Enter', keyCode: 229 }, true)).toBe(null);
    expect(R.stickyKeyAction({ key: 'Escape' }, true)).toBe('cancel');
    expect(R.stickyKeyAction({ key: 'a' }, true)).toBe(null);
  });

  it('付箋の入力の枠の中にフォーカスがある時は「入力中」= キー操作が効かない。見比べの時は右の枠も探す', () => {
    const el = (tagName: string, inForm: boolean) => ({ tagName, closest: (q: string) => (q === '[data-stick-form]' && inForm ? {} : null) });
    expect(R.inInputOf(el('BUTTON', true))).toBe(true);
    expect(R.inInputOf(el('BUTTON', false))).toBe(false);
    expect(R.inInputOf(el('INPUT', false))).toBe(true);
    expect(R.inInputOf({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(R.inInputOf(null)).toBe(false);
    const env = { inInput: R.inInputOf(el('BUTTON', true)), dialogOpen: false, busy: false, draft: false };
    for (const k of ['a', 'r', 'x', 'j', 'k', 'n', 'p', 'o']) expect(R.keyCommand({ key: k, code: `Key${k.toUpperCase()}` }, env)).toBe(null);
    expect(R.keyCommand({ key: 'a', code: 'KeyA' }, { ...env, inInput: false })).toEqual({ cmd: 'approve' });
    expect(R.claimParaSelectors(4, false)).toEqual(['.mat-preview[data-frame="0"] [data-cl~="4"]']);
    expect(R.claimParaSelectors('4"]x', true)).toEqual(['.mat-preview[data-frame="0"] [data-cl~="4"]', '.mat-preview[data-frame="1"] [data-cl~="4"]']);
  });
});

describe('図・動かせるものへの付箋（§L-9）', () => {
  const d = fixture();
  const p1 = d.version.material.parts[0];
  const p2 = d.version.material.parts[1];
  const FIG = 'parts/p1/p1-figure-1.svg';
  const APP = 'parts/p2/p2-app.html';
  const fig = { id: 1, target: 'media', media: 'figure', media_key: 'parts/p1/figure-1.svg', part_id: 'p1', part_title: '赤血球のしごと', part_index: 0, kind: '3d', text: '血管の中を流れている様子に', flowed: false };
  const app = { ...fig, id: 2, media: 'app', media_key: APP, part_id: 'p2', part_title: '血の流れを動かしてみよう', part_index: 1, kind: 'depth', text: '' };
  const para = { id: 3, part_id: 'p1', part_title: '赤血球のしごと', part_index: 0, variant_path: 'parts/p1/p1-elementary-short.md', variant_label: '小学生・短い', para_index: 2, head: '赤血球は', kind: 'hard', text: '', flowed: false };
  const o = (x: Obj = {}) => ({ fileBase: BASE, marks: true, stick: true, frame: 0, pi: 0, path: 'parts/p1/p1-elementary-short.md', ...x });
  const p1md = md('parts/p1/p1-elementary-short.md');
  const p2md = md('parts/p2/p2-elementary-short.md');

  it('種類の一覧（図 6・動かせるもの 5）', () => {
    expect(R.STICK_FIG_KINDS.map((k: string[]) => k[0])).toEqual(['3d', 'redraw', 'mismatch', 'text', 'fact', 'other']);
    expect(R.STICK_FIG_KINDS[0][1]).toBe('立体の絵にする');
    expect(R.STICK_APP_KINDS.map((k: string[]) => k[0])).toEqual(['depth', 'pointless', 'controls', 'mismatch', 'broken', 'other']);
    expect(R.STICK_VIDEO_KINDS.map((k: string[]) => k[0])).toEqual(['span', 'content', 'remove', 'fact', 'other']);
  });

  it('a. 理由の 1 行: 図 3d は補足つき・一言が後ろ。redraw は補足なし。動かせるもの depth に補足。段落は今までどおり', () => {
    const l = R.stickyLine(fig);
    expect(l.startsWith('- 図 p1 parts/p1/figure-1.svg: 立体の絵にする（generate_image で')).toBe(true);
    expect(l).toBe('- 図 p1 parts/p1/figure-1.svg: 立体の絵にする（generate_image で、光と影・質感のある実物らしい立体の画像に描き直す。平たい SVG のままにしない。名前の引き出し線や説明は画像に入れず本文か別の SVG で） — 血管の中を流れている様子に');
    expect(R.stickyLine({ ...fig, kind: 'redraw', text: '' })).toBe('- 図 p1 parts/p1/figure-1.svg: 描き直す');
    expect(R.stickyLine(app)).toBe('- 動かせるもの p2 parts/p2/p2-app.html: 動きに奥行きがない（app.html の canvas に奥行きのある動く絵にする。遠くは小さく暗く、近くは大きく明るく）');
    expect(R.stickyLine({ ...app, kind: 'pointless', text: 'y' })).toBe('- 動かせるもの p2 parts/p2/p2-app.html: 操作の意味がない（操作は「さわると何が分かるか」を 1 文で言えるものだけにする。速さや数を変えるだけの操作は外し、本文の学びに結びつく操作に置き換える） — y');
    expect(R.stickyLine({ ...app, kind: 'controls', text: 'x' })).toBe('- 動かせるもの p2 parts/p2/p2-app.html: 操作が分かりにくい — x');
    expect(R.stickyLine(para)).toBe('- parts/p1/p1-elementary-short.md 3 段落目「赤血球は」: 言葉が難しい');
  });

  it('b. 印 ON・stick あり: 図に data-stick-media="figure"、動かせるものに "app" のボタン。印 OFF では両方とも出ない', () => {
    const h1 = R.previewBodyHtml(p1md, p1, o());
    expect(h1).toContain(`<figcaption class="mp-fig-tools"><button type="button" class="mp-stick-btn" data-stick-media="figure" data-stick-key="${FIG}">この図に付箋</button></figcaption></figure>`);
    const h2 = R.previewBodyHtml(p2md, p2, o({ pi: 1, path: 'parts/p2/p2-elementary-short.md' }));
    expect(h2).toContain(`<button type="button" class="mp-stick-btn" data-stick-media="app" data-stick-key="${APP}">これに付箋</button>`);
    expect(h2.indexOf('data-stick-media="app"')).toBeLessThan(h2.indexOf('<iframe'));
    for (const h of [R.previewBodyHtml(p1md, p1, o({ marks: false })), R.previewBodyHtml(p2md, p2, o({ pi: 1, marks: false, path: 'parts/p2/p2-elementary-short.md' }))]) {
      expect(h).not.toContain('data-stick-media');
      expect(h).not.toContain('mp-fig-tools');
      expect(h).not.toContain('mp-app-tools');
    }
  });

  it('c. 図の付箋 1 件: その図だけに「付箋 1」と has-stick（別の図には付かない）。印 OFF は札も出ない', () => {
    const two = { ...p1, files: [...p1.files, { path: 'parts/p1/p1-figure-2.png', role: 'figure' }] };
    const s = { ...fig, media_key: FIG };
    const h = R.previewBodyHtml(p1md, two, o({ stickies: [s, para] }));
    expect(h).toMatch(new RegExp(`<figure class="mp-fig has-stick" data-media="figure" data-media-key="${FIG}">[\\s\\S]*?<span class="mp-stuck" title="この図の付箋">付箋 1</span>[\\s\\S]*?</figure>`));
    expect(h).toMatch(/<figure class="mp-fig" data-media="figure" data-media-key="parts\/p1\/p1-figure-2.png">/);
    expect(n(h, /付箋 1<\/span>/g)).toBe(2); // 図 1 と段落 3（段落の札は今までどおり）
    expect(n(h, /title="この図の付箋"/g)).toBe(1);
    expect(h).toContain('class="mp-para has-stick" id="mp-p-0-0-2"');
    expect(R.previewBodyHtml(p1md, two, o({ stickies: [s, { ...s, id: 9 }] }))).toContain('付箋 2</span>');
    const off = R.previewBodyHtml(p1md, two, o({ marks: false, stickies: [s] }));
    expect(off).not.toContain('has-stick');
    expect(off).not.toContain('mp-stuck');
    const a = R.previewBodyHtml(p2md, p2, o({ pi: 1, path: 'parts/p2/p2-elementary-short.md', stickies: [app] }));
    expect(a).toContain('<div class="mp-app has-stick" data-media="app"');
    expect(a).toContain('<span class="mp-stuck" title="この動かせるものの付箋">付箋 1</span>');
  });

  it('d. 一覧: 図の行に「図 parts/p1/figure-1.svg」、動かせるものの行に「動かせるもの …」。種類は図の言葉。文字はエスケープ', () => {
    const h = R.stickyListHtml([fig, app, para]);
    expect(h).toContain('<span class="mp-stick-where">赤血球のしごと・図 parts/p1/figure-1.svg</span>');
    expect(h).toContain('<span class="mp-stick-where">血の流れを動かしてみよう・動かせるもの parts/p2/p2-app.html</span>');
    expect(h).toContain('<span class="mp-stick-kind">立体の絵にする</span>');
    expect(h).toContain('<span class="mp-stick-kind">動きに奥行きがない</span>');
    expect(h).toContain('赤血球のしごと・小学生・短い 3 段落目「赤血球は」');
    expect(n(h, /data-stick-del="/g)).toBe(3);
    expect(R.stickyListHtml([{ ...fig, media_key: '<x>.svg' }])).toContain('図 &lt;x&gt;.svg');
  });

  it('e. 理由の文に入れた図の行も、却下の時に外せる', () => {
    const r = R.stickyNoteText('出典を直して', [para, fig, app]);
    expect(r.added).toBe(3);
    expect(r.note).toContain(R.stickyLine(fig));
    expect(R.noteWithoutStickyLines(r.note, r.lines)).toBe('出典を直して');
    expect(R.decisionNote({ note: r.note, flowedLines: r.lines }, 'reject')).toBe('出典を直して');
  });

  it('動画: 印 ON で .mp-video の先頭にボタン（鍵は videos[].id）、OFF では出ない。行は題名あり・なし。一覧は題名か id', () => {
    const on = R.previewBodyHtml(p1md, p1, o());
    expect(on).toMatch(/<div class="mp-video[^"]*" data-media="video" data-media-key="v1"[^>]*><span class="mp-video-tools"><button type="button" class="mp-stick-btn" data-stick-media="video" data-stick-key="v1">この動画に付箋<\/button><\/span>/);
    expect(R.previewBodyHtml(p1md, p1, o({ marks: false }))).not.toContain('data-stick-media="video"');
    const vs = { ...fig, id: 5, media: 'video', media_key: 'v1', media_title: '赤血球が流れる様子（作り物）', kind: 'span', text: '1:20 からの区間だけに' };
    expect(R.stickyLine(vs)).toBe('- 動画 p1 v1（赤血球が流れる様子（作り物））: 区間が合わない — 1:20 からの区間だけに');
    expect(R.stickyLine({ ...vs, media_title: '', kind: 'remove', text: '' })).toBe('- 動画 p1 v1: 要らない');
    const withV = R.previewBodyHtml(p1md, p1, o({ stickies: [vs] }));
    expect(withV).toContain('<span class="mp-stuck" title="この動画の付箋">付箋 1</span>');
    expect(withV).toMatch(/<div class="mp-video[^"]* has-stick"/);
    expect(R.stickyListHtml([vs])).toContain('赤血球のしごと・動画 赤血球が流れる様子（作り物）（v1）</span>');
    expect(R.stickyListHtml([{ ...vs, media_title: '' }])).toContain('赤血球のしごと・動画 v1</span>');
    expect(R.stickyListHtml([])).toContain('段落の「ここに付箋」や、図・動かせるもの・動画のボタンから付けられます。');
  });

  it('動画: 題名に改行があっても行は 1 行（却下時に外せる）。同じ YouTube 動画の別区間は videos[].id で区別。id の無い動画にはボタンを出さない', () => {
    const vs = { ...fig, id: 6, media: 'video', media_key: 'v2', media_title: '前半\n後半', kind: 'remove', text: 'いら\nない' };
    const line = R.stickyLine(vs);
    expect(line).toBe('- 動画 p1 v2（前半 後半）: 要らない — いら ない');
    const flowed = R.stickyNoteText('手書き理由', [vs]);
    expect(R.noteWithoutStickyLines(flowed.note, flowed.lines)).toBe('手書き理由');
    const two = { ...p1, videos: [{ ...p1.videos[0], id: 'v1', title: '前半', start_sec: 0, end_sec: 20 }, { ...p1.videos[0], id: 'v2', title: '後半', start_sec: 20, end_sec: 40 }] };
    const h = R.previewBodyHtml(p1md, two, o({ stickies: [vs] }));
    expect(h.match(/data-stick-key="v1"/g)).toHaveLength(1);
    expect(h.match(/data-stick-key="v2"/g)).toHaveLength(1);
    expect(h.match(/title="この動画の付箋">付箋 1/g)).toHaveLength(1);
    expect(h).toMatch(/data-media-key="v2"[^>]*>(?:(?!<\/div>).)*付箋 1/);
    const noId = { ...p1, videos: [{ ...p1.videos[0], id: undefined }] };
    const h2 = R.previewBodyHtml(p1md, noId, o());
    expect(h2).toContain('data-media="video"');
    expect(h2).not.toContain('data-stick-media="video"');
  });
});

describe('§O-13-5 図のサムネイルの下の「絵の主張」（✓ ✗ ？ －・参照を開く・esc）', () => {
  const PATH = 'parts/p1/p1-rbc.png';
  const marks = (h: string) => [...h.matchAll(/data-fig-claim="(\w+)"><span class="fc-mark [\w-]+" title="[^"]*">([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]);

  it('figures_meta と verification.figures の checks から、文ごとに ✓（ok）✗（wrong）？（unclear）と note。参照は新しいタブで開くリンク', () => {
    const h = R.figsBlockHtml(FX.figureClaims());
    expect(n(h, /data-fig-claims="3"/g)).toBe(1);
    expect(marks(h)).toEqual([
      ['ok', '✓'],
      ['wrong', '✗'],
      ['unclear', '？'],
    ]);
    expect(h).toContain('静脈の血も赤い（青くない） <span class="muted">絵の奥の静脈が青く塗られている</span>');
    expect(h).toContain('<a data-fig-ref="1" href="https://example.org/body/blood/red-cells/photo" target="_blank" rel="noopener noreferrer">参照を開く</a>');
    // 判定の pill の下に出る
    expect(h.indexOf('data-fig-verdict="problem"')).toBeLessThan(h.indexOf('data-fig-claims="3"'));
  });

  it('－（未検査）: checks の無い旧い結果・not_seen・検証前（判定が無い）。checks に無い番号も －', () => {
    const meta = FX.figureClaims().figures_meta[PATH];
    expect(marks(R.figClaimsHtml(meta, { path: PATH, verdict: 'ok', reason: '' })).map((x) => x[1])).toEqual(['－', '－', '－']);
    expect(marks(R.figClaimsHtml(meta, { path: PATH, verdict: 'not_seen', verdict_raw: 'not_seen', reason: '', checks: [{ n: 1, result: 'ok', note: '' }] })).map((x) => x[1])).toEqual(['－', '－', '－']);
    expect(marks(R.figClaimsHtml(meta, null)).map((x) => x[0])).toEqual(['none', 'none', 'none']);
    expect(marks(R.figClaimsHtml(meta, { path: PATH, verdict: 'ok', checks: [{ n: 2, result: 'ok', note: '' }] })).map((x) => x[1])).toEqual(['－', '✓', '－']);
  });

  it('絵の主張の無い図には出ない（figures_meta に無い・shows が空）。参照が無ければリンクを出さない', () => {
    const d = FX.figureClaims();
    const h = R.figsBlockHtml(d);
    expect(n(h, /data-fig-claims=/g)).toBe(1);
    expect(R.figClaimsHtml(null, null)).toBe('');
    expect(R.figClaimsHtml({ shows: [], reference_url: 'https://example.org/x' }, null)).toBe('');
    expect(R.figClaimsHtml({ shows: [{ text: 'a', source_ids: ['s1'] }], reference_url: null }, null)).not.toContain('data-fig-ref');
    expect(R.figClaimsHtml({ shows: [{ text: 'a', source_ids: ['s1'] }], reference_url: 'javascript:alert(1)' }, null)).not.toContain('data-fig-ref');
    delete d.figures_meta;
    expect(R.figsBlockHtml(d)).not.toContain('data-fig-claims');
  });

  it('文・note・参照の URL は esc() を通る', () => {
    const h = R.figClaimsHtml(
      { shows: [{ text: '<img src=x onerror=alert(1)>', source_ids: ['s1'] }], reference_url: 'https://example.org/"><script>x</script>' },
      { path: PATH, verdict: 'problem', checks: [{ n: 1, result: 'wrong', note: '<b>n</b>' }] },
    );
    expect(h).not.toMatch(/<img|<script|<b>n/);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain('&lt;b&gt;n&lt;/b&gt;');
    expect(h).toContain('href="https://example.org/&quot;&gt;&lt;script&gt;x&lt;/script&gt;"');
  });

  it('子どもの画面（教材プレビューの図 .mp-fig）には出さない。確認画面の全体でも一覧は補足の 1 か所だけ', () => {
    const d = FX.figureClaims();
    const h = R.reviewHtml(d, R.newReviewState(), {});
    expect(n(h, /data-fig-claims=/g)).toBe(1);
    for (const m of h.match(/<figure class="mp-fig[\s\S]*?<\/figure>/g) ?? []) expect(m).not.toContain('fig-claims');
  });
});
