CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
-- keys: paused ('0'|'1'), paused_note, last_cron_at, fake_enabled, fake_scenario（fake はローカルのみ）

CREATE TABLE materials (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
  catalog_item_id TEXT, concept_codes_json TEXT NOT NULL DEFAULT '[]', kinds_json TEXT NOT NULL,
  work_status TEXT NOT NULL CHECK (work_status IN ('idle','queued','making','review')),
  publish_status TEXT NOT NULL CHECK (publish_status IN ('none','available','stopped')) DEFAULT 'none',
  current_version_id TEXT, proposal_id TEXT, brief_md TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE factory_jobs (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  kind TEXT NOT NULL CHECK (kind IN ('draft','rework')), model TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('questions','making')),
  status TEXT NOT NULL CHECK (status IN ('queued','creating','running','needs_answer','budget_reached','done','failed','cancelled')),
  session_id TEXT UNIQUE, session_created_at TEXT, parent_version_id TEXT,
  brief_md TEXT NOT NULL, questions_json TEXT, answers_json TEXT,
  answer_state TEXT NOT NULL CHECK (answer_state IN ('none','saved','sending','sent')) DEFAULT 'none', answered_at TEXT,
  answer_token TEXT, create_attempts INTEGER NOT NULL DEFAULT 0, budget_cents INTEGER NOT NULL DEFAULT 0,
  deny_count INTEGER NOT NULL DEFAULT 0, denied_event_ids_json TEXT NOT NULL DEFAULT '[]',
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  reconcile_stage TEXT NOT NULL DEFAULT 'none', reconcile_state_json TEXT NOT NULL DEFAULT '{}',
  reconcile_token TEXT, reconcile_until TEXT,
  last_checked_at TEXT, last_error TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_jobs_one_active_per_material ON factory_jobs(material_id)
  WHERE status IN ('queued','creating','running','needs_answer','budget_reached');
CREATE INDEX idx_jobs_status ON factory_jobs(status, last_checked_at);

CREATE TABLE material_versions (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  version INTEGER NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES factory_jobs(id),
  session_id TEXT NOT NULL, r2_prefix TEXT NOT NULL, content_sha256 TEXT NOT NULL,
  material_json TEXT NOT NULL, claims_json TEXT NOT NULL, adapt_rules_md TEXT NOT NULL,
  selfcheck_md TEXT, grader_result TEXT, grader_explanation TEXT,
  checks_json TEXT NOT NULL, public_paths_json TEXT NOT NULL, tech_dependencies_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('review','approved','rejected')),
  verification_status TEXT NOT NULL CHECK (verification_status IN ('pending','running','done','failed')) DEFAULT 'pending',
  verification_attempts INTEGER NOT NULL DEFAULT 0, verification_started_at TEXT, verification_token TEXT,
  list_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, UNIQUE (material_id, version)
);
CREATE INDEX idx_versions_material ON material_versions(material_id, version);

CREATE TABLE sources (
  id TEXT PRIMARY KEY, material_version_id TEXT NOT NULL REFERENCES material_versions(id),
  source_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT, accessed_at TEXT, quoted_excerpt TEXT,
  license TEXT NOT NULL DEFAULT 'unknown', is_primary INTEGER NOT NULL DEFAULT 0,
  url_was_fetched INTEGER NOT NULL DEFAULT 0, quote_found INTEGER NOT NULL DEFAULT 0, check_detail TEXT
);

CREATE TABLE verifications (
  id TEXT PRIMARY KEY, material_version_id TEXT NOT NULL REFERENCES material_versions(id),
  attempt INTEGER NOT NULL,
  model TEXT NOT NULL, claims_total INTEGER NOT NULL, confirmed INTEGER NOT NULL, hypothesis INTEGER NOT NULL,
  unverified INTEGER NOT NULL, contradicted INTEGER NOT NULL, result_json TEXT NOT NULL,
  cost_cents INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  UNIQUE (material_version_id, attempt)
);  -- 試行ごとに 1 行。画面と承認は「最新の attempt」を使う

CREATE TABLE review_decisions (
  id TEXT PRIMARY KEY, material_version_id TEXT REFERENCES material_versions(id), material_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve','return','reject','stop','rollback')),
  checklist_json TEXT, note TEXT, reviewer_email TEXT NOT NULL,
  content_sha256_at_decision TEXT, created_at TEXT NOT NULL
);

CREATE TABLE standards_log (
  id TEXT PRIMARY KEY, material_id TEXT, job_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('question','return_reason','approval_note','note')),
  question TEXT, answer TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE improvement_notes (
  id TEXT PRIMARY KEY, material_id TEXT NOT NULL REFERENCES materials(id),
  source TEXT NOT NULL CHECK (source IN ('review','verification','buddy_sampling','scout','manual')),
  note TEXT NOT NULL, created_at TEXT NOT NULL
);  -- 子どもを表す列は作らない

CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY, data_type TEXT NOT NULL, resource_id TEXT NOT NULL,
  received_at TEXT NOT NULL, processed_at TEXT
);

CREATE TABLE cost_ledger (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_cost_day ON cost_ledger(day);
