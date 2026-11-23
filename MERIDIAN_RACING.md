# Meridian 進階競賽與操作分析

作者：Rex <game88521@gmail.com>

本文件涵蓋第 4、5、8、9 項，並記錄 GP 好友盃與跨圖錦標賽共用的原席續賽整合。所有驗證使用本機服務；沒有以正式站驗證，也沒有 commit、push 或部署。

## 完整房規範本

範本 schema v2 保存一般房規、AI，以及 Summit、Atlas、Voyager、Odyssey、Expedition、Arena、Meridian 的進階設定。v1 舊範本維持原有解析與行為。

伺服器先驗證整份範本的欄位、相容矩陣、地圖與客戶端能力，再建立完成的房間與 AI，最後才傳送 welcome 與廣播。任一條件不合法便不建立房間，避免只套用半份設定。範本不含房碼、登入 token、比賽結果或玩家身分。好友盃有原席與進度，必須使用續賽 checkpoint，不能另存成一般房規範本。

主要來源：`shared/meridian-presets.ts`、`server/meridian-presets-service.mjs`、`shared/multiplayer-horizon.ts`、`server/horizon-service.mjs`、`src/multiplayer-horizon-ui.ts`。

## 真實操作與好友走線比較

單人計時賽從真正的 `Car.update` 後記錄車輛位置、賽道距離、速度、朝向與實際轉向／煞車指令。遊戲目前使用「沒有煞車便自動加速」的油門模型，介面及分享檔均明示，沒有假裝存在類比踏板。

約每秒 10 點，單檔上限 2 MB、8,000 點，圈長須為 8～720 秒。匯入會檢查完整 schema、時間、距離、位置、速度與朝向連續性，以及賽道版本、物理、規則、車款和輔助設定。只有同條件才比較同距離速度、操作與時間差；二維走線使用真實座標。條件改變時可保留舊好友參考，但不繪製或混同比較。無效匯入保留上一份參考。

資料只保留於記憶體或由玩家主動匯出為檔案；匯入不寫個人最佳圈、排行榜、影子車或經濟紀錄。格式與連續性檢查不等於防作弊認證。

主要來源：`shared/meridian-telemetry.ts`、`src/meridian-telemetry.ts`、`src/main.ts`。

## 多次交棒耐久接力

四名真人分為兩隊，每隊兩名原席車手，共用一部比賽車。可選 8 或 10 分鐘，要求 1～3 次交棒。候場者不模擬、不碰撞、不磨胎，也不接收駕駛輸入；可以追看場上的兩部車。

每棒至少 20 秒並行駛至少五分之一圈；每名車手總實駕至少 30 秒。交棒須在起終線後 80 公尺內的右側維修區停妥，且完成必要維修。服務端使用車輛真實位置、速度和維修狀態裁定；轉移完整車況、輪胎、損壞、進度與圈表，並增加駕駛世代，拒絕上一位車手延遲送達的輸入。

時間到後通過終點完成，最多有 120 秒寬限；未達交棒與每人實駕要求者記 DNF。原席離開或斷線逾期會令整隊 DNF。此模式沿用真輪胎與維修／車損，不放寬既有 Arena 接力規則。

接力／錦標賽即時面板在桌面有獨立可見層級，避開兩側狀態與底部駕駛控制；手機與矮橫向畫面則接入既有可捲動比賽資訊區。交棒按鈕可使用真正煞車操作停妥後點擊。

## 跨地圖錦標賽

房主選擇 3～5 張不同 GP 地圖。每站依序進行 180 秒排位、可選的一圈衝刺、原房規圈數正賽。所有站由同一批原席參與，每個階段都必須重新載圖與準備。

排位不開車輛碰撞，碰牆會令該圈失效。衝刺積分依名次為 3／2／1／0，正賽為 10／6／4／2；DNF 不得分。同分先比較正賽勝場，再依原席 slot 排序。伺服器嚴格驗證歷史階段順序、是否啟用衝刺、各站分數、總分、勝場與完結狀態。伺服器停頓中止不會被記成正常站績；Meridian 成績也不混入原有的一般比賽歷史。

主要來源：`shared/meridian-racing.ts`、`server/meridian-racing-service.mjs`、`src/meridian-racing-ui.ts`；共用房間、client、scene 與 spectator 的整合保留舊房間無 Meridian 欄位的行為。

## 站間原席續賽

跨圖錦標賽只在完整正賽結束後的站間存檔，恢復直接進入下一圖排位大廳，不重建虛構的歷史車輛狀態。好友盃也使用相同的簽章與原席私證明機制。

建立 checkpoint 時每個原席分別收到自己的新私證明；全部讀回並確認後才公開下載票據。公開檔不含登入 token 或原席 secret。同一期票據只對應一間恢復房，每個原席須提交自己的私證明，新房重新簽發連線 token。原房仍在時必須先全員離開，且原房沒有推進至下一階段，才可恢復；全員到齊、載圖並重新準備後才能開始。

票據有效期為七天。有持久簽章金鑰才能跨服務重啟使用；未設定時介面會明示重啟後失效。私證明在各玩家自己的瀏覽器，換裝置或清除瀏覽器資料後不能只靠公開票據取得原席。

主要來源：`server/meridian-championship-checkpoints.mjs`、`server/meridian-room-checkpoints.mjs`，以及共用 `meridian-checkpoints` 的 server／shared／client／UI。

## 驗證與限制

`node tools/dev-tests/meridian-racing-node.mjs` 最新結果為 **11 PASS／0 FAIL**，詳見 `tools/dev-tests/meridian-racing-node-result.json`。測試實際呼叫產品 `MultiplayerClient` 的房間驗證，不以測試自製 validator 代替。

- 範本 v1／v2、完整設定矩陣、原子建房與非法設定拒絕。
- 四原席、兩部 active car、候場隔離、過期駕駛世代拒絕。
- 從明示的接近維修區姿態起點，使用真 Car 固定步進 1,056 次、行駛 171 公尺，完成三次交棒，核對輪胎／車損交接。
- 明示終點 fixtures 驗證三站九階段、最高 39 分、DNF、過期 ready、伺服器停頓，以及跨重啟原席續賽。
- 14 份壞快照涵蓋數字 ID、錯誤 team／stage／trackId 型別，以及自訂 `toString` 的物件；parser 必須回傳 `null`，不接受型別強轉或拋出例外。
- 真 Car 操作 3,883 步，產生 778 點、77.66 秒的有效遙測，含 157 個煞車樣本。

核心 `car.ts`、`track.ts`、`rivals.ts`、`pitlane.ts` 的 SHA 保持不變。Node 的起點／終點 fixtures 已在各案命名與收據中標示，不能解讀為真人從頭完成全部比賽。

最終本機瀏覽器驗收使用 **build `862f7f9c9857`**，`node tools/dev-tests/meridian-racing-browser.mjs` 為 **5 PASS／0 FAIL、exit 0**。完整收據與 12 張截圖位於 `tools/dev-tests/meridian-racing-browser-evidence-1795411138848/`，latest 為 `tools/dev-tests/meridian-racing-browser-result.json`。

- 主遊戲真計時圈經 3,339 個 `__gp.step` 完成 66.833 秒有效圈，取得 617 點、557 個煞車操作；通過原生下載、原生檔案匯入、錯條件保留參考及 PB 隔離。
- 四個獨立 context 建立同一間真多人房、保存 schema v2 完整設定，通過同步起跑、兩位候場隱車／觀戰、真煞車輸入及原生 UI 交棒。服務區姿態是明示 fixture；實際路段行駛另由上述 Node 1,056 步案例驗證。
- 明示完賽 fixtures 驗證排位 → 衝刺 → 正賽的真 UI 切換與 13 分積分；四原席分別讀回私證明，公開下載檔無 token／secret，恢復到同一間下一圖排位大廳。
- 操作分析、接力大廳、接力即時面板、錦標賽結果共四個畫面，各通過 390×844、844×390、844×220 的尺寸、可達與遮擋檢查，共 12 個 layout／12 張截圖。
- `exceptions`、`externalRequests`、攔截器錯誤、網路失敗事件均為空；產品來源、測試腳本及兩支共用 CDP helper 的 hash 在測試前後一致，四個 context 與本機伺服器清理完成。

歷史失敗保留原狀，沒有以最終結果覆寫其時間戳證據：

- `meridian-racing-browser-evidence-1795407725599`：選賽道縮圖載入後重建 DOM，測試臨時 ID 消失；已改為穩定 selector 與原生滑鼠點擊。
- `meridian-racing-browser-evidence-1795409233307`：接力即時面板被 3D 畫面遮擋，已修正產品層級與資訊區整合；修前樣式另存 `meridian-racing-hud-before-evidence-1795409528775`，該樣式量測明示為無房間初始 DOM，實際比賽遮擋依原 FAIL 截圖。
- build `35ff11abd0b0` 的 `meridian-racing-browser-evidence-1795409729574` 與 `1795410058287` 雖有五個產品案 PASS，整個 suite 仍為 FAIL：離房後立即恢復會取消尚在 CDP 攔截中的台北預覽圖塊。事件沒有可對應的 networkId／ERR_ABORTED 證據，沒有將錯誤列為可忽略。最終測試明確等待真預覽 ready、`streamPending=0` 穩定 400 ms，原攔截器與 FAIL 規則維持不變。
- build `862f7f9c9857` 的 `meridian-racing-browser-evidence-1795410840354`：測試焦點仍在大廳按鈕，鍵盤煞車被正確拒絕，交棒未達停妥條件而逾時。最終腳本先以真滑鼠點擊未遮擋賽道，確認真正 input 與新序號封包均已煞車，才放置服務區 fixture 並交棒。

首輪 Node 的 8 PASS／1 FAIL 原 latest 曾被後續執行覆寫，無法還原原始 receipt；只將壓縮對話摘要保留的已知內容存於 `tools/dev-tests/meridian-racing-node-reconstructed-initial-failure.json`，明確標示為最小重建紀錄，沒有補造時間、堆疊或雜湊。

瀏覽器驗證使用本機桌面 Chrome 的四個獨立 context 與尺寸模擬，並非四支實機、跨網路壓力測試或真人全程完成全部比賽。
