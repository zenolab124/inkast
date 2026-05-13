# `tsx watch` 遇语法错会 kill 进程

**What**: 改 API 代码出现语法错(例如 `?? || ` 不加括号),tsx watch 触发 restart,**新进程因 parse 失败直接退出**,旧进程已被 SIGTERM kill。API 整个挂掉,后续请求 ECONNREFUSED 或 502。

**Why**: tsx watch 的重启逻辑是"看到文件变 → kill 旧进程 → spawn 新进程"。新进程在 esbuild 阶段就崩,Node.js v24.10.0 报:

```
Error [TransformError]: Transform failed with 1 error:
.../foo.ts:NN:NN: ERROR: Cannot use "||" with "??" without parentheses
```

旧进程已经死了,新进程没起来,**API 处于无人状态**。前端的所有 `/api/*` 请求都会失败。

**Action**:
- 看 dev 日志(stdout),搜 `Error \[TransformError\]` 或 `Node.js v24` ——出现就说明 tsx 杀了进程
- 修语法错(查 [LSP 提示]、tsc typecheck、或日志里的具体行)
- 保存文件后 tsx 自动再尝试 restart;如果不重启,**手动重启 dev**:Ctrl+C + `pnpm dev`
- **不要**继续盲目改代码——错的文件不修,tsx 永远起不来

## 验证 API 是否健康

```bash
curl -sS -m 5 http://127.0.0.1:8787/api/health
# 期待:{"status":"ok","service":"inkast-api","version":"0.0.1"}
# 失败:ECONNREFUSED / 没响应
```

## 防御性编码

避免 `??` 和 `||` / `&&` 直接相邻,加括号让意图明确:

```ts
const x = a ?? (b || c);    // ✓
const y = a ?? b || c;      // ✗ TransformError
```

## 关联条目

- [dev-server-port-collision](./dev-server-port-collision.md) — 多个 dev 进程同时起的相关问题
