# 合作救援與城市定速拉力

作者：Rex <game88521@gmail.com>

本輪提供兩個獨立玩法，沿用城市的真實路網、FreeCar、分層 Surface 與建築碰撞。紀錄不影響原單人錢包、PB 或大獎賽成績。尚未 commit、push 或部署；本文件描述本機工作樹。

## 合作救援

- 入口「雙人合作救援／定速拉力」或玩法列表中的合作救援。邀請使用 `?crew=六碼房間`，不占用既有單人勤務的 `?duty`。
- WebSocket `/city-duty`，版本 `city-duty-v1`。兩位玩家共用同一輛權威平板車與同車視角，不是各跑一輛車。
- 出勤固定晴天，兩端視覺與車況環境一致；結束借車時還原進入前的天候與導航。
- 房主是司機，負責駕駛、停靠定位及確認固定；第二位是協助者，負責長按設警示、側修與收放絞盤、卸載。兩人均準備後房主出勤。
- 信義勤務站往信安街約 1141m／39 個沿路檢查點，返程約 1542m。必須按序過門、同層對準，低速停穩 1.5 秒才可作業。
- 警示需連續 2 秒；絞盤需修正側偏至 ±0.35m 並收進 4.2m；固定後滿載返程，連續卸載 3 秒完成。返程撞擊會降低故障車完整度。
- 隊員斷線立刻停車、停止絞盤與勤務計時，15 秒內可手動續接原席；續接輪替 token，沒有自動重送作業。逾期由留下者成為司機並返回大廳。
- 客戶端只發操控或職責作業，不收玩家傳送的座標、分數或完賽。按 `blur`、隱藏頁面、開啟面板或離開會立即送中立操控／停止絞盤。大廳每 10 秒 ping 保活；斷線／取消清除心跳。快照各層白名單拒絕多餘方法、憑證或未知欄位，不會把原始 pose 整包指派到 FreeCar。

## 城市定速拉力

- 單人離線，入口可預選 `?regularity=1`；有 28／36／42 km/h 三種目標均速。
- 拉力固定晴天；退出後還原進入前的天候與導航。
- 單行道路路線約 1459.5m，73 個順序門，25／50／75／100% 四個計時點。三秒倒數後開始。
- 每點早到或晚到的絕對秒差相加，超過 50 km/h 另累加超速罰分，總罰分越低越好。搶快不能靠更短總秒數獲勝。
- 要求同層正向過門及連續合理位移；重設／傳送／異常超時不產生成功紀錄。退出時還原借用前的位置、車規、幾何、天候與導航。

## 保存與部署接線

- `src/expedition-duty-records.ts` 是 UI 與備份共用的純解析器。
- 本機拉力 key：`taipei-gp-expedition-rally-v1`；合作救援 key：`taipei-gp-expedition-crew-results-v1`。各最多 30 筆、100000 bytes，校驗唯一 id、時間與檢查點順序、罰分總和與欄位白名單。只寫本次完成的紀錄種類，先比對載入時原文；若另一頁或備份匯入已修改，停止覆寫。損壞／超量／寫入拒絕也保留原文，仍可下載本頁紀錄。
- session key `taipei-gp-expedition-duty-seat-v1` 含續接 token，**排除備份與診斷**。
- `server/index.mjs` 共同接入 `/city-social` 與 `/city-duty`，五種服務共用連線上限、exact Origin 與每位址 16 條限制。四種城市服務共用一份世界，不重建 184 個圖塊。兩種新服務預設各最多兩個房間。
- health 增加 `citySocial`、`cityDuty`、`totalConnections`；timer、heartbeat 與 close 也涵蓋新服務。Docker COPY 補齊既有 Atlas／Voyager／Odyssey 與本輪三種 Expedition 服務的 runtime 相依。

## 本機驗證

```powershell
node tools/dev-tests/expedition-duty-node.mjs
node tools/dev-tests/expedition-server-node.mjs
node tools/dev-tests/multiplayer-server-regression.mjs
node tools/dev-tests/nexus-coop-server.mjs
node tools/dev-tests/summit-city-race-server.mjs
```

此刻已確認：獨立 duty 測試 14／14 通過（含產品 client 的真 loopback／續接、未知方法欄位拒絕及紀錄衝突）、TypeScript 通過；server 整合重跑 9／9 通過、舊 GP 14／14、合作送貨 19／19、城市競速 13／13。duty 報告的六個來源 hash 與現檔相符；server 報告補記 48 個 server／shared 來源 hash，全部與現檔相符，執行期間來源與腳本未改動。Docker 檢查驗到 42 個遞迴 runtime 檔案、24 個賽道資產及 184 個圖塊；沒有執行 Docker image build。

`expedition-duty-browser.mjs` 使用既有本機 preview `127.0.0.1:4317`、CDP 9334，自行啟動並清理 4320 server，建立兩個獨立瀏覽器 context，封鎖外網。最終 build **`d5068bed213b`** 實跑 **9／9 PASS**，零 runtime exceptions、零外網請求，清理、來源 hash 與腳本 hash 均通過。

瀏覽器實測包括真 UI 建房／加入／準備／出勤、原生鍵盤推動權威平板車 0.4265m、同車模型、斷線續接與 token 輪替、角色專屬按鈕與完整絞盤／卸載、退出還原原位置車規及受保護單人資料、真城市拉力倒數與鍵盤駕駛，以及明示連續 160m 計分 fixture。390×844、844×390、844×220 共九個 layout 檢查均通過：可見控制至少 44px、中心 hit target 可達、無橫向溢出，產生十張截圖。證據在 `tools/dev-tests/expedition-duty-browser-evidence-1795174804072/report.json`，總報告為 `expedition-duty-browser-result.json`。

首輪首案因測試輪詢在 lazy UI 尚未掛載時讀取空 DOM 而失敗，原始失敗保存在 `expedition-duty-browser-fixture-before-nullguard.json`；補 nullguard 並重新建置後，上述最終重跑通過。

完整救援測試明示使用 server 停靠／gate fixture；完整拉力計分測試明示使用連續 160m 路線 fixture。真城市物理、路網與產品評分有測，但不代表真人跑完整 1～1.5km 路線。手機實機、兩台裝置、公開跨網及免費主機負載尚未驗證。
