-- 契約 §O-1 verbatim（画像生成 段階 2）
-- 1. cost_ledger.kind に 'image' を足す。CHECK は ALTER できないので 0002 と同じ手順で作り直す。
--    DROP TABLE で idx_cost_day と idx_cost_ledger_vb も消えるので両方作り直す
CREATE TABLE cost_ledger_v3 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v3 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v3 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
-- 画像の記帳は job ごとに 1 行だけ（ref_id = 'ih:' || job_id が取り置き中、'if:' || job_id が確定後）
CREATE UNIQUE INDEX idx_cost_ledger_image_job ON cost_ledger(substr(ref_id, 4)) WHERE kind = 'image';

-- 2. 依頼（agent.custom_tool_use 1 件 = 1 行 = OpenAI 呼び出し最大 1 回）
CREATE TABLE image_requests (
  id TEXT PRIMARY KEY,                                   -- 'img_' + 32 桁の hex。職人に返す image_id
  custom_tool_use_id TEXT NOT NULL UNIQUE,
  job_id TEXT NOT NULL REFERENCES factory_jobs(id),
  session_id TEXT NOT NULL,
  model TEXT, size TEXT, quality TEXT, format TEXT CHECK (format IN ('png','webp')), background TEXT,
  u_cents INTEGER,                                       -- この組み合わせの U。断った行は NULL
  input_json TEXT NOT NULL DEFAULT '{}',                 -- 検査済みの {prompt, alt, accuracy}。ログに出さない
  state TEXT NOT NULL CHECK (state IN ('queued','dispatched','done','refused','failed')),
  error TEXT,                                            -- 固定コードだけ（§O-6 の表）
  enqueue_count INTEGER NOT NULL DEFAULT 0, enqueued_at TEXT,
  dispatch_token TEXT, dispatched_at TEXT,
  usage_json TEXT,                                       -- 応答があった時だけ。usage が無ければ '{"missing":true}'
  actual_cents INTEGER,                                  -- usage から出した実額（表示と停止の判定だけに使う。記帳には使わない）
  r2_key TEXT, sha256 TEXT, bytes INTEGER, media_type TEXT,
  file_id TEXT,                                          -- §O-6 の形 B を採った時だけ使う
  cleaned_at TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((state = 'queued' AND u_cents IS NOT NULL AND dispatched_at IS NULL)
      OR (state = 'dispatched' AND dispatch_token IS NOT NULL AND dispatched_at IS NOT NULL)
      OR (state = 'done' AND r2_key IS NOT NULL AND sha256 IS NOT NULL)
      OR state IN ('refused','failed'))
);
CREATE INDEX idx_image_requests_job ON image_requests(job_id, state);
CREATE INDEX idx_image_requests_state ON image_requests(state, updated_at);
-- settings の新しい key: image_gen_halted（値 = 理由コード。§O-5 d）
