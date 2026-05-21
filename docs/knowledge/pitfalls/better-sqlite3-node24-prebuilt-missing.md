# better-sqlite3 在 Node 24 无 prebuilt,需本地编译

**What**: jdc(Node v24.15)上 `pnpm install` 后,better-sqlite3 install script 跑了,但仍报 `Could not locate the bindings file`。手动 `npx prebuild-install` 输出 `No prebuilt binaries found (target=24.15.0 runtime=node arch=x64 libc= platform=linux)`。

**Why**: better-sqlite3 11.10 还没发布 Node 24 的 prebuilt(社区维护包,跟新 Node 版本通常滞后几个月)。`prebuild-install` 默认下载远程 prebuilt,找不到不会 fallback 到本地编译(需要显式触发)。

**Action**: 直接 `npm run build-release` 用 node-gyp 本地编译:

```bash
cd /root/inkast/node_modules/.pnpm/better-sqlite3@*/node_modules/better-sqlite3
PATH=/root/.nvm/versions/node/v24.15.0/bin:$PATH npm run build-release
# 编译 2-3 分钟,产出 build/Release/better_sqlite3.node
```

前提:部署机有 `make` / `gcc` / `g++` / `python3`(jdc Ubuntu 自带)。

**注意**:这是个 release-cycle 问题,better-sqlite3 出 Node 24 prebuilt 后就不需要本地编译了。届时换更新版本或升级 lockfile 即可。

## 关联条目

- [pnpm-onlybuiltdeps-native-build](pnpm-onlybuiltdeps-native-build.md) — 前置:install scripts 必须允许跑
- [better-sqlite3](../integrations/better-sqlite3.md)
