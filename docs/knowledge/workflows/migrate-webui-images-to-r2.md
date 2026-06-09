# 迁移 Web UI 存量图到 R2

把 Web UI 通道(generations 表)的存量本地图补传 R2、回填 `image_url`,然后删本地。配合 Web UI 通道改纯 R2([webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md))的一次性数据迁移。**无停机**。

## 步骤

1. **部署纯 R2 代码**(build + rsync + restart,见 [deploy-jdc](deploy-jdc.md))
   - 部署瞬间:jdc 凭据已齐 → 新图立即纯 R2;存量 `image_url=null` → `/api/generations/:id/image` 走本地 302-fallback,**全程图都能显示**
2. **dry-run 统计**(只读,不传不改):
   ```bash
   ssh jdc 'cd /root/inkast/apps/api && set -a; . /root/inkast/inkast-api.env; set +a; \
     /root/.nvm/versions/node/v24.15.0/bin/node scripts/migrate-webui-to-r2.mjs'
   ```
   输出待迁移张数 + 体积。脚本能跑通也间接验证 `image_url` 列 migration 生效
3. **apply 迁移**:同命令加 `--apply`。逐张 PUT `webui/<image_path>` + 回填 `image_url`,幂等(只处理 `image_url IS NULL`)
4. **verify 校验**:同命令加 `--verify`。对所有 `image_url` 发 HEAD,确认 R2 可达
5. **守卫式删本地**:确认 `SELECT COUNT(*) FROM generations WHERE image_url IS NULL` = 0 才 `rm -rf /root/inkast/data/images`
6. **changelog 留痕**(基础设施硬性要求,见 [deploy-jdc](deploy-jdc.md))

## 注意事项

- **顺序不能反**:必须"部署 → 迁移 → 校验 → 删本地"。部署后存量靠 302-fallback 兜本地,**迁移 + verify 通过前绝不删本地**,否则存量图全 410
- **守卫 NULL=0 是删本地的硬闸**:任何 `image_url IS NULL` 的行删本地后就读不到了
- **迁移脚本要 source jdc env**(`set -a; . inkast-api.env`)拿 `R2_*` 凭据 + `INKAST_DATA_DIR`,凭据不过 shell 变量、不进 transcript
- **用 jdc 的 nvm node 全路径**(`/root/.nvm/.../node`),系统可能无 node;脚本在 `/root/inkast/apps/api` 下跑,better-sqlite3 + @aws-sdk 从该处 node_modules 解析
- **上行带宽**:258MB 走 jdc 5 Mbps 上行约 7-8 分钟,期间挤占其他对外服务,建议后台跑
- **dev 不受影响**:本地无 R2 凭据,生图仍写本地,无需迁移

## 关联

- [webui-channel-pure-r2](../decisions/webui-channel-pure-r2.md) — 为什么纯 R2(本迁移的动因)
- [image-generation](../domains/image-generation.md) — persistImage / 302 端点
- [cloudflare-r2](../integrations/cloudflare-r2.md) — R2 driver + webui/ 路径
- [deploy-jdc](deploy-jdc.md) — 标准部署流程 + changelog
