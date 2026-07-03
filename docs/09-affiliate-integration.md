# 09 — 联盟集成

联盟是**唯一变现路径**。这一章讲每家网络的接入实操、SubID 追踪、佣金对账。

## 1. 目标联盟网络

| 网络 | 覆盖 | 品类强项 | 接入难度 | 优先级 |
|------|------|----------|----------|--------|
| CJ Affiliate | US 强、UK 中 | 综合、旅游、金融 | 中 | P0 |
| Rakuten Advertising | US、UK、DE | 时尚、百货、电商 | 中 | P0 |
| Impact | 全球 | SaaS、订阅、旅游 | 低(现代 API) | P0 |
| ShareASale | US 强 | 时尚、家居、SaaS | 低 | P1 |
| Awin | UK/DE/FR 强 | 综合、时尚 | 中 | P1(欧洲) |
| Amazon Associates | 全球 | 万物 | 低 | P2(佣金低但覆盖广) |
| Skimlinks | 兜底 | 未直接接入的商家自动匹配 | 低 | P2 |

## 2. 申请前置条件

新站被拒是常态。**先跑起 SEO 内容,3-4 周后再申请**,通过率高得多。

**申请材料模板**:
- 站点定位与目标市场
- 月 UV 预估(说小一点也没事,50k-100k 是普通)
- 内容示例(至少 20 个已发布商家页)
- Privacy Policy / Terms / About / Contact 齐全
- 明确写自己是 coupon site,不藏

## 3. 接入形式(按数据流分)

### 3.1 Product / Offer Feed

**大宗数据来源**。每家联盟提供 CSV / XML / API,我们爬虫层拉取。

| 网络 | 端点 | 频率 | 格式 |
|------|------|------|------|
| CJ | GraphQL API `linksearch` | 每 30 min | JSON |
| Rakuten | Coupon Feed(Advertiser API) | 每 60 min | XML |
| Impact | REST `/Mediapartners/{id}/PromoCodes` | 每 30 min | JSON |
| ShareASale | Coupon Deals feed | 每 60 min | CSV |
| Awin | Voucher Feed(REST + CSV) | 每 60 min | JSON/CSV |

爬虫层 fetcher 见 [04-crawler-layer.md](./04-crawler-layer.md#5-feed-拉取实现要点)。

### 3.2 Deep Link API(生成带 SubID 的落地链接)

用户点击时,我们不能直接用 feed 里给的静态链接(可能没带 SubID / 会过期)。要通过 deep link API 现生成:

- CJ:`links.cj.com` deep link builder,或 `PID` + `AID` 模板拼接
- Rakuten:`click.linksynergy.com/deeplink?...`
- Impact:REST `/Mediapartners/{id}/DeepLinks`
- SAS:`shareasale.com/r.cfm?B=...&U=...&M=...&urllink=...`
- Awin:`awin1.com/cread.php?awinmid=...&awinaffid=...&clickref={subid}&p={target}`

**实现**:每个联盟一个 `DeepLinkBuilder` trait,在 offers 表里存**模板** `affiliate_url`(含占位符 `{clickid}`),边缘 `/go/:offerId` 时替换。

```ts
// src/routes/click.ts
function injectSubId(template: string, clickId: string): string {
  return template.replaceAll('{clickid}', clickId);
}
```

### 3.3 Transaction Reporting(佣金回传)

用于对账、分成、CVR 分析。

| 网络 | 拉取方式 | 频率 |
|------|----------|------|
| CJ | Commissions API | 每天 3 次 |
| Rakuten | Reporting API | 每天 |
| Impact | Actions API | 每天 |
| SAS | REST reports | 每天 |
| Awin | Reporting API | 每天 |

写入 `pg_cleaned.affiliate_transactions`:

```sql
CREATE TABLE affiliate_transactions (
  id            BIGSERIAL PRIMARY KEY,
  network       TEXT NOT NULL,
  network_txn_id TEXT NOT NULL,
  click_id      UUID,                     -- 对回站内 click_logs
  offer_id      BIGINT,
  merchant_id   BIGINT,
  order_amount  NUMERIC(10,2),
  commission    NUMERIC(10,2),
  currency      CHAR(3),
  status        TEXT,                     -- pending / confirmed / reversed
  event_time    TIMESTAMPTZ,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, network_txn_id)
);
```

## 4. SubID 设计

SubID 是回传归因的关键。我们用 `click_id`(UUID v7,时间可排)作为 SubID,同时携带辅助字段:

- **click_id**:主键,匹配 `click_logs.click_id`
- **user_id**(可选):便于用户维度分析
- **offer_id**、**merchant_id**:便于联盟侧看哪个 offer 转化好

各网络 SubID 支持:
- CJ:sid1(仅 1 个),用 `click_id`
- Rakuten:u1(可长字符串),用 `click_id:offer_id`
- Impact:subId1-5,分别写 click_id / user_id / offer_id / merchant_id / country
- SAS:`afftrack`,用 click_id
- Awin:`clickref`(1 个)+ `clickref2-6`,用 click_id + 辅助字段

## 5. Skimlinks / Sovrn 兜底

**问题**:某些商家我们没直接接联盟,但用户提交或爬到了 offer。

**方案**:所有 outbound 链接过 Skimlinks 转换器。已直接接的商家 Skimlinks 会返回原链(不干扰),没接入的会自动加 SubID 走 Skimlinks 分成(commission 分 25% 给 Skimlinks)。

实现在 `/go/:offerId` 前置一层:

```ts
if (offer.affiliate_source === 'unknown') {
  finalUrl = await skimlinks.wrap(offer.direct_url, clickId);
}
```

## 6. Amazon Associates 特殊性

- 单独 API `PA-API 5.0`
- Cookie 有效期 24 小时(比其他联盟短)
- 严格禁止在 email 中直接放 tag 链接(违规封号)
- 建议单独一个 fetcher + 特殊 UI(标注 "Amazon"),不与其他联盟混列

## 7. 对账与报表

- 中台跑每日 job 拉 5 家联盟 transaction,写 `affiliate_transactions`
- 与 `click_logs` join,算:
  - 点击 → confirmed 转化率(EPC)
  - 商家维度 EPC 排行
  - offer 维度 EPC(反哺 deal_score)
- 每周 email 报表给管理员

## 8. 合规必读

见 [10-compliance.md](./10-compliance.md#4-affiliate-披露)。核心:
- **FTC 要求**在页面上显式声明「我们可能通过点击获得佣金」
- 每个 outbound 链接 `rel="sponsored nofollow"`
- Cookie 用途在 Privacy Policy 说明

## 9. 实施优先级

**Sprint 0(2 周)**:
- 提交 CJ、Rakuten、Impact 申请
- 初始 5-10 商家跑通 feed → raw → cleaned → D1 → 前台展示 → 点击 → 302

**Sprint 1-2(4 周)**:
- 接入所有 5 家网络的 feed 拉取
- 接 deep link API
- Transaction 拉取 + 对账 dashboard

**Sprint 3+(持续)**:
- Skimlinks 兜底
- Amazon PA-API
- 商家直接谈(bypass 联盟,佣金更高但要有量)
