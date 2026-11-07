-- 契約 §V-1（確認を機械に寄せる・子どもの画面で見る。0008 はお題の run の観測 contract-T v2.8）
-- 1. cost_ledger.kind に 'reader'（読み手係 §V-4）を足す。CHECK は ALTER できないので 0006 と同じ手順で作り直す。
--    DROP TABLE で既存の索引 4 つ（idx_cost_day / idx_cost_ledger_vb / idx_cost_ledger_image_job / idx_cost_ledger_topic）も消えるので、同じ定義で作り直す
CREATE TABLE cost_ledger_v6 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image','topic','retro','reader')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v6 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v6 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
CREATE UNIQUE INDEX idx_cost_ledger_image_job ON cost_ledger(substr(ref_id, 4)) WHERE kind = 'image';
CREATE UNIQUE INDEX idx_cost_ledger_topic ON cost_ledger(ref_id) WHERE kind = 'topic';

-- 2. 列と表（契約 §V-1 2 verbatim。既存の行のデータを書き換える文は入れない）
ALTER TABLE material_versions ADD COLUMN reader_status TEXT NOT NULL DEFAULT 'pending' CHECK (reader_status IN ('pending','running','done','failed'));
ALTER TABLE material_versions ADD COLUMN reader_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE material_versions ADD COLUMN reader_started_at TEXT;
ALTER TABLE material_versions ADD COLUMN reader_token TEXT;                      -- 読み手係の 1 回の走りの印。済んだ後も残す（結果の世代）。読み直しで NULL
ALTER TABLE material_versions ADD COLUMN reader_json TEXT;                       -- 読み手係の結果（V-4。done の時だけ）
ALTER TABLE material_versions ADD COLUMN reader_cost_cents INTEGER NOT NULL DEFAULT 0;  -- 累計
ALTER TABLE material_versions ADD COLUMN triage_v INTEGER NOT NULL DEFAULT 0;    -- 2 = この契約の決まりで仕分けを記録した
ALTER TABLE material_versions ADD COLUMN triage_gate TEXT;                       -- 仕分けを記録した時の gate（clean / attention）
ALTER TABLE material_versions ADD COLUMN evidence_reverified INTEGER NOT NULL DEFAULT 0;  -- 古い入力の検証の自動再検証を使ったら 1（版ごとに 1 回）
ALTER TABLE review_decisions ADD COLUMN machine_gate TEXT;                       -- 判断した時の仕分けの gate（clean / attention / pending。stop・rollback は NULL）
CREATE TABLE trusted_channels (                                                  -- 人が「本人のアップ」と確かめた YouTube のチャンネル
  channel_key TEXT PRIMARY KEY,           -- 公式の情報（oEmbed）の author_url（sanitizeOEmbedFields を通した値）
  channel_name TEXT NOT NULL, channel_url TEXT NOT NULL,
  first_version_id TEXT, approved_by TEXT NOT NULL, created_at TEXT NOT NULL
);
-- settings の新しい key: auto_publish（'1' で自動公開 §V-7 d）/ trusted_gen（確認済みチャンネルの世代 §V-7 b）/ reader_strict（'0' で report_reading に strict を付けない §V-4 b）
