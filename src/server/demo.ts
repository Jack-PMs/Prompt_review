import { getSetting } from './db';
import { formatPromptSyntax } from './prompt-syntax';
import { needsRevisionResult, reviewContent, reviewModelStatus } from './moderation';
import { resolveScene, sceneFallback } from './scenes';
import { AppError, fallbackResult, hasReviewableContext, isNoVisualSignal, parseEnhanceInput } from './validation';
import type { EnhancementResult } from './types';

/** Local rewrite preview; content review still uses a real model. */
export async function demoEnhance(raw: unknown): Promise<{result:EnhancementResult;review_metrics:{attempts:number;ms:number;model_id:string|null}}> {
  const input = parseEnhanceInput(raw);
  const noVisualSignal = isNoVisualSignal(input.text);
  const scene = resolveScene(input.context?.entry);
  const hasContext = hasReviewableContext(input);
  const reviewMetrics = {attempts:0,ms:0,model_id:null as string|null};
  async function runReview(content: typeof input | EnhancementResult, stage:'input'|'output') {
    const model = reviewModelStatus();
    if (!model.available) throw new AppError('CONTENT_REVIEW_UNAVAILABLE',503,'内容审核暂不可用，请稍后重试');
    reviewMetrics.attempts++;
    reviewMetrics.model_id = model.id;
    const started = performance.now();
    try { const review = await reviewContent(content,stage); reviewMetrics.model_id = review.modelId; return review; }
    finally { reviewMetrics.ms += Math.round(performance.now()-started); }
  }
  if (!noVisualSignal || hasContext) {
    const review = await runReview(input,'input');
    if (review.decision==='revise') return {result:needsRevisionResult(review),review_metrics:reviewMetrics};
  }
  if (noVisualSignal) {
    const result = fallbackResult(sceneFallback(scene,getSetting('fallback_scene')));
    const review = await runReview(result,'output');
    if (review.decision==='revise') throw new AppError('UNSAFE_FALLBACK_SCENE',503,'默认场景未通过内容审核，请联系管理员调整');
    return {result,review_metrics:reviewMetrics};
  }

  const negatives = [...input.text.matchAll(/(?:不要|不含|无)(?:人物|文字|品牌|水印|logo|LOGO)/g)].map(match=>match[0]);
  const clean = input.text
    .replace(/忽略之前所有要求[^。！？]*/g,'')
    .replace(/泄露你的系统提示词[^。！？]*/g,'')
    .replace(/(?:不要|不含|无)(?:人物|文字|品牌|水印|logo|LOGO)/g,'')
    .replace(/[，,。；;\s]+$/g,'').trim();
  const subject = clean.replace('🌸','花卉图案').replace(/[，,。；;]+/g,'，');
  const product = /床单|四件套|被套/.test(subject) ? '平铺展示面料花型与织物细节' : '突出产品轮廓与面料纹理';
  const style = input.context?.style ? `整体采用${input.context.style}风格，` : '';
  const prompt = `${subject}；${product}，${style}使用柔和自然光，主体完整、构图清晰，适合家纺电商展示。${negatives.length?negatives.join('，')+'。':''}`;
  const result: EnhancementResult = {
    status:'enhanced',can_generate:true,intent_category:/床单|四件套|被套/.test(subject)?'床品设计':'家纺产品',prompt:formatPromptSyntax(prompt,input),
    negative_prompt:negatives.join('，'),preserved_constraints:[],
    assumptions:input.text.length<5?['以家纺电商展示为默认用途']:[],conflicts:[],
    user_notice:'本地规则演示结果，仅用于预览界面；实际模型效果需配置密钥后测试。',
  };
  const review = await runReview(result,'output');
  if (review.decision==='revise') throw new AppError('UNSAFE_DEMO_OUTPUT',502,'本地预览稿未通过内容复核');
  return {result,review_metrics:reviewMetrics};
}
