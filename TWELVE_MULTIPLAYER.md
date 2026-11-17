# 十二項改善：多人5／6／7／8

## 使用入口

- 私人房大廳新增「私人房規則」。房主可選一般碰撞／無碰撞練習，以及首位完賽後30／60／120秒寬限。規則變更後清除全員準備與地圖載入確認；系列第一站起跑後鎖定。換圖、交棒、下一站、重連與再戰保留規則。
- 比賽右側可展開「賽道與近車」。小地圖依目前賽道的真實中心線等比例繪製，顯示權威車點；附近35公尺內的同高度對手顯示方向，前後距離使用權威賽程公尺差。公尺差不代表秒差；觀戰以目標車為中心。
- 大廳、離房後與結算頁所在面板底部可開「近期多人戰績」。保留20場單場及10筆完整系列，支援匯出JSON與清除。只存在此瀏覽器，不提供伺服器持久化或續賽。
- 插值視窗依快照到達變化自調80～220毫秒，連續500毫秒未更新時顯示連線停頓提示。自車預測仍上限180毫秒；輸入頻率及碰撞求解器未修改。

## 相容與資料範圍

契約見 [TWELVE_MULTIPLAYER_CONTRACT.md](./TWELVE_MULTIPLAYER_CONTRACT.md)。wire維持v2，physics維持`classic-multitrack-collisions-v3`。

新server宣告`capabilities.roomRules: true`並成對提供`roomRules`；舊server未提供時，client採一般碰撞／60秒並隱藏修改入口。非預設規則要求房內所有身分（含斷線保留名額）支援；舊client無法加入或續接此房，得到`RULES_UNSUPPORTED`。

近期戰績僅寫`taipei-gp-multiplayer-history-v1`。白名單保存日期、地圖、圈數、規則、暱稱、排名、逐圈／最快／完賽時間、DNF原因及積分；不保存房碼、續接憑證、連線端點、玩家ID、座標或輸入。匯出前提示含對手暱稱。資料損毀時保留原檔並明示；儲存空間不足時仍可查看及匯出本頁資料。

## 本代理已驗證

在多人獨立副本執行：

```powershell
.\node_modules\.bin\tsc.cmd --noEmit
node tools/dev-tests/twelve-multiplayer-server.mjs
node tools/dev-tests/twelve-multiplayer-models.mjs
node tools/dev-tests/twelve-multiplayer-ui.mjs
node tools/dev-tests/multiplayer-map-ui-lifecycle.mjs
```

- TypeScript：PASS。
- 新server9案、新models13案、新UI5案：27／27 PASS。
- 既有地圖UI生命週期：8／8 PASS。
- 每份新測試報告含來源SHA、腳本SHA、測試中來源未變檢查。
- server測試使用真loopback WebSocket、RoomService及Car；scene測試執行真`accept`／`frame`與預測，renderer使用替身。包含一般／無碰撞的權威及雙車手畫面姿態判斷，並未修改solver。
- UI測試使用真game／新模組搭配隔離DOM、socket、scene替身；不等於真瀏覽器或手機驗證。

## 插值排程量測

輸入來自真WS快照，再以虛擬到達排程送入真scene；各組暖機後540 frames。固定110毫秒作為對照，數字是插值所需快照不足的frames，不是畫面FPS或真外網丟包率。

| 模擬單向延遲排程 | 固定110ms欠缺 | 自調欠缺 | 結束視窗 | 最大自車預測 |
| --- | ---: | ---: | ---: | ---: |
| 50ms | 0 | 0 | 146.67ms | 116.67ms |
| 100ms | 540 | 0 | 196.67ms | 166.67ms |
| 200ms | 540 | 360 | 220ms | 180ms |
| 100ms加抖動 | 540 | 0 | 220ms | 180ms |
| 100ms加600ms短停 | 540 | 34 | 196.67ms | 180ms |

600ms短停有出現停頓提示。200ms組仍有360／540 frames缺乏插值快照，不能聲稱已解決所有高延遲。這不是外網、手機或真人駕駛量測。

## 交整合代理執行的browser測試

```powershell
node tools/dev-tests/twelve-multiplayer-browser.mjs
```

整合副本已在最終 build **d251460c360c** 執行CDP，**6/6 PASS**，例外與非本機請求均0，兩個context及本機server／preview清理通過。唯一證據為 `tools/dev-tests/twelve-multiplayer-browser-evidence-1794883727004/summary.json`。初跑2 PASS／1 FAIL是受控位置fixture殘留前次起跑校正，已清除fixture狀態後重測，產品未因此改動。預設專用Chrome CDP9334、本機preview4343，權威server使用臨時埠，兩個隔離browser context；封鎖及記錄所有非本機請求。`GP_TWELVE_BROWSER_PORT`可改preview埠。

6案涵蓋真雙人房規同步、重新載入／準備／倒數、無碰撞的權威與雙端真scene姿態、SVG路徑／車點／公尺差／雷達、三種視窗尺寸的觸控尺寸與遮擋、戰績去重／離房／reload／真Blob匯出內容／專用鍵清除。重疊位置及完賽由隔離service fixture設定，非真人完整繞圈。匯出測試驗證真Blob內容並攔截下載anchor click，不驗證作業系統下載資料夾。

browser報告會附build、來源及script SHA、exception、外部請求、截圖與context／server／preview cleanup。正式結論以整合代理實際執行報告為準；沒有實機手機、外網或遠端部署驗證。

其他驗證範圍：本browser腳本只用兩名車手，尚未提供3／4人真browser同場證據。跨tab戰績測試驗證依序讀取合併；`localStorage`沒有交易鎖，兩個tab在同一瞬間寫入不同賽事仍可能後寫覆蓋，不保證原子併發保存。

## 舊測試調整

舊VM harness補入真`parseRoomRules`／network依賴及scene新增狀態，未降低既有行為斷言。舊server能力精確斷言新增`roomRules:true`；舊能力省略fixture同時省略`roomRules`。舊browser儲存斷言只允許新history專用鍵，仍驗證其他單人存檔完全相同、禁止`localStorage.clear()`，並如實區分`localStorageUnchanged`與`protectedStorageUnchanged`。

全量build、三條既有模擬基準、舊Node／browser回歸與整合交付由父代理統一執行。本代理未改原專案、未commit／push或連線線上服務。
