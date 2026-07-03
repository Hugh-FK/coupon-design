# 05b — 入库与验证策略

**核心问题**:爬到的 coupon code 是否全部落库?是否要为每条 code 写"有效性验证"脚本?

**结论**:
- **落库**:所有原始数据都进 `crawler.raw_offers`(观测与追溯),但**只有过闸的 offer 才进 `platform.offers`,再择优进 `app.offers` / D1**
- **验证**:不是**一个**脚本,而是**一栈四层**,按成本分级、按价值分派、UGC + 定期 + 事件触发混合驱动

## 1. 三级过滤:从爬取到 C 端可见

```
爬虫产出                    (100% 落库)
  │
  ▼
crawler.raw_offers          原始、去重仅按 content_hash
  │
  ▼  Gate 1(processor 内联同步 checks,~0 成本)
  ├── code 长度 2-50、非 URL / 非空白
  ├── discount_value 合理(0 < percent ≤ 95;amount ≤ AOV × 3)
  ├── merchant 能 resolve 到 platform.merchants
  ├── expires_at 未在过去 30 天
  └── source 可信度 > 阈值(见下)
  │  fail → raw.process_status='skipped'
  ▼
platform.offers             status='pending_validation'(默认)
  │
  ▼  Gate 2(定时验证栈,分层)
  │  L1 通过 → status='active'
  │  L1 fail → status='invalid'
  │  L2/L3 fail → deal_score 降 or status='invalid'
  ▼
app.offers → D1             用户可见
```

**关键**:**crawler → platform 的门只挡"结构性错误",不挡"业务疑问"**。业务判断留给 Gate 2 分层验证。

## 2. Gate 1:Ingest sanity(processor 内联)

processor 消费 raw 时同步执行,单条 < 5ms。fail 项写入 `raw_offers.process_error`。

### 2.1 硬校验(fail 直接 skip)

```rust
// pseudocode
fn sanity_check(raw: &NormalizedOffer) -> Result<(), SkipReason> {
    if let Some(code) = &raw.code {
        if code.len() < 2 || code.len() > 50 { return Err(Reason::CodeShape); }
        if code.contains(char::is_whitespace) { return Err(Reason::CodeShape); }
        if code.starts_with("http") { return Err(Reason::CodeShape); }
    }
    if let Some(v) = raw.discount_value {
        match raw.discount_type.as_deref() {
            Some("percent") if !(0.0 < v && v <= 95.0) => return Err(Reason::DiscountRange),
            Some("amount")  if !(0.0 < v && v <= 5000.0) => return Err(Reason::DiscountRange),
            _ => {}
        }
    }
    if let Some(exp) = raw.expires_at {
        if exp < Utc::now() - Duration::days(30) { return Err(Reason::LongExpired); }
    }
    if raw.title.trim().is_empty() { return Err(Reason::MissingTitle); }
    Ok(())
}
```

### 2.2 软校验(告警不 skip,只降 deal_score)

- **可疑高折扣**:percent > 80% —— 不 skip 但初始 `deal_score -= 20`,等待 L3 复核
- **无 expires_at**:留 `starts_at` 补齐 30 天 TTL,再等联盟侧数据更新
- **merchant 是新建 pending**:offer 落库但 `status='pending_merchant_review'`,不进 app 层(等商家审核通过再放开)

### 2.3 source 可信度

不是所有来源同权重。给每个 source 一个初始 `trust_weight`,进入 sanity 前的第一道分派:

| source | trust_weight | 说明 |
|--------|-------------|------|
| `cj` / `rakuten` / `impact` / `shareasale` / `awin` | 1.0 | 联盟 feed,商家自己上传,最可信 |
| `crawler:merchant_official` | 0.9 | 商家官方 coupon 页 |
| `crawler:retailmenot` / `slickdeals` / `couponfollow` | 0.6 | 头部竞品 |
| `crawler:reddit` | 0.4 | UGC 长尾 |
| `user_submission` | 0.3(过审前) / 0.7(过审后) | 依赖用户 karma |
| `crawler:unknown` | 0.2 | 未列白名单的抓取源 |

**用途**:
- `trust_weight < 0.5` 的 offer 强制走 L2(不能只靠 L1)
- `deal_score` 初始值 = base × trust_weight
- 同一 (merchant, code) 有多来源时,取最高 trust 的作为主记录,其余作 `source_refs` 溯源

## 3. Gate 2:验证栈(4 层)

单一"每条 code 跑一次结账验证"的脚本**不可行**:百万级 offer × 秒级 headless × 代理成本 = 破产。改为**分层按价值验证**。

### L0 · Ingest sanity

见 §2。processor 内联,全量。**只挡格式错误**,不判定业务有效性。

### L1 · URL probe(全量、便宜)

**目标**:landing URL 能到吗?联盟 SubID 拼接后不 400/404 吗?

```rust
async fn l1_probe(offer: &Offer, http: &Client) -> ProbeResult {
    let url = build_affiliate_url(&offer.affiliate_url, "l1-probe");
    let resp = http.get(&url).timeout(Duration::from_secs(15)).send().await?;
    let status = resp.status();
    let final_url = resp.url().to_string();

    if !status.is_success() { return ProbeResult::HttpError(status); }
    if !final_url.contains(&offer.merchant_domain) {
        return ProbeResult::WrongLanding(final_url);
    }
    // 联盟侧过期常见表现:redirect 到"deal expired"页
    if final_url.contains("expired") || final_url.contains("not-found") {
        return ProbeResult::LandingExpired;
    }
    ProbeResult::Ok
}
```

- **频率**:每 active offer 每 6 小时;新 offer 首次 promote 前必跑
- **成本**:HEAD/GET 单条 200-500ms + 代理流量,月成本 ~$80 覆盖 30 万 active offer
- **fail 处理**:第一次 fail 5min 后重试,3 次仍 fail → `status='invalid'` + `validity_last_result` 记原因
- **限流**:per-domain 1 req/s + 令牌桶,与爬虫共享代理池
- **注意**:某些商家会检测 non-browser UA,这类需要转 L2 而非 L1;每 merchant 的 `l1_uses_browser` 开关记录

### L2 · Landing DOM(头部覆盖、中等成本)

**目标**:Landing 页确实是"可以填 promo code"的商家结账/购物车页,不是被 gate 到"应用不可用"或跳到 App Store。

```
Playwright headless=true
  → open(final_url)
  → wait networkidle
  → 查找 selector: input[name*=promo i], input[id*=coupon i], [data-*=promo]
  → 或 JSON-LD Offer schema 存在
  → 判定通过
```

- **频率**:每 12-24h × 头部 500 商家(所有 active offer)
- **成本**:Playwright + 代理 ~2s / 单条,~$150/月
- **触发**:
  - 每商家周期跑
  - L1 pass 但 UGC 报 didn't work → 立即 L2(不等周期)
  - L3 fail 时 fallback 到 L2 复核
- **fail 处理**:`deal_score -= 15`,不隐藏(可能是 A/B 测试或 landing 变更),但排序沉底

### L3 · 结账模拟(Top 100、贵、准)

**目标**:真的把 code 填进去,看总价降没降。

```
Playwright
  → 打开商家的一个 canary product 页(每商家配一个"稳定加购品"URL)
  → 加购
  → 到 checkout / cart 页
  → 用 merchant_extension_rules 里的 selector 填 code
  → 记录 total_before / total_after
  → 差值 > 0 → verified,记录实际折扣力度
  → 差值 = 0 且看到"invalid code" text → invalid
  → timeout / DOM 变化 → inconclusive
```

**巨大加分点**:这些 rule **就是浏览器插件需要的规则**(见 [12-browser-extension.md](./12-browser-extension.md#41-每商家的-rule-结构))。**同一份 `merchant_extension_rules` 数据,验证栈和插件复用**。运营人一次配置,双处收益。

- **频率**:每 24-48h × 头部 100 商家的所有 code offer
- **成本**:~15s / 条 + 代理住宅费,~$200/月
- **触发**:
  - 头部商家周期跑
  - L4 举报 ≥ 3 次 → 立即 L3
  - Admin 手动"这条码可疑,跑一次 L3"
- **成功产出**:`platform.offer_validations` 表记录一次真实的折扣金额(可以反哺 UI 展示"实测省 $18.32")
- **fail 处理**:L3 fail 直接 `status='invalid'`;若 3 次 L3 全 fail 且 UGC 也没救 → 商家的 rule 打回 pending review(可能页面改版了)

### L4 · UGC(免费、最真实)

**目标**:用户在 offer 详情页 & 结账后的行为反馈。

事件源:
- 明确投票 `Worked / Didn't work`(offer 详情页按钮)
- `Report expired / invalid`
- 插件里 auto-fill 的成功/失败结果(`platform.extension_events`)
- 用户点了 outbound 但 30min 内没触发联盟 transaction

聚合规则:
- vote_up / (vote_up + vote_down) < 0.4 且总票 ≥ 10 → 触发 L3 复核
- report_invalid ≥ 3(不同用户、不同 IP)→ 立即 L3
- 插件 auto-fill 成功率 < 50%(样本 ≥ 20)→ 该 offer 或 rule 打回

**为什么 L4 权重最高**:唯一直接反映"用户实际是否成交"的数据源。L1-L3 是模拟,L4 是真实。

## 4. 分类型策略

不同 offer 类型验证方式差异极大,一刀切浪费成本:

| offer_type | L1 | L2 | L3 | L4 | 最低门槛(可 promote 到 D1) |
|------------|----|----|----|----|----------------------------|
| **code**(手动填码) | ✓ | ✓ | 头部必须 | ✓ | L1 pass + trust_weight ≥ 0.6,或 L2 pass |
| **deal**(链接自动折扣) | ✓ | 建议 | — | ✓ | L1 pass |
| **freeship** | ✓ | 建议 | 头部建议 | ✓ | L1 pass + trust_weight ≥ 0.6 |
| **sale**(整站促销) | ✓ | — | — | ✓ | L1 pass |
| **student/military** | ✓ | ✓ | — | ✓ | L1 + L2 pass + 显式标"需资格" |
| **printable/in-store** | — | — | — | ✓ | 显式标"in-store only",不做 URL 验证 |

## 5. 数据表增量

在 [03-data-model.md](./03-data-model.md) 的 platform schema 追加:

```sql
-- 每次验证一条记录,便于审计与"实测折扣力度"展示
CREATE TABLE platform.offer_validations (
  id            BIGSERIAL PRIMARY KEY,
  offer_id      BIGINT NOT NULL REFERENCES platform.offers(id),
  layer         TEXT NOT NULL,       -- 'l0' / 'l1' / 'l2' / 'l3' / 'l4'
  result        TEXT NOT NULL,       -- 'pass' / 'fail' / 'inconclusive'
  reason        TEXT,                -- 'http_500' / 'landing_expired' / 'no_promo_input' / ...
  observed_discount NUMERIC(10,2),   -- L3 才有
  duration_ms   INT,
  metadata      JSONB,               -- 完整证据(final_url、DOM excerpt 等)
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON platform.offer_validations (offer_id, performed_at DESC);
CREATE INDEX ON platform.offer_validations (layer, result, performed_at DESC);

-- 每商家的验证 canary 配置(L3 用)
CREATE TABLE platform.merchant_validation_canaries (
  merchant_id       BIGINT PRIMARY KEY REFERENCES platform.merchants(id),
  canary_product_url TEXT NOT NULL,  -- 一个稳定的加购品 URL
  add_to_cart_selector TEXT,
  cart_url_pattern  TEXT,
  -- 复用 platform.merchant_extension_rules 里的填码 selector
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

`platform.offers` 已有 `validity_last_checked_at` / `validity_last_result` —— 保留,存最近一次结果,便于快速筛选。历史轨迹放 `offer_validations`。

## 6. 与更新策略的联动

参考 [05a-update-strategy.md](./05a-update-strategy.md),验证与主更新链路的交点:

- **紧急链路(< 60 秒 SLA)**:UGC report_invalid ≥ 3 → 中台立即入队 L3 → fail → `status='invalid'` → 发 change_event → app / D1 秒级同步
- **周期链路**:validator 每层跑完写 offer_validations + 更新 offers.updated_at → 触发 change_event → 下游同步
- **爬虫触发**:validator L1 fail 5 次 → 中台推 `refresh:merchant` 任务给爬虫,可能商家页改版了

## 7. 队列设计

Rust 中台侧有一个 `validator` 服务,内部四组 worker:

```rust
enum ValidateJob {
    L1 { offer_id: i64, priority: u8 },       // 每 6h 全量入队
    L2 { offer_id: i64, priority: u8 },       // 头部 500 商家
    L3 { offer_id: i64, priority: u8 },       // 头部 100 商家 + 触发式
    L4Aggregate { offer_id: i64 },            // UGC 事件聚合触发
}
```

- L1 worker 并发 32(HEAD 请求便宜)
- L2 worker 并发 8(Playwright 池)
- L3 worker 并发 4(Playwright + 完整浏览器会话)
- 优先级:UGC/紧急触发 > Admin 手动 > 头部周期 > 长尾周期

## 8. 观测

- `validator_probes_total{layer, result}` — 每层通过率
- `validator_latency_ms{layer}` — p50/p95/p99
- `validator_backlog{layer}` — 未处理的 job 数
- `validator_l1_domain_error_rate{domain}` — 单商家/域名的错误率(异常 → 触发 L2 或 refresh:merchant)
- `offer_status_distribution{status}` — active / pending_validation / invalid 各占比

**告警**:
- 某 domain L1 通过率 24h 内跌 > 20% → 商家可能改版
- 全站 L1 backlog > 50000 → validator 掉队
- L3 通过率 < 40% 持续 6h → 头部商家规则可能失效
- pending_validation 存量 > 20% 总 offer 且 24h 未减 → validator 挂了

## 9. 成本预估(月度,USD)

假设:100 万 raw / 天,50 万 promote 到 platform / 天,active offer 池 30 万,头部 500 商家覆盖 15 万 offer,头部 100 商家覆盖 5 万 offer。

| Layer | 频率 | 月执行次数 | 成本 |
|-------|------|-----------|------|
| L0 | processor 内联 | ~3000 万 | ~$0(与 processor 复用 CPU) |
| L1 URL probe | 每 6h × 30 万 | ~3600 万 | 代理住宅流量 ~$80 |
| L2 Landing DOM | 每 12h × 15 万 | ~90 万 | Playwright + 代理 ~$150 |
| L3 结账模拟 | 每 24h × 5 万 + 触发 | ~150 万 | Playwright + 代理 ~$200 |
| L4 UGC | 事件驱动 | 免费 | $0 |
| **合计** | | | **~$430 / 月** |

**对比**:如果每条 offer 都跑 L3 一次(单条 $0.005),100 万 raw × $0.005 = $5000 / 月。分层策略节省 90%+ 成本,准确率损失 < 5%(长尾 offer 无关流量)。

## 10. Rollout 计划(3 个月内)

对齐 [11-roadmap.md](./11-roadmap.md) 的 Sprint 节奏:

| Sprint | 交付 |
|--------|------|
| Sprint 2(T+2 ~ T+4W) | Gate 1 完整实现;L0 全量;L1 骨架 |
| Sprint 3(T+4 ~ T+6W) | L1 全量运行;`offer_validations` 表 + admin 面板 |
| Sprint 4(T+6 ~ T+8W) | L2 头部 500 商家上线;UGC report → L2 触发链路 |
| Sprint 5(T+8 ~ T+10W) | L3 头部 100 商家 + `merchant_validation_canaries` 配置;与插件 rule 打通 |
| Sprint 6(T+10 ~ T+12W) | L4 聚合规则;告警面板;分类型策略上线 |

**MVP 前 4 周只做 L0 + L1**,已经能过滤掉 60% 无效数据,足够撑发布。L2/L3 在联盟/UGC 起量后跟进。

## 11. 与其他文档联动

- 数据表定义与 schema 隔离:[03-data-model.md](./03-data-model.md)
- Rust 中台 validator 位置:[05-middle-platform.md](./05-middle-platform.md#43-validator有效性校验)
- 更新链路 SLA & 触发:[05a-update-strategy.md](./05a-update-strategy.md)
- 爬虫的 refresh 队列:[04-crawler-layer.md](./04-crawler-layer.md#4-队列设计bullmq)
- 插件 rule 与 L3 复用:[12-browser-extension.md](./12-browser-extension.md#41-每商家的-rule-结构)
- Sprint 排期:[11-roadmap.md](./11-roadmap.md#2-3-个月主时间轴t--t3m)
