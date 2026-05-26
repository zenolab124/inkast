# 中文反代余额不足措辞多样,quota regex 漏匹配 → auto-disable 不触发,每次提交浪费 attempt

**What**: 某 provider(尤其国内反代如 ciallo)当日额度用完,inkast 没自动禁用它,每次新 task 提交都把它作为一次 attempt 浪费 + 占一次 throttle slot。看 attempts JSON 能看到错误码归到 `auth` 而非 `quota_exhausted`。

**Why**: v2.29 引入的 `QUOTA_MESSAGE_PATTERN` 只覆盖了 OpenAI 标准措辞 `(insufficient_quota|quota exhausted/exceeded|no available quota)` + 一组中文常规措辞(`余额不足/额度不足/账户余额`)。**没覆盖中文反代特有的"预扣费"措辞**:
- `预扣费额度失败, 用户剩余额度: ＄0.288, 需要预扣费额度: ＄0.500`
- `扣费失败`
- `剩余额度: ＄x.xxx`(裸单行)

→ message 不匹配 → `classifyError` 把 HTTP 403 + 该 message 归到 `auth` 类(常规 403 处理) → 不触发 `markCapabilityAutoDisabledUntilNext6am` → provider 仍留在 pool 里。

**Action**:
- v2.32 已修:`QUOTA_MESSAGE_PATTERN` 追加 `预扣费(?:额度)?失败|剩余额度.*?(?:不足|低于|需要)|扣费失败`。
- **同步两路径**:`classifyError` 在 `apps/api/src/drivers/image/openai-compatible.ts` 有 APIError 分支(images mode)和 plain Error 分支(responses mode),**新错误识别必须两处都加**,否则 responses mode 路径漏判——见 [error-code-translation-layer](error-code-translation-layer.md) 的同类教训。
- 未来再出现新反代 → 收到 user 报错时先 grep 实际 message,扩 regex 即可,**不要尝试用 LLM 判别**(规则简单且对延迟敏感,正则最稳)。

## 关联条目

- [error-code-translation-layer](error-code-translation-layer.md) — 同源 pitfall:`classifyError` 改动必须两路径同步
- [moderation-low-ineffective-on-resellers](moderation-low-ineffective-on-resellers.md) — 中文反代的另一类反常行为
- [provider-pool](../domains/provider-pool.md) — auto-disable 的载体
