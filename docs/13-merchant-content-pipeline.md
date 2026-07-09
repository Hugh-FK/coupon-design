# 13 — 商家内容生产流水线

**问题**:5000+ 商家页,每页都需要「关于该商家」+「核销流程」+ FAQ,还要过 Google EEAT 审查。纯手工不可能(工作量爆炸),纯 LLM 生成会被判 thin content 降权。

**方案**:**多源数据聚合 → LLM 起草(带引用)→ 分层审核 → 定期刷新**。首批 top 500 人审、5000 自动兜底、10000 长尾放 noindex,90 天全刷新一次。

## 1. 每个商家页的内容槽

前台组件对应的**必填**与**可选**内容块:

| 槽位 | 必需 | 字数 / 结构 | 结构化数据 | 刷新周期 |
|------|------|-------------|------------|----------|
| Hero(name / logo / tagline / active offer count) | 必需 | ≤ 30 字 tagline | `Organization` | 联盟 feed 变化时 |
| **About(商家介绍)** | 必需 | 200-500 字 | `Organization.description` | 90 天 |
| Active offers list | 必需 | 结构化 | 每条 `Offer` | 数据变即刷 |
| **Redemption(核销流程)** | 必需 | 5-8 步 + 备注 | `HowTo` | offer_type 或 checkout flow 变时 |
| Common issues / FAQ | 必需 | 3-8 问 | `FAQPage` | 90 天 |
| Shipping & Returns snippet | 可选(有数据才放) | 100-200 字 | `Store.paymentAccepted` 等 | 180 天 |
| Verified badge + timestamp | 必需 | 结构化 | `verifiedTime` | 每次 L1/L2 校验后 |
| Related merchants(4-6 家) | 必需 | 内链 | — | 每天(基于共现) |
| UGC 评论 & 评分 | 必需(空态也放) | 用户写 | `Review` / `AggregateRating` | 用户产出即时 |
| Editorial 编辑推荐(top 100) | 可选 | 100-200 字 | — | 手动 |

结构化数据规则见 [07-seo-strategy.md](./07-seo-strategy.md#4-结构化数据jsonld)。**空态严禁隐藏槽位** —— Google 会因结构不完整降权;显式"Be the first to review"等文案兜底。

## 2. 数据源(按可信度排序)

绝不能只用一个源。**每个字段都必须至少 2 个源交叉验证**,LLM 生成的话必须给出 source_refs,便于回滚与 fact-check。

| 源 | 拿什么 | 可信度 | 合规 | 备注 |
|----|--------|--------|------|------|
| **联盟 feed 元数据**(CJ/Rakuten/Impact/SAS/Awin) | 商家 description / category / logo / shipping_countries | ★★★★★ | ✓ 授权使用 | 商家自己填,权威 |
| **商家官网 `/about`、`/help`、`/faq`、`/shipping`、`/returns`** | 长文案、核销说明、退货政策 | ★★★★★ | ⚠️ 只作 LLM 事实来源,不整段照搬(版权) | 爬虫层专门有个 adapter 抓这些页,详见 §4.1 |
| **Wikipedia**(商家条目) | 历史、总部、创始年份、母公司 | ★★★★ | ✓ CC BY-SA,标注来源 | 引用即可 |
| **BBB / Trustpilot 公开摘要** | 用户评分、常见投诉主题 | ★★★ | ⚠️ 只用聚合数字,不复制评论文本 | 反映真实体验 |
| **联盟平台的 merchant briefing PDF** | 佣金率、允许 promo type、SEM 政策 | ★★★★★ | ✓ 商家授权 | 只影响内部策略,不展示 |
| **UGC:用户提交的"tips"字段** | "记得先登录再填码"这类经验 | ★★★★(经审核) | ✓ 用户协议授权 | 加"Community tip"标 |
| **竞品站(RetailMeNot 等)** | **仅用于覆盖度对比** | — | ❌ 不作为文案来源 | 见 [04a-competitor-crawling.md §5](./04a-competitor-crawling.md#5-采到的数据如何进入我方系统) |
| **LLM 生成** | 综合改写、翻译、扩写 FAQ | ★★★(需 fact-check) | ✓ 但必须有引用 | 唯一能扩展至 5000 商家的杠杆 |

## 3. 生成 Pipeline(6 阶段)

```
每商家(cron 或首次上线)
  │
  ▼
[1] Aggregate       多源抓取合并 → merchant_content_sources
  │
  ▼
[2] Draft (LLM)     Claude Haiku,输入 sources,输出各槽 draft
  │
  ▼
[3] Verify (LLM)    另一个 prompt 做 fact-check(核对创始年份、退货天数、shipping 国家等)
  │  score < 0.8 → 打回 [2] 或转人审
  ▼
[4] Human review    分层:top 100 必审;101-500 抽 20%;500+ 自动
  │
  ▼
[5] Publish         写 platform.merchant_content(version+1) → app → D1
  │  同时刷 sitemap 与 KV
  ▼
[6] Refresh loop    每 90 天 diff:如果源数据变化 > 阈值 → 从 [2] 重跑
                    (feed description 变、Wikipedia 大改、offer 类型分布变)
```

### 3.1 [1] Aggregate — 数据集成

爬虫层新增一个 `merchant-info` adapter,专门抓非-offer 数据:

```
crawler.merchant-info fetch(merchant_slug, domain)
  → try:
     - GET https://{domain}/about  → HTML → LLM 抽取
     - GET https://{domain}/help,/faq,/customer-service → HTML → LLM 抽取
     - GET https://{domain}/shipping,/delivery → HTML → LLM 抽取
     - GET https://{domain}/returns,/refund → HTML → LLM 抽取
     - Wikipedia API: /w/api.php?action=parse&page={brand}
     - Trustpilot public JSON:https://api.trustpilot.com/v1/business-units/find?domain={domain}
     → 全部写入 crawler.raw_pages,`source_type='merchant-info'`
```

Rust 中台的 processor 读 raw_pages,归入 `platform.merchant_content_sources`。

### 3.2 [2] Draft — LLM 起草

**核心 prompt**(About 段示例,参考 [claude-api skill](https://docs.anthropic.com/en/api/) 的 prompt caching 最佳实践):

```
[System]
You write "About" sections for a coupon aggregator website targeting US shoppers.
Voice: neutral, informative, 3rd person. NO marketing hype. NO superlatives ("best", "amazing").
Length: 200-350 words. Never invent facts.

Every factual claim MUST cite one of the SOURCES with a [S1], [S2]... marker.
If you cannot cite a claim, omit it.

[User]
MERCHANT: Nike (nike.com)

SOURCES:
[S1] Wikipedia excerpt: {trimmed_wikipedia_content}
[S2] Nike affiliate feed description (CJ): {feed_description}
[S3] Nike /about page excerpt: {scraped_about_excerpt}
[S4] Nike /shipping page excerpt: {scraped_shipping_excerpt}

REQUIRED SECTIONS (in order):
1. What the merchant sells (1 sentence)
2. History or scale (1-2 sentences) — cite Wikipedia
3. Product categories most shoppers care about (2-3 sentences)
4. Notable customer-facing benefits: free shipping threshold, membership program, student discount (only if in sources)
5. What kind of coupons this merchant typically offers (percent off / freeship / member-only) — infer from active offers metadata provided below

ACTIVE OFFER STATS:
- Types: {40% percent, 30% freeship, 30% deal}
- Median discount: 20% off
- Verified last 30 days: 12 codes

Return JSON:
{
  "content": "...text with [S1] citations...",
  "citations": [{"marker":"S1","source_id":123}, ...],
  "confidence": 0.0-1.0,
  "notes": "any caveats"
}
```

对应生成 Redemption / FAQ / Shipping 段的 prompts 结构相同,只换 REQUIRED SECTIONS。

**技术要点**:
- 用 Claude Haiku(便宜快)+ prompt caching(source 部分是稳定前缀 → 命中率高 → 成本降 90%)
- Batch API 一次 100 家,单价 $0.005 / 家
- 每个 draft 附带 `confidence` 与 `citations`,进入 [3]

### 3.3 [3] Verify — LLM 事实核查

用另一个 prompt 做 adversarial:输入 draft + sources,提问"每个 [S] 标记的事实,能在对应 source 中找到吗?"

```
[System]
You are a fact-checker. For each [Sx] citation in the draft, verify the fact is in Sx.
Return {claim, source_id, verdict: "supported" | "not_found" | "contradicted", evidence}
```

- 全 supported → confidence 保持
- 有 not_found / contradicted → confidence -= 0.2 每处,若 < 0.6 → 打回 [2] 重生;仍不过 → 走人审
- **这一步与 [2] 用不同 model temperature**(verifier temp=0)避免同源幻觉

### 3.4 [4] Human review — 分层审核

见 §7 分层运营。

**审核 UI**(Admin 后台):
- 左边:LLM draft(可编辑)
- 右边:所有 sources 高亮 + citation 跳转
- 顶部:confidence、fact-check 报告
- 一键操作:Approve / Reject / Request regenerate / Save as new version

审核员平均 3-5 min / 商家(top 100 首次)、1-2 min / 商家(复审)。

### 3.5 [5] Publish — 版本化写库

**永不覆盖历史**,每次生成新版本,`is_current` 标位最新:

```sql
UPDATE platform.merchant_content SET is_current = false WHERE merchant_id = ?;
INSERT INTO platform.merchant_content (merchant_id, version, is_current, slots, ...) VALUES (?, next_ver, true, ...);
```

写入后 emit `change_event('merchant', merchant_id, 'upsert')`,走[05a 更新链路](./05a-update-strategy.md)传播到 app / D1。

### 3.6 [6] Refresh — 自动检测过期

每天扫一次:

```sql
SELECT m.id FROM platform.merchants m
JOIN platform.merchant_content mc ON mc.merchant_id = m.id AND mc.is_current
WHERE
  mc.published_at < NOW() - INTERVAL '90 days'
  OR mc.source_snapshot_hash != current_source_hash(m.id)  -- source 内容变了
  OR offer_type_distribution_shifted(m.id, threshold => 0.2);  -- offer 结构变了
```

命中的 merchant 重新走 [2]。**如果 [2] 生成的 content 与上一个 version 语义相似度 > 0.9(用 embedding cosine)→ 不更新 `published_at`,只 bump `refreshed_at`**(避免刷"看似更新实际没变"的日期,污染 GSC 信号)。

## 4. 核销流程(Redemption)专题

用户最关心的槽,也是我们比竞品做得更细的关键差异化点。**按 `offer_type` 分模板**,同一商家可能有多种模板并列展示。

### 4.1 五种核销模板

**A. Code(可见 code)**
```
1. Copy the code above (click "Copy").
2. Head to {merchant_name}'s website → add items to cart.
3. On the checkout page, find the field labeled "{promo_field_label}".
4. Paste the code and click "{apply_button_label}".
5. The discount will appear as a line item before you pay.
```
- `{promo_field_label}` 与 `{apply_button_label}` 从 [platform.merchant_extension_rules](./12-browser-extension.md#41-每商家的-rule-结构) 复用(与浏览器插件同源!)
- 备注区:是否需先登录、是否与其它优惠叠加、是否包邮组合

**B. Click-reveal(点击才显 code)**
```
1. Click "Get Code" — we'll open {merchant_name} in a new tab and reveal the code on this page.
2. In the new tab: add items to cart → go to checkout.
3. Return to this tab to copy the code.
4. Paste it in the "{promo_field_label}" field at checkout.
```

**C. Deal(链接直接生效)**
```
1. Click "Get Deal" — you'll be taken to the discount page automatically.
2. Add the discounted items to your cart.
3. The discount will show at checkout — no code needed.
```

**D. Free shipping**
```
1. Click "Get Code" and copy the free-shipping code.
2. Add items totaling at least ${min_spend} (if required).
3. At checkout, enter the code in "{promo_field_label}".
4. Shipping cost will drop to $0 before you pay.
```
- 若无 min_spend 与 code(纯自动免运费)→ 用 C 模板变体

**E. Printable / in-store**
```
1. Click "Print Coupon" and print the PDF (or save to your phone).
2. Bring it to any participating {merchant_name} store.
3. Show it at checkout before payment.
4. Expires {expires_at}.
```

**F. Student / Military / Age-gated**(变体)
```
1. Verify eligibility at {verification_provider} (SheerID / ID.me).
2. Once verified, log in on {merchant_name}.
3. The discount applies automatically at checkout (no code needed).
```

### 4.2 每商家可覆盖的字段

存 `platform.redemption_playbooks`(见 §5 数据表):

| 字段 | 用途 |
|------|------|
| `promo_field_label` | "Promo Code" / "Coupon" / "Discount Code"(不同商家叫法不同) |
| `apply_button_label` | "Apply" / "Add" / "Redeem" |
| `checkout_url_hint` | "In the cart, click 'Proceed to Checkout'" |
| `login_required` | true → 模板加"⚠️ Must be logged in first" |
| `stacking_policy` | "One code per order" / "Combines with sale items" |
| `common_pitfalls` | 数组:"Doesn't work on gift cards", "Excludes clearance items" |
| `alternate_flows` | 如 App vs Web 流程不同 |

LLM 根据商家 help 页填这些字段;人审校正。

### 4.3 与浏览器插件的复用

- 插件的 auto-fill rule(§4.1 [12-browser-extension.md](./12-browser-extension.md#41-每商家的-rule-结构))提供 selector
- 核销流程模板提供人类可读描述
- **同一份底层数据,双处消费**:一份来源、两个视角
- 若插件 rule 的 auto-fill 成功率 > 90%,可以在流程文案里加一段:"Or install our browser extension to auto-apply codes."

## 5. 数据表增量

在 [03-data-model.md](./03-data-model.md) 的 platform / app 追加:

```sql
-- 版本化商家内容(每次生成新 version)
CREATE TABLE platform.merchant_content (
  id                BIGSERIAL PRIMARY KEY,
  merchant_id       BIGINT NOT NULL REFERENCES platform.merchants(id),
  version           INT NOT NULL,
  is_current        BOOLEAN NOT NULL DEFAULT FALSE,
  locale            TEXT NOT NULL DEFAULT 'en-US',

  hero_tagline      TEXT,
  about_html        TEXT,                    -- 已渲染的 HTML
  about_markdown    TEXT,                    -- 原稿,便于人审再编辑
  faq_json          JSONB,                   -- [{q, a, sources}]
  shipping_snippet  TEXT,
  returns_snippet   TEXT,
  editorial_html    TEXT,                    -- 编辑推荐(可空)

  source_snapshot_hash TEXT NOT NULL,        -- 生成时 sources 的 sha256
  llm_confidence    REAL,
  fact_check_score  REAL,
  fact_check_report JSONB,

  status            TEXT NOT NULL DEFAULT 'draft',  -- draft / review / approved / rejected / published
  reviewed_by       BIGINT REFERENCES platform.users(id),
  reviewed_at       TIMESTAMPTZ,
  review_notes      TEXT,

  published_at      TIMESTAMPTZ,
  refreshed_at      TIMESTAMPTZ,             -- 语义未变的刷新
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, version, locale)
);
CREATE UNIQUE INDEX ON platform.merchant_content (merchant_id, locale) WHERE is_current;
CREATE INDEX ON platform.merchant_content (status, created_at DESC);

-- 溯源:每次生成用了哪些 source
CREATE TABLE platform.merchant_content_sources (
  id            BIGSERIAL PRIMARY KEY,
  merchant_id   BIGINT NOT NULL,
  source_type   TEXT NOT NULL,               -- 'wikipedia' / 'merchant_about' / 'affiliate_feed' / 'trustpilot' / 'ugc_tip' / 'merchant_faq'
  source_url    TEXT,
  fetched_at    TIMESTAMPTZ NOT NULL,
  content_hash  TEXT NOT NULL,
  raw_r2_key    TEXT,                        -- 原文存 R2(便于将来 fact-check 回溯)
  extracted     JSONB NOT NULL,              -- LLM 抽取后的结构化字段
  UNIQUE (merchant_id, source_type, content_hash)
);
CREATE INDEX ON platform.merchant_content_sources (merchant_id, source_type, fetched_at DESC);

-- 核销流程 playbook(每商家可覆盖字段)
CREATE TABLE platform.redemption_playbooks (
  merchant_id       BIGINT PRIMARY KEY REFERENCES platform.merchants(id),
  promo_field_label TEXT DEFAULT 'Promo Code',
  apply_button_label TEXT DEFAULT 'Apply',
  checkout_url_hint TEXT,
  login_required    BOOLEAN DEFAULT FALSE,
  stacking_policy   TEXT,
  common_pitfalls   TEXT[],
  alternate_flows   JSONB,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by        TEXT
);

-- 人审事件流(审计 & 反哺训练)
CREATE TABLE platform.merchant_content_reviews (
  id              BIGSERIAL PRIMARY KEY,
  merchant_content_id BIGINT NOT NULL REFERENCES platform.merchant_content(id),
  reviewer_id     BIGINT REFERENCES platform.users(id),
  action          TEXT NOT NULL,             -- 'approve' / 'reject' / 'regenerate' / 'edit'
  edits           JSONB,                     -- {before, after, section}
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`app.merchants` 增加冗余字段(下沉到 D1):

```sql
ALTER TABLE app.merchants ADD COLUMN about_html TEXT;
ALTER TABLE app.merchants ADD COLUMN redemption_playbook JSONB;   -- 渲染成模板所需的所有变量
ALTER TABLE app.merchants ADD COLUMN faq_json JSONB;
ALTER TABLE app.merchants ADD COLUMN shipping_snippet TEXT;
ALTER TABLE app.merchants ADD COLUMN returns_snippet TEXT;
ALTER TABLE app.merchants ADD COLUMN content_version INT;
ALTER TABLE app.merchants ADD COLUMN content_reviewed_at TIMESTAMPTZ;
```

D1 侧同 shape(TEXT / JSON 字符串)。

## 6. LLM Prompt 模板全清单

四段 prompt 已归档到 `platform-ai/prompts/`,支持 prompt caching 与版本化:

| Prompt | 输入 | 输出 | 频率 |
|--------|------|------|------|
| `about.v1` | merchant + sources + offer stats | 200-350 字 About + citations | 每 90 天 |
| `redemption.v1` | merchant + help_page_excerpt + extension_rule + offer_types | 5-8 步流程 + playbook fields | offer_type 或 checkout flow 变时 |
| `faq.v1` | merchant + offers stats + common questions from FAQ page | 3-8 个 Q&A + citations | 每 90 天 |
| `shipping.v1` | merchant.shipping_countries + shipping_snippet | 100-200 字 + 关键数字 | 每 180 天 |
| `factcheck.v1` | draft + sources | verify report | 与 draft 同时 |
| `translate.v1` | canonical + target locale | 翻译版 | 首次上线 + 每次 canonical 更新 |

Prompt 版本化:改 prompt 版本号(v1 → v2)会触发所有商家分批重生。

## 7. 多语言策略(V1.5 起)

**Canonical + Translation** 模型:

- Canonical(en-US)由 pipeline 生成,人审优先
- 其他 locale:LLM 翻译 canonical,不重新生成(避免多语言事实分歧)
- 翻译版单独 review 队列,只审"是否符合当地表达",不 review 事实
- URL:`/de/store/nike`、`/fr/store/nike`,hreflang 互指
- 若 canonical 更新 → 所有 locale 自动打回 `status='needs_translation'`

## 8. 分层运营(5000 商家不失控的关键)

| 层 | 商家数 | 生成策略 | 人审 | Sitemap | 更新周期 |
|----|--------|----------|------|---------|----------|
| **Top 100** | 100 | LLM 起草 + 编辑加入 100-200 字独家评论 | 100% 逐条审 | ✓ 高优 | 30 天 |
| **101-500** | 400 | LLM 起草 | 100% 首审 + 抽 20% 复审 | ✓ 高优 | 60 天 |
| **501-2000** | 1500 | LLM 起草 + fact-check pass 才自动发布 | 抽 10% + confidence < 0.75 全审 | ✓ | 90 天 |
| **2001-5000** | 3000 | 全自动 | 只在被举报或 GSC 表现差时审 | ✓ | 120 天 |
| **5000+ 长尾** | 剩余 | 全自动 + 简化模板(仅 About + Redemption) | 不审 | ❌ **不进 sitemap**,`<meta robots="noindex, follow">` | 按需 |

**为什么长尾不 index**:避免 thin content 拖累整站 EEAT 评分。这些页仍存在,老用户可以访问,只是不主动让 Google 收录。用户搜索到 → 命中→ 用户反馈"这家挺好"→ upgrade 到 501-2000 层。

## 9. 观测

- **content_score**(0-1):`min(len_ok, no_repeat, fact_check_pass_rate, citation_density)` 加权
- **人审队列积压**(pending review 数,分层)—— 目标 < 3 天
- **拒审率**(reject / total review)—— > 30% 说明 prompt 或源数据有系统问题
- **GSC signals**:每商家页 avg position、CTR、impressions;180 天内下滑 > 20% → 触发复生
- **重复率**:任两商家 About 段 embedding cosine > 0.85 → 报警(说明 LLM 在偷懒)

## 10. 成本估算

按 5000 商家、Claude Haiku 起草 + Sonnet 复核 20%:

| 项 | 单价 | 数量 | 月成本 |
|----|------|------|--------|
| Draft (Haiku, cached sources) | $0.005 / merchant | 5000 首生 + 1500/月刷新 | $32 |
| Fact-check (Haiku) | $0.003 / merchant | 与 draft 同批 | $20 |
| High-tier review (Sonnet, top 500) | $0.02 / merchant | 500 / 90 天 | $3 |
| Translate ×3 locales(V1.5) | $0.006 / merchant / locale | 5000 × 3(一次)| $90 一次性 |
| **LLM 合计月度** | | | **~$55 / 月** |
| 人审(top 500 首审 $2/家 + 复审 $1/家)| | 500 + 每月 500 复审 | **$500-1500 一次性 + $500/月** |
| **合计** | | | **~$555 / 月**(稳态) |

对比价值:5000 商家 × 平均 SEO 价值 $50 / 月 = $250k / 月理论上限,$555 / 月投入 ROI 极高。

## 11. Rollout(3 个月内)

对齐 [11-roadmap.md](./11-roadmap.md#2-3-个月主时间轴t--t3m):

| Sprint | 交付 |
|--------|------|
| Sprint 3(T+4 ~ T+6W) | 数据表建 + Aggregate adapter(抓 About/FAQ/Shipping 页 → raw_pages) |
| Sprint 4(T+6 ~ T+8W) | Prompt v1(about + redemption + faq)+ Draft + Fact-check 流水线 |
| Sprint 5(T+8 ~ T+10W) | Admin 审核 UI + top 100 商家人审 + 首次发布 |
| Sprint 6(T+10 ~ T+12W) | 501-2000 分层自动生成 + Refresh loop 启用 + GSC 观测面板 |
| T+4M 起 | 多语言翻译 pipeline + 欧洲市场 |

## 12. 与其他文档联动

- 数据源来自爬虫:[04-crawler-layer.md](./04-crawler-layer.md) 新增 merchant-info adapter
- 版本化更新走事件流:[05a-update-strategy.md](./05a-update-strategy.md)
- 核销 playbook 与浏览器插件 rule 共源:[12-browser-extension.md](./12-browser-extension.md#41-每商家的-rule-结构)
- 结构化数据 schema:[07-seo-strategy.md](./07-seo-strategy.md#4-结构化数据jsonld)
- UGC tips 参与 sources:[08-community-ugc.md](./08-community-ugc.md)
- Sprint 排期:[11-roadmap.md](./11-roadmap.md#2-3-个月主时间轴t--t3m)
