// scripts/order-setup.sh（契約 §U-5 の鍵の用意）。偽の security と npx を PATH の先頭に置いて zsh / bash で動かす。
// 本物の keychain・wrangler には触らない。
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../scripts/order-setup.sh');
const FAKE_ID = 'fake-client-id-0123456789abcdef.access';
const FAKE_SECRET = 'fake-client-secret-fedcba9876543210';
const has = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const SHELLS: Array<[string, string[]]> = [['bash', ['bash']], ...(has('zsh') ? ([['zsh', ['zsh']]] as Array<[string, string[]]>) : [])];

let dir: string;
let bin: string;
let log: string;

// add は引数を記録するだけ（本物は端末で値を聞く）。find は偽の値を返す
const FAKE_SECURITY = `#!/bin/sh
printf '%s\\n' "$@" >> "$FAKE_LOG/security-argv"
printf -- '--\\n' >> "$FAKE_LOG/security-argv"
cmd="$1"; acct=""
while [ $# -gt 0 ]; do
  case "$1" in -a) acct="$2"; shift ;; esac
  shift
done
case "$cmd" in
  add-generic-password) [ -n "\${FAKE_ADD_FAIL:-}" ] && exit 1; exit 0 ;;
  find-generic-password)
    case "$acct" in
      client-id) printf '%s\\n' '${FAKE_ID}' ;;
      client-secret) printf '%s\\n' '${FAKE_SECRET}' ;;
      *) exit 44 ;;
    esac ;;
  *) exit 2 ;;
esac
`;

const FAKE_NPX = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_LOG/npx-argv"
cat > "$FAKE_LOG/npx-stdin"
pwd > "$FAKE_LOG/npx-cwd"
if [ -n "\${FAKE_NPX_FAIL:-}" ]; then echo 'X [ERROR] something went wrong' >&2; exit 1; fi
echo 'Success! Uploaded secret ORDER_CLIENT_IDS'
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'order-setup-test-'));
  bin = join(dir, 'bin');
  log = join(dir, 'log');
  for (const d of [bin, log]) mkdirSync(d);
  writeFileSync(join(bin, 'security'), FAKE_SECURITY);
  writeFileSync(join(bin, 'npx'), FAKE_NPX);
  chmodSync(join(bin, 'security'), 0o755);
  chmodSync(join(bin, 'npx'), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(shell: string[], extra: Record<string, string> = {}) {
  const r = spawnSync(shell[0], [...shell.slice(1), SCRIPT], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: dir, TMPDIR: dir, FAKE_LOG: log, ...extra },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
const readLog = (f: string) => (existsSync(join(log, f)) ? readFileSync(join(log, f), 'utf8') : null);

describe('scripts/order-setup.sh（§U-5 の鍵の用意）', () => {
  it('構文: zsh -n / bash -n が通る。set -x を使わない', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
    if (has('zsh')) expect(spawnSync('zsh', ['-n', SCRIPT]).status).toBe(0);
    const src = readFileSync(SCRIPT, 'utf8').split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(src).not.toMatch(/set\s+-[a-z]*x/);
  });

  describe.each(SHELLS)('%s', (_name, shell) => {
    it('keychain に 2 つ入れ（値は security が聞く・引数に置かない）、Client ID をパイプで wrangler secret put に渡す。値は出力に出ない', () => {
      const r = run(shell);
      expect(r.code).toBe(0);
      expect(r.out).toContain('完了');
      for (const v of [FAKE_ID, FAKE_SECRET]) expect(r.out).not.toContain(v);
      const calls = (readLog('security-argv') ?? '').split('--\n').filter(Boolean).map((c) => c.trim().split('\n'));
      const adds = calls.filter((c) => c[0] === 'add-generic-password');
      expect(adds.map((c) => c[c.indexOf('-a') + 1])).toEqual(['client-id', 'client-secret']);
      for (const c of adds) {
        expect(c).toContain('-U');
        expect(c[c.indexOf('-s') + 1]).toBe('de-factory-order');
        expect(c[c.length - 1]).toBe('-w'); // -w の後に値を置かない（security が端末で聞く）
      }
      const npxArgv = (readLog('npx-argv') ?? '').trim().split('\n');
      expect(npxArgv).toEqual(['wrangler', 'secret', 'put', 'ORDER_CLIENT_IDS']);
      expect(readLog('npx-stdin')).toBe(`${FAKE_ID}\n`);
      expect((readLog('npx-cwd') ?? '').trim()).toBe(resolve(__dirname, '..'));
    });

    it('wrangler が失敗 → exit 1。値は出さない。wrangler の出力は一時ファイルに残る', () => {
      const r = run(shell, { FAKE_NPX_FAIL: '1' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('登録に失敗');
      for (const v of [FAKE_ID, FAKE_SECRET]) expect(r.out).not.toContain(v);
      const m = /wrangler の出力: (\S+)/.exec(r.out);
      expect(m).not.toBeNull();
      expect(readFileSync((m as RegExpExecArray)[1], 'utf8')).toContain('something went wrong');
    });

    it('keychain への保存が失敗 → exit 1。wrangler は呼ばない', () => {
      const r = run(shell, { FAKE_ADD_FAIL: '1' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('保存に失敗');
      expect(readLog('npx-argv')).toBeNull();
    });
  });
});
