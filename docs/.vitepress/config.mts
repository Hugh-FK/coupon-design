import { defineConfig } from 'vitepress'

const SITE_URL = process.env.SITE_URL ?? 'https://coupon-design.pages.dev'
const REPO_URL = process.env.REPO_URL ?? 'https://github.com/your-org/coupon-design'
// 项目页部署到 https://<owner>.github.io/<repo>/ 时,需要 base='/<repo>/'
// 用户主页(<user>.github.io)或自定义域名部署时留 '/'
// CI 通过 DOCS_BASE 注入;本地开发默认 '/' 不受影响
const BASE = process.env.DOCS_BASE ?? '/'

export default defineConfig({
  title: 'Coupon Site 落地方案',
  titleTemplate: ':title | Coupon Site 落地方案',
  description: '北美 + 欧洲 coupon 站的完整落地设计:三层架构、SEO、社区、联盟、合规、路线图',
  lang: 'zh-CN',

  base: BASE,

  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,

  srcExclude: ['README.md'],

  sitemap: {
    hostname: SITE_URL
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
    ['link', { rel: 'apple-touch-icon', href: '/favicon.svg' }],
    ['meta', { name: 'theme-color', content: '#d97706' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'Coupon Site 落地方案' }],
    ['meta', { property: 'og:image', content: `${SITE_URL}/logo.svg` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],

  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    image: {
      lazyLoading: true
    }
  },

  themeConfig: {
    logo: { src: '/logo.svg', width: 24, height: 24 },
    siteTitle: 'Coupon Site',

    nav: [
      { text: '首页', link: '/' },
      {
        text: '业务与产品',
        items: [
          { text: '01 商业模式与市场', link: '/01-business-and-market' },
          { text: '07 SEO 策略', link: '/07-seo-strategy' },
          { text: '08 社区与 UGC', link: '/08-community-ugc' },
          { text: '09 联盟集成', link: '/09-affiliate-integration' },
          { text: '12 浏览器插件', link: '/12-browser-extension' },
          { text: '13 商家内容生产', link: '/13-merchant-content-pipeline' }
        ]
      },
      {
        text: '技术架构',
        items: [
          { text: '02 系统架构', link: '/02-architecture' },
          { text: '03 数据模型(schema 隔离)', link: '/03-data-model' },
          { text: '04 爬虫层', link: '/04-crawler-layer' },
          { text: '04a 竞品爬取方案', link: '/04a-competitor-crawling' },
          { text: '05 中台层', link: '/05-middle-platform' },
          { text: '05a 主动更新策略', link: '/05a-update-strategy' },
          { text: '05b 入库与验证策略', link: '/05b-validation-and-ingest-policy' },
          { text: '06 边缘前台', link: '/06-edge-frontend' }
        ]
      },
      { text: '合规', link: '/10-compliance' },
      { text: '路线图', link: '/11-roadmap' }
    ],

    sidebar: [
      {
        text: '总览',
        items: [{ text: '📖 项目概览', link: '/' }]
      },
      {
        text: '业务规划',
        collapsed: false,
        items: [
          { text: '01. 商业模式与市场', link: '/01-business-and-market' }
        ]
      },
      {
        text: '技术架构',
        collapsed: false,
        items: [
          { text: '02. 系统架构', link: '/02-architecture' },
          { text: '03. 数据模型', link: '/03-data-model' },
          { text: '04. 爬虫层', link: '/04-crawler-layer' },
          { text: '04a. 竞品爬取方案', link: '/04a-competitor-crawling' },
          { text: '05. 中台层', link: '/05-middle-platform' },
          { text: '05a. 主动更新策略', link: '/05a-update-strategy' },
          { text: '05b. 入库与验证策略', link: '/05b-validation-and-ingest-policy' },
          { text: '06. 边缘前台', link: '/06-edge-frontend' }
        ]
      },
      {
        text: '增长与运营',
        collapsed: false,
        items: [
          { text: '07. SEO 策略', link: '/07-seo-strategy' },
          { text: '08. 社区与 UGC', link: '/08-community-ugc' },
          { text: '09. 联盟集成', link: '/09-affiliate-integration' },
          { text: '12. 浏览器插件', link: '/12-browser-extension' },
          { text: '13. 商家内容生产', link: '/13-merchant-content-pipeline' }
        ]
      },
      {
        text: '合规与落地',
        collapsed: false,
        items: [
          { text: '10. 合规', link: '/10-compliance' },
          { text: '11. 路线图', link: '/11-roadmap' }
        ]
      }
    ],

    outline: {
      level: [2, 3],
      label: '本页目录'
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇'
    },

    lastUpdated: {
      text: '最后更新',
      formatOptions: {
        dateStyle: 'medium',
        timeStyle: 'short'
      }
    },

    editLink: {
      pattern: `${REPO_URL}/edit/main/:path`,
      text: '在 GitHub 上编辑本页'
    },

    socialLinks: [
      { icon: 'github', link: REPO_URL }
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档'
          },
          modal: {
            displayDetails: '显示详情',
            resetButtonTitle: '清除查询条件',
            backButtonTitle: '返回',
            noResultsText: '无法找到相关结果',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '选择',
              navigateText: '切换',
              navigateUpKeyAriaLabel: '上',
              navigateDownKeyAriaLabel: '下',
              closeText: '关闭',
              closeKeyAriaLabel: 'esc'
            }
          }
        }
      }
    },

    footer: {
      message: 'Coupon Site 落地方案 · 内部设计文档',
      copyright: `© ${new Date().getFullYear()} coupon-design`
    }
  }
})
