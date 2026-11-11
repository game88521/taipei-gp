#!/bin/bash
# 用法：bash run-node.sh 腳本.mjs 參數…（開新 Chrome、跑完關掉，沒有 timeout 限制 550 秒）
cd "$(dirname "$0")"
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
PROF="gpw-prof-$RANDOM"
("$CH" --headless=new --remote-debugging-port=9333 --user-data-dir="$(cygpath -w "$PWD/$PROF")" --use-angle=swiftshader --enable-unsafe-swiftshader about:blank >/dev/null 2>&1 &)
sleep 8
S="$1"; shift
timeout 3000 node "$S" 9333 "$@"
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { \$_.CommandLine -like '*gpw-prof*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
sleep 1
rm -rf gpw-prof* 2>/dev/null
true
