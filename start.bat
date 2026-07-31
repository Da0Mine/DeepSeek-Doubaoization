@echo off
REM 一键启动 deepseek-desktop（开发模式）。
REM
REM 关键点：防御性 `set ELECTRON_RUN_AS_NODE=` 卸掉本机/沙箱环境可能注入的变量，
REM 否则 Electron 会退化成纯 Node，app.setName() 即崩（详见 MEMORY / "调试/协作约定"）。
REM
REM 用法：双击本文件即可，或在 cmd 中 `start`。
REM 调试模式（如想看 autofix 日志）请用 start-debug.bat（同 npm start），日志开关靠 .debug-autolog 标记文件或 DS_DEBUG=1。

REM 卸掉 ELECTRON_RUN_AS_NODE（如果当前 shell 已设）
set ELECTRON_RUN_AS_NODE=

REM 切到 bat 所在目录，避免双击时 cwd 不对
pushd "%~dp0"

REM npm start = tsc + copy-assets + electron .（见 package.json scripts）
call npm start

popd