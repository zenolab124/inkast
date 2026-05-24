# 部署 inkast-api 到 jdc

inkast-api 不走 git pull,跑的是 mac 本机 build 出的 `apps/api/dist/` 文件夹。部署 = build + rsync + restart systemd + changelog。

## 步骤

```bash
pnpm --filter=@inkast/api build && \
rsync -avz --delete \
  /Users/xt/workspace/cc-apps/inkast/apps/api/dist/ \
  jdc:/root/inkast/apps/api/dist/ && \
ssh jdc "systemctl restart inkast-api && sleep 3 && \
  curl -s http://127.0.0.1:8787/api/health"
```

**为什么 sleep 3**:better-sqlite3 启动 + plugin loader + LLM warmup 大约 2.5 秒,sleep 短了 health 会拒连(connection refused → curl 退 7)。

**为什么 --delete**:防止 jdc 上残留旧文件(比如重命名过的 module),让 dist 跟本地完全镜像。

## 部署后必做

**1. 看启动日志确认服务 ready**:
```bash
ssh jdc "journalctl -u inkast-api -n 10 --no-pager"
```

预期看到:
```
[plugins] loaded snapub.json → plugin 'snapub'
[plugins] 1 plugin(s) loaded from overlay dir
[plugins] loaded token for plugin 'snapub' (token-len=64)
[plugin-async] recovered N interrupted task(s) — firing callbacks   ← 重启的中断恢复
[startup] serving Web UI from /root/inkast/apps/web/dist
[inkast api] listening http://127.0.0.1:8787
```

`[plugin-async] recovered` 那行如果出现:说明重启时有 in-flight task。它们已经被自动标 fail + callback 投递,**调用方收到失败状态后会自动退能量,不算丢数据**。

**2. 写一行 changelog** 到 `~/workspace/cc/servers/jd-cloud/changelog.md`:

```
- [yyyy-mm-dd] inkast-api 部署 v<N>:<一句话改了什么 + 为什么 + 预期效果>。<更多细节>
```

不留痕的部署 = 下次自己也忘了改了什么。

## 重启会中断 in-flight task

`systemctl restart` 会**杀掉所有正在跑的 image generation**——这些 LLM / image 调用的钱拿不回来。

恢复机制:`initPluginAsync` 启动时跑 `reaperInflightPluginTasks`:
- 扫 `plugin_tasks WHERE status IN ('queued', 'running')`
- 全部标 `failed` + `error_code='interrupted'`
- 立即对每个发 callback(SnapUB 那边客户端自动退能量)

**Web UI 通道**(jobs 表)同样有 reaper(`reaperInflightJobs`),前端会看到 task 变 failed。

## 部署中改 env

```bash
# 盲追加(不能 cat / tail / echo——见红线)
ssh jdc "printf '\\nKEY=VAL\\n' >> /root/inkast/inkast-api.env"

# 校验
ssh jdc "grep -c '^KEY=' /root/inkast/inkast-api.env"   # 期望 1
```

systemd `EnvironmentFile=/root/inkast/inkast-api.env`,**改完必须 restart 才生效**。

## 不需要重启的配置

- Provider 表(增删改 provider / capability)→ `listEnabledCapabilities` 每次 walker 都重读 DB
- `capability.extras` 字段(包括 `min_interval_ms` / `retryLimit` / `headers` / `mode`)→ 同上,新 task 立即生效
- Plugin overlay JSON(`INKAST_PLUGIN_DIR/*.json`)→ **需要重启**(registry 启动时一次性加载)

## 关键文件

- jdc:`/etc/systemd/system/inkast-api.service`
- jdc:`/root/inkast/inkast-api.env`(权限 600)
- jdc:`/root/inkast/apps/api/dist/`(rsync 目标)
- jdc:`/root/inkast/data/master.key`(权限 600,**DO NOT 复制出机**)
- 本机:`~/workspace/cc/servers/jd-cloud/inkast-api.md`(运维文档)
- 本机:`~/workspace/cc/servers/jd-cloud/changelog.md`(部署变更日志)

## 关联条目

- [add-new-provider](add-new-provider.md) — 新增 provider 的 Web UI 流程
- [new-plugin-onboarding](new-plugin-onboarding.md) — 给新客户接入 plugin 通道
- [throttle](../shared/throttle.md) — 改 throttle 配置(不重启)
- [debugging-playbook](../../debugging-playbook.md) — 部署后出问题怎么查
