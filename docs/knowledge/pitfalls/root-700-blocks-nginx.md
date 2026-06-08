# root-700-blocks-nginx — /root 权限 700 阻挡 nginx 访问静态文件

从 `/root/inkast-public/` 目录 serve 静态文件时，nginx（以 `www-data` 用户运行）被操作系统权限拒绝，返回 403，静态文件和 SPA index.html 均无法访问。

## What

部署公开版到 jdc 后，nginx 配置 `root /root/inkast-public/dist`，访问任意路径均返回 `403 Forbidden`，nginx error log 出现：

```
permission denied while reading ... /root/inkast-public/dist/index.html
```

应用进程（systemd 以 root 启动，port 8788）本身正常，只有 nginx 静态文件路径受影响。

## Why

Linux 用户的 home 目录 `/root` 默认权限为 `700`（仅 root 用户可读/写/执行）。nginx worker 进程以 `www-data` 用户运行，不是 root，**无法进入 `/root/` 目录**，即使 `/root/inkast-public/` 子目录权限是 `755`，向下 traverse 在 `/root/` 这一层就已被阻断。

文件的实际权限不重要——只要 traverse 路径上的某一层目录对 nginx 用户缺少 `x`（execute/search）权限，访问就会被拒。

## Action

执行：

```bash
chmod 711 /root
```

`711` = 所有者 `rwx`，其他人 `--x`（只允许 traverse，禁止列目录内容）。这是业界常见做法：

- `r`（读目录）被撤销，`ls /root` 对非 root 用户失败，不会泄露目录列表
- `x`（execute/search）保留，nginx 可以按路径向下 traverse 访问子目录文件
- 子文件（如 `.env`、`.ssh/`）各自保持原有权限（`600`），不受影响

**替代方案**：把部署目录移到 `/var/www/inkast-public/`（`www-data` 可访问），改动更彻底但需要更新所有部署脚本和 env 路径。`chmod 711` 是改动最小、最快的修法。

**部署脚本注意**：每次首次部署到新服务器后必须执行此步，否则 nginx 静态文件必然 403。已写入 [workflows/deploy-public-edition](../workflows/deploy-public-edition.md) 检查清单。

---

关联条目：[workflows/deploy-public-edition](../workflows/deploy-public-edition.md)
