import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// 使用独立临时目录测试 SQLite 配置版本与回滚，不污染业务数据库
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-engine-test-'));
process.env.DATA_DIR = tmpDir;

import {
  DEFAULT_INTENT_CONFIG,
  getActiveIntentConfig,
  publishIntentConfigVersion,
  recognizeUserIntent,
  resolveIntentRouting,
  rollbackIntentConfigVersion,
  shouldUseVisionChannel,
} from '../src/server/intent-engine';
import { listScenes } from '../src/server/db';
import { missingConstraints, parseModelOutput } from '../src/server/validation';

test('five specialized scene templates are pre-seeded automatically', () => {
  const scenes = listScenes();
  assert.equal(scenes.length, 5);
  for (const s of scenes) {
    assert.ok(s.rules.trim().length > 20, `scene ${s.id} should have non-empty default rules`);
    assert.ok(s.fallback_scene.trim().length >= 15, `scene ${s.id} should have non-empty fallback`);
  }
});

test('on-demand vision channel triggers only when reference images lack clear text instructions', () => {
  const cfg = DEFAULT_INTENT_CONFIG;
  // 无参考图一律不走看图
  assert.equal(shouldUseVisionChannel({ text: '' }, cfg), false);
  assert.equal(shouldUseVisionChannel({ text: '做同款' }, cfg), false);
  // 有参考图 + 空文本或泛指词 -> 触发按需看图
  assert.equal(shouldUseVisionChannel({ text: '', context: { reference_images: ['https://example.com/a.jpg'] } }, cfg), true);
  assert.equal(shouldUseVisionChannel({ text: '做同款', context: { reference_images: ['https://example.com/a.jpg'] } }, cfg), true);
  assert.equal(shouldUseVisionChannel({ text: '优化一下', context: { reference_images: ['https://example.com/a.jpg'] } }, cfg), true);
  // 有参考图 + 明确长句重拍或明确去水印短指令 -> 走常态纯文本极速通道
  assert.equal(
    shouldUseVisionChannel(
      { text: '保留床品花色不变，把背景换成阳光法式卧室', context: { reference_images: ['https://example.com/a.jpg'] } },
      cfg,
    ),
    false,
  );
  assert.equal(
    shouldUseVisionChannel({ text: '去水印', context: { reference_images: ['https://example.com/a.jpg'] } }, cfg),
    false,
  );
});

test('entry routing dynamically dispatches on general entries and reports conflicts on dedicated pages', () => {
  const cfg = DEFAULT_INTENT_CONFIG;
  // 综合入口自动按动作路由
  assert.deepEqual(resolveIntentRouting(undefined, 'local_edit', '去掉右下角水印', cfg), {
    routedSceneId: 'local-edit',
    entryConflict: null,
  });
  assert.deepEqual(resolveIntentRouting('home', 'pattern_design', '蓝白小碎花无缝平铺图案', cfg), {
    routedSceneId: 'pattern-layout',
    entryConflict: null,
  });
  // 专用工具页保持工具规则并捕获冲突
  const modelConflict = resolveIntentRouting('model-gen', 'text_to_image', '纯白底抱枕静物，不要任何人物', cfg);
  assert.equal(modelConflict.routedSceneId, 'model-gen');
  assert.match(modelConflict.entryConflict || '', /真人模特生成/);
});

test('empty request without text or images falls back safely while non-empty text goes to model', async () => {
  const res = await recognizeUserIntent({ text: '' }, { kind: 'test', recordLog: false });
  assert.equal(res.channel, 'rule_fast');
  assert.equal(res.input_state, 'fallback');
});

test('intent config versioning supports publishing and instant rollback', () => {
  const initial = getActiveIntentConfig();
  assert.equal(initial.version, 1);

  const modified = {
    ...structuredClone(initial.config),
    categories: [...initial.config.categories, { name: '凉席蚊帐', description: '冰丝席与蚊帐', enabled: true }],
  };
  const v2 = publishIntentConfigVersion(modified, '新增夏季凉席蚊帐品类');
  assert.equal(v2.version, 2);
  assert.equal(getActiveIntentConfig().version, 2);
  assert.equal(getActiveIntentConfig().config.categories.some((c) => c.name === '凉席蚊帐'), true);

  const rolled = rollbackIntentConfigVersion(1);
  assert.equal(rolled.version, 1);
  assert.equal(getActiveIntentConfig().version, 1);
  assert.equal(getActiveIntentConfig().config.categories.some((c) => c.name === '凉席蚊帐'), false);
});

test('markdown fenced JSON and material synonyms are accepted without false retries', () => {
  const fencedJson = '```json\n{"status":"enhanced","intent_category":"床品","prompt":"白色100支长绒棉床品套件铺在阳光卧室大床上，面料细腻柔和。","negative_prompt":"","preserved_constraints":[],"assumptions":[],"conflicts":[],"user_notice":""}\n```';
  const parsed = parseModelOutput(fencedJson);
  assert.equal(parsed.status, 'enhanced');
  // 用户写“纯棉四件套”，模型写“长绒棉床品套件”，同义词匹配通过不报遗漏
  assert.deepEqual(missingConstraints({ text: '白色纯棉四件套' }, parsed), []);
});
