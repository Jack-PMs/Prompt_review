export type Provider = 'openai' | 'gemini' | 'qwen' | 'deepseek' | 'apiyi' | 'bananarouter' | 'runninghub';
export type IntentStatus = 'enhanced' | 'fallback' | 'clarify' | 'needs_revision' | 'needs_clarification';

export type ReviewCategory = 'political_sensitive' | 'misinformation_impersonation' | 'hate_extremism' |
  'sexual_minors' | 'sexual_explicit' | 'graphic_violence' | 'self_harm' |
  'illegal_harm' | 'privacy_impersonation' | 'copyright_ip' | 'other_sensitive';

export interface RevisionIssue {
  category: ReviewCategory;
  reason: string;
  suggestion: string;
}

export interface ModelConfig {
  id: string;
  provider: Provider;
  model: string;
  enabled: number;
  timeout_ms: number;
  max_output_tokens: number;
  priority: number;
  updated_at: string;
}

export interface EnhancementResult {
  status: IntentStatus;
  can_generate: boolean;
  intent_category: string;
  prompt: string;
  negative_prompt: string;
  preserved_constraints: string[];
  assumptions: string[];
  conflicts: string[];
  user_notice: string;
  revision_guidance?: RevisionIssue[];
  /** What the vision model read from the reference images; present only when images were sent. */
  reference_analysis?: string;
  /** Intent recognition result; includes structured 3-layer routing fields while remaining backward-compatible. */
  intent?: {
    status:'ok'|'failed';
    error?:string;
    channel?: 'rule_fast' | 'text_fast' | 'vision_ondemand' | 'fallback_rule';
    model_id?: string;
    failover_from?: string | null;
    config_version?: number;
    latency_ms?: number;
    input_state?: 'clear' | 'clarify' | 'fallback';
    action?: string;
    action_label?: string;
    routed_scene_id?: string | null;
    entry_conflict?: string | null;
    confidence?: number;
    has_visual_intent:number|null;
    too_vague:number|null;
    category:{value:string;probability:number}|null;
    usage:{value:string;probability:number}|null;
    wants_rendered_text:number|boolean|null;
    has_exclusions:number|boolean|null;
  };
  /** Present only when status is needs_clarification: what the user should add before retrying. */
  clarification_guidance?: string[];
}

export interface EnhanceInput {
  text: string;
  context?: {
    scene?: string;
    style?: string;
    template?: string;
    target_image_model?: string;
    aspect_ratio?: string;
    reference_summary?: string;
    reference_role?: 'content' | 'style' | 'composition';
    negative_constraints?: string[];
    /** Usage scene identifier configured in the admin console, e.g. home or product-reshoot. */
    entry?: string;
    /** Up to 3 reference images: http(s) URLs or base64 data URLs. Never stored or sent to the text models. */
    reference_images?: string[];
  };
}

export interface SceneConfig {
  id: string;
  name: string;
  /** Extra system-prompt rules for this scene; empty means none. */
  rules: string;
  /** Scene-specific fallback prompt; empty means use the global fallback_scene setting. */
  fallback_scene: string;
  enabled: number;
  updated_at: string;
}

export interface RunRecord {
  id: string;
  kind: 'live' | 'playground' | 'benchmark';
  model_id: string;
  /** Default model that failed before the backup produced this run; null when no failover happened. */
  failover_from: string | null;
  prompt_version: number;
  entry: string | null;
  status: 'success' | 'failed' | 'needs_revision';
  intent_status: IntentStatus | null;
  attempts: number;
  review_attempts: number;
  review_ms: number;
  review_model_id: string | null;
  /** Reference images in the request (the images themselves are never stored). */
  image_count: number;
  vision_ms: number;
  vision_model_id: string | null;
  /** Decisions intent recognition: duration and outcome (null when it did not run). */
  intent_ms: number;
  intent_check: 'ok'|'failed'|null;
  total_ms: number;
  upstream_ms: number;
  input_tokens: number | null;
  output_tokens: number | null;
  error_code: string | null;
  input_text: string | null;
  output_json: string | null;
  created_at: string;
}
