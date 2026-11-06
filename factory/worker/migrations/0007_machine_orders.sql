-- 契約 §U-3（機械用の注文の入口）
-- 新しい素材の draft の注文 1 件ごとに 1 行。request_id の PRIMARY KEY で同じ注文の二重作成を止める。
-- 1 日の件数の上限（ORDER_DAILY_MAX）は day の行数で数える。day は cost_ledger.day と同じ決め方（Asia/Tokyo の YYYY-MM-DD）
CREATE TABLE machine_orders (
  request_id TEXT PRIMARY KEY,
  client TEXT NOT NULL,          -- common_name
  material_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  day TEXT NOT NULL,             -- 1 日の区切りは cost_ledger の日と同じ決め方
  created_at TEXT NOT NULL
);
CREATE INDEX idx_machine_orders_day ON machine_orders(day);
CREATE INDEX idx_machine_orders_material ON machine_orders(material_id);
