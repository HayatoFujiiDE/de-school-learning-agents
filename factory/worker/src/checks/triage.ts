// 確認の仕分け（契約 V-6。§L-3 を置き換え）。純関数 triageVersion(input)。
// 「機械が直させる所（fix）」「人にしか決められない所（ask）」「通して印だけ付ける所（note）」を 1 件 1 項目（items）にし、
// 6 項目の自動 OK・gate（clean / attention / pending）・reasons・自動の処置（none / auto_return / reverify）・return_note を決める。
// groups・ok_counts は §L-3 のまま計算して残す（工場ビュー src/routes/floor.ts と古い呼び出しの互換。新しい画面は使わない）。
// 入力（claims_json / result_json / material_json / reader_json / 出典 id / 動画の公式の情報）は職人・検証係・読み手係・YouTube が書いた信頼できない値なので、
// キー照合は Map / Set で行い（継承プロパティを踏まない）、形が違う値は黙って飛ばす（例外を投げない）。detail などの文は長さを切る。
// §Q-11 9: 動画の出典（版の動画の source_id が指す行で、url がその動画の watch URL と一致するもの）は、開けたか・引用の検査と、
// 引用の不一致の割合の集計（分子・分母）から外す。
// §AJ-3: 立体モデルの出典（版の立体モデルの source_id が指す行で、url が一覧の page_url と一致するもの）も同じく外す（職人はページを開けない）。
// 立体モデルは v1 では機械が中身を見ないので、1 件ごとに「人が回して見る」の ask を出す（自動公開しない）。
// §MC-2: 版が決まっている題材（Minecraft）だけ、版の宣言（edition_missing / edition_not_java）と動画の公開日（video_too_old / video_date_unknown）の項目を足す。
// 本文の版の 1 文（edition_text_missing）は取り込みの機械検査（checks_json.child_text の edition_text）から作る。版が決まっていない題材には何も足さない。
// §AL-5: child_text の新しい kind（schema 2 の版だけ出る）→ 項目 text:<kind>:<path>（first_paragraph_not_action は note、ほかは fix）。
// 新しい cause は ITEM_TITLE にだけ足す（出典 group 用の Cause・CAUSE_TEXT は変えない）。return_note の scope / text は版で分ける。

import { CHILD_TEXT_KINDS, type ChildTextKind } from './childtext';
import { model3dSourceIds, videoSourceIds } from './citations';
import { declaredEdition, isVersionBoundMaterial, isVideoTooOld, parsePublishedDay } from './edition';
import { PRIMARY_HOSTS } from './hosts';
import { figureShowsMetaOf } from './schema';
import { schemaVersionOf, type SchemaVersion } from './shape';
import { versionVideosOfMaterial } from '../videos';
import { MODELS3D_BY_ID, versionModels3dOfMaterial } from '../models3d';

export type Cause =
  | 'contradicted'
  | 'source_not_listed'
  | 'maker_url_not_fetched'
  | 'quote_mismatch'
  | 'verifier_limit'
  | 'not_confirmed'
  | 'no_source'
  | 'license_unknown'
  // §MC-2（版が決まっている題材の項目の原因。groups には出ない）
  | 'edition_missing'
  | 'edition_not_java'
  | 'video_too_old'
  | 'video_date_unknown'
  | 'edition_text_missing';

export type Reason = 'contradicted' | 'few_confirmed' | 'quote_mismatch_many' | 'needs_fix' | 'many_hypotheses';
/** §L-3 の古い 3 項目（工場ビューと古い呼び出しが使う。6 項目の一覧は CHECK_KEYS） */
export type AutoItem = 'content_and_evidence' | 'terms_of_use' | 'artifact_behavior';
export const AUTO_ITEMS: readonly AutoItem[] = ['content_and_evidence', 'terms_of_use', 'artifact_behavior'];

/** 6 項目（契約 V-6 b の CheckKey。並びは確認画面の checklist と同じ） */
export type CheckKey = 'content_and_evidence' | 'explanation_and_expression' | 'relation_to_learning' | 'conditions_of_use' | 'artifact_behavior' | 'terms_of_use';
export const CHECK_KEYS: readonly CheckKey[] = [
  'content_and_evidence',
  'explanation_and_expression',
  'relation_to_learning',
  'conditions_of_use',
  'artifact_behavior',
  'terms_of_use',
];
/** return_note の項目名（契約 V-6 g） */
export const CHECK_KEY_LABEL: Record<CheckKey, string> = {
  content_and_evidence: '内容と根拠',
  explanation_and_expression: '説明と表現',
  relation_to_learning: '学習との関係',
  conditions_of_use: '使う条件',
  artifact_behavior: '生成物の動作',
  terms_of_use: '利用条件',
};

/** 原因の文（§L-6 の表。verbatim。groups の原因） */
export const CAUSE_TEXT: Record<Cause, string> = {
  contradicted: '出典と食い違う',
  source_not_listed: '出典一覧にない出典',
  maker_url_not_fetched: '職人がこの URL を開けていない',
  quote_mismatch: '引用が出典の本文と一致しない',
  verifier_limit: '検証係が開ききれなかった（取得の上限）',
  not_confirmed: '出典で確かめられなかった',
  no_source: '出典が付いていない',
  license_unknown: '利用条件が分からない',
  // §MC-2（verbatim）
  edition_missing: '使う条件に Minecraft の版（Java 版 ○○）が書かれていない',
  edition_not_java: 'Java 版でない版（統合版）を宣言している',
  video_too_old: '動画の公開日が 3 年より前（古い情報）',
  video_date_unknown: '動画の公開日が取れていない',
  edition_text_missing: '本文に版（Java 版 ○○）の 1 文が無い',
};

/** §MC-2: 差し戻し文の detail（verbatim。<版> は職人が書く版の置き場所） */
export const EDITION_DECLARE_DETAIL = 'conditions.tools に『Minecraft Java 版 <版>』の形で書く（最新の正式版は version manifest の latest.release）';
export const videoAgeDetail = (published: string): string => `公開日 ${published} の動画。3 年以内の Java 版の動画に替えるか、動画なしにする`;
export const editionTextDetail = (path: string, version: string): string => `${path} に『この説明は Java 版 ${version} のものです。』の 1 文を入れる`;

/** return_note の固定文（§L-3 の固定文。verbatim。§Q-11 9 で「開けなかったページは出典に使わない」の後に動画の出典の例外の一言を足した） */
export const RETURN_FIXED_TEXT =
  '出典の URL は web_fetch で本文が返った URL を一字も変えずに書く。引用は本文の一続きをそのまま写す。開けなかったページは出典に使わない。動画（YouTube）の出典の行は別で、開けなくても書いてよい。主張には必ず出典 id を付け、その id を sources.json に入れる。';

/** report.meta.fetch_errors のうち「検証係の取得上限」とみなすエラーコード */
const VERIFIER_LIMIT_ERRORS = ['max_uses_exceeded', 'too_many_requests', 'unavailable'];

/** 割合の項目は claims がこの件数以上の時だけ数える（少ない時は割合で判定しない §R-49 (g)） */
export const MIN_CLAIMS_FOR_REASONS = 5;

/** detail の長さの上限（契約 V-6 b） */
export const ITEM_DETAIL_MAX = 600;
/** return_note の長さの上限（契約 V-6 g） */
export const RETURN_NOTE_MAX = 4000;

export type Severity = 'fix' | 'ask' | 'note';
export type ItemKind = 'claim' | 'source' | 'figure' | 'app' | 'video' | 'model3d' | 'text' | 'reader' | 'learning' | 'conditions' | 'check';
export interface TriageItem {
  id: string;
  kind: ItemKind;
  key: CheckKey;
  severity: Severity;
  cause: string;
  title: string;
  detail: string;
  /** true = 人が「このまま出す」にできない（承認の事前チェックが止める） */
  blocking?: boolean;
  claim_id?: string;
  source_ids?: string[];
  path?: string;
  quote?: string;
  suggestion?: string;
  video_id?: string;
  channel_key?: string;
  channel_name?: string;
  /** §AJ-3: 立体モデルの項目（kind model3d）だけ */
  model3d_id?: string;
  catalog_id?: string;
}

/** 項目の title（契約 V-6 c の表。verbatim）。cause → title */
export const ITEM_TITLE: Record<string, string> = {
  // 主張
  contradicted: '出典と食い違う',
  no_source: '出典が付いていない',
  source_not_listed: '出典一覧にない出典',
  primary_source_unfetched: '確かとした主張の一次資料を、職人が開けていない',
  maker_url_not_fetched: '職人がこの URL を開けていない',
  quote_mismatch: '引用が出典の本文と一致しない',
  verifier_limit: '検証係が開ききれなかった（取得の上限）',
  not_confirmed: '出典で確かめられなかった',
  stated_as_fact: '言い切れない内容を、本文が事実として書いている',
  hypothesis_hedged: '仮説として書いてある',
  analogy: 'たとえとして書いてある',
  hypothesis_unused: '本文に出てこない仮説',
  hypothesis_unjudged: '仮説の主張（本文の書き方を機械が見ていない）',
  no_claims: '主張が 1 件もない（事実を述べる所が無いかを見てください）',
  none_confirmed: '確かめられた主張が 1 件もない',
  // 出典
  license_unknown: '利用条件が分からない',
  no_sources: '出典が 1 件もない',
  // 図
  figure_problem: '図に問題がある',
  figure_unclear: '図を機械では決められなかった',
  figure_not_seen: '図を機械が見ていない',
  // 動かせるもの
  app_problem: '動かせるものに問題がある',
  app_unclear: '動かせるものを機械では決められなかった',
  app_not_judged: '動かせるものを機械が見ていない',
  // 機械検査
  forbidden_word: '使わない言葉が入っている',
  kakunin_zumi: '『確認済み』と書いてある',
  app_external: '動かせるものが外部を読み込んでいる',
  missing_ref: '本文と主張・出典の番号が合わない',
  file_name: '本文にファイル名が出ている',
  raw_markup: '記法の記号がそのまま見える',
  checks_missing: '機械検査の結果が読めない',
  // 絵の主張（§O-13-4 4）
  figure_shows_missing: 'scientific の画像に絵の主張（shows）が無い',
  figure_shows_ref: '絵の主張の出典 id が出典一覧に無い',
  figure_shows_no_primary: '絵の主張に一次の出典が無い',
  figure_shows_removed: '作り直しで絵の主張が減った（同じ画像）',
  // 動画
  video_problem: '動画に問題がある',
  video_unclear: '動画を機械では決められなかった',
  video_not_seen: '動画を機械が見ていない',
  video_meta_unknown: 'YouTube の公式の情報が取れていない',
  video_channel_mismatch: 'チャンネル名が公式の情報と違う',
  video_channel_new: '初めてのチャンネル（本人のアップかを見てください）',
  // 立体モデル（§AJ-3。項目の title は一覧の題名にし、この文は detail に入れる）
  model3d_human: '立体モデル（人が回して見てください）',
  model3d_missing: '立体モデルが一覧に無い（一覧を直すか、素材を作り直す）',
  // 読み手係（finding の kind）
  word: '言葉がむずかしい',
  sentence: '文が分かりにくい',
  structure: '流れが分かりにくい',
  mismatch: '本文と図・動かせるものが合わない',
  tone: '言い方が気になる',
  other: '読み手がつまずく',
  learning_problem: '学習とのつながりが弱い',
  learning_unclear: '学習とのつながりを機械では決められなかった',
  conditions_problem: '使う条件が本文と合わない',
  conditions_unclear: '使う条件を機械では決められなかった',
  // 割合
  many_hypotheses: '仮説の主張が 3 分の 1 を超えている',
  few_confirmed: '確かめられた主張が半分に届かない',
  quote_mismatch_many: '引用が本文と一致しない出典が多い',
  // 版が決まっている題材（§MC-2。CAUSE_TEXT と同じ文）
  edition_missing: CAUSE_TEXT.edition_missing,
  edition_not_java: CAUSE_TEXT.edition_not_java,
  video_too_old: CAUSE_TEXT.video_too_old,
  video_date_unknown: CAUSE_TEXT.video_date_unknown,
  edition_text_missing: CAUSE_TEXT.edition_text_missing,
  // §AL-5: 子ども向けの文の検査 v2（child_text の kind。schema 2 の版だけ）と、読み手係の質の 4 項目（契約 AL-5。verbatim）
  goal_word: '目標の言い回しがある（目標・ねらい・学ぼう など）',
  body_too_long: '本文が長い（1000 字の目安を大きく超えている）',
  body_too_short: '本文が短すぎる（150 字に満たない）',
  questions_missing: '問いの種が足りない（各部品に 2 件以上）',
  first_paragraph_not_action: '最初の段落が動作の文で始まっていないかもしれない',
  quality_first_action: '最初の段落が説明や前置きから始まっている',
  quality_questions_first: '問いが答えより後にある、または問いに答えが書かれている',
  quality_one_idea_per_paragraph: '1 つの段落に新しいことが 2 つ以上ある',
  quality_no_goal_words: '目標の言い回しがある（読み手係の指摘）',
};

/** §AL-5: child_text の kind のうち、項目 text:<kind>:<path>（cause = kind）にするものの severity。既存 3 kind（file_name / raw_markup / edition_text）は従来の扱い */
export const CHILD_TEXT_V2_SEVERITY: Record<Exclude<ChildTextKind, 'file_name' | 'raw_markup' | 'edition_text'>, Severity> = {
  goal_word: 'fix',
  body_too_long: 'fix',
  body_too_short: 'fix',
  questions_missing: 'fix',
  first_paragraph_not_action: 'note',
};

/** 項目の原因の一覧（ITEM_TITLE のキー。§S v2 B 7 の機械の差し戻しの checklist に書いてよい値） */
export const ITEM_CAUSES: readonly string[] = Object.keys(ITEM_TITLE);
/** 原因ごとの数の上限（書く時も読む時も切る） */
export const AUTO_CAUSE_MAX = 999;

/**
 * 機械の差し戻しの checklist_json（§S v2 B 7）。自動の承認（AUTO_CHECKLIST_JSON）と同じ形で 6 項目を書き、
 * 直す必要のある項目（severity = 'fix'）がある観点を ng、それ以外を ok にする。ng の観点には原因ごとの数（causes。ITEM_CAUSES の値と整数だけ）を添える。
 * 職人の出力の文字列は入れない（改善係へ渡すのはこの列挙と数だけ。注入の経路を作らない）
 */
export function autoReturnChecklistJson(items: readonly TriageItem[]): string {
  const per = new Map<CheckKey, Map<string, number>>();
  for (const i of items) {
    if (i.severity !== 'fix' || !CHECK_KEYS.includes(i.key)) continue;
    const m = per.get(i.key) ?? new Map<string, number>();
    per.set(i.key, m);
    if (ITEM_CAUSES.includes(i.cause)) m.set(i.cause, Math.min(AUTO_CAUSE_MAX, (m.get(i.cause) ?? 0) + 1));
  }
  return JSON.stringify(
    Object.fromEntries(
      CHECK_KEYS.map((k) => {
        const m = per.get(k);
        if (!m) return [k, { result: 'ok', note: 'auto' }];
        const causes = Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
        return [k, { result: 'ng', note: 'auto', causes }];
      }),
    ),
  );
}

/**
 * 機械の差し戻しの checklist_json から原因ごとの数を読む（観点をまたいで足す）。読む側でも一覧と照合し直す:
 * 知らない観点・知らない原因・整数でない数は捨て、数は 1〜AUTO_CAUSE_MAX に切る。読めなければ空
 */
export function autoReturnCauses(checklistJson: string | null | undefined): Record<string, number> {
  let o: unknown = null;
  try {
    o = checklistJson ? JSON.parse(checklistJson) : null;
  } catch {
    o = null;
  }
  const out: Record<string, number> = {};
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out;
  const rec = o as Record<string, unknown>;
  for (const k of CHECK_KEYS) {
    const item = Object.hasOwn(rec, k) ? rec[k] : undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const it = item as Record<string, unknown>;
    if (it.result !== 'ng') continue;
    for (const [cause, n] of Object.entries(cleanCauses(it.causes))) out[cause] = Math.min(AUTO_CAUSE_MAX, (out[cause] ?? 0) + n);
  }
  return cleanCauses(out);
}

/** 原因ごとの数を一覧と照合し直す（知らない原因・整数でない数・1 未満を捨て、AUTO_CAUSE_MAX に切る。キーの順に並べる） */
export function cleanCauses(v: unknown): Record<string, number> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const c = v as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const cause of [...ITEM_CAUSES].sort()) {
    const n = Object.hasOwn(c, cause) ? c[cause] : undefined;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) continue;
    out[cause] = Math.min(AUTO_CAUSE_MAX, n);
  }
  return out;
}

/** 読み手係ができなかった・全部を読めていない時の 3 項目の title（契約 V-6 c。verbatim） */
export const READER_FALLBACK_TITLE: Record<'reader_failed' | 'reader_partial', Record<'explanation_and_expression' | 'relation_to_learning' | 'conditions_of_use', string>> = {
  reader_failed: {
    explanation_and_expression: '読み手チェックができなかった: 説明と表現（子どもの画面を見て決めてください）',
    relation_to_learning: '読み手チェックができなかった: 学習との関係',
    conditions_of_use: '読み手チェックができなかった: 使う条件',
  },
  reader_partial: {
    explanation_and_expression: '読み手チェックが全部を読めていない: 説明と表現（子どもの画面を見て決めてください）',
    relation_to_learning: '読み手チェックが全部を読めていない: 学習との関係',
    conditions_of_use: '読み手チェックが全部を読めていない: 使う条件',
  },
};

/** return_note の文（契約 V-6 g。verbatim） */
export const RETURN_NOTE_TEXT = {
  head: (n: number) => `自動の差し戻し（${n} 回目。機械の確認で、直す所が見つかりました）。`,
  scope:
    '前の版から始めて、下の一覧の所と、それに合わせて直す必要がある所（claims・sources・変奏どうし・図や動かせるものの中の同じ記述）だけを直してください。関係のない所は変えないでください。',
  claims:
    '確かめられなかった主張は、(1) 開ける別の出典で確かめ直す (2) それができなければ、本文を「〜と考えられています」「たしかめてみよう」のような推測・問いの書き方に直し、claims の status を hypothesis にする（hypothesis の claim が全体の 3 分の 1 を超えない時だけ）(3) それも合わなければ、その主張を本文と claims から外す、の順で直してください。',
  manyHypotheses: (h: number, n: number) =>
    `仮説の主張が多すぎます（仮説 ${h} 件 / 全 ${n} 件）。仮説のうち、開ける出典で確かめられるものは確かめて confirmed にし、できないものは本文と claims から外して、仮説を全体の 3 分の 1 以内にしてください。新しい仮説を増やさないでください。`,
  license: '利用条件が分からない出典は、利用条件（ライセンス）が分かる別の出典に差し替えるか、その出典だけが支えている主張を外してください。',
  text: '子ども向けの本文には、ファイル名（app.html・figure-1.svg など）や作る側の言葉を書かないでください。動かせるものは「さわってみよう」、図は「図」と呼びます。直した所は、小学生・中学生・短い・長い・ゲーム版のすべてでそろえてください。',
  more: (k: number) => `（ほか ${k} 件）`,
} as const;

/** return_note の文の schema 2 の版（契約 §AL-5。scope と text だけが schema 1 と違う。verbatim） */
export const RETURN_NOTE_TEXT_V2 = {
  ...RETURN_NOTE_TEXT,
  scope:
    '前の版から始めて、下の一覧の所と、それに合わせて直す必要がある所（claims・sources・本文と問い・入口・図や動かせるものの中の同じ記述）だけを直してください。関係のない所は変えないでください。',
  text: '子ども向けの本文には、ファイル名（app.html・figure-1.svg など）や作る側の言葉を書かないでください。動かせるものは「さわってみよう」、図は「図」と呼びます。直した所は本文（body.md）と、あれば遊びの形（play.md）・問いの種・関心別の入口でそろえてください。',
} as const;

/** 版の return_note の文（schemaVersionOf(material) が 2 なら RETURN_NOTE_TEXT_V2、それ以外は RETURN_NOTE_TEXT） */
export function returnNoteTextOf(material: unknown): typeof RETURN_NOTE_TEXT | typeof RETURN_NOTE_TEXT_V2 {
  return schemaVersionOf(material) === 2 ? RETURN_NOTE_TEXT_V2 : RETURN_NOTE_TEXT;
}

// ---------------------------------------------------------------------------------------------
// 読み手係の結果の形（契約 V-4 e・f。reader.ts の parseReading が作り、reader_json に {v:1, model, …, not_read} で保存する。
// schema 2 の版は {v:2, model, …, quality, not_read}（契約 AL-4）

export const READER_FINDING_KINDS = ['word', 'sentence', 'structure', 'mismatch', 'tone', 'other'] as const;
export type ReaderFindingKind = (typeof READER_FINDING_KINDS)[number];
export const READER_SEVERITIES = ['fix', 'note'] as const;
export const READER_VERDICTS = ['ok', 'problem', 'unclear'] as const;
export type ReaderVerdict = (typeof READER_VERDICTS)[number];
export interface ReaderFinding {
  path: string;
  quote: string;
  kind: ReaderFindingKind;
  severity: 'fix' | 'note';
  note: string;
  suggestion: string;
}
export interface ReaderJudgement {
  verdict: ReaderVerdict;
  reason: string;
}
/** 読み手係の素材の形の判定（schema 2 の版だけ。契約 AL-4）の 4 キー */
export const READER_QUALITY_KEYS = ['first_action', 'questions_first', 'one_idea_per_paragraph', 'no_goal_words'] as const;
export type ReaderQualityKey = (typeof READER_QUALITY_KEYS)[number];
export type ReaderQuality = Record<ReaderQualityKey, ReaderJudgement>;
export interface ReaderResult {
  findings: ReaderFinding[];
  learning: ReaderJudgement;
  conditions: ReaderJudgement;
  summary: string;
  not_read: string[];
  /** schema 2 の版だけ（v === 2 で quality の 4 キーが揃っている時） */
  quality?: ReaderQuality;
  v?: number;
}

const inList = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === 'string' && (list as readonly string[]).includes(v);

/** quality の 4 キー（各 verdict が READER_VERDICTS・reason が文字列）→ 値。1 つでも欠けた・形が違えば null */
function readQuality(raw: unknown): ReaderQuality | null {
  if (!isObj(raw)) return null;
  const out: Partial<ReaderQuality> = {};
  for (const k of READER_QUALITY_KEYS) {
    const j = raw[k];
    if (!isObj(j) || !inList(READER_VERDICTS, j.verdict) || typeof j.reason !== 'string') return null;
    out[k] = { verdict: j.verdict, reason: j.reason };
  }
  return out as ReaderQuality;
}

/**
 * reader_json を parse した値 → 読み手係の結果。形が違えば null（壊れた reader_json は「読み手チェックができなかった」として扱う）。
 * schema は版の schemaVersionOf(material)。schema 2 の版は v === 2 かつ quality の 4 キーが揃っていなければ null
 * （v2 を知らない Worker が書いた結果を clean と読まない。契約 AL-4）。schema 1 の版は従来どおり（quality があっても見ない）
 */
export function readReaderResult(raw: unknown, schema: SchemaVersion): ReaderResult | null {
  if (!isObj(raw) || !Array.isArray(raw.findings) || !isObj(raw.learning) || !isObj(raw.conditions)) return null;
  if (!inList(READER_VERDICTS, raw.learning.verdict) || !inList(READER_VERDICTS, raw.conditions.verdict)) return null;
  const quality = schema === 2 && raw.v === 2 ? readQuality(raw.quality) : null;
  if (schema === 2 && !quality) return null;
  const findings: ReaderFinding[] = [];
  for (const f of raw.findings) {
    if (!isObj(f) || !inList(READER_FINDING_KINDS, f.kind) || !inList(READER_SEVERITIES, f.severity)) return null;
    findings.push({ path: str(f.path), quote: str(f.quote), kind: f.kind, severity: f.severity, note: str(f.note), suggestion: str(f.suggestion) });
  }
  return {
    findings,
    learning: { verdict: raw.learning.verdict, reason: str(raw.learning.reason) },
    conditions: { verdict: raw.conditions.verdict, reason: str(raw.conditions.reason) },
    summary: str(raw.summary),
    not_read: strList(raw.not_read),
    ...(quality ? { v: 2, quality } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// 入力・出力

export interface TriageClaim {
  id: string;
  source_ids?: unknown;
  [k: string]: unknown;
}
export interface TriageSource {
  source_id: string;
  url: string;
  license: string;
  url_was_fetched: number;
  quote_found: number;
  /** 一次資料か（契約 V-6 a）。無い時は 0 */
  is_primary?: number;
}
export interface TriageReport {
  /** verifications.id */
  id: string;
  /** verifications.result_json を parse したもの（{verdicts, overall_note, figures, analogy_gaps, videos, apps, meta}）。読めなければ null */
  result: unknown;
}
export interface TriageReader {
  status: 'pending' | 'running' | 'done' | 'failed' | string;
  token: string | null;
  /** reader_json を parse したもの（読めなければ null） */
  result: unknown;
}
/** 版の動画ごとの公式の情報（readVideoMetaViews の結果） */
export interface TriageVideoMeta {
  video_id: string;
  outcome: string;
  author_name: string | null;
  author_url: string | null;
  channel_match: string;
  /** YouTube の公開日（YYYY-MM-DD。§MC-3）。無い・形が違う → 公開日が分からない */
  published?: string | null;
}
export interface TriageInput {
  claims: unknown;
  report: TriageReport | null;
  sources: TriageSource[];
  checks: unknown;
  material: unknown;
  autoReverified: boolean | number;
  /** §L-3 の入力（今は使わない。古い呼び出しの互換のため型に残す） */
  autoDerived?: boolean;
  /** 読み手係（無い時は pending） */
  reader?: TriageReader | null;
  videoMeta?: readonly TriageVideoMeta[];
  /** trusted_channels.channel_key の集合 */
  trustedChannels?: ReadonlySet<string> | readonly string[];
  /** settings trusted_gen（判定で読んだ値。無ければ '0'） */
  trustedGen?: string | null;
  /** 続けて行った自動の差し戻しの数（契約 V-7 a） */
  autoRounds?: number;
  /** AUTO_RETURN_MAX（生の値。clampAutoReturnMax で丸める） */
  autoReturnMax?: unknown;
  /** 版の verification_status（無い時は report があれば done とみなす） */
  verificationStatus?: string | null;
  evidenceReverified?: boolean | number;
  /** 動画の公開日の古さを測る時刻（§MC-2。無ければ Date.now()） */
  now?: number;
}

export interface TriageGroup {
  cause: Cause;
  source_id: string | null;
  url: string | null;
  verifier_opened_urls: string[];
  claim_ids: string[];
}

export type PendingOn = 'verification' | 'reader';
export type Gate = 'clean' | 'attention' | 'pending';

export interface TriageOutput {
  verification_id: string | null;
  /** 判定に使った読み手係の結果の世代（reader.token） */
  reader_gen: string | null;
  gate: Gate;
  /** gate が pending の理由（pending でなければ空配列） */
  pending_on: PendingOn[];
  auto: Record<CheckKey, 'ok' | 'review'>;
  items: TriageItem[];
  counts: { fix: number; ask: number; note: number; claims_ok: number; sources_ok: number };
  needs_review: number;
  bad: boolean;
  reasons: Reason[];
  action: 'none' | 'auto_return' | 'reverify';
  reverify_kind: 'limit' | 'evidence' | null;
  return_note: string | null;
  auto_rounds: number;
  auto_return_max: number;
  /** 判定で「確認済み」として頼ったチャンネルの key */
  trusted_keys: string[];
  /** 判定で読んだ settings trusted_gen（契約 V-7 b） */
  trusted_gen: string;
  groups: TriageGroup[];
  ok_counts: { claims: number; sources: number };
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const uniq = (xs: string[]): string[] => [...new Set(xs)];
const cut = (s: unknown, n: number): string => str(s).slice(0, n);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** AUTO_RETURN_MAX を整数 0〜5 に丸める（数でなければ 2。契約 V-6 a） */
export function clampAutoReturnMax(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : Number.NaN;
  if (!Number.isFinite(n)) return 2;
  return Math.min(5, Math.max(0, Math.trunc(n)));
}

function readClaims(raw: unknown): Array<{ id: string; source_ids: string[] }> {
  const list = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.claims) ? raw.claims : [];
  const out: Array<{ id: string; source_ids: string[] }> = [];
  for (const c of list) {
    if (!isObj(c) || typeof c.id !== 'string') continue;
    out.push({ id: c.id, source_ids: uniq(strList(c.source_ids)) });
  }
  return out;
}

interface Verdict {
  verdict: string;
  opened_urls: string[];
}

function readVerdicts(result: unknown): Map<string, Verdict> {
  const m = new Map<string, Verdict>();
  const list = isObj(result) && Array.isArray(result.verdicts) ? result.verdicts : [];
  for (const v of list) {
    if (!isObj(v) || typeof v.claim_id !== 'string' || m.has(v.claim_id)) continue;
    m.set(v.claim_id, { verdict: typeof v.verdict === 'string' ? v.verdict : '', opened_urls: strList(v.opened_urls) });
  }
  return m;
}

const PRESENTED_AS = ['fact', 'hedged', 'analogy', 'not_in_text'] as const;
type PresentedAs = (typeof PRESENTED_AS)[number];
interface VerdictV2 {
  verdict: string;
  reason: string;
  presented_as: PresentedAs | null;
}

function readVerdictsV2(result: unknown): Map<string, VerdictV2> {
  const m = new Map<string, VerdictV2>();
  const list = isObj(result) && Array.isArray(result.verdicts) ? result.verdicts : [];
  for (const v of list) {
    if (!isObj(v) || typeof v.claim_id !== 'string' || m.has(v.claim_id)) continue;
    m.set(v.claim_id, { verdict: str(v.verdict), reason: str(v.reason), presented_as: inList(PRESENTED_AS, v.presented_as) ? v.presented_as : null });
  }
  return m;
}

/** result の {path|id, verdict, reason}[] → key → {verdict, reason}（最初の行）。配列でなければ null */
function readJudgedRows(raw: unknown, keyName: 'path' | 'id'): Map<string, { verdict: string; reason: string }> | null {
  if (!Array.isArray(raw)) return null;
  const m = new Map<string, { verdict: string; reason: string }>();
  for (const r of raw) {
    if (!isObj(r) || typeof r[keyName] !== 'string' || m.has(r[keyName] as string)) continue;
    m.set(r[keyName] as string, { verdict: str(r.verdict), reason: str(r.reason) });
  }
  return m;
}

function hasVerifierLimit(result: unknown): boolean {
  const meta = isObj(result) ? result.meta : null;
  const fe = isObj(meta) ? meta.fetch_errors : null;
  if (!isObj(fe)) return false;
  return VERIFIER_LIMIT_ERRORS.some((k) => Object.prototype.hasOwnProperty.call(fe, k) && Number(fe[k]) >= 1);
}

/** 新しい検証（契約 V-6 c: meta.evidence_v が 2） */
function isNewVerification(result: unknown): boolean {
  const meta = isObj(result) ? result.meta : null;
  return isObj(meta) && meta.evidence_v === 2;
}

/**
 * §Q-9.6: parts のどれかに動画がある（videos が空でない配列、または配列でない値）。
 * 動画のある版の「利用条件」は report が無い間は自動 OK にしない（契約 V-6 d）。material が読めない時は「無い」
 */
export function hasVideos(material: unknown): boolean {
  if (!isObj(material) || !Array.isArray(material.parts)) return false;
  return material.parts.some((p) => isObj(p) && p.videos !== undefined && (!Array.isArray(p.videos) || p.videos.length > 0));
}

/** material の parts の variants / files の path のうち、拡張子が exts のもの（出現順・重複なし） */
function materialPaths(material: unknown, keys: readonly string[], exts: readonly string[]): string[] {
  const out: string[] = [];
  const parts = isObj(material) && Array.isArray(material.parts) ? material.parts : [];
  for (const p of parts) {
    if (!isObj(p)) continue;
    for (const key of keys) {
      const list = p[key];
      if (!Array.isArray(list)) continue;
      for (const it of list) {
        const path = isObj(it) ? it.path : null;
        if (typeof path !== 'string') continue;
        const low = path.toLowerCase();
        if (exts.some((e) => low.endsWith(e)) && !out.includes(path)) out.push(path);
      }
    }
  }
  return out;
}

/** 文字列の短い id（FNV-1a 32bit の 16 進 8 桁）。同じ内容なら同じ id */
function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** §L-3 のまま: claim × 出典の問題を (source_id, cause) ごとの group にまとめ、group に入らない claims / 出典を数える */
function legacyGroups(input: TriageInput): { groups: TriageGroup[]; ok_counts: { claims: number; sources: number } } {
  const claims = readClaims(input.claims);
  // 出典は id の重複なし（同じ id が 2 行あれば最初の行）
  const sources = new Map<string, TriageSource>();
  for (const s of input.sources) if (!sources.has(s.source_id)) sources.set(s.source_id, s);
  const report = input.report;
  const verdicts = report ? readVerdicts(report.result) : new Map<string, Verdict>();
  const verifierLimit = report ? hasVerifierLimit(report.result) : false;
  // §Q-11 9: 動画の出典（material が読めなければ無し = 従来どおり全部検査する）
  const videoIds = videoSourceIds(
    [...sources.values()].map((s) => ({ id: s.source_id, url: s.url })),
    versionVideosOfMaterial(input.material),
  );
  // §AJ-3: 開けたか・引用の検査から外す出典 = 動画の出典 + 立体モデルの出典
  const unopenedIds = new Set([...videoIds, ...model3dSourceIds([...sources.values()].map((s) => ({ id: s.source_id, url: s.url })), versionModels3dOfMaterial(input.material), MODELS3D_BY_ID)]);

  const groups: TriageGroup[] = [];
  const byKey = new Map<string, TriageGroup>();
  const groupFor = (sourceId: string | null, cause: Cause): TriageGroup => {
    const key = JSON.stringify([sourceId, cause]);
    let g = byKey.get(key);
    if (!g) {
      const url = sourceId === null || cause === 'source_not_listed' ? null : (sources.get(sourceId)?.url ?? null);
      g = { cause, source_id: sourceId, url, verifier_opened_urls: [], claim_ids: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    return g;
  };
  const addClaim = (g: TriageGroup, claimId: string) => {
    if (!g.claim_ids.includes(claimId)) g.claim_ids.push(claimId);
    for (const u of verdicts.get(claimId)?.opened_urls ?? []) if (!g.verifier_opened_urls.includes(u)) g.verifier_opened_urls.push(u);
  };

  if (report) {
    for (const c of claims) {
      const verdict = verdicts.get(c.id)?.verdict ?? '';
      if (verdict === 'confirmed') {
        // confirmed でも、出典 id が無い・一覧に無いものは構造の問題として出す（§L-7 (l1)）
        if (c.source_ids.length === 0) addClaim(groupFor(null, 'no_source'), c.id);
        for (const sid of c.source_ids) if (!sources.has(sid)) addClaim(groupFor(sid, 'source_not_listed'), c.id);
        continue;
      }
      if (c.source_ids.length === 0) {
        addClaim(groupFor(null, 'no_source'), c.id);
        continue;
      }
      for (const sid of c.source_ids) {
        const s = sources.get(sid);
        let cause: Cause;
        if (verdict === 'contradicted') cause = 'contradicted';
        else if (!s) cause = 'source_not_listed';
        else if (s.url_was_fetched === 0 && !unopenedIds.has(sid)) cause = 'maker_url_not_fetched';
        else if (s.quote_found === 0 && !unopenedIds.has(sid)) cause = 'quote_mismatch';
        else if (verifierLimit) cause = 'verifier_limit';
        else cause = 'not_confirmed';
        addClaim(groupFor(sid, cause), c.id);
      }
    }
  }
  // 出典だけの問題（report の有無に関係なく出す）
  for (const [sid, s] of sources) {
    if (s.quote_found === 0 && !unopenedIds.has(sid)) groupFor(sid, 'quote_mismatch');
    if (s.license === 'unknown') groupFor(sid, 'license_unknown');
  }

  const inGroupClaims = new Set(groups.flatMap((g) => g.claim_ids));
  const inGroupSources = new Set(groups.map((g) => g.source_id).filter((x): x is string => x !== null));
  return {
    groups,
    ok_counts: {
      claims: claims.filter((c) => !inGroupClaims.has(c.id)).length,
      sources: [...sources.keys()].filter((sid) => !inGroupSources.has(sid)).length,
    },
  };
}

/** checks_json の path（material.json#summary_elementary など）→ 項目の path（material.json の枠の頭は material.json） */
const itemPathOf = (p: string): string => (p.startsWith('material.json') ? 'material.json' : p);

/** code point で n 字に切る */
const cutCp = (s: string, n: number): string => [...s].slice(0, n).join('');
const FIGURE_CHECK_RESULTS = ['ok', 'wrong', 'unclear'] as const;

/** result.figures の行の checks（{n, result, note}）。形の違う要素は飛ばし、n の昇順 */
function readFigureChecks(raw: unknown): Array<{ n: number; result: (typeof FIGURE_CHECK_RESULTS)[number]; note: string }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ n: number; result: (typeof FIGURE_CHECK_RESULTS)[number]; note: string }> = [];
  for (const c of raw) {
    if (!isObj(c) || typeof c.n !== 'number' || !Number.isInteger(c.n) || c.n < 1 || !inList(FIGURE_CHECK_RESULTS, c.result)) continue;
    if (out.some((x) => x.n === c.n)) continue;
    out.push({ n: c.n, result: c.result, note: str(c.note) });
  }
  return out.sort((a, b) => a.n - b.n);
}

/**
 * §O-13-4 2: 図の項目の detail。1 行目「絵の主張 [1][3] に問題、[2] は確かめきれない」（80 字まで）、続けて wrong・unclear ごとの行
 * （`・[n] <text 60 字>: 問題（<note 40 字>）`）、最後に reason。wrong も unclear も無ければ reason だけ。
 * 合計は ITEM_DETAIL_MAX（600 字）まで。入らない分は後ろから切るが、番号の行は途中で切らず（入らない行ごと落とす）、最後の reason だけ入る分まで切る
 */
export function figureItemDetail(checks: ReadonlyArray<{ n: number; result: string; note: string }>, texts: ReadonlyMap<number, string>, reason: string): string {
  const wrong = checks.filter((c) => c.result === 'wrong');
  const unclear = checks.filter((c) => c.result === 'unclear');
  if (!wrong.length && !unclear.length) return reason;
  const marks = (xs: ReadonlyArray<{ n: number }>) => xs.map((c) => `[${c.n}]`).join('');
  const head = cutCp(`絵の主張 ${[wrong.length ? `${marks(wrong)} に問題` : '', unclear.length ? `${marks(unclear)} は確かめきれない` : ''].filter(Boolean).join('、')}`, 80);
  const row = (c: { n: number; note: string }, label: string) => {
    const note = cutCp(oneLine(c.note), 40);
    return `・[${c.n}] ${cutCp(oneLine(texts.get(c.n) ?? ''), 60)}: ${label}${note ? `（${note}）` : ''}`;
  };
  const rows = [...wrong.map((c) => row(c, '問題')), ...unclear.map((c) => row(c, '確かめきれない'))];
  let out = head;
  for (const l of rows) {
    if (out.length + 1 + l.length > ITEM_DETAIL_MAX) return out;
    out += '\n' + l;
  }
  if (reason) {
    const room = ITEM_DETAIL_MAX - out.length - 1;
    if (room > 0) out += '\n' + reason.slice(0, room);
  }
  return out;
}

/** material の parts のうち files[] に path がある part の id（無ければ path の parts/<id>/ から。どちらも無ければ ''） */
function partIdOf(material: unknown, path: string): string {
  if (isObj(material) && Array.isArray(material.parts)) {
    for (const p of material.parts) {
      if (isObj(p) && typeof p.id === 'string' && Array.isArray(p.files) && p.files.some((f) => isObj(f) && f.path === path)) return p.id;
    }
  }
  const m = /^parts\/([^/]+)\//.exec(path);
  return m ? m[1] : '';
}

/**
 * return_note の図の行（§O-13-4 3・4。§L-9 の付箋の行と同じ形）。図の項目は `- 図 <part_id> <path>: 検証係の指摘 — <detail>`、
 * 絵の主張の機械検査は `- 図 <part_id> <path>: <title>（[n] <text>）`（減った文は `（<減った文>）`）。それ以外の項目は null
 */
function figureReturnLine(i: TriageItem, material: unknown): string | null {
  if (!i.path) return null;
  const head = `- 図 ${oneLine(partIdOf(material, i.path))} ${oneLine(i.path)}: `;
  if (i.kind === 'figure') return `${head}検証係の指摘 — ${oneLine(i.detail)}`;
  if (i.kind !== 'check') return null;
  if (i.cause === 'figure_shows_removed') return `${head}${i.title}（${oneLine(i.detail)}）`;
  if (i.cause !== 'figure_shows_ref' && i.cause !== 'figure_shows_no_primary') return null;
  const n = Number(/:(\d+)$/.exec(i.id)?.[1] ?? 0);
  const text = figureShowsMetaOf(material).get(i.path)?.shows[n - 1]?.text ?? '';
  return `${head}${i.title}（[${n}] ${oneLine(text)}）`;
}

/** return_note（契約 V-6 g）。fix の項目の行を入る所まで入れ、入らなければ最後に（ほか k 件）。material は図の行（§O-13-4 3）の part_id と絵の主張の文に使う */
export function buildReturnNote(items: readonly TriageItem[], autoRounds: number, ratio: { h: number; n: number }, material: unknown = null): string {
  const fixes = items.filter((i) => i.severity === 'fix');
  const claimFix = fixes.some((i) => i.kind === 'claim' || (i.kind === 'check' && i.key === 'content_and_evidence'));
  const manyHyp = fixes.some((i) => i.id === 'check:many_hypotheses');
  const license = fixes.some((i) => i.kind === 'source' && i.cause === 'license_unknown');
  const textFix = fixes.some((i) => i.kind === 'text' || i.kind === 'reader' || i.kind === 'learning' || i.kind === 'conditions');
  // §AL-5: scope と text は版で分ける（schema 1 は従来の文）
  const note = returnNoteTextOf(material);
  const head = [note.head(autoRounds + 1), note.scope];
  if (claimFix) head.push(note.claims);
  if (manyHyp) head.push(note.manyHypotheses(ratio.h, ratio.n));
  if (license) head.push(note.license);
  if (claimFix) head.push(RETURN_FIXED_TEXT);
  if (textFix) head.push(note.text);
  const lines = fixes.map((i) => {
    const fig = figureReturnLine(i, material);
    if (fig !== null) return fig;
    const path = i.path ? ` — ${oneLine(i.path)}` : '';
    const quote = i.quote ? `「${oneLine(i.quote)}」` : '';
    const claim = i.claim_id ? `（主張 ${oneLine(i.claim_id)}）` : '';
    const detail = i.detail ? `。${oneLine(i.detail)}` : '';
    const sug = i.suggestion ? ` 直し方の案: ${oneLine(i.suggestion)}` : '';
    return `- 〔${CHECK_KEY_LABEL[i.key]}〕${i.title}${path}${quote}${claim}${detail}${sug}`;
  });
  const headText = head.join('\n').slice(0, RETURN_NOTE_MAX);
  let len = headText.length;
  let m = 0;
  // 入る所まで（残りがある時は「（ほか k 件）」の行の分も空けておく）
  while (m < lines.length) {
    const next = len + 1 + lines[m].length;
    const rest = lines.length - (m + 1);
    const tail = rest > 0 ? 1 + RETURN_NOTE_TEXT.more(rest).length : 0;
    if (next + tail > RETURN_NOTE_MAX) break;
    len = next;
    m++;
  }
  const out = [headText, ...lines.slice(0, m)];
  if (m < lines.length) out.push(RETURN_NOTE_TEXT.more(lines.length - m));
  return out.join('\n').slice(0, RETURN_NOTE_MAX);
}

export function triageVersion(input: TriageInput): TriageOutput {
  const legacy = legacyGroups(input);
  const claims = readClaims(input.claims);
  const sources = new Map<string, TriageSource>();
  for (const s of input.sources) if (!sources.has(s.source_id)) sources.set(s.source_id, s);
  // report は result が読める（object）時だけ（契約 V-6 e: 読めなければ pending_on に verification）
  const result = input.report && isObj(input.report.result) ? input.report.result : null;
  const hasReport = result !== null;
  const verdicts = result ? readVerdictsV2(result) : new Map<string, VerdictV2>();
  const isNew = result ? isNewVerification(result) : false;
  const verifierLimit = result ? hasVerifierLimit(result) : false;
  const material = input.material;
  const videos = versionVideosOfMaterial(material);
  const videoIds = videoSourceIds(
    [...sources.values()].map((s) => ({ id: s.source_id, url: s.url })),
    videos,
  );
  // §AJ-3: 版の立体モデルと、その出典（開けたか・引用の検査から外すのは動画の出典 + 立体モデルの出典）
  const models3d = versionModels3dOfMaterial(material);
  const unopenedIds = new Set([...videoIds, ...model3dSourceIds([...sources.values()].map((s) => ({ id: s.source_id, url: s.url })), models3d, MODELS3D_BY_ID)]);
  const figurePaths = materialPaths(material, ['files'], ['.svg', '.png', '.webp']);
  const appPaths = materialPaths(material, ['variants', 'files'], ['.html']);
  const anyVideo = hasVideos(material);

  const items: TriageItem[] = [];
  const push = (it: Omit<TriageItem, 'title' | 'detail'> & { title?: string; detail?: unknown }) => {
    items.push({ ...it, title: it.title ?? ITEM_TITLE[it.cause] ?? '', detail: cut(it.detail, ITEM_DETAIL_MAX) } as TriageItem);
  };

  // 主張（1 主張 1 項目）
  let confirmed = 0;
  let hypotheses = 0;
  if (hasReport) {
    for (const c of claims) {
      const v = verdicts.get(c.id);
      const verdict = v?.verdict ?? '';
      if (verdict === 'confirmed') confirmed++;
      if (verdict === 'hypothesis') hypotheses++;
      const base = { id: `claim:${c.id}`, kind: 'claim' as const, key: 'content_and_evidence' as const, claim_id: c.id, source_ids: c.source_ids, detail: v?.reason };
      if (verdict === 'contradicted') {
        push({ ...base, severity: 'fix', cause: 'contradicted', blocking: true });
        continue;
      }
      if (c.source_ids.length === 0) {
        push({ ...base, severity: 'fix', cause: 'no_source' });
        continue;
      }
      if (c.source_ids.some((sid) => !sources.has(sid))) {
        push({ ...base, severity: 'fix', cause: 'source_not_listed' });
        continue;
      }
      const own = c.source_ids.map((sid) => sources.get(sid) as TriageSource);
      if (verdict === 'confirmed') {
        // §B-6 の承認の事前チェックと同じ条件（動画の出典を除く。動画は記録で確かめる §Q-9.11）
        if (own.some((s) => Number(s.is_primary ?? 0) === 1 && !videoIds.has(s.source_id) && Number(s.url_was_fetched) === 0))
          push({ ...base, severity: 'fix', cause: 'primary_source_unfetched', blocking: true });
        continue;
      }
      if (verdict === 'hypothesis') {
        const pa = v?.presented_as ?? null;
        if (pa === 'fact') push({ ...base, severity: 'fix', cause: 'stated_as_fact' });
        else if (pa === 'hedged') push({ ...base, severity: 'note', cause: 'hypothesis_hedged' });
        else if (pa === 'analogy') push({ ...base, severity: 'note', cause: 'analogy' });
        else if (pa === 'not_in_text') push({ ...base, severity: 'note', cause: 'hypothesis_unused' });
        else push({ ...base, severity: 'ask', cause: 'hypothesis_unjudged' });
        continue;
      }
      // unverified（または verdict が無い・値の外）
      const nonVideo = own.filter((s) => !unopenedIds.has(s.source_id));
      if (nonVideo.length >= 1 && nonVideo.every((s) => Number(s.url_was_fetched) === 0)) push({ ...base, severity: 'fix', cause: 'maker_url_not_fetched' });
      else if (nonVideo.length >= 1 && nonVideo.every((s) => Number(s.quote_found) === 0)) push({ ...base, severity: 'fix', cause: 'quote_mismatch' });
      else if (verifierLimit) push({ ...base, severity: 'ask', cause: 'verifier_limit' });
      else push({ ...base, severity: 'fix', cause: 'not_confirmed' });
    }
    if (claims.length === 0) push({ id: 'check:no_claims', kind: 'check', key: 'content_and_evidence', severity: 'ask', cause: 'no_claims' });
    // 契約 V-6 c（V-0 の裁定）: 新しい検証で主張が 1 件以上・confirmed 0 件は、主張の数に関係なく fix
    if (isNew && claims.length >= 1 && confirmed === 0)
      push({ id: 'check:none_confirmed', kind: 'check', key: 'content_and_evidence', severity: 'fix', cause: 'none_confirmed', detail: `確か 0 件 / 全 ${claims.length} 件` });
  }

  // 出典（report の有無に関係なく）
  for (const [sid, s] of sources) {
    if (s.license === 'unknown') push({ id: `source:${sid}:license`, kind: 'source', key: 'terms_of_use', severity: 'fix', cause: 'license_unknown', source_ids: [sid] });
  }
  if (sources.size === 0) push({ id: 'check:no_sources', kind: 'check', key: 'terms_of_use', severity: 'ask', cause: 'no_sources' });

  // 図（report の figures）
  if (result) {
    const rows = readJudgedRows(result.figures, 'path') ?? new Map<string, { verdict: string; reason: string }>();
    // §O-13-4 2: 絵の主張ごとの結果（result.figures[].checks）と、その文（版の material の shows）
    const checksBy = new Map<string, ReturnType<typeof readFigureChecks>>();
    for (const f of Array.isArray(result.figures) ? result.figures : []) {
      if (isObj(f) && typeof f.path === 'string' && !checksBy.has(f.path)) checksBy.set(f.path, readFigureChecks(f.checks));
    }
    const showsMeta = figureShowsMetaOf(material);
    const paths = [...figurePaths];
    for (const [p, r] of rows) if (!paths.includes(p) && r.verdict !== 'ok') paths.push(p);
    for (const path of paths) {
      const r = rows.get(path);
      const texts = new Map((showsMeta.get(path)?.shows ?? []).map((x, k) => [k + 1, x.text] as const));
      const detail = r ? figureItemDetail(checksBy.get(path) ?? [], texts, r.reason) : undefined;
      const base = { id: `figure:${path}`, kind: 'figure' as const, key: 'explanation_and_expression' as const, path, detail };
      if (r?.verdict === 'ok') continue;
      if (r?.verdict === 'problem') push({ ...base, severity: 'fix', cause: 'figure_problem' });
      else if (r?.verdict === 'unclear') push({ ...base, severity: 'ask', cause: 'figure_unclear' });
      else push({ ...base, severity: 'ask', cause: 'figure_not_seen' });
    }
  }

  // 動かせるもの（material の .html。report の apps）
  if (result) {
    const rows = readJudgedRows(result.apps, 'path');
    for (const path of appPaths) {
      const r = rows?.get(path);
      const base = { id: `app:${path}`, kind: 'app' as const, key: 'artifact_behavior' as const, path, detail: r?.reason };
      if (r?.verdict === 'ok') continue;
      if (r?.verdict === 'problem') push({ ...base, severity: 'fix', cause: 'app_problem' });
      else if (r?.verdict === 'unclear') push({ ...base, severity: 'ask', cause: 'app_unclear' });
      else push({ ...base, severity: 'ask', cause: 'app_not_judged' });
    }
  }

  // 機械検査（checks_json）
  {
    const checks = isObj(input.checks) ? input.checks : null;
    const arr = (k: string): unknown[] | null => (checks && Array.isArray(checks[k]) ? (checks[k] as unknown[]) : null);
    const seq = new Map<string, number>();
    const idOf = (cause: string) => {
      const n = (seq.get(cause) ?? 0) + 1;
      seq.set(cause, n);
      return `check:${cause}:${n}`;
    };
    for (const r of arr('forbidden') ?? []) {
      if (!isObj(r)) continue;
      push({ id: idOf('forbidden_word'), kind: 'check', key: 'explanation_and_expression', severity: 'fix', cause: 'forbidden_word', path: itemPathOf(str(r.path)), quote: cut(r.word, 200) });
    }
    for (const r of arr('kakunin_zumi') ?? []) {
      if (!isObj(r)) continue;
      push({ id: idOf('kakunin_zumi'), kind: 'check', key: 'explanation_and_expression', severity: 'fix', cause: 'kakunin_zumi', path: itemPathOf(str(r.path)), quote: '確認済み' });
    }
    for (const r of arr('app_html') ?? []) {
      if (!isObj(r)) continue;
      push({ id: idOf('app_external'), kind: 'check', key: 'artifact_behavior', severity: 'fix', cause: 'app_external', path: str(r.path), detail: str(r.pattern) });
    }
    for (const r of arr('missing_source_refs') ?? []) {
      if (!isObj(r)) continue;
      push({ id: idOf('missing_ref'), kind: 'check', key: 'content_and_evidence', severity: 'fix', cause: 'missing_ref', claim_id: str(r.claim_id) || undefined, source_ids: str(r.source_id) ? [str(r.source_id)] : undefined, detail: str(r.source_id) });
    }
    for (const r of arr('missing_claim_refs') ?? []) {
      if (!isObj(r)) continue;
      push({ id: idOf('missing_ref'), kind: 'check', key: 'content_and_evidence', severity: 'fix', cause: 'missing_ref', path: itemPathOf(str(r.path)), detail: str(r.ref) });
    }
    const editionTextPaths = new Set<string>();
    const textIds = new Set<string>();
    // §MC-2・Astra R1: 本文の版の 1 文の項目は版が決まっている題材だけ（そうでない題材の edition_text は無視する）
    const editionTextApplies = isVersionBoundMaterial(material);
    for (const r of arr('child_text') ?? []) {
      if (!isObj(r)) continue;
      if (r.kind === 'edition_text') {
        if (!editionTextApplies) continue;
        // §MC-2: 本文の版の 1 文が無い（path ごとに 1 件）
        const path = str(r.path);
        if (!path || editionTextPaths.has(path)) continue;
        editionTextPaths.add(path);
        push({
          id: `text:edition_text:${path}`,
          kind: 'text',
          key: 'explanation_and_expression',
          severity: 'fix',
          cause: 'edition_text_missing',
          path,
          detail: editionTextDetail(path, declaredEdition(material)?.version ?? '<版>'),
        });
        continue;
      }
      if (r.kind === 'file_name' || r.kind === 'raw_markup') {
        push({ id: idOf(r.kind), kind: 'text', key: 'explanation_and_expression', severity: 'fix', cause: r.kind, path: itemPathOf(str(r.path)), quote: cut(r.sample, 200) });
        continue;
      }
      // §AL-5: 新しい kind（schema 2 の版だけ出る）。(kind, path) ごとに 1 件・最初の行の sample を引用にする。知らない kind は捨てる
      const kind = CHILD_TEXT_KINDS.find((k) => k === r.kind);
      if (kind === undefined || kind === 'edition_text' || kind === 'file_name' || kind === 'raw_markup') continue;
      const path = itemPathOf(str(r.path));
      if (!path) continue;
      const id = `text:${kind}:${path}`;
      if (textIds.has(id)) continue;
      textIds.add(id);
      const quote = cut(r.sample, 200);
      push({ id, kind: 'text', key: 'explanation_and_expression', severity: CHILD_TEXT_V2_SEVERITY[kind], cause: kind, path, ...(quote ? { quote } : {}) });
    }
    // §O-13-4 4: 絵の主張の機械検査（古い版の checks_json にはキーが無い = 項目を作らない）
    const fig = { kind: 'check' as const, key: 'explanation_and_expression' as const };
    for (const p of arr('figure_shows_missing') ?? []) {
      if (typeof p !== 'string') continue;
      push({ ...fig, id: `check:figure_shows_missing:${p}`, severity: 'note', cause: 'figure_shows_missing', path: p });
    }
    for (const r of arr('figure_shows_refs') ?? []) {
      if (!isObj(r) || typeof r.path !== 'string' || typeof r.n !== 'number') continue;
      push({ ...fig, id: `check:figure_shows_ref:${r.path}:${r.n}`, severity: 'fix', cause: 'figure_shows_ref', path: r.path, detail: strList(r.source_ids).join('、') });
    }
    for (const r of arr('figure_shows_no_primary') ?? []) {
      if (!isObj(r) || typeof r.path !== 'string' || typeof r.n !== 'number') continue;
      push({ ...fig, id: `check:figure_shows_no_primary:${r.path}:${r.n}`, severity: 'fix', cause: 'figure_shows_no_primary', path: r.path, detail: `一次とみなす発行主体: ${PRIMARY_HOSTS.slice(0, 8).join('、')}…` });
    }
    for (const r of arr('figure_shows_removed') ?? []) {
      if (!isObj(r) || typeof r.path !== 'string') continue;
      push({ ...fig, id: `check:figure_shows_removed:${r.path}`, severity: 'fix', cause: 'figure_shows_removed', path: r.path, detail: strList(r.texts).map(oneLine).join(' / ') });
    }
    if (['forbidden', 'app_html', 'kakunin_zumi', 'missing_source_refs', 'missing_claim_refs'].some((k) => arr(k) === null))
      push({ id: 'check:checks_missing', kind: 'check', key: 'artifact_behavior', severity: 'ask', cause: 'checks_missing' });
    // 古い版（child_text が無い）は「検査していない」: 項目を作らない（読み手係の mismatch が拾う。契約 V-5）
  }

  // §MC-2: 版の宣言（版が決まっている題材だけ。report の有無に関係なく material から決まる）
  const versionBound = isVersionBoundMaterial(material);
  if (versionBound) {
    const declared = declaredEdition(material);
    const eb = { kind: 'check' as const, key: 'conditions_of_use' as const, severity: 'fix' as const, detail: EDITION_DECLARE_DETAIL };
    if (declared === null) push({ ...eb, id: 'edition:missing', cause: 'edition_missing' });
    else if (declared.edition === 'bedrock') push({ ...eb, id: 'edition:not_java', cause: 'edition_not_java' });
  }

  // 動画（report があり動画がある時）
  const trusted = new Set<string>(input.trustedChannels ? [...input.trustedChannels] : []);
  const trustedKeys: string[] = [];
  if (result && videos.length > 0) {
    const rows = readJudgedRows(result.videos, 'id') ?? new Map<string, { verdict: string; reason: string }>();
    const metaById = new Map<string, TriageVideoMeta>();
    for (const m of input.videoMeta ?? []) if (isObj(m) && typeof m.video_id === 'string' && !metaById.has(m.video_id)) metaById.set(m.video_id, m);
    for (const v of videos) {
      const r = rows.get(v.id);
      const vbase = { kind: 'video' as const, video_id: v.id };
      if (r?.verdict !== 'ok') {
        const b = { ...vbase, id: `video:${v.id}:content`, key: 'explanation_and_expression' as const, detail: r?.reason };
        if (r?.verdict === 'problem') push({ ...b, severity: 'fix', cause: 'video_problem' });
        else if (r?.verdict === 'unclear') push({ ...b, severity: 'ask', cause: 'video_unclear' });
        else push({ ...b, severity: 'ask', cause: 'video_not_seen' });
      }
      const meta = metaById.get(v.id);
      if (meta?.outcome !== 'ok') {
        push({ ...vbase, id: `video:${v.id}:meta`, key: 'terms_of_use', severity: 'ask', cause: 'video_meta_unknown' });
        continue;
      }
      if (meta.channel_match === 'mismatch') push({ ...vbase, id: `video:${v.id}:meta`, key: 'terms_of_use', severity: 'fix', cause: 'video_channel_mismatch' });
      const authorUrl = str(meta.author_url);
      if (authorUrl && trusted.has(authorUrl)) {
        if (!trustedKeys.includes(authorUrl)) trustedKeys.push(authorUrl);
      } else {
        push({
          ...vbase,
          id: `video:${v.id}:channel`,
          key: 'terms_of_use',
          severity: 'ask',
          cause: 'video_channel_new',
          ...(authorUrl ? { channel_key: authorUrl } : {}),
          channel_name: str(meta.author_name),
        });
      }
    }
  }

  // 立体モデル（§AJ-3。report の有無に関係なく、1 件ごとに人が確認画面で回して見る。v1 では自動公開しない）
  for (const d of models3d) {
    const entry = MODELS3D_BY_ID.get(d.catalog_id);
    const cause = entry ? 'model3d_human' : 'model3d_missing';
    push({
      id: `model3d:${d.id}`,
      kind: 'model3d',
      key: 'explanation_and_expression',
      severity: entry ? 'ask' : 'fix',
      cause,
      model3d_id: d.id,
      catalog_id: d.catalog_id,
      title: entry ? entry.title_ja : d.catalog_id,
      detail: ITEM_TITLE[cause],
    });
  }

  // §MC-2: 動画の公開日（版が決まっている題材だけ。公式の情報が ok の動画を videoMeta から。report の有無に関係なく）
  if (versionBound && videos.length > 0) {
    const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();
    const metaById = new Map<string, TriageVideoMeta>();
    for (const m of input.videoMeta ?? []) if (isObj(m) && typeof m.video_id === 'string' && !metaById.has(m.video_id)) metaById.set(m.video_id, m);
    for (const v of videos) {
      const meta = metaById.get(v.id);
      if (meta?.outcome !== 'ok') continue;
      const ab = { kind: 'video' as const, video_id: v.id, id: `video:${v.id}:age`, key: 'terms_of_use' as const };
      const published = parsePublishedDay(meta.published) === null ? null : (meta.published as string);
      if (published === null) push({ ...ab, severity: 'ask', cause: 'video_date_unknown' });
      else if (isVideoTooOld(published, now)) push({ ...ab, severity: 'fix', cause: 'video_too_old', detail: videoAgeDetail(published) });
    }
  }

  // 読み手係
  const rStatus = String(input.reader?.status ?? 'pending');
  const rResult = rStatus === 'done' ? readReaderResult(input.reader?.result, schemaVersionOf(input.material)) : null;
  // done なのに結果が読めない版は「読み手チェックができなかった」として扱う（自動 OK にしない）
  const readerDone = rStatus === 'done' && rResult !== null;
  const readerFailed = rStatus === 'failed' || (rStatus === 'done' && rResult === null);
  if (readerDone && rResult) {
    const seen = new Map<string, number>();
    for (const f of rResult.findings) {
      const h = `reader:${shortHash(JSON.stringify([f.path, f.quote, f.kind]))}`;
      const n = (seen.get(h) ?? 0) + 1;
      seen.set(h, n);
      push({
        id: n === 1 ? h : `${h}-${n}`,
        kind: 'reader',
        key: 'explanation_and_expression',
        severity: f.severity,
        cause: f.kind,
        ...(f.path ? { path: f.path } : {}),
        quote: cut(f.quote, 200),
        suggestion: cut(f.suggestion, 400),
        detail: f.note,
      });
    }
    // 素材の形（schema 2 の版だけ。契約 AL-5）: problem → fix・unclear → ask・ok → 出さない
    if (rResult.quality) {
      for (const k of READER_QUALITY_KEYS) {
        const q = rResult.quality[k];
        if (q.verdict === 'ok') continue;
        push({ id: `quality:${k}`, kind: 'reader', key: 'explanation_and_expression', severity: q.verdict === 'problem' ? 'fix' : 'ask', cause: `quality_${k}`, detail: q.reason });
      }
    }
    const judge = (j: ReaderJudgement, which: 'learning' | 'conditions') => {
      const key = which === 'learning' ? 'relation_to_learning' : 'conditions_of_use';
      if (j.verdict === 'problem') push({ id: which, kind: which, key, severity: 'fix', cause: `${which}_problem`, detail: j.reason });
      else if (j.verdict === 'unclear') push({ id: which, kind: which, key, severity: 'ask', cause: `${which}_unclear`, detail: j.reason });
    };
    judge(rResult.learning, 'learning');
    judge(rResult.conditions, 'conditions');
  }
  if (readerFailed || (readerDone && (rResult?.not_read.length ?? 0) > 0)) {
    const cause = readerFailed ? 'reader_failed' : 'reader_partial';
    const three: Array<['explanation_and_expression' | 'relation_to_learning' | 'conditions_of_use', ItemKind]> = [
      ['explanation_and_expression', 'reader'],
      ['relation_to_learning', 'learning'],
      ['conditions_of_use', 'conditions'],
    ];
    for (const [key, kind] of three)
      push({ id: `reader:${cause}:${key}`, kind, key, severity: 'ask', cause, title: READER_FALLBACK_TITLE[cause][key], detail: cause === 'reader_partial' ? (rResult?.not_read ?? []).join('、') : '' });
  }

  // 割合の項目（report があり主張が 5 件以上の時だけ）
  const n = claims.length;
  const quoteSources = [...sources.values()].filter((s) => !unopenedIds.has(s.source_id));
  const quoteBad = quoteSources.filter((s) => Number(s.quote_found) === 0).length;
  if (hasReport && n >= MIN_CLAIMS_FOR_REASONS) {
    const ratio = { kind: 'check' as const, key: 'content_and_evidence' as const, severity: 'fix' as const };
    if (isNew && hypotheses * 3 > n) push({ ...ratio, id: 'check:many_hypotheses', cause: 'many_hypotheses', detail: `仮説 ${hypotheses} 件 / 全 ${n} 件` });
    if (isNew && confirmed * 2 < n) push({ ...ratio, id: 'check:few_confirmed', cause: 'few_confirmed', detail: `確か ${confirmed} 件 / 全 ${n} 件` });
    if (quoteBad * 2 > quoteSources.length) push({ ...ratio, id: 'check:quote_mismatch_many', cause: 'quote_mismatch_many', detail: `${quoteBad} 件 / 全 ${quoteSources.length} 件` });
  }

  // 数
  const isProblem = (i: TriageItem) => i.severity === 'fix' || i.severity === 'ask';
  const fix = items.filter((i) => i.severity === 'fix').length;
  const ask = items.filter((i) => i.severity === 'ask').length;
  const note = items.filter((i) => i.severity === 'note').length;
  const badClaims = new Set(items.filter((i) => isProblem(i) && i.claim_id).map((i) => i.claim_id as string));
  const badSources = new Set(items.filter(isProblem).flatMap((i) => i.source_ids ?? []));

  // 6 項目の自動 OK（契約 V-6 d）
  const pre: Record<CheckKey, boolean> = {
    content_and_evidence: hasReport,
    artifact_behavior: hasReport,
    terms_of_use: sources.size >= 1 && (!anyVideo || hasReport),
    explanation_and_expression: readerDone && (!(figurePaths.length > 0 || anyVideo) || hasReport),
    relation_to_learning: readerDone,
    conditions_of_use: readerDone,
  };
  const auto = Object.fromEntries(CHECK_KEYS.map((k) => [k, pre[k] && !items.some((i) => i.key === k && isProblem(i)) ? 'ok' : 'review'])) as Record<CheckKey, 'ok' | 'review'>;

  // reasons（契約 V-6 f）
  const has = (id: string) => items.some((i) => i.id === id);
  const reasons: Reason[] = [];
  if (items.some((i) => i.cause === 'contradicted')) reasons.push('contradicted');
  if (has('check:few_confirmed')) reasons.push('few_confirmed');
  if (has('check:many_hypotheses')) reasons.push('many_hypotheses');
  if (has('check:quote_mismatch_many')) reasons.push('quote_mismatch_many');
  if (fix > 0) reasons.push('needs_fix');
  const bad = reasons.length > 0;

  // gate と pending_on（契約 V-6 e）
  const vStatus = input.verificationStatus ?? (input.report ? 'done' : 'pending');
  const pendingOn: PendingOn[] = [];
  if (vStatus !== 'done' || !hasReport) pendingOn.push('verification');
  if (rStatus === 'pending' || rStatus === 'running') pendingOn.push('reader');
  const gate: Gate = pendingOn.length > 0 ? 'pending' : CHECK_KEYS.every((k) => auto[k] === 'ok') && reasons.length === 0 ? 'clean' : 'attention';

  // action（契約 V-6 f）
  const autoRounds = Math.max(0, Math.trunc(Number(input.autoRounds ?? 0)) || 0);
  const autoReturnMax = clampAutoReturnMax(input.autoReturnMax);
  let action: TriageOutput['action'] = 'none';
  let reverifyKind: TriageOutput['reverify_kind'] = null;
  if (gate !== 'pending') {
    const limit = !Number(input.autoReverified) && items.some((i) => i.cause === 'verifier_limit');
    const evidence =
      !Number(input.evidenceReverified ?? 0) &&
      !isNew &&
      (claims.some((c) => {
        const v = verdicts.get(c.id)?.verdict ?? '';
        return v !== 'confirmed' && v !== 'contradicted';
      }) ||
        appPaths.length > 0);
    if (evidence || limit) {
      action = 'reverify';
      reverifyKind = evidence ? 'evidence' : 'limit';
    } else if (fix > 0 && autoRounds < autoReturnMax) action = 'auto_return';
  }

  return {
    verification_id: input.report?.id ?? null,
    reader_gen: input.reader?.token ?? null,
    gate,
    pending_on: pendingOn,
    auto,
    items,
    counts: {
      fix,
      ask,
      note,
      claims_ok: claims.filter((c) => !badClaims.has(c.id)).length,
      sources_ok: [...sources.keys()].filter((sid) => !badSources.has(sid)).length,
    },
    needs_review: fix + ask,
    bad,
    reasons,
    action,
    reverify_kind: reverifyKind,
    return_note: action === 'auto_return' ? buildReturnNote(items, autoRounds, { h: hypotheses, n }, material) : null,
    auto_rounds: autoRounds,
    auto_return_max: autoReturnMax,
    trusted_keys: trustedKeys,
    trusted_gen: typeof input.trustedGen === 'string' && input.trustedGen !== '' ? input.trustedGen : '0',
    groups: legacy.groups,
    ok_counts: legacy.ok_counts,
  };
}
