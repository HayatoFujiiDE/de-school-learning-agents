-- 契約 §W（運用の依頼箱。docs/plans/ops-requests/contract-W.md）。Claude（司令塔）が D1 に 1 行書き、cron が 1 tick に 1 件だけ拾う。
-- できるのはお題の run（手動と同じ経路 = 台帳・上限・run_in_progress を通る）だけ。60 分で失効
CREATE TABLE ops_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('topic_run')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','taken','done','failed','expired')),
  result_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX idx_ops_requests_status ON ops_requests(status, created_at);
