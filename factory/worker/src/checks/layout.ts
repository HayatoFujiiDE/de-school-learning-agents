// 純関数: Files API の basename だけの一覧から論理パス（outputs 相対）を復元する（契約 §E-0、§B-4-d `versioned`、§R-41）。I/O を持たない。
// - 最上位 6 ファイルは同名で対応する
// - material.json の parts[].variants[].path（schema 2 は parts[].body / play。§AL-2）/ parts[].files[].path は basename で raw から引く
// - raw に同じ basename が 2 つ以上 / 別々の論理パスが同じ basename を指す → duplicate_basename:<name>（§E-0 (b): 素材全体で一意）
// - imagePaths（§O-7 = 旧 §M-2-7 3。image_id を持つ files[] の論理パス）は raw から引かず Map に入れない（取り込みが image_requests と R2 から採る）。
//   basename の一意の判定には入れる: raw に同じ basename がある / 別の論理パスと basename が同じ → duplicate_basename:<name>
// - material.json が JSON として読めない → json_invalid:material.json
// - 参照先が raw に無い path は Map に入れない（§E の missing_ref に任せる）。どこからも参照されない raw は unreferenced（昇順）
// 形の検査（parts が配列か・path が文字列か 等）はここでは寛容に読み飛ばし、validateOutputs（§E）に落とさせる。

import { isSafeRelativePath } from './schema';
import { bodiesOf, schemaVersionOf } from './shape';

/** 最上位で同名対応するファイル（§E の木構造の 1 段目） */
export const TOP_LEVEL_FILES = ['material.json', 'claims.json', 'sources.json', 'adapt-rules.md', 'selfcheck.md', 'questions.json'] as const;

export type OutputLayout =
  | { ok: true; files: Map<string /* logical */, string /* basename */>; unreferenced: string[] }
  | { ok: false; detail: string };

export const basenameOf = (p: string): string => p.slice(p.lastIndexOf('/') + 1);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * material.json の本文と parts[].files[].path を出現順に集める（形が違うものは黙って飛ばす）。
 * schema 1: part の順に variants[].path（.md 以外も）→ files[].path（従来どおり。bodiesOf は .md だけなので使わない）。
 * schema 2（§AL-2）: bodiesOf（body → play）→ part の順に files[].path
 */
function referencedPaths(material: unknown): string[] {
  if (!isObj(material) || !Array.isArray(material.parts)) return [];
  if (schemaVersionOf(material) === 2) {
    const out = bodiesOf(material).map((b) => b.path);
    for (const part of material.parts) {
      if (!isObj(part) || !Array.isArray(part.files)) continue;
      for (const item of part.files) if (isObj(item) && typeof item.path === 'string') out.push(item.path);
    }
    return out;
  }
  const out: string[] = [];
  for (const part of material.parts) {
    if (!isObj(part)) continue;
    for (const key of ['variants', 'files'] as const) {
      const list = part[key];
      if (!Array.isArray(list)) continue;
      for (const item of list) if (isObj(item) && typeof item.path === 'string') out.push(item.path);
    }
  }
  return out;
}

/** files.list の filename（または basename）の列で、basename が 2 件以上あるもののうち昇順で最初の名前。無ければ null（§B-4-d listed） */
export function duplicateBasename(filenames: string[]): string | null {
  const counts = new Map<string, number>();
  for (const f of filenames) {
    const n = basenameOf(f);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const dup = [...counts].filter(([, c]) => c > 1).map(([n]) => n).sort();
  return dup.length > 0 ? dup[0] : null;
}

export function resolveOutputLayout(rawNames: string[], materialJsonText: string, imagePaths: readonly string[] = []): OutputLayout {
  // raw に同じ basename が 2 つ以上（listed で先に落ちるが、純関数としても守る）
  const dupRaw = duplicateBasename(rawNames);
  if (dupRaw !== null) return { ok: false, detail: `duplicate_basename:${dupRaw}` };
  const raw = new Set(rawNames);

  const files = new Map<string, string>();
  /** basename → それを指している論理パス（別の論理パスが同じ basename を指したら衝突） */
  const owner = new Map<string, string>();
  const images = new Set(imagePaths);
  const claim = (logical: string, base: string): string | null => {
    const prev = owner.get(base);
    if (prev !== undefined && prev !== logical) return base;
    owner.set(base, logical);
    if (!images.has(logical)) files.set(logical, base);
    return null;
  };

  for (const t of TOP_LEVEL_FILES) if (raw.has(t)) claim(t, t);

  if (raw.has('material.json')) {
    let material: unknown;
    try {
      material = JSON.parse(materialJsonText);
    } catch {
      return { ok: false, detail: 'json_invalid:material.json' };
    }
    for (const logical of referencedPaths(material)) {
      // 安全でない path（`..`・先頭 `/` 等）は R2 のキーにしない。§E の path_outside_part に落ちる
      if (!isSafeRelativePath(logical)) continue;
      const base = basenameOf(logical);
      if (images.has(logical)) {
        // 生成した画像は raw から引かない。raw に同じ basename があれば素材全体の一意が崩れる（§O-2: outputs に置かない）
        if (raw.has(base)) return { ok: false, detail: `duplicate_basename:${base}` };
        const clash = claim(logical, base);
        if (clash !== null) return { ok: false, detail: `duplicate_basename:${clash}` };
        continue;
      }
      if (!raw.has(base)) continue; // 参照先不在は §E の missing_ref
      const clash = claim(logical, base);
      if (clash !== null) return { ok: false, detail: `duplicate_basename:${clash}` };
    }
  }

  const used = new Set(files.values());
  const unreferenced = [...raw].filter((n) => !used.has(n)).sort();
  return { ok: true, files, unreferenced };
}
