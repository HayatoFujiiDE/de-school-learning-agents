-- 契約 §L-1（v3.6.1）verbatim
ALTER TABLE material_versions ADD COLUMN verify_phase TEXT CHECK (verify_phase IN ('to_submit','submitting','submitted','collecting'));
ALTER TABLE material_versions ADD COLUMN verify_phase_at TEXT;                         -- verify_phase が今の値になった時刻
ALTER TABLE material_versions ADD COLUMN verify_batch_id TEXT;
ALTER TABLE material_versions ADD COLUMN verify_turn INTEGER NOT NULL DEFAULT 0;
ALTER TABLE material_versions ADD COLUMN verify_pauses INTEGER NOT NULL DEFAULT 0;
ALTER TABLE material_versions ADD COLUMN verify_micro INTEGER NOT NULL DEFAULT 0;      -- この試行で記帳済みの費用（micro-dollars）
ALTER TABLE material_versions ADD COLUMN auto_reverified INTEGER NOT NULL DEFAULT 0;   -- 自動の再検証を使ったら 1（版ごとに 1 回）
ALTER TABLE material_versions ADD COLUMN triaged_verification_id TEXT;                 -- triageStep が「処置なし」と記録した verification の id
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*'; -- Batch のターンごとの記帳は 1 回だけ
