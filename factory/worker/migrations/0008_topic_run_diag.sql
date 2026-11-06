-- 契約 contract-T v2.8（お題の run の観測を D1 に残す）
-- run を閉じる時に、呼び出しごとの数（stop_reason・usage・fetch のエラーの数）と保存の数・理由コードだけを JSON で書く。
-- 本文・URL・検索語・ホスト名は入れない（src/topics/diag.ts の buildRunDiag が組み立てる。4000 字まで）。NULL 可・既存の行はそのまま
ALTER TABLE topic_runs ADD COLUMN diag_json TEXT;
