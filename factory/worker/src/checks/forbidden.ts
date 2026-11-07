// 純関数: 禁止語・残り物の検査（契約 §F-2）。I/O を持たない。
// いずれも赤印にするだけで取り込みは止めない（人が差し戻す）。

export const FORBIDDEN_WORDS = [
  '点数',
  'ランキング',
  '順位',
  '評価',
  '成績',
  'レベル',
  '集中力',
  '得意',
  '苦手',
  '上手',
  '成長',
  'データがありません',
  '学びのバディ',
] as const;

export const CONFIRMED_WORD = '確認済み';

/** app.html に残ってはいけないもの（型 4）。字面より少し広く、大文字小文字や空白の揺れも拾う */
export const APP_HTML_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: '<script src', re: /<script\b[^>]*\bsrc\s*=/gi },
  { label: '<link ', re: /<link[\s>/]/gi },
  { label: 'fetch(', re: /\bfetch\s*\(/g },
  { label: 'import ', re: /(^|[^A-Za-z0-9_$])import[\s(]/g },
];

export interface ForbiddenInput {
  /** outputs 相対パス → テキスト本文（parts/** を含む） */
  texts: Map<string, string>;
  summary_elementary: string;
  summary_secondary: string;
  /** §AL-2: schema 2 の版の要約 1 本。渡された時は material.json#summary の 1 行だけを見る（schema 1 は渡さない: 従来の 2 行） */
  summary?: string;
  claims: Array<{ id: string; source_ids: string[] }>;
  sourceIds: string[];
}

export interface ForbiddenResult {
  forbidden: Array<{ path: string; word: string; count: number }>;
  app_html: Array<{ path: string; pattern: string; count: number }>;
  missing_source_refs: Array<{ claim_id: string; source_id: string }>;
  missing_claim_refs: Array<{ path: string; ref: string }>;
  kakunin_zumi: Array<{ path: string; count: number }>;
  ok: boolean;
}

function count(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

export function checkForbidden(input: ForbiddenInput): ForbiddenResult {
  const forbidden: ForbiddenResult['forbidden'] = [];
  const appHtml: ForbiddenResult['app_html'] = [];
  const missingClaimRefs: ForbiddenResult['missing_claim_refs'] = [];
  const kakunin: ForbiddenResult['kakunin_zumi'] = [];
  const claimIds = new Set(input.claims.map((c) => c.id));

  const targets: Array<[string, string]> = [];
  for (const [p, t] of [...input.texts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (p.startsWith('parts/')) targets.push([p, t]);
  }
  const summaries: Array<[string, string]> =
    typeof input.summary === 'string'
      ? [['material.json#summary', input.summary]]
      : [
          ['material.json#summary_elementary', input.summary_elementary ?? ''],
          ['material.json#summary_secondary', input.summary_secondary ?? ''],
        ];

  for (const [p, t] of [...targets, ...summaries]) {
    for (const w of FORBIDDEN_WORDS) {
      const c = count(t, w);
      if (c > 0) forbidden.push({ path: p, word: w, count: c });
    }
  }
  for (const [p, t] of targets) {
    const k = count(t, CONFIRMED_WORD);
    if (k > 0) kakunin.push({ path: p, count: k });
    const seen = new Set<string>();
    for (const m of t.matchAll(/\[(c\d+)\]/g)) {
      const ref = m[1];
      if (!claimIds.has(ref) && !seen.has(ref)) {
        seen.add(ref);
        missingClaimRefs.push({ path: p, ref });
      }
    }
    // basename が app.html で終わるもの（2 パーツ以上の p2-app.html を含む。§E-0 (b)・§F-2）
    if (p.slice(p.lastIndexOf('/') + 1).endsWith('app.html')) {
      for (const { label, re } of APP_HTML_PATTERNS) {
        const c = [...t.matchAll(new RegExp(re.source, re.flags))].length;
        if (c > 0) appHtml.push({ path: p, pattern: label, count: c });
      }
    }
  }

  const sourceIds = new Set(input.sourceIds);
  const missingSourceRefs: ForbiddenResult['missing_source_refs'] = [];
  for (const c of input.claims) {
    for (const s of c.source_ids) if (!sourceIds.has(s)) missingSourceRefs.push({ claim_id: c.id, source_id: s });
  }

  return {
    forbidden,
    app_html: appHtml,
    missing_source_refs: missingSourceRefs,
    missing_claim_refs: missingClaimRefs,
    kakunin_zumi: kakunin,
    ok:
      forbidden.length === 0 &&
      appHtml.length === 0 &&
      missingSourceRefs.length === 0 &&
      missingClaimRefs.length === 0 &&
      kakunin.length === 0,
  };
}
