# snapub.json plugin overlay 只在 jdc 手动维护,不在任何 git 仓

snap-ub 的 plugin overlay JSON(`<INKAST_PLUGIN_DIR>/snapub.json`)**裸放在 jdc 上手动维护**——不在 inkast 仓库,不在 snap-ub 仓库,也不在独立的 overlay 私有仓。

## What

inkast 设计文档 `docs/plugin-overlay.md` 写的标准做法:

> 配置形态完全数据化:JSON 文件可以来自:
>   - 客户 overlay 私有 git 仓的 plugins/ 目录(rsync 到部署机的 INKAST_PLUGIN_DIR)
>   - 同主仓的 gitignored 本地开发目录(开发期方便)
>   - 任何 ops 自己管理的位置

实际 jdc 状态:
```
INKAST_PLUGIN_DIR=/etc/inkast/plugins
$ ls -la /etc/inkast/plugins/
-rw-r--r-- 1  501 root 3311 snapub.json
```

只有这一份文件,没有 git 历史,**对应的内容跟任何 git 仓都不同步**。修改要 ssh 进 jdc 手动编辑 + restart inkast-api。

## Why

snap-ub plugin 第一次接入时(2026-05 上线 v2 时),没建独立 overlay 仓,直接 ssh + vim + 写入。后续:
- 2026-05-22 v2.1 R2 直传上线,新增 `imageStorage` 块——直接 jq 在 jdc 上改
- systemPromptPatch / skipLlmConstraintsText 等文本字段调优,也都是 jdc 上动手

**没有 git 痕迹 = 没有变更历史 = 改坏了不知道改了什么**。一个 PR 跑下来,如果同时有人改 jdc,可能 deploy 后两个变更冲突也没人发现。

## Action

**1. 短期**:每次改 snapub.json **先 `cp snapub.json snapub.json.bak.$(date +%Y%m%d_%H%M%S)`**——至少有一份历史可回退。2026-05-22 改 imageStorage 时这么做了,留了 `snapub.json.bak.20260521_r2`
**2. 中期**:把 snapub.json 入 cc 仓库(`~/workspace/cc/`,基础设施管理项目)的某个目录,跟其他 jdc 配置一起 git 管理。deploy 走 rsync 从本地仓库推到 jdc
**3. 长期**:对方(snap-ub 项目)起一个独立 overlay 仓 `inkast-overlay-snapub`(按 [docs/plugin-overlay.md](../../plugin-overlay.md) 的标准做法),plugin JSON / deploy 脚本 / README 全进这个仓
**4. 改 snapub.json 后**:重启 inkast-api 时**先看新 JSON 能否被 zod 校验**——`journalctl -u inkast-api -n 20` 看 `[plugins] loaded snapub.json → plugin 'snapub'`,**没看到这行说明 schema 错被跳过了,得回滚 bak**

## 关联

- [[plugin-overlay-loader]] — overlay 加载机制(zod 校验失败时只 log 跳过,不挂)
- [[json-overlay-vs-branch]] — 设计上 overlay 走 JSON 不走 git fork
- [[new-plugin-onboarding]] — 新客户接入流程(应该走独立 overlay 仓)
- [[r2-direct-upload-v2.1]] — 加 imageStorage 块时就在 jdc 上手动改的
