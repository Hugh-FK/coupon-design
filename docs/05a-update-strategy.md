# 05a — 主动更新策略

**问题**:数据像流水一样在 `crawler → platform → app → D1` 四层间流动,任何一层的一次变更都要**准确、快速、幂等**地传播到下游。这一章定义传播链路、时机、幂等键、失败处理。

## 1. 更新链路总览

```
                     ┌──────────────────────────┐
                     │   触发源(五种入口)       │
                     └──────────────────────────┘
                          │
   ┌──────────┬───────────┼──────────┬────────────┐
   ▼          ▼           ▼          ▼            ▼
定时爬取   联盟 feed   用户提交    UGC 举报    Admin 编辑
                          │
                          ▼
                 crawler.raw_offers  (INSERT ON CONFLICT)
                          │  processed_at IS NULL
                          ▼
                  Rust processor 消费
                          │  content_hash 变化才继续
                          ▼
                 platform.merchants / offers  (upsert)
                          │  写 change_events
                          ▼
                 app-syncer 消费 change_events
                          │
                          ▼
                 app.merchants / offers  (upsert,反规范化)
                          │  updated_at 前进
                          ▼
                 d1-syncer 增量拉 app.*
                          │  Cloudflare Queue
                          ▼
                 Worker consumer → D1 upsert
                          │
                          ▼
                 Worker 清 KV / Cache-API 失效
```

**每一步都是幂等 upsert**,失败可重放。

## 2. 五种触发源

### 2.1 定时爬取(pull)

- 每 site adapter 按其 `fullCrawlIntervalH` cron 触发
- 每商家在中台维度还有一个"下次更新时间戳",到点由中台向爬虫推 `refresh:merchant` 任务
- 冷启动阶段(前 4 周)优先完整覆盖;稳态期只增量刷新热门 & 快过期

### 2.2 联盟 feed 拉取(pull)

- 5 家联盟每 30-60 min 一轮
- Feed 侧标记的 `last_updated` 作为增量水位
- 内容不变(content_hash 相同)则不下发到中台

### 2.3 用户提交(push)

- 用户在 C 端提交新 deal → Worker → PG `platform.user_submissions` 直写
- Worker 同时向爬虫推 `submit:crawl` 队列,爬虫爬提交的 URL 富化
- 爬虫结果落 `raw_offers` `source_type='user_submission'`
- 中台审核通过 → merged 进 `platform.offers` → 触发下发

### 2.4 UGC 举报(push)

- 用户在 offer 详情页点"Report expired" → Worker 写 D1 → Queue → 中台
- 中台异步触发:
  1. `refresh:merchant` 让爬虫重爬对应商家 coupon 页
  2. 立即触发 offer 有效性校验(headless follow redirect)
  3. 若确认失效 → `platform.offers.status = 'invalid'` → 传播到 app + D1

### 2.5 Admin 编辑(push)

- Admin 后台修改商家、隐藏/显示 offer、推荐置顶
- 直接写 `platform.*`,写入后统一走下游链路(不能绕过 change_events,否则前台不刷新)

## 3. 幂等键 & 变更检测

**每层的幂等键**:

| 层 | 幂等键 | 变更检测 |
|----|--------|----------|
| crawler.raw_offers | `(source, source_id, content_hash)` UNIQUE | content 相同 → INSERT ON CONFLICT DO NOTHING |
| platform.offers | `(merchant_id, code_normalized, offer_type)` UNIQUE | `content_hash` 字段;相同就跳过下游 |
| platform.change_events | `(entity_type, entity_id, op, emitted_at)` | 只写、不读旧 |
| app.offers | `id` PK | `updated_at`;下游按此增量拉 |
| D1 offers | `id` PK | Worker `INSERT OR REPLACE` |

**关键规则**:
1. **平凡变更不触发下游**:例如 offer 只是 `last_seen_at` 改了,`content_hash` 不变 → 不写 change_events
2. **强制重传**:Admin 手动触发"重推 D1" → 中台生成一次 `change_events.op='force_upsert'`,忽略 hash 检查
3. **删除是软删除**:`status='hidden'` 而不是 DELETE,方便回滚

## 4. Rust processor 的核心逻辑

```rust
async fn process_raw(pool: &PgPool) -> Result<usize> {
    let raws = sqlx::query_as!(RawOffer, r#"
        SELECT id, source, source_type, source_id, merchant_hint, payload, content_hash
        FROM crawler.raw_offers
        WHERE processed_at IS NULL
        ORDER BY id
        LIMIT 500
        FOR UPDATE SKIP LOCKED
    "#).fetch_all(pool).await?;

    let mut tx = pool.begin().await?;
    for raw in &raws {
        match process_one(&mut tx, raw).await {
            Ok(action) => {
                sqlx::query!(r#"
                    UPDATE crawler.raw_offers
                    SET processed_at = NOW(), process_status = $2
                    WHERE id = $1
                "#, raw.id, action.as_str()).execute(&mut *tx).await?;
            }
            Err(e) => {
                sqlx::query!(r#"
                    UPDATE crawler.raw_offers
                    SET processed_at = NOW(), process_status = 'error', process_error = $2
                    WHERE id = $1
                "#, raw.id, e.to_string()).execute(&mut *tx).await?;
            }
        }
    }
    tx.commit().await?;
    Ok(raws.len())
}

async fn process_one(tx: &mut PgTx, raw: &RawOffer) -> Result<ProcessAction> {
    let normalized = normalize(raw)?;                    // 各 source adapter 的 normalizer
    let merchant = resolve_merchant(tx, &normalized).await?;
    let existing = load_offer(tx, merchant.id, &normalized).await?;

    let new_hash = compute_content_hash(&normalized);
    if let Some(e) = existing {
        if e.content_hash == new_hash {
            // 只 bump last_seen_at,不触发下游
            bump_last_seen(tx, e.id).await?;
            return Ok(ProcessAction::Skipped);
        }
        // 有实质变更 → 更新
        update_offer(tx, e.id, &normalized, new_hash).await?;
        emit_change_event(tx, "offer", e.id, "upsert").await?;
    } else {
        let id = insert_offer(tx, merchant.id, &normalized, new_hash).await?;
        emit_change_event(tx, "offer", id, "upsert").await?;
    }
    Ok(ProcessAction::Ok)
}
```

## 5. app-syncer(platform → app)

**目标**:消费 `platform.change_events`,把变更投影 + 反规范化到 `app.*`。

```rust
async fn sync_platform_to_app(pool: &PgPool) -> Result<()> {
    let events = sqlx::query_as!(ChangeEvent, r#"
        SELECT * FROM platform.change_events
        WHERE consumed_at IS NULL
        ORDER BY id
        LIMIT 200
        FOR UPDATE SKIP LOCKED
    "#).fetch_all(pool).await?;

    let mut tx = pool.begin().await?;
    for ev in &events {
        match (ev.entity_type.as_str(), ev.op.as_str()) {
            ("offer", "upsert") | ("offer", "force_upsert") => sync_offer(&mut tx, ev.entity_id).await?,
            ("offer", "delete") => delete_offer(&mut tx, ev.entity_id).await?,
            ("merchant", _) => sync_merchant(&mut tx, ev.entity_id).await?,
            _ => {}
        }
        sqlx::query!("UPDATE platform.change_events SET consumed_at = NOW() WHERE id = $1", ev.id)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}
```

**投影 SQL 示例**(offer):
```sql
INSERT INTO app.offers (
  id, merchant_id, merchant_slug, merchant_name, merchant_logo_url,
  offer_type, code, title, description, ai_summary,
  discount_type, discount_value, currency, min_spend,
  affiliate_url, affiliate_source, expires_at, status, deal_score,
  vote_up, vote_down, used_count, category_slugs, country_codes, updated_at
)
SELECT
  o.id, o.merchant_id, m.slug, m.name, m.logo_r2_key,   -- 反规范化
  o.offer_type, o.code, o.title, o.description, o.ai_summary,
  o.discount_type, o.discount_value, o.currency, o.min_spend,
  o.affiliate_url, o.affiliate_source, o.expires_at, o.status, o.deal_score,
  o.vote_up, o.vote_down, o.used_count,
  ARRAY(SELECT c.slug FROM platform.merchant_categories mc
        JOIN platform.categories c ON c.id = mc.category_id
        WHERE mc.merchant_id = m.id),
  m.country_codes,
  NOW()
FROM platform.offers o
JOIN platform.merchants m ON m.id = o.merchant_id
WHERE o.id = $1
ON CONFLICT (id) DO UPDATE SET
  merchant_slug = EXCLUDED.merchant_slug,
  merchant_name = EXCLUDED.merchant_name,
  merchant_logo_url = EXCLUDED.merchant_logo_url,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  ai_summary = EXCLUDED.ai_summary,
  code = EXCLUDED.code,
  discount_type = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value,
  currency = EXCLUDED.currency,
  min_spend = EXCLUDED.min_spend,
  affiliate_url = EXCLUDED.affiliate_url,
  affiliate_source = EXCLUDED.affiliate_source,
  expires_at = EXCLUDED.expires_at,
  status = EXCLUDED.status,
  deal_score = EXCLUDED.deal_score,
  vote_up = EXCLUDED.vote_up,
  vote_down = EXCLUDED.vote_down,
  used_count = EXCLUDED.used_count,
  category_slugs = EXCLUDED.category_slugs,
  country_codes = EXCLUDED.country_codes,
  updated_at = NOW();
```

**merchant 更新的联动**:merchant 变更时 → 触发所有 `app.offers WHERE merchant_id = ?` 的 `merchant_slug/name/logo` 反规范化字段刷新。这靠 `emit_change_event(merchant_related_offers)` 或直接一条 `UPDATE app.offers ... FROM platform.merchants` 完成。

## 6. d1-syncer(app → D1)

**目标**:每 5 分钟一批增量,把 `app.*` 变更推到 Cloudflare Queue,由 Worker consumer 写 D1。

```rust
async fn sync_app_to_d1(pool: &PgPool, queue: &CfQueueClient) -> Result<()> {
    let cursor = read_cursor(pool, "d1_offers").await?;   // TIMESTAMPTZ
    let rows = sqlx::query_as!(OfferRow, r#"
        SELECT * FROM app.offers
        WHERE updated_at > $1
        ORDER BY updated_at, id
        LIMIT 1000
    "#, cursor).fetch_all(pool).await?;

    for chunk in rows.chunks(50) {
        queue.send(&SyncBatch::Upsert {
            table: "offers",
            rows: chunk.to_vec(),
        }).await?;
    }
    if let Some(last) = rows.last() {
        write_cursor(pool, "d1_offers", last.updated_at).await?;
    }
    Ok(())
}
```

**Worker consumer**(在边缘):
```ts
export default {
  async queue(batch: MessageBatch<SyncBatch>, env: Env) {
    for (const msg of batch.messages) {
      const b = msg.body
      const stmt = env.DB.prepare(UPSERT_OFFER_SQL)   // INSERT OR REPLACE
      await env.DB.batch(b.rows.map(r => stmt.bind(...toParams(r))))

      // 失效缓存
      for (const r of b.rows) {
        await env.KV_HOT.delete(`hot:us:${r.merchant_slug}`)
        await purgeCache(`/store/${r.merchant_slug}`)
      }
      msg.ack()
    }
  }
}
```

**失败处理**:CF Queue 内建 DLQ,消息 3 次失败进死信队列,通过 admin dashboard 手动 replay。

## 7. UGC 反向同步(D1 → app → platform)

用户在边缘投票 / 举报,数据在 D1 主写:

```
Worker → INSERT INTO user_events_edge (D1)
      → 同时通过 CF Queue 推给中台
```

中台每分钟拉一次:
```rust
async fn pull_edge_events(cf: &CfWorkerClient, pool: &PgPool) -> Result<()> {
    // Worker 内网 API 返回 unsynced 事件
    let events = cf.fetch_pending_events(500).await?;

    let mut tx = pool.begin().await?;
    for e in &events {
        // 先写 app 层(冗余但 D1 主键与 app 一致)
        sqlx::query!(r#"
            INSERT INTO app.user_events_edge (d1_id, user_id, offer_id, event_type, ip_hash, edge_created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (d1_id) DO NOTHING
        "#, e.d1_id, e.user_id, e.offer_id, e.event_type, e.ip_hash, e.created_at)
            .execute(&mut *tx).await?;

        // 提升到 platform 权威表
        sqlx::query!(r#"
            INSERT INTO platform.user_events (user_id, offer_id, event_type, metadata, ip_hash, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        "#, e.user_id, e.offer_id, e.event_type, e.metadata, e.ip_hash, e.created_at)
            .execute(&mut *tx).await?;

        // 更新 offer 计数(触发 change_event → 反向下发到 app + D1)
        sqlx::query!(r#"
            UPDATE platform.offers
            SET vote_up = vote_up + $2, vote_down = vote_down + $3, updated_at = NOW()
            WHERE id = $1
        "#, e.offer_id, e.vote_up_delta, e.vote_down_delta)
            .execute(&mut *tx).await?;
    }
    tx.commit().await?;
    cf.ack_events(events.iter().map(|e| e.d1_id).collect()).await?;
    Ok(())
}
```

**注意闭环**:UGC → platform → app → D1(反向传回)。用户投票几分钟内自己就能在其他节点看到累计数变化。

## 8. 频率与 SLA

| 数据流 | 频率 | 端到端 SLA |
|--------|------|------------|
| feed → raw | 30-60 min | — |
| raw → platform(processor) | 每分钟一批 | < 3 min |
| platform → app(app-syncer) | 每 30 秒 | < 1 min |
| app → D1(d1-syncer + Queue) | 每 5 分钟批处理 + 每 30 秒有新数据触发 | < 3 min |
| Worker consumer → D1 | 立即 | < 30 秒 |
| KV / Cache 失效 | Worker consumer 内联 | < 30 秒 |
| **总链路(feed → 用户可见)** | | **≤ 8 分钟** |

**紧急链路**(用户举报导致失效):跳过定时,直接触发 validator L3 → processor + syncer,SLA < 60 秒。分层验证策略见 [05b-validation-and-ingest-policy.md](./05b-validation-and-ingest-policy.md)。

## 9. 定时刷新策略(全量校准)

即便所有 push 通道正常工作,也需要**定时全量校准**兜底:

| 任务 | 周期 | 内容 |
|------|------|------|
| Merchant re-sync all | 每周日凌晨 | 从 platform.merchants 全量投影到 app,防漂移 |
| Offer status re-eval | 每天 03:00 UTC | 到期未标记 expired 的 → 批量 status='expired' |
| D1 完整性 audit | 每周一 | 抽样 D1 vs app.offers,不一致的重推 |
| Cloudflare Cache Purge | 每天 04:00 UTC | 清全站 KV(volatile),让下一次访问强制刷新 |
| Sitemap 重建 | 每天 05:00 UTC | 用 app.merchants + app.offers 生成 sitemap.xml,存 R2 |

## 10. 观测

**指标**(Grafana 面板必备):
- `raw_backlog{}` — 未处理的 raw_offers 数量
- `change_events_backlog{}` — 未消费的 change_events 数量
- `d1_sync_lag_seconds{}` — max(now - last written)
- `queue_dlq_depth{}` — CF Queue 死信深度
- `edge_events_unsynced{}` — 边缘未回传的事件数

**告警**:
- `raw_backlog > 20000` 持续 15 min → 中台 processor 掉队
- `change_events_backlog > 5000` → app-syncer 掉队
- `d1_sync_lag_seconds > 900` → D1 严重滞后
- `queue_dlq_depth > 10` → 有异常写入,人工介入

## 11. 与其他文档联动

- schema 定义:[03-data-model.md](./03-data-model.md)
- Rust 中台实现细节:[05-middle-platform.md](./05-middle-platform.md)
- 边缘 Worker consumer:[06-edge-frontend.md](./06-edge-frontend.md#9-缓存失效)
- 爬虫 refresh 队列:[04-crawler-layer.md](./04-crawler-layer.md#4-队列设计bullmq)
