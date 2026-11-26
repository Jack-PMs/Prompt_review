import { getSetting } from '../db';
import { askModel, DecisionError } from './client';
import { channelOf, DECISION_CHANNELS, decisionDb, endpointOf, getDecisionModel, keyConfigured, listDecisionModels, reviewTotalTimeoutMs, unusableReason, type DecisionModel } from './models';
import { reviewImagesWithTencentCi, reviewTextWithTencentCi, TencentReviewError } from '../tencent/client';

export function decisionModelView(m: DecisionModel) {
  const channel = channelOf(m);
  return {...m,enabled:Boolean(m.enabled),channel_label:channel.label,protocol:channel.protocol,key_env:channel.keyEnv,key_configured:keyConfigured(m),
    supports_text:channel.supportsText,supports_images:channel.supportsImages,max_questions:channel.maxQuestions,needs_workspace:channel.endpoint.includes('{workspace}'),
    endpoint:endpointOf(m),unusable_reason:unusableReason(m),last_test:m.last_test?JSON.parse(m.last_test) as {ok:boolean;at:string;latency_ms:number;message:string}:null};
}

export function decisionOverview() {
  decisionDb();
  return {
    models:listDecisionModels().map(decisionModelView),
    channels:Object.entries(DECISION_CHANNELS).map(([id,c])=>({id,label:c.label,protocol:c.protocol,key_env:c.keyEnv,supports_text:c.supportsText,supports_images:c.supportsImages,max_questions:c.maxQuestions,needs_workspace:c.endpoint.includes('{workspace}')})),
    assignments:{review:getSetting('decision_review_model_id'),backup:getSetting('decision_backup_model_id'),intent:getSetting('decision_intent_model_id'),total_timeout_ms:reviewTotalTimeoutMs()},
  };
}

// 64×64 PNG, left half red / right half blue: the image test checks the model actually reads the image, not just that it accepts it.
const TEST_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAU0lEQVR4nO3PMQ0AAAgDMJRMCf5VIAYJXHxNaqA1yav0vCoBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBgcsCPzVxD46HlhIAAAAASUVORK5CYII=';

/**
 * Minimal live test of one model: a text request with a yes/no and a choice question, plus an image request
 * when the channel claims image support. The verdict is stored on the model row.
 */
export async function testDecisionModel(id: string) {
  const model = getDecisionModel(id);
  if (!model) throw new DecisionError('NOT_FOUND','判定模型不存在');
  const reason = unusableReason({...model,enabled:1});
  const started = performance.now();
  const steps: string[] = [];
  let ok = false;
  if (reason) steps.push(`无法测试：${reason}`);
  else if (channelOf(model).protocol === 'tencent-ci-review') {
    let textOk = false;
    let imageOk = false;
    try {
      const textRes = await reviewTextWithTencentCi('米色亚麻抱枕，放在客厅沙发上');
      steps.push(`文本审核正常（${textRes.suggestion}，Label=${textRes.label}，Score=${textRes.score}，${textRes.latencyMs}ms）`);
      textOk = true;
    } catch (error) {
      steps.push(`文本审核失败：${error instanceof TencentReviewError || error instanceof Error ? error.message : '未知错误'}`);
    }
    try {
      const [imgRes] = await reviewImagesWithTencentCi([TEST_IMAGE]);
      steps.push(`图片审核正常（${imgRes.suggestion}，Label=${imgRes.label}，Score=${imgRes.score}，${imgRes.latencyMs}ms）`);
      imageOk = true;
    } catch (error) {
      steps.push(`图片审核失败：${error instanceof TencentReviewError || error instanceof Error ? error.message : '未知错误'}`);
    }
    ok = textOk && imageOk;
  } else try {
    const text = await askModel(model,{developer:'判断以下文字。',text:'米色亚麻抱枕，放在客厅沙发上'},[
      {type:'predicate',name:'is_home_product',instructions:'是否描述了家居产品'},
      {type:'choice',name:'category',instructions:'描述的是哪类物品',choices:['抱枕','窗帘','其他']}]);
    const p = text.answers.find(a=>a.name==='is_home_product');
    const c = text.answers.find(a=>a.name==='category');
    const predicateOk = p?.type==='predicate' && typeof p.probability==='number';
    const choiceOk = c?.type==='choice' && typeof c.choice==='string';
    steps.push(`是非题${predicateOk?`正常（${Math.round(Number(p!.probability)*100)}%）`:'异常'}`,`选择题${choiceOk?`正常（${String(c!.choice)}）`:'异常'}`);
    ok = predicateOk && choiceOk;
    if (channelOf(model).supportsImages) {
      const image = await askModel(model,{developer:'判断以下图片。',text:'待判断的图片。',images:[{dataUrl:TEST_IMAGE,placeholder:'[测试图]'}]},[
        {type:'predicate',name:'left_is_red',instructions:'图片左半部分是否为红色'}]);
      const a = image.answers.find(x=>x.name==='left_is_red');
      const answered = a?.type==='predicate' && typeof a.probability==='number';
      const imageOk = answered && Number(a!.probability)>=0.5;
      steps.push(!answered?'图片异常（无有效答案）':imageOk?`图片正常（左半为红色 ${Math.round(Number(a!.probability)*100)}%）`:`图片识别有误（左半应为红色，模型只给出 ${Math.round(Number(a!.probability)*100)}%）`);
      ok = ok && imageOk;
    } else steps.push('该渠道不支持图片（不参与图片审核）');
  } catch (error) {
    steps.push(error instanceof DecisionError ? error.message : '测试失败');
    ok = false;
  }
  const result = {ok,at:new Date().toISOString(),latency_ms:Math.round(performance.now()-started),message:steps.join('；')};
  decisionDb().prepare('UPDATE decision_models SET last_test=? WHERE id=?').run(JSON.stringify(result),id);
  return result;
}
