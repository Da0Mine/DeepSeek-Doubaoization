/**
 * 黑名单「暂停态」共享状态（通知 gate 专用）。
 * 当黑名单中有进程正在运行时，本软件临时停用快捷键 / 划词 / 所有系统通知。
 * 由 BlacklistManager 在暂停态变化时写入；handlers / AnswerReminder / 主进程划词开关通知
 * 单向读取本模块，避免循环 import（BlacklistManager 不依赖本文件之外的主进程模块）。
 */

let paused = false;

/** 设置当前是否处于黑名单暂停态（仅 BlacklistManager 调用）。 */
export function setBlacklistPaused(v: boolean): void {
  paused = v;
}

/** 是否处于黑名单暂停态：为 true 时不弹任何系统通知。 */
export function isBlacklistPaused(): boolean {
  return paused;
}