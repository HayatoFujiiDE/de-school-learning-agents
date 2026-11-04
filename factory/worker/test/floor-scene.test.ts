// §N-6-7 (n6a)(n6b): 工場の場面の純関数（public/admin/floor-scene.js。ブラウザと node の両方で読める UMD）
// (n6a) stationStates(floor): §N-6-2 の判定表の全行を 1 ケースずつ / (n6b) rowStations(row): §N-6-4 の所属を 1 ケースずつ
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

type StationState = { kind: string; text: string; text2?: string; bar?: number; spin?: boolean };
type Step = { key: string; label: string; state: string; detail: string | null };
type Row = { steps: Step[]; progress_pct?: number; job?: { status: string; kind: string; auto_rework: boolean } | null };
interface SceneApi {
  CHAR_EXT: string;
  SCENE: { width: number; height: number; stations: Array<{ id: string }>; arrows: Array<{ id: string; to: string }> };
  stationStates: (floor: unknown) => Record<string, StationState>;
  rowStations: (row: unknown) => string[];
  charSvgElementAllowed: (localName: string) => boolean;
  charSvgAttrAllowed: (name: string, value: string) => boolean;
}

// UMD をそのまま評価する（package は "type": "module" なので require せず vm で module.exports を受け取る）
const code = readFileSync(new URL('../public/admin/floor-scene.js', import.meta.url), 'utf8');
const sandbox: { module: { exports: unknown } } = { module: { exports: {} } };
vm.runInNewContext(code, sandbox);
const S = sandbox.module.exports as SceneApi;

const KEYS = ['order', 'questions', 'making', 'ingest', 'verify', 'review', 'publish'];
/** states は 7 個（order, questions, making, ingest, verify, review, publish）をカンマ区切りで */
const row = (states: string, extra: Partial<Row> = {}): Row => ({
  steps: states.split(',').map((state, i) => ({ key: KEYS[i], label: KEYS[i], state, detail: null })),
  progress_pct: 0,
  job: null,
  ...extra,
});
const NOW = '2026-11-04T12:00:00.000Z';
const HOUR = 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();

type Stations = Record<string, Record<string, unknown>>;
const base = (): Stations => ({
  intake: { proposed: 0, scout_running: false, meeting_pending: false, last_scout_at: null, last_meeting_at: null },
  maker: { queued: 0, creating: 0, running: 0, needs_answer: 0, budget_reached: 0, max_concurrent: 3 },
  clerk: { ingesting: 0, failed_invalid_outputs: 0 },
  verifier: { pending: 0, running: 0, failed: 0 },
  reviewer: { waiting: 0, needs_review_total: 0 },
  library: { available: 0, stopped: 0 },
  rework: { auto_active: 0, manual_active: 0 },
});
/** stations の一部を上書きした /api/floor 応答 */
const floor = (patch: Record<string, Record<string, unknown>> = {}, queue: Row[] = []) => {
  const s = base();
  for (const k of Object.keys(patch)) s[k] = { ...s[k], ...patch[k] };
  return { now: NOW, stations: s, queue };
};
const of = (f: unknown, id: string) => S.stationStates(f)[id];
const IDLE = { kind: 'idle', text: '待機' };

describe('(n6a) stationStates: §N-6-2 の判定表（上から最初に当たったもの）', () => {
  const cases: Array<[string, string, unknown, StationState]> = [
    // intake
    ['intake / scout_running', 'intake', floor({ intake: { scout_running: true, proposed: 4 } }), { kind: 'moving', text: '収集中' }],
    ['intake / proposed > 0', 'intake', floor({ intake: { proposed: 4 } }), { kind: 'done', text: '提案 4 件' }],
    ['intake / それ以外', 'intake', floor(), IDLE],
    // meeting
    ['meeting / meeting_pending', 'meeting', floor({ intake: { meeting_pending: true, last_meeting_at: ago(HOUR) } }), { kind: 'moving', text: '会議中（結果待ち）' }],
    ['meeting / last_meeting_at が 24 時間以内', 'meeting', floor({ intake: { last_meeting_at: ago(23 * HOUR) } }), { kind: 'done', text: '会議 完了' }],
    ['meeting / それ以外（25 時間前）', 'meeting', floor({ intake: { last_meeting_at: ago(25 * HOUR) } }), IDLE],
    // maker
    [
      'maker / 行の making 工程 active の数 N > 0（バー N / max_concurrent）',
      'maker',
      floor({ maker: { budget_reached: 1, creating: 1, running: 2 } }, [row('done,done,active,pending,pending,pending,pending'), row('done,done,active,pending,pending,pending,pending')]),
      { kind: 'moving', text: '制作中 2', bar: 67 },
    ],
    ['maker / budget_reached > 0', 'maker', floor({ maker: { budget_reached: 1, creating: 1 } }, [row('done,done,waiting,pending,pending,pending,pending')]), { kind: 'human', text: '予算の上限 1' }],
    ['maker / creating > 0', 'maker', floor({ maker: { creating: 2 } }, [row('done,active,pending,pending,pending,pending,pending')]), { kind: 'moving', text: '準備中 2' }],
    ['maker / 行の making 工程 failed の数 > 0', 'maker', floor({}, [row('done,done,failed,pending,pending,pending,pending')]), { kind: 'failed', text: '失敗 1' }],
    ['maker / それ以外', 'maker', floor({}, [row('done,done,done,done,active,pending,pending')]), IDLE],
    // questions
    ['questions / needs_answer > 0', 'questions', floor({ maker: { needs_answer: 2 } }, [row('done,active,pending,pending,pending,pending,pending')]), { kind: 'human', text: '回答待ち 2' }],
    ['questions / 行の questions 工程 active の数 > 0', 'questions', floor({}, [row('done,active,pending,pending,pending,pending,pending')]), { kind: 'moving', text: '質問を考え中' }],
    ['questions / それ以外', 'questions', floor(), IDLE],
    // clerk
    ['clerk / ingesting > 0', 'clerk', floor({ clerk: { ingesting: 1, failed_invalid_outputs: 2 } }), { kind: 'moving', text: '取り込み中 1' }],
    ['clerk / failed_invalid_outputs > 0', 'clerk', floor({ clerk: { failed_invalid_outputs: 2 } }), { kind: 'failed', text: '取り込み失敗 2' }],
    ['clerk / それ以外', 'clerk', floor(), IDLE],
    // verifier: バー = verify active 行の progress の平均を 70〜84 → 0〜100%（(74 + 84) / 2 = 79 → 64%）
    [
      'verifier / running > 0（バー付き）',
      'verifier',
      floor({ verifier: { running: 2, pending: 1, failed: 1 } }, [
        row('done,done,done,done,active,pending,pending', { progress_pct: 74 }),
        row('done,done,done,done,active,pending,pending', { progress_pct: 84 }),
      ]),
      { kind: 'moving', text: '検証中 2', bar: 64 },
    ],
    ['verifier / pending > 0（リングは回さない）', 'verifier', floor({ verifier: { pending: 3, failed: 1 } }), { kind: 'moving', text: '順番待ち 3', spin: false }],
    ['verifier / failed > 0', 'verifier', floor({ verifier: { failed: 1 } }), { kind: 'failed', text: '検証失敗 1' }],
    ['verifier / それ以外', 'verifier', floor(), IDLE],
    // autofix
    ['autofix / stations.rework.auto_active > 0', 'autofix', floor({ rework: { auto_active: 1, manual_active: 2 } }), { kind: 'moving', text: '作り直し中 1' }],
    ['autofix / それ以外', 'autofix', floor({ rework: { manual_active: 2 } }), IDLE],
    // reviewer
    ['reviewer / waiting > 0（needs_review_total > 0 なら 2 行目）', 'reviewer', floor({ reviewer: { waiting: 2, needs_review_total: 5 } }), { kind: 'human', text: '確認待ち 2', text2: '要確認 5' }],
    ['reviewer / waiting > 0（needs_review_total = 0 なら 2 行目なし）', 'reviewer', floor({ reviewer: { waiting: 1 } }), { kind: 'human', text: '確認待ち 1' }],
    ['reviewer / それ以外', 'reviewer', floor({ reviewer: { needs_review_total: 3 } }), IDLE],
    // rework
    ['rework / stations.rework.manual_active > 0', 'rework', floor({ rework: { auto_active: 1, manual_active: 2 } }), { kind: 'moving', text: '作り直し 2' }],
    ['rework / それ以外', 'rework', floor({ rework: { auto_active: 1 } }), IDLE],
    // library
    ['library / available > 0', 'library', floor({ library: { available: 3, stopped: 1 } }), { kind: 'done', text: '利用できる 3' }],
    ['library / それ以外', 'library', floor({ library: { stopped: 1 } }), IDLE],
  ];

  it.each(cases)('%s', (_name, id, f, want) => {
    expect(of(f, id)).toEqual(want);
  });

  it('10 個の持ち場すべてに札があり、何も無ければ全部「待機」', () => {
    const all = S.stationStates(floor());
    expect(Object.keys(all).sort()).toEqual(['autofix', 'clerk', 'intake', 'library', 'maker', 'meeting', 'questions', 'reviewer', 'rework', 'verifier']);
    for (const k of Object.keys(all)) expect(all[k]).toEqual(IDLE);
  });

  it('応答が空・欠けていても落ちない（全部「待機」）', () => {
    expect(S.stationStates(null).maker).toEqual(IDLE);
    expect(S.stationStates({ stations: {} }).verifier).toEqual(IDLE);
  });
});

describe('(n6b) rowStations: §N-6-4 の行の所属', () => {
  const cases: Array<[string, Row, string[]]> = [
    ['questions 工程 waiting → questions', row('done,waiting,pending,pending,pending,pending,pending'), ['questions']],
    ['making 工程 active → maker', row('done,done,active,pending,pending,pending,pending'), ['maker']],
    ['ingest 工程 failed → clerk', row('done,done,done,failed,pending,pending,pending'), ['clerk']],
    ['verify 工程 active → verifier', row('done,done,done,done,active,pending,pending'), ['verifier']],
    ['review 工程 waiting → reviewer', row('done,done,done,done,done,waiting,pending'), ['reviewer']],
    ['publish 工程 failed（止めている）→ library', row('done,done,done,done,done,done,failed'), ['library']],
    ['最初の active / waiting / failed だけで決まる（後ろの failed は見ない）', row('done,done,active,pending,pending,failed,pending'), ['maker']],
    ['active / waiting / failed が無く、利用できる素材でもない行はどこにも属さない', row('done,done,done,done,done,done,done'), []],
    ['利用できる素材（公開済み）→ library', row('done,done,done,done,done,done,done', { material: { publish_status: 'available' } }), ['library']],
    [
      '順番待ち（queued）の job → maker',
      row('done,pending,pending,pending,pending,pending,pending', { job: { status: 'queued', kind: 'draft', auto_rework: false } }),
      ['maker'],
    ],
    [
      '自動の作り直し中（job.auto_rework かつ active）は autofix にも',
      row('done,skipped,active,pending,pending,pending,pending', { job: { status: 'running', kind: 'rework', auto_rework: true } }),
      ['maker', 'autofix'],
    ],
    [
      '人の作り直し中（kind = rework・自動でない・active）は rework にも',
      row('done,done,active,pending,pending,pending,pending', { job: { status: 'running', kind: 'rework', auto_rework: false } }),
      ['maker', 'rework'],
    ],
    [
      '作り直しでも job が終わっていれば autofix / rework に属さない',
      row('done,done,done,done,active,pending,pending', { job: { status: 'done', kind: 'rework', auto_rework: true } }),
      ['verifier'],
    ],
    [
      '注文（draft）の job は rework に属さない',
      row('done,done,active,pending,pending,pending,pending', { job: { status: 'running', kind: 'draft', auto_rework: false } }),
      ['maker'],
    ],
  ];

  it.each(cases)('%s', (_name, r, want) => {
    expect(S.rowStations(r)).toEqual(want);
  });
});

describe('SCENE（§N-6-8）', () => {
  it('背景と同じ 1706 × 600、持ち場 10 個・矢印 10 本。矢印の流れ先は持ち場の id', () => {
    expect([S.SCENE.width, S.SCENE.height]).toEqual([1706, 600]);
    const ids = S.SCENE.stations.map((s) => s.id);
    expect(ids).toEqual(['intake', 'maker', 'clerk', 'verifier', 'reviewer', 'rework', 'library', 'meeting', 'questions', 'autofix']);
    expect(S.SCENE.arrows.map((a) => a.id)).toEqual([
      'intake-maker', 'intake-meeting', 'maker-clerk', 'maker-questions', 'questions-maker',
      'clerk-verifier', 'verifier-autofix', 'verifier-reviewer', 'reviewer-rework', 'reviewer-library',
    ]);
    for (const a of S.SCENE.arrows) expect(ids).toContain(a.to);
    expect(['svg', 'png']).toContain(S.CHAR_EXT);
  });
});

describe('キャラ SVG の無害化の許可リスト（差し戻し A1。DOM の走査は admin.js の sanitizeCharSvg）', () => {
  it('要素: 図形と g・svg だけ残す（script・foreignObject・image・a・use・style・set・animate は捨てる）', () => {
    for (const n of ['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']) expect(S.charSvgElementAllowed(n)).toBe(true);
    for (const n of ['script', 'foreignObject', 'image', 'a', 'use', 'style', 'set', 'animate', 'animateMotion', 'iframe', 'text', 'defs', 'linearGradient', 'SCRIPT'])
      expect(S.charSvgElementAllowed(n)).toBe(false);
  });

  it('属性: 悪意ある値（on*・style・href・url()・エスケープした url・括弧）は捨て、形と色の属性だけ残す', () => {
    const cases: Array<[string, string, boolean]> = [
      ['fill', '#1c1c22', true],
      ['fill', 'none', true],
      ['stroke', 'currentColor', true],
      ['fill', 'url(#g)', false],
      ['fill', 'url(https://example.invalid/p.svg#g)', false],
      ['fill', 'u\\72l(https://example.invalid/q.svg#g)', false],
      ['stroke', 'rgb(0,0,0)', false],
      ['style', 'fill:url(https://example.invalid/p.svg#g)', false],
      ['onload', 'window.__pwn=1', false],
      ['onmouseover', 'x', false],
      ['href', '#a', false],
      ['xlink:href', 'https://example.invalid/', false],
      ['filter', 'url(#f)', false],
      ['mask', 'url(#m)', false],
      ['opacity', 'url(x)', false],
      ['width', 'calc(1px)', false],
      ['class', 'ch-body', true],
      ['viewBox', '0 0 200 200', true],
      ['viewbox', '0 0 200 200', false],
      ['transform', 'rotate(7 92 176)', true],
      ['d', 'M0 0 L10 10 Z', true],
      ['points', '1 2 3 4', true],
      ['stroke-width', '6', true],
    ];
    for (const [name, value, want] of cases) expect([name, value, S.charSvgAttrAllowed(name, value)]).toEqual([name, value, want]);
  });
});
