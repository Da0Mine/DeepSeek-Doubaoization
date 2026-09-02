// 临时工具：用 Electron BrowserWindow 渲染 SVG 并截图为 256x256 PNG
// 用法: electron scripts/svg-to-png.js <in.svg> <out.png>
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');

app.whenReady().then(async () => {
  try {
    const inPath = process.argv[2];
    const outPath = process.argv[3];
    const svg = fs.readFileSync(inPath, 'utf8').trim();
    // 把 svg 调整为固定 256x256 内容并 pad
    const html = `<!DOCTYPE html><html><body style="margin:0;background:transparent">
      <img id="i" src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="width:256px;height:256px;">
      <script>
        document.addEventListener('DOMContentLoaded', function(){
          const img = document.getElementById('i');
          img.onload = function(){};
          const c = document.createElement('canvas'); c.width=256; c.height=256;
          const ctx = c.getContext('2d');
          try { ctx.drawImage(img, 0, 0, 256, 256); } catch(e){}
          // 上传给主进程读取像素——用 dataURL 放 body 里
          c.toDataURL('image/png');
          const p = document.createElement('div'); p.id='out'; p.textContent = c.toDataURL('image/png');
          document.body.appendChild(p);
        });
      </script></body></html>`;
    const win = new BrowserWindow({ show: false, width: 256, height: 256, webPreferences: { offscreen: true } });
    await win.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((res) => {
      const img = document.getElementById('i');
      const c = document.createElement('canvas'); c.width=256; c.height=256;
      const ctx = c.getContext('2d');
      img.decode().then(() => { ctx.drawImage(img,0,0,256,256); res(c.toDataURL('image/png')); })
        .catch(() => res(''));
    })`);
    const img = nativeImage.createFromDataURL(dataUrl).resize({ width: 256, height: 256, quality: 'best' });
    fs.writeFileSync(outPath, img.toPNG());
    console.error('wrote', outPath, JSON.stringify(img.getSize()));
    app.exit(0);
  } catch (e) {
    console.error('ERR:', e);
    app.exit(1);
  }
});