# 06 — 边缘前台(Cloudflare)

## 1. 组件全貌

| 组件 | 用途 |
|------|------|
| Workers | SSR、API、点击追踪、UGC 收集、Queue consumer |
| D1 | 边缘 SQL(offers / merchants / users / user_events_edge) |
| KV | 热榜缓存、feature flag、限流计数、session |
| R2 | logo、OG 图、静态资源 |
| Vectorize | 语义搜索、相关推荐 |
| Cloudflare Queues | 中台 → 边缘的数据同步管道 |
| Pages | 静态资源 CDN + Preview 部署 |
| Cache API | 页面 HTML 边缘缓存 |
| Turnstile | 反机器人(UGC 提交、投票) |

## 2. Workers 项目结构

```
web/
├── wrangler.jsonc
├── package.json
├── src/
│   ├── index.ts                 # main entry (default fetch handler)
│   ├── router.ts                # itty-router / Hono 路由
│   ├── ssr/
│   │   ├── homepage.tsx         # SSR JSX(hono/jsx 或 preact-render-to-string)
│   │   ├── merchant.tsx
│   │   ├── category.tsx
│   │   ├── offer.tsx
│   │   ├── search.tsx
│   │   └── layout.tsx           # header/footer/i18n
│   ├── routes/
│   │   ├── click.ts             # /go/:offerId  → 302
│   │   ├── vote.ts              # POST /api/vote
│   │   ├── submit.ts            # POST /api/submit
│   │   ├── search.ts            # GET  /api/search
│   │   └── auth/                # magic link + oauth
│   ├── db/
│   │   ├── offers.ts            # D1 query helpers
│   │   ├── merchants.ts
│   │   └── ugc.ts
│   ├── cache/
│   │   ├── kv.ts
│   │   └── page-cache.ts        # Cache API wrapper
│   ├── consumers/
│   │   └── sync-consumer.ts     # Queue consumer (中台 → D1)
│   ├── i18n/
│   │   └── translations.ts
│   └── seo/
│       ├── sitemap.ts           # /sitemap.xml
│       ├── robots.ts
│       └── jsonld.ts            # 结构化数据生成
├── public/                      # 静态资源(→ Pages)
└── tests/
```

**wrangler.jsonc 关键片段**:

```jsonc
{
  "name": "coupon-web",
  "main": "src/index.ts",
  "compatibility_date": "2026-01-01",
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "coupon-us", "database_id": "..." }
  ],
  "kv_namespaces": [
    { "binding": "KV_HOT", "id": "..." },
    { "binding": "KV_FLAGS", "id": "..." }
  ],
  "r2_buckets": [
    { "binding": "R2_ASSETS", "bucket_name": "coupon-assets" }
  ],
  "vectorize": [
    { "binding": "VEC_OFFERS", "index_name": "offers-us" }
  ],
  "queues": {
    "consumers": [
      { "queue": "sync-offers-prod", "max_batch_size": 100, "max_batch_timeout": 10 }
    ]
  },
  "vars": {
    "PUBLIC_URL": "https://dealsxyz.com"
  },
  "observability": { "enabled": true }
}
```

`workers-best-practices` skill 会审这份配置(streaming、floating promises、bindings)。

## 3. 渲染策略

### 3.1 三种渲染模式并存

| 页面 | 模式 | 缓存 | 更新 |
|------|------|------|------|
| 首页 `/` | SSR + KV 缓存 | KV 5 min | 中台推送 dirty flag 强制刷新 |
| 商家页 `/store/:slug` | SSR + Cache API | 边缘 15 min | offer 更新时清缓存 |
| Offer 详情 `/store/:slug/offer/:id` | SSR | 边缘 5 min | 投票/评论后清 |
| 品类页 `/deals/:category` | SSR | KV 10 min | 中台 sync 后清 |
| 搜索 `/search?q=` | SSR | 不缓存(个性化)| — |
| 用户页 | SSR | 不缓存 | — |
| Sitemap | SSR | R2 每小时生成 | — |

### 3.2 SSR 技术选型

用 **Hono + hono/jsx**:轻量、Cloudflare 首推、能跑 SSR。

```ts
import { Hono } from 'hono';
import { html } from 'hono/html';

const app = new Hono<{ Bindings: Env }>();

app.get('/store/:slug', async (c) => {
  const cacheKey = new Request(c.req.url);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const merchant = await getMerchant(c.env.DB, c.req.param('slug'));
  if (!merchant) return c.notFound();
  const offers = await getOffersByMerchant(c.env.DB, merchant.id);
  const jsonld = buildMerchantJsonLd(merchant, offers);

  const res = c.html(<MerchantPage merchant={merchant} offers={offers} jsonld={jsonld} />);
  res.headers.set('Cache-Control', 'public, s-maxage=900');
  c.executionCtx.waitUntil(cache.put(cacheKey, res.clone()));
  return res;
});
```

## 4. URL 结构(SEO 关键)

见 [07-seo-strategy.md](./07-seo-strategy.md#url-结构),核心:

```
/                                             # Homepage
/store/{merchant-slug}                        # Nike coupons page
/store/{merchant-slug}/offer/{offer-id}       # 单个 offer 详情
/deals/{category-slug}                        # Fashion deals
/search?q=...
/community                                    # 社区首页
/community/submit
/user/{handle}
/blog/{article-slug}
/de/store/... /fr/store/...                   # V1.5 多语言
```

## 5. 点击追踪(核心变现路径)

`GET /go/:offerId` 是**唯一**的联盟跳转入口。任何 outbound 都必须经过它。

```ts
app.get('/go/:offerId', async (c) => {
  const offerId = Number(c.req.param('offerId'));
  const offer = await getOfferById(c.env.DB, offerId);
  if (!offer || offer.status !== 'active') return c.redirect('/', 302);

  const clickId = crypto.randomUUID();
  const country = c.req.raw.cf?.country ?? 'US';
  const finalUrl = injectSubId(offer.affiliate_url, clickId);

  // 异步写点击日志,不阻塞跳转
  c.executionCtx.waitUntil(
    logClick(c.env, {
      offerId, clickId, country,
      referrer: c.req.header('referer') ?? null,
      ip: c.req.raw.headers.get('cf-connecting-ip') ?? null,
      ua: c.req.header('user-agent') ?? null,
    })
  );

  return Response.redirect(finalUrl, 302);
});
```

- **不使用 nofollow-only**:显式 302,SEO 上更安全
- **SubID**:每家联盟支持不同参数名,injectSubId 按 `affiliate_source` 分派
- **点击日志**:先写 Analytics Engine(高吞吐),批处理写 D1,同步进 PG
- **反刷**:同 IP + 同 offer 30 秒内多次点击只记 1 次

## 6. UGC 写路径

### 6.1 投票

```
POST /api/vote
Body: { offerId, direction: 'up'|'down' }
Auth: session cookie 必需
Turnstile token 必需
```

- 写 `user_events_edge`(D1)
- 更新 `offers.vote_up/vote_down` 计数(D1 侧近似值,PG 权威值)
- 中台 pull 后重算 deal_score

### 6.2 评论

```
POST /api/comments
Body: { offerId, parentId?, body }
```

- 长度限制 2000 字符
- 内容过滤:MVP 用简单敏感词表 + Turnstile,V1 加 Perspective API 或 LLM 审核
- 写 D1,异步 push 到 CF Queue → 中台

### 6.3 提交新 deal

```
POST /api/submit
Body: { merchantHint, url, code?, title, discountText, expiresAt? }
```

- 触发爬虫层的 `crawl:submit` 队列(中台代理调用),抓取 URL 补充信息
- `user_submissions` 状态 `pending`
- 管理员审核后,merged 到 `offers`

## 7. 搜索

- **精确/前缀**:D1 `LIKE` + FTS(SQLite FTS5 扩展在 D1 支持)
- **语义**:query embedding → Vectorize top-K → 用 id 从 D1 补详情
- **混合排序**:BM25 * 0.4 + cosine * 0.4 + deal_score * 0.2

## 8. 认证

- Better-Auth on Workers,session 存 KV(TTL 30 天),user 存 D1
- Providers:Email magic link + Google OAuth + GitHub OAuth
- CSRF via double-submit cookie
- Turnstile 反爬保护关键写入

## 9. 缓存失效

- 中台 syncer 推送数据到 Queue,Worker consumer 更新 D1 后:
  ```ts
  await c.env.KV_HOT.delete(`hot:us:${categorySlug}`);
  await purgeUrlCache(`/store/${slug}`);
  ```
- `purgeUrlCache` 用 `caches.default.delete(new Request(url))`
- 大规模失效走 CF API `POST /zones/{id}/purge_cache`(通过中台)

## 10. i18n(V1.5)

- URL 前缀:`/de/`、`/fr/`、`/en-gb/`
- `hreflang` alternate 见 SEO 文档
- 内容翻译:MVP 阶段用 LLM 批量翻译商家描述 / offer summary,人工校对 top 100
- Currency / 日期格式随语言

## 11. 性能预算(每页)

- LCP < 2.0s(3G Fast)
- CLS < 0.05
- INP < 200ms
- Total JS < 100KB(gzipped)—— 大部分页面 SSR + island hydration,或直接零 JS

用 `web-perf` skill 定期审计。

## 12. 反机器人

- 全站 Turnstile(隐式)
- 关键写路径显式 challenge
- IP 级限流(KV 计数):写 API 100/min,读 API 3000/min
- SEO 爬虫豁免(User-Agent 白名单 + reverse DNS 校验)
