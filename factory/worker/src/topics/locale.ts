// お題の言語と国・表示名（契約 contract-T T-12）。system 文と GET /api/topics/meta はここから取る。
// 言語・国を直書きで散らさない（将来の多言語・他国展開のため。設計書 §13）。

export const TOPIC_LOCALE = 'ja-JP';
export const TOPIC_LANGUAGE_LABEL = '日本語';
export const TOPIC_COUNTRY_LABEL = '日本';

export const TOPIC_KINDS = ['news', 'talk', 'philo', 'make'] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];

/** 種類の名前（system 文の {kind_label} と管理画面） */
export const TOPIC_KIND_LABELS: Record<TopicKind, string> = {
  news: 'ニュースから',
  talk: '話し合い',
  philo: '答えのない問い',
  make: '作るの提案',
};

export const TOPIC_STATUS_LABELS: Record<string, string> = {
  draft: '下書き',
  checking: '確かめ中',
  held: '要確認',
  ready: '出せる',
  rejected: '出さない',
  retired: '引退',
};

/** held の理由（topics.hold_reason）。rejected の 'duplicate' も同じ列に書く */
export const TOPIC_HOLD_REASON_LABELS: Record<string, string> = {
  heavy: '重い話題',
  flagged: '気になる点',
  schema: '形が合わない',
  forbidden: '使わない言葉',
  source_not_found: '引用が見つからない',
  source_unreachable: '出典を開けない',
  source_unsupported: '出典が支えていない',
  source_lost: '出典から引用が消えた',
  check_failed: '検査が終わらなかった',
  duplicate_race: '同じ題が先に出た',
  duplicate: '同じ題がある',
};

export const TOPIC_FLAG_LABELS: Record<string, string> = {
  unsourced_claim: '出典のない事実・考え',
  private_person: '公の人でない個人',
  one_sided: '1 つの立場に寄っている',
  scary_wording: 'こわがらせる書き方',
  advertising: '商品のすすめ',
  instruction_in_source: '出典の中の指示に従ったように見える',
  age_mismatch: '小学生向けの文が合っていない',
};

export const TOPIC_HEAVY_REASON_LABELS: Record<string, string> = {
  incident: '事件・事故',
  disaster: '災害の被害',
  war: '戦争・紛争',
  politics: '政治の対立・選挙',
  discrimination: '差別',
  death: '人の死',
};

/** 検査の記録の理由コード（topic_checks.reasons_json）。flagged:<flag> は flags の表から作る */
export const TOPIC_REASON_LABELS: Record<string, string> = {
  source_not_found: '引用が見つからない',
  source_unreachable: '出典を開けない',
  source_unsupported: '出典が支えていない',
  forbidden: '使わない言葉',
  schema: '形が合わない',
  duplicate: '同じ題がある',
  latin_mix: '英語の小文字が混ざった文（人が読む）',
  // run の失敗の理由（v2.6。記録のタブ）
  save_failed: 'できたお題を保存できませんでした（費用は実際の額だけ）',
  abandoned: '途中で止まりました',
  ...Object.fromEntries(Object.entries(TOPIC_FLAG_LABELS).map(([k, v]) => [`flagged:${k}`, v])),
};

export const TOPIC_FETCH_RESULT_LABELS: Record<string, string> = {
  pending: 'まだ開いていない',
  found: '引用あり',
  not_found: '引用なし',
  fetch_failed: '開けない',
  blocked: '開かない（規則）',
};

export const TOPIC_DECISION_LABELS: Record<string, string> = {
  approve: '出せるにした',
  reject: '出さない',
  retire: '止めた',
  star: '星を付けた',
  unstar: '星を外した',
  recheck: '検査をやり直す',
  auto_ready: '自動で出せるにした',
  auto_hold: '自動で要確認にした',
  auto_retire: '見直しの子が出せるになり引退',
};
