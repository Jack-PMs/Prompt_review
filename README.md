# 提示词强化服务与管理台

Next.js 服务，SQLite（WAL）存储配置与调用记录。

线上提示词审核功能的开发要求见 [HTML 需求文档 V1.5](docs/prompt-review-prd.html)，内容源文件为 [Markdown](docs/prompt-review-prd.md)，实际模型请求及原始响应为 [JSON](docs/prompt-review-model-api-cases.json)。HTML 可直接用浏览器打开。修改源文件后执行 `node scripts/build-review-prd-html.mjs` 更新 HTML。以下内容说明本地原型的当前行为。

## 启动

Node.js 20.9+。复制 `.env.example` 为 `.env`，填写 `ENHANCE_API_KEY`（≥16 字符）和要用的渠道密钥。

```bash
npm install
npm run dev        # http://127.0.0.1:6770/admin
npm run build && npm run start   # 生产
```

生产环境：HTTPS 反向代理，设置 `APP_ORIGIN=https://你的域名`，`DATA_DIR` 指向持久化磁盘。

## 管理台

- 无登录，仅允许 `ADMIN_ALLOWED_HOSTS` 中的主机（默认 `127.0.0.1`、`localhost`、`::1`）。审计记录操作人统一为 `admin`。
- **总览**：线上近 7 天调用量、出稿率、耗时、结果分布、失败原因、采纳率、按场景统计；生效版本的基准评测；按实际配置计算的上线检查。
- **系统提示词**：新建版本、测试、发布，历史版本可重新激活；每个版本显示基准样本数与成功率。
- **模型与渠道**：启停、超时、最大输出量；显示密钥变量名及是否已配置。
- **使用场景**：按网站入口区分的附加规则与兜底稿，见下节。
- **测试台**：同案例、同提示词版本对比模型；可对任意版本（含草稿）运行标准基准。
- **运行记录**：每次调用的场景、模型、结果、重试与切换情况；基准 p50/p95。线上调用只存元数据。
- **变更审计**：配置变更记录。
- **设置**：默认模型、备用模型、兜底提示词。

## 模型与密钥

| 后台模型 | 渠道 | 密钥变量 |
|---|---|---|
| `qwen-flash` | 阿里百炼 | `DASHSCOPE_API_KEY` |
| `gpt-luna`、`deepseek-flash` | API易 | `APIYI_API_KEY` |
| `gemini-flash-lite` | BananaRouter | `BANANA_ROUTER_API_KEY` |
| `runninghub-qwen`、`runninghub-deepseek` | RunningHub | `RUNNINGHUB_API_KEY` |

已启用：`qwen-flash`、`gpt-luna`、`gemini-flash-lite`、`runninghub-deepseek`。`deepseek-flash`、`runninghub-qwen` 批量测试出现无效 JSON，已停用。评测数据见 [docs/model-research.md](docs/model-research.md)。改密钥后需重启服务。

## 使用场景

网站调用时在 `context.entry` 传场景标识，服务端按场景处理：

- **附加规则**：追加到系统提示词末尾；留空时只告知模型场景名。
- **兜底稿**：无视觉线索时使用；留空则用「运行设置」里的默认可用提示词。
- 不传 `entry` 按全局默认处理；标识不存在或已停用返回 `400 INVALID_SCENE`。

预置场景（规则与兜底稿为空，需在管理台填写）：

| 标识 | 名称 |
|---|---|
| `home` | 首页 |
| `product-reshoot` | 产品重拍 |
| `local-edit` | 局部编辑 |
| `pattern-layout` | 花型排版 |
| `model-gen` | 真人模特生成 |

工具箱的其他工具在管理台「使用场景」里添加。标识只能用小写字母、数字和连字符，创建后不可改。

## 强化稿格式

`result.prompt` 为分段字段文本，服务端会统一整理模型输出：

```text
[主体]
产品：米色亚麻抱枕；
材质：保留天然亚麻纹理。

[场景]
环境：摆放在客厅沙发上；
光线：柔和自然侧光。

[限制]
避免：画面文字。
```

- 标题独占一行；字段用中文冒号，段内非末行以分号结尾，末行以句号结尾，段间空一行。
- 只有画面中要绘制的文字加中文引号，如 `文字：写上“晚安”。`。「不要显示“晚安”字样」不加引号；「不要文字，但写上“晚安”」表达为避免其他文字。
- 用户排除项同时写进 `[限制]` 段和 `negative_prompt`。

## 处理流程

1. 意图识别（运行设置可选「Decisions」或「规则」，默认 Decisions）：经 LoopRouter `/v1/decisions` 一次判断「有没有画面、是否太含糊、品类、用途、是否要画文字、是否有排除项」，与输入审核同时进行。没有画面 → 兜底稿；太含糊 → `needs_clarification`（已识别品类时不再追问品类）；两者都不调用生成模型。品类等结果作为 `recognized_intent` 提示交给强化模型，并在 `result.intent` 返回。识别失败时退回规则判断，不影响出稿；纯数字、乱码等规则能判定的输入不调用识别。
2. 输入审核与强化模型同时调用，以输入审核结论为准。
3. 模型输出无效或遗漏明确约束时重试一次。
4. 强化稿再经输出审核。

**备用模型**（运行设置中配置，默认不使用）：线上请求的默认模型超时、报错、限流或缺少密钥时，改用备用模型重试一次；审核模型不可用时也由备用模型审核。测试台指定了模型，不切换强化模型。

审核模型默认 `qwen-flash`，可用 `CONTENT_REVIEW_MODEL_ID` 指定。审核模型和备用模型都不可用时返回 `503 CONTENT_REVIEW_UNAVAILABLE`，不跳过审核。文字与参考图审核均包含 `copyright_ip`：钢铁侠、草莓熊等可识别的第三方角色按平台规则要求修改，返回 `needs_revision` 和改用原创角色的建议；图片命中时提示更换参考图。参考图由识图模型审核，见「参考图」一节。

## API

`POST /api/v1/enhancements`，请求头 `Authorization: Bearer <ENHANCE_API_KEY>`，仅供网站后端调用。

```json
{
  "text": "米色亚麻抱枕，不要文字",
  "context": {
    "scene": "家纺电商图",
    "style": "简约自然",
    "template": "可选模板文本",
    "target_image_model": "可选生图模型",
    "aspect_ratio": "1:1",
    "reference_summary": "可选：参考图摘要",
    "reference_role": "style",
    "negative_constraints": ["不要人物"],
    "entry": "product-reshoot",
    "reference_images": ["https://cdn.example.com/ref.jpg", "data:image/jpeg;base64,..."]
  }
}
```

### 参考图

`context.reference_images`：最多 3 张，每项为公网可访问的 http(s) 图片链接，或 `data:image/(png|jpeg|webp|gif);base64,...`（单张 ≤ 5 MB）。`reference_role` 决定识图关注点：`content` 主体（默认）、`style` 风格、`composition` 构图。

- 识图模型先审核图片并按用途写出描述，与文字审核同时进行；描述作为文字交给强化模型，图片本身不发给强化模型和文字审核，也不保存。
- 图片违规返回 `needs_revision`，`revision_guidance` 提示更换参考图；识图模型与识图备用模型都不可用时返回 `503 REFERENCE_IMAGE_UNAVAILABLE`，不跳过审核。
- 成功时 `result.reference_analysis` 为识图描述；`metrics` 含 `image_count`、`vision_ms`、`vision_model_id`。
- 识图模型在「运行设置」配置，默认 `qwen-flash`，备用 `gemini-flash-lite`（两者均已实测可通过各自渠道读取 base64 与图片链接）。图片链接需模型渠道能直接访问，链接方式通常比 base64 慢几秒。

成功返回 `request_id`、`model_id`、`prompt_version`、`result`、`metrics`。

`result` 字段：`status`、`can_generate`、`prompt`、`negative_prompt`、`preserved_constraints`、`assumptions`、`conflicts`、`user_notice`。

| `status` | `can_generate` | 说明 |
|---|---|---|
| `enhanced` | true | 正常强化稿 |
| `fallback` | true | 无视觉线索，返回默认场景稿 |
| `needs_revision` | false | 未通过审核，`prompt` 为空，`revision_guidance` 列出问题与改法 |
| `needs_clarification` | false | 输入含糊，`prompt` 为空，`clarification_guidance` 列出需补充的要点 |

前端只在 `can_generate=true` 时进入生图流程。

`metrics`：强化与审核各自的调用次数和耗时，以及强化模型的 Token 用量。失败返回 `error.code`、`error.message`、`error.request_id` 和对应 HTTP 状态码。

**反馈**：`POST /api/v1/enhancements/{request_id}/feedback`，请求体 `{"action":"accepted"|"edited"|"rejected"}`，同一密钥，保留最新一次。

**限流**：两个接口按密钥共享，默认每分钟 60 次，用 `ENHANCE_RATE_LIMIT_PER_MIN` 调整。

## 基准测试

```bash
npm run benchmark -- --repeats=10                          # 5 个案例 × 10 轮，测所有已启用且有密钥的模型
npm run benchmark -- --repeats=10 --model=runninghub-deepseek   # 只测一个模型
npm run benchmark -- --repeats=6 --version=4                     # 测指定提示词版本（默认测生效版本）
```

输出 p50/p95、成功率和示例强化稿。也可在管理台测试台运行（每模型 1/3/6 轮）。调用真实模型，产生费用。每个模型在某版本下少于 30 条样本时，总览和发布时会提示样本不足。

## 校验

```bash
npm run typecheck
npm test
npm run build
npm run verify:moderation   # 真实审核模型，产生费用
npm run verify:copyright    # 版权角色及原创/排除描述，两套审核流程，产生费用
```

## 内容审核（Decisions）

管理台「内容审核」分组：审核工作台、审核记录、审核规则。与提示词强化相互独立。

**模式**：`REVIEW_PROVIDER_MODE=live` 时经 LoopRouter 调用 `POST https://api.looprouter.com/v1/decisions`（模型 `gpt-6-luna`，密钥 `LOOPROUTER_API_KEY`）；`mock` 时只对工作台里的 4 个固定演示样本返回模拟数据。

**流程**：提示词与每张参考图各为一个审核单元，分别调用 Decisions（每条规则一个 predicate 问题）→ 严格校验答案（拒答、缺题、重名、类型或概率错误都记为未判定，概率留空，不补 0）→ 服务端给出结论。

**结论只有放行和拦截**
- 任一规则在任一审核单元达到拦截阈值即拦截，单元之间不取平均。
- 涉政只打话题标签，不拦截；“证据充分”低于阈值只标记“内容不够清晰”。
- 版权角色规则 `IP-001` 对每个审核单元都必须取得有效答案；拒答、超时、缺题等未完成检查时暂不放行，原因记为 `IP_CHECK_INCOMPLETE`。整体执行失败也不授予生成许可。其他规则未判定时保留既有处理与失败原因。

**规则**（拦截阈值默认 0.5）：版权角色 / IP、露骨色情、性暗示、涉政话题（只打标签）、中国政治（涉及即拦截，含领导人及其影射、政党与国家标识、政策与政治事件、领土与民族宗教议题；`content-policy-v2` 起新增）、针对性辱骂、指定对象侮辱（未配置对象资料时不适用）、暴力煽动、证据充分。修改规则会生成新版本并启用，历史版本与审核记录不变。

`IP-001` 限制生成或参考图中的可识别第三方角色，包括钢铁侠、草莓熊及其别名、标志性造型；单独输入角色名也视为生成要求，改名换色或自称授权不能豁免。通用原创小熊、机械角色和明确排除该角色的描述不因通用词被拦截。这是平台生成规则，不是侵权法律认定。升级会在现有规则上创建并启用新版本，保留自定义配置与历史记录；旧的放行记录需重新提交才能按新规则判定。

**API 调用记录**：每次发往 Decisions 的请求都会保存（含重试），在审核结果和审核记录详情的「API 调用」里查看：地址、请求头（密钥打码为 `Bearer ***`）、完整请求体、HTTP 状态、原始响应与耗时。图片的 base64 在记录中替换为 `[IMAGE:素材ID] …` 占位；「复制为 cURL」会取回原图填入，可直接重放（需在终端设置 `LOOPROUTER_API_KEY`）。模拟模式记录本应发出的请求和模拟响应，并标为“未发送”。也可通过 `GET /api/review/tasks/{id}` 的 `api_calls` 字段读取。

**其他**
- 提交接口拒绝客户端传入 `stage`、`action`、`policy_version` 等字段（422）；支持 `Idempotency-Key`（同键不同内容返回 409）。
- 图片按文件头识别真实格式，校验大小与像素，存于 `DATA_DIR/private_media`，只能经管理台接口查看。
- 任务状态存数据库，单 Worker 顺序执行；服务重启后会重新领取中断的任务。

**已验证**：真实接口连通及答案结构；文本与图片输入；涉政只打标签；拒答、限流、缺密钥、重复提交与重启恢复等路径（异常路径用模拟网络验证）。

**尚未实现或未验证**：视频审核（抽帧、音轨、OCR、ASR）；生成后审核与发布、下载许可；多用户与角色隔离；指定对象资料管理；对网站开放的外部接口；真实模型在违规样本上的准确率与阈值是否合适。
