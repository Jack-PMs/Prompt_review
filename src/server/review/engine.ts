import type { EngineResult, ReviewRule, ReviewUnit, Signal, ViolationLevel } from './types';
import { COPYRIGHT_RULE_ID } from '../copyright';
import { resolveAbsoluteThreshold } from './policy';

/**
 * 服务端裁决引擎：将多单元规则概率转换为 ALLOW / BLOCK 与违规等级（NONE / POSSIBLE / ABSOLUTE）。
 * - 风险规则达到 threshold（可能违规阈值）即拦截，记为 POSSIBLE（可能违规）；
 * - 风险规则达到 absolute_threshold（绝对违规阈值）升级为 ABSOLUTE（绝对违规）；
 * - 多单元取最高风险，绝不平均稀释。
 */
export function decide({rules,signals,units}:{rules:ReviewRule[];signals:Signal[];units?:ReviewUnit[]}): EngineResult {
  const reasons = new Set<string>();
  const topics: string[] = [];
  const hits: EngineResult['hits'] = [];
  const byId = new Map(rules.map(rule=>[rule.rule_id,rule]));
  const copyrightRule = byId.get(COPYRIGHT_RULE_ID);
  if (copyrightRule && copyrightRule.threshold!==null) {
    const requiredIds = units
      ? units.filter(unit=>copyrightRule.modalities.includes(unit.modality)).map(unit=>unit.unit_id)
      : [...new Set(signals.map(signal=>signal.unit_id))];
    const incomplete = !requiredIds.length || requiredIds.some(unitId=>{
      const answers = signals.filter(signal=>signal.unit_id===unitId && signal.rule_id===COPYRIGHT_RULE_ID);
      return answers.length!==1 || answers[0].signal_status!=='SUCCESS' || typeof answers[0].probability!=='number' ||
        !Number.isFinite(answers[0].probability) || answers[0].probability<0 || answers[0].probability>1;
    });
    if (incomplete) reasons.add('IP_CHECK_INCOMPLETE');
  }
  for (const signal of signals) {
    const rule = byId.get(signal.rule_id);
    if (!rule) continue;
    if (signal.signal_status!=='SUCCESS' || signal.probability===null) {
      if (rule.kind!=='topic') reasons.add(`SIGNAL_${signal.signal_status}`);
      continue;
    }
    const p = signal.probability;
    if (rule.kind==='topic') { if (p>=0.5 && !topics.includes(rule.title)) topics.push(rule.title); }
    else if (rule.kind==='quality') { if (rule.threshold!==null && p<rule.threshold) reasons.add('EVIDENCE_INSUFFICIENT'); }
    else if (rule.threshold!==null && p>=rule.threshold) {
      const absThreshold = resolveAbsoluteThreshold(rule);
      const level: 'POSSIBLE'|'ABSOLUTE' = absThreshold!==null && p>=absThreshold ? 'ABSOLUTE' : 'POSSIBLE';
      hits.push({rule_id:rule.rule_id,unit_id:signal.unit_id,probability:p,level});
    }
  }
  for (const hit of hits) reasons.add(`RULE_BLOCK:${hit.rule_id}`);
  const blocked = hits.length>0 || reasons.has('IP_CHECK_INCOMPLETE');
  let violationLevel: ViolationLevel = 'NONE';
  if (hits.some(h=>h.level==='ABSOLUTE')) {
    violationLevel = 'ABSOLUTE';
    reasons.add('VIOLATION_ABSOLUTE');
  } else if (blocked) {
    violationLevel = 'POSSIBLE';
    reasons.add('VIOLATION_POSSIBLE');
  }
  return {
    action:blocked?'BLOCK':'ALLOW',
    violation_level:violationLevel,
    reason_codes:[...reasons],
    topics,
    hits,
  };
}
