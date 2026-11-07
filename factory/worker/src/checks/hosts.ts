// 純関数: host の照合（契約 §O-13-0 5）。取り込み（絵の主張の一次の出典）と検証係が同じ関数を使う。I/O を持たない。
import { ALLOWLIST } from '../generated/claude-assets';

/** 一次とみなす発行主体（allowlist.json の primary_hosts。domains の部分集合。自身+サブドメイン） */
export const PRIMARY_HOSTS: readonly string[] = ALLOWLIST.primary_hosts;

/** hostname を照合の形にする（小文字・末尾の `.` を取る） */
const normHost = (h: string): string => h.toLowerCase().replace(/\.+$/, '');

/**
 * hostname が list のどれかに一致するか。一致は完全一致か、`'.' + entry` で終わること
 * （`notkahaku.go.jp` は `kahaku.go.jp` に一致しない。`www.kahaku.go.jp` は一致する）。ポートは hostname に含まれないので見ない
 */
export function hostMatches(hostname: string, list: readonly string[]): boolean {
  const h = normHost(String(hostname ?? ''));
  if (!h) return false;
  return list.some((e) => {
    const x = normHost(String(e ?? ''));
    return !!x && (h === x || h.endsWith('.' + x));
  });
}

/** URL の hostname が list に一致するか（解析できない URL は一致しない） */
export function urlHostMatches(url: unknown, list: readonly string[]): boolean {
  if (typeof url !== 'string') return false;
  try {
    return hostMatches(new URL(url).hostname, list);
  } catch {
    return false;
  }
}
