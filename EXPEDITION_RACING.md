# Expedition 4／5／6／11 競速交接

作者：Rex <game88521@gmail.com>。本輪沒有 commit、push 或部署；只在隔離工作樹與本機測試。

## 4. PB 遙測與失時建議

入口沿用計時賽「圈速教練」。`TtCoach` 在新有效 PB 完成時保存完整遙測，重新進入相同賽道版本／規則，且正式 PB 時間相符時才恢復。舊 PB 沒有遙測時繼續顯示資料不足，不補造煞車資料。

- `taipei-gp-expedition-coach-v1`：最多10組、每組4096點、整份2,000,000字元上限。
- 儲存格式、時間／距離單調性、完整路線均驗證；損壞、quota或其他分頁改動時保留原文。本頁仍可比較。
- 以相同距離的實際時間差，挑出最多三段失時，列首次煞車位置與出段速度差。這是遙測觀察，沒有推斷轉向，也不承諾晚煞安全。
- 備份驗證：`validCoachStoreRaw(raw)`；對外存取在 `src/expedition-coach.ts`。

## 5. 可選正式賽規

多人一般固定圈數單場的房主可在「正式賽規（自選）」啟用界線／VSC超車規則。採 additive capability `expeditionRacing:true`，舊客戶端仍可玩未啟用的房間；啟用後拒絕舊車手／觀眾加入及續接。命令綁 roomCode／lobby revision，觀眾及非房主不能改。

- 界線：伺服器車輛中心橫距超過6.2m，速度超過5m/s，持續1秒記一次；回正持續1秒才可再記。前兩次警告，第三次起每次+5秒。
- VSC：active及尚未到解除時間的resuming期間，進度順序交換且拉開0.5m記+5秒。排除低於3m/s、斷線、未載入、凍結、DNF、完賽及維修車；同一對車有3秒冷卻。
- 總罰秒上限60秒；不判碰撞肇責。原始 `finishMs`／逐圈時間保留，另記 `adjustedFinishMs`，以調整後時間排名。DNF仍是DNF。
- 可搭配AI與一般天候／VSC；不與系列、週末、耐久、練習、Odyssey或其他特殊玩法混用。切換不相容玩法前先關閉正式賽規。
- 短斷續接保留已記警告／罰秒，停止採樣期間不累積出界持續時間；下一場重設。
- HUD、結果差距、分享卡、近期戰績皆保留罰則。新回放schema6保存匿名罰則採樣；舊schema1～5仍可讀。房碼／token／真player ID不放進回放。

主要檔案：`shared/expedition-racing.ts`、`server/expedition-racing-service.mjs`、`src/expedition-racing-ui.ts`。UI組合在原 `AtlasRacingPanel` 中，不新增另一條遊戲初始化入口。

## 6. 24圖三難度 AI 校準

新增 `tools/dev-tests/expedition-ai-calibration.mjs`，使用真正 `RoomService.simulate`／Car／逐gate完賽，全部24圖×3難度共72場。實測72/72完成、護牆接觸0；24圖均休閒圈時＞標準＞競技。原多人profile已符合這組安全與速度分層條件，因此保留profile，不以未量測數字調快。

`shared/expedition-ai-calibration.json` 保存實測圈時、物理版本、catalogStamp。大廳AI設定顯示當前地圖三難度參考秒數，明示乾地／單車／靜止起跑。多人交通、雨地與車損另影響圈速；單車校準不是四真人公平性或免費主機容量證明。

```powershell
node tools/dev-tests/expedition-ai-calibration.mjs
# 量測PASS後明確重寫展示參考資料：
node tools/dev-tests/expedition-ai-calibration.mjs --write-reference
```

## 11. 每日固定條件挑戰

主選單「每日固定條件挑戰」依台北UTC+8日期決定24圖、種子與乾地／60%濕地；固定classic方程式／簡單AI／safe-v1、P8滾動，一圈前8、重撞最多2次。日期改變或頁面回前景時刷新；跨午夜的已啟動挑戰仍記原日期。

頁面返回及切回前景會重新排定午夜更新，先清除舊 timer，反覆返回仍只保留一個排程；離頁每次都清理。這避免 BFCache 返回後失去下一次每日輪替。

換圖／分享URL只帶本圖及 `daily=1`，打開後展開挑戰而不自動起跑。main完成分支獨立保存，不寫正式PB、錢包、賽季或原情境挑戰紀錄。

- `taipei-gp-expedition-daily-v1`：最近31個挑戰紀錄、40,000字元上限；失敗增加嘗試次數，不覆寫成功最佳。
- 損壞／跨分頁改動保留原文；未通關不顯示通關PB，分享明示本機成績，非雲端認證排名。
- 備份驗證：`validDailyStoreRaw(raw)`；DOM入口 `#expedition-daily`／`#expedition-daily-start`。

## 驗證與限制

已執行：

```powershell
node node_modules/typescript/bin/tsc --noEmit
node --experimental-transform-types tools/dev-tests/expedition-racing-node.mjs
node tools/dev-tests/expedition-ai-calibration.mjs
node tools/dev-tests/odyssey-racing-node.mjs
```

新Node套件14/14 PASS，包含storage損壞／quota／CAS、UTC+8／31日、真WS權限／cap／revision、持續出界／VSC順序、排名／戰績／schema6、正式賽規真Car逐gate一圈119.029秒且0罰秒。每日生命週期案對照只還原 timer 小修的前版，返回後排程數0，修後為1，並驗兩次返回及下次午夜更新。舊Odyssey13/13 PASS，含真Car衝刺與舊schema1～5相容。

瀏覽器腳本已在最終 build **d5068bed213b** 序列執行，5/5 PASS，Node 退出碼0，無頁面例外、無外網請求，場景／連線／context 均清理完成，受測來源及腳本在執行期間未變更：

```powershell
node --experimental-transform-types tools/dev-tests/expedition-racing-browser.mjs
```

使用既有localhost4317 preview、CDP9334，另啟動臨時本機WS服務並自行清理。原生點擊主要入口，檢查教練跨reload、每日獨立結算、正式賽規手機版面／HUD／結果／戰績與schema6保存播放。PB採樣、每日最後一圈、規則位置及分類時間在報告中明示為fixture，沒有宣稱這些是完整真人跑圈。完整真Car量測另見上述套件。

每日返回另以 synthetic pagehide／pageshow persisted 事件及偏移一天的時鐘檢查 DOM 刷新，沒有冒稱是真實 BFCache 回存。初跑測試切錯設定分頁、reload 前未展開遲載回放庫，以及合成離頁事件觸發原存檔保護造成遮擋，原始失敗報告保留於各 evidence 目錄；修正測試操作順序後重跑全五案通過，沒有移除斷言。最新報告為 `tools/dev-tests/expedition-racing-browser-result.json`，證據 `expedition-racing-browser-evidence-1795174642916`。

固定三與整體交接結果由根代理的最終驗證文件另列。未測正式站、公網延遲、實體手機FPS／發熱、真四人碰撞平衡或免費Render承載。
