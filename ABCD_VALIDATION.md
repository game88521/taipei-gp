# 2026-11-11 A～D 驗證

正式 build：`811385b20e05`；`npm.cmd run build`（TypeScript 與 Vite）通過。產品來源 SHA256：`e8b93fc2f3b3348cb7541906f15e30415518319a8a3e308d9f0384418e5907bc`。完整機器證據見 [ABCD_VALIDATION.json](./ABCD_VALIDATION.json)，行為說明見 [ABCD_FIXES.md](./ABCD_FIXES.md)。

## 結果

| 檢查 | 結果 |
|---|---|
| 原 16 套＋新增 A／B／C-D／衝突結算共 20 套自動測試 | 20／20 PASS，期間產品來源未變 |
| A 存檔專項 | 24／24；原救援 23／23、原完整備份 9／9亦通過 |
| B GP 專項 | 16 項各跑 before／after，共 32；原無效圈 13 項各跑兩版亦通過 |
| C／D 統計與導航 | 8／8 PASS |
| 真 Web Locks／雙分頁／下載／衝突 UI | 8／8 PASS |
| 原瀏覽器救援與啟動流程 | 7／7 PASS |
| 真原生 pagehide 保存與釋放次序 | 4／4 PASS，含真問題版及拋錯對照 |
| GP 背景結算取消 | 4／4 PASS，含延遲成功／失敗與正常完成對照 |
| 三個固定回歸 | 3／3 PASS，未改基準 |

固定數值：BOT `54.425 hits=0`／aiHits 0；GP 冠軍陳冠宇 `162.0`／aiHits 8；進站陳冠宇 `175.7`／aiHits 5。

首次並行總測試中，本機排行榜 HTTP 讀取曾逾時；同一產品來源、相同測試與斷言單獨重跑通過。未調整逾時門檻；首次失敗與重跑輸出均保留，詳見 JSON 中 retriedSeparately 與 artifacts。

## 對照與證據

- A：舊頁會覆蓋新頁存款與匯入結果，主檔及有效快照一起倒退。修後以真 Web Locks 攔下第二頁，第二頁 WebGL 呼叫與存檔寫入均為 0；關閉持鎖頁後，另一頁須重讀才繼續。執行中外部改檔會停止物理／渲染，下載舊錢包不覆寫外部新錢包。
- 離頁保存使用同一原生 pagehide listener，先同步保存再封鎖／釋放；不依靠不同 listener 間的微任務順序。真導航驗證保存 1800 後才釋放鎖，問題版保留 1000 的對照也成立。衝突時取消 GP 背景結算，晚到的完成或失敗不再更新賽季或播放頒獎音效。
- B：真 Car 舊版在起終點旁行駛約 309.63 公尺／63.44 秒就被當三圈完賽，local PB 約 4.18 秒；修後同輸入跑 90 秒仍未完成第一個完整圈，PB 保留。真完整賽道有效圈 55.75 秒仍可計圈，兩種 GP PB 精確一致。合法進站、重置圈規則與既有續賽分段進度通過。
- C：開地圖保留 20m/s 一分鐘，舊版增加 1200 公尺，修後增加 0；夜間里程及里程成就門檻也檢查。正常駕駛統計比較保持一致。
- D：離路線距離固定為 0 時，60／120Hz 舊版定期重算約 96.267／186 秒，修後約 6.133／6.200 秒。連續三次週期、偏離 26 公尺、切目的地、計程車／街賽與高度路線分支均檢查。
- 瀏覽器只連 `http://127.0.0.1:4317`，使用外部 Chrome 的新隔離 context；真雙頁共享同一隔離儲存空間。另明確等載入 DOM 移除後才觸發執行中衝突，確認提示仍可顯示。390×844、844×390 與 844×220 短屏可操作、無水平溢出，衝突按鈕至少 48px。捕獲例外 0、非本機請求 0。

對照採用 `taipei-gp-abcd-before-3bdf97336c02`：包含上一輪已套用的 20 個未提交檔案。禁止將 Git HEAD 當作本輪修改前狀態；禁止覆寫舊 followup 交付包／manifest／結果。GP 舊測試的人工凍鐘 fixture 已修正為每步正常推時計，以同時檢查 RaceField 與本地最快圈；沒有為了測試加入產品特例。

## 重跑

在專案根目錄使用 PowerShell，將基準路徑指向 DCISI 保留的實際對照資料夾：

```powershell
$testBase = 'C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI'
$env:GP_BASELINE_DIR = Join-Path $testBase 'taipei-gp-priority-before-20261111'
$env:GP_FOLLOWUP_BASELINE_DIR = Join-Path $testBase 'taipei-gp-followup-before-2dee076'
$env:GP_ABCD_BASELINE_DIR = Join-Path $testBase 'taipei-gp-abcd-before-3bdf97336c02'
$env:GP_ABCD_MICROTASK_SOURCE = Join-Path $testBase 'taipei-gp-pagehide-microtask-before.ts'
node --experimental-vm-modules tools/dev-tests/abcd-checks.mjs
npm.cmd run build
$env:GP_CDP_PORT = '9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
node tools/dev-tests/external-browser.mjs 9333 abcd-ui-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 followup-ui-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 abcd-lifecycle-regression.mjs
```

Chrome／4317 必須先可用；不關閉使用者外部 Chrome，不用正式站測試。原生生命周期測試另開隔離本機 HTML 服務，並需要保留上述 DCISI 問題版來源快照；它不載 WebGL，也不代表手機 BFCache 的完整實測。

## 限制與交付

無 Web Locks 時僅逐次原文比對，不能保證完全同時寫入的原子性；備份區已顯示請只開一頁的說明。未追溯清除歷史錯誤 PB。GP 對照隔離其他車只推時計，地圖／導航用真 main AST 與隔離替身，皆不代表手機人手完整駕駛。

未驗證手機實機 FPS、耗電、觸控與音效；未測正式遊戲／排行榜／正式 Redis，也未讀寫玩家的瀏覽器存檔。套用與實際來源／dist 比對結果以 DCISI 本輪 `taipei-gp-abcd-apply-result.json`、`taipei-gp-abcd-original-verification.json` 及最新 `TAIPEI_GP_CODEX_HANDOFF.md` 為準；本輪未 commit／push。
