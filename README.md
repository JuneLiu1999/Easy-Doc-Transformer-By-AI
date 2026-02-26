# Doc Block Platform (Monorepo)

## 项目愿景
构建一个 self-host 友好的内容平台：将文档内容统一建模为 Block JSON，经主题渲染后可编辑，并可静态导出发布。

## MVP-0 闭环
- API 返回 `demoPage`（Block JSON）
- Web 在 `/demo` 拉取 JSON 并按 Block 渲染（非整页 HTML 注入）
- 点击 `Publish` 调用通用导出接口 `POST /api/export`
- 点击顶部 `AI Select` 进入框选模式，对选中 blocks 发送 AI patch（真实 OpenAI-compatible provider）
- 点击 `Undo` 回滚上一条 AI patch（内存历史，最多 20 条）
- 导出文件生成到：
  - 自动 slug：`exports/r/<slug>/index.html`
  - 自动 slug：`exports/r/<slug>/assets/style.css`
  - 自动 slug：`exports/r/<slug>/manifest.json`

## Monorepo 结构
- `apps/web`: Next.js + TypeScript 前端
- `apps/api`: Fastify + TypeScript 后端
- `packages/blocks`: Block JSON types + demo 数据
- `packages/renderer`: `renderToHtml(page, theme)`
- `packages/editor`: 预留
- `packages/llm`: 预留
- `data/pages`: 本地持久化 page JSON（导入后保存）

## 本地运行
```bash
npm install
npm run dev:api
npm run dev:web
```

- Web: `http://localhost:3000/demo`
- API: `http://localhost:3001/api/page/demo`

## 导出验证
1. 打开 `http://localhost:3000/demo`
2. 点击 `Publish`
3. 检查文件：
   - `exports/r/<slug>/index.html`
   - `exports/r/<slug>/assets/style.css`
   - `exports/r/<slug>/manifest.json`

## 导出产物规范
导出目录（默认自动 slug）：`exports/r/<slug>/`

包含文件：
- `index.html`
- `assets/style.css`
- `manifest.json`

`manifest.json` 最小字段：

```json
{
  "siteSlug": "r/ab12cd34",
  "pageId": "demo",
  "version": "1740556800000",
  "generatedAt": "2026-02-26T12:00:00.000Z",
  "entry": "index.html",
  "assets": ["assets/style.css"],
  "urlPath": "/r/ab12cd34/",
  "hostname": "report.fuhua.team",
  "deployRootDir": "/var/www"
}
```

## 同域名多报告发布（/r/<slug>）
- 当不提供 `siteSlug` 时，后端会自动生成随机 slug（8 位小写字母数字）。
- 发布路径固定为 `/r/<slug>/`，可在同一 hostname 下发布多个报告。
- 输出目录为 `exports/r/<slug>/`，返回 `urlPath=/r/<slug>/`。
- 若提供自定义 `siteSlug`（例如 `my-report`），输出目录为 `exports/my-report/`，路径为 `/my-report/`。
- `siteSlug` 仅允许 `[a-z0-9-_]`，并拒绝 `..`、`/`、`\`、`%` 等路径穿越字符。

## Reports Index（/reports）
- 发布后可访问 `http://localhost:3000/reports` 查看报告列表。
- 列表数据来源：后端扫描 `exports/**/manifest.json` 聚合（无数据库）。
- 兼容目录：
  - `exports/r/<slug>/manifest.json`
  - `exports/<customSlug>/manifest.json`

## 自动部署（remoteBaseDir + urlPath）
- `POST /api/deploy` 支持高层输入：
  - `remoteBaseDir`（例如 `/var/www/reports`）
  - `urlPath`（例如 `/r/abcd1234/`）
- 后端会自动计算：
  - `remoteRootDir = /var/www/reports/r/abcd1234`
- 若传入 `remoteRootDir`（高级用法）则优先使用该值。
- 推荐目录结构：
  - `/var/www/reports/r/<slug>/`
- 推荐流程：
  - Publish -> Deploy -> 访问 `https://report.fuhua.team/r/<slug>/`

## 导入 DOCX
1. 打开 `http://localhost:3000/demo`
2. 点击工具栏 `Import .docx` 并选择 Word 文件
3. 后端会解析 `.docx` 为结构化 AST，再转换为 Block JSON
4. 导入成功后跳转到 `http://localhost:3000/page/<pageId>`
5. 新页面支持同样的 AI Select / Undo / Publish / Deploy 流程

说明：
- 当前仅支持 `.docx`（使用 `mammoth` 作为中间解析）
- HTML 仅用于中间态解析，不作为最终存储
- 最终内容会保存到 `data/pages/<pageId>.json`

## AI Select / Undo（Real Provider）
1. 打开 `http://localhost:3000/demo`
2. 在顶部展开 `AI Settings`，设置：
   - `Base URL`（默认 `https://api.openai.com`）
   - `API Key`
   - `Advanced`（可选）：`Model`
3. 点击顶部 `AI Select` 进入选择模式
4. 拖拽框选或单击选中 block（按住 `Shift` 可追加/取消单选）
5. 在浮动输入框输入指令，例如：`把这段改得更正式`
6. 点击 `Apply` 后页面会使用后端返回的 Patch 结果更新
7. 点击 `Undo` 可回到上一个版本（若无历史会返回 `Nothing to undo`）

说明：
- 当前 `/api/patch/demo` 默认使用真实 OpenAI-compatible provider。
- 仅当服务端环境变量 `USE_MOCK_AI=true` 时，才启用 mock AI fallback。
- `Base URL` 可指向任意 OpenAI-compatible 网关（会调用 `{base_url}/v1/chat/completions`）。
- 默认模型为 `DEFAULT_MODEL` 环境变量，未设置时回退到 `gpt-4o-mini`。
- 用户不填 `Model` 也可正常调用（后端自动补默认模型）。
- `API Key` 默认仅保存在浏览器 `sessionStorage`，不会写入仓库或数据库；请求时由前端传给你部署的后端再转发给模型网关。

## 部署到 Linux + 子域名（Caddy）
以 `report.fuhua.team` 为例：

1. DNS 配置  
在域名服务商添加 A 记录：`report` -> `<your-server-ip>`

2. 服务器放通端口  
开放 `80` 和 `443`（安全组/防火墙）

3. 上传静态文件  
将 `exports/` 下的发布目录上传到服务器目录 `/var/www/reports/`（例如 `exports/r/ab12cd34` -> `/var/www/reports/r/ab12cd34`）

4. Caddyfile 增加站点  
示例：
```caddyfile
report.fuhua.team {
  root * /var/www/reports
  file_server
}
```

5. 重载 Caddy  
```bash
sudo systemctl reload caddy
```

说明：Caddy 会自动申请并续期 HTTPS 证书。

限制（MVP）：
- 仅支持顶层 `page.blocks`，不处理深层 children
- 选区粒度是 block（基于 `data-block-id` + rect 相交）

## 根脚本
```bash
npm run dev:api
npm run dev:web
npm run build
npm run typecheck
npm run test
```
