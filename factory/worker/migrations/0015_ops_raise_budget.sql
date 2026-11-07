-- 契約 §W-6（2026-11-07）: 運用の依頼箱に「予算の増額（job_raise_budget）」を足す。CHECK を変えるため表を作り直す（行はそのまま写す）
CREATE TABLE ops_requests_new (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('topic_run','job_reingest','version_reverify','tip_retire','material_redo','job_raise_budget')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','taken','done','failed','expired')),
  result_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO ops_requests_new (id, kind, payload_json, status, result_json, created_at, updated_at)
  SELECT id, kind, payload_json, status, result_json, created_at, updated_at FROM ops_requests;
DROP TABLE ops_requests;
ALTER TABLE ops_requests_new RENAME TO ops_requests;
CREATE INDEX idx_ops_requests_status ON ops_requests(status, created_at);
