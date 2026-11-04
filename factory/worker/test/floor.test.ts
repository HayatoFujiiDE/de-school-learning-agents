// §N-5 (n1): §N-2 の判定表の全行を 1 ケースずつ（入力 → steps の state 列・progress・attention）
import { describe, expect, it } from 'vitest';
import { FLOOR_STEP_KEYS, floorSteps, type FloorInput } from '../src/floor';

type Job = NonNullable<FloorInput['job']>;
type Ver = NonNullable<FloorInput['version']>;

const job = (o: Partial<Job> = {}): Job => ({
  status: 'running',
  phase: 'questions',
  kind: 'draft',
  error: null,
  reconcile_stage: 'none',
  has_questions: false,
  auto_rework: false,
  ...o,
});
const ver = (o: Partial<Ver> = {}): Ver => ({
  status: 'review',
  verification_status: 'pending',
  verify_phase: null,
  verify_turn: 0,
  needs_review: 0,
  ...o,
});
const input = (o: Partial<FloorInput> = {}): FloorInput => ({
  material: { work_status: 'making', publish_status: 'none' },
  job: null,
  version: null,
  last_decision: null,
  ...o,
});

const states = (i: FloorInput) => floorSteps(i).steps.map((s) => s.state).join(',');
const detailOf = (i: FloorInput, key: string) => floorSteps(i).steps.find((s) => s.key === key)?.detail ?? null;

describe('floorSteps: 判定表（上から最初に当たった行）', () => {
  const rows: Array<[string, FloorInput, string, number, string | null, [string, string | null]?]> = [
    ['job queued', input({ material: { work_status: 'queued', publish_status: 'none' }, job: job({ status: 'queued' }) }), 'done,pending,pending,pending,pending,pending,pending', 5, null],
    ['job creating', input({ job: job({ status: 'creating' }) }), 'done,active,pending,pending,pending,pending,pending', 10, null, ['questions', '作業場を準備中']],
    ['job needs_answer', input({ job: job({ status: 'needs_answer', has_questions: true }) }), 'done,waiting,pending,pending,pending,pending,pending', 15, 'answer', ['questions', '回答待ち']],
    ['job running / questions', input({ job: job({ status: 'running', phase: 'questions' }) }), 'done,active,pending,pending,pending,pending,pending', 15, null, ['questions', '職人が質問を考え中']],
    ['job running / making / reconcile none', input({ job: job({ phase: 'making' }) }), 'done,done,active,pending,pending,pending,pending', 40, null, ['making', '制作中']],
    ['job running / making / reconcile != none', input({ job: job({ phase: 'making', reconcile_stage: 'listed' }) }), 'done,done,done,active,pending,pending,pending', 60, null, ['ingest', '取り込み中']],
    ['job budget_reached', input({ job: job({ status: 'budget_reached', phase: 'making' }) }), 'done,done,waiting,pending,pending,pending,pending', 40, 'budget', ['making', '予算の上限']],
    ['job failed / invalid_outputs', input({ material: { work_status: 'idle', publish_status: 'none' }, job: job({ status: 'failed', phase: 'making', error: 'invalid_outputs' }) }), 'done,done,done,failed,pending,pending,pending', 60, 'failed', ['ingest', '取り込み失敗']],
    ['job failed（その他）', input({ material: { work_status: 'idle', publish_status: 'none' }, job: job({ status: 'failed', phase: 'making', error: 'terminated_without_outputs' }) }), 'done,done,failed,pending,pending,pending,pending', 40, 'failed', ['making', '失敗']],
    ['job cancelled', input({ material: { work_status: 'idle', publish_status: 'none' }, job: job({ status: 'cancelled' }) }), 'done,skipped,skipped,skipped,skipped,skipped,skipped', 0, null],
    ['v review / pending', input({ material: { work_status: 'review', publish_status: 'none' }, job: job({ status: 'done', phase: 'making' }), version: ver() }), 'done,done,done,done,active,pending,pending', 65, null, ['verify', '検証の順番待ち']],
    ['v review / running', input({ material: { work_status: 'review', publish_status: 'none' }, version: ver({ verification_status: 'running', verify_phase: 'submitted', verify_turn: 2 }) }), 'done,done,done,done,active,pending,pending', 74, null, ['verify', 'Batch 結果待ち・ターン 2']],
    ['v review / failed', input({ material: { work_status: 'review', publish_status: 'none' }, version: ver({ verification_status: 'failed' }) }), 'done,done,done,done,failed,pending,pending', 70, 'failed', ['verify', '検証失敗']],
    ['v review / done / needs_review > 0', input({ material: { work_status: 'review', publish_status: 'none' }, version: ver({ verification_status: 'done', needs_review: 3 }) }), 'done,done,done,done,done,waiting,pending', 90, 'review', ['review', '要確認 3']],
    ['v review / done / needs_review = 0', input({ material: { work_status: 'review', publish_status: 'none' }, version: ver({ verification_status: 'done', needs_review: 0 }) }), 'done,done,done,done,done,waiting,pending', 90, 'review', ['review', '確認待ち']],
    ['publish_status available', input({ material: { work_status: 'idle', publish_status: 'available' }, job: job({ status: 'done', phase: 'making' }), version: ver({ status: 'approved', verification_status: 'done', needs_review: null }) }), 'done,done,done,done,done,done,done', 100, null, ['publish', '利用できる']],
    ['publish_status stopped', input({ material: { work_status: 'idle', publish_status: 'stopped' }, version: ver({ status: 'approved', verification_status: 'done', needs_review: null }) }), 'done,done,done,done,done,done,failed', 100, null, ['publish', '止めている']],
    ['それ以外（idle・版 rejected）', input({ material: { work_status: 'idle', publish_status: 'none' }, job: job({ status: 'done', phase: 'making' }), last_decision: 'reject' }), 'done,skipped,skipped,skipped,skipped,failed,skipped', 0, null],
  ];

  it.each(rows)('%s', (_name, i, want, progress, attention, det) => {
    const r = floorSteps(i);
    expect(r.steps.map((s) => s.key)).toEqual([...FLOOR_STEP_KEYS]);
    expect(r.steps.map((s) => s.label)).toEqual(['注文', '質問', '制作', '取り込み', '検証', '確認', '公開']);
    expect(states(i)).toBe(want);
    expect(r.progress_pct).toBe(progress);
    expect(r.attention).toBe(attention);
    if (det) expect(detailOf(i, det[0])).toBe(det[1]);
  });
});

describe('floorSteps: 行の補足', () => {
  it('それ以外: 最後が承認なら review は done、決定が無ければ skipped', () => {
    const base = input({ material: { work_status: 'idle', publish_status: 'none' } });
    expect(states({ ...base, last_decision: 'approve' })).toBe('done,skipped,skipped,skipped,skipped,done,skipped');
    expect(states(base)).toBe('done,skipped,skipped,skipped,skipped,skipped,skipped');
  });

  it('検証中の detail: verify_phase の日本語 + ターン（0 なら付けない）、progress は 70 + min(turn, 7) × 2', () => {
    const v = (verify_phase: string | null, verify_turn: number) =>
      input({ material: { work_status: 'review', publish_status: 'none' }, version: ver({ verification_status: 'running', verify_phase, verify_turn }) });
    expect(detailOf(v('to_submit', 0), 'verify')).toBe('送信待ち');
    expect(detailOf(v('submitting', 1), 'verify')).toBe('送信中・ターン 1');
    expect(detailOf(v('collecting', 3), 'verify')).toBe('回収中・ターン 3');
    expect(detailOf(v(null, 0), 'verify')).toBe('検証中');
    expect(floorSteps(v('submitted', 9)).progress_pct).toBe(84);
  });

  it('job の行が版の行より先（rework の制作中は配信中でも制作中）', () => {
    const i = input({ material: { work_status: 'making', publish_status: 'available' }, job: job({ kind: 'rework', phase: 'making' }), version: ver({ status: 'approved', needs_review: null }) });
    expect(states(i)).toBe('done,skipped,active,pending,pending,pending,pending');
  });

  it('rework で質問を飛ばした（phase making・questions_json null）なら questions は skipped。質問があれば done', () => {
    const skipped = input({ job: job({ kind: 'rework', phase: 'making' }) });
    expect(floorSteps(skipped).steps[1].state).toBe('skipped');
    const asked = input({ job: job({ kind: 'rework', phase: 'making', has_questions: true }) });
    expect(floorSteps(asked).steps[1].state).toBe('done');
    const draft = input({ job: job({ kind: 'draft', phase: 'making' }) });
    expect(floorSteps(draft).steps[1].state).toBe('done');
  });

  it('order の label: auto_rework なら「作り直し（自動）」、rework なら「作り直し」、draft は「注文」', () => {
    expect(floorSteps(input({ job: job({ kind: 'rework', auto_rework: true }) })).steps[0].label).toBe('作り直し（自動）');
    expect(floorSteps(input({ job: job({ kind: 'rework' }) })).steps[0].label).toBe('作り直し');
    expect(floorSteps(input({ job: job() })).steps[0].label).toBe('注文');
  });
});
