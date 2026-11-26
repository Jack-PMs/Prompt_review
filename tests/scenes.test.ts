import assert from 'node:assert/strict';
import test from 'node:test';
import { hasReviewableContext, parseEnhanceInput } from '../src/server/validation';
import { sceneFallback, validateSceneFields, withSceneRules } from '../src/server/scenes';
import type { SceneConfig } from '../src/server/types';

const scene: SceneConfig = {id:'model-gen',name:'真人模特生成',rules:'人物着装需完整。',fallback_scene:'',enabled:1,updated_at:''};

test('entry is validated and does not count as reviewable context',()=>{
  assert.equal(parseEnhanceInput({text:'抱枕',context:{entry:'product-reshoot'}}).context?.entry,'product-reshoot');
  assert.equal(parseEnhanceInput({text:'抱枕',context:{entry:''}}).context?.entry,undefined);
  assert.throws(()=>parseEnhanceInput({text:'抱枕',context:{entry:'Bad Id'}}),/entry/);
  assert.equal(hasReviewableContext(parseEnhanceInput({text:'1111',context:{entry:'home'}})),false);
  assert.equal(hasReviewableContext(parseEnhanceInput({text:'1111',context:{entry:'home',style:'简约'}})),true);
});

test('scene rules are appended to the system prompt',()=>{
  assert.equal(withSceneRules('BASE',null),'BASE');
  const withRules = withSceneRules('BASE',scene);
  assert.match(withRules,/^BASE\n\n当前使用场景：真人模特生成（model-gen）。/);
  assert.match(withRules,/人物着装需完整。$/);
  assert.doesNotMatch(withSceneRules('BASE',{...scene,rules:''}),/附加规则/);
});

test('scene fallback overrides the global fallback only when set',()=>{
  assert.equal(sceneFallback(null,'GLOBAL'),'GLOBAL');
  assert.equal(sceneFallback(scene,'GLOBAL'),'GLOBAL');
  assert.equal(sceneFallback({...scene,fallback_scene:'一位模特身穿家居服坐在卧室床边，柔和自然光。'},'GLOBAL'),'一位模特身穿家居服坐在卧室床边，柔和自然光。');
});

test('scene fields are bounded',()=>{
  assert.throws(()=>validateSceneFields({name:''}),/名称/);
  assert.throws(()=>validateSceneFields({name:'首页',fallback_scene:'太短'}),/兜底稿/);
  assert.deepEqual(validateSceneFields({name:' 首页 '}),{name:'首页',rules:'',fallback_scene:'',enabled:1});
  assert.equal(validateSceneFields({enabled:false},scene).enabled,0);
});
