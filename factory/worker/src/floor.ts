// 純関数: 工場ビューの制作キュー 1 行の工程（契約 §N-2）。I/O を持たない。
// 判定表は上から評価し、最初に当たった行で決まる。auto_rework（isAutoDerived の結果）と needs_review（computeTriage の結果）は呼び出し側が渡す。

export const FLOOR_STEP_KEYS = ['order', 'questions', 'making', 'ingest', 'verify', 'review', 'publish'] as const;
export type FloorStepKey = (typeof FLOOR_STEP_KEYS)[number];
export type FloorStepState = 'done' | 'active' | 'waiting' | 'failed' | 'pending' | 'skipped';
export type FloorAttention = 'answer' | 'review' | 'failed' | 'budget' | null;

/** 工程の label（verbatim §N-2） */
export const FLOOR_STEP_LABEL: Record<FloorStepKey, string> = {
  order: '注文',
  questions: '質問',
  making: '制作',
  ingest: '取り込み',
  verify: '検証',
  review: '確認',
  publish: '公開',
};

/** verify_phase の日本語（§L-2 の 4 段） */
export const VERIFY_PHASE_LABEL: Record<string, string> = {
  to_submit: '送信待ち',
  submitting: '送信中',
  submitted: 'Batch 結果待ち',
  collecting: '回収中',
};

export interface FloorStep {
  key: FloorStepKey;
  label: string;
  state: FloorStepState;
  detail: string | null;
}

export interface FloorInput {
  material: { work_status: string; publish_status: string };
  /** active job。無ければ最後の job（24 時間以内）。どちらも無ければ null */
  job: {
    status: string;
    phase: string;
    kind: string;
    error: string | null;
    reconcile_stage: string;
    /** questions_json が null でない（職人が質問を書いた） */
    has_questions: boolean;
    /** isAutoDerived(job) */
    auto_rework: boolean;
  } | null;
  /** review の版。無ければ current_version。どちらも無ければ null */
  version: {
    status: string;
    verification_status: string;
    verify_phase: string | null;
    verify_turn: number;
    /** computeTriage の needs_review（review の版だけ。他は null） */
    needs_review: number | null;
  } | null;
  /** この素材の最後の承認 / 却下（review_decisions の approve / reject / return の最新）。「それ以外」の行で使う */
  last_decision: 'approve' | 'reject' | 'return' | null;
}

export interface FloorResult {
  steps: FloorStep[];
  progress_pct: number;
  attention: FloorAttention;
}

type Cell = FloorStepState | [FloorStepState, string];

function verifyRunningDetail(phase: string | null, turn: number): string {
  const base = (phase && VERIFY_PHASE_LABEL[phase]) || '検証中';
  return turn >= 1 ? `${base}・ターン ${turn}` : base;
}

/** 判定表（§N-2）の行を上から評価する。cells は 7 個（order, questions, making, ingest, verify, review, publish） */
function decide(input: FloorInput): { cells: Cell[]; progress: number; attention: FloorAttention } {
  const P: FloorStepState = 'pending';
  const job = input.job;
  const v = input.version;
  if (job) {
    const s = job.status;
    if (s === 'queued') return { cells: ['done', P, P, P, P, P, P], progress: 5, attention: null };
    if (s === 'creating') return { cells: ['done', ['active', '作業場を準備中'], P, P, P, P, P], progress: 10, attention: null };
    if (s === 'needs_answer') return { cells: ['done', ['waiting', '回答待ち'], P, P, P, P, P], progress: 15, attention: 'answer' };
    if (s === 'running' && job.phase === 'questions')
      return { cells: ['done', ['active', '職人が質問を考え中'], P, P, P, P, P], progress: 15, attention: null };
    if (s === 'running' && job.phase === 'making' && job.reconcile_stage === 'none')
      return { cells: ['done', 'done', ['active', '制作中'], P, P, P, P], progress: 40, attention: null };
    if (s === 'running' && job.phase === 'making' && job.reconcile_stage !== 'none')
      return { cells: ['done', 'done', 'done', ['active', '取り込み中'], P, P, P], progress: 60, attention: null };
    if (s === 'budget_reached') return { cells: ['done', 'done', ['waiting', '予算の上限'], P, P, P, P], progress: 40, attention: 'budget' };
    if (s === 'failed' && job.error === 'invalid_outputs')
      return { cells: ['done', 'done', 'done', ['failed', '取り込み失敗'], P, P, P], progress: 60, attention: 'failed' };
    if (s === 'failed') return { cells: ['done', 'done', ['failed', '失敗'], P, P, P, P], progress: 40, attention: 'failed' };
    if (s === 'cancelled')
      return { cells: ['done', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped', 'skipped'], progress: 0, attention: null };
  }
  if (v && v.status === 'review') {
    const vs = v.verification_status;
    if (vs === 'pending') return { cells: ['done', 'done', 'done', 'done', ['active', '検証の順番待ち'], P, P], progress: 65, attention: null };
    if (vs === 'running') {
      const turn = Math.max(0, Math.floor(Number(v.verify_turn) || 0));
      return {
        cells: ['done', 'done', 'done', 'done', ['active', verifyRunningDetail(v.verify_phase, turn)], P, P],
        progress: 70 + Math.min(turn, 7) * 2,
        attention: null,
      };
    }
    if (vs === 'failed') return { cells: ['done', 'done', 'done', 'done', ['failed', '検証失敗'], P, P], progress: 70, attention: 'failed' };
    if (vs === 'done') {
      const n = Number(v.needs_review ?? 0);
      return {
        cells: ['done', 'done', 'done', 'done', 'done', ['waiting', n > 0 ? `要確認 ${n}` : '確認待ち'], P],
        progress: 90,
        attention: 'review',
      };
    }
  }
  if (input.material.publish_status === 'available')
    return { cells: ['done', 'done', 'done', 'done', 'done', 'done', ['done', '利用できる']], progress: 100, attention: null };
  if (input.material.publish_status === 'stopped')
    return { cells: ['done', 'done', 'done', 'done', 'done', 'done', ['failed', '止めている']], progress: 100, attention: null };
  // それ以外（idle・版 rejected 等）: 最後に承認 / 却下があれば review を done / failed
  const review: FloorStepState =
    input.last_decision === 'approve' ? 'done' : input.last_decision === 'reject' || input.last_decision === 'return' ? 'failed' : 'skipped';
  return { cells: ['done', 'skipped', 'skipped', 'skipped', 'skipped', review, 'skipped'], progress: 0, attention: null };
}

export function floorSteps(input: FloorInput): FloorResult {
  const d = decide(input);
  const job = input.job;
  const steps: FloorStep[] = FLOOR_STEP_KEYS.map((key, i) => {
    const c = d.cells[i];
    const state = Array.isArray(c) ? c[0] : c;
    const detail = Array.isArray(c) ? c[1] : null;
    return { key, label: FLOOR_STEP_LABEL[key], state, detail };
  });
  if (job) {
    // order の label: 自動差し戻し由来なら「作り直し（自動）」、人の作り直しなら「作り直し」
    if (job.auto_rework) steps[0].label = '作り直し（自動）';
    else if (job.kind === 'rework') steps[0].label = '作り直し';
    // questions: rework で質問を飛ばした（phase が making で questions_json が null）なら skipped
    const q = steps[1];
    if (job.kind === 'rework' && job.phase === 'making' && !job.has_questions && (q.state === 'done' || q.state === 'pending')) {
      q.state = 'skipped';
      q.detail = null;
    }
  }
  return { steps, progress_pct: d.progress, attention: d.attention };
}

/** 行が「動いている」か（並び順の 2 番目の群）: active / waiting の工程がある、または job が終端でない */
export function floorRowMoving(r: FloorResult, jobActive: boolean): boolean {
  return jobActive || r.steps.some((s) => s.state === 'active' || s.state === 'waiting');
}
