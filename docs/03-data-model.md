# 03 — 数据模型

**核心原则**:爬虫脏数据、中台清洗数据、C 端消费数据用 **PostgreSQL schema 严格隔离**。三个 schema 之间只允许中台服务写(其它服务只读),防止脏数据污染 C 端。

```
PostgreSQL(单实例,三个 schema)
├─ crawler.*    ← 爬虫写入,原始、脏、宽字段
├─ platform.*   ← 中台清洗写入,业务规范、审核态、评分
└─ app.*        ← C 端消费视图,查询优化,是 D1 的镜像

Cloudflare D1
└─ (mirror of app.* via Queue sync)
```

**schema 权限**:

| Role | crawler | platform | app |
|------|---------|----------|-----|
| `crawler_role`(Fastify 爬虫) | RW | — | — |
| `platform_role`(Rust 中台) | R | RW | RW |
| `app_ro_role`(内部只读工具) | — | R | R |
| `sync_role`(D1 同步 job) | — | — | R |

任何服务连库时用最小权限的角色,防止误写。

---

## 1. `crawler` schema(原始爬取仓)

宽字段、留原样,永不修改历史数据。

```sql
CREATE SCHEMA crawler;

-- 每个爬虫任务一次运行
CREATE TABLE crawler.crawl_jobs (
  id            BIGSERIAL PRIMARY KEY,
  site_key      TEXT NOT NULL,             -- 'retailmenot' / 'slickdeals' / 'cj_feed' 等
  job_type      TEXT NOT NULL,             -- 'listing' / 'detail' / 'feed_pull'
  status        TEXT NOT NULL,             -- 'queued' / 'running' / 'success' / 'failed'
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  stats         JSONB,                     -- {rows: 1234, errors: 5, ...}
  error         TEXT,
  UNIQUE (site_key, job_type, started_at)
);
CREATE INDEX ON crawler.crawl_jobs (site_key, status, started_at DESC);

-- 联盟 feed / 站点抓取的 offer 原始行
CREATE TABLE crawler.raw_offers (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL,             -- 'cj', 'rakuten', 'retailmenot', ...
  source_type   TEXT NOT NULL,             -- 'affiliate_feed' / 'competitor_scrape' / 'merchant_page'
  source_id     TEXT NOT NULL,             -- 源侧 offer id 或 URL 哈希
  merchant_hint TEXT,                      -- feed 里的 merchant 名或 domain
  fetched_url   TEXT,
  http_status   SMALLINT,
  payload       JSONB NOT NULL,            -- 原始 payload/HTML 抽取结果
  content_hash  TEXT NOT NULL,             -- payload 的 sha256,用于变更检测
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at  TIMESTAMPTZ,
  process_status TEXT,                     -- NULL / 'ok' / 'skipped' / 'error'
  process_error TEXT,
  UNIQUE (source, source_id, content_hash) -- 内容不变则不重复入库
);
CREATE INDEX ON crawler.raw_offers (processed_at) WHERE processed_at IS NULL;
CREATE INDEX ON crawler.raw_offers (source, fetched_at DESC);
CREATE INDEX ON crawler.raw_offers (source, merchant_hint);

-- 商家页 HTML 快照(仅少数关键站保留)
CREATE TABLE crawler.raw_pages (
  id            BIGSERIAL PRIMARY KEY,
  site_key      TEXT NOT NULL,
  url           TEXT NOT NULL,
  http_status   SMALLINT NOT NULL,
  html_r2_key   TEXT,                      -- HTML 存 R2,只留 key
  extracted     JSONB,                     -- adapter 解析出的候选 offers
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON crawler.raw_pages (site_key, fetched_at DESC);

-- 每个 site adapter 的抓取水位(增量续爬)
CREATE TABLE crawler.site_cursors (
  site_key      TEXT PRIMARY KEY,
  cursor        JSONB NOT NULL,            -- 各 adapter 自定义:page / last_id / last_ts
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 2. `platform` schema(中台业务库)

业务真值。爬虫层 reads 之为参考,但只有 Rust 中台可以写。

```sql
CREATE SCHEMA platform;

-- 商家(经过审核的规范化实体)
CREATE TABLE platform.merchants (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  domain        TEXT NOT NULL,
  aliases       TEXT[] NOT NULL DEFAULT '{}',   -- 别名 & 拼写变体,给 merchant resolver
  logo_r2_key   TEXT,
  description   TEXT,
  country_codes TEXT[] NOT NULL DEFAULT '{us}',
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending / active / hidden / merged
  merged_into   BIGINT REFERENCES platform.merchants(id),
  affiliate_ids JSONB NOT NULL DEFAULT '{}',      -- {"cj": "12345", "rakuten": "9876"}
  trust_score   REAL NOT NULL DEFAULT 0.5,        -- 0-1,进入 deal_score 加权
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON platform.merchants (status);
CREATE INDEX ON platform.merchants (domain);

-- 类目
CREATE TABLE platform.categories (
  id            BIGSERIAL PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  parent_id     BIGINT REFERENCES platform.categories(id),
  sort_order    INT NOT NULL DEFAULT 0
);

CREATE TABLE platform.merchant_categories (
  merchant_id   BIGINT REFERENCES platform.merchants(id),
  category_id   BIGINT REFERENCES platform.categories(id),
  PRIMARY KEY (merchant_id, category_id)
);

-- Offers 主表(cleaned 状态)
CREATE TABLE platform.offers (
  id                BIGSERIAL PRIMARY KEY,
  merchant_id       BIGINT NOT NULL REFERENCES platform.merchants(id),
  offer_type        TEXT NOT NULL,          -- 'code' / 'deal' / 'freeship' / 'sale'
  code              TEXT,
  code_normalized   TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  discount_type     TEXT,                   -- 'percent' / 'amount' / 'freeship' / 'bogo'
  discount_value    NUMERIC(10,2),
  currency          CHAR(3),
  min_spend         NUMERIC(10,2),

  -- 联盟归因
  affiliate_source  TEXT NOT NULL,          -- 'cj' / 'rakuten' / 'skimlinks' / 'direct'
  affiliate_url     TEXT NOT NULL,          -- 带 {clickid} 占位符
  direct_url        TEXT,                   -- 商家原始落地(用于兜底 skimlinks 或校验)

  -- 时效
  starts_at         TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 状态与评分
  status            TEXT NOT NULL DEFAULT 'active',   -- active / expired / invalid / hidden
  deal_score        SMALLINT NOT NULL DEFAULT 50,
  vote_up           INT NOT NULL DEFAULT 0,
  vote_down         INT NOT NULL DEFAULT 0,
  reported_invalid  INT NOT NULL DEFAULT 0,
  used_count        INT NOT NULL DEFAULT 0,
  validity_last_checked_at TIMESTAMPTZ,
  validity_last_result TEXT,                -- 'ok' / 'redirect_bad' / '404' / '5xx'

  -- 富化
  ai_summary        TEXT,
  ai_categories     BIGINT[],
  ai_confidence     REAL,
  content_hash      TEXT NOT NULL,          -- 关键字段 sha256,用于变更检测

  -- 溯源
  source_refs       JSONB NOT NULL DEFAULT '[]',   -- [{raw_id, source, seen_at}, ...]

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (merchant_id, code_normalized, offer_type)
);
CREATE INDEX ON platform.offers (merchant_id, status, deal_score DESC);
CREATE INDEX ON platform.offers (status, expires_at) WHERE status = 'active';
CREATE INDEX ON platform.offers (updated_at DESC);   -- 增量下发关键索引

-- 用户(注册用户,与 UGC 强绑定)
CREATE TABLE platform.users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT UNIQUE NOT NULL,
  handle        TEXT UNIQUE NOT NULL,
  auth_provider TEXT,
  karma         INT NOT NULL DEFAULT 0,
  role          TEXT NOT NULL DEFAULT 'user',
  country_code  CHAR(2),
  banned        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- UGC 提交
CREATE TABLE platform.user_submissions (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL REFERENCES platform.users(id),
  merchant_hint     TEXT,
  raw_input         JSONB NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  reviewed_by       BIGINT REFERENCES platform.users(id),
  merged_offer_id   BIGINT REFERENCES platform.offers(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 用户事件(投票、举报,统一表)
CREATE TABLE platform.user_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES platform.users(id),
  offer_id      BIGINT REFERENCES platform.offers(id),
  event_type    TEXT NOT NULL,
  metadata      JSONB,
  ip_hash       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON platform.user_events (offer_id, event_type);

-- 评论
CREATE TABLE platform.comments (
  id            BIGSERIAL PRIMARY KEY,
  offer_id      BIGINT NOT NULL REFERENCES platform.offers(id),
  user_id       BIGINT NOT NULL REFERENCES platform.users(id),
  parent_id     BIGINT REFERENCES platform.comments(id),
  body          TEXT NOT NULL,
  score         INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 联盟结算流水
CREATE TABLE platform.affiliate_transactions (
  id             BIGSERIAL PRIMARY KEY,
  network        TEXT NOT NULL,
  network_txn_id TEXT NOT NULL,
  click_id       UUID,
  offer_id       BIGINT,
  merchant_id    BIGINT,
  order_amount   NUMERIC(10,2),
  commission     NUMERIC(10,2),
  currency       CHAR(3),
  status         TEXT,
  event_time     TIMESTAMPTZ,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (network, network_txn_id)
);

-- 变更事件流(用于主动更新链路,见 05a-update-strategy)
CREATE TABLE platform.change_events (
  id            BIGSERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,             -- 'offer' / 'merchant' / 'category'
  entity_id     BIGINT NOT NULL,
  op            TEXT NOT NULL,             -- 'upsert' / 'delete'
  emitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at   TIMESTAMPTZ                -- app-syncer 消费后写入
);
CREATE INDEX ON platform.change_events (consumed_at, id) WHERE consumed_at IS NULL;
```

## 3. `app` schema(C 端消费库)

**为查询模式而设计**,不为存储正确性。中台把 platform 数据「投影 + 反规范化」到这里,再镜像到 D1。

**为什么单独一个 schema 而不是直接读 platform**:
- 查询模式与业务模式不同(前者要 join、后者要审计)
- 反规范化字段(merchant_slug 冗余进 offer)减少 join
- 可以独立索引、独立分区、独立缓存
- 边缘 D1 的 schema 就是它的镜像,变一次同步一处
- Platform 大改字段时 App 层可以先兼容旧 schema

```sql
CREATE SCHEMA app;

-- offers(C 端主查询表,已反规范化)
CREATE TABLE app.offers (
  id                BIGINT PRIMARY KEY,        -- 与 platform.offers.id 相同
  merchant_id       BIGINT NOT NULL,
  merchant_slug     TEXT NOT NULL,             -- 冗余,避免 D1 join
  merchant_name     TEXT NOT NULL,
  merchant_logo_url TEXT,

  offer_type        TEXT NOT NULL,
  code              TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  ai_summary        TEXT,
  discount_type     TEXT,
  discount_value    NUMERIC(10,2),
  currency          CHAR(3),
  min_spend         NUMERIC(10,2),

  affiliate_url     TEXT NOT NULL,             -- 带 {clickid}
  affiliate_source  TEXT NOT NULL,

  expires_at        TIMESTAMPTZ,
  status            TEXT NOT NULL,
  deal_score        SMALLINT NOT NULL,
  vote_up           INT NOT NULL,
  vote_down         INT NOT NULL,
  used_count        INT NOT NULL,

  category_slugs    TEXT[] NOT NULL DEFAULT '{}',  -- 冗余的 slug,便于筛选
  country_codes     TEXT[] NOT NULL DEFAULT '{us}',

  updated_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON app.offers (merchant_slug, status, deal_score DESC);
CREATE INDEX ON app.offers (status, expires_at) WHERE status = 'active';
CREATE INDEX ON app.offers (updated_at DESC);       -- D1 增量同步游标
CREATE INDEX ON app.offers USING GIN (category_slugs);

-- merchants(C 端商家页)
CREATE TABLE app.merchants (
  id                BIGINT PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  domain            TEXT NOT NULL,
  logo_url          TEXT,
  description       TEXT,
  active_offer_count INT NOT NULL DEFAULT 0,
  category_slugs    TEXT[] NOT NULL DEFAULT '{}',
  country_codes     TEXT[] NOT NULL DEFAULT '{us}',
  status            TEXT NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON app.merchants (status);
CREATE INDEX ON app.merchants (updated_at DESC);
CREATE INDEX ON app.merchants USING GIN (category_slugs);

-- categories 平铺,C 端不再要求树形 join
CREATE TABLE app.categories (
  id            BIGINT PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  parent_slug   TEXT,
  sort_order    INT NOT NULL DEFAULT 0,
  merchant_count INT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL
);

-- 用户 & UGC 的 C 端投影(D1 也写这个)
CREATE TABLE app.users (
  id            BIGINT PRIMARY KEY,
  handle        TEXT UNIQUE NOT NULL,
  email_hash    TEXT NOT NULL,             -- 只放哈希,原邮箱不出 platform
  karma         INT NOT NULL,
  role          TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);

CREATE TABLE app.comments (
  id            BIGINT PRIMARY KEY,
  offer_id      BIGINT NOT NULL,
  user_id       BIGINT NOT NULL,
  user_handle   TEXT NOT NULL,             -- 冗余
  parent_id     BIGINT,
  body          TEXT NOT NULL,
  score         INT NOT NULL,
  status        TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON app.comments (offer_id, created_at DESC);

-- D1 反向同步:边缘产生的用户事件(vote / report)
CREATE TABLE app.user_events_edge (
  id            BIGSERIAL PRIMARY KEY,
  d1_id         BIGINT NOT NULL,           -- 边缘 D1 的 rowid
  user_id       BIGINT,
  offer_id      BIGINT NOT NULL,
  event_type    TEXT NOT NULL,
  ip_hash       TEXT,
  edge_created_at TIMESTAMPTZ NOT NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  promoted_at   TIMESTAMPTZ,               -- 提升到 platform.user_events 的时间
  UNIQUE (d1_id)
);

-- 同步游标(记录 app → D1 每次同步到哪一行)
CREATE TABLE app.sync_cursors (
  channel       TEXT PRIMARY KEY,          -- 'd1_offers' / 'd1_merchants' / 'ugc_pull'
  cursor        JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## 4. Cloudflare D1(边缘只读镜像)

D1 schema 与 `app.*` 一一对应,类型换成 SQLite:

```sql
-- D1: offers
CREATE TABLE offers (
  id                INTEGER PRIMARY KEY,
  merchant_id       INTEGER NOT NULL,
  merchant_slug     TEXT NOT NULL,
  merchant_name     TEXT NOT NULL,
  merchant_logo_url TEXT,
  offer_type        TEXT NOT NULL,
  code              TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  ai_summary        TEXT,
  discount_type     TEXT,
  discount_value    REAL,
  currency          TEXT,
  min_spend         REAL,
  affiliate_url     TEXT NOT NULL,
  affiliate_source  TEXT NOT NULL,
  expires_at        INTEGER,
  status            TEXT NOT NULL,
  deal_score        INTEGER NOT NULL,
  vote_up           INTEGER NOT NULL DEFAULT 0,
  vote_down         INTEGER NOT NULL DEFAULT 0,
  used_count        INTEGER NOT NULL DEFAULT 0,
  category_slugs    TEXT NOT NULL DEFAULT '[]',    -- JSON 字符串
  country_codes     TEXT NOT NULL DEFAULT '["us"]',
  updated_at        INTEGER NOT NULL
);
CREATE INDEX offers_merchant_score ON offers(merchant_slug, status, deal_score DESC);
CREATE INDEX offers_active_exp ON offers(status, expires_at);
CREATE INDEX offers_updated ON offers(updated_at DESC);

CREATE TABLE merchants (
  id                INTEGER PRIMARY KEY,
  slug              TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  domain            TEXT NOT NULL,
  logo_url          TEXT,
  description       TEXT,
  active_offer_count INTEGER NOT NULL DEFAULT 0,
  category_slugs    TEXT NOT NULL DEFAULT '[]',
  country_codes     TEXT NOT NULL DEFAULT '["us"]',
  status            TEXT NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE categories (
  id            INTEGER PRIMARY KEY,
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  parent_slug   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  merchant_count INTEGER NOT NULL DEFAULT 0,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  handle        TEXT UNIQUE NOT NULL,
  karma         INTEGER NOT NULL,
  role          TEXT NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE comments (
  id            INTEGER PRIMARY KEY,
  offer_id      INTEGER NOT NULL,
  user_id       INTEGER NOT NULL,
  user_handle   TEXT NOT NULL,
  parent_id     INTEGER,
  body          TEXT NOT NULL,
  score         INTEGER NOT NULL,
  status        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX comments_offer ON comments(offer_id, created_at DESC);

-- D1 主写:边缘产生的事件,后续拉回 app.user_events_edge
CREATE TABLE user_events_edge (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER,
  offer_id      INTEGER NOT NULL,
  event_type    TEXT NOT NULL,
  ip_hash       TEXT,
  created_at    INTEGER NOT NULL,
  synced        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX user_events_edge_pending ON user_events_edge(synced, created_at) WHERE synced = 0;
```

## 5. 索引与主键设计原则

- **id 全流程稳定**:`platform.offers.id` = `app.offers.id` = D1 `offers.id`,不要用不同主键。这样任何一层的更新都能通过 id 精准定位。
- **updated_at 是同步的心脏**:每张 `platform.*` 与 `app.*` 表都有 `updated_at` + 索引,增量同步只扫这个游标。
- **content_hash 用于变更检测**:`crawler.raw_offers.content_hash` + `platform.offers.content_hash`。相同 content 不重复触发下游更新。

## 6. 数据保留

| 表 | 保留 | 归档 |
|----|------|------|
| `crawler.raw_offers` | 90 天(processed) / 永久(unprocessed) | R2 gzip |
| `crawler.raw_pages` | 30 天 | R2 gzip |
| `platform.offers` expired > 180d | PG 保留(压缩)| — |
| `platform.user_events` | 1 年 | R2 monthly |
| `platform.affiliate_transactions` | 3 年(税务)| — |
| `app.*` | 与 platform 同步删除 | — |

## 7. 与其他文档联动

- 主动更新链路:见 [05a-update-strategy.md](./05a-update-strategy.md)
- 中台清洗流水线:见 [05-middle-platform.md](./05-middle-platform.md)
- 爬虫写入契约:见 [04-crawler-layer.md](./04-crawler-layer.md)
- 竞品爬取策略:见 [04a-competitor-crawling.md](./04a-competitor-crawling.md)
