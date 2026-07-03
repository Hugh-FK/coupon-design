# 08 — 社区与 UGC

社区不是「加个评论区」这么简单。它决定站点信任度、SEO 内容护城河、以及能不能对抗 Google 对 coupon 站的降权。

## 1. 社区目标(按优先级)

1. **信任信号**:活跃评论 + 投票 → 用户敢用码 → 联盟转化率高
2. **SEO 内容差异化**:UGC 是纯原创、爬虫复制不了
3. **数据反哺**:哪些码有效、哪些商家值得推、什么时段折扣多
4. **留存**:核心用户回访、订阅 email、分享给朋友

**不做**:纯社交、私聊、粉丝关系图 —— 与主业无关。

## 2. 用户角色与权限

| 角色 | 获取 | 权限 |
|------|------|------|
| Guest | — | 浏览、不能投票、不能评论 |
| User | 注册 | 投票、评论、提交 offer、举报 |
| Trusted User | karma > 100,加入 30d | 投票权重 x2、评论顶置候选 |
| Moderator | 邀请 | 隐藏评论、审核 UGC 提交、封禁 |
| Editor | 内部 | 商家页编辑、blog 发布 |
| Admin | 内部 | 全部 |

## 3. 关键 UGC 交互

### 3.1 投票

- Offer 卡片右上角:`👍 Worked (245)  👎 Didn't work (12)`
- 登录必需,一 offer 只能投一次(可改)
- Trusted User 权重 2 倍(计入 vote_up_weighted 而非改变原始 count)
- 影响 `deal_score`(见 [05-middle-platform.md](./05-middle-platform.md#42-scorer))

### 3.2 评论

- 支持二级楼中楼(不做无限嵌套)
- Markdown 子集(bold / italic / link),渲染时 sanitize
- 支持 upvote / downvote,评分排序
- Editor 可 pin

### 3.3 提交新 Deal

**表单**:
- Merchant(自动补全,支持新建请求)
- URL(必填,爬虫补全信息)
- Coupon Code(可选)
- Description(必填,20-300 字)
- Discount type + value
- Expires at(可选)

**流程**:
```
用户提交 → 反爬 (Turnstile) → 写入 user_submissions (pending)
        → 爬虫 crawl:submit 队列抓取 URL 补充
        → LLM 生成规范化摘要 + 分类
        → Moderator 审核队列
        → approved → merged 到 offers 表 → 提交人 +10 karma
```

首次提交必须人工审核。用户 karma > 500 且历史通过率 > 90% → 自动审核通过(仍可回溯)。

### 3.4 举报无效码

- Offer 页显式按钮 `Report as expired/invalid`
- 举报 3 次(不同 IP + 不同用户)自动触发中台 validator 复检
- 复检确认无效 → status = 'invalid',列表下沉,详情页显式标记

### 3.5 用户主页

- 展示提交的 offers、评论、karma、徽章
- 公开可访问但 `noindex, follow`(避免 UGC 弱页面稀释权重)

## 4. Karma 与激励

| 事件 | Karma |
|------|-------|
| 提交被通过 | +10 |
| 提交被 downvote 多 → 撤回 | -5 |
| 评论被 upvote | +1(每评论最多累计 +20) |
| 评论被 downvote | -0.5 |
| 举报证实 | +2 |
| 每日登录 | +1(上限 30/月) |

**徽章体系**(V1 起):
- Rookie(首个提交)
- Verified Saver(10 个提交通过)
- Community Pro(karma > 500)
- Deal Hunter(单个提交 upvote > 100)

徽章展示在评论头像旁,无功利价值但有社交价值。

## 5. 防作弊(极其重要,coupon 站作弊是常态)

### 5.1 常见作弊模式

- 商家或竞争对手雇水军 upvote 自家 offer / downvote 对手
- 一次性账号刷提交
- 评论区植入外链
- 蹭 karma 的 low-effort 灌水评论

### 5.2 手段

**账号层**:
- Email 验证必需,禁 disposable email domains(用 [disposable-email-domains](https://github.com/disposable-email-domains) 名单)
- Google/GitHub OAuth 优先(自然过滤 bot)
- 新账号 24 小时内不能投票、不能提交

**行为层**:
- 同 IP + 同 offer 5 分钟内多次投票 → 反爬 challenge
- Turnstile 保护关键写路径
- 投票权重与账号年龄挂钩(< 7 天权重 0.5)
- 相同评论文本触发 duplicate detection(Redis 布隆过滤)

**内容层**:
- 评论过 LLM 分类(`llm-guard` 或 Perspective API):spam / harassment / promotion
- 评论中含外链 → 自动隐藏待审
- 举报 5 次以上评论自动隐藏

**审计层**:
- 中台每日跑一次异常检测:某 offer 单日 upvote 突增(> 3σ)→ Moderator 队列
- 商家关联账号识别(相同 UA fingerprint + 相似 email pattern)

## 6. 冷启动内容策略

社区最难在于「0-100 用户」阶段。策略:

1. **种子内容**:MVP 上线时,内部编辑手动写 200 条 offer 评论(标记 verified staff),塑造调性
2. **邀请核心种子用户**:从 Reddit /r/coupons、Slickdeals、DealAlert 等社区找活跃用户,私信邀请,前 100 名给 lifetime "Founder" 徽章
3. **Newsletter 拉动**:每周精选 UGC → email 推送 → 引流回站点评论
4. **数据回填**:用商家历史投诉数据 + 联盟成功率作为 initial deal_score,评论区非空时才让新用户看到"沉默页面"

## 7. 内容审核流程

**审核队列**(Admin 后台):

| 队列 | 触发条件 | SLA |
|------|----------|-----|
| pending_submissions | 用户提交,自动过滤后 | 12 小时 |
| flagged_comments | 举报 ≥ 3 或 LLM 判定风险 | 4 小时 |
| suspicious_votes | 异常检测触发 | 24 小时 |
| new_merchants | 用户提交时创建的新商家 | 48 小时 |

MVP 阶段每日投入 2 小时人工审核就够。V1 起用兼职外包。

## 8. Newsletter(留存)

- 双 opt-in(GDPR/CCPA 合规)
- 频率:每周一封 + 大促紧急(黑五/网一)
- 内容:top deals of the week + community highlights + 编辑推荐
- 每封信底部有 unsubscribe 一键
- 使用 Resend / SendGrid,发送域独立(subdomain),SPF/DKIM/DMARC 齐全
- 参考 `cloudflare-email-service` skill

## 9. 通知系统(V1)

- 站内通知:提交被审核、评论被回复、订阅商家新 offer
- Email 通知:每日 digest + 关键动作
- Push(V2):Web Push,商家新 offer 上线

## 10. 与其他文档联动

- 数据表 `users / user_submissions / user_events / comments`:[03-data-model.md](./03-data-model.md)
- Turnstile / 反爬:[06-edge-frontend.md](./06-edge-frontend.md#12-反机器人)
- Karma 影响 deal_score:[05-middle-platform.md](./05-middle-platform.md#42-scorer)
