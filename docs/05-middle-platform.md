# 05 — 中台层(Rust)

## 1. 定位

中台是整个系统的「大脑」,做所有需要「一致性 + 计算 + AI」的事,面对内部服务和管理后台,不面向普通用户请求。

## 2. 服务边界

```
┌──────────────────────────────────────────────────────┐
│  中台 Rust 服务 (axum + tokio + sqlx)                  │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ processor    │  │ scorer       │  │ syncer     │ │
│  │ (raw→cleaned)│  │ (deal_score) │  │ (→ D1)     │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
│  │ ai_enricher  │  │ validator    │  │ admin_api  │ │
│  │ (LLM 摘要/分类)│  │ (码有效性)  │  │ (审核后台) │ │
│  └──────────────┘  └──────────────┘  └────────────┘ │
└──────────────────────────────────────────────────────┘
             │                         ▲
             ▼                         │
      pg_raw / pg_cleaned      Cloudflare Queue
                                       │
                                       ▼
                               Cloudflare Worker
                                       │
                                       ▼
                                       D1
```

## 3. 项目结构

```
platform/
├── Cargo.toml
├── crates/
│   ├── platform-core/          # 领域模型、错误、公共 trait
│   ├── platform-db/            # sqlx 查询、migrations
│   ├── platform-processor/     # raw → cleaned pipeline
│   ├── platform-scorer/        # deal_score 计算
│   ├── platform-ai/            # LLM 客户端(Anthropic / OpenAI)
│   ├── platform-validator/     # 点击链路探活
│   ├── platform-syncer/        # D1 sync via Cloudflare Queue
│   ├── platform-admin/         # axum HTTP API
│   └── platform-cli/           # 一次性任务、灾备
├── migrations/
├── config/
│   ├── default.toml
│   └── prod.toml
└── docker/
    └── Dockerfile
```

## 4. 关键流水线

### 4.1 processor(raw → cleaned)

**目标**:把 `raw_offers` 变成结构化的 `offers` + `merchants`。

```rust
async fn process_batch(pool: &PgPool) -> Result<usize> {
    let raws = sqlx::query_as!(RawOffer, r#"
        SELECT id, source, source_id, merchant_hint, payload
        FROM raw_offers
        WHERE processed_at IS NULL
        ORDER BY id ASC
        LIMIT 500
        FOR UPDATE SKIP LOCKED
    "#).fetch_all(pool).await?;

    let mut tx = pool.begin().await?;
    for raw in &raws {
        let normalized = normalize_offer(raw)?;
        let merchant = resolve_merchant(&mut tx, &normalized).await?;
        upsert_offer(&mut tx, &merchant, &normalized).await?;
        sqlx::query!("UPDATE raw_offers SET processed_at = NOW() WHERE id = $1", raw.id)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(raws.len())
}
```

**normalize_offer** 的核心工作:
- 从 `payload` 中按 source 抽取字段(每个 source 一个 adapter)
- code 归一化:大写 + 去空格 + 去零宽字符
- 折扣类型判定:`percent` / `amount` / `freeship` / `bogo`
- 语言检测(Awin 有多语言 payload)
- 生成 UPSERT 键 `(merchant_id, code_normalized, offer_type)`

**resolve_merchant**:
- 优先按 `affiliate_ids.{source}` 查
- 再按 domain(payload 中带 landing_url)
- 都没命中 → 创建 `merchants` 记录,`status = 'pending_review'`(管理员审核后才展示)

### 4.2 ai_enricher

**目标**:用 LLM 生成摘要 + 分类 + 向量,写回 offers。

- **摘要**:Claude Haiku 或 gpt-4o-mini,prompt 输入 title + description,输出 40 字摘要
- **分类**:LLM 输出候选 category slugs,匹配到 `categories` 表
- **向量**:`text-embedding-3-small`,输入 title + summary,写 Vectorize

批处理,每次 100 条。用 Cloudflare AI Gateway 做请求缓存 + 限流 + 成本可视。

参考 `claude-api` skill 的最佳实践(prompt caching + 版本管理)。

### 4.3 validator(有效性校验)

> **完整策略见 [05b-validation-and-ingest-policy.md](./05b-validation-and-ingest-policy.md)**。这里只是骨架。

**目标**:分层验证 offer 是否可用。**不是每条 code 都跑相同强度的验证** —— 按 offer 价值和信任度分派 L1/L2/L3。

- **L1 URL probe**:全量,每 6h;HEAD/GET 检查 landing 域与状态码
- **L2 Landing DOM**:头部 500 商家,每 12h;Playwright 检查页面存在 promo 输入
- **L3 结账模拟**:头部 100 商家,每 24-48h;真加购 + 填码 + 观察折扣生效(与浏览器插件 rule 复用)
- **L4 UGC**:事件驱动;举报 ≥ 3 → 立即触发 L3

用户举报数 > 阈值 → 立刻走 L3 复检。所有验证结果落 `platform.offer_validations`,方便审计与"实测折扣"展示。

### 4.4 scorer

deal_score 加权公式(0-100):

```
score =
    30 * min(1.0, discount_normalized) +      // 折扣力度(百分比归一)
    20 * merchant_trust_score +               // 商家权重(0-1)
    20 * min(1.0, vote_ratio) +               // 用户投票 (up-down)/total
    15 * recency_factor +                     // 越新越高分,7 天半衰期
    10 * validity_factor +                    // 有效性校验通过
     5 * coverage_factor                      // 该商家 offer 少 → 更稀缺
```

每 15 分钟批量刷分。热门商家(> 100 clicks/day)缩到 5 分钟。

### 4.5 syncer(→ D1)

**方式**:通过 Cloudflare Queue 推送。

```rust
async fn sync_batch(pool: &PgPool, queue: &CfQueueClient) -> Result<()> {
    let last_sync = read_last_sync_ts().await?;
    let updates = sqlx::query_as!(OfferSyncRow, r#"
        SELECT * FROM offers
        WHERE updated_at > $1
        ORDER BY updated_at ASC
        LIMIT 1000
    "#, last_sync).fetch_all(pool).await?;

    for chunk in updates.chunks(50) {
        queue.send(&SyncMessage::Upsert {
            table: "offers".into(),
            rows: chunk.to_vec(),
        }).await?;
    }
    write_last_sync_ts(updates.last().map(|o| o.updated_at)).await?;
    Ok(())
}
```

Worker consumer(在边缘)见 [06-edge-frontend.md](./06-edge-frontend.md)。

**幂等**:Worker 端用 `INSERT OR REPLACE` 或 `ON CONFLICT DO UPDATE`,基于 offer id。

**反向同步**:从 D1 → PG 的 UGC 事件,由中台的 `ugc_puller` 每分钟拉取一次:

```rust
async fn pull_ugc_events(cf: &CfWorkerClient, pool: &PgPool) -> Result<()> {
    let events = cf.fetch_pending_events(500).await?;   // 边缘 API 返回 unsynced 事件
    for e in &events {
        sqlx::query!("INSERT INTO user_events ... ON CONFLICT DO NOTHING", ...)
            .execute(pool).await?;
    }
    cf.ack_events(events.iter().map(|e| e.id).collect()).await?;
    Ok(())
}
```

## 5. Admin API(内部管理后台)

由 Rust axum 服务提供,前端可以是 SvelteKit 或简单 HTMX。

- `GET /admin/offers` — 分页 + 过滤
- `POST /admin/offers/:id/hide`
- `POST /admin/merchants/:id/approve`
- `POST /admin/submissions/:id/review`
- `GET /admin/reports` — 举报队列
- 认证:内部 SSO(Google Workspace)+ session cookie

## 6. 配置

`config/prod.toml` 用 `figment` + env 覆盖:

```toml
[db]
raw_url = "postgres://..."
cleaned_url = "postgres://..."

[cloudflare]
account_id = "..."
queue_name = "sync-offers-prod"
d1_database_id = "..."

[ai]
provider = "anthropic"
model = "claude-haiku-4-5"
gateway_url = "https://gateway.ai.cloudflare.com/v1/{account}/deals/anthropic"

[validator]
sample_rate = 0.1
concurrency = 8
```

## 7. 观测

- `tracing` + `tracing-subscriber` + OpenTelemetry OTLP → Grafana / Loki / Tempo
- 关键指标:
  - `processor_batch_duration_seconds`
  - `processor_backlog_size`(pg_raw 未处理数)
  - `sync_lag_seconds`(D1 与 PG 差)
  - `validator_invalid_rate`
- 告警:sync_lag > 15 min、backlog > 10000

## 8. 部署

- 单 VPS 或 K8s 均可。MVP 用 Docker Compose:
  ```
  services:
    platform-processor:
      image: coupon/platform:latest
      command: ["platform-processor"]
      restart: always
    platform-scorer:
      command: ["platform-scorer"]
    platform-syncer:
      command: ["platform-syncer"]
    platform-admin:
      ports: ["8080:8080"]
      command: ["platform-admin"]
  ```
- 长时任务用 tokio 单实例;processor / syncer 可以水平扩,配 `SELECT ... FOR UPDATE SKIP LOCKED` 保证不重复。

## 9. 为什么用 Rust

- 数据处理密集,Rust 的性能与内存效率优于 Node
- 类型系统在数据 ETL 场景的正确性收益大
- sqlx 编译期检查 SQL,避免运行时错误
- 与 Node 爬虫解耦,方便独立扩缩容和团队分工
