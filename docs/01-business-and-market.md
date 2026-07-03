# 01 — 商业模式与市场

## 1. 市场定位

**一句话定位**:面向北美 + 英/德/法用户的「有社区背书」的 coupon & deals 聚合站,通过联盟返佣变现,通过 UGC 内容和社区投票建立信任壁垒和 SEO 护城河。

## 2. 竞品坐标

| 竞品 | 内容来源 | 变现 | 核心壁垒 | 我们对标点 |
|------|----------|------|----------|------------|
| RetailMeNot | 编辑运营 + 用户提交 | 联盟 + 广告 | 品牌 + 商家关系 | UGC 提交、编辑审核流 |
| Slickdeals | 90% 用户提交 + 投票 | 联盟 | 社区活跃度 | 投票机制、Deal Score |
| Honey / Rakuten | 浏览器插件 + 返现 | 联盟返现 | 一键使用体验 | 远期做插件,但 MVP 不做 |
| Coupons.com | 品牌合作 + 编辑 | 广告 + 印刷券 | 商家直连 | 不对标 |
| Wethrift | 爬虫 + AI 生成 | 联盟 | 数据覆盖广 | 参考爬虫覆盖策略 |

**差异化路径**:RetailMeNot 的商家覆盖 + Slickdeals 的社区投票机制 + AI 辅助的内容质量控制。

## 3. 用户画像

- **主用户 (P0)**:25-45 岁美国/英国用户,月消费 500-3000 USD,每次网购前会 Google「brand + coupon code」或「brand + promo code」。SEO 是最大流量来源。
- **次用户 (P1)**:社区活跃用户(约总用户 5%),提交 deals、投票、评论,是内容供给方。给他们 karma / badge / 排行榜。
- **长尾用户 (P2)**:通过 Reddit、Facebook Group 等外链进入的一次性用户,收 email 转订阅。

## 4. 变现模型

### 4.1 主收入:联盟返佣

用户在我方站点点击「Get Code / Go to Store」→ 302 跳到联盟深链接(带 SubID 追踪) → 用户在商家下单 → 联盟网络回传订单 → 我方按 CPS 抽成。

**假设(保守)**:
- CTR(卡片曝光→点击 outbound):8%
- CVR(联盟侧点击→下单):3%
- AOV:$60
- 平均佣金率:5%
- 单次点击预期收入(EPC):$0.09

**收入公式**:`月收入 ≈ 月 UV × 页均 outbound 点击率 × EPC`

例:月 UV 100 万,人均 0.4 次 outbound → 40 万点击 × $0.09 = **$36k/月**

### 4.2 二线收入(V1.5+)

- 商家 Featured 位:$500-2000 / 月 / 品类首页
- Newsletter 广告位:CPM $20-40
- Chrome 插件返现分润(远期)

### 4.3 不做的

- 不做付费墙、不做用户订阅费(coupon 站付费转化极低)
- 不做展示广告(GSC / AdSense),会稀释联盟点击并伤害 UX

## 5. 单位经济(Unit Economics)

| 指标 | 目标 |
|------|------|
| 内容生产成本 | 爬虫 + AI 摘要,单条 SKU 数据成本 < $0.001 |
| SEO 用户获取成本(CAC) | ≈ $0(自然流量为主) |
| 付费获取(SEM,仅品牌词) | CAC 目标 < $0.5,ROAS > 3 |
| Cloudflare 基础设施 | Workers + D1 + R2:MVP $50/月,10 万 UV 阶段 $200-500/月 |
| 中台 + 爬虫服务器 | 单 VPS(4c8g)$40/月 起步,爬虫扩容按需 |

## 6. 首发商家 / 品类清单(MVP)

- **品类**:Fashion、Electronics、Home、Food Delivery、Travel、SaaS(高佣金)
- **首发商家**(优先接入联盟深链):
  - CJ:Priceline、Barnes & Noble、Overstock、GoDaddy
  - Rakuten:Nike、Walmart、Macy's
  - Impact:Uber、Airbnb、Adidas
  - ShareASale:Reebok、Grammarly、NordVPN
- **目标覆盖**:MVP 500 个商家 / 5k 条活跃 coupon,V1 结束 5000 商家 / 50k 条

## 7. 关键假设与风险

| 假设 | 验证方式 | 风险 |
|------|----------|------|
| SEO 能撑起 70% 流量 | 3 个月内 100+ 关键词进 top 20 | Google 对 coupon 站 EEAT 要求越来越高 |
| 用户会提交 UGC | 上线 8 周内自然产生 100+ 条提交 | 冷启动期需运营 seed |
| 联盟审核通过率 > 60% | 提交 3 家试跑 | 新站被拒需先养流量 |
| Coupon 有效率 > 70% | 用户投票 + AI 校验 | 无效码是最大用户投诉源 |

## 8. 与其他文档的联动

- SEO 策略见 [07-seo-strategy.md](./07-seo-strategy.md)
- 联盟接入细节见 [09-affiliate-integration.md](./09-affiliate-integration.md)
- 增长 / 社区机制见 [08-community-ugc.md](./08-community-ugc.md)
