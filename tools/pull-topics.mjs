#!/usr/bin/env node
/* 工場のお題をアプリに出す（contract-app §AF-9）。node 単体・依存なし。
   工場の公開の読み口（認証なし・GET・JSON）を叩き、§AF-3 の対話のお題の形に変えて app-v3/js/topics-live.js に書き出す。
   アプリ（file:// で動く・fetch しない）はこのファイルを <script src> で読むだけ。

   使い方:
     node tools/pull-topics.mjs                     今日から 6 日前までの 7 日分 + ストック（news / talk / philo）を読んで書き出す
     node tools/pull-topics.mjs --dry-run           書かずに件数だけ出す
     node tools/pull-topics.mjs --base <url>        読み口の根を差し替える（既定は本番）
     node tools/pull-topics.mjs --from-file <path>  通信せず、保存済みの {responses: [<応答の JSON>, ...]} から作る（テスト用）
     node tools/pull-topics.mjs --out <path>        書き出す先（既定 app-v3/js/topics-live.js）

   約束:
   - HTTP は 1 回の実行で最大 MAX_HTTP 回（getJson が唯一の出口で数える）・各 TIMEOUT_MS で打ち切る。再試行しない。
   - 200 以外・JSON でない応答はその応答だけ捨てて続ける。全部の応答が失敗したら書かずに終了コード 1（前のファイルを壊さない）。
   - 変換した後の形で検査し、外れたお題は捨てる。出すのは理由コードと件数だけ（本文は標準出力に出さない）。
   - 書き込みは一時ファイル → rename。中身は JSON.stringify で作り、< と U+2028 / U+2029 を \u エスケープにする。
   - 最後に 1 行: PULL_TOPICS http=<n> ok=<n> topics=<n> kept=<n> dropped=<n> make_skipped=<n> wrote=<yes|no> */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BASE = 'https://de-school-factory.h-fujii.workers.dev';
export const DEFAULT_OUT = path.join(HERE, '..', 'app-v3', 'js', 'topics-live.js');
export const MAX_HTTP = 10;
export const TIMEOUT_MS = 15000;
export const DAYS = 7;
export const STOCK_KINDS = ['news', 'talk', 'philo'];
export const STOCK_LIMIT = 20;
export const KINDS = ['news', 'talk', 'philo'];
export const LEVELS = ['check', 'self', 'open'];
export const TEXT_MAX = 300;
// 禁止語（tools/check.sh の forbidden と同じ語。app-v3/js/today-data.js の TDD.FORBIDDEN と同じ配列。一致は tools/today-test.js が確かめる）
export const FORBIDDEN = ['点数', 'ランキング', '順位', '評価', '成績', 'レベル'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const chars = (s) => Array.from(s).length;

/** Asia/Tokyo の今日から n 日前の YYYY-MM-DD */
export function tokyoDay(back = 0, now = new Date()) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(Date.parse(`${today}T00:00:00Z`) - back * 86400000).toISOString().slice(0, 10);
}
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// ---------- 変換（工場の body → §AF-3 の対話のお題） ----------
function pair(l) { return isObj(l) ? [l.s, l.e] : null; }
function srcOf(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  return ids.length === 1 ? ids[0] : ids.slice();
}
function monthDay(day) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return `${+m[2]} 月 ${+m[3]} 日`; }
export function idOf(topicId) { return 'fx-' + String(topicId).replace(/[^A-Za-z0-9_-]/g, '-'); }

/** 読み口の 1 件 { topic_id, kind, needs_supporter, lineage_id, body } → 対話のお題。checked = 取り込んだ日 */
export function convertTopic(item, checked) {
  const b = item.body, kind = item.kind;
  const news = kind === 'news';
  return {
    id: idOf(item.topic_id),
    kind,
    date: news ? (isRealDate(b.event_day) ? [monthDay(b.event_day), monthDay(b.event_day)] : null) : null,
    heavy: item.needs_supporter === true,
    art: null,
    source: 'factory',
    title: pair(b.title),
    lead: pair(b.lead),
    reason: null,
    // 前提（premises）は facts の前に、出典なしの前提として入れる（前提の入口に出す）
    facts: arr(b.premises).map((p) => ({ text: isObj(p) ? pair(p.text) : null, src: null }))
      .concat(arr(b.facts).map((f) => ({ text: isObj(f) ? pair(f.text) : null, src: isObj(f) ? srcOf(f.source_ids) : null }))),
    views: arr(b.views).map((v) => {
      const name = isObj(v) && isObj(v.who) ? v.who.name : null;
      return { who: [name, name], stance: isObj(v) ? pair(v.stance) : null, src: isObj(v) ? srcOf(v.source_ids) : null };
    }),
    asks: arr(b.asks).map((a) => ({ level: isObj(a) ? a.level : null, text: isObj(a) ? pair(a.text) : null })),
    stances: arr(b.stances).map((s) => ({ id: isObj(s) ? s.id : null, label: isObj(s) ? pair(s.label) : null })),
    // learn: 子どもの画面の「参考になる資料」に出すか（工場の sources[].for_learner。true の時だけ true、無い・ほかの値は false。contract-T v2.9）
    sources: arr(b.sources).map((s) => ({ id: isObj(s) ? s.id : null, name: isObj(s) ? s.name : null, url: isObj(s) ? s.url : null, checked, learn: isObj(s) && s.for_learner === true })),
    next: isObj(b.next) ? { talk: pair(b.next.talk), makeTitle: pair(b.next.make_title), makeSteps: arr(b.next.make_steps).map(pair) } : null,
  };
}

// ---------- 検査（変換した後の形で。理由コードの配列・空なら合格） ----------
function okStr(v) { return typeof v === 'string' && v.trim().length > 0 && chars(v) <= TEXT_MAX; }
function okHttps(u) {
  if (typeof u !== 'string' || !u.startsWith('https://')) return false;
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}
export function validateDialog(d) {
  const r = new Set();
  const chkPair = (p) => { if (!Array.isArray(p) || p.length !== 2) r.add('missing'); else if (!okStr(p[0]) || !okStr(p[1])) r.add('text'); };
  if (!isObj(d)) return ['missing'];
  if (typeof d.id !== 'string' || !/^fx-[A-Za-z0-9_-]{1,80}$/.test(d.id)) r.add('id');
  if (!KINDS.includes(d.kind)) r.add('kind');
  if (d.kind === 'news') chkPair(d.date); else if (d.date !== null) r.add('date');
  if (typeof d.heavy !== 'boolean') r.add('missing');
  chkPair(d.title);
  chkPair(d.lead);
  if (!Array.isArray(d.facts) || d.facts.length === 0) r.add('facts');
  if (!Array.isArray(d.views)) r.add('missing');
  if (!Array.isArray(d.asks)) r.add('missing');
  if (!Array.isArray(d.stances)) r.add('missing');
  if (!Array.isArray(d.sources)) r.add('missing');
  if (!isObj(d.next)) r.add('missing');
  if (r.has('missing')) return [...r];
  d.facts.forEach((f) => chkPair(f.text));
  d.views.forEach((v) => { chkPair(v.who); chkPair(v.stance); });
  // asks はちょうど 3 で level が check・self・open 1 つずつ
  const lv = d.asks.map((a) => a.level).sort();
  if (d.asks.length !== 3 || lv.join() !== [...LEVELS].sort().join()) r.add('asks');
  d.asks.forEach((a) => chkPair(a.text));
  // stances 2〜4。id は空でなく重ならない（「まだ決めない」の 'none' と重ならない）
  const sids = d.stances.map((s) => s.id);
  if (d.stances.length < 2 || d.stances.length > 4 || sids.some((x, i) => typeof x !== 'string' || !x || x === 'none' || sids.indexOf(x) !== i)) r.add('stances');
  d.stances.forEach((s) => chkPair(s.label));
  // sources: id は重ならない・name は空でない・url は https:// で new URL() で読める
  const srcIds = d.sources.map((s) => s.id);
  d.sources.forEach((s, i) => {
    if (typeof s.id !== 'string' || !s.id || srcIds.indexOf(s.id) !== i || !okStr(s.name) || !isRealDate(s.checked)) r.add('source');
    if (!okHttps(s.url)) r.add('url');
  });
  // src が指す id が sources にある
  const refs = [];
  d.facts.concat(d.views).forEach((x) => { if (x.src != null) refs.push(...(Array.isArray(x.src) ? x.src : [x.src])); });
  if (refs.some((id) => !srcIds.includes(id))) r.add('src_ref');
  // next
  chkPair(d.next.talk);
  chkPair(d.next.makeTitle);
  if (!Array.isArray(d.next.makeSteps) || d.next.makeSteps.length < 3 || d.next.makeSteps.length > 4) r.add('steps');
  else d.next.makeSteps.forEach(chkPair);
  // 子どもが読む文（中・小の両方）に禁止語があれば捨てる（tools/check.sh の禁止語と同じ。§AF-9）
  if (kidTexts(d).some((s) => typeof s === 'string' && FORBIDDEN.some((w) => s.includes(w)))) r.add('forbidden');
  return [...r];
}
/** 子どもが読む文: title / lead / facts / views / asks / stances / next の中・小（出典の名前・url は含めない） */
export function kidTexts(d) {
  const out = [];
  const add = (p) => { if (Array.isArray(p)) out.push(p[0], p[1]); };
  add(d.title); add(d.lead);
  arr(d.facts).forEach((f) => add(f && f.text));
  arr(d.views).forEach((v) => { add(v && v.who); add(v && v.stance); });
  arr(d.asks).forEach((a) => add(a && a.text));
  arr(d.stances).forEach((s) => add(s && s.label));
  if (isObj(d.next)) { add(d.next.talk); add(d.next.makeTitle); arr(d.next.makeSteps).forEach(add); }
  return out;
}

// ---------- 応答の束 → お題の一覧 ----------
/** responses: 読み口の応答の JSON の配列（失敗した応答は含めない）。返り値は件数と残したお題 */
export function buildTopics(responses, checked) {
  const stat = { topics: 0, kept: 0, dropped: 0, makeSkipped: 0, reasons: {} };
  const drop = (code) => { stat.dropped += 1; stat.reasons[code] = (stat.reasons[code] || 0) + 1; };
  const cands = [];
  let seq = 0;
  for (const res of responses) {
    const day = isRealDate(res.day) ? res.day : null; // ストックの応答には日付が無い（日付つきより古い扱い）
    for (const item of arr(res.topics)) {
      stat.topics += 1;
      if (!isObj(item) || typeof item.topic_id !== 'string' || !item.topic_id || !isObj(item.body)) { drop('shape'); continue; }
      if (item.kind === 'make') { stat.makeSkipped += 1; continue; }
      if (!KINDS.includes(item.kind)) { drop('kind'); continue; }
      let d;
      try { d = convertTopic(item, checked); } catch { drop('shape'); continue; }
      const why = validateDialog(d);
      if (why.length) { drop(why[0]); continue; }
      cands.push({ d, day, seq: seq++, lineage: typeof item.lineage_id === 'string' && item.lineage_id ? item.lineage_id : item.topic_id });
    }
  }
  // 同じ lineage_id は 1 本だけ（日付の新しい方、同じなら先に来た方）。同じ id も 1 本だけ
  cands.sort((a, b) => (a.day === b.day ? a.seq - b.seq : (a.day === null ? 1 : (b.day === null ? -1 : (a.day < b.day ? 1 : -1)))));
  const seenL = new Set(), seenId = new Set(), kept = [];
  for (const c of cands) {
    if (seenL.has(c.lineage)) { drop('dup_lineage'); continue; }
    if (seenId.has(c.d.id)) { drop('dup_id'); continue; }
    seenL.add(c.lineage);
    seenId.add(c.d.id);
    kept.push(c.d);
  }
  stat.kept = kept.length;
  return { stat, topics: kept };
}

const LS_RE = new RegExp(String.fromCharCode(0x2028), "g");
const PS_RE = new RegExp(String.fromCharCode(0x2029), "g");
/** 書き出すファイルの中身（script の閉じタグと古い構文の行区切りを避ける） */
export function renderFile(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c').replace(LS_RE, '\\u2028').replace(PS_RE, '\\u2029');
  return '/* 工場のお題（tools/pull-topics.mjs が書き出す。手で直さない） */\n' +
    'window.DES = window.DES || {};\n' +
    'window.DES.topicsLive = ' + json + ';\n';
}

// ---------- 通信（唯一の出口。回数と時間の上限をここで持つ） ----------
let httpCount = 0;
async function getJson(url) {
  if (httpCount >= MAX_HTTP) return { ok: false, why: 'http_cap' };
  httpCount += 1;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } });
    const text = await res.text();
    if (res.status !== 200) return { ok: false, why: 'status_' + res.status };
    try { return { ok: true, json: JSON.parse(text) }; } catch { return { ok: false, why: 'not_json' }; }
  } catch (e) {
    return { ok: false, why: e && e.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}
function okResponse(j) { return isObj(j) && Array.isArray(j.topics); }

function parseArgs(argv) {
  const o = { base: DEFAULT_BASE, dryRun: false, fromFile: null, out: DEFAULT_OUT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--base' || a === '--from-file' || a === '--out') {
      const v = argv[++i];
      if (!v) throw new Error('missing value for ' + a);
      if (a === '--base') o.base = v.replace(/\/+$/, '');
      else if (a === '--from-file') o.fromFile = v;
      else o.out = v;
    } else throw new Error('unknown argument ' + a);
  }
  if (!o.fromFile && !/^https?:\/\/[^\s/]+/.test(o.base)) throw new Error('--base must be an http(s) URL');
  return o;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error('pull-topics: ' + e.message);
    console.log('PULL_TOPICS http=0 ok=0 topics=0 kept=0 dropped=0 make_skipped=0 wrote=no');
    process.exit(2);
  }
  const checked = tokyoDay(0);
  const good = [];
  let tried = 0;
  if (opts.fromFile) {
    let raw = null;
    try { raw = JSON.parse(fs.readFileSync(opts.fromFile, 'utf8')); } catch { raw = null; }
    const list = isObj(raw) && Array.isArray(raw.responses) ? raw.responses : [];
    if (!list.length) console.log('skip from-file not_readable');
    list.forEach((j, i) => { tried += 1; if (okResponse(j)) good.push(j); else console.log('skip response#' + i + ' shape'); });
  } else {
    const reqs = [];
    for (let k = 0; k < DAYS; k++) { const day = tokyoDay(k); reqs.push({ label: 'day=' + day, url: `${opts.base}/api/library/topics?day=${day}` }); }
    for (const kind of STOCK_KINDS) reqs.push({ label: 'stock=' + kind, url: `${opts.base}/api/library/topics/stock?kind=${kind}&limit=${STOCK_LIMIT}` });
    for (const q of reqs) {
      tried += 1;
      const r = await getJson(q.url);
      if (!r.ok) { console.log('skip ' + q.label + ' ' + r.why); continue; }
      if (!okResponse(r.json)) { console.log('skip ' + q.label + ' shape'); continue; }
      good.push(r.json);
    }
  }
  const { stat, topics } = buildTopics(good, checked);
  Object.keys(stat.reasons).sort().forEach((k) => console.log('drop ' + k + '=' + stat.reasons[k]));
  let wrote = 'no', code = 0;
  if (good.length === 0) code = 1; // 全部失敗: 書かない（前のファイルを壊さない）
  else if (!opts.dryRun) {
    const payload = { pulledAt: new Date().toISOString(), base: opts.fromFile ? 'from-file' : opts.base, topics };
    const tmp = path.join(path.dirname(opts.out), '.' + path.basename(opts.out) + '.tmp-' + process.pid);
    try {
      fs.writeFileSync(tmp, renderFile(payload), 'utf8');
      fs.renameSync(tmp, opts.out);
      wrote = 'yes';
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch { /* 無ければよい */ }
      console.error('pull-topics: write failed ' + (e && e.code ? e.code : 'error'));
      code = 1;
    }
  }
  console.log(`PULL_TOPICS http=${httpCount} ok=${good.length} topics=${stat.topics} kept=${stat.kept} dropped=${stat.dropped} make_skipped=${stat.makeSkipped} wrote=${wrote}`);
  if (tried === 0 && code === 0) code = 1;
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
