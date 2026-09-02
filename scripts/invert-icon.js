/** 处理任务模式图标：把 PNG 里的深色背景抠掉、只保留白色图标部分，输出透明底内嵌 base64。
 * 运行：node scripts/invert-icon.js "图片路径" */
const { app, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const SRC = process.argv[2] || 'D:/111临时文件/演示文稿1_01.png';
const OUT = path.join(__dirname, '..', 'src', 'main', 'extensions', 'taskModeIcon.ts');

app.whenReady().then(async () => {
  let img = nativeImage.createFromPath(SRC);
  if (img.isEmpty()) { console.error('无法加载', SRC); app.exit(1); return; }
  const s = img.getSize();
  const w = 160;
  const h = Math.max(1, Math.round((s.height / s.width) * w));
  img = img.resize({ width: w, height: h, quality: 'best' });
  const bmp = img.getBitmap(); // BGRA
  const W = img.getSize().width, H = img.getSize().height;
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const b = bmp[o], g = bmp[o + 1], r = bmp[o + 2], a = bmp[o + 3];
      // 保留「白色/亮色」图标，深色(背景)抠成透明。亮度越高越白越不透明。
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const t = Math.max(0, Math.min(1, (lum - 150) / 90)); // 150→透明, 240+→全白
      const na = Math.round(a * t);
      out[o] = 255;       // B <- 白
      out[o + 1] = 255;   // G <- 白
      out[o + 2] = 255;   // R <- 白
      out[o + 3] = na;    // A
    }
  }
  const transp = nativeImage.createFromBitmap(out, { width: W, height: H });
  if (transp.isEmpty()) { console.error('createFromBitmap 失败'); app.exit(1); return; }
  const png = transp.toPNG();
  const b64 = 'data:image/png;base64,' + png.toString('base64');
  const ts = '// 自动生成：任务模式图标（白色图标、透明背景，深色已抠除）。运行 node scripts/invert-icon.js "图片" 重新生成。\n'
    + 'export const TASK_MODE_ICON_DATA_URL: string = ' + JSON.stringify(b64) + ';\n';
  fs.writeFileSync(OUT, ts, 'utf8');
  console.log('生成', OUT, '尺寸', W + 'x' + H, 'PNG', png.length, 'base64', b64.length);
  app.exit(0);
});