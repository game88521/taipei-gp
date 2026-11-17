# 六項優化驗證（2026-11-16）

最終 build **38335611f205**，來源基準 **57b09b2f3f78dffd5dadac0ca83581c01f9c42c3**，分支 `multiplayer-test`。完整結果、原始報告與來源 SHA256 已嵌入 [NEXT6_VALIDATION.json](./NEXT6_VALIDATION.json)。這份文件證明工作副本驗證通過；原專案套用狀態另依套用結果與 manifest 核對，不能由本文件推定。未 commit、push 或部署。

## 已通過

| 驗證 | 結果 |
| --- | --- |
| `npm.cmd run build`（catalog、tsc、Vite、多人 physics） | PASS；38335611f205 |
| 原 26 套程式回歸，保留各套原斷言 | 26／26；含一次單套孤立重跑，見下方 |
| 計時與賽季新增對照 `next6-racing-regression.mjs` | 21／21 |
| 警車碰撞對照 `next6-city-police.mjs` | 7／7 |
| 真 main 函式與事件 `next6-city-main.mjs --actual` | 12／12 |
| 多人期限／協定 `next6-multiplayer-deadlines.mjs` | 6／6 |
| keyed DOM 更新 `next6-multiplayer-ui.mjs` | 4／4 |
| 繪圖節奏與真預測物理 `next6-multiplayer-pacing.mjs` | 3／3 |
| 原多人 client／地圖 UI／碰撞 client／真 loopback server | 25／25、8／8、16／16、14／14 |
| 本機真瀏覽器：計時與賽季 `next6-racing-browser.mjs` | 5／5 |
| 本機真瀏覽器：街賽 `next6-city-browser.mjs` | 4／4 |
| 本機兩個隔離 context＋真 WS `next6-multiplayer-browser.mjs` | 5／5 |
| 未修改控制組 browser（build 8b61f77003ce） | 街賽 1／1、多人 2／2，成功重現舊問題 |
| 原 `chain-stab.sh` 三項固定基準 | 3／3；數值完全相同 |
| 套用工具隔離 fixture | 12／12；git/npm 替身，非原專案實際套用 |

固定數值為 `BOT lap2 54.425 hits=0`／aiHits 0、冠軍陳冠宇 `162.0`／aiHits 8、進站冠軍陳冠宇 `175.7`／aiHits 5。未修改基準。

`src/car.ts`、`src/track.ts`、`src/rivals.ts`、`src/pitlane.ts` 及產生的 `server/physics.mjs` 與 baseline bytes 完全相同。所有 490 個不可變 before 檔案均核對通過。`main.ts` 僅修改本輪的紀錄、恢復與城市整合，不新增模擬亂數。

## 實測觀察與範圍

街賽舊版成績頁經真 rAF 後仍移動約 **1.494m**，新版為 **0m**；結果頁保持 paused、一般選單隱藏，Escape／繼續不穿透，「再來一場」與「繼續」可用。直向 390×844、橫向 844×390 與 844×220 均無橫向溢位，結果按鈕至少 44px 且可點。

真雙視窗 20 次穩定雙人快照，舊版建立 **560** 個元素、清單直接 child mutations **60** 次；新版建立 **0**、直接 child mutations **0** 次，原玩家列保留、隱藏名單不建立列。另有隔離四人對照 20 次快照 **1120→0**；不將此數字宣稱為 FPS 改善。

144Hz 回呼的隔離測試中，全繪圖／60／30 設定的 renderer 呼叫為 **145／61／31**，自車狀態、校正、輸入歷史相同。大廳與結果的 10fps 繪圖路徑仍累積相同動畫時間。此處 renderer 為計數替身，未量測 GPU、手機 FPS 或耗電。

真雙視窗確認首位完賽後顯示 60 秒期限，期限到時顯示「超過完賽期限」，再戰清除期限與 DNF。30fps 設定寫入獨立 storage key，頁面 reload 後讀回 30；新選單在上述三種尺寸均至少 44px 且可點。

賽車 browser 在檢查線前安排車位，再由真物理與 `main.step` 過線：無效圈不寫紀錄、有效完整圈才寫三分段、真排位不改 TT，以及真 reload 保留已知分段均通過。舊格式缺分段可恢復，未知值仍為 null，理論最佳不造假。

## 失敗紀錄與修正

最終來源的原 26 套完整 run 為 **25 PASS／1 FAIL**：下載測試的 `idleTimeoutMs=15`／`timeoutMs=100` 在同時啟動瀏覽器時收到 total timeout，而斷言預期 idle。`network.ts` 與 baseline 完全相同。停止瀏覽器測試後，只孤立重跑該套 **1 次**，使用原腳本、原時間與原斷言，結果 PASS；產品雜湊完全相同。原失敗摘要、stdout／stderr 保留，新彙總為 `tools/dev-tests/next6-legacy-result.json`，不是覆寫舊 run 為全通過。

整合時舊測試 harness 缺少新增函式依賴，已更新 fixture 並保留原斷言；歷史版本沒有新增 helper 時才使用對應替身，新版載入真函式。街賽 browser 曾發現原結果按鈕 43px，補 44px 後重新 build 並驗證通過。

## 重跑與交付

工作目錄為 `DCISI/taipei-gp-next6-work`；對照使用 sibling `taipei-gp-next6-before-57b09b2`。原有歷史回歸另外依各腳本所指的 earlier before 目錄；碰撞 client 用 `--baseline ../taipei-gp-collision-before-f586ca9`。歷史封存不可修改，也不要用 Git HEAD 覆蓋先前成果。

先用 `npm.cmd run build`。原 26 套入口為 `node tools/dev-tests/multiplayer-checks.mjs`；新增測試可依上表在 `tools/dev-tests/` 逐支執行。`next6-legacy-completion.mjs` 釘住本次失敗摘要身份，是本次證據補收工具，不是通用重試器；未來新 run 應建立自己的摘要。

瀏覽器使用既有 CDP **9334**；三支新 browser 腳本順序執行。city／multiplayer 各自開 **4319** preview，multiplayer 額外開 **4322** WS；racing 開 **4324**。固定三回歸用 `node tools/dev-tests/multiplayer-maps-fixed.mjs`，自開 **4318** preview 並執行原 `chain-stab.sh`。所有測試只使用新隔離 context，封鎖外部請求，完成清理自己的服務／context；不操作舊 4317 或玩家存檔。

新套用工具為 `DCISI/Apply-TaipeiNext6.ps1`：無參數只預檢；`-Apply -Build` 才會備份、逐檔套用、離線建置與核對。它鎖定本輪 branch／HEAD／490 檔 baseline、payload 與驗證雜湊，保留非交付檔案，不刪檔、不安裝依賴、不 commit／push。實際結果讀 `DCISI/taipei-gp-next6-apply-result.json`，要求 `APPLIED_BUILD_VERIFIED`、`verified=true` 及 build 相符；不要重跑前輪工具。

手機實機、音質、耗電、外網真人碰撞及全 24 圖逐圖駕駛尚未驗證。歷史來源不明的最佳分段不清除；續賽前的歷史圈表／回放不保存。protocol v2 採加法相容，舊 server 缺新欄位時不顯示新資訊，部署仍須另取得授權並更新前後端。
