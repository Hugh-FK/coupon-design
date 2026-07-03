# Coupon Design Docs

北美 + 欧洲 coupon / deals 站的落地方案文档站,用 [VitePress](https://vitepress.dev/) 构建。

- 文档源:[docs/](./docs/) 目录(`index.md` + `01-*.md ~ 11-*.md`)
- 站点配置:[docs/.vitepress/config.mts](./docs/.vitepress/config.mts)
- 自定义主题:[docs/.vitepress/theme/](./docs/.vitepress/theme/)
- 静态资源:[docs/public/](./docs/public/)

## 快速开始

需要 Node.js ≥ 20 与 pnpm。

```bash
pnpm install         # 安装依赖
pnpm dev             # 启动 http://localhost:5173
pnpm build           # 构建静态站点到 docs/.vitepress/dist
pnpm preview         # 本地预览构建产物
pnpm typecheck       # 检查 .vitepress 下的 TS
pnpm clean           # 清空 dist 与 cache
```

## 目录结构

```
coupon-design/
├─ docs/                        # 文档源(VitePress srcRoot)
│  ├─ index.md                  # 首页(hero + features)
│  ├─ 01-business-and-market.md
│  ├─ ... (02-11)
│  ├─ .vitepress/
│  │  ├─ config.mts             # 导航、侧边栏、搜索、SEO 配置
│  │  ├─ dist/                  # 构建产物(gitignore)
│  │  ├─ cache/                 # 构建缓存(gitignore)
│  │  └─ theme/
│  │     ├─ index.ts            # 主题入口(继承 default theme)
│  │     └─ styles/custom.css   # 品牌色与卡片微调
│  └─ public/                   # 静态资源(直接映射到 /)
│     ├─ logo.svg
│     ├─ favicon.svg
│     └─ robots.txt
├─ package.json
├─ tsconfig.json
├─ .nvmrc                       # Node 版本
├─ .editorconfig
├─ README.md                    # 本文件
└─ .github/workflows/
   └─ deploy.yml                # PR 构建 + main 部署到 Cloudflare Pages
```

未来在根目录同级添加代码目录(monorepo 布局):

```
├─ web/           # Cloudflare Workers 前台
├─ platform/      # Rust 中台
├─ crawler/       # Fastify 爬虫
```

## 编辑文档

- 所有 `.md` 都是 VitePress 的 markdown 页面,支持代码高亮、tip/warning/details 容器、frontmatter。
- URL 采用 `cleanUrls`,`docs/01-business-and-market.md` 对应 `/01-business-and-market`。
- 页面顺序由 [docs/.vitepress/config.mts](./docs/.vitepress/config.mts) 中的 `sidebar` 决定,新增文档记得同步 sidebar。

### 常用容器

```md
::: tip 提示
关键信息高亮
:::

::: warning 注意
需要谨慎的地方
:::

::: details 展开查看
折叠内容
:::
```

## 部署

### Cloudflare Pages(推荐)

[.github/workflows/deploy.yml](./.github/workflows/deploy.yml) 已预置:

1. 每次 PR 会跑 `pnpm build`,产物作为 artifact 保存 7 天。
2. `main` 合并后,`cloudflare/wrangler-action@v3` 推送 `docs/.vitepress/dist` 到 Pages 项目 `coupon-design`。

需要在 GitHub 仓库配置:

- **Secrets**:`CLOUDFLARE_API_TOKEN`(权限:Account.Cloudflare Pages.Edit)、`CLOUDFLARE_ACCOUNT_ID`
- **Variables**(可选):`SITE_URL`、`REPO_URL`

### 其他平台

产物是纯静态,`docs/.vitepress/dist` 直接扔到 Vercel / Netlify / Nginx / R2 静态托管都可以。

## 品牌 / 主题

在 [docs/.vitepress/theme/styles/custom.css](./docs/.vitepress/theme/styles/custom.css) 修改 CSS 变量。当前色板:

- Brand:`#d97706` (amber-600)
- Accent:`#10b981` (emerald-500)
- Hero 渐变:amber → emerald

## Node & 包管理

- Node 版本锁定在 [.nvmrc](./.nvmrc)(`nvm use` 即可)
- 包管理器锁定在 `package.json` 的 `packageManager` 字段(pnpm 9)
- CI 使用 `pnpm install --frozen-lockfile`

## 贡献

1. 在 `docs/` 下的对应 `.md` 修改
2. `pnpm dev` 本地预览
3. PR 到 `main`,等 CI 构建通过再合并
# coupon-design
