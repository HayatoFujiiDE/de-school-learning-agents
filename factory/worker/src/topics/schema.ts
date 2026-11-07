// お題の本文の形（契約 contract-T T-1）。純関数 validateTopicBody は違反を理由コードの配列で返す（空なら合格）。
// 未知のキー・未知の kind・型違いは不合格。子どもの名前・学年・教室などの欄は持たない（未知のキーで落ちる）。

import { checkSourceUrl } from './fetch-source';
import { TOPIC_KINDS, TOPIC_LOCALE, type TopicKind } from './locale';

export const TOPIC_INTERESTS = ['minecraft', 'programming', 'craft', 'digital', 'media', 'drawing', 'basics', 'writing'] as const;
const VIEW_TYPES = ['person', 'org', 'position'] as const;
const SIDES = ['a', 'b', 'c', 'd'] as const;
const ASK_LEVELS = ['check', 'self', 'open'] as const;

export interface LocText {
  s: string;
  e: string;
}

export interface TopicBody {
  schema_version: 1;
  kind: TopicKind;
  locale: string;
  title: LocText;
  lead: LocText;
  event_day: string | null;
  premises: Array<{ text: LocText }>;
  facts: Array<{ id: string; text: LocText; source_ids: string[] }>;
  views: Array<{ id: string; who: { name: string; type: 'person' | 'org' | 'position' }; side: 'a' | 'b' | 'c' | 'd'; stance: LocText; source_ids: string[] }>;
  asks: Array<{ level: 'check' | 'self' | 'open'; text: LocText }>;
  stances: Array<{ id: string; label: LocText }>;
  next: { talk: LocText; make_title: LocText; make_steps: LocText[] } | null;
  make: {
    category: string;
    line: LocText;
    first_step: LocText;
    need: LocText;
    minutes: number;
    steps: LocText[];
    safety: boolean;
    thumb_prompt: string | null;
  } | null;
  /** for_learner（v2.9・任意）: 子どもが自分で開いて参考にできるページか。無い時は false 扱い（保存済みのお題も同じ） */
  sources: Array<{ id: string; url: string; name: string; quote: string; for_learner?: boolean }>;
  tags: { interests: string[]; concept_codes: string[] };
}

/** 文字数の上限（T-1）。next.talk は問いと同じ 160、next.make_title は題と同じ 80 とした（契約に無い 2 項目） */
export const TEXT_LIMITS = {
  title: 80,
  lead: 120,
  premise: 160,
  fact: 160,
  stance: 160,
  ask: 160,
  whoName: 40,
  label: 20,
  step: 40,
  line: 80,
  firstStep: 80,
  need: 80,
  thumbPrompt: 200,
  sourceName: 60,
  nextTalk: 160,
  makeTitle: 80,
  id: 40,
} as const;

/** 種類ごとの数の範囲（T-1 の表） */
export const COUNTS: Record<TopicKind, Record<'premises' | 'facts' | 'views' | 'stances' | 'sources', [number, number]>> = {
  news: { premises: [0, 0], facts: [2, 4], views: [0, 3], stances: [2, 4], sources: [1, 6] },
  talk: { premises: [0, 3], facts: [0, 3], views: [2, 4], stances: [2, 4], sources: [0, 6] },
  philo: { premises: [0, 2], facts: [1, 4], views: [2, 4], stances: [2, 4], sources: [1, 6] },
  make: { premises: [0, 0], facts: [0, 0], views: [0, 0], stances: [0, 0], sources: [0, 0] }, // make は事実・考えを持たないので、出典も持たない（v2.3）
};

const TOP_KEYS = ['schema_version', 'kind', 'locale', 'title', 'lead', 'event_day', 'premises', 'facts', 'views', 'asks', 'stances', 'next', 'make', 'sources', 'tags'];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const chars = (s: string): number => Array.from(s).length;

/** ちょうどこのキーだけを持つオブジェクトか（足りない・余分は false）。optional は、あっても無くてもよいキー（v2.9 の sources[].for_learner） */
function exactKeys(v: unknown, keys: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> {
  if (!isObj(v)) return false;
  const own = Object.keys(v);
  return keys.every((k) => Object.hasOwn(v, k)) && own.every((k) => keys.includes(k) || optional.includes(k));
}

function okStr(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.trim().length > 0 && chars(v) <= max;
}

function okLoc(v: unknown, max: number): v is LocText {
  return exactKeys(v, ['s', 'e']) && okStr(v.s, max) && okStr(v.e, max);
}

/** YYYY-MM-DD で実在する日付か */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** YYYY-MM-DD に n 日足す（暦の日付として） */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const CONCEPT_RE = /^[A-Z0-9]{2,12}$/;

export interface ValidateOptions {
  /** 何日用のお題か（news の event_day の範囲 slotDay − 14 〜 slotDay） */
  slotDay: string;
}

/** 本文の形を検査する（T-1）。違反の理由コードの配列（重複なし・空なら合格） */
export function validateTopicBody(body: unknown, opts: ValidateOptions): string[] {
  const r = new Set<string>();
  if (!isObj(body)) return ['not_object'];
  for (const k of Object.keys(body)) if (!TOP_KEYS.includes(k)) r.add('unknown_key');
  for (const k of TOP_KEYS) if (!Object.hasOwn(body, k)) r.add('missing_key');
  if (body.schema_version !== 1) r.add('schema_version');
  const kind = body.kind as TopicKind;
  if (!(TOPIC_KINDS as readonly unknown[]).includes(kind)) {
    r.add('kind');
    return [...r];
  }
  if (body.locale !== TOPIC_LOCALE) r.add('locale');
  if (!okLoc(body.title, TEXT_LIMITS.title)) r.add('title');
  if (!okLoc(body.lead, TEXT_LIMITS.lead)) r.add('lead');

  // event_day
  if (kind === 'news') {
    if (!isRealDate(body.event_day)) r.add('event_day');
    else if (!isRealDate(opts.slotDay) || body.event_day < addDays(opts.slotDay, -14) || body.event_day > opts.slotDay) r.add('event_day_range');
  } else if (body.event_day !== null) r.add('event_day');

  const counts = COUNTS[kind];
  const inRange = (arr: unknown, key: keyof typeof counts): arr is unknown[] => Array.isArray(arr) && arr.length >= counts[key][0] && arr.length <= counts[key][1];

  // premises
  if (!inRange(body.premises, 'premises')) r.add('premises_count');
  else for (const p of body.premises) if (!exactKeys(p, ['text']) || !okLoc(p.text, TEXT_LIMITS.premise)) r.add('premise');

  // sources（先に id を集める）
  const sourceIds = new Set<string>();
  if (!inRange(body.sources, 'sources')) r.add('sources_count');
  else {
    for (const s of body.sources) {
      // for_learner は任意（v2.9）。あれば boolean だけ（ほかの型は 'source'）。検査（check / judge）は for_learner を見ない
      if (!exactKeys(s, ['id', 'url', 'name', 'quote'], ['for_learner']) || typeof s.id !== 'string' || !ID_RE.test(s.id) || (Object.hasOwn(s, 'for_learner') && typeof s.for_learner !== 'boolean')) {
        r.add('source');
        continue;
      }
      if (sourceIds.has(s.id)) r.add('dup_source_id');
      sourceIds.add(s.id);
      if (typeof s.url !== 'string' || !checkSourceUrl(s.url)) r.add('source_url');
      if (!okStr(s.name, TEXT_LIMITS.sourceName)) r.add('source_name');
      if (typeof s.quote !== 'string' || chars(s.quote.trim()) < 20 || chars(s.quote) > 200) r.add('source_quote');
      // 引用に < > & を入れない（司令塔の裁定 2026-11-06。タグ・文字参照を除くと数文字に縮み、ほとんどのページに「見つかる」ため）
      else if (/[<>&]/.test(s.quote)) r.add('quote_markup');
    }
  }
  const referenced = new Set<string>();
  const checkRefs = (ids: unknown, needOne: boolean, code: string): void => {
    if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
      r.add(code);
      return;
    }
    if (needOne && ids.length === 0) r.add(`${code}_no_source`);
    if (new Set(ids).size !== ids.length) r.add('dup_source_ref');
    for (const id of ids as string[]) {
      if (!sourceIds.has(id)) r.add('unknown_source_ref');
      referenced.add(id);
    }
  };

  // facts（全種類で source_ids が 1 つ以上）
  if (!inRange(body.facts, 'facts')) r.add('facts_count');
  else {
    const ids = new Set<string>();
    for (const f of body.facts) {
      if (!exactKeys(f, ['id', 'text', 'source_ids']) || typeof f.id !== 'string' || !ID_RE.test(f.id) || !okLoc(f.text, TEXT_LIMITS.fact)) {
        r.add('fact');
        continue;
      }
      if (ids.has(f.id)) r.add('dup_fact_id');
      ids.add(f.id);
      checkRefs(f.source_ids, true, 'fact');
    }
  }

  // views（person / org は source_ids が 1 つ以上。talk / philo は side が 2 種以上、philo は person か org が 1 つ以上）
  if (!inRange(body.views, 'views')) r.add('views_count');
  else {
    const ids = new Set<string>();
    const sides = new Set<string>();
    let named = 0;
    for (const v of body.views) {
      if (
        !exactKeys(v, ['id', 'who', 'side', 'stance', 'source_ids']) ||
        typeof v.id !== 'string' ||
        !ID_RE.test(v.id) ||
        !exactKeys(v.who, ['name', 'type']) ||
        !okStr(v.who.name, TEXT_LIMITS.whoName) ||
        !(VIEW_TYPES as readonly unknown[]).includes(v.who.type) ||
        !(SIDES as readonly unknown[]).includes(v.side) ||
        !okLoc(v.stance, TEXT_LIMITS.stance)
      ) {
        r.add('view');
        continue;
      }
      if (ids.has(v.id)) r.add('dup_view_id');
      ids.add(v.id);
      sides.add(v.side as string);
      const isNamed = v.who.type === 'person' || v.who.type === 'org';
      if (isNamed) named++;
      checkRefs(v.source_ids, isNamed, 'view');
    }
    if ((kind === 'talk' || kind === 'philo') && sides.size < 2) r.add('views_sides');
    if (kind === 'philo' && named < 1) r.add('views_named');
  }

  // asks（news / talk / philo はちょうど 3。check・self・open を 1 つずつ。s と e が同じ文字列でない。make は 0）
  if (!Array.isArray(body.asks)) r.add('asks_count');
  else if (kind === 'make') {
    if (body.asks.length !== 0) r.add('asks_count');
  } else if (body.asks.length !== 3) r.add('asks_count');
  else {
    const levels = new Set<string>();
    for (const a of body.asks) {
      if (!exactKeys(a, ['level', 'text']) || !(ASK_LEVELS as readonly unknown[]).includes(a.level) || !okLoc(a.text, TEXT_LIMITS.ask)) {
        r.add('ask');
        continue;
      }
      levels.add(a.level as string);
      if (a.text.s === a.text.e) r.add('ask_same');
    }
    if (levels.size !== 3) r.add('asks_levels');
  }

  // stances
  if (!inRange(body.stances, 'stances')) r.add('stances_count');
  else {
    const ids = new Set<string>();
    for (const s of body.stances) {
      if (!exactKeys(s, ['id', 'label']) || typeof s.id !== 'string' || !ID_RE.test(s.id) || !okLoc(s.label, TEXT_LIMITS.label)) {
        r.add('stance');
        continue;
      }
      if (ids.has(s.id)) r.add('dup_stance_id');
      ids.add(s.id);
    }
  }

  // next（news / talk / philo は必須・make_steps 3〜4。make は null）
  if (kind === 'make') {
    if (body.next !== null) r.add('next');
  } else if (
    !exactKeys(body.next, ['talk', 'make_title', 'make_steps']) ||
    !okLoc(body.next.talk, TEXT_LIMITS.nextTalk) ||
    !okLoc(body.next.make_title, TEXT_LIMITS.makeTitle) ||
    !Array.isArray(body.next.make_steps) ||
    body.next.make_steps.length < 3 ||
    body.next.make_steps.length > 4 ||
    !body.next.make_steps.every((x) => okLoc(x, TEXT_LIMITS.step))
  ) {
    r.add('next');
  }

  // tags（make の category の検査より先）
  let interests: string[] = [];
  if (!exactKeys(body.tags, ['interests', 'concept_codes']) || !Array.isArray(body.tags.interests) || !Array.isArray(body.tags.concept_codes)) r.add('tags');
  else {
    const ints = body.tags.interests as unknown[];
    if (ints.some((x) => !(TOPIC_INTERESTS as readonly unknown[]).includes(x)) || new Set(ints).size !== ints.length) r.add('tags');
    else interests = ints as string[];
    const codes = body.tags.concept_codes as unknown[];
    if (codes.length > 20 || codes.some((x) => typeof x !== 'string' || !CONCEPT_RE.test(x))) r.add('tags');
  }

  // make（make だけ必須。steps 3〜4。category は tags.interests に含まれる）
  if (kind !== 'make') {
    if (body.make !== null) r.add('make');
  } else {
    const m = body.make;
    if (
      !exactKeys(m, ['category', 'line', 'first_step', 'need', 'minutes', 'steps', 'safety', 'thumb_prompt']) ||
      typeof m.category !== 'string' ||
      !okLoc(m.line, TEXT_LIMITS.line) ||
      !okLoc(m.first_step, TEXT_LIMITS.firstStep) ||
      !okLoc(m.need, TEXT_LIMITS.need) ||
      !Number.isInteger(m.minutes) ||
      (m.minutes as number) < 10 ||
      (m.minutes as number) > 120 ||
      !Array.isArray(m.steps) ||
      typeof m.safety !== 'boolean' ||
      !(m.thumb_prompt === null || okStr(m.thumb_prompt, TEXT_LIMITS.thumbPrompt))
    ) {
      r.add('make');
    } else {
      const steps = m.steps as unknown[];
      if (steps.length < 3 || steps.length > 4 || !steps.every((x) => okLoc(x, TEXT_LIMITS.step))) r.add('make_steps');
      if (!interests.includes(m.category as string)) r.add('make_category');
    }
  }

  // どこからも指されていない出典は不合格
  for (const id of sourceIds) if (!referenced.has(id)) r.add('unreferenced_source');
  return [...r];
}

/** 必須の出典の id（facts と、who.type が person / org の views の source_ids が指すもの。T-5 の 4） */
export function requiredSourceIds(body: Pick<TopicBody, 'facts' | 'views'>): Set<string> {
  const out = new Set<string>();
  for (const f of body.facts ?? []) for (const id of f.source_ids ?? []) out.add(id);
  for (const v of body.views ?? []) if (v.who?.type === 'person' || v.who?.type === 'org') for (const id of v.source_ids ?? []) out.add(id);
  return out;
}

/** 子どもが読む文（禁止語の検査の対象）。出典の引用・名前・URL と thumb_prompt は外の文・画像の説明なので入れない */
export function topicTexts(body: TopicBody): string[] {
  const out: string[] = [];
  const loc = (t: LocText | null | undefined) => {
    if (t && typeof t.s === 'string') out.push(t.s);
    if (t && typeof t.e === 'string') out.push(t.e);
  };
  loc(body.title);
  loc(body.lead);
  for (const p of body.premises ?? []) loc(p.text);
  for (const f of body.facts ?? []) loc(f.text);
  for (const v of body.views ?? []) {
    if (typeof v.who?.name === 'string') out.push(v.who.name);
    loc(v.stance);
  }
  for (const a of body.asks ?? []) loc(a.text);
  for (const s of body.stances ?? []) loc(s.label);
  if (body.next) {
    loc(body.next.talk);
    loc(body.next.make_title);
    for (const s of body.next.make_steps ?? []) loc(s);
  }
  if (body.make) {
    loc(body.make.line);
    loc(body.make.first_step);
    loc(body.make.need);
    for (const s of body.make.steps ?? []) loc(s);
  }
  return out;
}

/** 題の正規化（T-2 title_norm）: 全角半角を寄せ（NFKC）、小文字にし、空白・記号を除く */
export function normalizeTitle(title: string): string {
  return String(title ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 題の文字 2-gram の Jaccard（T-5 の 1。title_norm 同士で比べる。1 文字の題はその文字 1 つを集合にする） */
export function titleJaccard(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const cs = Array.from(s);
    if (cs.length < 2) return new Set(cs);
    const out = new Set<string>();
    for (let i = 0; i + 1 < cs.length; i++) out.add(cs[i] + cs[i + 1]);
    return out;
  };
  const A = grams(a);
  const B = grams(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}

/** body_json（保存する文字列）の SHA-256（16 進） */
export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------------------------
// save_topics の入力 schema（T-4。T-1 の本文の配列）。strict は付けずに渡す（v2.5 の裁定: 文法が大きすぎて 400）。書き方は公式の strict の制限の中のまま保つ
// （object は全部 additionalProperties: false・長さ・数・個数の制約は書かない — 個数・字数は Worker が validateTopicBody で確かめる）

const locSchema = { type: 'object', additionalProperties: false, required: ['s', 'e'], properties: { s: { type: 'string' }, e: { type: 'string' } } } as const;
const idSchema = { type: 'string' } as const;
const idsSchema = { type: 'array', items: { type: 'string' } } as const;

/**
 * sources[].for_learner の決まり（v2.9。オーナーの指示 2026-11-07「出典はチェックの時には必要。ユーザー本文には必要ないけど」「参考になる資料ならユーザーにも見せたい」）。
 * save_topics の schema の property の description と、生成の system 文の形の決まり（prompts.ts の shapeRules）の両方に入れる。
 * prompts.ts は schema.ts を読むので、文はここに置く（逆向きに読むと循環する）
 */
export const FOR_LEARNER_RULE =
  'for_learner は、子ども（小学生〜中学生）が自分で開いて読んで参考になるページだけ true にします（子ども向けの解説・博物館や公的機関のやさしい解説・図や写真の多い入門など）。報道・論文・専門の資料・有料の記事は false にします。迷ったら false にします。出典の決まり（開けたページだけ・quote は一字も変えずに写す）は true でも false でも同じです。';

export const TOPIC_BODY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: TOP_KEYS,
  properties: {
    schema_version: { type: 'integer', enum: [1] },
    kind: { type: 'string', enum: [...TOPIC_KINDS] },
    locale: { type: 'string', enum: [TOPIC_LOCALE] },
    title: locSchema,
    lead: locSchema,
    event_day: { type: ['string', 'null'], description: 'news はできごとの日（YYYY-MM-DD）。ほかは null' },
    premises: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: locSchema } } },
    facts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'text', 'source_ids'], properties: { id: idSchema, text: locSchema, source_ids: idsSchema } } },
    views: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'who', 'side', 'stance', 'source_ids'],
        properties: {
          id: idSchema,
          who: { type: 'object', additionalProperties: false, required: ['name', 'type'], properties: { name: { type: 'string' }, type: { type: 'string', enum: [...VIEW_TYPES] } } },
          side: { type: 'string', enum: [...SIDES] },
          stance: locSchema,
          source_ids: idsSchema,
        },
      },
    },
    asks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['level', 'text'], properties: { level: { type: 'string', enum: [...ASK_LEVELS] }, text: locSchema } } },
    stances: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'label'], properties: { id: idSchema, label: locSchema } } },
    next: {
      anyOf: [
        { type: 'null' },
        { type: 'object', additionalProperties: false, required: ['talk', 'make_title', 'make_steps'], properties: { talk: locSchema, make_title: locSchema, make_steps: { type: 'array', items: locSchema } } },
      ],
    },
    make: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'line', 'first_step', 'need', 'minutes', 'steps', 'safety', 'thumb_prompt'],
          properties: {
            category: { type: 'string', enum: [...TOPIC_INTERESTS] },
            line: locSchema,
            first_step: locSchema,
            need: locSchema,
            minutes: { type: 'integer' },
            steps: { type: 'array', items: locSchema },
            safety: { type: 'boolean' },
            thumb_prompt: { type: ['string', 'null'] },
          },
        },
      ],
    },
    sources: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'url', 'name', 'quote'],
        // for_learner は任意（v2.9）。決まりの文は property の description（prompts.ts の shapeRules にも同じ文）
        properties: { id: idSchema, url: { type: 'string' }, name: { type: 'string' }, quote: { type: 'string' }, for_learner: { type: 'boolean', description: FOR_LEARNER_RULE } },
      },
    },
    tags: {
      type: 'object',
      additionalProperties: false,
      required: ['interests', 'concept_codes'],
      properties: { interests: { type: 'array', items: { type: 'string', enum: [...TOPIC_INTERESTS] } }, concept_codes: { type: 'array', items: { type: 'string' } } },
    },
  },
} as const;
