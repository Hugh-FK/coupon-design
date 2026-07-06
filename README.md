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
   └─ deploy.yml                # PR 构建 + main 部署到 GitHub Pages
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

### GitHub Pages(默认)

[.github/workflows/deploy.yml](./.github/workflows/deploy.yml) 已预置,零 secrets 即可跑通:

1. 每次 push / PR 都会跑 `pnpm build`
2. `main` 合并后,产物通过 `actions/deploy-pages@v4` 部署到项目页
3. Base path 由 workflow 自动注入(`DOCS_BASE=/<repo>/`),本地开发不受影响

**首次启用步骤**(必须先完成,否则 deploy 会 404):

1. 打开 [Settings → Pages](https://github.com/Hugh-FK/coupon-design/settings/pages)
2. **Build and deployment → Source** 选择 **GitHub Actions**(不是 "Deploy from a branch")
3. 重新运行失败的 workflow,或再 push 一次到 `main`
4. 访问 `https://hugh-fk.github.io/coupon-design/`

也可用 CLI 一次性启用(需仓库 admin 权限):

```bash
gh api -X POST repos/Hugh-FK/coupon-design/pages -f build_type=workflow
gh workflow run deploy.yml --ref main
```

**常见错误**:

- `deploy` 报 `HttpError: Not Found` → Pages 尚未启用,按上面步骤 1–2 处理
- workflow 显示 success 但站点仍 404 → 检查 `deploy` job 是否被 **skipped**;手动触发(`workflow_dispatch`)时旧版 workflow 只跑 build 不部署,需 push 修复后的 workflow 到 `main` 后再触发

如果换成用户主页(`<user>.github.io`)或自定义域名部署,把 workflow 中的 `DOCS_BASE` 改成 `/`,并按 GitHub 文档配 CNAME。

### 其他平台

产物是纯静态,`docs/.vitepress/dist` 直接扔到 Cloudflare Pages / Vercel / Netlify / Nginx / R2 静态托管都可以。CF Pages 的 workflow 版本可以从 git 历史里恢复。

## 品牌 / 主题

在 [docs/.vitepress/theme/styles/custom.css](./docs/.vitepress/theme/styles/custom.css) 修改 CSS 变量。当前色板:

- Brand:`#d97706` (amber-600)
- Accent:`#10b981` (emerald-500)
- Hero 渐变:amber → emerald

## Node & 包管理

- Node 版本锁定在 [.nvmrc](./.nvmrc)(`nvm use` 即可)
- pnpm 版本锁定在 `package.json` → `packageManager`(`pnpm@9.15.0`);本地执行 `corepack enable` 后自动对齐
- CI 通过 `pnpm/action-setup` 读取同一字段,并以 `pnpm install --frozen-lockfile` 安装依赖

## 贡献

1. 在 `docs/` 下的对应 `.md` 修改
2. `pnpm dev` 本地预览
3. PR 到 `main`,等 CI 构建通过再合并
