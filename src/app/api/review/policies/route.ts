import { checkOrigin, requireAdmin } from '@/server/auth';
import { audit, setSetting } from '@/server/db';
import { failure, json, readJson } from '@/server/http';
import { activePolicy, listPolicies, reviewDb } from '@/server/review/store';
import { resolveAbsoluteThreshold } from '@/server/review/policy';
import type { ReviewRule } from '@/server/review/types';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const active = activePolicy();
    return json({active_version:active.version,versions:listPolicies()});
  } catch (error) { return failure(error); }
}

const threshold = (value: unknown, field: string) => {
  if (value===null) return null;
  if (typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1) throw new AppError('INVALID_INPUT',400,`${field} 需为 0～1 的数字或留空`);
  return Math.round(value*100)/100;
};

/** Creates and activates a new policy version from edits to the active one. History is never rewritten. */
export async function POST(request: Request) {
  try {
    requireAdmin(request); checkOrigin(request);
    const body = await readJson(request,65536) as Record<string,unknown>;
    const active = activePolicy();
    if (body.base_version!==active.version) throw new AppError('CONFIG_CONFLICT',409,'规则已被更新，请刷新后再改');
    const note = typeof body.note==='string' ? body.note.trim() : '';
    if (note.length<4) throw new AppError('INVALID_INPUT',400,'请填写至少 4 个字的变更说明');
    const edits = Array.isArray(body.rules) ? body.rules as Array<Record<string,unknown>> : [];
    const rules: ReviewRule[] = active.rules.map(rule=>{
      const edit = edits.find(e=>e.rule_id===rule.rule_id);
      if (!edit) return rule;
      const text = (value: unknown, field: string, max: number) => {
        if (typeof value!=='string' || !value.trim() || value.length>max) throw new AppError('INVALID_INPUT',400,`${rule.rule_id} 的${field}需为 1～${max} 字`);
        return value.trim();
      };
      const value = rule.kind==='topic' ? null : threshold(edit.threshold===undefined ? rule.threshold : edit.threshold,`${rule.rule_id} 可能违规阈值`);
      const rawAbsolute = rule.kind==='risk'
        ? threshold(edit.absolute_threshold===undefined ? (rule.absolute_threshold ?? null) : edit.absolute_threshold,`${rule.rule_id} 绝对违规阈值`)
        : null;
      if (rule.kind==='risk' && value!==null && rawAbsolute!==null && rawAbsolute<value) {
        throw new AppError('INVALID_INPUT',400,`${rule.rule_id} 的绝对违规阈值（${rawAbsolute}）不能低于可能违规阈值（${value}）`);
      }
      const absoluteValue = rule.kind==='risk'
        ? resolveAbsoluteThreshold({kind:'risk',threshold:value,absolute_threshold:rawAbsolute})
        : null;
      const blockMessage = rule.kind==='risk' ? text(edit.block_message??rule.block_message,'前端提示文案',200) : '';
      return {
        ...rule,
        instructions:text(edit.instructions??rule.instructions,'规则说明',1200),
        exclusions:'',
        block_message:blockMessage,
        threshold:value,
        absolute_threshold:absoluteValue,
      };
    });
    const count = (reviewDb().prepare('SELECT COUNT(*) AS n FROM review_policy_versions').get() as {n:number}).n;
    const version = `content-policy-v${count+1}`;
    reviewDb().transaction(()=>{
      reviewDb().prepare('INSERT INTO review_policy_versions(version,rules_json,note,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(version,JSON.stringify(rules),note,'admin',new Date().toISOString());
      setSetting('review_active_policy',version);
      audit('admin','create','review_policy:'+version,note);
    })();
    return json({version},201);
  } catch (error) { return failure(error); }
}
