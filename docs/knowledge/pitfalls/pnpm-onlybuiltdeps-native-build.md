# pnpm 10+ 默认阻止 native install scripts

**What**: jdc 部署 inkast 跑 `pnpm install --prod --frozen-lockfile`,deps 装好了,但启动报 `Error: Could not locate the bindings file ... build/Release/better_sqlite3.node`。

**Why**: pnpm v10+ 引入安全机制——**默认不跑包的 install scripts**(防止恶意 native package 在 install 时执行任意代码)。`better-sqlite3` / `sharp` 等 native module 依赖 install script 下载 prebuilt binary 或本地编译。install 日志末尾会有 warning:

```
Warning: Ignored build scripts: better-sqlite3, sharp.
Run "pnpm approve-builds" to pick which dependencies should be allowed to run scripts.
```

主流程容易没注意这条 warning 直接往下走。

**Action**: 在 monorepo **根** `package.json` 显式 allowlist:

```json
{
  "pnpm": {
    "onlyBuiltDependencies": ["better-sqlite3", "sharp"]
  }
}
```

加这段后 `pnpm install` 会对这两个包跑 install scripts。**已经装好的部署**:`pnpm rebuild better-sqlite3 sharp` 或直接重 install 一次。

## 关联条目

- [better-sqlite3-node24-prebuilt-missing](better-sqlite3-node24-prebuilt-missing.md) — install scripts 跑了之后还有 prebuilt 找不到的问题
- [better-sqlite3](../integrations/better-sqlite3.md)
