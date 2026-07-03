# 02 — 系统架构

## 1. 架构总览

```
┌───────────────────────────────────────────────────────────────────────────┐
│                          外部数据源(Sources)                               │
│  Affiliate Feeds (CJ / Rakuten / Impact / SAS / Awin) │ 商家站直爬 │ UGC │
└───────────────┬───────────────────────────────────────────────────────────┘
                │
┌───────────────▼───────────────────────────┐
│  ① 爬虫层(Node.js / Fastify)              │
│  - Feed 拉取(每 30 min)                   │
│  - 商家站爬取(Playwright, 每 6-24h)       │
│  - 任务调度(BullMQ + Redis)               │
│  - 输出:pg_raw.raw_offers / raw_pages     │
└───────────────┬───────────────────────────┘
                │  (INSERT into pg_raw)
┌───────────────▼───────────────────────────┐
│  ② 中台层(Rust / axum + tokio)           │
│  - 清洗、去重、标准化                       │
│  - 商家 / 品类映射                          │
│  - AI 摘要 / 类目分类(LLM)                │
│  - Deal Score 计算                         │
│  - 有效性校验(点击链路探活)                │
│  - 输出:pg_cleaned.offers / merchants     │
│  - Sync Job → Cloudflare D1                │
└───────────────┬───────────────────────────┘
                │  (Cloudflare Queue / HTTP push)
┌───────────────▼───────────────────────────┐
│  ③ 边缘前台(Cloudflare)                   │
│  - Workers(SSR + API)                     │
│  - D1(读密集副本,offers/merchants/UGC)   │
│  - KV(热门榜单、feature flag)             │
│  - R2(商家 logo、OG 图)                   │
│  - Vectorize(语义搜索、相关推荐)           │
│  - Pages(前端静态资源)                    │
└───────────────┬───────────────────────────┘
                │
              用户浏览器
```

## 2. 分层职责边界

| 层 | 语言/框架 | 存储 | 主要职责 | 不做什么 |
|---|-----------|------|----------|----------|
| ① 爬虫 | Node.js + Fastify + Playwright + BullMQ | PostgreSQL(raw)、Redis | 只负责「拿到原始数据」,尽量保留原样 | 不做清洗、不做业务判断 |
| ② 中台 | Rust(axum、sqlx、tokio) | PostgreSQL(cleaned) | 数据清洗、去重、AI 富化、评分、有效性、写入 D1 | 不面向用户请求、不做前端 |
| ③ 前台 | Cloudflare Workers + Hono/itty-router | D1、KV、R2、Vectorize | 面向用户的读写(读多写少)、SEO 渲染、UGC 收集、点击追踪 | 不做重计算、不做批处理 |

## 3. 数据流(生命周期)

**一个 coupon 的生命周期**:

1. **发现**(爬虫层)
   - 联盟 feed 中出现新 offer,或商家站被爬到新码
   - 写入 `pg_raw.raw_offers`,附 `source`、`fetched_at`、原始 payload
2. **清洗**(中台)
   - Rust worker 消费 raw 表,标准化:`code`、`title`、`discount_type`、`expires_at`
   - 商家匹配:通过 domain / affiliate merchant_id 映射到 `merchants` 表
   - 去重:`(merchant_id, normalized_code)` 唯一键;若已存在,更新 `last_seen_at`
   - AI 富化:LLM 生成简介、分类到 category、生成 `search_vector`(供 Vectorize)
3. **评分**(中台)
   - 综合折扣力度、商家权重、用户历史投票、码有效率 → `deal_score`(0-100)
4. **发布**(中台 → 边缘)
   - 每 5 分钟增量:`pg_cleaned.offers WHERE updated_at > last_sync` → Cloudflare Queue → Worker consumer → D1 upsert
   - Vector embedding 单独写入 Vectorize
5. **展示**(边缘)
   - Worker SSR,从 D1 读,首屏 HTML 缓存到 KV(1 小时)/ Cache API
   - 用户点击 → Worker 记录 click_log → 302 到联盟深链
6. **反馈**(边缘 → 中台)
   - UGC 投票 / 评论 / 举报无效码 → D1 → 每小时反向同步 → PG_cleaned
   - 反馈影响下一轮 `deal_score`

## 4. 跨层契约

### 4.1 爬虫 → PG_raw

Fastify 服务只写 raw 表,schema 尽量宽松(payload 用 JSONB 保留)。**版本升级不破坏历史数据**。

### 4.2 中台 → CF D1

**用 Cloudflare Queue 做增量同步**,不用双写。

- Rust 中台每次处理完一批 offers,发消息到 Queue:
  ```json
  {
    "op": "upsert",
    "table": "offers",
    "rows": [ {...}, {...} ]
  }
  ```
- Cloudflare Worker 作为 consumer,按 batch(50-100 条)写 D1。
- 失败重试通过 Queue 内建 DLQ 处理。
- 全量重建通道:中台可发 `op: "full_rebuild"` 触发 Worker 拉取指定分片。

### 4.3 边缘 → 中台(反向)

用户在前台产生的写事件(投票、举报、评论),先写 D1,同时写 CF Queue 到中台:

```
Worker → CF Queue → Rust 消费 → PG_cleaned.user_events
```

**双写但异步**:D1 是「即时可见」,PG 是「最终一致」。数据分析和评分在 PG 侧算。

## 5. 关键跨层决策

### 5.1 D1 vs 直连 PG

**决策:D1 作为读副本,不直连 PG。**

- 优点:边缘读延迟 < 20ms,全球分布,天然抗击 SEO 爬虫压力
- 代价:D1 单库 10GB 上限、只支持读多写少;超过阈值需分片(按 country / merchant_id 分)
- 分片规划:D1 按 `country_code`(us / uk / de / fr)水平分,一开始 us 一个库

### 5.2 SSR 还是静态化

**决策:混合模式**。

- 商家详情页 `/store/{slug}`、品类页 `/category/{slug}` → **静态化**(Cloudflare Pages + build 时预渲染 top 5000 页)+ 剩余 SSR
- 首页、搜索、用户页、投票 → **SSR**(Workers)
- 详情页更新触发 revalidate:中台 sync 后往 KV 写「dirty flag」,Worker SSR 时命中 flag 走新数据

### 5.3 认证

**决策:MVP 用 CF 内 Auth.js(Better-Auth)+ D1 存 session,不引第三方。**

- 支持 Email magic link + Google + GitHub
- 会员系统与 UGC 强绑定,匿名可读、必须登录才能投票/评论/提交

## 6. 环境划分

| 环境 | 前台域 | 后台/爬虫 | 数据 |
|------|--------|-----------|------|
| dev | dev.dealsxyz.workers.dev | 本地 docker-compose | 少量种子数据 |
| staging | staging.dealsxyz.com | 独立 VPS | 生产 30% 采样 |
| prod | dealsxyz.com | 独立 VPS + CF Queue prod 命名空间 | 全量 |

## 7. 观测

- **前台**:Workers Logpush → R2,配 Grafana Cloud 或 CF Analytics Engine
- **中台**:Rust `tracing` + OpenTelemetry → 自建 Grafana / Loki
- **爬虫**:pino 日志 → Loki;BullMQ 队列面板 Bull Board
- **告警**:重要 KPI(sync 延迟、爬虫失败率、点击→跳转 5xx)接 PagerDuty 或 Slack
