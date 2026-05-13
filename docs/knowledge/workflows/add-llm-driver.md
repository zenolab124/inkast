# 实现一个新 LLM Driver(为 Phase 1.5 OpenAI Chat 铺路)

Phase 1 只有 `claude-code` driver,`openai-compatible` 是占位。这个 workflow 描述加 OpenAI Chat driver 的步骤,这是 Phase 1.5 的入口工作。

## 步骤

1. **新文件 `apps/api/src/drivers/llm/openai-chat.ts`**
   - 实现 `LlmDriver` 接口(`backend` + `completeJson`)
   - 用 `openai` SDK(已装),`client.chat.completions.create({ model, messages, response_format })`
   - `response_format: { type: "json_schema", json_schema: { name: "...", schema: ..., strict: true } }`
2. **路由配置入口**
   - 从环境变量或 SQLite(新表 `llm_providers`?复用 `providers` 表?)读 base_url + key + model
   - Phase 1.5 决策:复用 image provider 表还是单独新表
3. **修改 `apps/api/src/drivers/llm/index.ts`**
   ```ts
   case "openai-compatible":
     driver = new OpenAIChatDriver();
     break;
   ```
   去掉当前的 `throw new Error("...not implemented yet")`
4. **API 层接受 backend 参数**
   - `POST /api/draft-prompt` 已经接受 `backend?: LlmBackend`(`packages/shared/src/api.ts`),透传给 driver
5. **前端 UI 加 toggle**
   - Header 加"LLM 后端"切换(ClaudeCode / OpenAI Chat)
   - localStorage 持久化用户偏好

## 易漏点

- **token 用量差异**:Chat API 按 token 计费 + 有上下文窗口限制。imagegen 方法论的 system prompt 大概 1200 tokens,加 hints / 历史能撑到 4-8K。多轮长对话(Phase 1.5 重对话化时)要考虑 trim 历史。
- **JSON schema 行为不一致**:Chat API 的 `response_format.json_schema.strict=true` 要 schema 必须用 OpenAI Strict Mode 子集(不支持 `additionalProperties: true` 等)。可能要为这个 driver 单独写一份 schema,把开放结构改成宽容 union。
- **错误形状不同**:OpenAI Chat 用 `APIError` 同 image,但 status / code 含义不同(401 是 invalid key,400 是 schema 不合规等)。错误分类要单独 classify。
- **凭据**:Chat API 用 key,**不是** OAuth。所以不存在"复用 ClaudeCode 凭据"——要让用户专门填一个 OpenAI key。

## 不要做

- ❌ 不要 spawn `claude` CLI 当 OpenAI driver fallback——这违反 [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md)
- ❌ 不要在 Chat driver 里 hardcode `https://api.openai.com/v1` ——让用户配 base URL,兼容代理

## 关联条目

- [claude-code-sdk-over-cli](../decisions/claude-code-sdk-over-cli.md)
- [structured-output-json-schema](../decisions/structured-output-json-schema.md)
- [defer-conversational-redesign](../decisions/defer-conversational-redesign.md) — Phase 1.5 整体范围
- [shared-contracts](../shared/shared-contracts.md) — `LlmBackend` 类型
