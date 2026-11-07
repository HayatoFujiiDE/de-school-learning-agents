-- 契約 §AJ2-1（2026-11-07）: 運営が取り込んだ立体モデル（GLB）の記録。R2 の object は models3d/<catalog_id>/<sha256>.glb
CREATE TABLE models3d_files (
  catalog_id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  draco INTEGER NOT NULL DEFAULT 0,
  fetched_at TEXT NOT NULL,
  fetched_by TEXT NOT NULL
);
