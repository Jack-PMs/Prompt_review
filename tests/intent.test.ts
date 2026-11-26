import assert from 'node:assert/strict';
import test from 'node:test';
import { intentHints, parseIntentAnswers } from '../src/server/intent';
import { needsClarificationResult } from '../src/server/validation';

const answers = (overrides: Array<Record<string,unknown>> = []) => ({answers:[
  {type:'predicate',name:'has_visual_intent',probability:0.98},{type:'predicate',name:'too_vague',probability:0.05},
  {type:'choice',name:'category',choice:'床品四件套',probabilities:[{value:'床品四件套',probability:0.93},{value:'其他',probability:0.07}],confidence:0.93},
  {type:'choice',name:'usage',choice:'其他',probabilities:[{value:'其他',probability:0.6}],confidence:0.6},
  {type:'predicate',name:'wants_rendered_text',probability:0.02},{type:'predicate',name:'has_exclusions',probability:0.97},
  ...overrides]});

test('intent answers are parsed strictly',()=>{
  const parsed = parseIntentAnswers(answers());
  assert.deepEqual(parsed.category,{value:'床品四件套',probability:0.93});
  assert.equal(parsed.has_exclusions,0.97);
  assert.equal(parseIntentAnswers(answers([{type:'predicate',name:'too_vague',probability:0.1}])).too_vague,null);
  assert.equal(parseIntentAnswers({answers:[{type:'choice',name:'category',choice:'沙发'}]}).category,null);
  assert.equal(parseIntentAnswers({answers:[{type:'refusal',name:'has_visual_intent'}]}).has_visual_intent,null);
  assert.equal(parseIntentAnswers(null).has_visual_intent,null);
});

test('only confident, informative values become hints',()=>{
  const hints = intentHints({status:'ok',ms:1,...parseIntentAnswers(answers())});
  assert.deepEqual(hints,{category:'床品四件套',wants_rendered_text:false,has_exclusions:true});
  assert.equal(intentHints({status:'failed',ms:1,has_visual_intent:null,too_vague:null,category:null,usage:null,wants_rendered_text:null,has_exclusions:null}),undefined);
});

test('clarification does not ask for a product that was already recognized',()=>{
  assert.equal(needsClarificationResult().clarification_guidance!.length,3);
  const known = needsClarificationResult('','窗帘').clarification_guidance!;
  assert.equal(known.length,2); assert.match(known[0],/^窗帘的颜色/);
});
