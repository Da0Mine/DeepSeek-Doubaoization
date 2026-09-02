# 图标目录

应用图标分两套，各自独立定制：

- `src/renderer/assets/icons/icon.ico`：**托盘图标**（DeepSeek 官方图标）。由 `iconIfExists()` 读取，保持不变。
- `src/renderer/assets/icons/deepseek-app-256.png`：**应用图标**（窗口标题栏 / 任务栏 / exe 快捷方式）。
  由 `appIconIfExists()`（运行时窗口）与 `electron-builder` 的 `win.icon`（打包时自动转 .ico 嵌入 exe）读取。

Windows 上 Electron 的 `nativeImage.createFromPath` 原生支持 PNG/ICO，无需转换。

如需替换图标：
- **托盘图标**：覆盖 `src/renderer/assets/icons/icon.ico`，重新 `npm start`（自带 `copy-assets`）即生效。
- **应用 / 窗口 / 快捷方式图标**：覆盖 `deepseek-app-256.png`（≥256×256 PNG），重新 `npm start`
  立即生效；已安装 exe 需重新 `npm run build`（electron-builder 打包时读取并转 .ico）。

## 从图片重新生成 app PNG（可选）
调整源图后，用 `npx electron scripts/img-to-rounded-png.js <源图.webp/png/svg> src/renderer/assets/icons/deepseek-app-256.png 54` 重新光栅化为圆角 256×256 PNG。