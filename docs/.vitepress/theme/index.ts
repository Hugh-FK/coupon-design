import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import './styles/custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp() {
    // 未来可注册全局组件、指令或路由钩子
  }
} satisfies Theme
