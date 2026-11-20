# Summit：回放事件、多人週末、AI 與耐久

署名：Rex <game88521@gmail.com>

這份是 Summit #4、#6、#7、#8 子項交接。工作副本為 `taipei-gp-summit-racing`，對照來源為唯讀 `taipei-gp-summit-before-64bc8f19a76a`。本文件不代表整輪其他子項或正式部署已完成；沒有 commit、push 或外網測試。

## 已完成的行為

- 回放 v2 附伺服器實際碰撞、護牆、超車、成功交棒、成功使用道具、單圈、進站、天候與賽事階段事件。碰撞從 60 Hz 碰撞解算結果記錄，沒有依 5 Hz 畫面猜測事故或判定肇責。每場最多 512 筆，接觸／超車相同組合每秒最多一筆；只匯出 `driver-N` 參照，不含房碼、原身分、match 或續接憑證。
- 回放檢討提供事件篩選、事件前後 3 秒播放、本機書籤；書籤與權威回放檔分離，最多 20 場、每場 64 筆。損壞書籤原資料不覆寫，儲存被拒仍能在本頁使用。原 v1 檔案仍走原嚴格匯入驗證。
- 房主可在一般單場開啟三分鐘排位→同圖正賽。擦牆、車輛接觸使本圈無效；只用期限內完成的有效圈排位，沒有有效圈從後排起跑。房主明確進入下一節，保留原身分，建立新 match／地圖世代並清除準備、載入與圈表。斷線原席的續接窗口受保留，新車手不能插入已排位的正賽；重設完整週末後可重新加入／換圖。
- AI 是伺服器真 `Car` 席位，有獨立控制器與實際碰撞、計圈、成績；沒有建立假 WebSocket。真人加 AI 最多四車，可單人加 AI 開跑，AI 不會被選為房主。最後真人離開後，只有 AI 的房間照期限清除。朋友加入前先減少 AI 騰席。
- 8／10 分鐘耐久可以搭配週末、AI。共享伺服器乾→雨→乾天候、實際前進里程胎耗、四種胎種。時間到後過線完賽，最多再等兩分鐘；沒有按照固定圈數提前結束。
- 全 24 圖使用起終線後 80 m 靠右青色維修區。車手先預約胎種，再以 18 km/h 以下實際靠入停車 6 秒；沒有傳送。作業期間車輛 ghost、不可更改策略，完成後換胎與累計停站。AI 也實際駛入服務。限速只作用在已預約的終點前 180 m／起點後 80 m 區間，不會整圈限速。
- 前端預測、權威端共用抓地／維修限速函式；回放 v2 同步雨勢、胎種、磨耗與進站狀態。混合成績、排位與耐久均有 UI／近期戰績標籤。

## 主要檔案

`shared/summit-racing.ts` 是設定、驗證、胎況與預測共用契約；`server/summit-racing-service.mjs` 控制週末／AI／耐久生命週期；`server/summit-events-service.mjs` 收集真事件。入口整合於 `room-service.mjs`、`horizon-service.mjs`、`nexus-arena-service.mjs`。Docker 有新增 runtime COPY。

`src/summit-racing-ui.ts`／CSS 與 `summit-racing-visuals.ts` 提供控制及標記；`multiplayer-scene.ts` 處理預測、雨勢、ghost 與資源釋放。回放擴充於 `shared/nexus-replay.ts`、`server/nexus-replay-service.mjs`、`src/nexus-replay-ui.ts`／CSS，書籤獨立於 `src/summit-replay-bookmarks.ts`。

`mountMultiplayerReplay(getClient)` 的對外 API 保留 `current`、`active`、`ready`、`at`、`seek`、`play`，供根代理最後整合 lazy facade。初始需要既有 results/history DOM，且 client 已存在才能立即建立訂閱。

## 本機驗證

```powershell
npm.cmd run build
node tools/dev-tests/summit-racing-server.mjs
node tools/dev-tests/summit-racing-client.mjs
node tools/dev-tests/nexus-replay-models.mjs
# 必須由根代理排程獨占本機 CDP 9334，先建置 dist：
node tools/dev-tests/summit-racing-browser.mjs
```

- `summit-racing-server.mjs`：13 大案，真 loopback WebSocket；包括權限、非法設定、舊能力／觀眾、舊命令、續接、階段切換、實際碰撞事件、成功交棒／道具及重送 seq、進站鎖定。服務內邊界案例有明示的車況 fixture。
- 另有真 Car 全程模擬：24 圖 AI 均完成一圈、0 護牆 tick，圈時 74.817～164.067 秒；三分鐘排位跑滿 10,800 個 tick；真人加 3 AI 三圈碰撞賽全員自然完賽，221.85 秒結束。
- 8 分鐘耐久 AI 完成 6 圈，527,415.463 ms 完賽；10 分鐘 AI 完成 7 圈，635,730.500 ms 完賽。兩者都實際低速靠入服務區、完成 2 次各 6 秒換胎，雨勢完整經過 0～100%。這是服務內控制器驗證，不代表真人難度／外網體驗。
- 普通競速 3,600 tick，取 60 份完整車況／進度／計圈／gate，比對 immutable before 完全一致。`car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts`、`server/physics.mjs` SHA256 不變。三個固定單人回歸由根代理於整合後統一執行，本子項沒有宣稱已重跑。
- `summit-racing-client.mjs`：7 大案。使用真 client TS、真 shared module 注入；含排位有效圈子集、普通房不可借用耐久放寬、grid、能力／資料配對、惡意回放與書籤容量／損壞儲存。
- 原 `nexus-replay-models.mjs`：14/14 PASS，原斷言未改，確認 v1 有界取樣、嚴格驗證與插值仍相容。
- `summit-racing-browser.mjs`：6/6 PASS；一個隔離真 Chrome context、另一位真 Node WS 車手與一台 server AI。包括真 UI 設定、排位→正賽、新 match/grid、策略、6 秒服務、同步雨勢、維修標記、v2 下載／片段／書籤與 v1 匯入。390×844、844×390、844×220 控制可達且至少 44 px；修正極矮橫向螢幕維修按鈕與 header 重疊。0 外部請求、0 JS 例外，cleanup 及測試期間 source/script unchanged。

browser 通過證據：`tools/dev-tests/summit-racing-browser-evidence-1794980164711/report.json`，build `18557cfb4464`。其後只補伺服器「舊觀眾禁止切入新版模式」與「系列續接房主能力旗標」兩個邊界，Node 重新驗證；最終整合 build／browser 結果以根代理紀錄為準。前兩次 browser 失敗（測試未等待 lobby、844×220 控制覆蓋）證據均保留，未改成假 PASS。

## 整合注意

舊 VM 測試若以手動模組表載入 `multiplayer-client.ts`，需要新增 `../shared/summit-racing` 的**真模組**注入，不能給 mock 驗證結果；所有舊 assert 必須保留。回放 v2 只在支援 Summit 的房間啟用，舊 manual identity 的普通房仍輸出 v1、原物理路徑不變。

本輪未測實體手機、真手把、外網延遲、公開部署、多房壓力或耐久在全部 24 圖的完整 10 分鐘。AI 全 24 圖完成圈、完整耐久集中台北；不要將兩者混稱為全圖耐久實測。
