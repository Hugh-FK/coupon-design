---
layout: home

hero:
  name: "Coupon Site"
  text: "落地方案"
  tagline: 北美 + 欧洲 coupon / deals 站的完整实施蓝图 —— 三个月 $3k、六个月 $10k 的产品迭代路径
  image:
    src: /logo.svg
    alt: Coupon Design
  actions:
    - theme: brand
      text: 3 个月路线图
      link: /11-roadmap
    - theme: alt
      text: 系统架构
      link: /02-architecture
    - theme: alt
      text: 竞品爬取方案
      link: /04a-competitor-crawling

features:
  - icon: 🎯
    title: 收入路径清晰
    details: T+3 月 $3k(SEO + 联盟)→ T+6 月 $10k(加浏览器插件)。每一步的交付物与验收标准都写在路线图里。
    link: /11-roadmap
    linkText: 查看路线图
  - icon: 🏗️
    title: 三层架构
    details: Fastify 爬虫 + Rust 中台 + Cloudflare 边缘(Workers / D1 / KV / R2 / Vectorize)。分层解耦、可独立扩缩容。
    link: /02-architecture
    linkText: 查看架构
  - icon: 🗄️
    title: schema 隔离的数据模型
    details: PostgreSQL 三 schema(crawler / platform / app)权限拆分,防脏数据穿透到 C 端;D1 是 app 的边缘镜像。
    link: /03-data-model
    linkText: 查看数据模型
  - icon: 🕷️
    title: 多站点爬虫框架
    details: SiteAdapter 契约 + 4 个基类,15+ 竞品站(RetailMeNot / Slickdeals / CouponFollow ...)按同一契约扩展。
    link: /04-crawler-layer
    linkText: 爬虫框架
  - icon: 🎯
    title: 15 家竞品爬取方案
    details: 每站的入口、结构、反爬难度、爬取节奏、优先级排期,以及冷启动 4 周内如何拿到 5000 商家。
    link: /04a-competitor-crawling
    linkText: 竞品清单
  - icon: 🦀
    title: Rust 中台
    details: raw → platform → app 清洗流水线,AI 摘要、deal_score 评分、有效性校验、变更事件流驱动下发。
    link: /05-middle-platform
    linkText: 中台设计
  - icon: 🔁
    title: 主动更新链路
    details: 5 种触发源、幂等键、变更检测、SLA 8 分钟内(feed → 用户可见);UGC 反向同步闭环。
    link: /05a-update-strategy
    linkText: 更新策略
  - icon: ✅
    title: 入库与验证策略
    details: 三级过滤(Ingest sanity → 分层验证 → C 端投影)+ 4 层验证栈(URL / DOM / 结账 / UGC),月成本 $430 覆盖 30 万 offer。
    link: /05b-validation-and-ingest-policy
    linkText: 验证栈
  - icon: ⚡
    title: 边缘前台
    details: Workers + Hono SSR、Cache API + KV 混合缓存、`/go/:offerId` 联盟点击追踪、Turnstile 反爬。
    link: /06-edge-frontend
    linkText: 前台设计
  - icon: 🔍
    title: SEO 深度设计
    details: URL 结构、JSON-LD 结构化数据、内链、hreflang、EEAT、technical checklist,一次做对不返工。
    link: /07-seo-strategy
    linkText: SEO 策略
  - icon: 💬
    title: 社区 UGC 机制
    details: 投票 / 评论 / 提交 / 举报,Karma + 徽章体系,防作弊三层策略,冷启动种子内容。
    link: /08-community-ugc
    linkText: 社区设计
  - icon: 💰
    title: 联盟接入实操
    details: CJ / Rakuten / Impact / ShareASale / Awin 全流程接入,SubID 追踪、佣金对账、Skimlinks 兜底。
    link: /09-affiliate-integration
    linkText: 联盟集成
  - icon: 🧩
    title: 浏览器插件
    details: 结账页自动填码、商家页横幅、主站账号打通,预期贡献 T+6M 收入的 30%。不劫持 cookie,合规优先。
    link: /12-browser-extension
    linkText: 插件设计
  - icon: 📝
    title: 商家内容生产
    details: 多源聚合 → LLM 起草(带引用)→ 事实核查 → 分层人审 → 定期刷新。5000 商家 About + 核销流程 + FAQ 一次做对。
    link: /13-merchant-content-pipeline
    linkText: 内容流水线
  - icon: 🛡️
    title: 合规完备
    details: GDPR / CCPA / FTC / DMCA / DSA 全覆盖,Cookie Consent、DSAR 流程、上线前 checklist 一并给出。
    link: /10-compliance
    linkText: 合规清单
---

## 收入路径

| 时点 | 目标 | 主要来源 |
|------|------|----------|
| T+3 月 | **$3,000 / 月** | SEO 流量 → 联盟点击(CJ / Rakuten / Impact / SAS + Skimlinks) |
| T+6 月 | **$10,000 / 月** | SEO(60%)+ 浏览器插件(30%)+ Newsletter / 直接访问(10%) |

## 快速阅读顺序

- **老板 / PM**: [01 商业](/01-business-and-market) → [11 路线图](/11-roadmap) → [07 SEO](/07-seo-strategy) → [12 插件](/12-browser-extension)
- **后端**: [02 架构](/02-architecture) → [03 数据模型](/03-data-model) → [05a 更新链路](/05a-update-strategy) → [05b 验证栈](/05b-validation-and-ingest-policy) → [04 爬虫](/04-crawler-layer) → [05 中台](/05-middle-platform)
- **爬虫工程**: [04 框架](/04-crawler-layer) → [04a 竞品清单](/04a-competitor-crawling) → [05b 验证栈](/05b-validation-and-ingest-policy) → [09 联盟](/09-affiliate-integration)
- **前端 / Edge**: [02 架构](/02-architecture) → [06 边缘](/06-edge-frontend) → [07 SEO](/07-seo-strategy) → [12 插件](/12-browser-extension)
- **增长 / SEO**: [07 SEO](/07-seo-strategy) → [08 社区](/08-community-ugc) → [09 联盟](/09-affiliate-integration) → [01 商业](/01-business-and-market)
- **法务 / 合规**: [10 合规](/10-compliance) → [09 联盟](/09-affiliate-integration)

## 核心决策(不再讨论,直接落地)

| 维度 | 决策 |
|------|------|
| 目标市场 | 北美(US/CA)优先,欧洲(UK/DE/FR)第二阶段 |
| 商业模式 | 联盟返佣 + 用户社区(投票/评论/UGC 提交) |
| 变现路径 | Affiliate commission → **浏览器插件放大** → 广告位(远期) |
| 主要联盟 | CJ Affiliate、Rakuten、Impact、ShareASale、Awin(欧洲) |
| 前台栈 | Cloudflare Workers + D1 + R2 + KV + Vectorize + Pages |
| 中台栈 | Rust(axum + sqlx + tokio),PostgreSQL |
| 爬虫栈 | Fastify(Node.js)+ Playwright + BullMQ |
| 数据流 | crawler → **crawler 脏 schema** → Rust 清洗 → **platform 业务 schema** → **app C 端 schema** → 同步至 CF D1 |
| 语言 | 首发 en-US,T+4 月起 en-GB / de-DE / fr-FR |
| 域名 | 主站单域,多语言用 subpath(/de、/fr) |
