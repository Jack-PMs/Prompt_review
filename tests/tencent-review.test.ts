import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTencentCosAuthorization,
  mapTencentCiToAnswers,
  normalizeTencentCiBucket,
  parseTencentCiJobsDetail,
} from '../src/server/tencent/client';
import { decide } from '../src/server/review/engine';
import { TENCENT_RELAXED_POLICY_RULES } from '../src/server/review/policy';
import type { DecisionQuestion } from '../src/server/decision/client';
import type { Signal } from '../src/server/review/types';

const sampleQuestions: DecisionQuestion[] = [
  { type: 'predicate', name: 'copyright_character', instructions: '版权角色' },
  { type: 'predicate', name: 'explicit_sexual', instructions: '露骨色情' },
  { type: 'predicate', name: 'sexual_suggestive', instructions: '性暗示' },
  { type: 'predicate', name: 'china_political', instructions: '中国政治' },
  { type: 'predicate', name: 'political_topic', instructions: '涉政话题' },
  { type: 'predicate', name: 'targeted_abuse', instructions: '辱骂' },
  { type: 'predicate', name: 'violent_incitement', instructions: '暴力煽动' },
  { type: 'predicate', name: 'evidence_sufficient', instructions: '证据充分' },
];

test('COS 存储桶名规范化：自动去除路径前缀与域名后缀', () => {
  assert.equal(normalizeTencentCiBucket('temp-1375644169/renjp'), 'temp-1375644169');
  assert.equal(normalizeTencentCiBucket('temp-1375644169'), 'temp-1375644169');
  assert.equal(normalizeTencentCiBucket('https://temp-1375644169.ci.ap-nanjing.myqcloud.com/text/auditing'), 'temp-1375644169');
});

test('数据万象 CI 请求签名格式符合 COS SHA1 规范', () => {
  const auth = buildTencentCosAuthorization({
    secretId: 'AKID_TEMP',
    secretKey: 'SECRET_TEMP',
    method: 'POST',
    path: '/text/auditing',
    host: 'temp-1375644169.ci.ap-nanjing.myqcloud.com',
    startTime: 1700000000,
    expireTime: 1700003600,
  });
  assert.match(auth, /^q-sign-algorithm=sha1&q-ak=AKID_TEMP&q-sign-time=1700000000;1700003600&q-key-time=1700000000;1700003600&q-header-list=host&q-url-param-list=&q-signature=[0-9a-f]{40}$/);
});

test('数据万象文本同步审核 XML 解析与涉政高风险映射正确', () => {
  const detailXml = `
    <JobId>stb123456</JobId>
    <State>Success</State>
    <Result>1</Result>
    <Label>Politics</Label>
    <Score>94</Score>
    <PornInfo><HitFlag>0</HitFlag><Score>0</Score></PornInfo>
    <PoliticsInfo><HitFlag>1</HitFlag><Score>94</Score><Keywords>敏感词A,敏感词B</Keywords></PoliticsInfo>
    <AbuseInfo><HitFlag>0</HitFlag><Score>5</Score></AbuseInfo>
  `;
  const parsed = parseTencentCiJobsDetail(detailXml, 'text', 'req-text-1', 128, detailXml);
  assert.equal(parsed.suggestion, 'block');
  assert.equal(parsed.resultCode, 1);
  assert.equal(parsed.score, 94);
  assert.deepEqual(parsed.keywords, ['敏感词A', '敏感词B']);

  const mapped = mapTencentCiToAnswers([parsed], sampleQuestions);
  const byName = new Map(mapped.answers.map(a => [a.name, a.probability]));
  // HitFlag=1（确定违规）保底映射至 0.95，确保稳定命中「绝对违规」
  assert.equal(byName.get('china_political'), 0.95);
  assert.equal(byName.get('political_topic'), 0.95);
  assert.equal(byName.get('explicit_sexual'), 0.01);
  assert.equal(byName.get('targeted_abuse'), 0.05);
  assert.equal(byName.get('evidence_sufficient'), 0.95);
});

test('数据万象图片批量审核多图合并取最高风险（色情/暴恐不平均稀释）', () => {
  const safeImgXml = `
    <JobId>si001</JobId>
    <State>Success</State>
    <Result>0</Result>
    <ResultDetail>
      <PornInfo><HitFlag>0</HitFlag><Score>1</Score></PornInfo>
      <TerrorismInfo><HitFlag>0</HitFlag><Score>0</Score></TerrorismInfo>
    </ResultDetail>
  `;
  const terrorImgXml = `
    <JobId>si002</JobId>
    <State>Success</State>
    <Result>1</Result>
    <ResultDetail>
      <PornInfo><HitFlag>2</HitFlag><Score>68</Score><SubLabel>Sexy</SubLabel></PornInfo>
      <TerrorismInfo><HitFlag>1</HitFlag><Score>98</Score><Label>Weapon</Label></TerrorismInfo>
    </ResultDetail>
  `;
  const r1 = parseTencentCiJobsDetail(safeImgXml, 'image', 'req-img-1', 210, safeImgXml);
  const r2 = parseTencentCiJobsDetail(terrorImgXml, 'image', 'req-img-1', 210, terrorImgXml);

  const mapped = mapTencentCiToAnswers([r1, r2], sampleQuestions);
  const byName = new Map(mapped.answers.map(a => [a.name, a.probability]));
  assert.equal(byName.get('violent_incitement'), 0.98);
  assert.equal(byName.get('sexual_suggestive'), 0.68);
  assert.equal(byName.get('explicit_sexual'), 0.68);
  assert.equal(byName.get('evidence_sufficient'), 0.95);
});

test('顶层无 Score 字段时正确汇总命中子分类的最高分（不被 PornInfo 的 0 覆盖）', () => {
  const realStyleXml = `
    <JobId>stb_real_001</JobId>
    <State>Success</State>
    <Result>1</Result>
    <Label>Terrorism</Label>
    <SubLabel>Arms</SubLabel>
    <PornInfo><HitFlag>0</HitFlag><Score>0</Score></PornInfo>
    <TerrorismInfo><HitFlag>1</HitFlag><Score>91</Score><SubLabel>Arms</SubLabel></TerrorismInfo>
  `;
  const parsed = parseTencentCiJobsDetail(realStyleXml, 'text', 'req-real-1', 300, realStyleXml);
  assert.equal(parsed.suggestion, 'block');
  assert.equal(parsed.label, 'Terrorism');
  assert.equal(parsed.subLabel, 'Arms');
  assert.equal(parsed.score, 91);
});

test('数据万象 HitFlag 与两级违规等级天然对齐：HitFlag=1 判绝对违规，HitFlag=2 封顶判可能违规', () => {
  const toSignals = (answers: ReturnType<typeof mapTencentCiToAnswers>['answers']): Signal[] =>
    TENCENT_RELAXED_POLICY_RULES.filter(r => r.rule_id !== 'SUBJECT-001').map(rule => {
      const ans = answers.find(a => a.name === rule.name);
      return {
        unit_id: 'img_1',
        rule_id: rule.rule_id,
        name: rule.name,
        signal_status: 'SUCCESS',
        probability: typeof ans?.probability === 'number' ? ans.probability : 0.01,
      };
    });

  // 1) 确定违规（HitFlag=1, Score=90）→ 映射为 0.95 → ABSOLUTE
  const absXml = `
    <JobId>si_abs</JobId><State>Success</State><Result>1</Result>
    <PoliticsInfo><HitFlag>1</HitFlag><Score>90</Score></PoliticsInfo>
  `;
  const absParsed = parseTencentCiJobsDetail(absXml, 'image', 'req-abs', 100, absXml);
  const absRes = decide({
    rules: TENCENT_RELAXED_POLICY_RULES,
    signals: toSignals(mapTencentCiToAnswers([absParsed], sampleQuestions).answers),
  });
  assert.equal(absRes.action, 'BLOCK');
  assert.equal(absRes.violation_level, 'ABSOLUTE');

  // 2) 疑似复核（HitFlag=2, Score=98）→ 封顶映射为 0.94 → POSSIBLE（绝不误升为 ABSOLUTE）
  const revXml = `
    <JobId>si_rev</JobId><State>Success</State><Result>2</Result>
    <PornInfo><HitFlag>2</HitFlag><Score>98</Score><SubLabel>Sexy</SubLabel></PornInfo>
  `;
  const revParsed = parseTencentCiJobsDetail(revXml, 'image', 'req-rev', 100, revXml);
  const revMapped = mapTencentCiToAnswers([revParsed], sampleQuestions);
  const pornProb = revMapped.answers.find(a => a.name === 'explicit_sexual')?.probability;
  assert.equal(pornProb, 0.94);
  const revRes = decide({
    rules: TENCENT_RELAXED_POLICY_RULES,
    signals: toSignals(revMapped.answers),
  });
  assert.equal(revRes.action, 'BLOCK');
  assert.equal(revRes.violation_level, 'POSSIBLE');
});
