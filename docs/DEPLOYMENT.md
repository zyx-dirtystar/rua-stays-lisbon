# Rua Stays 部署

构建产物为 `dist/server/index.js`，包含浏览器资源与 API。SQLite 或 D1 保存会话、排名与事件。公开 GitHub 仓库作为源码入口。

## Cloudflare Workers 和 D1

先在有权管理的账户内创建 D1 数据库。按照 [D1 迁移文档](https://developers.cloudflare.com/d1/reference/migrations/) 添加 `wrangler.jsonc`，用实际数据库的名称和 ID 替换示例。

```json
{
  "name": "rua-stays-lisbon",
  "main": "dist/server/index.js",
  "compatibility_date": "2026-11-24",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "rua-stays-lisbon",
      "database_id": "REPLACE_WITH_D1_DATABASE_ID",
      "migrations_dir": "drizzle"
    }
  ]
}
```

```sh
npm run build
npx wrangler d1 migrations apply rua-stays-lisbon --remote
npx wrangler secret put RESEARCH_ADMIN_TOKEN
npx wrangler deploy
```

`RESEARCH_ADMIN_TOKEN` 填至少 24 个字符的强随机密钥。HTTPS 后台路径为 `/research`，用户名为 `researcher`。根路径是参与入口。上线后，用独立窗口核对参与入口、后台身份验证及导出功能。

## 自有 HTTPS 服务器

用 Node.js 24 构建并启动应用。部署环境中设置 `RUA_PUBLIC_ORIGIN` 为完整 HTTPS origin，设置 `RESEARCH_ADMIN_TOKEN` 并用 `--db` 指定持久化数据库路径。反向代理将流量交给本机 4329 并保留公网 Host。生产后台要求研究者身份验证。

## 已有 Sites 项目

使用现有项目的 `project_id` 填写本地 `.openai/hosting.json`。提交同一构建版本并应用 D1 迁移。Sites 后台通过平台的账号身份与 `RESEARCH_OWNER_EMAIL` 做校验。授权参与者访问前，先用目标访问角色完成一条预览和导出验收。

