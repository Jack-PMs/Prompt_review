import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnswers } from '../src/server/review/decisions';
import { askModel } from '../src/server/decision/client';
import type { DecisionModel } from '../src/server/decision/models';
import { decide } from '../src/server/review/engine';
import { DEFAULT_RULES } from '../src/server/review/policy';
import { sniffImage } from '../src/server/review/assets';
import type { Signal } from '../src/server/review/types';

const names = ['explicit_sexual','violent_incitement'];

test('only well-formed predicate answers count; failures are never 0',()=>{
  const ok = validateAnswers({answers:[{type:'predicate',name:'explicit_sexual',probability:0.02},{type:'predicate',name:'violent_incitement',probability:0}]},names);
  assert.deepEqual(ok.get('violent_incitement'),{signal_status:'SUCCESS',probability:0});
  const bad = validateAnswers({answers:[
    {type:'refusal',name:'explicit_sexual'},
    {type:'predicate',name:'violent_incitement',probability:1.4},
  ]},names);
  assert.deepEqual(bad.get('explicit_sexual'),{signal_status:'REFUSED',probability:null});
  assert.deepEqual(bad.get('violent_incitement'),{signal_status:'INVALID',probability:null});
  assert.equal(validateAnswers({answers:[]},names).get('explicit_sexual')!.signal_status,'MISSING');
  const dup = validateAnswers({answers:[{type:'predicate',name:'explicit_sexual',probability:0.1},{type:'predicate',name:'explicit_sexual',probability:0.2}]},names);
  assert.equal(dup.get('explicit_sexual')!.signal_status,'INVALID');
  assert.equal(validateAnswers({answers:[{type:'score',name:'explicit_sexual',probability:0.1}]},names).get('explicit_sexual')!.signal_status,'INVALID');
  assert.equal(validateAnswers(null,names).get('explicit_sexual')!.signal_status,'INVALID');
});

function signals(unit_id:string, overrides:Record<string,number|null> = {}): Signal[] {
  return DEFAULT_RULES.filter(r=>r.rule_id!=='SUBJECT-001').map(r=>{
    const p = r.name in overrides ? overrides[r.name] : (r.kind==='quality'?0.95:0.02);
    return {unit_id,rule_id:r.rule_id,name:r.name,signal_status:p===null?'REFUSED':'SUCCESS',probability:p};
  });
}

test('only ALLOW or BLOCK: reaching a threshold blocks; topic is a label only',()=>{
  assert.equal(decide({rules:DEFAULT_RULES,signals:signals('prompt')}).action,'ALLOW');
  const topic = decide({rules:DEFAULT_RULES,signals:signals('prompt',{political_topic:0.99})});
  assert.equal(topic.action,'ALLOW'); assert.deepEqual(topic.topics,['涉政话题']);
  const suggestive = decide({rules:DEFAULT_RULES,signals:signals('prompt',{sexual_suggestive:0.7})});
  assert.equal(suggestive.action,'BLOCK'); assert.ok(suggestive.reason_codes.includes('RULE_BLOCK:SEX-002'));
  assert.equal(decide({rules:DEFAULT_RULES,signals:signals('prompt',{violent_incitement:0.49})}).action,'ALLOW');
});

test('other failed judgments are recorded; one hit unit is never averaged away',()=>{
  const refused = decide({rules:DEFAULT_RULES,signals:signals('prompt',{explicit_sexual:null})});
  assert.equal(refused.action,'ALLOW'); assert.ok(refused.reason_codes.includes('SIGNAL_REFUSED'));
  const lowEvidence = decide({rules:DEFAULT_RULES,signals:signals('img_1',{evidence_sufficient:0.2})});
  assert.equal(lowEvidence.action,'ALLOW'); assert.ok(lowEvidence.reason_codes.includes('EVIDENCE_INSUFFICIENT'));
  const many = [...signals('prompt'),...signals('img_1'),...signals('img_2',{violent_incitement:0.97}),...signals('img_3')];
  const result = decide({rules:DEFAULT_RULES,signals:many});
  assert.equal(result.action,'BLOCK'); assert.deepEqual(result.hits.map(h=>h.unit_id),['img_2']);
});

test('copyright hits and incomplete copyright checks never allow generation',()=>{
  const hit = decide({rules:DEFAULT_RULES,signals:signals('prompt',{copyright_character:0.99})});
  assert.equal(hit.action,'BLOCK');
  assert.ok(hit.reason_codes.includes('RULE_BLOCK:IP-001'));
  for (const signal_status of ['REFUSED','MISSING','INVALID','FAILED'] as const) {
    const failed = signals('prompt').map(signal=>signal.rule_id==='IP-001'?{...signal,signal_status,probability:null}:signal);
    const result = decide({rules:DEFAULT_RULES,signals:failed});
    assert.equal(result.action,'BLOCK');
    assert.ok(result.reason_codes.includes('IP_CHECK_INCOMPLETE'));
  }
  const units = [{unit_id:'prompt',modality:'text' as const,asset_id:null},{unit_id:'img_1',modality:'image' as const,asset_id:'ast_test'}];
  assert.equal(decide({rules:DEFAULT_RULES,signals:signals('prompt'),units}).action,'BLOCK');
  assert.equal(decide({rules:DEFAULT_RULES,signals:[],units}).action,'BLOCK');
  assert.equal(decide({rules:DEFAULT_RULES,signals:[...signals('prompt'),...signals('img_1')],units}).action,'ALLOW');
});

test('image format is detected from bytes, not the declared type',()=>{
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000040000000200802000000','hex');
  assert.deepEqual(sniffImage(png),{mime:'image/png',ext:'png',width:64,height:32});
  assert.equal(sniffImage(Buffer.from('<html>not an image</html>')),null);
});

test('违规两级判定：区分正常(NONE)、可能违规(POSSIBLE)与绝对违规(ABSOLUTE)',()=>{
  const safe = decide({rules:DEFAULT_RULES,signals:signals('prompt',{sexual_suggestive:0.49})});
  assert.equal(safe.action,'ALLOW');
  assert.equal(safe.violation_level,'NONE');

  // 默认 threshold=0.5，自动推导 absolute_threshold=0.85：0.70 命中可能违规
  const possible = decide({rules:DEFAULT_RULES,signals:signals('prompt',{sexual_suggestive:0.7})});
  assert.equal(possible.action,'BLOCK');
  assert.equal(possible.violation_level,'POSSIBLE');
  assert.ok(possible.reason_codes.includes('VIOLATION_POSSIBLE'));
  assert.equal(possible.hits[0].level,'POSSIBLE');

  // 0.92 >= 0.85 升级为绝对违规
  const absolute = decide({rules:DEFAULT_RULES,signals:signals('prompt',{explicit_sexual:0.92})});
  assert.equal(absolute.action,'BLOCK');
  assert.equal(absolute.violation_level,'ABSOLUTE');
  assert.ok(absolute.reason_codes.includes('VIOLATION_ABSOLUTE'));
  assert.equal(absolute.hits[0].level,'ABSOLUTE');

  // 自定义显式双阈值：0.85~0.94 为可能违规，>=0.95 为绝对违规；多单元取最高级别
  const customRules = DEFAULT_RULES.map(r =>
    r.kind==='risk' ? {...r,threshold:0.85,absolute_threshold:0.95} : r
  );
  const borderline = decide({rules:customRules,signals:signals('prompt',{china_political:0.90})});
  assert.equal(borderline.action,'BLOCK');
  assert.equal(borderline.violation_level,'POSSIBLE');

  const mixedUnits = decide({
    rules:customRules,
    signals:[...signals('prompt',{sexual_suggestive:0.88}),...signals('img_1',{china_political:0.96})],
  });
  assert.equal(mixedUnits.action,'BLOCK');
  assert.equal(mixedUnits.violation_level,'ABSOLUTE');
  assert.equal(mixedUnits.hits.find(h=>h.unit_id==='prompt')?.level,'POSSIBLE');
  assert.equal(mixedUnits.hits.find(h=>h.unit_id==='img_1')?.level,'ABSOLUTE');
});

test('纯图片审核接口报文去字：user/state 中仅传 image 节点，不附带额外 text 或 meta 说明字段',async()=>{
  process.env.LOOPROUTER_API_KEY = 'sk-test-pure-image';
  const origFetch = globalThis.fetch;
  try {
    const sentBodies: any[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body));
      sentBodies.push(parsed);
      if (Array.isArray(parsed.questions)) {
        return new Response(JSON.stringify({answers:[{type:'predicate',name:'explicit_sexual',probability:0.12}]}),{status:200});
      }
      return new Response(JSON.stringify({answers:{explicit_sexual:{type:'noul',noul:0.12}}}),{status:200});
    }) as typeof fetch;

    const now = new Date().toISOString();
    const doubaoModel: DecisionModel = {
      id:'looprouter-doubao-seed-2-1-lite',channel:'looprouter-systemone-multimodal',
      model:'doubao-seed-2-1-lite-260915',workspace_id:'',enabled:1,timeout_ms:5000,priority:1,last_test:null,updated_at:now,
    };
    const gptModel: DecisionModel = {
      id:'looprouter-gpt-6-luna',channel:'looprouter',
      model:'gpt-6-luna',workspace_id:'',enabled:1,timeout_ms:5000,priority:2,last_test:null,updated_at:now,
    };

    const pureImageContent = {
      developer:'',
      text:'',
      images:[{dataUrl:'data:image/jpeg;base64,PURE_IMG',placeholder:'[IMAGE:ast_1]'}],
    };
    const q = [{type:'predicate' as const,name:'explicit_sexual',instructions:'露骨色情'}];

    await askModel(doubaoModel,pureImageContent,q);
    assert.deepEqual(sentBodies[0].state,[{type:'image',image_url:'data:image/jpeg;base64,PURE_IMG',detail:'high'}]);

    await askModel(gptModel,pureImageContent,q);
    assert.deepEqual(sentBodies[1].input,[{role:'user',content:[{type:'input_image',image_url:'data:image/jpeg;base64,PURE_IMG'}]}]);
  } finally {
    globalThis.fetch = origFetch;
  }
});
