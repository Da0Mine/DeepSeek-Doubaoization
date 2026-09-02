# Token 计数功能 —— 恢复手册（给后续接手方）

> 本文件夹是「聊天页今日 Token 消耗悬浮块」功能的**独立存档**。
> 场景：主程序做了一次大回退（`git checkout`/`git restore` 撤掉未提交改动），此功能需要被重新恢复。
> `reference/` 里是回退前能运行的关键代码快照。请按本手册**外科手术式**把功能补回，**不要整文件覆盖**当前代码。

***

## 一、功能是干什么的

* 在 DeepSeek 聊天页**输入框右上方**，悬浮一个毛玻璃小圆角块，实时显示**今日 token 消耗**；

* 点头块悬浮显示「今日 / 累计」两个数字；

* 数据来源是 DeepSeek++ 插件（MV3 扩展）保存在 `chrome.storage.local` 里的**用量记录**（当天每次回答的 totalTokens、day 等）。

## 二、为什么难（必须先懂）

插件存储不是 JSON 文件，而是 **LevelDB**（Electron 扩展 storage 落盘目录 `userData/Local Extension Settings/<32位hex>/` 下的 `.ldb` + `N.log`），且块内容是 **snappy(RAW) 压缩** 的。主程序读不到 redis 也不能直接 grep，所以要在主进程里**手写一个 LevelDB 块解析 + snappy 解压**：

* `deepseek_pp_usage_turns_v1` 是我们要找的 key；

* 数据可能分散在 journal(`.log`) 或 `.ldb` 两种载体里，**两个都要读**，取 token 总和更大者（压实更完整）；

* 记录对象形如 `{ day: "2026-08-30", totalTokens: 12345, ... }`。

## 三、数据流（全景）

```
[页面上注入脚本 flip TokenWidget 虚拟轮子动画]
   │  定时派发 CustomEvent 'ds-token-widget-query'
   ▼
[webviewPreload.ts] bindTokenWidgetQueryEvents()
   │  ipcRenderer.invoke(IPC.TOKEN_WIDGET_GET)   // 返回 {enabled, tokens, totalTokens}
   ▼
[handlers.ts] ipcMain.handle(TOKEN_WIDGET_GET)
   │  extensionHost.getTokenStats(true)   // 主进程解析插件 LevelDB/snappy
   ▼
[ExtensionHost.ts] getTokenStats / readPluginUsageJournal / readSstableUsageSnapshots / snappyDecode
   ├─ 返回 { today, total }（带 mtime 缓存，避免每 3s 轮询反复解压数 MB 库拖慢工具调用）
   ▼
[webviewPreload.ts] 派发 CustomEvent 'ds-token-widget-state' {enabled,tokens,totalTokens}
   ▼
[页面上注入脚本] 监听 'ds-token-widget-state' → 更新轮子动画/数字；遇 enabled=false 则隐藏
```

## 四、需要恢复的文件与精确位置

> 回退后，**未跟踪文件不会被动**：`src/main/extensions/ExtensionHost.ts`、`src/main/plugins/`、`src/renderer/extensions/`（插件本体）都会保留。
> **会被回退清掉的只有「被 git 跟踪、且这次未提交」的改动**，破坏点基本都在这几处。逐个补：

### 1) `src/main/extensions/ExtensionHost.ts`（核心，reference 已全量备份）

* 若回退没删它：**无需动**。

* 若已缺失/损坏：用 `reference/ExtensionHost.ts` 整体放回。

* 关键成员（版本快照内行号，供定位）：

  * `getTokenStats(logDebug)` ≈ L1006 —— 主查询入口，含 `tokenStatsCached`/`tokenStatsCachedMtime` 缓存；

  * `getTodayTokens()` ≈ L998 —— 直接返回 `getTokenStats().today`；

  * `usageSourceMaxMtime()` ≈ L1044 —— 扫 `Local Extension Settings` 下最新 mtime 做缓存失效；

  * `readPluginUsageJournal()` ≈ L1064 —— 解析 `*.log` journal；

  * `parseLeveldbLog()` ≈ L1099 / `parseWriteBatch()` ≈ L1128 / `readVarintAt()` ≈ L1150；

  * `readSstableUsageSnapshots()` ≈ L1164 / `extractUsageSnapshotsFromSstable()` ≈ L1182；

  * `decompressLeveldbBlock()` ≈ L1216 / `parseLeveldbBlockEntries()` ≈ L1223 / `varintPos()` ≈ L1247 / `snappyDecode()` ≈ L1254；

  * `sumTokensInDay()` / `sumTokensTotal()` ≈ L1286/L1298 / `dayKey()` ≈ L1310；

  * `recordUsageTurn()` ≈ L1317 —— 插件主动上报时落库（`userData/dspp-token.log` 调试日志）。

* **性能硬要求**：`getTokenStats` 必须带 mtime 缓存。否则主进程每 3s 轮询会反复同步解压数 MB 的 LevelDB，拖慢整个应用（含 MCP 工具调用），表现为"慢 + 工具重复调用"。这一块改动就在 `getTokenStats` 前几行。

### 2) `src/main/ipc/channels.ts`

新增一行通道常量（插在 IPC 表任意位置，名字勿与其他冲突）：

```ts
  /** 页面 token 悬浮块 -> 主（invoke）：查询今日/累计 token 用量（返回 {enabled,tokens,totalTokens}）。 */
  TOKEN_WIDGET_GET: 'chat:tokenWidgetGet',
```

### 3) `src/main/ipc/handlers.ts`

新增 IPC 处理器（`extensionHost` 已经在作用域）：

```ts
  ipcMain.handle(IPC.TOKEN_WIDGET_GET, async () => {
    const s = extensionHost.getTokenStats(true);
    return { enabled: config.get('floatingTokenWidget') === true, tokens: s.today, totalTokens: s.total };
  });
```

### 4) `src/main/config/ConfigStore.ts`（DEFAULT\_CONFIG 里）

新增默认开关（默认**关**）：

```ts
  floatingTokenWidget: false,
```

同时在 `src/shared/types.ts` 的 `ConfigShape` 里补对应字段类型 `floatingTokenWidget: boolean`（若未回退则无需动）。

### 5) `src/preload/webviewPreload.ts`

新增桥接函数（页面 ⇄ 主进程）：

```ts
// 悬浮窗（今日 token 消耗）：页面定期查询开关与数字 → 主进程汇总 → 回推页面
function bindTokenWidgetQueryEvents(): void {
  const queryHandler = (): void => {
    ipcRenderer.invoke(IPC.TOKEN_WIDGET_GET).then((r) => {
      if (r && typeof r === 'object') {
        document.dispatchEvent(new CustomEvent('ds-token-widget-state', {
          detail: { enabled: r.enabled === true, tokens: Number(r.tokens) || 0, totalTokens: Number(r.totalTokens) || 0 },
        }));
      }
    }).catch(() => {});
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => document.addEventListener('ds-token-widget-query', queryHandler));
  } else {
    document.addEventListener('ds-token-widget-query', queryHandler);
  }
}
bindTokenWidgetQueryEvents();
```

### 6) `src/main/inject/Injector.ts` —— 页面 token 悬浮块（工作量最大的一块）

* 完整代码已按原文抽取到 `reference/injector-token-widget.js`（来源：`injectChatModeSwitcher` 方法注入脚本内，行 3015–3154）。

* 它以 `// === token 显示悬浮块（设置中开关，默认关；今日数字，悬浮展示「今日/累计」，位置紧跟输入框右上方） ===` 注释开头，`try { ... } catch (e8) {}` 包裹。

* 恢复方式：在 `injectChatModeSwitcher` 的注入脚本里（推荐放在「占位文字覆盖层」之前，即原 `var ph = document.createElement('div'); ph.id='ds-cm-placeholder'` 那行之前），整体插入 `reference/injector-token-widget.js` 去掉首行注释后的内容。

* 该块内部自带：虚拟滚动数字轮子动画、`document.addEventListener('ds-token-widget-state', ...)`、定时派发 `ds-token-widget-query` 的轮询（含 3s 定时间隔）、创建 `window.__dsTokenWidget = { show, query, place, destroy }`。

* **注意**：原块可能是被 `if (config.floatingTokenWidget) {...}` 之类的条件控制，也可能无条件创建由 `ds-token-widget-state.enabled` 控制显隐——以 reference 为准，两种都要依赖主进程返回的 `enabled` 决定显示/隐藏。

## 五、验证

1. `npm run typecheck` 通过；
2. `npm start` 后进聊天页，输入框右上角出现毛玻璃 token 块且随回答增长；
3. 设置里关掉「今日 token 计数/悬浮块」开关后隐藏、开启后重现；
4. 观察主进程 `userData/dspp-token.log`（RECORD\_USAGE\_TURN / SCAN / CACHED 行）确认解析与缓存正常。

## 六、常见坑速记

* 快照取 `sumTokensTotal` 较大者（journal vs sstable），不要只读一种；

* sstable 读 index block 后逐 data block，key 要 `startsWith(key)`（内部 key 带 8 字节 seq 尾），跳过 `$` 元键；

* snappy 是 RAW 格式（非 framed）；literal/copy 长度与 offset 规则见 `reference/ExtensionHost.ts#snappyDecode`；

* 缓存失效只看 mtime，别每 3s 全量重扫。

