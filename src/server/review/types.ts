export type Modality = 'text'|'image';
export type ProviderMode = 'mock'|'live';
export type ExecutionStatus = 'PENDING'|'RUNNING'|'COMPLETE'|'FAILED';
/** REVIEW only appears on tasks created before manual review was removed. */
export type ReviewAction = 'ALLOW'|'BLOCK'|'REVIEW';
/** 违规等级：NONE 正常放行 / POSSIBLE 可能违规（建议人工复核） / ABSOLUTE 绝对违规（高确信红线） */
export type ViolationLevel = 'NONE'|'POSSIBLE'|'ABSOLUTE';
export type CheckStatus = 'SUCCESS'|'FAILED'|'NOT_RUN'|'NOT_APPLICABLE';
/** Per-question outcome. Anything other than SUCCESS carries probability=null — never a fabricated 0. */
export type SignalStatus = 'SUCCESS'|'REFUSED'|'MISSING'|'INVALID'|'FAILED';

export interface ReviewRule {
  rule_id: string;
  /** Decisions question name. */
  name: string;
  title: string;
  instructions: string;
  exclusions: string;
  /** 前端命中拦截时在输入框展示的提示文案 */
  block_message?: string;
  modalities: Modality[];
  /**
   * risk: blocked when probability >= threshold.
   * topic: label only, never blocks.
   * quality: flagged "evidence insufficient" when probability < threshold (informational, never blocks).
   */
  kind: 'risk'|'topic'|'quality';
  /** 可能违规（拦截）阈值：达到此概率判定为「可能违规」并拦截 */
  threshold: number|null;
  /** 绝对违规阈值：达到此概率升级判定为「绝对违规」（高确信硬红线） */
  absolute_threshold?: number|null;
}

export interface PolicyVersion {
  version: string;
  rules: ReviewRule[];
  note: string;
  created_by: string;
  created_at: string;
}

export interface ReviewUnit {
  unit_id: string;
  modality: Modality;
  asset_id: string|null;
}

export interface Signal {
  unit_id: string;
  rule_id: string;
  name: string;
  signal_status: SignalStatus;
  probability: number|null;
}

export interface Check {
  name: string;
  unit_id: string;
  status: CheckStatus;
  resolved_by: 'machine'|'manual'|null;
  detail: string;
}

export interface EngineResult {
  action: 'ALLOW'|'BLOCK';
  violation_level: ViolationLevel;
  reason_codes: string[];
  topics: string[];
  hits: Array<{rule_id:string;unit_id:string;probability:number;level:'POSSIBLE'|'ABSOLUTE'}>;
}
