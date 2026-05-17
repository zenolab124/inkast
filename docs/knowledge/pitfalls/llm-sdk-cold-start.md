# Claude Agent SDK 首次调用冷启动 ~7s

## 现象

inkast 起动后第一次点"AI 扩充"散文 → JSON,要等 ~7 秒才出结果。后续调用 1-2 秒。用户体感首次操作"卡死"。

## 根因

`@anthropic-ai/claude-agent-sdk` 的 `query()` 函数底层 spawn 一个 Node child process 作为 worker——SDK 内部叫 "claude-code worker mode"。第一次 spawn 包括:

- Worker 进程 fork
- 加载 SDK runtime + tools 注册
- OAuth 凭据握手
- 建立 streaming protocol

实测冷启动 ~7 秒。**driver 单例**(每次调用复用 SDK client)能避免重复握手,但 worker spawn 是每个查询都来一次的——SDK 设计如此,不能仅复用 client 解决。

## 规避

**warmup**:API 启动 ~7 秒后(避开启动密集期),后台 fire-and-forget 跑一个**最小** JSON 请求,让 worker 进程预热完成。后续真正用户请求复用同一 worker,首次体感降到 1-2 秒。

实现位置:`apps/api/src/server/app.ts` 启动后 setTimeout 7s 调 warmup:

```ts
setTimeout(async () => {
  try {
    await draftPrompt({
      input: "warmup ping",
      backend: "claude-code",
      lang: "en",
      maxTokens: 8,
    });
    console.log("[llm-warmup] ok");
  } catch (err) {
    console.log("[llm-warmup] skip:", err.message);  // not_authenticated 等
  }
}, 7000);
```

成本:~50 token 一次,可接受。

**前端二次兜底**:`PromptComposer` mount 时也发一个 `POST /api/llm/warmup`(无 body 的快速路径)——防止用户在 API warmup 完成前就开始操作。

## 不该做的事

- 不要把 SDK 的 thinking 模式默认开成 `adaptive`/`enabled`——会让冷启动 + 实际调用都变慢。Phase 1 改默认 `disabled`(详见 [llm-driver-knobs](../decisions/llm-driver-knobs.md))
- 不要在 warmup 失败时显式报错给用户——OAuth 未登录时 warmup 必失败,但用户随时可能登录,不该提前报错

## 关联条目

- [claude-agent-sdk](../integrations/claude-agent-sdk.md) — SDK 配置细节
- [llm-driver-knobs](../decisions/llm-driver-knobs.md) — 关 thinking 缓解冷启动
- [llm-as-accelerator-not-requirement](../decisions/llm-as-accelerator-not-requirement.md) — LLM 是加速器,冷启动慢也不能阻塞核心路径
