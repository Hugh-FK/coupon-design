# 12 — 浏览器插件

**核心作用**:把「找 coupon」这个动作从**用户主动搜索**变成**结账时插件自动找**。同类插件(Honey / Rakuten / Karma / PopShops)已证明这是**留存最强的抓手**,并显著抬高联盟收入。

**目标**:第 3-6 个月阶段(月收入 $3k → $10k)靠插件贡献 30-50% 的联盟点击。

## 1. 定位与差异化

| 竞品 | 特点 | 我方差异化 |
|------|------|------------|
| Honey | 主打自动填码 + 现金奖励(PayPal 收购后被质疑抢佣金) | 我们**不劫持**其它站的 affiliate cookie |
| Rakuten | 返现为主 | 首版不做返现,后期做"社区评分 + 场景 deal" |
| Karma / PopShops | 收藏 + 降价提醒 | 我方绑主站 UGC:插件里能看到评论/评分 |

**首版极简策略**:三个功能 + 一个"绝不做"。
- ✅ **结账页自动填码**:识别商家 → 从我方 D1 拉可用 code → 逐个尝试 → 应用最优
- ✅ **购物页横幅**:进入商家域时展示"there are N verified deals",一键跳我方站
- ✅ **登录同步**:与主站账号打通,插件行为写入用户主页
- ❌ **绝不做**:改写用户当前购物页的 affiliate cookie(Honey 之所以被抵制的核心争议)

## 2. 技术架构

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Chrome / Firefox / Edge)                      │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐ │
│  │ Popup    │  │ Content Script│  │ Background        │ │
│  │(React)   │  │(注入商家页)   │  │ Service Worker    │ │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘ │
└───────┼────────────────┼───────────────────┼───────────┘
        │                │                   │
        │                │                   ▼
        │                │       ┌─────────────────────────┐
        │                │       │  Cloudflare Worker API   │
        │                │       │  (extension.dealsxyz.com)│
        │                │       └────────────┬────────────┘
        │                │                    │
        │                │                    ▼
        │                │              D1(offers/merchants)
        │                │              KV(热榜、rules)
        └────────────────┴──── 结账事件 → CF Queue → PG
                                (user_events / attribution)
```

**关键组件**:

- **Popup**:React + Tailwind,主站账号登录
- **Content Script**:每个 tab 注入,识别当前站是否商家,识别是否结账页,监听 code input
- **Background Service Worker**(MV3):
  - 与主站 API 通信
  - 缓存商家列表 + 匹配规则(减少每 tab 的 API 调用)
  - Attribution 事件写队列
- **API 端**:复用主站 Cloudflare Worker,新增 `/ext/*` 前缀路由

## 3. 商家识别与匹配

### 3.1 商家识别

浏览器 URL → 商家:
- 提取 `hostname`(去 www、去国家 subdomain)
- 查询 D1 `merchants WHERE domain = ? OR $1 = ANY(alt_domains)`
- 命中 → 加载该商家 active offers

**alt_domains** 字段(在 `platform.merchants.aliases` 已有,`app.merchants` 新增):
- 例:Nike 的 `nike.com`、`store.nike.com`、`nikeplus.com`(需要研究收录)

### 3.2 结账页识别

**多层策略**:

1. **URL 模式匹配**:每个商家一条正则(存 KV,插件启动加载)
   ```
   nike.com/checkout$
   nike.com/cart\?checkout=
   ```
2. **DOM 特征识别**(通用兜底):存在 `input[name*="promo" i], input[name*="coupon" i], input[id*="promo" i]` 且不在 hidden 状态
3. **URL keyword 兜底**:`/checkout`、`/cart`、`/basket`、`/order/`

命中任一即认定结账页。

## 4. Auto-fill 流程

```
用户到达结账页 → content script 弹出 shadow-DOM 徽章
    "找到 8 个 verified codes,自动尝试? [Try] [Dismiss]"
    │
    ├─ 用户点 Try
    │   └─ 逐个 code:
    │       1. 填入 code input
    │       2. 触发 native input event(不是 setter,防 React state 不更新)
    │       3. 点击 apply 按钮(selector 由每商家 rule 提供)
    │       4. 等待响应 500-1500ms
    │       5. 判断成功:比价"总价"是否变化,或成功文案是否出现
    │       6. 记录结果:code_id → success/fail
    │   └─ 应用最优 code(最大折扣的成功那个),不成功的清空
    │
    └─ 用户点 Dismiss
        └─ 记录事件,该商家 24h 内不再弹
```

### 4.1 每商家的 rule 结构

```json
{
  "merchant_slug": "nike",
  "checkout_url_regex": "nike\\.com/checkout",
  "code_input_selector": "input[name='promoCode']",
  "apply_button_selector": "button[data-e2e='apply-promo']",
  "total_price_selector": "[data-e2e='order-total']",
  "success_indicator": {
    "type": "text",
    "selector": "[data-e2e='promo-applied']",
    "regex": "applied|success"
  },
  "wait_after_apply_ms": 800,
  "max_codes_to_try": 8,
  "trust_level": "high"    // high = 稳定; low = 只提示不自动
}
```

- rule 由中台运营编辑或半自动生成(LLM 从 DOM 结构推断,人工校验)
- 存 `platform.merchant_extension_rules`,同步到 `app.merchant_extension_rules` 到 D1
- 插件每小时增量拉 rules(带 If-None-Match)
- **同一份 rule 也是验证栈 L3(结账模拟)所需**,见 [05b-validation-and-ingest-policy.md](./05b-validation-and-ingest-policy.md#l3--结账模拟top-100贵准)。运营配一次,插件与验证栈双处收益

### 4.2 攻击面 & 安全

- 只在 https 站生效
- 不上传 checkout 页面 DOM 内容(privacy)
- 只上传:merchant_slug、试过哪些 code_id、成功哪个、最终节省金额
- 不注入 `<script>`,只用 shadow DOM 显示 UI

## 5. 与联盟归因

**决策**:**不劫持** cookie。理由:
1. 破坏用户信任 & 商家关系(Honey 被 Amazon 起诉的核心争议)
2. 联盟网络明确禁止(FTC + FTC 的 last-click 政策)
3. 我方本站已有的联盟出口是主收入路径,不需要靠劫持插件流量

**替代路径**:
- 用户在插件里点"Save with our deal"→ 走**我方 302** → 拿到我方 SubID → 保留归因
- 若用户直接在商家站结账使用了我方推荐的 code:不主张归因,只算作**用户价值(留存)**
- 如果用户是从我方主站进入的商家页(有效的 30 min last-click 窗内)→ 归因还在,插件只是辅助填码

## 6. 数据表增量

在 [03-data-model.md](./03-data-model.md) 的 platform / app 各加一张表:

```sql
CREATE TABLE platform.merchant_extension_rules (
  merchant_id           BIGINT PRIMARY KEY REFERENCES platform.merchants(id),
  checkout_url_regex    TEXT,
  code_input_selector   TEXT,
  apply_button_selector TEXT,
  total_price_selector  TEXT,
  success_indicator     JSONB,
  wait_after_apply_ms   INT DEFAULT 800,
  max_codes_to_try      SMALLINT DEFAULT 6,
  trust_level           TEXT DEFAULT 'medium',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by            TEXT
);

-- 插件事件(用于成功率统计与规则纠错)
CREATE TABLE platform.extension_events (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT,
  merchant_id   BIGINT,
  offer_id      BIGINT,
  event_type    TEXT NOT NULL,   -- 'checkout_detected' / 'try_code' / 'code_success' / 'code_fail'
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX ON platform.extension_events (merchant_id, event_type);
```

同步到 D1(只需要 rule + `active_offer_count`,event 只反向回传中台不进 D1)。

## 7. Extension 项目结构

```
extension/
├── manifest.json                # MV3
├── src/
│   ├── background/index.ts      # service worker
│   ├── content/
│   │   ├── index.ts             # 主注入
│   │   ├── detector.ts          # 商家 & 结账页识别
│   │   ├── autofill.ts          # 填码逻辑
│   │   └── ui/                  # shadow-DOM 组件
│   ├── popup/
│   │   ├── App.tsx              # popup 主界面
│   │   ├── login.tsx
│   │   └── merchant-view.tsx
│   ├── api/
│   │   ├── client.ts            # 与主站 Worker 通信
│   │   └── auth.ts              # OAuth via web_accessible / Better-Auth
│   ├── storage/
│   │   ├── rules.ts             # merchant rules 缓存
│   │   └── prefs.ts             # 用户偏好
│   └── i18n/
├── public/
│   └── icons/
├── build/                       # esbuild / vite output
├── vite.config.ts               # 用 vite + @crxjs/vite-plugin
└── package.json
```

**技术栈**:
- Manifest V3(Chrome 强制,Firefox 也支持)
- React + Tailwind for popup 与 shadow-DOM UI
- Vite + `@crxjs/vite-plugin` 构建
- 共用主站 API,复用 Better-Auth session cookie(需要 `host_permissions` 覆盖主域)

## 8. 用户价值 loop

- 装机:主站顶部"Get 20% more savings — install our extension"CTA + 商家页"install to auto-apply"卡片
- 首次使用:装机后引导用户去 top 3 商家试一次,展示"Saved $X",立刻建立价值感知
- 反复使用:结账时自动弹徽章,零心理成本
- 病毒传播:成功保存后弹卡"Saved $X — share with a friend"(referral,主站 karma +5)
- 反流:每周 Sunday digest email,带"你本周省了 $X, 累计 $Y"

**目标 metric**:MAU / 装机 > 0.4;人均月节省金额 > $30;插件贡献 outbound click / 总 outbound > 25%(V1.5 结束前)

## 9. 商店提交

| 商店 | 审核时长 | 关键点 |
|------|----------|--------|
| Chrome Web Store | 3-14 天 | 隐私政策必须清晰披露数据收集范围;privacy label 齐全 |
| Firefox Add-ons | 1-3 天 | AMO 开源审核,若使用非公开代码会人工过 |
| Edge Add-ons | 3-7 天 | 复用 Chrome zip 即可 |

**必备**:
- 精细化的 Privacy Policy(比主站更严):不上传 URL 全路径、不采集其他站表单数据
- 5 张商店截图 + 1 段 30s 演示视频
- 具体功能描述,不用夸张营销语

## 10. 里程碑(3-6 个月阶段)

| 周次 | 交付 |
|------|------|
| 第 10 周 | Extension 骨架 + popup + 主站登录打通 + 商家识别 + top 100 商家 rules |
| 第 12 周 | 结账页填码 alpha,内测 20 用户 |
| 第 14 周 | Chrome Web Store beta 提审 |
| 第 16 周 | 公开发布 + 主站 CTA 引导 |
| 第 18 周 | Firefox / Edge 上架;500 商家 rules |
| 第 20 周 | Sunday digest email + referral;插件 DAU > 500 |
| 第 24 周 | 2000 商家 rules;插件 outbound click 占比 > 25% |

## 11. 风险与预案

| 风险 | 预案 |
|------|------|
| Chrome Web Store 拒绝(隐私 / 权限过大) | 权限最小化(只申请必要 host_permissions);privacy 严格披露 |
| 商家页 DOM 频繁变(rule 失效) | 每周监测各商家 auto-fill 成功率,< 60% 自动降级"只提示"模式 |
| 联盟网络警告"劫持" | 不劫持任何 cookie,只用我方 SubID;必要时 pause 该商家 |
| 用户投诉插件在结账时打断 | 徽章体积极小、可 dismiss、24h 内该站不再弹 |
| Manifest V2 → V3 兼容性 | 从第一天就 MV3;Firefox 有 MV2 兼容,长期跟随 Chrome |

## 12. 与主站的关系

- **同一账号体系**:插件登录 = 主站登录(通过 web_accessible OAuth flow)
- **同一 API**:`api.dealsxyz.com` 加 `/ext/*` 命名空间;权限 scope 区分插件与网页
- **数据回流**:插件产生的 `extension_events` 通过 CF Queue 回中台,反哺 deal_score 有效率信号
- **UGC 打通**:插件里点"Not working" = 主站 offer 页的"Report expired",共享举报计数
