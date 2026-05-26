# Codex CLI header 用布尔 flag 暴露,不让用户填 free-form headers

v2.33 给 image driver 加"使用 Codex Header"勾选——后端常量化 `CODEX_CLI_HEADERS`,前端 extras 改成 `useCodexHeader: boolean`,**否决了 free-form "用户自己填 headers JSON"的方案**。

## 背景

image driver 已经支持读 `extras.headers` 注入自定义请求头(用于模拟 Codex CLI 让反代放宽配额/审核),但只在 DB 里手编过 `冰r` image capability 一处;Web UI 没暴露这个能力,操作员要改得直接动 DB,体验差。

## 方案对比

| | A: extras.useCodexHeader bool + 后端常量 headers | B: extras.headers free-form,UI 给一个 JSON 编辑框 |
| --- | --- | --- |
| UI 复杂度 | 一个 checkbox | 文本编辑器 + JSON 校验 |
| 用户心智 | "勾选 = 启用 Codex 兼容模式" | "你要懂 originator / User-Agent 是干嘛的" |
| 错误面 | 几乎 0 | JSON 拼写错 / header 名错 / 值缺失 → 静默 403 |
| 扩展性 | 加新 header 集合要后端发布 | 用户立即可加 |
| 安全 | 后端控制注入什么 header | 用户可注入任意 header(包括 Authorization 之类的危险头) |

## 最终选择

**A**。用户明确表态:**"不让他自己填 Header 了,简单点,勾选确认就加 Codex header"**。

实现:
- 后端 `resolveExtraHeaders` 改成只读 `extras.useCodexHeader: boolean` flag,内部把硬编码的 `CODEX_CLI_HEADERS = { originator: "codex_cli_rs", "User-Agent": "codex_cli_rs/0.49.0 (Darwin 25.5.0; arm64) terminal" }` 常量注入。操作员不需要知道具体 header 值。
- 前端 `ProviderConfigDialog` 加 `imageUseCodexHeader: boolean` form state + `ImageCodexHeaderRow` 子组件,嵌在 image kind 编辑表单 retry 行下面。
- DB 一次性 migration 把 `冰r` image extras 从 `{headers:{...},mode,retryLimit}` 改成 `{useCodexHeader:true,mode,retryLimit}`,**不留兼容旧 `extras.headers` 对象格式**(测试期直接切)。

## 副作用

- **LLM driver 当前不读 extras.headers**(独立 bug,跟 image driver 不一致)。要让 LLM driver 也支持 Codex header,要先改 LLM driver——**不在本次任务范围内**,等用户后续提需求再开。用户明确"跟那个没关系,这是两个事"。
- 未来要新增另一套 header 集合(比如 Browser CLI 兼容)时,需要后端发布新 flag,**这是设计上接受的代价**。

## 关联条目

- [provider-pool](../domains/provider-pool.md) — extras 字段的容身处
- [llm-driver-knobs](llm-driver-knobs.md) — LLM driver 调参体系(暂未接 useCodexHeader)
