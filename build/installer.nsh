# 自定义 NSIS 脚本（electron-builder 经 nsis.include 引入）
#
# customCheckAppRunning：接管「安装 / 卸载前检测程序是否在运行」的默认行为。
#
# 默认实现（_CHECK_APP_RUNNING）的流程是：
#   弹对话框「DeepSeek 正在运行，点击确定关闭」→ 用户点确定 → taskkill（不带 /F）优雅关闭
#   → 轮询进程 → 仍在则 taskkill /F → 再轮询 → 仍在则提示「无法关闭，请手动处理」。
# 本应用是常驻托盘应用（closeToTray），窗口关闭只会缩到托盘、进程不退出，
# 于是默认流程会反复重试、最终要求用户手动关闭 —— 既慢又必须人工干预。
#
# 这里改为：不弹任何对话框，直接用 taskkill /F /T 强制结束进程树（含 Python 子进程），
# 只留一次短暂等待让文件句柄释放；后续解压步骤本身还有重试兜底。
!macro customCheckAppRunning
  DetailPrint "Closing running ${PRODUCT_NAME}..."
  nsExec::Exec 'taskkill /F /T /IM "${APP_EXECUTABLE_FILENAME}"'
  Pop $R0
  # 等待进程退出并释放被占用的文件句柄，避免后续解压/复制失败重试
  Sleep 1000
!macroend
