# DeepSeek Desktop

内嵌 [chat.deepseek.com](https://chat.deepseek.com) 的桌面客户端（Electron + WebContentsView）。
把 DeepSeek 网页版封装为原生体验：自定义标题栏、全局快捷键、截图识图/翻译/解释/提取、
系统托盘、深浅主题、跨窗口协同，登录态由 Electron `session` 持久化到本地磁盘。

## 锁定的设计决策

1. **Electron + WebContentsView**：主进程内嵌 `chat.deepseek.com`，窗口级 WebContentsView。
   配置存储于 `%APPDATA%/DeepSeek/config.json`（Windows 上等价于 `userData/config.json`，app name = `DeepSeek`）。
2. **内嵌网页版**：截图 / 提示词经注入器（Injector）写入网页对话框（各副窗口本质向网页发特定内容）。
3. **手动登录**：用户在 WebContentsView 中手动登录，Session 由 Electron 默认 `session` 持久化，跨启动保留。

## 技术约束

- 主进程 + 预加载脚本使用 **TypeScript**。
- 外壳渲染层（标题栏 / 遮罩 / 翻译 UI）使用 **原生 HTML/CSS/JS**，**不引入 React**。
- **运行时零依赖**：仅使用 Electron 内置能力（BrowserWindow、WebContentsView、
  globalShortcut、Tray、Menu、desktopCapturer、nativeTheme、session、clipboard、screen、
  executeJavaScript）。不引入 electron-store、截图库、React 等运行时依赖。
- devDependencies 仅：`electron`、`electron-builder`、`typescript`、`@types/node`、`jest`、`ts-jest`、`@types/jest`。

## 快速开始

```bash
# 安装依赖
npm install

# 启动（编译 TS -> 复制资源 -> 启动 Electron）
npm start
```

首次启动会创建主窗口并加载 chat.deepseek.com，请在网页中手动登录。

## 构建与打包

```bash
npm run build      # tsc 编译 + 复制资源 + electron-builder 打包
```

产物位于 `release/`（Windows 为 `DeepSeek-Setup-<version>.exe`，macOS 为 `.dmg`，Linux 为 `.AppImage`）。

## 默认快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt + \`` | 显示 / 隐藏主窗口 |
| `Ctrl + Shift + A` | 开始截图 |

截图遮罩出现后可选择动作（发到对话 / 提取文字 / 翻译 / 解释 / 复制到剪贴板），
然后在屏幕上拖拽选区；`Esc` 取消。

## 配置项（26 项，默认值见 `src/main/config/ConfigStore.ts`）

支持窗口类型、主题、托盘、开机自启、关闭行为、深度思考、自定义标题栏、置顶、
字号、翻译源/目标语言、实时翻译同步、窗口复制保留上下文、角色交换、自动开启视觉模型、
截图后默认动作、截图保存路径、四类提示词模板、代理开关与地址、通知开关等。

配置可在 `config.json` 中直接编辑，或通过「设置」相关 IPC 在界面中修改（P2 阶段已落地）。

## 跨平台权限说明

- **Windows**：免额外权限。`Ctrl + Shift + A` 截图基于 `desktopCapturer.getSources`，
  在首次使用时会弹出系统屏幕捕获授权提示，授权即可。
- **macOS**：需要 **屏幕录制（Screen Recording）** 权限（系统设置 → 隐私与安全 → 屏幕录制）
  以及 **辅助功能（Accessibility）** 权限，否则截图与全局快捷键可能不可用。
  打包后需在「系统设置 → 隐私与安全 → 开发者模式 / 屏幕录制」中允许本应用。
- **Linux**：依赖 X11 / Wayland 合成器，托盘需要 `libappindicator` / `libayatana-indicator`；
  部分发行版需在设置中允许屏幕捕获。Wayland 下 `desktopCapturer` 行为可能因合成器而异。

## 已知限制与待实机验证项

- **DOM 选择器脆弱**：`src/main/inject/deepseek-selectors.ts` 中的选择器基于「常见 React SPA 结构」
  推测，未经过实机抓取。上线前请用 DevTools 核对 `chat.deepseek.com` 的真实结构并修正。
  注入器对每个操作会尝试多个候选选择器，全部失败则给用户轻提示（不阻断）。
- **上传图片**：优先用 `input[type=file]` 的 `DataTransfer` 赋值（由 `webviewPreload` 的
  `window.__ds.uploadFile` 协助）。若目标站点采用非标准上传通道，可能需要改为 fetch 直传，
  届时需注意 CORS 与登录态 Cookie 携带问题。
- **多显示器 / 高 DPI**：截图遮罩当前以主屏全屏简化，坐标换算未叠加多显示器偏移与
  `devicePixelRatio`（见 `overlay.js` / `ScreenshotManager` 注释，标注「待联调」）。
- **翻译回填**：通过轮询最近一条 AI 回复实现（2.5s 后读取），选择器与时机均待实机调优。
- **深度思考开关 / 代理 / 开机自启 / 置顶 / 字号 / 截图落盘 / 识图历史** 已在 P2 阶段落地为
  配置项并尽量作用于对应功能，但部分依赖网页内部结构的能力仍需实机验证。

## 目录结构

```
deepseek-desktop/
├── package.json / tsconfig.json / electron-builder.yml / jest.config.js / .gitignore
├── scripts/copy-assets.js        # 复制原生资源 + 生成占位图标
├── src/
│   ├── main/                     # 主进程（TS）
│   │   ├── main.ts               # 入口装配
│   │   ├── constants.ts          # 路径/枚举/配置名（单一来源）
│   │   ├── config/ConfigStore.ts # 配置读写（26 项默认合并）
│   │   ├── windows/              # WindowManager / mainWindow / subWindow / screenshotOverlay
│   │   ├── screenshot/           # ScreenshotManager
│   │   ├── shortcuts/            # ShortcutManager
│   │   ├── tray/                 # TrayManager
│   │   ├── theme/                # ThemeManager
│   │   ├── inject/               # Injector + deepseek-selectors
│   │   ├── ipc/                  # channels + handlers
│   │   └── prompts/              # PromptTemplates
│   ├── preload/                  # shellPreload / webviewPreload
│   ├── renderer/shell/           # 原生标题栏 / 遮罩 / 翻译 UI
│   └── shared/types.ts           # 共享类型
└── release/                      # 打包产物
```
