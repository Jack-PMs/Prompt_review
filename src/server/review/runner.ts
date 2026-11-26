import { randomUUID } from 'node:crypto';
import { getSetting, setSetting } from '../db';
import { AppError } from '../validation';
import { getAsset, readVerifiedAsset, sha256, storeImage } from './assets';
import { channelOf, decisionRoleStatus, getDecisionModel, listDecisionModels, reviewTotalTimeoutMs, unusableReason } from '../decision/models';
import { askLive, askMock, liveKeyConfigured, ProviderError, reviewMode, type Answer, type CallLogger, type UnitContent } from './decisions';
import { decide } from './engine';
import { activePolicy, getPolicy, getTask, recordApiCall, reviewDb } from './store';
import { reviewTextWithTencentCi, TencentReviewError } from '../tencent/client';
import type { Check, ReviewRule, ReviewUnit, Signal } from './types';

// 放宽单条提示词长度上限至 12000 字，兼容真实线上超长文案（如课程能力图谱等）
const MAX_PROMPT = 12000;
const MAX_IMAGES = 4;
const STALE_RUNNING_MS = 2*60_000;
/** Client-supplied control fields are refused: stage, verdicts and approvals come from the server only. */
const FORBIDDEN_FIELDS = ['stage','action','checks_complete','publish_eligible','generation_eligible','policy_approved','policy_version','provider_mode','owner_id'];

function contentHash(promptHash: string, assetHashes: string[], policyVersion: string) {
  return `sha256:${sha256(JSON.stringify({prompt:promptHash,assets:assetHashes,policy:policyVersion}))}`;
}

export function createTask(body: unknown, idempotencyKey: string|null) {
  if (!body || typeof body!=='object' || Array.isArray(body)) throw new AppError('INVALID_INPUT',400,'请求体必须是对象');
  const record = body as Record<string,unknown>;
  const forbidden = FORBIDDEN_FIELDS.filter(field=>field in record);
  if (forbidden.length) throw new AppError('FORBIDDEN_FIELD',422,`不接受客户端指定：${forbidden.join('、')}`);
  const prompt = typeof record.prompt==='string' ? record.prompt.trim() : '';
  const images = Array.isArray(record.images) ? record.images : [];
  const requestedModelId = typeof record.model_id==='string' ? record.model_id.trim() : '';
  if (requestedModelId) {
    const targetModel = getDecisionModel(requestedModelId);
    if (!targetModel) throw new AppError('INVALID_INPUT',400,`指定的判定模型不存在：${requestedModelId}`);
    const reason = unusableReason(targetModel);
    if (reason) throw new AppError('INVALID_INPUT',400,`指定的判定模型不可用：${reason}`);
    const targetChannel = channelOf(targetModel);
    // 严禁在用户显式指定模型后静默切换成其他模型：能力不匹配时直接给出清晰错误提示
    if (!targetChannel.supportsText && !images.length) {
      throw new AppError(
        'INVALID_INPUT',
        400,
        `所选模型「${targetModel.model}」（${targetChannel.label}）仅支持图片审核，不支持纯文本。请上传参考图，或改选支持文字审核的模型`,
      );
    }
    if (!targetChannel.supportsImages && !prompt && images.length) {
      throw new AppError(
        'INVALID_INPUT',
        400,
        `所选模型「${targetModel.model}」（${targetChannel.label}）仅支持文字审核，不支持纯图片。请填写提示词，或改选支持图片审核的模型`,
      );
    }
  }
  if (prompt.length>MAX_PROMPT) throw new AppError('INVALID_INPUT',400,`提示词最多 ${MAX_PROMPT} 字`);
  if (images.length>MAX_IMAGES) throw new AppError('INVALID_INPUT',400,`最多 ${MAX_IMAGES} 张图片`);
  if (images.some(image=>typeof image!=='string')) throw new AppError('INVALID_INPUT',400,'images 必须是 base64 图片数组');
  if (!prompt && !images.length) throw new AppError('INVALID_INPUT',400,'请填写提示词或上传图片');
  if (idempotencyKey && !/^[\w.:-]{8,100}$/.test(idempotencyKey)) throw new AppError('INVALID_INPUT',400,'Idempotency-Key 格式无效');

  const assets = (images as string[]).map((image,index)=>storeImage(image,index));
  const policy = activePolicy();
  const promptHash = sha256(prompt);
  const requestHash = sha256(JSON.stringify({prompt:promptHash,assets:assets.map(a=>a.sha256),model:requestedModelId||null}));
  if (idempotencyKey) {
    const existing = reviewDb().prepare('SELECT id,request_hash FROM review_tasks WHERE idempotency_key=?').get(idempotencyKey) as {id:string;request_hash:string}|undefined;
    if (existing) {
      if (existing.request_hash!==requestHash) throw new AppError('IDEMPOTENCY_CONFLICT',409,'同一幂等键已用于不同内容');
      return {task_id:existing.id,reused:true};
    }
  }
  const units: ReviewUnit[] = [
    ...(prompt?[{unit_id:'prompt',modality:'text' as const,asset_id:null}]:[]),
    ...assets.map((asset,index)=>({unit_id:`img_${index+1}`,modality:'image' as const,asset_id:asset.id})),
  ];
  const mode = reviewMode();
  const initialModel = mode==='live' ? (requestedModelId || decisionRoleStatus('review').id) : 'mock';
  const id = `rv_${randomUUID().replace(/-/g,'').slice(0,20)}`;
  const now = new Date().toISOString();
  reviewDb().prepare(`INSERT INTO review_tasks(id,stage,provider_mode,model,policy_version,execution_status,action,prompt,prompt_hash,asset_ids,content_hash,units,
      is_demo,idempotency_key,request_hash,created_at,updated_at) VALUES (?,?,?,?,?,'PENDING','BLOCK',?,?,?,?,?,?,?,?,?,?)`)
    .run(id,'pre_generation',mode,initialModel,policy.version,prompt,promptHash,JSON.stringify(assets.map(a=>a.id)),
      contentHash(promptHash,assets.map(a=>a.sha256),policy.version),JSON.stringify(units),mode==='mock'?1:0,idempotencyKey,requestHash,now,now);
  enqueue(id);
  return {task_id:id,reused:false};
}

// ---------- Worker: one task at a time, state persisted in SQLite ----------
let queue: Promise<void> = Promise.resolve();
let recovered = false;

function enqueue(id: string) {
  queue = queue.then(()=>processTask(id)).catch(()=>{});
}

/** Waits for the queued review task to finish and returns its latest database row. */
export async function waitForTask(id: string) {
  await queue;
  const current = getTask(id);
  if (current && (current.execution_status==='PENDING' || current.execution_status==='RUNNING')) {
    await processTask(id);
  }
  return getTask(id);
}

/** Called by the review routes: re-queues tasks interrupted by a restart (RUNNING too long, or PENDING). */
export function ensureWorker() {
  if (recovered) return;
  recovered = true;
  const cutoff = new Date(Date.now()-STALE_RUNNING_MS).toISOString();
  reviewDb().prepare("UPDATE review_tasks SET execution_status='PENDING' WHERE execution_status='RUNNING' AND updated_at<? AND decided_by IS NULL").run(cutoff);
  const pending = reviewDb().prepare("SELECT id FROM review_tasks WHERE execution_status='PENDING' ORDER BY created_at").all() as Array<{id:string}>;
  for (const row of pending) enqueue(row.id);
}

function applicableRules(rules: ReviewRule[], unit: ReviewUnit) {
  const subjects = JSON.parse(getSetting('review_subjects')||'[]') as unknown[];
  return {
    asked: rules.filter(rule=>rule.modalities.includes(unit.modality) && !(rule.rule_id==='SUBJECT-001' && !subjects.length)),
    notApplicable: rules.filter(rule=>rule.rule_id==='SUBJECT-001' && !subjects.length && rule.modalities.includes(unit.modality)),
  };
}

export async function processTask(id: string) {
  const claimed = reviewDb().prepare("UPDATE review_tasks SET execution_status='RUNNING',attempts=attempts+1,updated_at=? WHERE id=? AND execution_status='PENDING' AND decided_by IS NULL")
    .run(new Date().toISOString(),id);
  if (!claimed.changes) return;
  const task = getTask(id)!;
  const startRevision = task.revision;
  const started = performance.now();
  try {
    const policy = getPolicy(task.policy_version);
    if (!policy) throw new ProviderError('POLICY_MISSING','规则版本不存在');
    const units = JSON.parse(task.units) as ReviewUnit[];
    const signals: Signal[] = [];
    const checks: Check[] = [];
    const usedModels = new Set<string>();
    const failoverLogs: string[] = [];
    const logCall: CallLogger = entry => {
      recordApiCall(id,entry);
      if (entry.status!==null && entry.status<300) usedModels.add(entry.model_id);
      if (entry.error && entry.error.includes('已触发兜底')) {
        failoverLogs.push(`${entry.model_id}：${entry.error}`);
      }
    };

    const totalTimeoutMs = reviewTotalTimeoutMs();
    const deadlineAt = started + totalTimeoutMs;
    let abandonedByTimeout = false;

    const preferredModel = task.model ? getDecisionModel(task.model) : undefined;
    const canCombineUnits =
      task.provider_mode === 'live' &&
      units.length > 1 &&
      Boolean(preferredModel && !unusableReason(preferredModel) && channelOf(preferredModel).supportsImages);

    if (canCombineUnits) {
      const subjects = JSON.parse(getSetting('review_subjects')||'[]') as unknown[];
      const modalitiesPresent = new Set(units.map(u=>u.modality));
      const allAsked = policy.rules.filter(rule=>rule.modalities.some(m=>modalitiesPresent.has(m)) && !(rule.rule_id==='SUBJECT-001' && !subjects.length));
      const loadedImages: Array<{dataUrl:string;asset_id:string;bytes:number;sha256:string}> = [];
      let missingAsset = false;
      for (const unit of units) {
        const {notApplicable} = applicableRules(policy.rules,unit);
        for (const rule of notApplicable) checks.push({name:`subject:${rule.rule_id}`,unit_id:unit.unit_id,status:'NOT_APPLICABLE',resolved_by:null,detail:'未配置对象资料，指定对象规则不适用'});
        if (unit.modality==='image') {
          const file = unit.asset_id ? readVerifiedAsset(unit.asset_id) : null;
          const asset = unit.asset_id ? getAsset(unit.asset_id) : undefined;
          if (file && asset) {
            loadedImages.push({dataUrl:`data:${file.mime};base64,${file.buf.toString('base64')}`,asset_id:asset.id,bytes:asset.bytes,sha256:asset.sha256});
          } else {
            missingAsset = true;
          }
        }
      }
      if (missingAsset) {
        for (const unit of units) {
          const {asked} = applicableRules(policy.rules,unit);
          checks.push({name:'decision',unit_id:unit.unit_id,status:'FAILED',resolved_by:null,detail:'素材缺失或哈希不一致'});
          for (const rule of asked) signals.push({unit_id:unit.unit_id,rule_id:rule.rule_id,name:rule.name,signal_status:'FAILED',probability:null});
        }
      } else {
        const combinedContent: UnitContent = {
          modality:'combined',
          unit_id:'combined',
          text:task.prompt,
          images:loadedImages,
        };
        let answers: Map<string,Answer>|null = null;
        let failure = '';
        try { answers = await askLive(combinedContent,allAsked,logCall,task.model,deadlineAt); }
        catch (error) {
          if (error instanceof ProviderError && (error.code==='TOTAL_TIMEOUT' || (error.code==='TIMEOUT' && performance.now()>=deadlineAt-200))) {
            abandonedByTimeout = true;
          }
          failure = error instanceof ProviderError ? `${error.code}：${error.message}` : '判定失败';
        }
        for (const unit of units) {
          const {asked} = applicableRules(policy.rules,unit);
          for (const rule of asked) {
            const answer = answers?.get(rule.name) ?? {signal_status:'FAILED' as const,probability:null};
            signals.push({unit_id:unit.unit_id,rule_id:rule.rule_id,name:rule.name,...answer});
          }
          const bad = answers ? asked.filter(r=>answers!.get(r.name)?.signal_status!=='SUCCESS').length : asked.length;
          checks.push({name:'decision',unit_id:unit.unit_id,status:abandonedByTimeout?'NOT_RUN':failure?'FAILED':bad?'FAILED':'SUCCESS',resolved_by:abandonedByTimeout||failure||bad?null:'machine',
            detail:abandonedByTimeout?`超过总耗时限制（${totalTimeoutMs} ms），已放弃审核直接放行`:failure || (bad?`${bad} 个问题无有效答案（拒答、缺失或格式错误）`:`${asked.length} 个问题已合并判定`)});
        }
      }
    } else {
      for (const unit of units) {
        const {asked,notApplicable} = applicableRules(policy.rules,unit);
        for (const rule of notApplicable) checks.push({name:`subject:${rule.rule_id}`,unit_id:unit.unit_id,status:'NOT_APPLICABLE',resolved_by:null,detail:'未配置对象资料，指定对象规则不适用'});
        let content: UnitContent|null = null;
        if (unit.modality==='text') content = {modality:'text',unit_id:unit.unit_id,text:task.prompt};
        else {
          const file = unit.asset_id ? readVerifiedAsset(unit.asset_id) : null;
          const asset = unit.asset_id ? getAsset(unit.asset_id) : undefined;
          if (file && asset) content = {modality:'image',unit_id:unit.unit_id,dataUrl:`data:${file.mime};base64,${file.buf.toString('base64')}`,
            asset_id:asset.id,bytes:asset.bytes,sha256:asset.sha256};
        }
        if (!content) {
          checks.push({name:'decision',unit_id:unit.unit_id,status:'FAILED',resolved_by:null,detail:'素材缺失或哈希不一致'});
          for (const rule of asked) signals.push({unit_id:unit.unit_id,rule_id:rule.rule_id,name:rule.name,signal_status:'FAILED',probability:null});
          continue;
        }
        let answers: Map<string,Answer>|null = null;
        let failure = '';
        try { answers = task.provider_mode==='live' ? await askLive(content,asked,logCall,task.model,deadlineAt) : await askMock(content,asked,logCall); }
        catch (error) {
          if (error instanceof ProviderError && (error.code==='TOTAL_TIMEOUT' || (error.code==='TIMEOUT' && performance.now()>=deadlineAt-200))) {
            abandonedByTimeout = true;
          }
          failure = error instanceof ProviderError ? `${error.code}：${error.message}` : '判定失败';
        }
        for (const rule of asked) {
          const answer = answers?.get(rule.name) ?? {signal_status:'FAILED' as const,probability:null};
          signals.push({unit_id:unit.unit_id,rule_id:rule.rule_id,name:rule.name,...answer});
        }
        const bad = answers ? [...answers.values()].filter(a=>a.signal_status!=='SUCCESS').length : asked.length;
        checks.push({name:'decision',unit_id:unit.unit_id,status:abandonedByTimeout?'NOT_RUN':failure?'FAILED':bad?'FAILED':'SUCCESS',resolved_by:abandonedByTimeout||failure||bad?null:'machine',
          detail:abandonedByTimeout?`超过总耗时限制（${totalTimeoutMs} ms），已放弃审核直接放行`:failure || (bad?`${bad} 个问题无有效答案（拒答、缺失或格式错误）`:`${asked.length} 个问题已判定`)});
        if (abandonedByTimeout) break;
      }
    }
    const result = abandonedByTimeout
      ? {action:'ALLOW' as const,violation_level:'NONE' as const,reason_codes:['REVIEW_TIMEOUT_BYPASSED'],topics:['超时跳过审核'],hits:[]}
      : decide({rules:policy.rules,signals,units});
    if (failoverLogs.length > 0 && !result.topics.includes('已启用兜底模型')) {
      result.topics.push('已启用兜底模型');
    }
    const now = new Date().toISOString();
    // Write only if nobody (e.g. a reviewer) changed the task meanwhile; late machine results are discarded.
    const write = reviewDb().transaction(()=>{
      const updated = reviewDb().prepare(`UPDATE review_tasks SET execution_status='COMPLETE',model=COALESCE(?,model),action=?,violation_level=?,reason_codes=?,topics=?,checks=?,generation_eligible=?,
          revision=revision+1,latency_ms=?,error=NULL,updated_at=? WHERE id=? AND revision=? AND decided_by IS NULL`)
        .run(usedModels.size?[...usedModels].join(', '):null,result.action,result.violation_level,JSON.stringify(result.reason_codes),JSON.stringify(result.topics),JSON.stringify(checks),result.action==='ALLOW'?1:0,
          Math.round(performance.now()-started),now,id,startRevision);
      if (!updated.changes) return false;
      const insert = reviewDb().prepare('INSERT OR REPLACE INTO review_signals(task_id,unit_id,rule_id,name,signal_status,probability) VALUES (?,?,?,?,?,?)');
      for (const s of signals) insert.run(id,s.unit_id,s.rule_id,s.name,s.signal_status,s.probability);
      return true;
    });
    write();
  } catch (error) {
    const message = error instanceof ProviderError ? `${error.code}：${error.message}` : '审核执行失败';
    // 审核执行异常无法确认绝对违规，暂归入「可能违规」并拦截，方便人工复核或重试。
    reviewDb().prepare("UPDATE review_tasks SET execution_status='FAILED',action='BLOCK',violation_level='POSSIBLE',generation_eligible=0,reason_codes=?,error=?,revision=revision+1,latency_ms=?,updated_at=? WHERE id=? AND revision=? AND decided_by IS NULL")
      .run(JSON.stringify(['EXECUTION_FAILED','VIOLATION_POSSIBLE']),message,Math.round(performance.now()-started),new Date().toISOString(),id,startRevision);
  }
}

// ---------- Connection check ----------
export async function checkConnection(preferredModelId?: string|null) {
  const started = performance.now();
  try {
    const target = preferredModelId ? getDecisionModel(preferredModelId) : undefined;
    const protocol = target ? channelOf(target).protocol : null;
    if (protocol === 'tencent-ci-review') {
      const ciRes = await reviewTextWithTencentCi('米色亚麻抱枕，放在客厅沙发上');
      const result = {
        ok: true,
        at: new Date().toISOString(),
        latency_ms: Math.round(performance.now() - started),
        message: `腾讯云数据万象 CI 文本审核正常（${ciRes.suggestion}，Label=${ciRes.label}，Score=${ciRes.score}）`,
      };
      setSetting('review_last_check', JSON.stringify(result));
      return result;
    }
    const answers = await askLive({modality:'text',unit_id:'health',text:'米色亚麻抱枕，放在客厅沙发上'},[
      {rule_id:'HEALTH',name:'health_probe',title:'连接测试',kind:'risk',modalities:['text'],instructions:'内容是否描述了家居产品。',exclusions:'无',threshold:null}],()=>{},preferredModelId);
    const ok = answers.get('health_probe')?.signal_status==='SUCCESS';
    const result = {ok,at:new Date().toISOString(),latency_ms:Math.round(performance.now()-started),message:ok?'判定接口返回有效答案':'接口有响应，但答案无效'};
    setSetting('review_last_check',JSON.stringify(result));
    return result;
  } catch (error) {
    const msg = error instanceof TencentReviewError || error instanceof ProviderError ? error.message : '连接失败';
    const result = {ok:false,at:new Date().toISOString(),latency_ms:Math.round(performance.now()-started),message:msg};
    setSetting('review_last_check',JSON.stringify(result));
    return result;
  }
}

export function healthStatus() {
  const policy = activePolicy();
  const last = getSetting('review_last_check');
  const roleStatus = decisionRoleStatus('review');
  const usable = listDecisionModels().filter(m=>!unusableReason(m));
  const modelCounts = new Map<string,number>();
  for (const m of usable) modelCounts.set(m.model,(modelCounts.get(m.model)||0)+1);
  const models = usable.map(m=>{
    const ch = channelOf(m);
    const shortVendor = m.channel==='openai'
      ? 'OpenAI 官方'
      : m.channel.startsWith('tencent-')
        ? '腾讯云数据万象'
        : 'LoopRouter';
    const displayLabel = (modelCounts.get(m.model)||0)>1 || m.channel.startsWith('tencent-') ? `${m.model}（${shortVendor}）` : m.model;
    return {
      id:m.id,
      model:m.model,
      label:displayLabel,
      supports_text:ch.supportsText,
      supports_images:ch.supportsImages,
    };
  });
  return {
    mode:reviewMode(), model:roleStatus.label, selected_model_id:roleStatus.id, models,
    backup_model_id:getSetting('decision_backup_model_id'),
    total_timeout_ms:reviewTotalTimeoutMs(),
    key_configured:liveKeyConfigured(), decision:roleStatus,
    config_error:reviewMode()==='live'&&!liveKeyConfigured() ? '真实 API 模式下没有可用的判定模型，请在「模型与渠道」配置' : null,
    last_check:last?JSON.parse(last) as {ok:boolean;at:string;latency_ms:number;message:string}:null,
    policy_version:policy.version,
  };
}
