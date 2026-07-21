/**
 * 构建辅助脚本（非运行时依赖）：
 * 1. 将 src/renderer 下的原生 HTML/CSS/JS 资源复制到 dist/renderer，
 *    使编译后的主进程能经 file:// 正确加载外壳 UI。
 * 2. 若图标缺失，生成一个最小的占位 PNG，避免打包/启动因缺失图标报错。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'renderer');
const DEST = path.join(ROOT, 'dist', 'renderer');

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(sp, dp);
    } else {
      fs.copyFileSync(sp, dp);
    }
  }
}

function ensureIcon() {
  const iconDir = path.join(DEST, 'assets', 'icons');
  const icoPath = path.join(iconDir, 'icon.ico');
  const pngPath = path.join(iconDir, 'icon.png');
  // 已有真实图标（由 src 复制来的 icon.ico 或 icon.png）则不生成占位
  if (fs.existsSync(icoPath) || fs.existsSync(pngPath)) return;
  fs.mkdirSync(iconDir, { recursive: true });
  // 1x1 透明 PNG 的 base64（占位图标，待替换为正式图标）
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );
  fs.writeFileSync(pngPath, png);
  console.log('[copy-assets] 已生成占位图标', pngPath);
}

try {
  copyDir(SRC, DEST);
  ensureIcon();
  console.log('[copy-assets] 资源复制完成 ->', DEST);
} catch (err) {
  console.error('[copy-assets] 失败:', err);
  process.exit(1);
}
