# 图标目录

应用图标（托盘 / 窗口标题栏）统一从 `iconIfExists()` 取用，优先顺序为 `icon.ico` → `icon.png`。

- `src/renderer/assets/icons/icon.ico`：**DeepSeek 官方图标**（来自 www.deepseek.com/favicon.ico，225×225）。
  这是正式图标，已被 `copy-assets.js` 复制到 `dist/renderer/assets/icons/icon.png` 同级。
  Windows 上 Electron 的 `nativeImage.createFromPath` 原生支持 `.ico`，无需转换。
- `dist/renderer/assets/icons/icon.png`：若 `icon.ico` 与 `icon.png` 均不存在，`copy-assets.js`
  会自动生成一个 1×1 透明占位 PNG（仅兜底，避免启动/打包失败）。

如需替换图标：覆盖 `src/renderer/assets/icons/icon.ico`（或 `icon.png`）即可，重新 `npm start`
（自带 `copy-assets`）即生效。
