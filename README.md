# DeepSeek-Doubaoization

> 让 DeepSeek 网页版像豆包电脑版一样便捷的使用。

> **免责声明**：本项目为**非官方开源作品**，与 DeepSeek（深度求索）、豆包 / Doubao（字节跳动）及其关联公司**没有任何官方合作关系**。项目名称及页面中出现的 "DeepSeek"、"豆包 / Doubao" 及相关 logo 均为各自权利人的商标，此处仅作指示性引用，其商标权归原权利人所有。本项目不提供任何模型或平台服务，仅封装对应网页版功能。

把 [chat.deepseek.com](https://chat.deepseek.com) 封装为原生桌面应用（Electron + WebContentsView），
在保留 DeepSeek 全部网页能力的同时，补齐豆包电脑版式的桌面体验：
自定义标题栏、全局快捷键、截图识图 / 翻译 / 解释 / 提取、划词工具栏、屏幕共享、
WPS 文档共享、系统托盘、深浅主题、跨窗口协同，登录态由 Electron `session` 持久化到本地磁盘。

## ✨ 功能特性

- **原生桌面外壳**：无边框自绘标题栏、全局快捷键、系统托盘、开机自启、窗口置顶、深浅主题。
- **截图全家桶**（`Ctrl + Shift + A`）：框选后可选 —— 发到对话 / 提取文字 / 翻译 / 解释 / 复制到剪贴板；带标注工具栏。
- **AI 划词**：在任意软件选中文本，浮出工具栏 —— 问问 DeepSeek / 翻译 / 总结（全局输入钩子监听选中事件）。
- **屏幕共享**：把当前屏幕内容发送给 AI 分析（桌面自动化场景）。
- **WPS 文档共享**：通过 Windows COM 读取当前打开的 WPS 文档内容，直接发到对话中提问/分析，无需手动复制粘贴。
- **多窗口协同**：
  - 主窗口（1280 宽，完整侧栏 + 新对话）；
  - 副窗口（窄栏，可一键与主窗口互切，适合边看边聊）；
  - B 类结果窗口（截图翻译 / 提取 / 解释结果，304×540，靠右悬浮）。
- **模型智能调度**：新建对话自动应用默认模型模式（含识图 vision 模式切换）、深度思考开关、折叠思考过程。
- **贴心细节**：首次运行引导（Onboarding）、答题/回填提醒、更新检查与更新提示、登录态本地持久化（免重复登录）。

## 🚀 快速开始

### 方式一：直接下载（推荐）

到 [Releases](https://github.com/Da0Mine/DeepSeek-Doubaoization/releases) 下载：

| 文件 | 说明 |
| --- | --- |
| `DeepSeek-Setup-<version>.exe` | 安装包（NSIS），支持自定义安装目录 |
| `DeepSeek-<version>-win-x64.zip` | 一键运行包（绿色版），解压后双击 `DeepSeek.exe` 即可使用 |

### 方式二：从源码运行

```bash
npm install
npm start        # tsc 编译 -> 复制资源 -> 启动 Electron
```

首次启动会创建主窗口并加载 chat.deepseek.com，**在网页中手动登录一次**，之后自动保持登录态。

## 🔨 构建与打包

```bash
npm run build    # tsc 编译 + 复制资源 + electron-builder 打包
```

产物位于 `release/`（Windows 为 `DeepSeek-Setup-<version>.exe` + `win-unpacked/`）。

## ⌨️ 默认快捷键

| 快捷键 | 功能 |
| --- | --- |
| `Alt + `` ` | 显示 / 隐藏主窗口 |
| `Ctrl + Shift + A` | 开始截图（框选后可发对话 / 提取 / 翻译 / 解释 / 复制） |

截图遮罩出现后选择动作，然后在屏幕上拖拽选区；`Esc` 取消。

## ⚙️ 配置

支持窗口类型、主题、托盘、开机自启、关闭行为、深度思考、自定义标题栏、置顶、字号、
翻译源/目标语言、实时翻译同步、窗口复制保留上下文、角色交换、自动开启视觉模型、
截图后默认动作、截图保存路径、四类提示词模板、代理开关与地址、通知开关等
（默认值见 `src/main/config/ConfigStore.ts`）。

配置文件位于 `%APPDATA%/DeepSeek/config.json`，可直接编辑或通过设置界面修改。

## 🗂️ 目录结构

```
deepseek-desktop/
├── package.json / tsconfig.json / electron-builder.yml / jest.config.js
├── scripts/copy-assets.js          # 复制原生资源 + 生成占位图标
├── src/
│   ├── main/
│   │   ├── main.ts                 # 入口装配
│   │   ├── config/ConfigStore.ts   # 配置读写
│   │   ├── windows/                # WindowManager / mainWindow / subWindow / B 窗口
│   │   ├── screenshot/             # 截图 + 标注
│   │   ├── textSelection/          # 划词工具栏（全局选中监听）
│   │   ├── screenShare/            # 屏幕共享
│   │   ├── wps/                    # WPS 文档共享（COM）
│   │   ├── update/                 # 更新检查 / 更新提示
│   │   ├── onboarding/ firstRun/ modeReminder/ reminder/
│   │   ├── shortcuts/ tray/ theme/ inject/ ipc/ prompts/
│   ├── preload/                    # shellPreload / webviewPreload
│   ├── renderer/shell/             # 原生标题栏 / 遮罩 / 翻译 / 设置 / B 窗口 UI
│   └── shared/types.ts
└── docs/                           # 设计文档（system_design / 豆包对标 / PRD 等）
```

## 📄 License

[MIT](LICENSE) © 2026 Kou
