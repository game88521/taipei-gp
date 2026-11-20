# 2026-11-20 版本檢查與修正

以 `9f39d05a0cc9c658911f6bbcccdff438b6548bc9` 為基底，在 `fix/version-audit-20261120` 隔離分支檢查與修正。工作目錄為 `DCISI/taipei-gp-version-audit-20261120`，build **ca2f03b4217a**。本輪沒有改動原專案、commit、push 或部署；正式站尚未包含以下修正。

## 確認的問題

| 問題與影響 | 修正 | 驗證 |
| --- | --- | --- |
| 南城一般道路公車勤務的交通車輛持續模擬及碰撞，車身卻未渲染，會撞到隱形車。 | 為勤務車流補上顯示階段，僅可見時更新 instance；物理時間與亂數順序不變。 | 真 `Traffic` 的 8 台車身及 8 個陰影、位置矩陣、隱藏恢復與 39 項資源釋放，3 案通過。 |
| 分割畫面離開後按瀏覽器返回，BFCache 可能還原已釋放的場景，無法再次起跑。 | 偵測真正的 BFCache 返回，重新載入並經正常初始化進入。 | 舊版已用真瀏覽器歷史重現；修後實際 BFCache 返回及再次建立 WebGL 比賽，2 案通過。 |
| 回放書籤遇到損壞 JSON 或讀取例外後，新書籤可能覆蓋尚未救援的原資料。 | 讀取失敗即停止寫回；本頁仍可新增與刪除，持續顯示僅保留在本頁的提示。 | 損壞 JSON、讀取例外、錯誤結構皆零寫入，正常保存與重載仍正常，4 案通過。 |
| 多圈比賽中，每圈與總時間獨立取整，累積差異可能超過用戶端固定容差，合法成績會被拒絕。 | 容差依圈數及伺服器的 0.001ms 取整精度計算；保留時間、圈數、完賽及上限檢查。 | 真伺服器快照搭配受控 13／128 圈資料重現，修後接受；17 種非法資料仍拒絕，並檢查一般賽、讓秒賽與舊格式，共 4 案通過。 |

成績取整問題是伺服器契約的受控反例；另跑的 22 場真 Car 耐久未自然重現，不能視為外網真人曾遇到的證據。分割畫面測試使用明示注入的標準手把資料，沒有實測實體手把。

## 變更範圍

產品程式僅修改以下 5 檔，沒有改賽車物理、伺服器程式或通訊格式：

- `src/odyssey-city-road.ts`
- `src/summit-city-ui.ts`
- `src/summit-splitscreen.ts`
- `src/summit-replay-bookmarks.ts`
- `src/multiplayer-client.ts`

新增 4 支回歸：`version-audit-city-traffic.mjs`、`version-audit-split-history.mjs`、`replay-bookmark-recovery-models.mjs`、`multiplayer-timing-regression.mjs`，均在 `tools/dev-tests/`。文件為本檔、`VERSION_AUDIT_VALIDATION.json` 及 `HANDOFF.md` 最前段。其餘未追蹤的截圖／測試輸出是本機證據，不應使用 `git add -A` 混入提交。

工坊選點疑點已排除：最初 fixture 漏了 `decodeCity()`；對真實解碼路網的 16,170 個可選節點重新核對，未找到所稱的高度衝突。工坊產品修改與該無效 regression 已還原，不列為修正。

## 驗證結果

本輪最終 build 的 Node **72／72**、瀏覽器 **34／34** 與固定賽車基準 **3／3** 通過，共 **109 案**，不是將歷史報告累加。Node 8 套與瀏覽器 6 套執行前後的來源雜湊相同，另經唯讀互審逐檔核對。檢查涵蓋競速、連線／合作、城市勤務、工坊、回放、輸入與離線資源；這些是自動化涵蓋範圍，不代表所有操作組合都已人工試玩。

固定結果保持：

- `BOT lap2 54.425 hits=0`，`aiHits 0`
- 冠軍 `陳冠宇:162.0`，`aiHits 8`
- 冠軍 `陳冠宇:175.7`，`aiHits 5`

`npm run build`、`git diff --check` 均通過。完整彙整與雜湊見 [VERSION_AUDIT_VALIDATION.json](./VERSION_AUDIT_VALIDATION.json)；原始 stdout／stderr 保存在相鄰工作區的 `DCISI/version-audit-final-evidence/`，建置輸出為 `DCISI/version-audit-build-final.log`，固定基準原文為 `tools/dev-tests/chain-stab-out.txt`。原始檔不在時不能只靠路徑宣稱重跑過。

## 重跑方式

先在本工作目錄執行 `npm run build`。需 Node 24、已安裝依賴及獨立本機測試 Chrome（CDP 預設 9334）。新增測試可從專案根目錄分別執行：

```powershell
node tools/dev-tests/version-audit-city-traffic.mjs
node tools/dev-tests/replay-bookmark-recovery-models.mjs
node --experimental-vm-modules tools/dev-tests/multiplayer-timing-regression.mjs
$env:GP_CDP_PORT='9334'
node tools/dev-tests/version-audit-split-history.mjs
```

分割畫面測試自行開本機 4436 preview。固定基準需另外以本輪 `dist` 開 `npm run preview -- --host 127.0.0.1 --port 4317 --strictPort`，再設定 `GP_CDP_PORT=9334`、`GP_TEST_ORIGIN=http://127.0.0.1:4317`，於 `tools/dev-tests` 執行 Git Bash 的 `bash chain-stab.sh`。瀏覽器測試請串行執行，避免搶焦點。不用正式站測試。

真手機、實體手把、外網真人完整對戰與長時間負載仍未驗證。這次沒有重測正式站的存取保護、Render／Vercel 部署或免費主機容量。
