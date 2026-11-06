// scripts/order.sh（契約 §U-5）。偽の security と curl を PATH の先頭に置いて zsh / bash で動かす。
// 本物の keychain・本番の URL には触らない（偽の curl は引数・標準入力・本文を記録するだけ）。
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = new URL('../scripts/order.sh', import.meta.url).pathname;
const FAKE_ID = 'FAKEID-7f3a91.access';
const FAKE_SECRET = 'FAKESECRET-9c1d2e5b8a';
const URL_ORDERS = 'https://de-school-factory.h-fujii.workers.dev/api/orders';

const has = (cmd: string) => spawnSync('/bin/sh', ['-c', `command -v ${cmd}`]).status === 0;
const SHELLS: Array<[string, string[]]> = [
  ['bash', ['bash']],
  ...(has('zsh') ? ([['zsh', ['zsh', '-f']]] as Array<[string, string[]]>) : []),
];

let dir: string;
let bin: string;
let log: string;
let tmp: string;

const FAKE_SECURITY = `#!/bin/sh
acct=""
while [ $# -gt 0 ]; do
  case "$1" in -a) acct="$2"; shift ;; esac
  shift
done
[ -n "\${FAKE_KEYCHAIN_MISSING:-}" ] && exit 44
case "$acct" in
  client-id) printf '%s\\n' '${FAKE_ID}' ;;
  client-secret) printf '%s\\n' '${FAKE_SECRET}' ;;
  *) exit 44 ;;
esac
`;

const FAKE_CURL = `#!/bin/sh
printf '%s\\n' "$@" > "$FAKE_LOG/argv"
cat > "$FAKE_LOG/stdin"
export -p > "$FAKE_LOG/exported"
out=""
body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --data-binary) body="$2"; shift ;;
  esac
  shift
done
cp "\${body#@}" "$FAKE_LOG/body"
printf '%s' "$FAKE_RESPONSE" > "$out"
printf '%s' "\${FAKE_CODE:-201}"
exit "\${FAKE_CURL_RC:-0}"
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'order-sh-test-'));
  bin = join(dir, 'bin');
  log = join(dir, 'log');
  tmp = join(dir, 'tmp');
  for (const d of [bin, log, tmp]) mkdirSync(d);
  writeFileSync(join(bin, 'security'), FAKE_SECURITY);
  writeFileSync(join(bin, 'curl'), FAKE_CURL);
  chmodSync(join(bin, 'security'), 0o755);
  chmodSync(join(bin, 'curl'), 0o755);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(shell: string[], orderJson: string | null, extra: Record<string, string> = {}) {
  const file = join(dir, 'order.json');
  if (orderJson !== null) writeFileSync(file, orderJson);
  const r = spawnSync(shell[0], [...shell.slice(1), SCRIPT, file], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin`,
      HOME: dir,
      TMPDIR: tmp,
      FAKE_LOG: log,
      FAKE_RESPONSE: JSON.stringify({ material_id: 'm-1', job_id: 'j-1', session_id: 's-1', title: '題名は出さない', start_error: 'factory_not_configured' }),
      ...extra,
    },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const ORDER = JSON.stringify({ title: '影の長さ', slug: 'shadow-1', kinds: [3], brief_md: '本文', no_personal_data: true });
const readLog = (f: string) => (existsSync(join(log, f)) ? readFileSync(join(log, f), 'utf8') : null);

describe('scripts/order.sh（§U-5）', () => {
  it('構文: zsh -n / bash -n が通る。set -x と curl の -v を使わない', () => {
    expect(spawnSync('bash', ['-n', SCRIPT]).status).toBe(0);
    if (has('zsh')) expect(spawnSync('zsh', ['-n', SCRIPT]).status).toBe(0);
    const src = readFileSync(SCRIPT, 'utf8')
      .split('\n')
      .filter((l) => !/^\s*#/.test(l)) // 説明の行は除く
      .join('\n');
    expect(src).not.toMatch(/set\s+-[a-z]*x/);
    expect(src).not.toMatch(/(?<!command)\s-v\b|--verbose|--trace/); // command -v（存在の確認）は別
  });

  describe.each(SHELLS)('%s', (_name, shell) => {
    it('201: status と material_id / job_id / start_error だけを出す。鍵は出力・argv・環境・一時ファイルに出ない。header は標準入力で渡る', () => {
      const r = run(shell, ORDER);
      expect(r.code).toBe(0);
      expect(r.out).toContain('HTTP 201');
      expect(r.out).toContain('material_id: m-1');
      expect(r.out).toContain('job_id: j-1');
      expect(r.out).toContain('start_error: factory_not_configured');
      expect(r.out).not.toContain('session_id');
      expect(r.out).not.toContain('題名は出さない');
      for (const v of [FAKE_ID, FAKE_SECRET]) {
        expect(r.out).not.toContain(v);
        expect(readLog('argv')).not.toContain(v);
        expect(readLog('exported')).not.toContain(v);
      }
      const argv = (readLog('argv') ?? '').split('\n');
      expect(argv).toContain(URL_ORDERS);
      expect(argv).toContain('--config');
      expect(argv[argv.indexOf('--config') + 1]).toBe('-');
      expect(argv).toContain('Origin: https://de-school-factory.h-fujii.workers.dev');
      expect(argv).not.toContain('-v');
      expect(readLog('stdin')).toBe(`header = "CF-Access-Client-Id: ${FAKE_ID}"\nheader = "CF-Access-Client-Secret: ${FAKE_SECRET}"\n`);
      // request_id が無ければ道具が足す
      const body = JSON.parse(readLog('body') ?? '{}') as Record<string, unknown>;
      expect(body).toMatchObject({ slug: 'shadow-1', no_personal_data: true });
      expect(String(body.request_id)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      // 一時フォルダは消えている
      expect(readdirSync(tmp)).toEqual([]);
    });

    it('request_id があればそのまま送る。200 replay は replay: true を出す', () => {
      const r = run(shell, JSON.stringify({ ...JSON.parse(ORDER), request_id: 'my-request-0001' }), {
        FAKE_CODE: '200',
        FAKE_RESPONSE: JSON.stringify({ material_id: 'm-1', job_id: 'j-1', replay: true }),
      });
      expect(r.code).toBe(0);
      expect(r.out).toContain('HTTP 200');
      expect(r.out).toContain('replay: true');
      expect((JSON.parse(readLog('body') ?? '{}') as Record<string, unknown>).request_id).toBe('my-request-0001');
    });

    it('200 / 201 以外は exit 1（error を出す）', () => {
      const r = run(shell, ORDER, { FAKE_CODE: '429', FAKE_RESPONSE: JSON.stringify({ error: 'daily_order_limit' }) });
      expect(r.code).toBe(1);
      expect(r.out).toContain('HTTP 429');
      expect(r.out).toContain('error: daily_order_limit');
    });

    it('応答が JSON でない（Access のログイン画面など）→「入口に届いていない」と status だけ。200 でも exit 1', () => {
      const r = run(shell, ORDER, { FAKE_CODE: '200', FAKE_RESPONSE: '<html><title>Sign in</title></html>' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('入口に届いていない');
      expect(r.out).toContain('HTTP 200');
      expect(r.out).not.toContain('Sign in');
    });

    it('curl が失敗 → exit 1。鍵は出さない', () => {
      const r = run(shell, ORDER, { FAKE_CURL_RC: '7', FAKE_CODE: '000' });
      expect(r.code).toBe(1);
      expect(r.out).toContain('入口に届いていない');
      for (const v of [FAKE_ID, FAKE_SECRET]) expect(r.out).not.toContain(v);
    });

    it('curl が失敗しても、送った request_id は出ている（送り直しで replay にできる）', () => {
      const r = run(shell, ORDER, { FAKE_CURL_RC: '7', FAKE_CODE: '000' });
      expect(r.code).toBe(1);
      const m = /request_id: ([0-9a-f]{32})/.exec(r.out);
      expect(m).not.toBeNull();
      expect(JSON.parse(readLog('body') as string).request_id).toBe((m as RegExpExecArray)[1]);
    });

    it('親の環境で CF_ID / CF_SECRET が export されていても、curl の環境に鍵は渡らない', () => {
      const r = run(shell, ORDER, { CF_ID: '', CF_SECRET: 'parent-value' });
      expect(r.code).toBe(0);
      const exported = readLog('exported') as string;
      for (const v of [FAKE_ID, FAKE_SECRET]) expect(exported).not.toContain(v);
      expect(exported).not.toMatch(/CF_ID|CF_SECRET/);
    });

    it('curl の最初の引数は -q（~/.curlrc を読まない）', () => {
      const r = run(shell, ORDER);
      expect(r.code).toBe(0);
      expect((readLog('argv') as string).split('\n')[0]).toBe('-q');
    });

    it('keychain に無い → 入れ方の 2 行を出して exit 2（curl は呼ばない）', () => {
      const r = run(shell, ORDER, { FAKE_KEYCHAIN_MISSING: '1' });
      expect(r.code).toBe(2);
      expect(r.out).toContain('security add-generic-password -U -s de-factory-order -a client-id -w');
      expect(r.out).toContain('security add-generic-password -U -s de-factory-order -a client-secret -w');
      expect(readLog('argv')).toBeNull();
    });

    it('注文の JSON が読めない・ファイルが無い → exit 1（curl は呼ばない）', () => {
      expect(run(shell, '{ not json').code).toBe(1);
      expect(run(shell, '[1, 2]').code).toBe(1);
      const r = spawnSync(shell[0], [...shell.slice(1), SCRIPT, join(dir, 'missing.json')], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: dir, TMPDIR: tmp, FAKE_LOG: log } });
      expect(r.status).toBe(1);
      expect(readLog('argv')).toBeNull();
    });
  });
});
