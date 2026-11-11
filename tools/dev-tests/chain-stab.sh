#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: > chain-stab-out.txt
check() {
  local name="$1" query="$2" prefix="$3" pattern="$4" hits="$5" output status=0
  echo "=== $name" >> chain-stab-out.txt
  output=$(bash run-one.sh gp-title.mjs "$query" "$prefix" 400 2>&1) || status=$?
  printf '%s\n' "$output" >> chain-stab-out.txt
  if [ "$status" -ne 0 ] || ! printf '%s\n' "$output" | grep -Eq "$pattern" || ! printf '%s\n' "$output" | grep -qx "aiHits $hits"; then
    echo "FAIL: $name（程序狀態 $status，基準不符或測試未完成）" | tee -a chain-stab-out.txt
    exit 1
  fi
  echo "PASS: $name" | tee -a chain-stab-out.txt
}
check baseline1 'bot&sim=120' BOT '^BOT lap2 54[.]425 hits=0$' 0
check baseline2 'bot&gp&sim=400' GP '^GP P[0-9]+ 陳冠宇:162[.]0( |$)' 8
check baseline3 'bot&gp&pittest&sim=400' GP '^GP P[0-9]+ 陳冠宇:175[.]7(\(| |$)' 5
echo '=== done: 3/3 PASS' | tee -a chain-stab-out.txt
