# 04a — 竞品爬取方案(15+ 站)

爬竞品是**冷启动数据来源**、**商家名单**、**offer 覆盖率对比**、**长尾关键词发现**的四合一。先爬透 15 家再做联盟接入,可以省 4-6 周的空转。

## 1. 目标与红线

**目标**:
1. 快速拿到 5000+ 商家的规范化名单(slug、domain、logo)
2. 采集 50k+ active offers(即使部分过期,也能补齐 SEO 长尾页)
3. 学习竞品的分类体系、页面结构、UGC 投票机制
4. 每周监测 top 10 竞品 top 500 商家页,发现新品牌 / 新品类

**红线**:
- **不复制原创内容**(编辑撰写的商家介绍、blog 文章)—— 版权与 SEO 双风险
- **不搬运 UGC 评论文本** —— 用户版权在竞品站
- **不使用竞品的商家 logo 直链** —— 通过商家官网重新抓 favicon / og:image
- **只采公共可见数据**,不做登录后爬取
- **尊重 robots.txt** 除非有法律顾问明确许可

采回来的东西只用于:商家名单参考、offer 存在性对比(去重)、我方 offer 的验证参考、分类结构学习。**最终展示给用户的必须是我方联盟 feed 或 UGC 提交的数据**。

## 2. 竞品清单与优先级

| # | 站点 | 类型 | 数据价值 | 反爬难度 | 优先级 |
|---|------|------|----------|----------|--------|
| 1 | RetailMeNot | 综合 | ★★★★★ 最大商家覆盖,分类完善 | ★★★★ (Cloudflare + DataDome) | P0 |
| 2 | Slickdeals | 社区 | ★★★★★ 有社区投票,deal_score 参考 | ★★★ (基础反爬) | P0 |
| 3 | CouponFollow | 综合 | ★★★★ 商家覆盖广,structure 简单 | ★★ (无 SPA) | P0 |
| 4 | Coupons.com | 综合 | ★★★ 品牌合作深,印刷券 | ★★★★ (登录墙 + Akamai) | P1 |
| 5 | Honey (joinhoney.com) | 插件 | ★★★ 商家名单参考 | ★★★★★ (JSON API 私有) | P2 |
| 6 | Rakuten (Ebates) | 返现 | ★★★ 商家名单 + 佣金率提示 | ★★★★ (登录墙) | P1 |
| 7 | Wethrift | AI 综合 | ★★★★ 数据覆盖广 | ★★ (SSR HTML) | P0 |
| 8 | DealCatcher | 综合 | ★★★ 编辑内容多 | ★ (静态 HTML) | P1 |
| 9 | Knoji | 综合 | ★★★ 商家 API 透明 | ★★ | P1 |
| 10 | Groupon Coupons | 综合 | ★★★ 商家覆盖美国广 | ★★★ | P1 |
| 11 | Offers.com | 综合 | ★★★ | ★★★ | P2 |
| 12 | HotUKDeals | 英国社区 | ★★★★ 英国核心站 | ★★★ | P1(欧洲) |
| 13 | MyDealz.de | 德国社区 | ★★★★ 德国核心站 | ★★★ | P1(欧洲) |
| 14 | Dealabs.com | 法国社区 | ★★★★ 法国核心站 | ★★★ | P1(欧洲) |
| 15 | Reddit /r/coupons | UGC | ★★★ 长尾 code + 讨论 | ★ (公开 API) | P0 |
| 16 | GoBankingRates(编辑站) | 攻略 | ★★ 关键词灵感 | ★ | P2 |
| 17 | CNET Coupons | 编辑站 | ★★★ 商家 SEO 竞对 | ★★ | P2 |

**先爬 P0 五家 + Reddit** —— 数据量已够撑 MVP,延迟其他站到 V1 阶段。

## 3. 每站爬取方案

### 3.1 RetailMeNot 🌟

- **入口**:`/coupons/all-stores`(A-Z 索引页)→ 商家详情 `/view/{brand}`
- **结构**:Next.js SPA,SSR + hydration。fetch HTML 拿到大部分数据
- **策略**:`HtmlListingAdapter` + Playwright(反爬绕过)
- **反爬**:Cloudflare + DataDome。需要 Playwright + rebrowser-patches。若失败降级 Bright Data Web Unlocker
- **节奏**:全站每周 1 次(A-Z 索引);top 500 商家页每 24h;新增商家发现每 6h 增量扫索引
- **抓取字段**:merchant name、domain、offer title、code、expiry、verified badge、community 反馈计数
- **数据处理**:merchant slug 归一化(rmn 是 kebab-case,与我方一致)、code 大写去空格
- **风险**:反爬升级导致大面积失败 → 降级为只抓 sitemap 变化清单

### 3.2 Slickdeals 🌟

- **入口**:`/deals` 首页 + `/coupons`(编辑维护的 coupon 板块)+ 分类页
- **结构**:传统 SSR + JSON XHR 混合。Deal 详情页有 vote / comment count
- **策略**:`ApiAdapter` 优先(内部有 JSON endpoint,如 `/newsearch/dealsphp`)+ HTML 兜底
- **反爬**:基础级(UA 检查 + 每 IP QPS 限制)。住宅代理 + 1 req/s 即可
- **节奏**:热门 deal 页 1h 增量;coupon 编辑页 6h;分类首页 24h
- **抓取字段**:title、merchant、price、"Frontpage" 徽章、up vote、down vote、评论数(不抓评论文本)
- **独特价值**:社区投票是"这个 deal 值不值"的强信号,直接影响 deal_score 初始值
- **风险**:内部 API 变更(季度节奏)—— fixture 测试兜底

### 3.3 CouponFollow

- **入口**:`/site/{brand}.com`(URL 直接是商家 domain)
- **结构**:纯 SSR HTML,无 SPA
- **策略**:`HtmlListingAdapter`,fetch + cheerio 就够
- **反爬**:轻(UA + 简单速率限制)。1 req/s 无代理即可
- **节奏**:全站 sitemap 每 3 天一次(数万商家)+ top 商家页 12h
- **抓取字段**:title、code、expiry、"Verified today" 时间戳(重要,用于我方 verified 判断参考)
- **加分**:URL 结构 `couponfollow.com/site/{domain}` 天然给我方 merchant slug 提示

### 3.4 Coupons.com

- **入口**:`/coupon-codes/` + 商家搜索
- **结构**:登录墙(部分 offer 需登录)+ Akamai
- **策略**:只抓公开部分,登录后不动。`HtmlListingAdapter`
- **反爬**:高。需要 Playwright + 持久 cookie + 慢速(0.5 req/s)
- **节奏**:top 500 商家 24h,不做全站
- **风险**:登录墙比例上升 → 降优先级或放弃

### 3.5 Wethrift 🌟

- **入口**:`/{brand}-promo-codes`(URL 用商家 slug)
- **结构**:纯 SSR
- **策略**:`SitemapAdapter`(sitemap 覆盖全站)
- **反爬**:轻
- **节奏**:sitemap 每天扫,详情页 2h 更新
- **抓取字段**:title、code、"Last verified"、"AI generated summary"
- **独特价值**:Wethrift 用 AI 摘要 offer,对比可以校准我方 AI 摘要质量

### 3.6 DealCatcher

- **入口**:`/coupons` + 分类页
- **结构**:传统 CMS,静态 HTML
- **策略**:`HtmlListingAdapter`,零反爬
- **节奏**:全站 24h
- **抓取字段**:offer + 编辑评分(`Editor's Pick` 徽章)—— 参考"人工筛选"信号

### 3.7 Knoji

- **入口**:`/{brand}-promo-codes`
- **结构**:SSR + 部分内部 JSON API 公开
- **策略**:`ApiAdapter` 探索 + HTML 兜底
- **反爬**:低
- **节奏**:top 商家 12h
- **加分**:Knoji 有商家评分与 policy 分析,可作为 merchant.trust_score 输入

### 3.8 Groupon Coupons

- **入口**:`/coupons` + 分类
- **结构**:SSR + Angular
- **策略**:Playwright(部分内容 hydration 后才可见)
- **反爬**:中(UA + geo 检查)
- **节奏**:top 商家 24h
- **风险**:Groupon 主业不是 coupon,数据密度不如专门站

### 3.9 HotUKDeals / MyDealz / Dealabs 🌟(欧洲阶段 P0)

三站同一集团(Pepper),结构近似 Slickdeals。**欧洲市场必爬**。

- **入口**:`/hot`、`/new`、`/coupons`
- **结构**:SSR + REST JSON(如 HotUKDeals 有 `/rest_api/v2/thread`)
- **策略**:`ApiAdapter`(优先)
- **反爬**:中(Cloudflare + rate limit)
- **节奏**:hot 页 30 min;coupon 分区 4h
- **独特价值**:欧洲商家覆盖(Argos、Currys、Boots、Zalando、Otto、Fnac、La Redoute...)

### 3.10 Reddit /r/coupons、/r/deals、/r/frugal

- **入口**:`https://www.reddit.com/r/coupons/new.json?limit=100`
- **结构**:Reddit 官方 JSON API(`.json` 后缀)
- **策略**:`ApiAdapter`,直接 JSON
- **反爬**:轻,遵守 UA 要求(`YourAppName/1.0 by u/yourhandle`)
- **节奏**:每 30 min 拉新帖
- **加分**:自然语言处理提取 code + brand,长尾码来源

## 4. 站点优先级 → 时间表(3 个月内)

| 阶段 | 上线站点 | 累计商家 | 数据用途 |
|------|----------|----------|----------|
| Week 1 | CouponFollow + DealCatcher(反爬最低) | 3k | 商家名单 + 首批 SEO 页 |
| Week 2 | Slickdeals + Reddit | 3.5k(补 offer)| 社区投票信号、长尾码 |
| Week 3 | Wethrift + Knoji | 5k | AI 摘要参考 |
| Week 4 | RetailMeNot(需先解反爬)| 8k | 覆盖度补齐 |
| Week 6 | HotUKDeals(欧洲 P1 前站)| 10k | 欧洲市场准备 |
| Week 8+ | MyDealz、Dealabs、Coupons.com、Groupon | 15k+ | 长尾覆盖 |

## 5. 采到的数据如何进入我方系统

**关键**:竞品数据只进 `crawler.raw_offers`,标 `source_type = 'competitor_scrape'`。中台清洗时:

1. **商家匹配**:优先按 `merchant_hint` 的 domain 匹配已有商家。找不到 → 新建 `platform.merchants` `status = 'pending'`(不上线)
2. **Offer 去重**:如果同一 code 已经从联盟 feed 拿到,竞品数据只用于**验证一致性**(比如竞品显示 verified 但我方 30 天没验过 → 触发 revalidator)
3. **发现新商家**:竞品有、我方联盟没有 → 加入"待联盟接入清单",人工/半自动申请该商家的联盟 offer
4. **发现新 offer**:竞品有、我方没有 → 中台标记 `needs_verification`,爬虫层追加 job:去商家官方 coupon 页 crossref,若能验证 → 尝试通过 Skimlinks 转成有归因的落地 URL,归入 `affiliate_source = 'skimlinks'`,展示时清晰披露
5. **不允许**的路径:直接把竞品的 `affiliate_url` 展示给用户 → 违反竞品 TOS,佣金也不属于我方

## 6. 反爬工具箱(按投入排序)

| 方案 | 覆盖 | 月成本 | 难度 |
|------|------|--------|------|
| 直接 fetch + UA 池 | 30% 站(简单站) | $0 | 低 |
| Playwright + stealth | 80% 站 | 服务器成本 $80-200 | 中 |
| 住宅代理(Bright Data / Oxylabs) | 95% 站 | $200-500 | 中 |
| Web Unlocker(Bright Data) | 99% 站 | $3-5/1000 请求 | 低但贵 |
| FlareSolverr(自建) | Cloudflare 站 | 免费但不稳定 | 中 |
| Rebrowser-patches Playwright | 高级反爬 | 免费 | 高 |

**MVP 阶段选**:Playwright + stealth + 住宅代理,月成本 $250 内可跑 P0 五家。

## 7. 单站故障降级

**开关分级**(在中台 Admin 后台):
- `enabled` — 正常运行
- `throttled` — 只做 top 100 商家
- `paused` — 停止调度但保留 cursor
- `disabled` — 完全禁用

**自动降级触发**:
- 24h 数据入库 = 0 → `throttled`
- 错误率 > 50% 持续 1h → `paused`(通知)
- 连续 3 次 discovery 找不到入口 → `paused`

**兜底**:任一站长期 `paused` 不影响其他,MVP 目标覆盖不依赖单一站。

## 8. 合规与法律

- 所有 adapter 默认尊重 `robots.txt`;绕过需要在 config 里显式 `bypassRobots: true` + 法律顾问签字
- 采集数据仅用于内部匹配与决策,**不直接对外展示原样文本**(除了 code 本身,code 不受版权保护)
- 若竞品发律师函(Cease & Desist),24h 内停止 adapter 并回复
- 记录每次采集的 `robots.txt` 抓取时间戳、`respected` 标记,以备审计

## 9. 与其他文档联动

- Adapter 契约与队列:[04-crawler-layer.md](./04-crawler-layer.md)
- 竞品数据在中台的处理:[05-middle-platform.md](./05-middle-platform.md#42-processor)
- 更新触发链路:[05a-update-strategy.md](./05a-update-strategy.md)
