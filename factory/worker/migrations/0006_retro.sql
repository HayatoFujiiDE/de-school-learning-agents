-- 契約 §S-1（振り返り係 retro）
-- 1. cost_ledger.kind に 'retro' を足す。CHECK は ALTER できないので 0004 / 0005 と同じ手順で作り直す。
--    DROP TABLE で既存の索引 4 つ（idx_cost_day / idx_cost_ledger_vb / idx_cost_ledger_image_job / idx_cost_ledger_topic）も消えるので、同じ定義で作り直す
CREATE TABLE cost_ledger_v5 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image','topic','retro')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v5 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v5 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
CREATE UNIQUE INDEX idx_cost_ledger_image_job ON cost_ledger(substr(ref_id, 4)) WHERE kind = 'image';
CREATE UNIQUE INDEX idx_cost_ledger_topic ON cost_ledger(ref_id) WHERE kind = 'topic';

-- 2. 振り返り（job ごとに 1 行）
CREATE TABLE job_retros (
  job_id TEXT PRIMARY KEY REFERENCES factory_jobs(id), material_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('collecting','ready','submitted','ended','failed','skipped')),
  collect_json TEXT NOT NULL DEFAULT '{}',   -- 集計の途中（cursor と acc）。submitted 以降は {submitted_at, tip_ids}
  metrics_json TEXT,                         -- §S-3 の確定値
  batch_id TEXT, result_json TEXT,           -- §S-4 の検査済みの出力
  cents INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_job_retros_status ON job_retros(status, updated_at);

-- 3. 工夫（§S-5）
CREATE TABLE retro_tips (
  id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES factory_jobs(id),
  target TEXT NOT NULL CHECK (target IN ('maker_note','maker_definition','worker_code','order')),
  text TEXT NOT NULL, reason TEXT NOT NULL,
  expected_saving_cents INTEGER NOT NULL DEFAULT 0,
  quality_risk TEXT NOT NULL CHECK (quality_risk IN ('none','low','medium')),
  status TEXT NOT NULL CHECK (status IN ('proposed','active','retired','rejected')),
  decided_by TEXT CHECK (decided_by IN ('auto','human')),
  activated_at TEXT, retired_at TEXT, retire_reason TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_retro_tips_status ON retro_tips(status, target, created_at);
-- settings の新しい key: retro_since（初回の tick の時刻）/ retro_enabled（'0' で止める）/ retro_auto_adopt（'0' で自動で入れない）
