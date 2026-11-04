// 走査の再開（src/scan.ts）: 同じ文脈なら続きから、文脈が違えば捨てて先頭から、連続時間切れ N 回で stalled
import { describe, expect, it } from 'vitest';
import { PortError } from '../src/anthropic';
import {
  OutOfTime,
  SCAN_MAX_STALLS,
  STATE_MAX_BYTES,
  ScanLimit,
  ScanStalled,
  carriedStalls,
  decideResume,
  isStalled,
  newScanState,
  runScan,
  stateJsonForSave,
  type ScanCtx,
  type ScanState,
} from '../src/scan';

const ctx = (o: Partial<ScanCtx> = {}): ScanCtx => ({
  purpose: 'idle',
  job_status: 'running',
  job_phase: 'questions',
  session_status: 'idle',
  head: 'sevt_9',
  ...o,
});

describe('decideResume / carriedStalls（pure）', () => {
  const saved = (o: Partial<ScanState<{ n: number }>> = {}): ScanState<{ n: number }> => ({
    ...newScanState(ctx(), { n: 3 }, 2),
    cursor: 'c2',
    pages: 2,
    seen: 6,
    ...o,
  });

  it('同じ文脈で途中なら resume、完了済みなら reuse', () => {
    expect(decideResume(saved(), ctx())).toBe('resume');
    expect(decideResume(saved({ done: true, cursor: null }), ctx())).toBe('reuse');
  });

  it('文脈が 1 つでも違えば restart（目的・job status・phase・session status・先頭 event）', () => {
    for (const diff of [
      { purpose: 'files' },
      { job_status: 'budget_reached' },
      { job_phase: 'making' },
      { session_status: 'running' },
      { head: 'sevt_10' },
      { head: null },
    ] as Array<Partial<ScanCtx>>) {
      expect(decideResume(saved(), ctx(diff))).toBe('restart');
    }
  });

  it('保存が無い・形が違う・1 ページも取っていない時は restart', () => {
    expect(decideResume(undefined, ctx())).toBe('restart');
    expect(decideResume({ cursor: 'x' }, ctx())).toBe('restart');
    expect(decideResume(saved({ pages: 0, cursor: null }), ctx())).toBe('restart');
  });

  it('連続時間切れの回数は同じ目的なら文脈が変わっても引き継ぎ、N 回で stalled', () => {
    expect(carriedStalls(saved({ stalls: 5 }), 'idle')).toBe(5);
    expect(carriedStalls(saved({ stalls: 5 }), 'files')).toBe(0);
    expect(carriedStalls(undefined, 'idle')).toBe(0);
    expect(SCAN_MAX_STALLS).toBe(8);
    expect(isStalled(SCAN_MAX_STALLS - 1)).toBe(false);
    expect(isStalled(SCAN_MAX_STALLS)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 走査ドライバ（I/O は引数）。events を新しい順に 3 件ずつ返す偽の一覧と、呼び出しごとの残り時間を模した before

type Ev = { id: string; type: string };
type Agg = { types: string[]; found: boolean };

function pager(events: Ev[], pageSize = 3) {
  const calls: Array<string | null> = [];
  return {
    calls,
    fetch: async (cursor: string | null) => {
      calls.push(cursor);
      const desc = [...events].reverse();
      const start = cursor ? Number(cursor.slice(1)) : 0;
      const end = start + pageSize;
      return { data: desc.slice(start, end), next: end < desc.length ? `c${end}` : null };
    },
  };
}

/** budget 回目の before までは通し、それ以降は OutOfTime（1 回の呼び出しで取れるページ数を模す） */
const beforeWithBudget = (budget: number) => {
  let n = 0;
  return async () => {
    if (n++ >= budget) throw new OutOfTime();
  };
};

function store() {
  const box: { saved: unknown; lastErrors: string[] } = { saved: undefined, lastErrors: [] };
  return {
    box,
    save: async (st: ScanState<Agg>, lastError?: string) => {
      box.saved = JSON.parse(JSON.stringify(st));
      if (lastError) box.lastErrors.push(lastError);
    },
  };
}

const evs = (n: number, outcomeAt = -1): Ev[] =>
  Array.from({ length: n }, (_, i) => ({ id: `sevt_${i}`, type: i === outcomeAt ? 'user.define_outcome' : 'agent.message' }));

async function scanOnce(events: Ev[], s: ReturnType<typeof store>, budget: number) {
  const p = pager(events);
  const r = await runScan<Ev, Agg>({
    saved: s.box.saved,
    base: { purpose: 'answer', job_status: 'needs_answer', job_phase: 'questions', session_status: null },
    init: () => ({ types: [], found: false }),
    fetch: p.fetch,
    idOf: (e) => e.id,
    fold: (agg, items) => {
      for (const e of items) {
        agg.types.push(e.id);
        if (e.type === 'user.define_outcome') agg.found = true;
      }
      return agg.found;
    },
    before: beforeWithBudget(budget),
    save: s.save,
    maxPages: 500,
  }).catch((e: unknown) => e);
  return { r, calls: p.calls };
}

describe('runScan（時間切れの後に続きから）', () => {
  it('同じ文脈なら保存した続き位置から再開し、最後のページまで辿った集計は一度に辿った時と同じ', async () => {
    const events = evs(10); // 3 件ずつ → 4 ページ
    const s = store();
    const first = await scanOnce(events, s, 2); // 2 ページで時間切れ
    expect(first.r).toBeInstanceOf(OutOfTime);
    expect((first.r as OutOfTime).noProgress).toBe(false);
    expect((s.box.saved as ScanState<Agg>).pages).toBe(2);
    expect((s.box.saved as ScanState<Agg>).stalls).toBe(1);

    const second = await scanOnce(events, s, 10);
    // 1 ページ目（page=null）は先頭 event の確認だけ、その後は保存した続き位置 c6 から
    expect(second.calls).toEqual([null, 'c6', 'c9']);
    const r = second.r as { agg: Agg; head: string };
    expect(r.head).toBe('sevt_9');
    expect(r.agg.types).toEqual([...events].reverse().map((e) => e.id));
    expect((s.box.saved as ScanState<Agg>).done).toBe(true);
    expect((s.box.saved as ScanState<Agg>).stalls).toBe(0);
  });

  it('先頭に新しい event が増えていたら途中集計を捨てて先頭から（回数は引き継ぐ）', async () => {
    const events = evs(10);
    const s = store();
    await scanOnce(events, s, 2);
    const grown = [...events, { id: 'sevt_10', type: 'user.define_outcome' }];
    const second = await scanOnce(grown, s, 10);
    const r = second.r as { agg: Agg; head: string };
    expect(r.head).toBe('sevt_10');
    expect(r.agg.found).toBe(true);
    expect(r.agg.types).toEqual(['sevt_10', 'sevt_9', 'sevt_8']); // 新しい 1 ページ目だけで打ち切り（古い集計は混ざらない）
  });

  it('完了済みで先頭が同じなら集計をそのまま使う（1 ページ目の確認だけ）', async () => {
    const events = evs(10, 2);
    const s = store();
    const a = await scanOnce(events, s, 10);
    expect((a.r as { agg: Agg }).agg.found).toBe(true);
    const b = await scanOnce(events, s, 10);
    expect(b.calls).toEqual([null]);
    expect((b.r as { agg: Agg }).agg).toEqual((a.r as { agg: Agg }).agg);
  });

  it('1 ページも進めずに時間切れなら last_error=scan_no_progress を残し、前回までの途中集計は消さない', async () => {
    const events = evs(10);
    const s = store();
    await scanOnce(events, s, 2);
    const before = s.box.saved as ScanState<Agg>;
    const r = await scanOnce(events, s, 0);
    expect(r.r).toBeInstanceOf(OutOfTime);
    expect((r.r as OutOfTime).noProgress).toBe(true);
    expect(s.box.lastErrors).toEqual(['scan_no_progress']);
    const after = s.box.saved as ScanState<Agg>;
    expect({ ...after, stalls: 0 }).toEqual({ ...before, stalls: 0 });
    expect(after.stalls).toBe(2);
    // 続きは残っている
    const done = await scanOnce(events, s, 10);
    expect((done.r as { agg: Agg }).agg.types.length).toBe(10);
  });

  it(`先頭が増え続けて完了しない走査は ${SCAN_MAX_STALLS} 回目の時間切れで ScanStalled（無限に再試行しない）`, async () => {
    let events = evs(30);
    const s = store();
    const results: unknown[] = [];
    for (let i = 0; i < SCAN_MAX_STALLS + 2; i++) {
      events = [...events, { id: `sevt_new_${i}`, type: 'agent.message' }];
      results.push((await scanOnce(events, s, 2)).r);
    }
    expect(results.slice(0, SCAN_MAX_STALLS - 1).every((r) => r instanceof OutOfTime)).toBe(true);
    expect(results[SCAN_MAX_STALLS - 1]).toBeInstanceOf(ScanStalled);
    expect(results[SCAN_MAX_STALLS]).toBeInstanceOf(ScanStalled); // 次の呼び出しも始める前に止まる
  });

  it('ページ数の上限は呼び出しをまたいで数え、終端（ScanLimit）にする', async () => {
    const s = store();
    const p = pager(evs(30));
    const r = await runScan<Ev, Agg>({
      saved: undefined,
      base: { purpose: 'idle', job_status: 'running', job_phase: 'making', session_status: 'idle' },
      init: () => ({ types: [], found: false }),
      fetch: p.fetch,
      idOf: (e) => e.id,
      fold: () => false,
      before: async () => undefined,
      save: s.save,
      maxPages: 4,
    }).catch((e: unknown) => e);
    expect(r).toBeInstanceOf(ScanLimit);
    expect((r as ScanLimit).code).toBe('scan_too_many_pages');
  });
});

// ---------------------------------------------------------------------------
// 取得側の例外（PortError の timeout / 5xx 等）も「完了しなかった 1 回」として数える（契約 v3.4-36）

/** fetch の n 回目（0 始まり）以降で例外を投げる pager。投げた例外はそのまま呼び出し側へ出る */
function failingPager(events: Ev[], failFrom: number, err: Error, pageSize = 3) {
  const p = pager(events, pageSize);
  let n = 0;
  return {
    calls: p.calls,
    fetch: async (cursor: string | null) => {
      if (n++ >= failFrom) throw err;
      return p.fetch(cursor);
    },
  };
}

async function scanWith(
  s: ReturnType<typeof store>,
  fetch: (cursor: string | null) => Promise<{ data: Ev[]; next: string | null }>,
  o: { head?: string | null; budget?: number } = {},
) {
  return runScan<Ev, Agg>({
    saved: s.box.saved,
    base: { purpose: 'files', job_status: 'running', job_phase: 'making', session_status: 'idle' },
    ...(o.head !== undefined ? { head: o.head } : {}),
    init: () => ({ types: [], found: false }),
    fetch,
    idOf: (e) => e.id,
    fold: (agg, items) => {
      for (const e of items) agg.types.push(e.id);
      return false;
    },
    before: beforeWithBudget(o.budget ?? 100),
    save: s.save,
    maxPages: 500,
  }).catch((e: unknown) => e);
}

describe('runScan（取得側の例外も完了しなかった 1 回）', () => {
  // 取得側の PortError（timeout）。runScan は例外の種類を問わず数える（5xx も同じ経路）
  const timeout = new PortError(false, undefined, 'timeout');

  it('1 ページ目の取得が例外: 保存が無ければ文脈付きの空 state に stalls=1 を書き、同じ例外を投げ直す', async () => {
    const s = store();
    const r = await scanWith(s, failingPager(evs(10), 0, timeout).fetch);
    expect(r).toBe(timeout);
    const saved = s.box.saved as ScanState<Agg>;
    expect(saved.stalls).toBe(1);
    expect(saved.pages).toBe(0); // 次回は必ず restart
    expect(saved.ctx.purpose).toBe('files');
    expect(s.box.lastErrors).toEqual([]); // last_error は呼び出し側が例外の種類で残す
  });

  it('途中まで進んだ後の例外: 進んだ分の途中集計は残り、stalls も 1 として保存済み。次の呼び出しは続きから', async () => {
    const events = evs(10);
    const s = store();
    const r = await scanWith(s, failingPager(events, 2, timeout).fetch); // 2 ページ取って 3 回目の取得で例外
    expect(r).toBe(timeout);
    const saved = s.box.saved as ScanState<Agg>;
    expect(saved.pages).toBe(2);
    expect(saved.stalls).toBe(1);
    const p = pager(events);
    const done = (await scanWith(s, p.fetch)) as { agg: Agg };
    expect(p.calls).toEqual([null, 'c6', 'c9']);
    expect(done.agg.types).toEqual([...events].reverse().map((e) => e.id));
    expect((s.box.saved as ScanState<Agg>).stalls).toBe(0);
  });

  it(`取得の例外が続くと ${SCAN_MAX_STALLS} 回目で ScanStalled（時間切れと混ざっても数える）`, async () => {
    const s = store();
    const results: unknown[] = [];
    for (let i = 0; i < SCAN_MAX_STALLS + 1; i++) {
      // 奇数回は時間切れ（before が OutOfTime）、偶数回は取得の例外
      results.push(i % 2 === 1 ? await scanWith(s, pager(evs(10)).fetch, { budget: 0 }) : await scanWith(s, failingPager(evs(10), 0, timeout).fetch));
    }
    expect(results.slice(0, SCAN_MAX_STALLS - 1).every((r) => r === timeout || r instanceof OutOfTime)).toBe(true);
    expect(results[SCAN_MAX_STALLS - 1]).toBeInstanceOf(ScanStalled);
    expect(results[SCAN_MAX_STALLS]).toBeInstanceOf(ScanStalled);
    expect((s.box.saved as ScanState<Agg>).stalls).toBe(SCAN_MAX_STALLS);
  });

  it('所有権喪失など OutOfTime 以外の before の例外は数えない', async () => {
    const s = store();
    const lost = new Error('lost_lease');
    const r = await runScan<Ev, Agg>({
      saved: undefined,
      base: { purpose: 'files', job_status: 'running', job_phase: 'making', session_status: 'idle' },
      init: () => ({ types: [], found: false }),
      fetch: pager(evs(3)).fetch,
      fold: () => false,
      before: async () => {
        throw lost;
      },
      save: s.save,
      maxPages: 500,
    }).catch((e: unknown) => e);
    expect(r).toBe(lost);
    expect(s.box.saved).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// head 指定の経路（files の走査: 先頭 id は同じ呼び出しの idle 走査で取ったもの）

describe('runScan（head を外から与える経路）', () => {
  it('同じ head で途中なら続きから（1 ページ目の取り直しはしない）', async () => {
    const events = evs(10);
    const s = store();
    const a = await scanWith(s, pager(events).fetch, { head: 'sevt_9', budget: 2 });
    expect(a).toBeInstanceOf(OutOfTime);
    expect((s.box.saved as ScanState<Agg>).cursor).toBe('c6');
    const p = pager(events);
    const b = (await scanWith(s, p.fetch, { head: 'sevt_9' })) as { agg: Agg; head: string };
    expect(p.calls).toEqual(['c6', 'c9']);
    expect(b.head).toBe('sevt_9');
    expect(b.agg.types).toEqual([...events].reverse().map((e) => e.id));
  });

  it('同じ head で完了済みなら取得せずに集計を使う（reuse）', async () => {
    const events = evs(10);
    const s = store();
    const a = (await scanWith(s, pager(events).fetch, { head: 'sevt_9' })) as { agg: Agg };
    const p = pager(events);
    const b = (await scanWith(s, p.fetch, { head: 'sevt_9' })) as { agg: Agg; head: string };
    expect(p.calls).toEqual([]);
    expect(b.agg).toEqual(a.agg);
    expect(b.head).toBe('sevt_9');
  });

  it('head が違えば途中集計・完了済み集計とも捨てて先頭から（restart）', async () => {
    const events = evs(10);
    // 途中
    const s1 = store();
    await scanWith(s1, pager(events).fetch, { head: 'sevt_9', budget: 2 });
    const p1 = pager(events);
    const r1 = (await scanWith(s1, p1.fetch, { head: 'sevt_10' })) as { agg: Agg; head: string };
    expect(p1.calls[0]).toBeNull();
    expect(r1.head).toBe('sevt_10');
    expect(r1.agg.types.length).toBe(10); // 古い途中集計（6 件）が混ざらない
    // 完了済み
    const s2 = store();
    await scanWith(s2, pager(events).fetch, { head: 'sevt_9' });
    const p2 = pager(events);
    await scanWith(s2, p2.fetch, { head: null });
    expect(p2.calls).toEqual([null, 'c3', 'c6', 'c9']);
  });
});

describe('stateJsonForSave（D1 の行上限に当てない）', () => {
  it(`UTF-8 で ${STATE_MAX_BYTES} bytes を超える state は保存しない（null）。save_failures は書かない`, () => {
    expect(stateJsonForSave({ a: 1, save_failures: 2 })).toBe('{"a":1}');
    // 日本語は 1 文字 3 bytes: 文字数では上限未満でも bytes で超える
    const big = 'あ'.repeat(Math.ceil(STATE_MAX_BYTES / 3) + 10);
    expect(big.length).toBeLessThan(STATE_MAX_BYTES);
    expect(stateJsonForSave({ big })).toBeNull();
  });
});
