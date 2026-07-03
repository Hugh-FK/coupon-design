# 10 — 合规

北美 + 欧洲市场,合规不是「加个 cookie 弹窗」这么简单。**违规成本远高于合规成本**(GDPR 罚款上限 4% 全球营收,CCPA 每次违规 $2500-7500)。

## 1. 适用法规矩阵

| 法规 | 地区 | 适用性 | 强制程度 |
|------|------|--------|----------|
| GDPR | 欧盟 + 英国(UK-GDPR) | 面向欧洲用户即适用 | 极强 |
| CCPA/CPRA | 加州 | 加州用户 4 万+/年 或营收 $25M+ | 强 |
| COPPA | 美国 | 儿童数据(< 13),我们不针对 | 弱(除非误采) |
| FTC Act(§5) | 美国 | 广告披露 | 强 |
| CAN-SPAM | 美国 | Email 营销 | 强 |
| ePrivacy | 欧盟 | Cookie 同意 | 强 |
| Digital Services Act(DSA) | 欧盟 | 用户 UGC 平台 | 强(> 45M MAU) |
| PIPEDA | 加拿大 | 加拿大用户 | 中 |
| DMCA | 美国 | UGC 版权 | 强 |

## 2. Cookie & 追踪同意

**GDPR/ePrivacy 要求**:非严格必需的 cookie 必须**opt-in**(默认关闭,用户明确同意才存)。

**分类**:

| 类型 | 例 | GDPR 需同意 | CCPA 需同意 |
|------|-----|-------------|-------------|
| Strictly Necessary | Session、CSRF、地区路由 | 否 | 否 |
| Preferences | 语言、货币 | 是(隐性 OK) | 否 |
| Analytics | GA4、Plausible | 是 | 通知即可 |
| Marketing / Affiliate SubID | click_id、affiliate cookie | 是 | Sale of Data 需 opt-out |

**实现**:
- 用 Cloudflare Zaraz 或自建轻量 CMP
- 首次访问弹窗:Accept / Reject / Customize
- 拒绝后:仅保留必需 cookie,affiliate 追踪链接需替换成 no-cookie 变体(部分联盟支持)
- **地理路由**:非欧盟用户不弹强同意;欧盟用户强弹
- 用户选择存 KV(TTL 12 个月),同时提供随时更改入口(footer "Cookie Preferences")

**关键坑**:很多站点弹窗按钮做成 "Accept" 大按钮 + "Reject" 藏起来,GDPR 已明确判决为**非法**(2023-2024 多个 CNIL 案例)。**"拒绝" 必须与 "接受" 同等醒目**。

## 3. 数据主体权利(GDPR / CCPA)

| 权利 | GDPR | CCPA | 实现 |
|------|------|------|------|
| 访问 | 是 | 是 | 用户设置页导出 JSON |
| 更正 | 是 | 是 | 设置页可编辑 |
| 删除(被遗忘) | 是 | 是 | 请求表单 + 30 天内响应 |
| 数据可携 | 是 | 部分 | JSON 下载 |
| 反对处理 | 是 | 部分 | opt-out toggle |
| Do Not Sell / Share | 部分 | 是 | 首页 footer "Do Not Sell My Info" 链接(CCPA 强制) |

**流程**:
1. 用户在设置页发起请求
2. Email 二次确认(防冒用)
3. 中台执行:硬删除 `users` + 关联 `user_events` / `comments` / `submissions`
4. UGC 内容:选择匿名化(改 user_id = NULL,保留内容)或全删
5. 30 天内 email 通知完成
6. 请求日志保留 3 年备审计

## 4. Affiliate 披露(FTC + Google)

**FTC Endorsement Guides**(2023 更新)要求:

- 页面首屏可见位置:显式披露「我们可能通过点击链接获得佣金」
- 每个包含联盟链接的页面都要有(不能只在 Privacy Policy 里写)
- 必须**清晰、显著、易懂**,不能藏在页脚字体阴影里

**实现**:
```html
<!-- 每个商家页顶部 -->
<div class="affiliate-disclosure">
  <p>Advertiser Disclosure: We may earn a commission when you click links on this page. This does not affect our editorial ratings.</p>
</div>
```

**Google Webmaster 政策**:
- 联盟链接 `rel="sponsored nofollow"` 必须
- 不做「thin affiliate content」(纯把商家页复制过来)—— 这是 coupon 站被降权的最大原因
- 每个页面要有独立价值(用户评论、编辑内容、社区数据)

## 5. UGC 责任(DSA / DMCA)

**DMCA safe harbor**(美国):
- 指定 DMCA agent(在 US Copyright Office 登记)
- 快速响应 takedown notice(< 5 工作日)
- 用户上传内容注明来源

**DSA**(欧盟,2024 生效):
- 提供举报入口(每评论、每提交)
- 举报后 24 小时内响应
- 透明报告(> 一定规模才需)
- 违法内容(仿冒、欺诈)删除并保留证据

**UGC 内容审核政策**(在 Terms 里写清):
- 禁止:恶意软件链接、仿冒品推广、成人内容、种族/性别歧视、垃圾链接
- 违反 → 内容隐藏 + 用户警告 → 累犯封禁
- 保留删除记录 6 个月备审计

## 6. Email 合规

**CAN-SPAM(美国)+ GDPR(欧洲)**:
- 双 opt-in(邮件确认订阅链接)
- 每封信有物理地址(公司地址,PO Box 也行)
- Unsubscribe 一键有效,10 工作日内生效
- 不使用误导性 subject line
- 分离交易邮件(session verify 等,GDPR 允许无同意发)与营销邮件(需同意)

## 7. Privacy Policy 必备项

- 收集哪些数据(email、IP、UA、cookies、UGC)
- 用途(展示、防作弊、分析、Affiliate 归因)
- 第三方共享(联盟网络、Cloudflare、AI providers)
- 保留期(active 用户永久;inactive 3 年后删)
- 用户权利与联系方式
- Cookie 类型详列
- 更新历史

用律师起草(不要 ChatGPT),尤其是欧洲适用版本。首年费用 $2k-5k。

## 8. Terms of Service 必备项

- 服务描述与免责(coupon 有效性不承诺)
- UGC 归属(用户保留版权,授予我们使用许可)
- 禁止行为
- 账号封禁条款
- 变更通知机制
- 管辖法律与仲裁地(Delaware / England)
- 联盟披露

## 9. 儿童保护

- 不针对 < 13 用户,注册时问出生年月
- 若识别到未成年,拒绝创建 + 删除已有数据
- 不在页面放 age-inappropriate 广告

## 10. 数据本地化

- **不需要**在欧盟内部存欧盟数据(GDPR 允许跨境传输,只要有 Standard Contractual Clauses)
- Cloudflare、AWS 都有 EU-US Data Privacy Framework 认证
- Privacy Policy 写清楚数据存哪(Cloudflare 全球 + PG 主 US East)

## 11. 支付与税务(远期)

MVP 不涉及。V2 若开付费会员或商家广告位:
- Stripe 处理 PCI DSS
- 欧盟 VAT(收 B2C 需按买家国收 VAT)
- 美国州税(Wayfair 判决后按经济连接判定)

## 12. 上线前 checklist

- [ ] Privacy Policy 已上线
- [ ] Terms of Service 已上线
- [ ] Cookie Consent Banner(欧洲 IP 强弹)
- [ ] Affiliate Disclosure 每个商家页可见
- [ ] Do Not Sell/Share My Info 页面(CCPA)
- [ ] 数据主体权利请求表单
- [ ] DMCA agent 登记 + `/legal/dmca` 页面
- [ ] Newsletter 双 opt-in + unsubscribe
- [ ] `robots.txt` 与 `sitemap.xml` 明确
- [ ] `security.txt`(白帽子联系入口)
- [ ] SPF / DKIM / DMARC 配置
- [ ] SSL A+(Cloudflare 默认没问题)
- [ ] 依赖漏洞扫描(GitHub Dependabot / Snyk)
- [ ] Rate limiting 防滥用
- [ ] 备份策略(PG 每日 + WAL)
- [ ] 日志脱敏(不存原始 IP,存 SHA256(IP + salt))
