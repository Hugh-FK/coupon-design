# 07 — SEO 策略

Coupon 站的核心流量来自搜索引擎,而 Google 对 coupon 类站点的 EEAT(Experience / Expertise / Authoritativeness / Trustworthiness)审查越来越严。SEO 策略必须一开始就做对。

## 1. 关键词矩阵

三层关键词结构:

| 层 | 例子 | 月搜索量(US) | 转化 | 优先级 |
|----|------|---------------|------|--------|
| 头部品牌词 | `nike promo code`、`airbnb coupon` | 10k-100k | 极高 | P0 |
| 长尾场景词 | `nike coupon 20% off`、`nike student discount` | 100-1k | 高 | P1 |
| 品类词 | `fashion coupons`、`saas discounts` | 1k-10k | 中 | P1 |
| 攻略词 | `how to save on nike`、`best deals for gamers` | 100-500 | 低 | P2(内容营销) |

MVP 只重点做 P0 品牌词 + 核心 P1 品类词。

## 2. URL 结构(锁死,不能后期改)

```
/                                     # Homepage — brand + top deals
/store/{slug}/                        # 品牌页,主打「Nike Promo Codes」
/store/{slug}/offer/{id}/             # 单 offer 详情(社区评论、投票、相关)
/deals/{category-slug}/               # 品类聚合页
/deals/{category-slug}/{sub-slug}/    # 子品类
/search                               # 站内搜索(noindex)
/community                            # 社区首页
/community/submit                     # 提交表单(noindex)
/blog/{slug}/                         # 内容营销
/user/{handle}                        # 用户页(noindex, follow)
/de/store/{slug}/                     # V1.5 多语言
/fr/store/{slug}/
```

**规则**:
- 全部小写、连字符、尾斜杠统一(要么全带要么全不带,选一致)
- 不用 query string 承载可索引内容
- 分页用 `?page=2`,rel=next/prev(现在 Google 不再看,但保留结构清晰)

## 3. 页面模板与内容结构

### 3.1 商家页 `/store/{slug}/`(最重要)

页面 title:`Nike Promo Codes: 20% Off + Free Shipping | July 2026`

**内容布局**(每一块都是 SEO 与信任的一部分):
1. **面包屑** Home > Store > Nike
2. **H1**:`Nike Coupons & Promo Codes`
3. **商家概览**:100-200 字介绍 + logo + 官网链接(rel="nofollow sponsored")
4. **Active Offers List**:
   - 每张卡片:折扣、code(点击才显示)、"Get Code" 按钮 → `/go/:offerId`
   - "Verified" / "Community verified" / "Expiring soon" 徽章
   - 展开查看 T&C
5. **Expired Offers**(collapsible)—— SEO 有帮助,但要标 `expired`
6. **How to Use**(编辑内容,Q&A 形式)
7. **User Comments / Reviews**(schema:Review)
8. **Related stores**(内链)
9. **FAQ**(FAQPage schema)

### 3.2 Offer 详情页 `/store/{slug}/offer/{id}/`

- Title:`{Offer Title} - {Merchant Name} | July 2026`
- 主要内容:offer 描述、code 卡片、UGC 评论、"Was this coupon useful?" 投票
- 会有 similar offers 推荐(Vectorize)
- 每个页面独立 canonical

### 3.3 品类页 `/deals/{category}/`

- Title:`Best {Category} Coupons & Deals | Save Today`
- 顶部编辑内容(300-500 字)介绍品类
- Merchant grid + top offers per merchant
- 子品类锚点 + 分页

### 3.4 首页

- Title:`{Brand}: Coupons, Promo Codes & Deals`
- Hero:今日 top 10 deals、今日新增、社区热议
- 大品牌 logo grid → 商家页
- 品类导航
- 社区亮点

## 4. 结构化数据(JSON-LD)

**每个模板都要有**,是 Google 富媒体展示和 EEAT 的关键。

- 商家页:`Organization` + `BreadcrumbList` + `FAQPage` + 每张 offer 卡 `Offer`
- Offer 页:`Offer` + `Product`(商家有多品类时选主品类)+ `Review`(UGC)+ `AggregateRating`
- 首页:`WebSite` + `SearchAction`

```json
{
  "@context": "https://schema.org",
  "@type": "Offer",
  "name": "20% off sitewide at Nike",
  "url": "https://dealsxyz.com/store/nike/offer/123",
  "priceCurrency": "USD",
  "availability": "https://schema.org/InStock",
  "validFrom": "2026-06-15",
  "validThrough": "2026-08-01",
  "offeredBy": {
    "@type": "Organization",
    "name": "Nike",
    "url": "https://nike.com"
  }
}
```

**AggregateRating** 从 UGC 投票聚合:`ratingValue = up/(up+down) * 5`。

## 5. 内链与站点结构

**目标**:任一深度页三跳可达首页,权重集中给商家页和品类页。

- 首页 → top 200 商家(直接链接)
- 商家页 → 相关 3-5 个商家 + 所属品类(内链)
- 品类页 → 子品类 + top 商家
- Offer 详情页 → 商家页 + 相关 offer(3-5 个)
- Blog → 商家页 / 品类页(锚文本自然)

Sitemap 分片:
- `/sitemap.xml`(索引)
- `/sitemap-merchants.xml`(商家页,10k / 文件)
- `/sitemap-offers.xml`(offer 页,只放 active 且 deal_score > 60 的)
- `/sitemap-categories.xml`
- `/sitemap-blog.xml`

## 6. 内容策略

### 6.1 编辑内容(必须有,别只堆爬虫数据)

- 每个 top 500 商家:200-500 字商家介绍(LLM 起草 + 人工润色)
- 每个品类页:400-800 字品类导购
- Blog:每周 2-3 篇长文攻略,如 "10 Ways to Save at Nike in 2026"

### 6.2 UGC 是内容护城河

评论、投票、"用过后反馈"都是**独家内容**。RetailMeNot 与 Slickdeals 的 EEAT 优势就是这个。

- Offer 详情页强制展示评论区,即使 0 条也放"Be the first to comment"
- 评论区结构化数据 → Google Rich Results

### 6.3 AI 生成内容红线

- **不要**大量堆 AI 生成的营销话术
- **可以**用 AI 做草稿 + 人工校对
- 商家页头部编辑内容必须人工过一遍

## 7. Technical SEO Checklist

- [ ] `robots.txt` 允许 Googlebot / Bingbot,禁止爬取 `/api/`、`/go/`、`/search`、`/user/`
- [ ] `<meta name="robots" content="noindex">` 用于 `/search`、`/community/submit`、`/user/*`
- [ ] canonical 每页都有,分页页 canonical 指向自身(不指首页)
- [ ] hreflang(V1.5 后):每语言版本互相引用
- [ ] Open Graph + Twitter Card 全站
- [ ] `preload` 关键字体,fonts 用 `font-display: swap`
- [ ] LCP < 2.0s、CLS < 0.05、INP < 200ms
- [ ] 图片全部 WebP + 显式尺寸 + lazy loading
- [ ] 没有客户端渲染的关键内容(SSR 保证首屏 HTML 完整)
- [ ] 面包屑显式渲染 + `BreadcrumbList` schema
- [ ] 404 / 410 正确返回状态码,不用 200 + "页面不存在"
- [ ] Google Search Console + Bing Webmaster + IndexNow 提交

## 8. 反爬 vs SEO 平衡

- Googlebot / Bingbot 通过 UA + reverse DNS 校验后放行
- 其他爬虫走 Turnstile 或速率限制
- **不要**给 Googlebot 展示与用户不同的内容(cloaking) —— 会被降权

## 9. 联盟链接的 SEO 处理

- 所有 outbound 联盟链接:`rel="sponsored nofollow"`(FTC 合规 + Google 政策)
- `/go/:offerId` 302 跳转,不是 meta refresh
- 商家官方站链接(非联盟):`rel="nofollow"`

## 10. 监控指标

- Search Console:impressions、clicks、CTR、平均排名(每周复盘)
- 商家页 index 覆盖率(目标 > 90%)
- Core Web Vitals(用 CWV field data + 实验室 Lighthouse)
- CTR 异常波动预警(某关键词一夜跌 30% → 手工核查)

## 11. 反面清单(不要做)

- **不要**做 doorway pages(每关键词一个几乎重复的落地页)
- **不要**做 exact match domain 农场(多个域名做同一件事)
- **不要**买链接
- **不要**在商家页刷 fake reviews
- **不要**过期 offer 页留着 200 状态且不标 expired —— 用户会举报,Google 会降权

## 12. 与其他文档联动

- URL 结构与 SSR:[06-edge-frontend.md](./06-edge-frontend.md)
- UGC 内容质量:[08-community-ugc.md](./08-community-ugc.md)
- 联盟链接合规:[09-affiliate-integration.md](./09-affiliate-integration.md)、[10-compliance.md](./10-compliance.md)
