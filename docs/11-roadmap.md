# 11 — 路线图

## 1. 目标(收入)

| 时点 | 月收入目标 | 主要来源 |
|------|-----------|----------|
| **T+3 月末**(产品发布 3 个月内)| **$3,000 / 月** | SEO 流量 → 联盟点击(CJ / Rakuten / Impact / SAS + Skimlinks 兜底) |
| **T+6 月末**(发布后 6 个月)| **$10,000 / 月** | SEO(60%) + **浏览器插件**(30%) + Newsletter/直接访问(10%) |

**T = 立项开始日**。前 3 个月 = 建站 + 上线 + 冷启动;第 4-6 个月 = 插件上线 + SEO 复利。

## 2. 3 个月主时间轴(T → T+3M)

产品迭代**3 个月**推出 MVP,月 3k 目标依赖:
- **P0 五家竞品爬完**、平台侧数据 5k 商家 / 30k active offers
- **联盟至少 3 家过审**并接入 deep link
- **SEO 覆盖**:top 500 商家页 + 20 品类页 + 10 篇 blog
- **社区最小闭环**:UGC 提交 + 投票 + 评论

### 阶段 A(T-2 周 ~ T+0):Sprint 0(2 周,准备)

**目标**:所有能提前跑的行政、账号、审核、法律准备启动。

- [ ] 域名注册(主 + 3-4 个变体防抢注)
- [ ] Cloudflare 账号 + Workers Paid Plan + Pages 项目
- [ ] Postgres 生产实例(Neon / Supabase / 自建)+ 三个 schema 权限拆分
- [ ] Redis(BullMQ)
- [ ] GitHub 组织 + 4 仓库(`docs` / `crawler` / `platform` / `web`)
- [ ] 联盟申请提交:CJ / Rakuten / Impact / ShareASale(4-6 周才通过)
- [ ] 律师起草 Privacy / Terms / DMCA / Cookie Notice
- [ ] Google Search Console + Bing Webmaster + GA4 + 站点验证
- [ ] Cloudflare Zaraz 或自建 CMP
- [ ] 品牌 logo + shadcn/ui 基础 UI 系统 + Figma 首页设计稿
- [ ] Sentry / Grafana / Loki / Prometheus 观测栈初始化
- [ ] 住宅代理服务开户(Bright Data / Oxylabs pay-as-you-go)

### 阶段 B(T+0 ~ T+2 周):Sprint 1(2 周,数据管道)

**目标**:三层架构 + schema 隔离 + 主动更新链路走通。

- [ ] 三 schema 建表 + 权限拆分 + migrations 工具选型(sqlx-cli 或 Atlas)
- [ ] Rust 中台 skeleton:`processor`、`app-syncer`、`d1-syncer`、`admin-api`
- [ ] Cloudflare D1 项目初始化 + schema
- [ ] Cloudflare Queue 通道打通(中台 push → Worker consumer 写 D1)
- [ ] Fastify 爬虫框架 + BullMQ + Redis + Playwright pool
- [ ] `SiteAdapter` 契约 + 三个基类
- [ ] Adapter fixtures 测试框架
- [ ] 手工导入 100 商家 seed(便于前端调试)

**验收**:能手工把 1 条 raw offer 一路推到 D1,前端页面读得到。

### 阶段 C(T+2 ~ T+4 周):Sprint 2(2 周,竞品爬取)

**目标**:P0 五家竞品跑起来,拿到 5k 商家。

- [ ] Adapter:CouponFollow、DealCatcher(反爬最低,先建立信心)
- [ ] Adapter:Slickdeals、Reddit(拿到社区信号)
- [ ] Adapter:Wethrift(sitemap 覆盖广)
- [ ] 中台 processor:merchant resolver、code 归一化、去重
- [ ] Ai_enricher:AI 摘要 + 分类(Claude Haiku,批量 100 条 / 次)
- [ ] Deal_score MVP 版本(先只用折扣力度 + recency)
- [ ] validator MVP:抽样 head redirect 检查

**验收**:`platform.merchants` 有 5000+ 记录、`platform.offers` 有 20000+ 记录且分数已算。

### 阶段 D(T+4 ~ T+6 周):Sprint 3(2 周,前端 + SEO)

**目标**:Cloudflare Workers 前台 SSR 上线,SEO 结构完备。

- [ ] Workers + Hono 项目 + wrangler.jsonc
- [ ] SSR 页面:首页 / `/store/:slug` / `/deals/:category` / `/store/:slug/offer/:id` / `/search`
- [ ] `/go/:offerId` 302 追踪 + click_log
- [ ] JSON-LD 结构化数据全部页面(Offer / Merchant / BreadcrumbList / FAQ)
- [ ] robots.txt + sitemap 生成器(每天 R2)
- [ ] Better-Auth 登录(email magic link + Google OAuth)
- [ ] Cookie consent + Privacy Policy / Affiliate Disclosure
- [ ] Turnstile 接入(所有写路径)
- [ ] KV 热榜缓存 + Cache API 商家页缓存
- [ ] Core Web Vitals 达标(Lighthouse ≥ 90)

**验收**:前 100 商家页在 Search Console 提交索引,Lighthouse 达标。

### 阶段 E(T+6 ~ T+8 周):Sprint 4(2 周,联盟 + UGC)

**目标**:第一家联盟深链 + UGC 最小闭环。

- [ ] CJ 或 Rakuten deep link 接入(第一家过审的先接)
- [ ] Impact / SAS feed pulling(即使还没过审可以先跑试点账户)
- [ ] Skimlinks 兜底接入,给"竞品有我方联盟没"的 offer 留出路
- [ ] Transaction reporting 拉取 + `platform.affiliate_transactions`
- [ ] UGC:投票 + 评论 + 举报 + 提交(D1 主写 → 反向同步到 platform)
- [ ] Karma + 徽章 MVP
- [ ] Turnstile / Rate Limit 保护
- [ ] Admin 后台:审核队列(pending submissions / flagged comments / reported offers)
- [ ] Newsletter 订阅入口 + Resend 集成

**验收**:end-to-end 一个联盟点击 → 商家 → 下单 → 24h 内在 admin 面板看到 commission 记录。

### 阶段 F(T+8 ~ T+10 周):Sprint 5(2 周,运营冷启动)

**目标**:内容 / SEO / 社区种子铺开,准备开门迎客。

- [ ] top 500 商家页运营优化:每家 About + 核销流程 + FAQ(走 [13-merchant-content-pipeline.md](./13-merchant-content-pipeline.md) 流水线,LLM 生成 + 人工审核 top 100 家)
- [ ] Admin 审核 UI:draft 编辑 / source 引用 / fact-check 报告
- [ ] 20 品类页编辑内容(400-800 字/页)
- [ ] Blog 首批 10 篇 SEO 长文(如 "10 Nike Discount Codes You Should Try in 2026")
- [ ] 编辑手写 200 条 offer 评论(seed 社区调性,标 verified staff)
- [ ] Reddit / Slickdeals / DealAlert 邀请 100 名种子用户,给 Founder 徽章
- [ ] Ahrefs / SEMrush 关键词监测面板
- [ ] Newsletter 首批 500 邮箱订阅(通过朋友圈 / Reddit / Twitter 推)

### 阶段 G(T+10 ~ T+12 周):Sprint 6(2 周,发布 + 数据反馈)

**目标**:软发布 + 全网分享 + 观测优化。

- [ ] 全 Region A/B:美国先开、欧洲第 6 个月开
- [ ] 联盟 Skimlinks 兜底覆盖率提升到 80%
- [ ] SEO 提交:sitemap 全站、IndexNow 加速、Search Console 覆盖率检查
- [ ] Reddit / Product Hunt / Hacker News / Twitter 分发
- [ ] 支付关键词 SEM 试跑(SaaS / 高佣金品类)$500 预算
- [ ] 每日观测:UV / Outbound / Commission,决策优先级

**T+3 月末验收目标**:
- 月 UV ≥ 100k
- Outbound click / UV ≥ 0.35
- Commission ≥ **$3k / 月**(EPC 假设 $0.09,即约 33k outbound)

## 3. T+3 ~ T+6 月:插件 + 复利

**核心动作**:浏览器插件上线 → 抬 outbound / user + 建立复用留存。

### T+3 ~ T+3.5 月:插件筹备

- [ ] Extension 骨架 + popup + 主站登录打通(Better-Auth OAuth flow)
- [ ] 商家识别 + 结账页识别通用引擎
- [ ] 500 商家 auto-fill rules(LLM 半自动生成 + 人工校正)
- [ ] 内测 20 用户

详细见 [12-browser-extension.md](./12-browser-extension.md)。

### T+3.5 ~ T+4.5 月:插件上线

- [ ] Chrome Web Store 提审(3-14 天)
- [ ] 主站顶部 CTA + 商家页 install 卡
- [ ] 首次使用引导(top 3 商家自动试)
- [ ] Firefox / Edge 上架

### T+4.5 ~ T+6 月:复利

- [ ] 插件 rules 到 2000 商家
- [ ] Sunday digest email("你本周省了 $X")
- [ ] Referral(邀请好友装 → +5 karma)
- [ ] 欧洲 V1.5:Awin 接入 / hreflang / 3 语言(de / fr / en-GB)
- [ ] top 20k 商家页 build-time 静态化(减 CF Worker CPU)
- [ ] Alert me 功能(关注商家 → 新 offer email)
- [ ] 商家 Featured 广告位 dashboard(V2 铺垫)

**T+6 月末验收目标**:
- 插件装机 ≥ 5k,DAU ≥ 500
- 插件贡献 outbound / 总 outbound ≥ 25%
- 月 UV ≥ 300k
- Commission ≥ **$10k / 月**

## 4. 团队规划(激进的 3 个月版本)

**MVP 3 个月最小可行**:
- 全栈 + 中台工程师 x 1(能写 Rust + Node + Cloudflare Workers)
- 前端 + 设计 x 1(SSR + Tailwind + shadcn/ui)
- 内容运营 / SEO x 1(负责商家介绍、blog、种子内容、社区拉新)
- 兼职法律顾问 x 0.1

**T+3 月起加入**(为插件 & 欧洲):
- 前端 x 1(专注 extension + 欧洲 i18n)
- Moderator x 1(处理 UGC + 竞品跟踪)

## 5. 成本预估(月度,USD)

| 项 | T+0 ~ T+3M | T+3 ~ T+6M |
|----|-----------|-----------|
| Cloudflare(Workers Paid + D1 + KV + R2 + Queues + Vectorize) | $50 | $250 |
| Postgres(Neon Pro / 自建)| $60 | $200 |
| Redis | $20 | $50 |
| VPS(爬虫 + 中台)| $80 | $250 |
| 住宅代理 | $200 | $400 |
| Playwright / 无头浏览器算力 | 含在 VPS | 含在 VPS |
| LLM(AI 摘要 + 分类 + rule 生成) | $80 | $250 |
| 域名 / 邮件(Resend)| $20 | $40 |
| 观测(Grafana Cloud / Sentry)| $30 | $80 |
| 法律 / 合规(一次性 $3-5k 前置)| — | — |
| **月度合计** | **~$540** | **~$1520** |

**投入产出**:T+3M 收入 $3k 已明显覆盖成本;T+6M 收入 $10k 净利可达 $8k+。

## 6. 关键假设与风险

| 假设 | 验证 | 风险预案 |
|------|------|----------|
| P0 五家竞品能爬到手 | Sprint 2 内至少三家跑起来 | 若有一家反爬失败,补 CouponFollow + Wethrift 兜底 |
| 联盟第一个月能过 1-2 家 | 3 家申请、只需 1 家过 | 都不过 → 立即接 Skimlinks 全量兜底,佣金分成低但能跑 |
| SEO 3 个月内 top 100 关键词进 top 50 | 每周复盘 | 内容质量不达 EEAT → 加编辑资源、放缓上新、深耕已有页 |
| 插件 T+4.5M 前上线 | Chrome Web Store 审核最多 14 天 | 被拒 → 隐私 / 权限最小化、律师复审、复审最多 3 轮 |
| 用户量能从 SEO 起量 | Search Console 每周监测 | UV 增长慢 → SEM 品牌词 + 追加内容资源、Reddit / Twitter 主动分发 |

## 7. 与其他文档联动

- 数据管道细节:[03-data-model.md](./03-data-model.md)、[05a-update-strategy.md](./05a-update-strategy.md)
- 竞品爬取:[04-crawler-layer.md](./04-crawler-layer.md)、[04a-competitor-crawling.md](./04a-competitor-crawling.md)
- 插件计划:[12-browser-extension.md](./12-browser-extension.md)
- SEO 深度:[07-seo-strategy.md](./07-seo-strategy.md)
- 联盟接入:[09-affiliate-integration.md](./09-affiliate-integration.md)
