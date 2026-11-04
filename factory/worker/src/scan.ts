// 走査（events / files のページ送り）を「続き位置と途中集計」ごと保存して、時間切れの後に続きから再開する（契約 §B-4-d「最後のページまで」/ §R-32）。
// ここは I/O を持たない部分（state の生成・再開可否・連続時間切れの計数）と、I/O を引数で受け取る走査ドライバだけ。
// 保存先（factory_jobs.reconcile_state_json の scan.<目的>）と所有権の条件（reconcile_token / answer_token）は呼び出し側が持つ。
// state にはページ本文を入れない（集計値・id・件数だけ）。

import type { Page } from './anthropic';

export class OutOfTime extends Error {
  /** true: この呼び出しでは 1 ページも進めなかった（last_error='scan_no_progress' を残した） */
  constructor(public readonly noProgress = false) {
    super('out_of_time');
    this.name = 'OutOfTime';
  }
}

/** 同じ走査目的で、完了せずに終わった呼び出しが N 回続いた */
export class ScanStalled extends Error {
  constructor() {
    super('scan_stalled');
    this.name = 'ScanStalled';
  }
}

/** ページ数・件数の上限に達した（何度やり直しても同じなので終端にする） */
export class ScanLimit extends Error {
  constructor(public readonly code: 'scan_too_many_pages' | 'too_many_files') {
    super(code);
    this.name = 'ScanLimit';
  }
}

/** 時間切れが同じ走査で連続この回数になったら failed（last_error='scan_stalled'） */
export const SCAN_MAX_STALLS = 8;

/**
 * 走査を始めた時点の文脈。再開時に 1 つでも違えば途中集計を捨てて先頭から。
 * - head: events を新しい順（desc）に読んだ 1 ページ目の先頭 event の id（events が無ければ null）。
 *   SDK の型（BetaManagedAgents*Event）で全 event が持つ `id` を使う。desc 走査の途中で新しい event が頭に増えると、
 *   保存した続き位置からは見えない（既に通り過ぎた側に増える）ので、先頭 id が変わったら集計をやり直す。
 *   session の `updated_at`（BetaManagedAgentsSession.updated_at）も取れるが、event 追加で必ず変わるとは型にも docs にも書かれていないので使わない。
 *   files の走査は events の先頭 id（同じ呼び出しの idle 走査で確かめたもの）を head に使う（成果物は event と一緒にしか増えない）。
 * - session_status: retrieve で読んだ session.status（answer は retrieve しないので null。状態が変わる時は status 系 event も増えるので head で捕まる）
 */
export interface ScanCtx {
  purpose: string;
  job_status: string;
  job_phase: string;
  session_status: string | null;
  head: string | null;
}

export interface ScanState<A> {
  ctx: ScanCtx;
  /** 次に取るページの token（page）。null かつ pages=0 は「まだ 1 ページも取っていない」 */
  cursor: string | null;
  /** 走査済みページ数・件数（この走査の合計。呼び出しをまたいで足す） */
  pages: number;
  seen: number;
  agg: A;
  /** 最後のページまで辿った、または打ち切り条件に当たった */
  done: boolean;
  /** この走査目的で、完了せずに終わった呼び出しの連続回数（完了で 0） */
  stalls: number;
}

export function sameScanCtx(a: ScanCtx, b: ScanCtx): boolean {
  return (
    a.purpose === b.purpose &&
    a.job_status === b.job_status &&
    a.job_phase === b.job_phase &&
    a.session_status === b.session_status &&
    a.head === b.head
  );
}

function isScanState(x: unknown): x is ScanState<unknown> {
  const s = x as ScanState<unknown> | null;
  return (
    !!s &&
    typeof s === 'object' &&
    !!s.ctx &&
    typeof s.ctx === 'object' &&
    typeof s.ctx.purpose === 'string' &&
    (s.cursor === null || typeof s.cursor === 'string') &&
    Number.isInteger(s.pages) &&
    Number.isInteger(s.seen) &&
    typeof s.done === 'boolean' &&
    Number.isInteger(s.stalls) &&
    s.agg !== undefined
  );
}

/**
 * 保存済みの走査をどう扱うか。
 * - reuse: 同じ文脈で完了済み → 集計をそのまま使う
 * - resume: 同じ文脈で途中 → 続き位置から
 * - restart: 無い / 形が違う / 文脈が 1 つでも違う / まだ 1 ページも取っていない → 先頭から
 */
export function decideResume(saved: unknown, cur: ScanCtx): 'reuse' | 'resume' | 'restart' {
  if (!isScanState(saved) || !sameScanCtx(saved.ctx, cur)) return 'restart';
  if (saved.done) return 'reuse';
  if (saved.pages === 0) return 'restart';
  return 'resume';
}

/** 同じ目的の保存済み走査から連続時間切れ回数を引き継ぐ（文脈が変わって先頭からやり直す時も引き継ぐ。頭が増え続けて完了しない走査を止めるため） */
export function carriedStalls(saved: unknown, purpose: string): number {
  return isScanState(saved) && saved.ctx.purpose === purpose ? Math.max(0, saved.stalls) : 0;
}

export const isStalled = (stalls: number): boolean => stalls >= SCAN_MAX_STALLS;

export function newScanState<A>(ctx: ScanCtx, agg: A, stalls: number): ScanState<A> {
  return { ctx, cursor: null, pages: 0, seen: 0, agg, done: false, stalls };
}

/** 1 ページを集計に足す。fold が true を返したら打ち切り（done） */
export function applyPage<T, A>(
  st: ScanState<A>,
  p: Page<T>,
  fold: (agg: A, items: T[]) => boolean,
  limits: { maxPages: number; maxItems?: number },
): void {
  st.pages += 1;
  st.seen += p.data.length;
  if (limits.maxItems !== undefined && st.seen > limits.maxItems) throw new ScanLimit('too_many_files');
  const stop = fold(st.agg, p.data);
  st.cursor = p.next;
  st.done = stop || !p.next;
  if (!st.done && st.pages >= limits.maxPages) throw new ScanLimit('scan_too_many_pages');
}

export interface ScanIO<T, A> {
  /** reconcile_state_json.scan.<目的> に保存されていた値（形は検査する） */
  saved: unknown;
  base: Omit<ScanCtx, 'head'>;
  /** head を外から与える（files）。undefined なら 1 ページ目（page=null）の先頭 id を head にする（events desc） */
  head?: string | null;
  init: () => A;
  fetch: (cursor: string | null) => Promise<Page<T>>;
  idOf?: (item: T) => string | null;
  /** 集計に足す。true で打ち切り */
  fold: (agg: A, items: T[]) => boolean;
  /** 外部呼び出しの前に毎回（残り時間の確認と所有権の延長。OutOfTime / 所有権喪失を投げる） */
  before: () => Promise<void>;
  /** 途中集計の保存（所有権付き）。lastError を渡されたら last_error にも残す */
  save: (st: ScanState<A>, lastError?: string) => Promise<void>;
  maxPages: number;
  maxItems?: number;
}

/**
 * 保存済みの途中集計から再開できる走査。ページごとに save し、時間切れ（before が OutOfTime）で抜ける前にも必ず保存する。
 * 1 ページも進めずに時間切れなら last_error='scan_no_progress' を残す。連続時間切れが SCAN_MAX_STALLS 回で ScanStalled。
 */
export async function runScan<T, A>(io: ScanIO<T, A>): Promise<{ agg: A; head: string | null }> {
  const prev = carriedStalls(io.saved, io.base.purpose);
  if (isStalled(prev)) throw new ScanStalled();
  const stalls = prev + 1; // この呼び出しが完了しなければ 1 回分の時間切れとして残る
  const limits = { maxPages: io.maxPages, maxItems: io.maxItems };
  let st: ScanState<A> | null = null;
  let progressed = false;

  const guard = async (): Promise<void> => {
    try {
      await io.before();
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      if (!progressed) {
        // 1 ページも進めなかった: 回数だけ足して残す。前回までの途中集計があれば消さずにそのまま（文脈が同じなら次回も続きから）、
        // 無ければ文脈不明の空 state（pages=0 は次回必ず restart）
        const keep =
          st ??
          (isScanState(io.saved) && io.saved.ctx.purpose === io.base.purpose
            ? (io.saved as ScanState<A>)
            : newScanState<A>({ ...io.base, head: null }, io.init(), stalls));
        await io.save({ ...keep, stalls }, 'scan_no_progress');
        if (isStalled(stalls)) throw new ScanStalled();
        throw new OutOfTime(true);
      }
      // 進んだ分はページごとに保存済み（stalls も同じ値で書いてある）
      if (isStalled(stalls)) throw new ScanStalled();
      throw new OutOfTime(false);
    }
  };

  const step = async (p: Page<T>): Promise<void> => {
    applyPage(st!, p, io.fold, limits);
    progressed = true;
    if (!st!.done) await io.save(st!);
  };

  /** 完了済みの集計をそのまま使う（完了は連続時間切れを 0 に戻す） */
  const reuse = async (head: string | null): Promise<{ agg: A; head: string | null }> => {
    const saved = io.saved as ScanState<A>;
    if (saved.stalls !== 0) await io.save({ ...saved, stalls: 0 });
    return { agg: saved.agg, head };
  };

  if (io.head !== undefined) {
    const cur: ScanCtx = { ...io.base, head: io.head };
    const d = decideResume(io.saved, cur);
    if (d === 'reuse') return reuse(cur.head);
    st = d === 'resume' ? { ...(io.saved as ScanState<A>), stalls } : newScanState(cur, io.init(), stalls);
  } else {
    // 1 ページ目で head を確かめる。続きから再開する時はこのページは集計済みなので捨てる
    await guard();
    const first = await io.fetch(null);
    const head = first.data.length > 0 ? (io.idOf?.(first.data[0]) ?? null) : null;
    const cur: ScanCtx = { ...io.base, head };
    const d = decideResume(io.saved, cur);
    if (d === 'reuse') return reuse(head);
    if (d === 'resume') {
      st = { ...(io.saved as ScanState<A>), stalls };
    } else {
      st = newScanState(cur, io.init(), stalls);
      await step(first);
    }
  }

  while (!st.done) {
    await guard();
    await step(await io.fetch(st.cursor));
  }
  st.stalls = 0;
  await io.save(st);
  return { agg: st.agg, head: st.ctx.head };
}

// ---------------------------------------------------------------------------
// reconcile_state_json の保存前ガード（D1 の行上限 2,000,000 bytes に当てない。https://developers.cloudflare.com/d1/platform/limits/）

export const STATE_MAX_BYTES = 1_500_000;
/** 保存の失敗（例外）がこの回数続いたら failed（last_error='save_failed'） */
export const SAVE_FAILURES_MAX = 3;

export const utf8Bytes = (s: string): number => new TextEncoder().encode(s).byteLength;

/** 保存する JSON を作る。save_failures は保存が成功した時点で 0 に戻すので書かない。上限超過なら null */
export function stateJsonForSave(state: Record<string, unknown>): string | null {
  const { save_failures: _drop, ...rest } = state;
  const json = JSON.stringify(rest);
  return utf8Bytes(json) > STATE_MAX_BYTES ? null : json;
}
