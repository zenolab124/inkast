# nginx 默认 location 返 200 JSON,容易被误读为 admin 端点暴露

**What**: 加完 admin dashboard 后,我用 `curl -s -o /dev/null -w "HTTP %{http_code}"` 测公网:`https://snap-api.124213.xyz/admin/plugin-stats` → **HTTP 200**。瞬间慌了——以为公网把 dashboard 暴露了。

**Why**: nginx server block 末尾的默认 location 是:

```nginx
location / {
    return 200 '{"service": "snap-api", "status": "ok"}';
    add_header Content-Type application/json;
}
```

任何不匹配前缀 location(`/recognition/` / `/variant-gen/` / `/inkast/`)的路径都 fallthrough 到这里,返 200 + 39 字节 JSON。**不是 dashboard 内容**。

我看 status code 没看 body size,误以为 dashboard 真泄露了。

**Action**:

1. **看 body size + content** 而非只看 status code 判定暴露:
   - dashboard HTML 是 16-20 KB
   - nginx 默认 JSON 是 **39 字节**
   - 差三个数量级,完全可区分
2. **看 nginx access log 是 ground truth**:`access.log` 一行 `... "GET /admin/plugin-stats HTTP/2.0" 200 39 ...` 末尾的 39 是返回字节数,直接证明返的是 catch-all JSON 不是真 dashboard
3. **curl 加 `-w "%{size_download}B"` 或带 `-D -` 看 headers**:`content-length: 39` 一眼分清

通用经验: 测路径暴露时,**不要只信 status code**,要看 body / 看 content-length / 看 server-side log。HTTP 200 的语义模糊性容易让人虚惊一场。

## 关联条目

- [admin-dashboard](../domains/admin-dashboard.md) — 这条 pitfall 的应用场景
- [base-url-typo-silent-403](base-url-typo-silent-403.md) — 反向案例:路径暴露但被静默挡
