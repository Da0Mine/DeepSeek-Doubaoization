---
name: DeepSeek 桌面版
description: 办公场景的 DeepSeek 桌面客户端：低打扰、毛玻璃分层、沉稳可靠
colors:
  focus-blue: "#3370ff"
  focus-blue-bright: "#4f8cff"
  surface: "#ffffff"
  surface-raised: "rgba(255,255,255,0.96)"
  surface-muted: "#f5f6fa"
  toolbar: "rgba(30,30,30,0.95)"
  glass-bg: "rgba(255,255,255,0.55)"
  text-primary: "#1f1f1f"
  text-secondary: "#5f6368"
  text-tertiary: "#8a8f98"
  text-disabled: "#b0b3b8"
  border: "#e0e0e0"
  success: "#34c759"
  danger: "#ff3b30"
typography:
  display:
    fontSize: "calc(21px + var(--ds-font-offset, 0) * 1px)"
    fontWeight: 700
    lineHeight: 1.3
  headline:
    fontSize: "calc(18px + var(--ds-font-offset, 0) * 1px)"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontSize: "calc(16px + var(--ds-font-offset, 0) * 1px)"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontSize: "var(--ds-font-size, 14px)"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontSize: "calc(13px + var(--ds-font-offset, 0) * 1px)"
    fontWeight: 500
    lineHeight: 1.6
  caption:
    fontSize: "calc(12px + var(--ds-font-offset, 0) * 1px)"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.focus-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "7px 16px"
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "7px 16px"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "7px 12px"
  nav-item-active:
    backgroundColor: "{colors.focus-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "6px 12px"
  dialog-card:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "20px 22px"
  toolbar:
    backgroundColor: "{colors.toolbar}"
    textColor: "#ffffff"
    rounded: "22px"
    height: "44px"
  badge:
    backgroundColor: "{colors.focus-blue}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    padding: "3px 9px"
---

# Design System: DeepSeek 桌面版

## Overview

**Creative North Star: "安静的桌面助手（The Quiet Desk Companion）"**

这个系统服务于「边工作边问 AI」的办公场景：用户正埋头在文档、表格或浏览器里，需要的是一个**低打扰、随时待命**的伙伴——它不抢注意力，但一招手就出现，用完即退。因此整个界面的性格是克制而扎实的：静态时尽量安静，交互发生时反馈明确且干脆。

视觉语言建立在「分层 + 毛玻璃」之上：主窗口与设置面板是轻量浅色表面，浮层（截图工具栏、划词框、下拉菜单）用有厚度的深色玻璃或高不透明度毛玻璃，形成清晰的「工作区在上、工具在下」的层次。控件手感沉稳可靠——圆角适中（8–16px）、边界清晰、状态可预期（悬停变色、按下微缩），没有多余的装饰性动效。

**Key Characteristics:**
- 低打扰：主界面安静浅色，蓝色只出现在「需要你注意或可操作」的地方
- 有厚度的毛玻璃：浮层高不透明度 + 清晰边框 + 双层阴影，不飘
- 沉稳的控件：统一圆角与 0.2s 过渡，按下缩放 0.96 的确定感
- 全局可调：字号（-10 ~ +10）与深浅主题是产品的无障碍承诺，任何新界面必须尊重
- 深色浮层恒定：截图工具栏、下拉菜单在两种主题下都保持深色，保证对比度

## Colors

主色是办公场景的「专注蓝」，中性色是一套完整的文字/背景/边框阶梯，深浅主题各有一套值（由主进程下发 `--ds-*` 变量）。

### Primary
- **专注蓝 Focus Blue** (`#3370ff`，深色模式 `#4f8cff`): 唯一强调色。用于主按钮、选中态、导航激活、焦点环、徽标背景、进度条。深色模式提亮一档以保持对比度。

### Neutral
- **表面 Surface** (`#ffffff`，深色 `#1e1e1e`): 窗口与面板底色。
- **抬升表面 Raised Surface** (`rgba(255,255,255,0.96)`，深色 `rgba(32,34,42,0.96)`): 弹窗卡片、引导卡片的毛玻璃底。
- **静默表面 Muted Surface** (`#f5f6fa`): 信息块、只读值底。
- **主文字 Text Primary** (`#1f1f1f`，深色 `#f2f2f2`): 标题与正文。
- **次级文字 Text Secondary** (`#5f6368`，深色 `#b3b8c2`): 说明、hint、次级标签（WCAG AA）。
- **辅助文字 Text Tertiary** (`#8a8f98`，深色 `#7c8290`): 路径、元数据、搜索无结果。
- **禁用文字 Text Disabled** (`#b0b3b8`，深色 `#5c6270`): 占位符与禁用态。
- **边框 Border** (`#e0e0e0`，深色 `#3a3a3a`): 控件描边、分隔线。
- **深色工具面 Toolbar** (`rgba(30,30,30,0.95)`): 截图工具栏、动作条、划词框底色，两种主题下恒定。
- **成功 / 危险** (`#34c759` / `#ff3b30`): 仅用于状态语义（登录态、成功/错误提示、删除）。

### Named Rules
**The Focus Blue Rule. 蓝色只出现在需要用户注意或可操作的地方（主按钮、选中、焦点、徽标、进度），任何装饰性场景不得使用；一张屏幕上强调色的面积占比保持克制。**

**The Constant Dark-Layer Rule. 工具栏、下拉菜单等浮层恒用深色面（`rgba(30,30,30,0.95)` 档），不随深浅主题翻转——它们悬浮在任意内容之上，深色是保证对比度的前提。**

## Typography

**Body Font:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif`（系统栈，Windows 落微软雅黑、macOS 落苹方）

**Character:** 单字体族、沉稳克制的系统排版。层级完全由字号、字重与间距承担，不引入第二个字体族；中文正文以 1.6–1.65 行高保证长文可读。

### Hierarchy
- **Display** (700, 21px, 1.3): 版本号等大数字，仅极少数信息场景。
- **Headline** (600, 18px, 1.3): 弹窗标题（更新、引导）。
- **Title** (600, 16px, 1.3): 面板标题、分组标题、弹窗主消息。
- **Body** (400, 14–15px, 1.6): 正文、字段值、按钮。跟随全局字号 `--ds-font-size`。
- **Label** (500, 13px, 1.6): 字段标签、次要正文、设置项 hint 之下的说明文字。
- **Caption** (400, 12px, 1.6): 元数据、路径、徽标文字。**下限 12px，全产品正文级文字不得小于 12px。**

### Named Rules
**The One-Family Rule. 全产品使用同一系统字体栈，不引入第二个字体族；层级差异靠字号、字重与间距完成，而不是靠换字体。**

**The No-Sub-12px Rule. 正文级文字不小于 12px；11px 及以下的文字不允许出现在任何窗口（图标类符号除外）。**

## Layout

中等密度、左右分栏为主。设置面板为固定 180px 侧栏导航 + 弹性内容区；字段行由「固定宽标签（约 170px）+ 弹性控件」构成，保证标签不折行、对齐一致。间距使用 4–24px 的 6 档阶梯（`--space-1..6`），卡片内边距多为 16–20px，控件行间距 10–14px。窗口布局不随视口缩放重排（桌面应用，无移动端断点）。

## Elevation & Depth

**分层 + 毛玻璃**：浅色工作区在上，深色工具浮层在下；层级主要由「表面明暗对比 + 毛玻璃 + 双层阴影」表达，而不是阴影堆叠。毛玻璃要求**有厚度**——高不透明度（0.55–0.96）+ 1px 清晰边框 + 双层阴影，避免轻薄透明感。

### Shadow Vocabulary
- **Card** (`0 8px 32px rgba(0,0,0,0.06)`): 设置面板内卡片、信息块。
- **Dialog** (`0 20px 60px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.1)`): 弹窗卡片、引导卡片。
- **Toolbar** (`0 8px 24px rgba(0,0,0,0.35)`): 截图工具栏、动作条、任务栏共享按钮。
- **Menu** (`0 8px 28px rgba(0,0,0,0.4)`): 下拉菜单浮层。
- **Hover-Lift** (`0 4px 14px rgba(51,112,255,0.08)`): 可点击卡片悬停。
- **Primary-Glow** (`0 2px 8px rgba(51,112,255,0.25)`): 主按钮，悬停加深至 `0 4px 14px rgba(51,112,255,0.32)`。

### Named Rules
**The Thick-Glass Rule. 毛玻璃浮层必须「有厚度」：不透明度不低于 0.55（弹窗 0.96）、带 1px 清晰边框与双层阴影；禁止轻薄透明的悬浮效果。**

**The Flat-By-Default Rule. 静态表面平铺（卡片仅 1px 边框 + 极轻阴影），阴影与提升只作为交互响应（悬停、焦点、浮层）出现。**

## Shapes

统一的适度圆角语言：**8px 小圆角**用于控件（按钮、输入框、列表项、徽标）、**12px** 用于分组框与信息卡片、**16px** 用于弹窗与引导卡片、**999px 胶囊**用于状态徽标与任务栏按钮；截图工具栏与动作条用 22px 大圆角胶囊。边框 1px，颜色取中性边框阶梯；取消按钮、重置等次级操作多用「白底 + 1px 边框」而非描边色块。

## Components

### Buttons
- **Shape:** 圆角 8px（`--radius-sm`），内边距 7–9px × 16–24px。
- **Primary:** 专注蓝底白字（`focus-blue` + `#fff`），字重 500；悬停 `opacity 0.92` + 蓝色辉光加深，按下 `scale(0.96)`；主操作（立即更新、发送、保存）。
- **Secondary:** 表面白底 + 1px 中性边框 + 次级文字；悬停边框与文字变专注蓝、底变淡蓝，按下 `scale(0.96)`。
- **Danger:** 仅删除类动作（如「清空标注」的 X 按钮），红字 `#c62828` 低不透明度，悬停升到 1.0。

### Inputs / Fields
- **Style:** 白底（`surface`）+ 1px 边框（`border`）+ 圆角 8px；文字主色，字号 Body。
- **Focus:** 边框变专注蓝 + 3px 淡蓝光晕（`0 0 0 3px rgba(51,112,255,0.1)`），以及键盘导航时的统一焦点环（`--focus-ring`）。
- **Placeholder / Disabled:** 禁用文字色（`text-disabled`）。

### Switch / Checkbox
- **Style:** 40×22px 圆角开关，滑钮 18px 白圆；关态灰、开态专注蓝，`0.2s` 滑动过渡；悬停加淡蓝外环。

### Select (自定义下拉)
- **Trigger:** 与输入框同款外观 + 右侧小三角图标；悬停边框变蓝。
- **Menu:** 深色毛玻璃浮层（`rgba(42,42,42,0.92)` + 16px blur + 边框 `rgba(255,255,255,0.12)`）；选项 hover 白色 10% 底、选中态淡蓝 22% 底 + 蓝描边。

### Navigation (设置侧栏)
- **Style:** 180px 固定宽；一级项 13px/600，二级项 12px/500 缩进 36px。
- **States:** 悬停淡灰底；激活项专注蓝底白字 + 左侧 3px 蓝色竖条指示；过渡 0.25s。

### Cards / Containers
- **Corner Style:** 12px（`--radius-md`）。
- **Background:** 表面白或淡蓝渐变（`linear-gradient(135deg, #fff, rgba(51,112,255,0.03))`）。
- **Shadow Strategy:** Card 档阴影；悬停 Hover-Lift 档 + 1px 蓝边框。
- **Border:** 1px 中性边框。
- **Internal Padding:** 16–20px。

### Dialog Cards
- **Corner Style:** 16px 圆角 + 半透明遮罩（`rgba(8,10,18,0.38–0.7)`）。
- **Background:** 高不透明度毛玻璃（0.96 白 / 深色 0.96 黑）。
- **Shadow Strategy:** Dialog 档双层阴影；入场用 GSAP 缩放 + 弹簧缓动（`cubic-bezier(0.34,1.56,0.64,1)`）。

### Toolbar (截图 / 划词)
- **Style:** 深色恒底面（`rgba(30,30,30,0.95)`）+ 白色图标 + 22px 大圆角；图标按钮 32px 圆形，hover 白色 20% 底 + 阴影，按下 `scale(0.95)`；激活工具项专注蓝底。

### Badge (弹窗徽标)
- **Style:** 专注蓝底白字，6px 圆角，12–13px/600，内边距 3px×9px，字距 0.3px。

### Tooltip
- **Style:** 深色浮层（`rgba(30,30,40,0.94)` + 4px blur）+ 白字 12px + 8px 圆角 + 浅色 1px 边框，`0.15s` 淡入。

## Do's and Don'ts

### Do:
- **Do** 把蓝色留给「可操作 / 已选中 / 需注意」，默认状态用中性色。
- **Do** 使用统一的 0.2s 过渡与 `scale(0.96)` 按下反馈，让每个可点击元素都有可预期的状态。
- **Do** 尊重全局字号偏移（`--ds-font-offset`）与深浅主题——新界面必须使用 token 字号与 `--ds-*` 变量，不得写死字号/颜色。
- **Do** 让浮层（工具栏、下拉、tooltip）保持深色底，无论主题如何。
- **Do** 正文级文字 ≥12px，长文行高 1.6 以上。

### Don't:
- **Don't** 在装饰场景使用专注蓝（如无意义的蓝色标题、蓝色分隔线）。
- **Don't** 引入第二个字体族，或用 11px 及以下的正文级字号。
- **Don't** 做轻薄透明（低不透明度）的毛玻璃浮层。
- **Don't** 把设置项 label 折行或截断——用固定宽标签保持对齐。
- **Don't** 用纯黑 `#000` 或纯灰 `#666/#999` 写死正文色——用 `--ds-*` 变量与文字阶梯。
