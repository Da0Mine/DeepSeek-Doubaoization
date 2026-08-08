/**
 * 更新检查器：查询 GitHub Releases 最新版本，与当前安装版本比较，
 * 并提供软件内下载安装包 + 唤起安装程序的能力（设置 → 更新板块使用）。
 * 使用 Electron net.fetch（走 Chromium 网络栈，遵循会话代理设置）。
 */
import { app, net, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ReleaseAsset,
  UpdateDownloadProgress,
  UpdateInfo,
} from '../../shared/types';

/** 发布仓库（用户指定）。 */
export const GITHUB_REPO = 'Da0Mine/DeepSeek-Doubaoization';

/** Release 列表页地址（跳转目标）。 */
export const RELEASES_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases`;

/** GitHub API：最新 release。 */
const LATEST_RELEASE_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

/** GitHub 文件加速前缀（https://github.cnmclash.de5.net/，拼接原始链接即可）。 */
export const GH_PROXY_PREFIX = 'https://github.cnmclash.de5.net/';

/** 把 GitHub 原始下载链接转为加速链接。 */
export function toProxyUrl(rawUrl: string): string {
  return GH_PROXY_PREFIX + rawUrl;
}

/** 请求超时（毫秒）。 */
const CHECK_TIMEOUT_MS = 15000;

/** 下载超时（毫秒）：安装包较大，放宽到 30 分钟。 */
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;

/** 检查结果缓存时长（毫秒），避免频繁请求 GitHub API 触发限流。 */
const CACHE_TTL_MS = 10 * 60 * 1000;

/** 解析版本号段（忽略前导 v）。 */
function parseVersion(v: string): number[] {
  return String(v)
    .replace(/^v/i, '')
    .trim()
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

/** 比较两个版本号：a > b 返回 1，a < b 返回 -1，相等返回 0。 */
function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/** 展示版本号：去掉末尾的 .0（如 1.0.0 -> 1.0）。 */
export function formatVersion(v: string): string {
  const s = String(v).trim();
  return s.replace(/\.0+$/, '') || s;
}

export class UpdateChecker {
  private cache: UpdateInfo | null = null;

  /** 当前安装版本（来自 package.json / app.getVersion）。 */
  get currentVersion(): string {
    return app.getVersion();
  }

  /**
   * 检查更新。非强制时优先返回 10 分钟内的缓存结果，
   * 避免每次打开设置面板都请求 GitHub API。
   */
  async check(force = false): Promise<UpdateInfo> {
    if (!force && this.cache && Date.now() - this.cache.checkedAt < CACHE_TTL_MS) {
      return this.cache;
    }
    const info = await this.fetchLatest();
    this.cache = info;
    return info;
  }

  /** 在默认浏览器打开 Release 列表页。 */
  openReleasesPage(): void {
    shell.openExternal(RELEASES_PAGE_URL).catch(() => {});
  }

  /** 从最近一次检查结果中查找当前平台适用的安装包资产（win32 → .exe；darwin → .dmg；linux → .AppImage）。 */
  findInstaller(): ReleaseAsset | null {
    if (!this.cache) return null;
    const ext =
      process.platform === 'darwin' ? '.dmg' : process.platform === 'linux' ? '.AppImage' : '.exe';
    const assets = this.cache.assets || [];
    // 排除 electron-builder 生成的 .blockmap 等辅助文件
    return assets.find((a) => a.name.endsWith(ext) && !a.name.endsWith('.blockmap')) || null;
  }

  /**
   * 下载安装包到本地（先走加速链接，失败回退 GitHub 直连），
   * 返回本地路径。onProgress 回调实时进度。
   */
  async downloadInstaller(
    asset: ReleaseAsset,
    onProgress?: (p: UpdateDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<string> {
    const dir = path.join(app.getPath('userData'), 'update');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, asset.name);

    // 若本地已有同名且大小一致的安装包，直接复用（避免重复下载）
    try {
      if (fs.existsSync(dest) && asset.size > 0) {
        if (fs.statSync(dest).size === asset.size) return dest;
      }
    } catch {
      /* 忽略，继续下载 */
    }

    const urls = [toProxyUrl(asset.url), asset.url];
    let lastErr: unknown = null;
    for (const url of urls) {
      try {
        await this.downloadToFile(url, dest, asset.size, onProgress, signal);
        return dest;
      } catch (e) {
        lastErr = e;
        // 尝试下一个地址
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('下载失败');
  }

  /** 唤起本地安装程序（打开路径，返回空字符串表示成功）。 */
  async launchInstaller(localPath: string): Promise<string> {
    return shell.openPath(localPath);
  }

  private async fetchLatest(): Promise<UpdateInfo> {
    const base: UpdateInfo = {
      currentVersion: this.currentVersion,
      currentVersionDisplay: formatVersion(this.currentVersion),
      latestVersion: null,
      hasUpdate: false,
      releaseUrl: RELEASES_PAGE_URL,
      releasePageUrl: RELEASES_PAGE_URL,
      releaseNotes: null,
      assets: [],
      error: null,
      checkedAt: Date.now(),
    };
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
      const res = await net.fetch(LATEST_RELEASE_API, {
        headers: {
          'User-Agent': 'DeepSeek-Desktop',
          Accept: 'application/vnd.github+json',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        return {
          ...base,
          error: res.status === 404 ? '仓库中暂无 Release' : `检查失败（HTTP ${res.status}）`,
        };
      }
      const data = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        body?: string;
        assets?: { name?: string; browser_download_url?: string; size?: number }[];
      };
      const latest = String(data.tag_name || '').replace(/^v/i, '');
      const assets: ReleaseAsset[] = (data.assets || [])
        .filter((a) => a.name && a.browser_download_url)
        .map((a) => ({ name: a.name as string, url: a.browser_download_url as string, size: a.size || 0 }));
      return {
        ...base,
        latestVersion: latest || null,
        hasUpdate: !!latest && compareVersions(latest, this.currentVersion) > 0,
        releaseUrl: data.html_url || RELEASES_PAGE_URL,
        releaseNotes: data.body || null,
        assets,
      };
    } catch {
      return { ...base, error: '网络错误，无法连接 GitHub，请检查网络或代理设置' };
    }
  }

  /** 流式下载到文件，实时推送进度。 */
  private async downloadToFile(
    url: string,
    dest: string,
    expectedSize: number,
    onProgress?: (p: UpdateDownloadProgress) => void,
    signal?: AbortSignal
  ): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    const onOuterAbort = (): void => controller.abort();
    signal?.addEventListener('abort', onOuterAbort);
    try {
      const res = await net.fetch(url, { signal: controller.signal, redirect: 'follow' });
      if (!res.ok || !res.body) {
        throw new Error(`下载失败（HTTP ${res.status}）`);
      }
      const total = Number(res.headers.get('content-length')) || expectedSize || 0;
      const reader = res.body.getReader();
      const writeStream = fs.createWriteStream(dest);
      let received = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          received += chunk.value.byteLength;
          if (!writeStream.write(Buffer.from(chunk.value))) {
            await new Promise<void>((resolve) => writeStream.once('drain', () => resolve()));
          }
          onProgress?.({
            received,
            total,
            percent: total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0,
          });
        }
        await new Promise<void>((resolve, reject) => {
          writeStream.on('error', reject);
          writeStream.on('finish', resolve);
          writeStream.end();
        });
      } finally {
        writeStream.close();
      }
      if (total > 0 && received !== total) {
        throw new Error('下载不完整，请重试');
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onOuterAbort);
    }
  }
}
