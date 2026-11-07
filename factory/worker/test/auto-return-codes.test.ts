// §S v2 B 7: 機械の差し戻しの checklist（観点と原因の列挙だけ）を書く・読む純関数
import { describe, expect, it } from 'vitest';
import { AUTO_CAUSE_MAX, CHECK_KEYS, autoReturnCauses, autoReturnChecklistJson, cleanCauses, type TriageItem } from '../src/checks/triage';

const item = (o: Partial<TriageItem>): TriageItem => ({ id: 'i', kind: 'claim', key: 'content_and_evidence', severity: 'fix', cause: 'not_confirmed', title: 't', detail: '職人の文_ないしょ', ...o }) as TriageItem;

describe('autoReturnChecklistJson', () => {
  it('fix の項目の観点だけ ng・ask / note は数えない・職人の文字列は入らない・原因は数えて並べる', () => {
    const json = autoReturnChecklistJson([
      item({ cause: 'not_confirmed' }),
      item({ cause: 'not_confirmed', quote: '引用_ないしょ' }),
      item({ cause: 'contradicted' }),
      item({ key: 'terms_of_use', severity: 'ask', cause: 'video_channel_new' }),
      item({ key: 'artifact_behavior', severity: 'note', cause: 'app_problem' }),
      item({ key: 'explanation_and_expression', cause: 'unknown_cause_x' }),
    ]);
    expect(json.includes('ないしょ')).toBe(false);
    const o = JSON.parse(json);
    expect(Object.keys(o)).toEqual([...CHECK_KEYS]);
    expect(o.content_and_evidence).toEqual({ result: 'ng', note: 'auto', causes: { contradicted: 1, not_confirmed: 2 } });
    // 知らない原因でも fix なら観点は ng（causes には入れない）
    expect(o.explanation_and_expression).toEqual({ result: 'ng', note: 'auto', causes: {} });
    expect(o.terms_of_use).toEqual({ result: 'ok', note: 'auto' });
    expect(o.artifact_behavior).toEqual({ result: 'ok', note: 'auto' });
    expect(autoReturnCauses(json)).toEqual({ contradicted: 1, not_confirmed: 2 });
  });

  it('数は AUTO_CAUSE_MAX で切る', () => {
    const many = Array.from({ length: AUTO_CAUSE_MAX + 5 }, () => item({}));
    expect(JSON.parse(autoReturnChecklistJson(many)).content_and_evidence.causes).toEqual({ not_confirmed: AUTO_CAUSE_MAX });
  });
});

describe('autoReturnCauses / cleanCauses', () => {
  it('ok の観点・知らない観点・__proto__・数でない値は捨て、観点をまたいで足して上限で切る', () => {
    const raw = JSON.stringify({
      content_and_evidence: { result: 'ng', causes: { not_confirmed: 900 } },
      explanation_and_expression: { result: 'ng', causes: { not_confirmed: 900, forbidden_word: '3', stated_as_fact: -1 } },
      relation_to_learning: { result: 'ok', causes: { figure_problem: 1 } },
      other_key: { result: 'ng', causes: { app_problem: 1 } },
    }).replace('"not_confirmed":900}', '"not_confirmed":900,"__proto__":{"x":1}}');
    expect(autoReturnCauses(raw)).toEqual({ not_confirmed: AUTO_CAUSE_MAX });
    expect(autoReturnCauses(null)).toEqual({});
    expect(autoReturnCauses('[1]')).toEqual({});
    expect(cleanCauses({ none_confirmed: 2, nope: 1 })).toEqual({ none_confirmed: 2 });
  });
});
