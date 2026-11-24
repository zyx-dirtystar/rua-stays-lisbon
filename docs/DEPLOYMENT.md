# Rua Stays 公网部署

前端与 API 由 Cloudflare Worker 提供，会话、排名和事件保存在绑定名为 `DB` 的 D1 数据库。部署完成后，可用 Cloudflare 分配的 HTTPS 地址访问被试入口与研究后台。

## 从现有 GitHub 仓库部署到 Cloudflare

1. 在 [Cloudflare Dashboard](https://dash.cloudflare.com/) 的 D1 中创建 `rua-stays-lisbon-data`，从数据库详情复制 Database ID。
2. 在 **Workers & Pages** 创建 Worker，选择 **Import an existing Git repository**。连接 `zyx-dirtystar/rua-stays-lisbon` 的 `main` 分支，项目根目录留在仓库根目录。
3. 构建命令填 `npm run build`，部署命令填 `npm run deploy`，并把数据库 ID 存为构建变量 `RUA_D1_DATABASE_ID`。部署命令先应用 `drizzle/` 中的 D1 迁移，再上传 Worker。构建使用对该 Cloudflare 账户具有 Worker 发布和 D1 写入权限的令牌。
4. 在已部署的 Worker 的 **Settings → Variables and Secrets** 中添加运行时 Secret `RESEARCH_ADMIN_TOKEN`。值使用至少 24 个字符的强随机密钥。用用户名 `researcher` 和此密钥访问 `/research`。线上研究后台密钥保存在 Cloudflare。
5. 用新浏览器会话访问公网根路径。另在研究后台创建一条预览会话，走通同意、显示酒店、选房、确认和 CSV 导出，核对结果写入 D1。再用未认证会话访问 `/research` 和导出接口，确认受到访问控制。完成后再发放被试网址。

[Cloudflare Workers 连接 Git 仓库](https://developers.cloudflare.com/workers/ci-cd/builds/) · [Cloudflare D1 迁移](https://developers.cloudflare.com/d1/reference/migrations/) · [Workers Secret 配置](https://developers.cloudflare.com/workers/configuration/secrets/)

## 用 Wrangler 部署同一个项目

在可访问 Cloudflare 的环境中登录账户，先创建 D1 并在环境中设置 `RUA_D1_DATABASE_ID`。`npm run build` 生成 Worker，`npm run deploy` 负责数据库迁移与发布。正式发布后按上节配置运行时密钥。

## 自有 HTTPS 服务器

Node.js 24 及以上可直接启动。部署环境设置 `RUA_PUBLIC_ORIGIN` 为完整 HTTPS origin，设置 `RESEARCH_ADMIN_TOKEN`，并用 `--db` 指定持久化数据库路径。反向代理将流量交给本机 4329 端口并保留公网 Host。

## 已有 Sites 项目

本地 `.openai/hosting.json` 使用已有站点的 `project_id`。发布同一构建版本并应用 D1 迁移。Sites 的所有者通过平台身份与 `RESEARCH_OWNER_EMAIL` 访问后台。授权参与者访问前，验收公开入口和研究后台权限。

