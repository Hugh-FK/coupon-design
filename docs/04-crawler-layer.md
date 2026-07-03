# 04 — 爬虫层(Fastify + Node.js)

## 1. 职责与非职责

**做**:
- 定时拉取 5 家联盟 CSV/XML/API feed
- **抓取 15+ 竞品站**(RetailMeNot / Slickdeals / CouponFollow ...,清单见 [04a-competitor-crawling.md](./04a-competitor-crawling.md))
- 定时爬取商家官方 coupon 页
- 处理 UGC 用户提交时对 URL 的抓取补全
- 把「原样」写入 `crawler.raw_offers` / `crawler.raw_pages`(全量落库,不做前置过滤 —— 过滤与验证是中台的事,见 [05b-validation-and-ingest-policy.md](./05b-validation-and-ingest-policy.md))

**不做**:
- 不做业务判断(有效性、去重、评分)—— 中台做
- 不面向前台用户请求
- 不写 `platform.*` / `app.*`(权限上被禁止)

## 2. 服务拓扑

```
┌───────────────────────────────────────────┐
│  Fastify HTTP API(内部)                   │
│  - POST /jobs/enqueue                      │
│  - GET  /jobs/:id                          │
│  - POST /adapters/:site/test               │
│  - GET  /health                            │
└──────────────┬────────────────────────────┘
               │
        ┌──────▼──────┐
        │  BullMQ     │  Redis
        │  Queues     │
        └──┬───────┬──┘
           │       │
    ┌──────▼──┐ ┌──▼─────────────────┐  ┌─────────────────┐
    │ Feed    │ │ Competitor Crawler │  │ Merchant Crawler│
    │ Fetcher │ │ (Playwright pool)  │  │ (fetch+cheerio) │
    └────┬────┘ └────────┬───────────┘  └────────┬────────┘
         │               │                       │
         ▼               ▼                       ▼
                 PostgreSQL(schema: crawler)
                        │
                        ▼
                   R2(HTML 归档)
```

## 3. 多站点爬虫框架(核心)

**问题**:每家竞品站结构不同,直接每家写一套代码会失控。

**方案**:定义统一的 `SiteAdapter` 契约,每个站点实现一次,框架统一调度、观测、告警。

### 3.1 SiteAdapter 契约

```ts
// src/adapters/types.ts
export interface SiteAdapter {
  /** 唯一标识,写入 crawler.crawl_jobs.site_key / raw_offers.source */
  readonly key: string
  /** 用于调度的元信息 */
  readonly meta: {
    displayName: string
    strategy: 'html' | 'api' | 'sitemap' | 'jsonld' | 'graphql'
    baseUrl: string
    respectsRobots: boolean
    /** 全站爬完的估计并发/时长,给调度器排队用 */
    concurrencyBudget: number
    /** 建议的整站遍历周期(小时)。热门商家单独更快 */
    fullCrawlIntervalH: number
  }

  /** 列表阶段:发现 merchant / offer 的入口 URL */
  discover(ctx: CrawlCtx): AsyncIterable<DiscoveryItem>

  /** 详情阶段:拉取一个 URL,产出 raw offers */
  fetchDetail(item: DiscoveryItem, ctx: CrawlCtx): Promise<RawResult>

  /** 增量:根据 site_cursors 定义如何判断"上次到哪" */
  advanceCursor(prev: unknown, results: RawResult[]): unknown
}

export interface DiscoveryItem {
  url: string
  kind: 'merchant_page' | 'category_page' | 'deal_page' | 'sitemap_url'
  hint?: { merchantSlug?: string; categorySlug?: string }
}

export interface RawResult {
  offers: Array<{
    sourceId: string          // adapter 内部稳定 id
    merchantHint: string      // "Nike" / "nike.com"
    payload: unknown          // 原样保留,不裁剪
  }>
  discovered?: DiscoveryItem[] // 详情页里挖出的其它 URL
  meta: {
    contentHash: string
    fetchedAt: Date
    httpStatus: number
  }
}

export interface CrawlCtx {
  http: HttpClient              // 已预配代理、UA 池、限流的客户端
  browser: BrowserPool          // Playwright 池,adapter 显式借用
  logger: Logger                // 结构化日志(带 site_key)
  sink: RawSink                 // 写 crawler.raw_offers / raw_pages
  now(): Date
}
```

### 3.2 目录结构

```
crawler/
├── src/
│   ├── app.ts                   # Fastify
│   ├── config.ts                # env parse (zod)
│   ├── db/
│   │   ├── pool.ts              # pg pool,连库使用 crawler_role
│   │   └── raw-sink.ts          # 写入 helper(去重、content_hash)
│   ├── queue/
│   │   ├── redis.ts
│   │   ├── queues.ts            # 队列定义
│   │   └── scheduler.ts         # cron 触发器,读 site_cursors
│   ├── http/
│   │   ├── client.ts            # undici + 代理池 + UA + 限流
│   │   ├── proxy-rotator.ts
│   │   └── ratelimit.ts         # 按 domain 限流(令牌桶)
│   ├── browser/
│   │   ├── pool.ts              # Playwright chromium 池
│   │   └── stealth.ts           # navigator override / fingerprint
│   ├── adapters/                # 每个站点一个文件
│   │   ├── index.ts             # registerAdapters()
│   │   ├── types.ts             # SiteAdapter 契约
│   │   ├── base/
│   │   │   ├── html-listing.ts  # 通用 HTML 列表页 adapter 基类
│   │   │   ├── sitemap.ts       # 通用 sitemap adapter 基类
│   │   │   └── jsonld.ts        # 通用 JSON-LD Offer schema adapter 基类
│   │   ├── affiliate/
│   │   │   ├── cj.ts
│   │   │   ├── rakuten.ts
│   │   │   ├── impact.ts
│   │   │   ├── shareasale.ts
│   │   │   └── awin.ts
│   │   └── competitor/          # 见 04a-competitor-crawling
│   │       ├── retailmenot.ts
│   │       ├── slickdeals.ts
│   │       ├── couponfollow.ts
│   │       ├── dealcatcher.ts
│   │       ├── knoji.ts
│   │       └── ...
│   ├── routes/
│   │   ├── jobs.ts
│   │   ├── adapters.ts          # 单站测试端点
│   │   └── health.ts
│   ├── observability/
│   │   ├── metrics.ts           # prom-client
│   │   └── logger.ts            # pino
│   └── utils/
│       ├── retry.ts
│       ├── content-hash.ts
│       └── robots.ts            # robots.txt 解析
├── adapter-fixtures/            # 每个 adapter 的 HTML 快照 + 期望输出
├── tests/
├── Dockerfile
├── package.json
└── tsconfig.json
```

### 3.3 Adapter 基类(90% 站点复用)

三种基类覆盖主流结构:

**A. `HtmlListingAdapter`** — 商家页有列表 + 每条 offer 卡片
- 提供 selector 配置:`merchantList`、`offerCard`、`titleSel`、`codeSel`、`expirySel`、`ctaSel`
- Adapter 只写这些 selector + optional post-process,基类负责翻页、去重、错误恢复

**B. `SitemapAdapter`** — 站点有 sitemap.xml
- 从 `sitemap-merchants.xml` 拿 URL,分批 fetch 详情

**C. `JsonLdAdapter`** — 站点用 `schema.org/Offer` JSON-LD
- 直接解析 `<script type="application/ld+json">`,拿到结构化数据

**D. `ApiAdapter`** — 站点内部有 JSON API
- 每次 XHR 抓,最省事(如 Slickdeals 的 REST 端点)

**具体每站选哪个**、每站的爬取节奏、反封锁难度,见 [04a-competitor-crawling.md](./04a-competitor-crawling.md)。

### 3.4 Adapter 示例

```ts
// src/adapters/competitor/retailmenot.ts
import { HtmlListingAdapter } from '../base/html-listing'

export const retailmenotAdapter = new HtmlListingAdapter({
  key: 'retailmenot',
  meta: {
    displayName: 'RetailMeNot',
    strategy: 'html',
    baseUrl: 'https://www.retailmenot.com',
    respectsRobots: true,
    concurrencyBudget: 2,
    fullCrawlIntervalH: 24
  },
  discovery: {
    seedUrls: ['https://www.retailmenot.com/coupons/all-stores'],
    merchantLinkSelector: 'a[href^="/view/"]',
    paginate: { maxPages: 200, next: 'a[rel="next"]' }
  },
  detail: {
    offerCard: '[data-testid="offer-tile"]',
    titleSel: '[data-testid="offer-title"]',
    codeSel: '[data-testid="offer-code"]',
    expirySel: '[data-testid="offer-expiry"]',
    ctaSel: '[data-testid="offer-cta"]',
    postProcess: (raw, $) => ({
      ...raw,
      // rmn 特有:offer 有 verify-badge 就打 verified 标
      verified: !!$(raw.el).find('[data-testid="verified-badge"]').length
    })
  },
  needsBrowser: true,   // rmn 是 Next.js SPA,fetch 拿不到内容
  headers: {
    'accept-language': 'en-US,en;q=0.9'
  }
})
```

框架跑起来:
```
scheduler → 每 fullCrawlIntervalH 触发一次 discover
        → discovery 发现 URL 入 detail 队列
        → worker fetch → RawResult → sink 写 raw_offers
        → 写 site_cursors
```

## 4. 队列设计(BullMQ)

| 队列 | 输入 | 触发 | Worker 并发 |
|------|------|------|-------------|
| `feed:{network}` | `{feedId, since}` | cron 30-60min | 4 / 家 |
| `discover:{siteKey}` | `{cursor}` | cron 或链式触发 | 1 / 站 |
| `detail:{siteKey}` | `{DiscoveryItem}` | discover 产出 | budget-based |
| `submit:crawl` | `{submissionId, url}` | 用户触发 | 4 |
| `refresh:merchant` | `{merchantId, priority}` | 中台 push(见更新链路) | 8 |

**关键点**:每站一个独立 `detail` 队列,便于按站点节流、暂停单站、单站故障不影响其它。

## 5. 反封锁(15+ 站,反爬手段各不同)

多站爬虫的核心技术难点。分层应对:

**基础层**(所有站默认启用):
- 住宅代理池(Bright Data / Oxylabs),按 country 路由
- UA 轮换(4 个主流浏览器版本)
- 每 domain 限流(默认 1 req/s、并发 3)
- 尊重 `robots.txt`(除非白名单绕过)
- 指数退避:429 / 5xx → 5s / 30s / 5min → 换 IP

**中级层**(SPA / 简单反爬):
- Playwright headless=true + stealth plugin(patch navigator.webdriver 等)
- Wait for network idle + selector present
- Cookie 持久化(减少验证码触发)

**高级层**(Cloudflare / DataDome / Akamai 保护):
- Playwright + rebrowser-patches(绕过 CDP 检测)
- 或用 FlareSolverr / Bright Data Web Unlocker 兜底
- 极端情况:放弃直爬,只用联盟 feed(不值得成本)

**每站的具体策略**在 [04a-competitor-crawling.md](./04a-competitor-crawling.md) 里逐一列。

## 6. 与中台的握手

爬虫**不通知**中台。中台自己轮询:
```sql
SELECT * FROM crawler.raw_offers
WHERE processed_at IS NULL
ORDER BY id
LIMIT 500 FOR UPDATE SKIP LOCKED;
```

好处:
- 爬虫失败不阻塞中台
- 中台重启不丢事件
- 单库单事务,无跨服务一致性问题

**主动更新时**(用户举报 / 商家新闻):走 `refresh:merchant` 队列,爬虫抓完立即写 raw + 中台高优消费。链路详见 [05a-update-strategy.md](./05a-update-strategy.md)。

## 7. Fastify HTTP API(仅内网)

```ts
app.post('/jobs/enqueue', ...)          // 手动入队
app.post('/adapters/:site/test', ...)   // 单站单 URL 试跑,返回 RawResult 不写库
app.get('/adapters', ...)                // 列出注册的 adapter + 元信息
app.get('/health', ...)
```

Admin 后台通过中台代理调用,不直接暴露公网。

## 8. 观测

- `crawler_jobs_total{site_key,status}` — 成功/失败
- `crawler_offers_ingested_total{site_key}` — 每天入库数
- `crawler_adapter_error_rate{site_key,error}` — 错误分布
- `crawler_proxy_ban_rate{proxy_pool}` — 代理健康
- `crawler_domain_qps{domain}` — 限流实测
- **告警**:
  - 任一 adapter 24h 无新数据 → PagerDuty
  - 单站错误率 > 30% 持续 30 min → 自动降级(暂停该站,通知)

## 9. Adapter fixtures(测试与 CI)

每个 adapter 在 `adapter-fixtures/{siteKey}/` 存一份代表性 HTML/JSON 样本 + 期望输出:

```
adapter-fixtures/
└─ retailmenot/
   ├─ nike-listing.html
   ├─ nike-listing.expected.json
   ├─ walmart-listing.html
   └─ walmart-listing.expected.json
```

CI 跑 fixture 回归,adapter 改动导致输出漂移会被 diff 出来。**这是保住 15+ 站不失控的关键**。

## 10. 部署

- **单 VPS 起步**:4c8g,Docker Compose 起 Fastify + Redis + Playwright pool
- **爬虫水平扩展**:worker 无状态,加 VPS 直接扩;共享 Redis 队列
- **PG_raw 独立 schema,不独立实例**:与 platform 同库不同 schema,减少运维成本;有性能瓶颈再拆
