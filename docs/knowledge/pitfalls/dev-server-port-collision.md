# Dev Server 端口双 listen

**What**: 改了 API 代码,但 curl `/api/*` 返**老代码的响应**(明明新代码已加新字段)。`lsof -nP -iTCP:8787 -sTCP:LISTEN` 显示**两个 PID** 同时在 8787 上 listen。

**Why**: 后台跑了一个 `pnpm dev` 进程,中途又起了一个新的(可能是切到前台再后台、或者另一个会话起的)。第一个进程没死透,第二个也成功 listen 同端口(IPv4 vs IPv6 双栈 / SO_REUSEPORT),操作系统按某种策略路由请求,可能命中老进程。

具体场景:
- IPv4 `127.0.0.1:8787` LISTEN — 老进程
- IPv6 `*:8787` LISTEN — 新进程
- `curl localhost:8787` 默认走 IPv4 → 命中老进程 → 看老代码响应

**Action**:
- 任何"代码已改但响应没更"的诡异感,**先**:
  ```bash
  lsof -nP -iTCP:8787 -sTCP:LISTEN | grep -v WARNING
  ```
- 看到两个 PID → `kill <旧 PID>` 留一个
- 然后 curl health 验证版本字段确认是新代码:
  ```bash
  curl -sS http://127.0.0.1:8787/api/health
  ```
- 类似问题在 vite 5173 也可能发生

## 防御

启 dev 前先看现有进程:

```bash
ps aux | grep -E "tsx watch|inkast.*vite" | grep -v grep
```

有则 kill 再起新的。多个并行 dev 会话(不同终端窗口)极易触发。

## 关联条目

- [vite-dev-proxy](../integrations/vite-dev-proxy.md)
- [tsx-watch-syntax-kill](./tsx-watch-syntax-kill.md)
