import assert from 'node:assert/strict';
import test from 'node:test';
import { fallbackResult, isNoVisualSignal, missingConstraints, parseEnhanceInput, parseModelOutput } from '../src/server/validation';
import { formatPromptSyntax, isPromptSyntax } from '../src/server/prompt-syntax';
import { needsRevisionResult } from '../src/server/moderation';

test('pure noise becomes an explicitly marked fallback',()=>{
  assert.equal(isNoVisualSignal('1111111'),true);
  assert.equal(isNoVisualSignal('🌸床单'),false);
  const result=fallbackResult('一款原创抱枕，放在明亮的现代客厅沙发上，材质清晰。');
  assert.equal(result.status,'fallback');
  assert.equal(result.can_generate,true);
  assert.match(result.user_notice,/默认/);
  assert.equal(isPromptSyntax(result.prompt),true);
});

test('request input is bounded and context is normalized',()=>{
  const input=parseEnhanceInput({text:' 米色亚麻抱枕 ',context:{scene:' 家纺电商图 ',reference_role:'style'}});
  assert.equal(input.text,'米色亚麻抱枕');
  assert.equal(input.context?.scene,'家纺电商图');
  assert.throws(()=>parseEnhanceInput({text:'a'.repeat(2001)}));
});

test('model output must be usable JSON and preserve explicit anchors',()=>{
  const result=parseModelOutput(JSON.stringify({status:'enhanced',intent_category:'抱枕',prompt:'米色亚麻抱枕置于客厅沙发，使用柔和自然光，展示清晰面料纹理。',negative_prompt:'不要文字',preserved_constraints:['米色','亚麻','抱枕','不要文字'],assumptions:[],conflicts:[],user_notice:''}));
  assert.equal(result.can_generate,true);
  assert.deepEqual(missingConstraints({text:'米色亚麻抱枕，不要文字'},result),[]);
  assert.deepEqual(missingConstraints({text:'蓝色亚麻抱枕'},result),['蓝色']);
  const falseClaim={...result,prompt:'一个简洁的抱枕放在沙发上。',negative_prompt:'',preserved_constraints:['蓝色','亚麻']};
  assert.deepEqual(missingConstraints({text:'蓝色亚麻抱枕'},falseClaim),['蓝色','亚麻']);
  assert.deepEqual(missingConstraints({text:'亚麻抱枕',context:{negative_constraints:['不要人物']}},result),['不要人物']);
  assert.deepEqual(missingConstraints({text:'米色亚麻抱枕，不要文字'}, {...result,negative_prompt:'文字, 水印'}),[]);
  assert.deepEqual(missingConstraints({text:'米色亚麻抱枕，不要文字'}, {...result,prompt:'[主体]\n产品：米色亚麻抱枕。\n\n[限制]\n画面文字：不出现任何文字。',negative_prompt:''}),[]);
  assert.deepEqual(missingConstraints({text:'米色亚麻抱枕，不要文字'}, {...result,prompt:'[主体]\n产品：米色亚麻抱枕。\n\n[限制]\n文字：画面中严禁出现任何文字。',negative_prompt:'text, watermark'}),[]);
  const withoutNotice={status:'enhanced',intent_category:'抱枕',prompt:'米色亚麻抱枕置于客厅沙发，使用柔和自然光，展示清晰面料纹理。',negative_prompt:'文字',preserved_constraints:[],assumptions:[],conflicts:[]};
  assert.equal(parseModelOutput(JSON.stringify(withoutNotice)).user_notice,'');
  assert.equal(parseModelOutput(JSON.stringify({...withoutNotice,user_notice:[]})).user_notice,'');
  assert.throws(()=>parseModelOutput('not json'));
});

test('risky input returns edit guidance without a generatable prompt',()=>{
  const result=needsRevisionResult({decision:'revise',categories:['political_sensitive','graphic_violence'],modelId:'qwen-flash',ms:700,inputTokens:100,outputTokens:20});
  assert.equal(result.status,'needs_revision');
  assert.equal(result.can_generate,false);
  assert.equal(result.prompt,'');
  assert.equal(result.negative_prompt,'');
  assert.equal(result.revision_guidance?.length,2);
  assert.match(result.revision_guidance?.[0].suggestion||'',/虚构人物/);
});

test('copyright restrictions return actionable guidance and no prompt',()=>{
  const result = needsRevisionResult({categories:['copyright_ip']});
  assert.equal(result.status,'needs_revision');
  assert.equal(result.can_generate,false);
  assert.equal(result.prompt,'');
  assert.match(result.revision_guidance![0].reason,/版权角色/);
  assert.match(result.revision_guidance![0].suggestion,/原创角色/);
  const imageResult = needsRevisionResult({categories:['copyright_ip']},'image');
  assert.equal(imageResult.can_generate,false);
  assert.match(imageResult.revision_guidance![0].suggestion,/更换/);
});

test('section syntax keeps explicit exclusions in the copyable prompt',()=>{
  const input=parseEnhanceInput({text:'米色亚麻抱枕，放在客厅沙发上，不要文字'});
  const prompt=formatPromptSyntax('米色亚麻抱枕放在客厅沙发上，柔和自然光照明。',input);
  assert.equal(isPromptSyntax(prompt),true);
  assert.match(prompt,/\[画面\]\n描述：米色亚麻抱枕/);
  assert.match(prompt,/\[限制\]\n避免：文字。/);
  assert.equal(isPromptSyntax('[主体]\n产品：抱枕；'),false);

  const compressed=formatPromptSyntax('[主体] 物品：米色抱枕；材质：柔软织物；文字：正面写上“晚安”。[场景] 背景：现代客厅沙发；光线：自然柔光。[限制] 排除：除指定文字外的其他任何文字。',
    parseEnhanceInput({text:'米色抱枕，不要文字，但正面写上“晚安”'}));
  assert.equal(isPromptSyntax(compressed),true);
  assert.match(compressed,/\[主体\]\n物品：米色抱枕；\n材质：柔软织物；\n文字：正面写上“晚安”。/);
  assert.match(compressed,/\n\n\[场景\]\n背景：现代客厅沙发；/);
  assert.equal((compressed.match(/\[限制\]/gu)||[]).length,1);
  assert.doesNotMatch(compressed,/描述：\[主体\]/u);

  const alreadyExcluded=formatPromptSyntax('[主体]\n产品：米色抱枕。\n\n[限制]\n画面文字：不添加任何文字。',
    parseEnhanceInput({text:'米色抱枕，不要文字'}));
  assert.equal((alreadyExcluded.match(/\[限制\]/gu)||[]).length,1);

  const strayPunctuation=formatPromptSyntax('[主体]\n物品：米色抱枕；\n文字：正面写上“晚安”；\n。\n\n[限制]\n排除项：除指定文字外无其他装饰性文字；\n。',
    parseEnhanceInput({text:'米色抱枕，不要文字，但正面写上“晚安”'}));
  assert.equal(isPromptSyntax(strayPunctuation),true);
  assert.match(strayPunctuation,/\[主体\]\n物品：米色抱枕；\n文字：正面写上“晚安”。/);
  assert.equal((strayPunctuation.match(/\[限制\]/gu)||[]).length,1);
  assert.doesNotMatch(strayPunctuation,/描述：\[主体\]/u);
});

test('Chinese quotes are reserved for text rendered in the image',()=>{
  const textInput=parseEnhanceInput({text:'在米色抱枕上写上“晚安”'});
  const rendered=formatPromptSyntax('[主体]\n产品：米色抱枕。\n\n[画面文字]\n内容：写上“晚安”。',textInput);
  assert.equal(isPromptSyntax(rendered),true);
  assert.match(rendered,/写上“晚安”/);

  const productInput=parseEnhanceInput({text:'“云朵”抱枕放在沙发上，不要文字'});
  const ordinary=formatPromptSyntax('[主体]\n产品：“云朵”抱枕。\n\n[场景]\n环境：沙发上。',productInput);
  assert.equal(isPromptSyntax(ordinary),true);
  assert.doesNotMatch(ordinary,/[“”]/u);
  assert.match(ordinary,/避免：文字。/);

  const mixedInput=parseEnhanceInput({text:'“云朵”抱枕，正面写上“晚安”'});
  const mixed=formatPromptSyntax('[主体]\n产品：“云朵”抱枕。\n\n[画面文字]\n内容：写上“晚安”。',mixedInput);
  assert.match(mixed,/产品：云朵抱枕。/);
  assert.match(mixed,/内容：写上“晚安”。/);
  assert.doesNotMatch(mixed,/“云朵”/);

  const bareInput=parseEnhanceInput({text:'抱枕上写晚安'});
  const bare=formatPromptSyntax('[主体]\n产品：抱枕。\n\n[画面文字]\n内容：抱枕上写晚安。',bareInput);
  assert.match(bare,/内容：抱枕上写“晚安”。/);

  const negatedInput=parseEnhanceInput({text:'不要显示“晚安”字样'});
  const negated=formatPromptSyntax('[限制]\n避免：显示“晚安”字样。',negatedInput);
  assert.doesNotMatch(negated,/[“”]/u);

  const negatedWriteInput=parseEnhanceInput({text:'不要写上“晚安”'});
  const negatedWrite=formatPromptSyntax('[限制]\n避免：写上“晚安”。',negatedWriteInput);
  assert.doesNotMatch(negatedWrite,/[“”]/u);

  const onlySpecifiedText=parseEnhanceInput({text:'不要文字，但写上“晚安”'});
  const reconciled=formatPromptSyntax('[画面文字]\n内容：写上“晚安”。\n\n[限制]\n避免：不要文字。',onlySpecifiedText);
  assert.match(reconciled,/内容：写上“晚安”。/);
  assert.match(reconciled,/避免：不要其他文字。/);
  assert.doesNotMatch(reconciled,/避免：文字。/);
});
