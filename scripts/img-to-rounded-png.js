// 工具：将图片(webp/png/svg)光栅化为带圆角的 256x256 PNG
// 用法: electron scripts/img-to-rounded-png.js <in> <out> [radius]
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

app.whenReady().then(async () => {
  try {
    const inPath = path.resolve(process.argv[2]);
    const outPath = path.resolve(process.argv[3]);
    const radius = process.argv[4] || '54'; // 256 图圆角半径
    const ext = path.extname(inPath).toLowerCase();
    let srcHtml;
    if (ext === '.svg') {
      const svg = fs.readFileSync(inPath, 'utf8');
      srcHtml = `<img id="i" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="width:256px;height:256px;">`;
    } else {
      // 把图片(webp/png/jpg)内联为 data URL，避免 file:// 跨协议加载失败
      const buf = fs.readFileSync(inPath);
      const mime = ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/webp';
      srcHtml = `<img id="i" src="data:${mime};base64,${buf.toString('base64')}" style="width:256px;height:256px;">`;
    }
    const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent">${srcHtml}
      </body></html>`;
    const win = new BrowserWindow({ show: false, width: 256, height: 256, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((res) => {
      const img = document.getElementById('i');
      const c = document.createElement('canvas'); c.width=256; c.height=256;
      const ctx = c.getContext('2d');
      img.decode().then(() => {
        ctx.save();
        const r = ${radius};
        ctx.beginPath();
        ctx.moveTo(r,0);
        ctx.lineTo(256-r,0);
        ctx.quadraticCurveTo(256,0,256,r);
        ctx.lineTo(256,256-r);
        ctx.quadraticCurveTo(256,256,256-r,256);
        ctx.lineTo(r,256);
        ctx.quadraticCurveTo(0,256,0,256-r);
        ctx.lineTo(0,r);
        ctx.quadraticCurveTo(0,0,r,0);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(img,0,0,256,256);
        ctx.restore();
        res(c.toDataURL('image/png'));
      }).catch((e) => res('ERR:'+String(e)));
    })`);
    if (dataUrl.startsWith('ERR:')) { console.error(dataUrl); app.exit(1); return; }
    const out = nativeImage.createFromDataURL(dataUrl).resize({ width: 256, height: 256, quality: 'best' });
    fs.writeFileSync(outPath, out.toPNG());
    console.error('wrote', outPath, JSON.stringify(out.getSize()));
    app.exit(0);
  } catch (e) {
    console.error('ERR:', e);
    app.exit(1);
  }
});