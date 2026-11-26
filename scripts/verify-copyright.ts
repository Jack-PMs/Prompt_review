import { reviewContent } from '../src/server/moderation';
import { activePolicy } from '../src/server/review/store';
import { askLive } from '../src/server/review/decisions';
import { decide } from '../src/server/review/engine';
import type { Signal } from '../src/server/review/types';

// Real paid calls: verifies both independent Decisions review and enhancement's text review.
const cases = [
  {text:'钢铁侠',blocked:true},
  {text:'草莓熊',blocked:true},
  {text:'Iron Man',blocked:true},
  {text:'原创米色小熊玩偶，普通圆脸和棉麻质感，不模仿任何现有角色',blocked:false},
  {text:'原创机械战士，浅绿色陶瓷外壳，无标志，不模仿任何已有角色',blocked:false},
  {text:'原创米色小熊抱枕，不要钢铁侠或草莓熊，不要任何已有 IP 形象',blocked:false},
];

async function main() {
  const policy = activePolicy();
  let passed = 0;
  for (const item of cases) {
    try {
      const [answers,review] = await Promise.all([
        askLive({modality:'text',unit_id:'prompt',text:item.text},policy.rules.filter(rule=>rule.rule_id!=='SUBJECT-001')),
        reviewContent({text:item.text},'input'),
      ]);
      const signals: Signal[] = policy.rules.filter(rule=>answers.has(rule.name)).map(rule=>({
        unit_id:'prompt',rule_id:rule.rule_id,name:rule.name,...answers.get(rule.name)!,
      }));
      const result = decide({rules:policy.rules,signals,units:[{unit_id:'prompt',modality:'text',asset_id:null}]});
      const pass = result.action===(item.blocked?'BLOCK':'ALLOW') && review.decision===(item.blocked?'revise':'allow') &&
        (!item.blocked || result.reason_codes.includes('RULE_BLOCK:IP-001')&&review.categories.includes('copyright_ip'));
      if (pass) passed++;
      console.log(JSON.stringify({text:item.text,pass,policy:policy.version,action:result.action,reason_codes:result.reason_codes,
        copyright:answers.get('copyright_character'),enhancement_review:review.decision,categories:review.categories}));
    } catch (error) {
      console.log(JSON.stringify({text:item.text,pass:false,error:error instanceof Error?error.message:'验证失败'}));
    }
  }
  console.log(`版权角色真实调用验证：${passed}/${cases.length} 通过（两套审核流程）`);
  if (passed!==cases.length) process.exitCode = 1;
}

void main().catch(error=>{console.error(error instanceof Error?error.message:'验证失败');process.exitCode=1;});
