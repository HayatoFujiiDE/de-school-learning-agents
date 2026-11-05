#!/usr/bin/env node
// 作るの提案（contract-app §AE-5）と作品展示（§AG）の写真風サムネイルを作る。node 単体・依存なし。
//
// 実行はふじさんの通常ターミナルで（agent からは --dry-run だけ）:
//   node tools/gen-thumbs.mjs --dry-run      呼ばずに対象と件数だけ出す（鍵も読まない）
//   node tools/gen-thumbs.mjs                出力が無い id だけ作る（1 回の実行で最大 MAX_CALLS 回）
//   node tools/gen-thumbs.mjs --only <id>    1 枚だけ
// 鍵は環境変数 OPENAI_API_KEY から読む。標準出力・エラー文・ファイルに鍵を書かない。
// 429・quota・認証エラーが 1 回出たらその場で止まり、終了コード 1（自動で再試行しない）。
// 最後に app-v3/js/thumbs.js を書き出す（存在するファイルだけを一覧に入れる）。

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = join(dirname(fileURLToPath(import.meta.url)), '..', 'app-v3');

// モデル・大きさ・質は工場の画像生成（factory/worker）と同じ値。根拠の行は実行のたびに出力する
const MODEL = 'gpt-image-2.5-flare';
const SIZE = '1536x1024'; // 横長
const QUALITY = 'medium';
const FORMAT = 'webp';
const BACKGROUND = 'opaque';
const SOURCES = [
  'factory/worker/wrangler.jsonc:60  "IMAGE_MODEL_STANDARD": "gpt-image-2.5-flare"',
  "factory/worker/src/env.ts:97  imageModelStandard: (env.IMAGE_MODEL_STANDARD || 'gpt-image-2.5-flare').trim()",
  "factory/worker/src/images.ts:52  'gpt-image-2.5-flare': U_BY_SIZE_QUALITY（U の表にある model）",
  "factory/worker/src/images.ts:81  const SIZES = ['1024x1024', '1536x1024']（横長 = 1536x1024）",
  "factory/worker/src/images.ts:82  const QUALITIES = ['low', 'medium', 'high', 'max']（U が同じ low〜high のうち medium）",
  "factory/worker/src/images.ts:83  const FORMATS = ['png', 'webp']",
  "factory/worker/src/openai.ts:47  IMAGES_URL = 'https://api.openai.com/v1/images/generations'（同じ本文の形: model / prompt / size / quality / output_format / background / n）",
];
const API_URL = 'https://api.openai.com/v1/images/generations';
const MAX_CALLS = 17;
const TIMEOUT_MS = 180_000;

// プロンプトの共通の約束（contract-app §AE-5 verbatim。illust は後半を替える）
const RULE = '人物・顔・手・文字・ロゴ・商標のあるキャラクターを入れない。';
const TAIL_PHOTO = RULE + '子どもの机の上で撮った自然光の写真のように。';
const TAIL_ILLUST = RULE + 'やわらかい水彩のイラストで。';

// 対象（固定の 17 枚 = 提案の photo・illust 10 枚 + 作品展示の photo・illust 7 枚）
const TARGETS = [
  { id: 'pj-stop-moon', dir: 'make', style: 'photo', prompt: '黒い紙の上に、白い紙を丸く切って作った月の満ち欠けが 8 つ、左から右へ順に並んでいる。横に小さなスタンドに立てたタブレットとはさみ。' },
  { id: 'pj-mc-ath', dir: 'make', style: 'photo', prompt: '四角いブロックだけでできた空中アスレチックコースのミニチュア模型。四角い足場が間をあけて並び、そのうち 1 つは緑のはねるブロック。' },
  { id: 'pj-novel-3', dir: 'make', style: 'illust', prompt: '手作りの小さな本。表紙に雨の窓と本棚の絵があり、横に 3 枚の原稿用紙とえんぴつ。' },
  { id: 'pj-trailer', dir: 'make', style: 'photo', prompt: 'スタンドに立てたタブレットのカメラが、机の上に開いた絵本に向いている。本には付せんが 3 枚はさまっている。' },
  { id: 'pj-scratch-quiz', dir: 'make', style: 'photo', prompt: 'ノートパソコンの画面に、色のついたブロックをつなげて作るプログラムが映っている。横に白いメモ用紙と色えんぴつ。' },
  { id: 'pj-marble', dir: 'make', style: 'photo', prompt: 'ダンボールで作ったジグザグのビー玉コースター。テープでとめた坂が 3 段あり、ガラスのビー玉が 1 つのっている。' },
  { id: 'pj-3d-key', dir: 'make', style: 'photo', prompt: '3D プリンターで出した星の形の小さなキーホルダー。金属のリングが付いている。横に方眼紙の下書き。' },
  { id: 'pj-stamp', dir: 'make', style: 'illust', prompt: '丸くてやわらかい動物のキャラクターが、表情を変えて 4 つ並んだスタンドのシート。' },
  { id: 'pj-sugoroku', dir: 'make', style: 'photo', prompt: '大きな紙に手で描いたすごろくのマス目。色えんぴつ、サイコロ 1 つ、ボタンのコマ 2 つ。' },
  { id: 'pj-tokusatsu', dir: 'make', style: 'photo', prompt: '紙と箱で作った小さな町のミニチュアを、低い位置から見上げたところ。建物 3 つと道。' },
  { id: 'g-clay-walk', dir: 'gallery', style: 'photo', prompt: '緑の粘土で作った小さなカエル。少ししゃがんだ形で、木の机の上にいる。' },
  { id: 'g-ice-course', dir: 'gallery', style: 'photo', prompt: '水色の四角いブロックが間をあけて並ぶ、氷のアスレチックコースのミニチュア模型。最後の足場だけ小さい。' },
  { id: 'g-rain-novel', dir: 'gallery', style: 'illust', prompt: '手作りの小説の表紙。雨つぶが降る窓と、しずくの形の飾り。' },
  { id: 'g-lamp', dir: 'gallery', style: 'photo', prompt: '木と白い紙で作った小さな机のあかり。少し暗い部屋でやさしく光っている。' },
  { id: 'g-4koma', dir: 'gallery', style: 'illust', prompt: '4 つのコマに分かれた紙。どのコマにも、ふとんで丸くなって寝ているねこが描かれている。' },
  { id: 'g-coaster', dir: 'gallery', style: 'photo', prompt: 'ダンボールで作った、3 回曲がるビー玉コースター。いちばん下に小さなベルが付いている。' },
  { id: 'g-stamp', dir: 'gallery', style: 'illust', prompt: 'しっぽをふる丸い動物のスタンプが 2 つ。左と右でしっぽの向きがちがう。' },
];

function promptOf(t) { return t.prompt + (t.style === 'illust' ? TAIL_ILLUST : TAIL_PHOTO); }
function relOf(t, ext) { return 'img/' + t.dir + '/' + t.id + '.' + ext; }
function existing(t) {
  for (const ext of ['webp', 'png']) if (existsSync(join(APP, relOf(t, ext)))) return relOf(t, ext);
  return null;
}

function parseArgs(argv) {
  const o = { dryRun: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--only') { o.only = argv[i + 1] || ''; i++; }
    else { console.error('知らない引数: ' + a.slice(0, 40)); process.exit(2); }
  }
  return o;
}

// thumbs.js（存在するファイルだけ）。値はこのスクリプトが決めたパスだけ
function writeThumbs() {
  const list = {};
  for (const t of TARGETS) { const rel = existing(t); if (rel) list[t.id] = rel; }
  const body = Object.keys(list).map((id) => '  ' + JSON.stringify(id) + ': ' + JSON.stringify(list[id])).join(',\n');
  const src = '/* 作るの提案（§AE-5）・作品展示（§AG）の画像の一覧。tools/gen-thumbs.mjs が画像と一緒に書き出す（存在するファイルだけ）。\n' +
    '   一覧に無い id はカテゴリの線画。 */\n' +
    'window.DES = window.DES || {};\n' +
    'window.DES.thumbs = {' + (body ? '\n' + body + '\n' : '') + '};\n';
  writeFileSync(join(APP, 'js', 'thumbs.js'), src);
  return Object.keys(list).length;
}

// 返ってきた画像の形（webp / png）を中身で判定する
function kindOf(buf) {
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  return null;
}

// 止まる理由（429・quota・認証）。本文は出さず、status と error.code だけを読む
function isStopError(status, code) {
  return status === 429 || status === 401 || status === 403 || /quota|billing|insufficient|invalid_api_key|rate_limit/i.test(code || '');
}
// エラーの時に出す文は、この決まった分類だけ（API が返した文字列・例外の名前をそのまま出さない。レビューへの裁定）
const WHY = {
  timeout: 'timeout',
  connection: 'connection_error',
  rate_limit: 'rate_limit (429)',
  quota: 'quota_or_billing',
  auth: 'auth_error (401/403)',
  server: 'server_error (5xx)',
  request: 'request_error (4xx)',
  other: 'unexpected_status',
  bad_response: 'bad_response',
  crashed: 'internal_error',
};
// status と error.code を読んで分類する（code は判定にだけ使い、出力には入れない）
function whyOf(status, code) {
  if (status === 429) return /quota|billing|insufficient/i.test(code || '') ? WHY.quota : WHY.rate_limit;
  if (/quota|billing|insufficient/i.test(code || '')) return WHY.quota;
  if (status === 401 || status === 403 || /invalid_api_key/i.test(code || '')) return WHY.auth;
  if (status >= 500 && status < 600) return WHY.server;
  if (status >= 400 && status < 500) return WHY.request;
  return WHY.other;
}

async function callOnce(key, t) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, prompt: promptOf(t), size: SIZE, quality: QUALITY, output_format: FORMAT, background: BACKGROUND, n: 1 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const timedOut = !!(e && (e.name === 'TimeoutError' || e.name === 'AbortError'));
    return { ok: false, stop: false, why: timedOut ? WHY.timeout : WHY.connection };
  }
  let parsed = null;
  try { parsed = await res.json(); } catch { parsed = null; }
  if (!res.ok) {
    const code = parsed && parsed.error && typeof parsed.error.code === 'string' ? parsed.error.code.slice(0, 60) : '';
    return { ok: false, stop: isStopError(res.status, code), why: whyOf(res.status, code) };
  }
  const b64 = parsed && Array.isArray(parsed.data) && parsed.data[0] && typeof parsed.data[0].b64_json === 'string' ? parsed.data[0].b64_json : '';
  const buf = Buffer.from(b64, 'base64'), kind = kindOf(buf);
  if (!kind) return { ok: false, stop: false, why: WHY.bad_response };
  return { ok: true, buf: buf, kind: kind };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  let targets = TARGETS;
  if (o.only != null) {
    targets = TARGETS.filter((t) => t.id === o.only);
    if (!targets.length) { console.error('対象に無い id: ' + String(o.only).slice(0, 40)); process.exit(2); }
  }
  console.log('model=' + MODEL + ' size=' + SIZE + ' quality=' + QUALITY + ' format=' + FORMAT);
  for (const s of SOURCES) console.log('  根拠: ' + s);
  const todo = [];
  for (const t of targets) {
    const have = existing(t);
    console.log((have ? 'skip (ある)  ' : 'make        ') + t.id + '  → app-v3/' + (have || relOf(t, FORMAT)) + '  [' + t.style + ']');
    if (!have) todo.push(t);
  }
  const plan = Math.min(todo.length, MAX_CALLS);
  if (o.dryRun) {
    console.log('targets=' + targets.length + ' to_make=' + todo.length + ' would_call=' + plan + ' max_calls=' + MAX_CALLS + ' api_calls=0 (dry-run)');
    return 0;
  }
  const key = process.env.OPENAI_API_KEY;
  if (!key) { console.error('OPENAI_API_KEY が設定されていない（値は表示しない）'); return 1; }
  let calls = 0, made = 0, rc = 0;
  for (const t of todo) {
    if (calls >= MAX_CALLS) { console.log('MAX_CALLS に達したので止める'); break; }
    calls += 1;
    const r = await callOnce(key, t);
    if (!r.ok) {
      console.error('失敗 ' + t.id + ': ' + r.why + (r.stop ? '（止める。再試行しない）' : '（止める）'));
      rc = 1;
      break;
    }
    const rel = relOf(t, r.kind);
    mkdirSync(join(APP, 'img', t.dir), { recursive: true });
    writeFileSync(join(APP, rel), r.buf);
    made += 1;
    console.log('saved ' + t.id + ' → app-v3/' + rel);
  }
  const listed = writeThumbs();
  console.log('targets=' + targets.length + ' made=' + made + ' api_calls=' + calls + ' thumbs_listed=' + listed);
  return rc;
}

main().then((rc) => { process.exitCode = rc; }, () => { console.error('止まった: ' + WHY.crashed); process.exitCode = 1; });
