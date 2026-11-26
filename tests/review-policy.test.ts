import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { db, getSetting, setSetting } from '../src/server/db';
import { DEFAULT_RULES } from '../src/server/review/policy';
import { activePolicy, getTask, overrideTaskAction, reviewDb, taskApiCalls, taskSignals } from '../src/server/review/store';
import { createTask, processTask } from '../src/server/review/runner';

// This file runs in its own test process. Never read/write the development database or call a provider.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'copyright-review-'));
process.env.DATA_DIR = dataDir;
process.env.REVIEW_PROVIDER_MODE = 'live';
process.env.LOOPROUTER_API_KEY = 'test-key-not-a-real-credential';
const originalFetch = globalThis.fetch;
globalThis.fetch = (async()=>{throw new Error('Unexpected network request');}) as typeof fetch;
after(()=>{globalThis.fetch=originalFetch;db().close();fs.rmSync(dataDir,{recursive:true,force:true});});

test('existing policy gains IP restriction once while preserving custom rules and history',()=>{
  const conn = db();
  conn.exec(`CREATE TABLE review_policy_versions (
    version TEXT PRIMARY KEY, rules_json TEXT NOT NULL, note TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
  const legacy = DEFAULT_RULES.filter(rule=>rule.rule_id!=='IP-001').map(rule=>rule.rule_id==='VIO-001'?{...rule,threshold:0.73,instructions:'运营自定义规则'}:rule);
  const oldJson = JSON.stringify(legacy);
  conn.prepare('INSERT INTO review_policy_versions VALUES (?,?,?,?,?)').run('legacy-policy',oldJson,'旧策略','admin',new Date().toISOString());
  setSetting('review_active_policy','legacy-policy');
  setSetting('review_rule_cn_pol_added','1');
  const policy = activePolicy();
  assert.notEqual(policy.version,'legacy-policy');
  assert.equal(policy.rules.find(rule=>rule.rule_id==='IP-001')?.threshold,0.5);
  assert.deepEqual(
    policy.rules.find(rule=>rule.rule_id==='VIO-001'),
    {...legacy.find(rule=>rule.rule_id==='VIO-001')!,absolute_threshold:0.85},
  );
  const old = conn.prepare('SELECT rules_json FROM review_policy_versions WHERE version=?').get('legacy-policy') as {rules_json:string};
  assert.equal(old.rules_json,oldJson);
  const count = conn.prepare('SELECT COUNT(*) AS n FROM review_policy_versions').get();
  reviewDb();activePolicy();
  assert.deepEqual(conn.prepare('SELECT COUNT(*) AS n FROM review_policy_versions').get(),count);
  assert.equal(getSetting('review_rule_copyright_added'),'1');
});

test('task pipeline persists copyright blocks and refuses missing IP answers',async()=>{
  for (const mode of ['hit','missing','safe'] as const) {
    let calls = 0;
    globalThis.fetch = (async(_url:unknown,init?:RequestInit)=>{
      calls++;
      const body = JSON.parse(String(init?.body)) as {questions:Array<{name:string}>};
      assert.ok(body.questions.some(question=>question.name==='copyright_character'));
      const answers = body.questions.filter(question=>mode!=='missing'||question.name!=='copyright_character').map(question=>({
        type:'predicate',name:question.name,
        probability:question.name==='evidence_sufficient'?0.99:question.name==='copyright_character'&&mode==='hit'?0.99:0.01,
      }));
      return new Response(JSON.stringify({answers}),{status:200});
    }) as typeof fetch;
    const {task_id} = createTask({prompt:mode==='safe'?'原创小熊抱枕':'钢铁侠'},null);
    assert.equal(getTask(task_id)!.action,'BLOCK');
    assert.equal(getTask(task_id)!.generation_eligible,0);
    await processTask(task_id);
    const task = getTask(task_id)!;
    assert.equal(calls,1);
    assert.equal(task.execution_status,'COMPLETE');
    assert.equal(task.action,mode==='safe'?'ALLOW':'BLOCK');
    assert.equal(task.violation_level,mode==='safe'?'NONE':mode==='hit'?'ABSOLUTE':'POSSIBLE');
    assert.equal(task.generation_eligible,mode==='safe'?1:0);
    const signal = taskSignals(task_id).find(signal=>signal.rule_id==='IP-001')!;
    assert.equal(signal.signal_status,mode==='missing'?'MISSING':'SUCCESS');
    if (mode==='missing') assert.ok(JSON.parse(task.reason_codes).includes('IP_CHECK_INCOMPLETE'));
    const log = taskApiCalls(task_id)[0];
    assert.equal(log.status,200);
    assert.equal(log.request_headers.Authorization,'Bearer ***');
  }
});

test('execution failure cannot grant permission without copyright review',async()=>{
  const {task_id} = createTask({prompt:'草莓熊'},null);
  reviewDb().prepare('UPDATE review_tasks SET policy_version=? WHERE id=?').run('missing-policy',task_id);
  await processTask(task_id);
  const task = getTask(task_id)!;
  assert.equal(task.execution_status,'FAILED');
  assert.equal(task.action,'BLOCK');
  assert.equal(task.generation_eligible,0);
});

test('管理员可将已拦截任务手动放行，并校验乐观锁 revision 防止并发覆盖',()=>{
  const {task_id} = createTask({prompt:'误拦测试提示词'},null);
  const before = getTask(task_id)!;
  assert.equal(before.action,'BLOCK');
  assert.equal(before.generation_eligible,0);

  const allowed = overrideTaskAction({
    id:task_id,
    action:'ALLOW',
    note:'人工复核属于正常设计需求',
    actor:'admin',
    expectedRevision:before.revision,
  });
  assert.equal(allowed.action,'ALLOW');
  assert.equal(allowed.violation_level,'NONE');
  assert.equal(allowed.execution_status,'COMPLETE');
  assert.equal(allowed.generation_eligible,1);
  assert.equal(allowed.decided_by,'admin');
  assert.equal(allowed.revision,before.revision+1);
  assert.ok((JSON.parse(allowed.reason_codes) as string[]).includes('MANUAL_ALLOW'));

  // 使用过期 revision 改判应被乐观锁拒绝
  assert.throws(
    ()=>overrideTaskAction({id:task_id,action:'BLOCK',expectedRevision:before.revision}),
    /已被其他人更新/,
  );

  // 使用最新 revision 可以改判回拦截
  const reBlocked = overrideTaskAction({id:task_id,action:'BLOCK',expectedRevision:allowed.revision});
  assert.equal(reBlocked.action,'BLOCK');
  assert.equal(reBlocked.violation_level,'ABSOLUTE');
  assert.equal(reBlocked.generation_eligible,0);
  assert.ok((JSON.parse(reBlocked.reason_codes) as string[]).includes('MANUAL_BLOCK'));
});
