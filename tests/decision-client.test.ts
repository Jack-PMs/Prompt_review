import assert from 'node:assert/strict';
import test from 'node:test';
import { askModel, DecisionError, type DecisionQuestion } from '../src/server/decision/client';
import type { DecisionModel } from '../src/server/decision/models';

process.env.DASHSCOPE_API_KEY = 'sk-ali'; process.env.LOOPROUTER_API_KEY = 'sk-loop';
const now = new Date().toISOString();
const aliyun: DecisionModel = {id:'ali',channel:'aliyun-beijing',model:'decision-model-preview',workspace_id:'ws-123',enabled:1,timeout_ms:5000,priority:3,last_test:null,updated_at:now};
const loop: DecisionModel = {id:'loop',channel:'looprouter',model:'gpt-6-luna',workspace_id:'',enabled:1,timeout_ms:5000,priority:2,last_test:null,updated_at:now};
const content = {developer:'判断', text:'米色亚麻抱枕'};

function stub(handler:(url:string,body:any)=>Response) {
  const calls: Array<{url:string;body:any;auth:string}> = [];
  globalThis.fetch = (async (url: string, init: any) => { const body = JSON.parse(init.body); calls.push({url,body,auth:init.headers.authorization}); return handler(url,body); }) as typeof fetch;
  return calls;
}

test('aliyun System One: request uses state + keyed questions, answers are normalized',async()=>{
  const calls = stub((_u,body)=>new Response(JSON.stringify({answers:Object.fromEntries(Object.entries(body.questions).map(([id,q]:[string,any])=>[id,
    q.type==='noul'?{type:'noul',noul:0.93,probabilities:{true:0.93,false:0.07}}:{type:'choice',choice:'抱枕',probabilities:{抱枕:0.9,其他:0.1},confidence:0.9}]))}),{status:200}));
  const questions: DecisionQuestion[] = [{type:'predicate',name:'is_home',instructions:'是否家居'},{type:'choice',name:'cat',instructions:'品类',choices:['抱枕','其他']}];
  const r = await askModel(aliyun,content,questions);
  assert.equal(calls[0].url,'https://ws-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/systemone');
  assert.equal(calls[0].auth,'Bearer sk-ali');
  assert.deepEqual(calls[0].body.questions.is_home,{type:'noul',instructions:'是否家居'});
  assert.deepEqual(calls[0].body.questions.cat.criteria,{抱枕:'抱枕',其他:'其他'});
  assert.equal(calls[0].body.state.待判断内容,'米色亚麻抱枕');
  assert.deepEqual(r.answers[0],{type:'predicate',name:'is_home',probability:0.93});
  assert.deepEqual(r.answers[1],{type:'choice',name:'cat',choice:'抱枕',probabilities:[{value:'抱枕',probability:0.9},{value:'其他',probability:0.1}],confidence:0.9});
});

test('questions are split by the channel limit (16 for aliyun) and merged',async()=>{
  const calls = stub((_u,body)=>new Response(JSON.stringify({answers:Object.fromEntries(Object.keys(body.questions).map(id=>[id,{type:'noul',noul:0.1}]))}),{status:200}));
  const questions: DecisionQuestion[] = Array.from({length:20},(_,i)=>({type:'predicate',name:`q${i}`,instructions:'x'}));
  const r = await askModel(aliyun,content,questions);
  assert.equal(calls.length,2); assert.equal(Object.keys(calls[0].body.questions).length,16); assert.equal(r.answers.length,20);
});

test('text-only channels refuse images; OpenAI format carries input_image and logs a placeholder',async()=>{
  await assert.rejects(askModel(aliyun,{...content,images:[{dataUrl:'data:image/png;base64,AAAA',placeholder:'[IMG]'}]},[{type:'predicate',name:'a',instructions:'x'}]),(e:unknown)=>e instanceof DecisionError && e.code==='IMAGES_UNSUPPORTED');
  const calls = stub(()=>new Response(JSON.stringify({answers:[{type:'predicate',name:'a',probability:0.2}]}),{status:200}));
  const logs: any[] = [];
  await askModel(loop,{...content,images:[{dataUrl:'data:image/png;base64,AAAA',placeholder:'[IMG]'}]},[{type:'predicate',name:'a',instructions:'x'}],e=>logs.push(e));
  assert.equal(calls[0].url,'https://api.looprouter.com/v1/decisions');
  assert.equal(calls[0].body.input[1].content[1].image_url,'data:image/png;base64,AAAA');
  assert.equal(logs[0].request_body.input[1].content[1].image_url,'[IMG]');
  assert.equal(logs[0].request_headers.Authorization,'Bearer ***'); assert.equal(logs[0].model_id,'loop');
});

test('transient errors are retried once, then reported',async()=>{
  const calls = stub(()=>new Response('{}',{status:503}));
  await assert.rejects(askModel(loop,content,[{type:'predicate',name:'a',instructions:'x'}]),(e:unknown)=>e instanceof DecisionError && e.transient);
  assert.equal(calls.length,2);
});

test('Doubao System One multimodal: sends state array with image_url + detail high and logs placeholder',async()=>{
  const doubao: DecisionModel = {id:'looprouter-doubao-seed-2-1-lite',channel:'looprouter-systemone-multimodal',model:'doubao-seed-2-1-lite-260915',workspace_id:'',enabled:1,timeout_ms:5000,priority:4,last_test:null,updated_at:now};
  const calls = stub(()=>new Response(JSON.stringify({answers:{
    has_ip:{type:'noul',noul:0.96},
    cat:{type:'choice',choice:'抱枕',probabilities:{抱枕:0.92,其他:0.08}},
  }}),{status:200}));
  const logs: any[] = [];
  const res = await askModel(
    doubao,
    {...content,images:[{dataUrl:'data:image/png;base64,BBBB',placeholder:'[IMG:1]'}]},
    [{type:'predicate',name:'has_ip',instructions:'是否含版权角色'},{type:'choice',name:'cat',instructions:'品类',choices:['抱枕','其他']}],
    e=>logs.push(e),
  );
  assert.equal(calls[0].url,'https://api.looprouter.com/v1/systemone');
  assert.equal(Array.isArray(calls[0].body.state),true);
  assert.equal(calls[0].body.state[0].type,'text');
  assert.equal(calls[0].body.state[1].type,'image');
  assert.equal(calls[0].body.state[1].image_url,'data:image/png;base64,BBBB');
  assert.equal(calls[0].body.state[1].detail,'high');
  assert.equal(logs[0].request_body.state[1].image_url,'[IMG:1]');
  assert.deepEqual(res.answers[0],{type:'predicate',name:'has_ip',probability:0.96});
  assert.equal(res.answers[1].confidence,0.92);
});
