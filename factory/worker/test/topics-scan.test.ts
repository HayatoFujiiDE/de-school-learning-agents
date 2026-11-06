// contract-T T-14 b2: src/ を走査して
//   - topics の status に 'ready'・'retired' を書く SQL の文字列が src/topics/gate.ts にしか無い
//   - src/topics/**・src/routes/topics.ts に materials・material_versions・factory_jobs への INSERT・UPDATE・DELETE の文字列が無い
//   - T-2 の「書き換えない列」を SET する UPDATE topics が無い
// 文字列の走査で確かめられる範囲（動的に組み立てた SQL は対象外）。そのため topics の SET 句は断片の連結にしないことも確かめる。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** TS のソースから文字列リテラル（'…' "…" `…`）の中身を取り出す。テンプレートの ${…} は ' ${} ' に置き換え、中の文字列も拾う */
export function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  const quoted = (q: string): string => {
    i++;
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        s += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === q || c === '\n') {
        i++;
        return s;
      }
      s += c;
      i++;
    }
    return s;
  };
  const template = (): string => {
    i++;
    let s = '';
    while (i < n) {
      const c = src[i];
      if (c === '\\') {
        s += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        return s;
      }
      if (c === '$' && src[i + 1] === '{') {
        i += 2;
        s += ' ${} ';
        let depth = 1;
        while (i < n && depth > 0) {
          const d = src[i];
          if (d === '`') {
            out.push(template());
            continue;
          }
          if (d === "'" || d === '"') {
            out.push(quoted(d));
            continue;
          }
          if (d === '{') depth++;
          else if (d === '}') depth--;
          i++;
        }
        continue;
      }
      s += c;
      i++;
    }
    return s;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '`') {
      out.push(template());
      continue;
    }
    if (c === "'" || c === '"') {
      out.push(quoted(c));
      continue;
    }
    i++;
  }
  return out;
}

const UPDATE_TOPICS = /UPDATE\s+topics(?:\s+AS\s+\w+)?\s+SET\s+([\s\S]*?)\s+WHERE\b/gi;
/** UPDATE topics の文の始まり（WHERE が同じ文字列に無くても数える） */
const UPDATE_TOPICS_HEAD = /UPDATE\s+topics(?:\s+AS\s+\w+)?\s+SET\b/gi;
const IMMUTABLE = ['body_json', 'content_sha256', 'title', 'title_norm', 'kind', 'origin', 'slot_day', 'lineage_id', 'parent_topic_id', 'derive_kind', 'depth'];

/** 1 つの文字列の中の UPDATE topics の SET 句 */
const setClauses = (lit: string): string[] => [...lit.matchAll(UPDATE_TOPICS)].map((m) => m[1]);
/** SET 句が status に 'ready' / 'retired' を書くか（直接・CASE の中とも） */
const writesStatus = (set: string, v: 'ready' | 'retired'): boolean => new RegExp(`(^|,)\\s*status\\s*=\\s*(?:'${v}'|CASE[\\s\\S]*?'${v}'[\\s\\S]*?END)`, 'i').test(set);
const insertsStatus = (lit: string, v: string): boolean => /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+topics\s*\(/i.test(lit) && lit.includes(`'${v}'`);
const setsImmutable = (set: string): string[] => IMMUTABLE.filter((c) => new RegExp(`(^|,)\\s*${c}\\s*=`, 'i').test(set));

interface Finding {
  file: string;
  what: string;
}

function scan(files: Array<{ file: string; text: string }>): {
  ready: Finding[];
  retired: Finding[];
  immutable: Finding[];
  composedSet: Finding[];
  splitWhere: Finding[];
  updates: number;
} {
  const r = { ready: [] as Finding[], retired: [] as Finding[], immutable: [] as Finding[], composedSet: [] as Finding[], splitWhere: [] as Finding[], updates: 0 };
  for (const { file, text } of files) {
    for (const lit of literals(text)) {
      // v2.4 の裁定 6: UPDATE topics の文は WHERE まで 1 つの文字列（WHERE を別の変数に分けない・断片を差し込まない）
      const heads = [...lit.matchAll(UPDATE_TOPICS_HEAD)].length;
      if (heads > 0 && (setClauses(lit).length < heads || lit.includes('${}'))) r.splitWhere.push({ file, what: lit.trim().slice(0, 60) });
      for (const set of setClauses(lit)) {
        r.updates++;
        if (writesStatus(set, 'ready')) r.ready.push({ file, what: set.slice(0, 60) });
        if (writesStatus(set, 'retired')) r.retired.push({ file, what: set.slice(0, 60) });
        for (const c of setsImmutable(set)) r.immutable.push({ file, what: c });
        if (set.includes('${}')) r.composedSet.push({ file, what: set.slice(0, 60) });
      }
      if (insertsStatus(lit, 'ready')) r.ready.push({ file, what: 'INSERT' });
      if (insertsStatus(lit, 'retired')) r.retired.push({ file, what: 'INSERT' });
    }
  }
  return r;
}

const files = walk(SRC).map((p) => ({ file: relative(SRC, p).split('\\').join('/'), text: readFileSync(p, 'utf8') }));

describe('走査の道具そのもの（正の検査: 違反を見つけられること）', () => {
  it('合成した違反を見つける', () => {
    const bad = scan([
      { file: 'x.ts', text: "const a = `UPDATE topics SET status = 'ready' WHERE id = ?`; const b = \"UPDATE topics SET title = ?, updated_at = ? WHERE id = ?\";" },
      { file: 'y.ts', text: "const c = `UPDATE topics SET status = CASE WHEN x THEN 'retired' ELSE status END WHERE id = ?`; const d = `UPDATE topics SET ${'$'}{frag} WHERE id = ?`;" },
      { file: 'z.ts', text: "const e = `INSERT INTO topics (id, status) SELECT ?, 'ready'`;" },
    ]);
    expect(bad.ready.map((f) => f.file)).toEqual(['x.ts', 'z.ts']);
    expect(bad.retired.map((f) => f.file)).toEqual(['y.ts']);
    expect(bad.immutable).toEqual([{ file: 'x.ts', what: 'title' }]);
    expect(bad.composedSet.map((f) => f.file)).toEqual(['y.ts']);
  });
  it('WHERE を別の変数に分けた UPDATE topics を違反として見つける（裁定 6 の対照）', () => {
    const split = scan([
      { file: 'w.ts', text: "const rowWhere = `WHERE id = ?`; const a = `UPDATE topics SET title = ?, updated_at = ? ${'$'}{rowWhere}`;" },
      { file: 'p.ts', text: "const b = `UPDATE topics SET status = 'ready' WHERE id = ? AND ${'$'}{pred}`;" },
      { file: 'ok.ts', text: "const c = `UPDATE topics SET starred = ? WHERE id = ? AND content_sha256 = ?`;" },
    ]);
    // WHERE が別の変数だと、SET 句も読めない（書き換えない列・ready の違反を見落とす）ので、それ自体を違反にする
    expect(split.immutable).toEqual([]);
    expect(split.splitWhere.map((f) => f.file)).toEqual(['w.ts', 'p.ts']);
  });
  it('読み（WHERE の status = \'ready\'）は書きと数えない', () => {
    const ok = scan([{ file: 'r.ts', text: "const a = `UPDATE topics SET recheck_tried_at = ? WHERE id = ? AND status = 'ready'`;" }]);
    expect([ok.ready.length, ok.retired.length, ok.updates]).toEqual([0, 0, 1]);
  });
});

describe('src/ の走査', () => {
  const r = scan(files);
  it('UPDATE topics の文を実際に読めている（経路が生きている）', () => {
    expect(files.some((f) => f.file === 'topics/gate.ts')).toBe(true);
    expect(r.updates).toBeGreaterThanOrEqual(15);
  });
  it("topics の status に 'ready' を書く SQL は src/topics/gate.ts にだけある（auto と approve の 2 つ）", () => {
    expect(r.ready.map((f) => f.file)).toEqual(['topics/gate.ts', 'topics/gate.ts']);
  });
  it("topics の status に 'retired' を書く SQL は src/topics/gate.ts にだけある", () => {
    expect(r.retired.length).toBeGreaterThanOrEqual(1);
    expect([...new Set(r.retired.map((f) => f.file))]).toEqual(['topics/gate.ts']);
  });
  it('書き換えない列（T-2）を SET する UPDATE topics が無い', () => {
    expect(r.immutable).toEqual([]);
  });
  it('topics の SET 句を断片の連結で組み立てていない（走査が SET 句を全部読める）', () => {
    expect(r.composedSet).toEqual([]);
  });
  it('UPDATE topics の文は WHERE まで 1 つの文字列（WHERE を別の変数に分けていない。裁定 6）', () => {
    expect(r.splitWhere).toEqual([]);
  });
  it('src/topics/**・src/routes/topics.ts に materials・material_versions・factory_jobs への INSERT・UPDATE・DELETE の文字列が無い', () => {
    const own = files.filter((f) => f.file.startsWith('topics/') || f.file === 'routes/topics.ts');
    expect(own.length).toBeGreaterThanOrEqual(13);
    const re = /\b(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:materials|material_versions|factory_jobs)\b/i;
    expect(own.filter((f) => re.test(f.text)).map((f) => f.file)).toEqual([]);
    // 正の検査: 同じ正規表現は既存の素材のコードの書き込みを見つける
    expect(files.filter((f) => f.file === 'publish.ts' || f.file === 'jobs.ts').some((f) => re.test(f.text))).toBe(true);
  });
});
