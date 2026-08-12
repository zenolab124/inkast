# Inkast 本机生图 API — Skill 接入手册

本机 Inkast API 常驻运行（launchd 开机自启），供 Claude Code skill 或其他本地 Agent 调用。

**Base URL**: `http://localhost:21731`

---

## 快速验证

```bash
curl http://localhost:21731/api/health
# → {"status":"ok","service":"inkast-api","version":"0.0.1"}
```

服务挂了可手动拉起：`launchctl kickstart gui/$(id -u)/com.inkast.api`

---

## 核心工作流

两种用法，按需选择：

### 方式 A：散文直出图（最简，2 步）

1. **散文 → 结构化 prompt**：`POST /api/draft-prompt`
2. **结构化 prompt → 图**：`POST /api/jobs/generate` + 轮询 `GET /api/jobs/:id`

### 方式 B：自己构造 prompt（跳过 LLM，1 步）

直接构造 `ImagePrompt` JSON → `POST /api/jobs/generate`

---

## 端点详解

### 1. POST /api/draft-prompt

散文描述 → 结构化 JSON prompt + 消歧义建议。

**请求**

```json
{
  "input": "一只橘猫趴在旧书堆上午睡，阳光从窗户洒进来",
  "lang": "zh",
  "backend": "claude-code"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `input` | string | **是** | 用户的自然语言描述 |
| `lang` | `"zh"` \| `"en"` | 否 | 输出语言，默认 `"zh"` |
| `backend` | string \| object | 否 | LLM 后端，默认 `"claude-code"`（本机 SDK） |

**响应 200**

```json
{
  "prompt": {
    "type": "photography",
    "style": "warm film photography with soft natural lighting",
    "subject": "一只橘色虎斑猫趴在一摞旧精装书上打瞌睡...",
    "background": "复古书房，木质书架...",
    "lighting": "afternoon golden hour, warm window light with dust motes",
    "mood": "peaceful, nostalgic, cozy",
    "color_palette": ["warm amber", "cream", "dusty brown", "soft orange"]
  },
  "hints": [
    { "field": "camera", "suggestion": "是否需要特定视角？比如俯拍、平视或微距特写" },
    { "field": "layout", "suggestion": "画面构图偏好？比如三分法、居中对称" }
  ],
  "_meta": {
    "backend": "claude-code",
    "durationMs": 3200
  }
}
```

**错误**

| 状态码 | 含义 |
|---|---|
| 400 | 参数错误（input 为空、backend 格式错） |
| 401 | LLM 未认证（ClaudeCode OAuth 过期） |
| 429 | LLM 限速 |
| 504 | LLM 超时 |

---

### 2. POST /api/jobs/generate

异步提交生图任务，立即返回 `jobId`，后台执行。

**请求**

```json
{
  "prompt": {
    "type": "photography",
    "style": "warm film photography",
    "subject": "一只橘猫趴在旧书堆上午睡"
  },
  "size": "1024x1024",
  "quality": "high"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `prompt` | ImagePrompt | **是** | 结构化 prompt（至少含 type/style/subject） |
| `size` | string | 否 | `"auto"` / `"ratio:W:H"` / `"WxH"`，默认 `"1024x1024"` |
| `quality` | string | 否 | `"low"` / `"medium"` / `"high"`，默认 `"high"` |
| `format` | string | 否 | `"png"` / `"jpeg"` / `"webp"`，默认 `"png"` |
| `rawPrompt` | string | 否 | 设置后直接用这段文字发给生图模型，跳过 JSON 序列化 |
| `referenceImages` | array | 否 | 参考图，最多 16 张（见下方） |
| `prose` | string | 否 | 原始散文（用于历史记录展示） |
| `aiFilledFields` | string[] | 否 | LLM 填充的字段名（用于 UI 标记） |
| `bypassModeration` | boolean | 否 | 跳过内容审查切换逻辑 |

**参考图格式**

```json
// 引用已有生成（后端从磁盘读取，无需传输图片字节）
{ "kind": "generation", "generationId": "<generation-id>" }

// 上传新图（base64 编码的原始字节）
{ "kind": "upload", "mimeType": "image/png", "dataBase64": "<base64>" }
```

上限 `MAX_REFERENCE_IMAGES = 16` 张。

**参考图对后端行为的影响**

后端根据 provider 的 `mode`（`images` / `responses` / `c2i-tasks` / `seedream`）和参考图数量自动选择上游端点：

| 条件 | 上游端点 | 说明 |
|---|---|---|
| 无参考图 + images 模式 | `/v1/images/generations` | 纯文生图 |
| 1 张参考图 + images 模式 | `/v1/images/edits` | SDK `images.edit()`，参考图以 multipart/form-data 上传 |
| >1 张参考图 + images 模式 | **报错** | images.edit 只支持单图，提示切换到 responses 或 c2i-tasks 模式 |
| 任意数量参考图 + responses 模式 | `/v1/responses` | 每张参考图编码为 `data:<mime>;base64,...` 的 `input_image` content part |
| 无参考图 + responses 模式 | `/v1/responses` | prompt 作为纯文本 input 传入 |
| 有参考图 + c2i-tasks 模式 | `/api/image-tasks/edits` | 异步任务 API（chatgpt2api），原生多参考图 |
| 无参考图 + c2i-tasks 模式 | `/api/image-tasks/generations` | 异步任务 API，纯文生图 |
| 任意数量参考图 + seedream 模式 | `/api/v3/images/generations` | 火山方舟 Seedream JSON API；参考图放在 `image[]`，原生支持多参考图 |
| 无参考图 + seedream 模式 | `/api/v3/images/generations` | 火山方舟 Seedream 文生图；默认请求 2K、单图、base64 返回且关闭上游可见水印 |

Skill 侧不需要关心这些细节——只管传 `referenceImages` 数组，后端自动路由。

**c2i-tasks 模式说明**

c2i-tasks 是针对 chatgpt2api 自定义异步任务 API 的专用模式。与 images/responses 模式（同步等待结果）不同，c2i-tasks 模式采用「提交 → 轮询」流程：

1. 后端向 chatgpt2api 的 `/api/image-tasks/edits`（有参考图）或 `/api/image-tasks/generations`（无参考图）提交任务
2. 拿到 `taskId` 后自动轮询 `/api/image-tasks?ids=<taskId>`（3s 起步，逐步退避至 15s）
3. 任务成功后提取 base64 图片返回；超时或失败则走池遍历的正常 fallover 逻辑

对 Skill 调用方完全透明——请求和响应格式与其他模式一致，只是内部走的上游端点不同。

多参考图传法（和其他模式相同）：

```json
{
  "prompt": { "type": "illustration", "style": "...", "subject": "把这几张图合成一张海报" },
  "referenceImages": [
    { "kind": "generation", "generationId": "<id-1>" },
    { "kind": "generation", "generationId": "<id-2>" },
    { "kind": "upload", "mimeType": "image/png", "dataBase64": "<base64>" }
  ],
  "size": "1024x1536",
  "quality": "high"
}
```

c2i-tasks 模式下参考图无数量限制（images 模式限 1 张，responses 模式上限 16 张）。后端会将每张参考图编码为 `data:<mime>;base64,...` 格式放入 JSON body 的 `images` 数组，由 chatgpt2api 负责上传到 ChatGPT 后端。

**Seedream 模式说明**

Seedream provider 的 Base URL 使用 `https://ark.cn-beijing.volces.com/api/v3`，模型由 provider 配置决定（当前推荐 `doubao-seedream-4-5-251128`）。它不使用 OpenAI 的 `/images/edits`：文生图、单参考图和多参考图都走 `/images/generations`，参考图以 data URL 放进 `image` 数组。`ratio:*` 会转成提示词中的目标比例并请求 2K，显式 `WxH` 则原样传给上游。

**响应 200**

```json
{ "jobId": "job_xxxxxx", "status": "pending" }
```

---

### 3. GET /api/jobs/:id

轮询任务状态。建议间隔 2 秒。

**响应 200**

```json
{
  "id": "job_xxxxxx",
  "kind": "image_generate",
  "status": "succeeded",
  "promptSnapshot": { "type": "...", "style": "...", "subject": "..." },
  "promptText": "...",
  "isRaw": false,
  "size": "1024x1024",
  "quality": "high",
  "generationId": "gen_yyyyyy",
  "attempts": [
    {
      "providerId": "p1",
      "providerName": "some-provider",
      "ok": true,
      "durationMs": 12500
    }
  ],
  "errorCode": null,
  "errorMessage": null,
  "providerId": "p1",
  "providerName": "some-provider",
  "createdAt": 1718500000000,
  "startedAt": 1718500000100,
  "completedAt": 1718500012600
}
```

**status 枚举**

| 值 | 含义 | 下一步 |
|---|---|---|
| `pending` | 排队中 | 继续轮询 |
| `running` | 生图中 | 继续轮询 |
| `succeeded` | 完成，`generationId` 已填充 | 用 generationId 取图 |
| `failed` | 失败，见 `errorCode` / `errorMessage` | 展示错误或重试 |

---

### 4. GET /api/generations/:id/image

获取生成的图片字节。

- 有 R2 URL 时：**302 重定向**到 CDN
- 仅本地时：**200** 直接返回图片字节，`Content-Type` 为 `image/png` / `image/jpeg` / `image/webp`

```bash
# 下载到文件
curl -L http://localhost:21731/api/generations/<id>/image -o output.png
```

**错误**

| 状态码 | 含义 |
|---|---|
| 404 | generation 不存在 |
| 410 | 记录存在但磁盘文件丢失 |

---

## ImagePrompt 完整 Schema

```typescript
interface ImagePrompt {
  type: string;          // 必填 — 图像类型：photography / illustration / 3d-render / ...
  style: string;         // 必填 — 风格描述
  subject: string;       // 必填 — 主体描述
  background?: string;   // 背景/环境
  layout?: string;       // 构图/布局
  text_elements?: TextElement[];  // 画面内文字
  lighting?: string;     // 光照
  mood?: string;         // 氛围/情绪
  camera?: string;       // 镜头/视角
  color_palette?: string[];  // 色彩方案
  count?: number;        // 主体数量
  [extra: string]: unknown;  // 可扩展
}

interface TextElement {
  content: string;
  position?: string;
  font?: string;
  color?: string;
  size?: string;
}
```

---

## 完整示例：散文到图

```bash
# 1. 散文 → 结构化 prompt
DRAFT=$(curl -s http://localhost:21731/api/draft-prompt \
  -H 'Content-Type: application/json' \
  -d '{"input":"赛博朋克风格的东京街头，雨夜，霓虹灯倒映在积水中","lang":"zh"}')

# 提取 prompt 部分
PROMPT=$(echo "$DRAFT" | jq '.prompt')

# 2. 提交生图任务
JOB=$(curl -s http://localhost:21731/api/jobs/generate \
  -H 'Content-Type: application/json' \
  -d "{\"prompt\":$PROMPT,\"size\":\"1024x1536\",\"quality\":\"high\"}")

JOB_ID=$(echo "$JOB" | jq -r '.jobId')

# 3. 轮询等待完成
while true; do
  STATUS=$(curl -s http://localhost:21731/api/jobs/$JOB_ID)
  S=$(echo "$STATUS" | jq -r '.status')
  [ "$S" = "succeeded" ] && break
  [ "$S" = "failed" ] && { echo "FAILED: $(echo $STATUS | jq -r '.errorMessage')"; exit 1; }
  sleep 2
done

# 4. 下载图片
GEN_ID=$(echo "$STATUS" | jq -r '.generationId')
curl -L http://localhost:21731/api/generations/$GEN_ID/image -o result.png
```

---

## 常用尺寸速查

| 方向 | 比例 | 推荐尺寸（广泛兼容） |
|---|---|---|
| 方形 | 1:1 | `1024x1024` ★ |
| 横版 | 3:2 | `1536x1024` ★ |
| 竖版 | 2:3 | `1024x1536` ★ |
| 横版 | 16:9 | `1920x1080` |
| 竖版 | 9:16 | `1080x1920` |
| 自动 | — | `auto`（模型自选） |

★ = 几乎所有 OpenAI 兼容 provider 都支持

---

## 注意事项

- **生图耗时** 10-30 秒，取决于 provider 和队列
- **provider 池自动故障切换**：一个 provider 失败会自动尝试下一个
- **内容审查失败会触发 LLM 重写链**（最多 4 轮递进降级），无需 skill 侧处理
- **无鉴权**：localhost 直连，不需要 token
- draft-prompt 的 `hints` 字段包含消歧义建议，skill 可选择性地用这些来追问用户
