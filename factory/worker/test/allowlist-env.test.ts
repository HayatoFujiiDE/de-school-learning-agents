// 職人のツール（allowlist.domains）と作業場（allowlist.hosts・environments/cloud.yaml）の整合。
// API は web ツールの allowed_domains が limited 環境の allowed_hosts の中にあることを求め、外れると sessions.create が 400 になる（2026-11-05 本番で発生）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWLIST } from '../src/generated/claude-assets';

const root = fileURLToPath(new URL('../../claude/', import.meta.url));
const yamlHosts = (): string[] => {
  const lines = readFileSync(root + 'environments/cloud.yaml', 'utf8').split('\n');
  const i = lines.findIndex((l) => l.trim() === 'allowed_hosts:');
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s+-\s+"?([^"]+)"?\s*$/.exec(l);
    if (!m) break;
    out.push(m[1]);
  }
  return out;
};
const raw = JSON.parse(readFileSync(root + 'allowlist.json', 'utf8')) as { domains: string[]; primary_hosts: string[]; hosts: string[] };

describe('allowlist と作業場の整合', () => {
  it('職人の domains はすべて作業場の hosts に bare で入っている', () => {
    for (const d of ALLOWLIST.domains) expect(ALLOWLIST.hosts, d).toContain(d);
  });
  it('cloud.yaml の allowed_hosts は allowlist.json の hosts と同じ', () => {
    expect(yamlHosts()).toEqual(raw.hosts);
  });
  it('生成物の ALLOWLIST は allowlist.json と同じ（sync 漏れの検出）', () => {
    expect(ALLOWLIST).toEqual({ domains: raw.domains, primary_hosts: raw.primary_hosts, hosts: raw.hosts });
  });
});
