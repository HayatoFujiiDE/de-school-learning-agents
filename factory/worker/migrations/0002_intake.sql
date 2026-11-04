-- 契約 §K-2（verbatim）。proposals / scout_runs / meeting_minutes と、cost_ledger.kind に 'scout' 'meeting' を足すための作り直し
CREATE TABLE proposals (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('child','scout','meeting','manual')),
  source_ref TEXT,                         -- scout_runs.id / meeting_minutes.id / intake の submitted_by。child は個人を含まない値だけ
  title TEXT NOT NULL, body TEXT NOT NULL, -- body は提案文（題材・つながる概念・足りなかったこと・年齢帯）。最大 2000 文字
  evidence_json TEXT NOT NULL DEFAULT '[]',-- [{url, title, fetched_at, note}] URL は発想の入口。根拠扱いしない
  concept_codes_json TEXT NOT NULL DEFAULT '[]',
  catalog_item_id TEXT, kinds_json TEXT NOT NULL DEFAULT '[]',
  age_band TEXT CHECK (age_band IN ('elementary','secondary','both')),
  priority INTEGER NOT NULL DEFAULT 0,     -- 会議が付ける 1..5。他は 0
  similar_count INTEGER NOT NULL DEFAULT 0,-- 挿入時に concept_codes か catalog_item_id が重なる既存提案の数（LLM なし）
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','adopted','dismissed')),
  supporter_checked INTEGER NOT NULL DEFAULT 0,
  decided_by TEXT, decided_at TEXT, decision_note TEXT, material_id TEXT
);
CREATE INDEX idx_proposals_status ON proposals(status, created_at);
CREATE TABLE scout_runs (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  status TEXT NOT NULL CHECK (status IN ('running','done','failed','skipped')),
  rss_items INTEGER NOT NULL DEFAULT 0, x_posts INTEGER NOT NULL DEFAULT 0,
  proposed INTEGER NOT NULL DEFAULT 0, dropped INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE TABLE meeting_minutes (
  id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  status TEXT NOT NULL CHECK (status IN ('submitted','ended','failed','expired')),
  batch_id TEXT, minutes_json TEXT, proposed INTEGER NOT NULL DEFAULT 0,
  cents INTEGER NOT NULL DEFAULT 0, last_error TEXT
);
CREATE TABLE cost_ledger_v2 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v2 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v2 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
