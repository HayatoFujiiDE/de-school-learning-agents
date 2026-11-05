// fetch / scheduled の入口とルーティング（契約 §B-1, §B-3）。フレームワークは使わない。
// run_worker_first: true なので静的ファイルを含む全リクエストがここを通る。
import { getImagePort, getOEmbedPort, getPort, handleFakeControl } from './anthropic';
import { jsonError, requireAccess } from './access';
import { runCron } from './cron';
import type { Env } from './env';
import { getSetting } from './db';
import { json, makeCtx, type RouteCtx } from './http';
import { runImage } from './images';
import { getFloor } from './routes/floor';
import { answerJobRoute, cancelJobRoute, createJob, getJobDetail, raiseBudgetRoute, reconcileJobRoute, reingestJobRoute, startJobRoute } from './routes/jobs';
import { libraryAvailable, libraryFile } from './routes/library';
import { createMaterial, getMaterialDetail, listMaterials, rollbackMaterial, stopMaterial } from './routes/materials';
import {
  adoptProposal,
  createProposal,
  dismissProposal,
  intake,
  latestMeeting,
  listProposals,
  runMeetingRoute,
  runScoutRoute,
} from './routes/proposals';
import { decide, listReview, reverify, reviewDetail, reviewFile } from './routes/review';
import { addStandard, getStandards } from './routes/standards';
import { getStatus, setPause } from './routes/status';
import { handleWebhook } from './routes/webhook';
import { getImagesStatus, haltImages, imageRequestFile, unhaltImages } from './routes/images';
import { enableVideos, getVideosStatus, probeVideo } from './routes/videos';

type Handler = (c: RouteCtx, ...params: string[]) => Promise<Response>;
const ID = '([A-Za-z0-9-]{1,64})';

const ROUTES: Array<[string, RegExp, Handler]> = [
  ['GET', /^\/api\/images\/status$/, getImagesStatus],
  ['POST', /^\/api\/images\/halt$/, haltImages],
  ['POST', /^\/api\/images\/unhalt$/, unhaltImages],
  ['GET', /^\/api\/images\/requests\/(img_[0-9a-f]{32})\/file$/, imageRequestFile],
  // 動画の確認（§Q-9.5）と probe（§Q-6。一時 route。結果を確かめた後の PR で消す）
  ['GET', /^\/api\/videos\/status$/, (c) => getVideosStatus(c)],
  ['POST', /^\/api\/videos\/enable$/, (c) => enableVideos(c)],
  ['POST', /^\/api\/probe\/video$/, (c) => probeVideo(c)],
  ['POST', /^\/api\/materials$/, createMaterial],
  ['GET', /^\/api\/materials$/, listMaterials],
  ['GET', new RegExp(`^/api/materials/${ID}$`), getMaterialDetail],
  ['POST', new RegExp(`^/api/materials/${ID}/stop$`), stopMaterial],
  ['POST', new RegExp(`^/api/materials/${ID}/rollback$`), rollbackMaterial],
  ['POST', /^\/api\/jobs$/, createJob],
  ['GET', new RegExp(`^/api/jobs/${ID}$`), getJobDetail],
  ['POST', new RegExp(`^/api/jobs/${ID}/start$`), startJobRoute],
  ['POST', new RegExp(`^/api/jobs/${ID}/answer$`), answerJobRoute],
  ['POST', new RegExp(`^/api/jobs/${ID}/cancel$`), cancelJobRoute],
  ['POST', new RegExp(`^/api/jobs/${ID}/reconcile$`), reconcileJobRoute],
  ['POST', new RegExp(`^/api/jobs/${ID}/reingest$`), reingestJobRoute],
  ['POST', new RegExp(`^/api/jobs/${ID}/raise-budget$`), raiseBudgetRoute], // §B-4-f（運営の増額操作だけ）
  ['GET', /^\/api\/review$/, listReview],
  ['GET', new RegExp(`^/api/review/${ID}$`), reviewDetail],
  ['GET', new RegExp(`^/api/review/${ID}/files/(.*)$`), reviewFile],
  ['POST', new RegExp(`^/api/review/${ID}/decision$`), decide],
  ['POST', new RegExp(`^/api/review/${ID}/reverify$`), reverify],
  ['GET', /^\/api\/status$/, getStatus],
  ['GET', /^\/api\/floor$/, getFloor], // 工場ビュー（§N-1）
  ['POST', /^\/api\/status\/pause$/, setPause],
  ['GET', /^\/api\/standards$/, getStandards],
  ['POST', /^\/api\/standards$/, addStandard],
  // 入口（§K-3）
  ['GET', /^\/api\/proposals$/, listProposals],
  ['POST', /^\/api\/proposals$/, createProposal],
  ['POST', new RegExp(`^/api/proposals/${ID}/adopt$`), adoptProposal],
  ['POST', new RegExp(`^/api/proposals/${ID}/dismiss$`), dismissProposal],
  ['POST', /^\/api\/intake$/, intake],
  ['POST', /^\/api\/scout\/run$/, runScoutRoute],
  ['POST', /^\/api\/meeting\/run$/, runMeetingRoute],
  ['GET', /^\/api\/meeting\/latest$/, latestMeeting],
];

// 管理画面に付ける CSP（同一 origin の /api/* だけを読む。確認用 iframe は sandbox 付きで同一 origin から読む）。
// §Q-5・§Q-9.8: 確認画面の動画の埋め込みのため frame-src に youtube-nocookie だけを足す（/admin の HTML だけ。生成物の配信の CSP は変えない）
const ADMIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://www.youtube-nocookie.com; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

async function serveAdmin(request: Request, env: Env): Promise<Response> {
  const res = await env.ASSETS.fetch(request);
  const headers = new Headers(res.headers);
  headers.set('content-security-policy', ADMIN_CSP);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      // 署名のみ（Access の外）
      if (path === '/webhook') {
        if (request.method !== 'POST') return jsonError(405, 'method_not_allowed');
        return await handleWebhook(request, env, exec);
      }
      // 認証なし（公開・読み取り専用）
      if (path.startsWith('/api/library/')) {
        if (request.method !== 'GET') return jsonError(405, 'method_not_allowed');
        if (path === '/api/library/available') return await libraryAvailable(env);
        const m = new RegExp(`^/api/library/files/${ID}/(.*)$`).exec(path);
        if (m) return await libraryFile(env, m[1], m[2]);
        return jsonError(404, 'not_found');
      }

      const isAdmin = path === '/admin' || path.startsWith('/admin/');
      const isApi = path.startsWith('/api/');
      const isFake = path.startsWith('/__fake/');
      if (!isAdmin && !isApi && !isFake) return jsonError(404, 'not_found');

      // それ以外はすべて Access（/api/intake だけ service token の common_name も受ける。§K-3）
      const access = await requireAccess(request, env, { allowCommonName: path === '/api/intake' });
      if (!access.ok) return access.response;

      if (isFake) {
        const r = await handleFakeControl(request, env);
        return r ?? jsonError(404, 'not_found');
      }
      if (isAdmin) {
        if (request.method !== 'GET' && request.method !== 'HEAD') return jsonError(405, 'method_not_allowed');
        return await serveAdmin(request, env);
      }
      const ctx = makeCtx(env, request, exec, access.email);
      for (const [method, re, handler] of ROUTES) {
        const m = re.exec(path);
        if (m && request.method === method) return await handler(ctx, ...m.slice(1));
      }
      return jsonError(404, 'not_found');
    } catch (e) {
      console.log(JSON.stringify({ at: 'fetch_error', path: path.slice(0, 80), kind: e instanceof Error ? e.name : 'error' }));
      return json(500, { error: 'internal_error' });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runCron(env);
  },

  // 画像生成の consumer（契約 §O-4 b verbatim）。max_batch_size 1・max_retries 2・max_concurrency 2（wrangler.jsonc）
  async queue(batch: MessageBatch<{ request_id: string }>, env: Env, ctx: ExecutionContext): Promise<void> {
    const portCtx = { hostname: null, fakeEnabledSetting: await getSetting(env.DB, 'fake_enabled') };
    const port = await getPort(env, portCtx);
    const images = await getImagePort(env, portCtx);
    // §Q-13: consumer の後の reconcile が職人の道具 youtube_info を処理する時の oEmbed の port
    const oembed = await getOEmbedPort(env, portCtx);
    for (const msg of batch.messages) {
      const id = String((msg.body as { request_id?: unknown })?.request_id ?? '');
      if (!/^img_[0-9a-f]{32}$/.test(id)) { msg.ack(); continue; }
      try {
        await runImage(env, port, images, id, { deadline: Date.now() + 5 * 60_000, oembed });
        msg.ack();
      } catch (e) {
        console.log(JSON.stringify({ at: 'image_queue', request_id: id, error: e instanceof Error ? e.name : 'error' }));
        msg.retry();
      }
    }
  },
} satisfies ExportedHandler<Env, { request_id: string }>;
