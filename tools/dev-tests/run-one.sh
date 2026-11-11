#!/bin/bash
# 用法：bash run-one.sh script.mjs args...（開一個新的無頭 Chrome、跑完關掉）
cd "$(dirname "$0")"
if [ -n "${GP_CDP_PORT:-}" ]; then
  exec node external-browser.mjs "$GP_CDP_PORT" "$@"
fi
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
PROF="gpw-prof-$RANDOM"
("$CH" --headless=new --remote-debugging-port=9333 --user-data-dir="$(cygpath -w "$PWD/$PROF")" --use-angle=swiftshader --enable-unsafe-swiftshader about:blank >/dev/null 2>&1 &)
sleep 8
S="$1"; shift
timeout 550 node "$S" 9333 "$@"
RESULT=$?
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*$PROF*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
sleep 1
# 只刪這次建立、位於測試目錄內的 profile，不碰其他測試的資料。
TEST_ROOT="$(pwd -P)"
case "$PROF" in
  gpw-prof-[0-9]*)
    if [ -d "$PROF" ] && [ ! -L "$PROF" ] && [ "$(cd "$PROF" && pwd -P)" = "$TEST_ROOT/$PROF" ]; then
      rm -rf -- "$TEST_ROOT/$PROF" 2>/dev/null
    fi
    ;;
esac
exit "$RESULT"
