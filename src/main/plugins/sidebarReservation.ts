/**
 * 侧边栏宽度预留态：避免主窗口 chat relayout（总是铺满全宽）与侧边栏布局（压缩 chat 到右侧剩余宽度）
 * 两个独立 0ms 定时器在 resize 时互相竞争，产生「网页界面左右横跳」。
 *
 * 方案：主窗口 applyViewBounds 在布局时查询本预留值；只要侧边栏处于打开状态，就永不产生全宽中间态，
 * 直接压缩 chat 到侧边栏左侧。这样即便两个定时器交替执行，计算的 chat 边界也完全一致，不会横跳。
 *
 * 按窗口 id 记录：侧边栏仅存在于主窗口，副窗口 / B 窗口不受影响。
 */
const paneByWin = new Map<number, number>();

/** 记录某窗口预留给侧边栏的宽度；传入 0 或无则清除（侧边栏关闭时调用）。 */
export function setSidebarPane(win: { id: number } | null | undefined, width: number): void {
  if (!win) return;
  if (width > 0) paneByWin.set(win.id, width);
  else paneByWin.delete(win.id);
}

/** 查询某窗口当前侧边栏预留宽度；无侧边栏时返回 0（chat 全宽）。 */
export function getSidebarPane(win: { id: number } | null | undefined): number {
  if (!win) return 0;
  return paneByWin.get(win.id) ?? 0;
}

/** 清理已销毁窗口的预留记录。 */
export function clearSidebarPane(win: { id: number } | null | undefined): void {
  if (win) paneByWin.delete(win.id);
}