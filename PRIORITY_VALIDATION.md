> 上版交接：原專案已套用並建置，Rex 已明確授權提交與推送 main。提交及部署完成狀態請核對 DCISI/taipei-gp-priority-publish-result.json。下方「未提交／未推送」記錄為驗證當時狀態。

> 最新套用狀態（2026-11-11 11:48，Asia/Taipei）：Rex 已執行套用與建置，61 個來源／交付檔案及223個 dist 產物逐檔雜湊完全一致；build 99f984fced89，未 commit／push。下方先前「尚未套用」與403為已處理歷史，不需重套。核對紀錄見 DCISI/taipei-gp-priority-original-verification.json。
# 全模式優先改善：驗證與交付

基準 feaa6ff；最終 build `99f984fced89`。沒有 commit／push，沒有拿線上遊戲測試。

- 正式 `npm.cmd run build` 通過；既有 Vite 大型 bundle 提示仍存在。
- 12 組隔離／真 main AST／本機 HTTP 測試全部通過，測試期間產品來源雜湊未改變。
- 固定回歸 3/3：`BOT lap2 54.425 hits=0`／aiHits 0；陳冠宇 162.0／aiHits 8；進站陳冠宇 175.7／aiHits 5。
- Chrome 手機尺寸 UI 9/9，390×844、844×390；無 Runtime 例外，烤漆、明細、備份、44px、導航／街賽圖與鍵盤互動均通過。最後備份防連點另以真 main 事件測試通過。
- 非 BOT GP 瀏覽器 3/3：真正 UI／倒數、human 背景結算、頒獎／成績／回放。測試人工準備末圈及天氣／維修錄影樣本，並非整場手動駕駛。21 位 AI 實際完賽，獎金及交易只記一次。

## 本輪完成

計時／GP／排位入口暫態重設、依規則與版本保存紀錄、舊紀錄保留、無效圈提示；GP 最後圈與後方車手結算、共同計時點秒差；賽季全場檢查點續賽、比賽時間寬限、完整同分比較；歷史天氣／胎種／維修回放。

載客／導航／街賽／警方互動改同層判斷；地面逮捕與直升機視線分離；任務互斥與換車取消追緝；道路剩餘距離、路口平均停等／車況時限與收入說明；所有有效街賽完賽記 PB、兩模式分開、估計狀態明示；賽前路線圖／急彎折返與最佳比較；甩尾收尾、倒數倍率及互動練習提示；各車車損、烤漆試色確認；最近100筆收支與每次入帳金額比較。

完整備份／還原預覽／上次存檔復原，含賽季、歷史、位置、設定、車況、收支；取消、讀檔競態、無效預覽、容量不足與重複點擊皆有防護。排行榜 UUID v4、分榜／唯讀舊榜、軌跡合理性、冪等、取消／超時及安全錯誤；完整核心離線快取、串流超時／重試、Bloom／DPR 及 GPU 資源回收、設定操作與有效觸控比例。

## 重跑

在專案目錄使用 PowerShell：

```powershell
$env:GP_BASELINE_DIR='C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\taipei-gp-priority-before-20261111'
npm.cmd run build
node tools/dev-tests/priority-checks.mjs
$env:GP_CDP_PORT='9333'
& 'C:\Program Files\Git\bin\bash.exe' tools/dev-tests/chain-stab.sh
node tools/dev-tests/external-browser.mjs 9333 platform-ui-browser.mjs
node tools/dev-tests/external-browser.mjs 9333 gp-human-browser.mjs
```

需先有專用 Chrome 9333 及本機 127.0.0.1:4317 的 vite preview；preview 讀 dist。跨機器可另用 feaa6ff 的獨立 worktree 作 GP_BASELINE_DIR，不能拿已修改的原專案當 before。具體前後資料見 PRIORITY_VALIDATION.json 及 tools/dev-tests/*-evidence.md。

## 交付

工作副本在 DCISI/taipei-gp-work。套用包在 DCISI/taipei-gp-priority-delivery，manifest 逐檔記錄修改前／後 SHA256。Apply-TaipeiPriority.ps1 會先全數核對、備份，再套用；已是相同內容則略過，並行修改會拒絕，沒有 commit 或 push。原專案套用結果以根目錄 taipei-gp-priority-apply-result.json 與實際 hash 為準。需要部署時，必須連 api、shared 原始碼一起交付，不能只更新 dist。

## 驗證邊界

手機尺寸模擬不代表實機效能、觸控舒適度或聽覺驗證。排行榜只證明軌跡合理性，非權威防作弊；Lua 只在本機有狀態 Redis REST stand-in 驗證，尚未跑正式 Redis。計程車以路口平均停等提供交通緩衝，不預測即時車流／燈號。檢查點不保存大量回放座標，續賽回放由檢查點起；安全車後續抽樣未保留瀏覽器內建亂數的隱藏狀態。未逐一完整駕駛23個國際賽道。

套用腳本另以臨時 Git 專案驗證 10/10 通過：全數核對後才寫入、備份、重跑保留、新檔／HEAD／路徑守門及兩側 junction 拒絕。真專案的 preflight 通過；正式套用以 apply-result 為準。

本輪原專案套用尚未執行：2026-11-11，自動核准服務以 403／codex-auto-review 模型不可用拒絕提升權限；這是核准服務故障，不是判定修改不安全。命令沒有啟動，原專案仍未變更，沒有 commit／push。全部來源、正式建置與本機驗證已完成，請由 Rex 在一般 PowerShell 執行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\Users\RexChiu\OneDrive - IBM\桌面\Investment\DCISI\Apply-TaipeiPriority.ps1' -Apply -Build
```

腳本會核對原專案 HEAD 與每一檔修改前／後雜湊、拒絕並行修改或目錄連結、先備份再套用並建置；不會 stage、commit、push。結果寫入 DCISI/taipei-gp-priority-apply-result.json。原專案仍需這一步，不能把工作副本測試通過誤稱為原專案已更新。
