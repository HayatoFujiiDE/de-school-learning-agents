-- 契約 §AK-3（2026-11-07）: 権利の門番。現在値 rights_records・追記だけの rights_checks（確認・取り込み・停止の履歴）と rights_hosted（確認のもとで取り込んだ sha）
CREATE TABLE rights_records (
  asset_key TEXT PRIMARY KEY,
  subject_sha256 TEXT NOT NULL,
  license_code TEXT NOT NULL,
  license_url TEXT NOT NULL,
  attribution TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  modified INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  blocked INTEGER NOT NULL DEFAULT 0,
  fail_code TEXT,
  checked_at TEXT,
  last_attempt_at TEXT NOT NULL,
  checked_by TEXT NOT NULL,
  claim_at TEXT,
  claim_token TEXT
);
CREATE TABLE rights_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_key TEXT NOT NULL,
  at TEXT NOT NULL,
  by TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  result TEXT NOT NULL,
  license_code TEXT,
  evidence_json TEXT NOT NULL,
  check_token TEXT
);
CREATE INDEX rights_checks_asset ON rights_checks(asset_key, id);
CREATE TABLE rights_hosted (
  asset_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  check_token TEXT NOT NULL,
  PRIMARY KEY (asset_key, sha256)
);
