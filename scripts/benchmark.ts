import { db, getActivePrompt, listModels } from '../src/server/db';
import { BENCHMARK_CASES } from '../src/shared/benchmark-cases';
import { enhance } from '../src/server/enhance';
import { hasProviderKey } from '../src/server/providers';

const repetitions = Number(process.argv.find(arg=>arg.startsWith('--repeats='))?.split('=')[1]||10);
if (!Number.isInteger(repetitions) || repetitions<1 || repetitions>30) throw new Error('--repeats 必须为 1～30');
const modelFilter = process.argv.find(arg=>arg.startsWith('--model='))?.slice('--model='.length);

const cases = BENCHMARK_CASES;
const versionArg = process.argv.find(arg=>arg.startsWith('--version='))?.split('=')[1];

function percentile(values:number[],p:number) {
  if (!values.length) return null;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(p*sorted.length)-1];
}

async function main() {
  const models=listModels().filter(m=>m.enabled&&hasProviderKey(m.provider)&&(!modelFilter||m.id===modelFilter));
  if (!models.length) throw new Error('没有已配置密钥且启用的模型；请先填写 .env');
  const version=versionArg?Number(versionArg):getActivePrompt().version;
  if (!db().prepare('SELECT 1 FROM prompt_versions WHERE version=?').get(version)) throw new Error(`提示词版本 V${versionArg} 不存在`);
  console.log(`基准测试：提示词 V${version}，${cases.length} 个案例 × 每模型 ${repetitions} 轮。样本按模型串行执行。`);
  for (const model of models) {
    const samples:Array<{ms:number;upstreamMs:number;status:string;prompt:string;inputTokens:number|null;outputTokens:number|null}> = [];
    const failures:Array<{caseName:string;code:string}> = [];
    for (let i=0;i<repetitions;i++) {
      for (const example of cases) {
        try {
          const run=await enhance({text:example.text,context:{scene:'家纺电商图'}},{kind:'benchmark',modelId:model.id,promptVersion:version});
          samples.push({ms:run.metrics.total_ms,upstreamMs:run.metrics.upstream_ms,status:run.result.status,prompt:run.result.prompt,inputTokens:run.metrics.input_tokens,outputTokens:run.metrics.output_tokens});
        } catch (error) {
          failures.push({caseName:example.name,code:error instanceof Error?error.message:'UNKNOWN'});
        }
      }
    }
    const summary={model_id:model.id,provider:model.provider,model:model.model,success:samples.length,total:cases.length*repetitions,
      p50_ms:percentile(samples.map(s=>s.ms),.5),p95_ms:percentile(samples.map(s=>s.ms),.95),
      p50_upstream_ms:percentile(samples.map(s=>s.upstreamMs),.5),p95_upstream_ms:percentile(samples.map(s=>s.upstreamMs),.95),
      example_output:samples[0]?.prompt||null,failures:failures.slice(0,10)};
    console.log(JSON.stringify(summary,null,2));
  }
}

void main().catch(error=>{console.error(error instanceof Error?error.message:'基准测试失败');process.exitCode=1;});
