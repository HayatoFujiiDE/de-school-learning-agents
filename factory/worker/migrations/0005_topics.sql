-- 契約 contract-T（CONTRACT-factory §T）T-2 verbatim（お題のストック）
-- 1. cost_ledger.kind に 'topic' を足す。CHECK は ALTER できないので 0004 と同じ手順で作り直す。
--    DROP TABLE で既存の索引 3 つ（idx_cost_day / idx_cost_ledger_vb / idx_cost_ledger_image_job）も消えるので、0004 と同じ定義で作り直す
CREATE TABLE cost_ledger_v4 (
  id TEXT PRIMARY KEY, day TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('session','verify','scout','meeting','image','topic')),
  ref_id TEXT NOT NULL, cents INTEGER NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO cost_ledger_v4 SELECT id, day, kind, ref_id, cents, created_at FROM cost_ledger;
DROP TABLE cost_ledger;
ALTER TABLE cost_ledger_v4 RENAME TO cost_ledger;
CREATE INDEX idx_cost_day ON cost_ledger(day);
CREATE UNIQUE INDEX idx_cost_ledger_vb ON cost_ledger(ref_id) WHERE ref_id GLOB 'vb:*';
CREATE UNIQUE INDEX idx_cost_ledger_image_job ON cost_ledger(substr(ref_id, 4)) WHERE kind = 'image';
-- お題の記帳は ref_id ごとに 1 行だけ（'tp:<run_id>:gen' / 'tp:<topic_id>:chk:<n>'）
CREATE UNIQUE INDEX idx_cost_ledger_topic ON cost_ledger(ref_id) WHERE kind = 'topic';

-- 2. お題
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('news','talk','philo','make')),
  status TEXT NOT NULL CHECK (status IN ('draft','checking','held','ready','rejected','retired')),
  sensitivity TEXT NOT NULL DEFAULT 'normal' CHECK (sensitivity IN ('normal','heavy')),
  origin TEXT NOT NULL CHECK (origin IN ('gen','derive','manual')),
  run_id TEXT,
  slot_day TEXT NOT NULL,                        -- 何日用に作ったか（gen: run の slot_day / derive・manual: 作った日の翌日）
  lineage_id TEXT NOT NULL,                      -- 系譜の根の topic id（根は自分の id）
  parent_topic_id TEXT REFERENCES topics(id),
  derive_kind TEXT CHECK (derive_kind IN ('refresh','extend')),
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth BETWEEN 0 AND 5),
  title TEXT NOT NULL,                           -- body_json.title.s の写し
  title_norm TEXT NOT NULL,                      -- 題の正規化（空白・記号を除き、全角半角を寄せる）
  body_json TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  evergreen INTEGER NOT NULL DEFAULT 0,          -- talk / philo / make = 1、news = 0
  fresh_until TEXT,                              -- news = slot_day + 6（slot_day を入れて 7 日）。evergreen は NULL
  starred INTEGER NOT NULL DEFAULT 0,
  check_attempts INTEGER NOT NULL DEFAULT 0,     -- 検査を取った回数の累計（減らさない。台帳と検査の記録のキーに使う）
  check_round_start INTEGER NOT NULL DEFAULT 0,  -- 今の巡の始まりの時の check_attempts（人の recheck で進める）
  check_token TEXT, check_lease_until TEXT,
  check_not_before TEXT,                         -- この時刻より前は検査を始めない
  hold_reason TEXT,
  last_checked_at TEXT,                          -- 出典が全部見つかった最後の時刻
  recheck_tried_at TEXT,                         -- 見直し（T-8）を最後に試した時刻
  recheck_fail_count INTEGER NOT NULL DEFAULT 0, -- 見直しで開けなかった回数の連続
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK ((parent_topic_id IS NULL) = (derive_kind IS NULL))
);
CREATE INDEX idx_topics_status_kind ON topics(status, kind);
CREATE INDEX idx_topics_lineage ON topics(lineage_id);
CREATE UNIQUE INDEX uq_topics_live_refresh ON topics(parent_topic_id)
  WHERE derive_kind = 'refresh' AND status IN ('draft','checking','held','ready');

CREATE TABLE topic_sources (
  topic_id TEXT NOT NULL REFERENCES topics(id),
  source_id TEXT NOT NULL,
  url TEXT NOT NULL, name TEXT NOT NULL, quote TEXT NOT NULL,
  required INTEGER NOT NULL,                     -- 必須の出典（T-5）か
  evidence TEXT CHECK (evidence IN ('gen_fetch','worker_fetch')),   -- 引用が見つかった経路。見つかっていなければ NULL
  excerpt TEXT,                                  -- 引用の前後を含む抜き書き（最大 1400 字）。見つかった時だけ
  fetch_result TEXT NOT NULL DEFAULT 'pending' CHECK (fetch_result IN ('pending','found','not_found','fetch_failed','blocked')),
  checked_at TEXT,
  PRIMARY KEY (topic_id, source_id)
);

CREATE TABLE topic_checks (                      -- 検査 1 回の結果。追記だけ（UPDATE・DELETE しない）
  topic_id TEXT NOT NULL REFERENCES topics(id),
  attempt INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('green','red')),
  sources_ok INTEGER NOT NULL,                   -- 必須の出典が全部「見つかった + 支えている」か
  approvable INTEGER NOT NULL,                   -- 人が承認してよい結果か（T-5 の 4）
  done_token TEXT NOT NULL,                      -- この記録を書いた検査の check_token（完了の後ろの文が「この回が書けた」ことを確かめる印）
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('normal','heavy')),
  reasons_json TEXT NOT NULL,                    -- 赤の理由コードの配列（緑は []）
  detail_json TEXT NOT NULL,                     -- 出典ごとの結果と、モデルの出力
  created_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, attempt)
);

CREATE TABLE topic_runs (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('gen','derive')),
  kind TEXT NOT NULL,                            -- gen: お題の種類。derive: 'refresh' | 'extend'
  slot_day TEXT NOT NULL,                        -- gen: 何日用か。derive: 起動した日
  week TEXT,                                     -- derive: 起動した週の月曜の日付（Asia/Tokyo）
  parent_topic_id TEXT,
  trigger TEXT NOT NULL CHECK (trigger IN ('cron','manual')),
  status TEXT NOT NULL CHECK (status IN ('calling','done','failed','skipped')),
  error TEXT,                                    -- 理由コード 1 つ
  dropped INTEGER NOT NULL DEFAULT 0,            -- 形の規則で保存しなかった本数
  made INTEGER NOT NULL DEFAULT 0,               -- 保存した本数
  cents INTEGER NOT NULL DEFAULT 0,              -- この run の生成の呼び出しの記帳額（検査の額は含めない）
  token TEXT NOT NULL, lease_until TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_topic_runs_gen ON topic_runs(kind, slot_day) WHERE purpose = 'gen' AND trigger = 'cron';
CREATE UNIQUE INDEX uq_topic_runs_derive ON topic_runs(parent_topic_id, kind, slot_day) WHERE purpose = 'derive' AND trigger = 'cron';
CREATE UNIQUE INDEX uq_topic_runs_calling ON topic_runs(purpose, kind) WHERE status = 'calling';

CREATE TABLE topic_plans (                       -- その日の予定を確定した印
  day TEXT PRIMARY KEY, made INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE topic_schedule (
  day TEXT NOT NULL REFERENCES topic_plans(day), kind TEXT NOT NULL, pos INTEGER NOT NULL,   -- pos は 1 から
  topic_id TEXT NOT NULL REFERENCES topics(id),
  lineage_id TEXT NOT NULL,
  PRIMARY KEY (day, kind, pos),
  UNIQUE (day, lineage_id)
);
CREATE INDEX idx_topic_schedule_lineage ON topic_schedule(lineage_id, day);

CREATE TABLE topic_decisions (                   -- 追記だけ
  id TEXT PRIMARY KEY,
  topic_id TEXT NOT NULL REFERENCES topics(id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','retire','star','unstar','recheck','auto_ready','auto_hold','auto_retire')),
  by TEXT NOT NULL,                              -- 人は Access の email、機械は 'machine'
  read_all INTEGER NOT NULL DEFAULT 0,
  content_sha256 TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
-- settings の新しい key: topics_enabled（'1' で入）/ topic_over_reserve（実額が取り置き額を超えた回数）/ topic_recheck_week（見直しの週の月曜）
