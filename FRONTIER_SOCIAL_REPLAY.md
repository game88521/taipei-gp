# 第 3 項：城市社交房觀戰與匿名回放

署名：Rex <game88521@gmail.com>。共用錄製格式與播放器見 [FRONTIER_CITY_REPLAY.md](./FRONTIER_CITY_REPLAY.md)。本文件只說明巡航、警匪、追走的服務／客戶端接線。

## 觀戰

輸入既有六碼房間碼後按「以觀眾加入」。每房最多 4 位車手與另 4 位觀眾；觀眾不占車手席，不改準備、房主或房間 revision。鎖房拒絕新觀眾，已在房內觀眾仍可繼續觀看。最後車手離開後結束觀戰，不由觀眾保留空房；斷線原席仍依既有 15 秒規則處理。

觀眾走獨立 `watch-welcome`／`watch-state` 與 `SocialWatchRoom` 嚴格解析，不將觀眾偽裝為參賽車手。客戶端 `watching===true`、`watchRoom` 有資料，但 `room===null`、`selfId===''`。觀眾不能操控、準備、開始、換車、標記、復位或管理，伺服器逐項拒絕；UI 不執行預測、不寫參賽戰績、不提供好友雷達。

服務每次只送一位跟隨車的 pose，其餘名單僅有暱稱、席位與公開狀態；不送其他車輛座標、集合標記、玩家 ID、房主 ID、輸入序號或憑證。巡航可即時切換跟車；警匪／追走比賽畫面延遲 5 秒，倒數及進行中固定跟車，資料未累積足夠延遲時顯示等候。觀戰更新最多每秒 4 次，不提高既有車手訊息頻率。這些資訊限制可減少旁觀偵查資訊，仍需要朋友遵守公平觀戰，沒有宣稱防止所有轉述或作弊。

跟車使用唯一的真車模型 `frontier-social-watched-car` 與獨立名字 Sprite。借用本車僅供鏡頭目標，不執行物理或操控；換目標／車款、離線、位置停更、離房與 dispose 時清理資源。模型資源與名字自有 texture 分開清理，不釋放車款共用 texture。

觀戰不寫、覆寫或刪除原有可續接席位。觀戰中停用「續接原席位」，離開觀戰後原憑證仍可依實際 15 秒期限手動續接。鎖房拒絕、取消進房、觀戰到期與連線中斷同樣保留原文；不會延長保留期或自動續接。

由於本輪仍沿用 `frontier-social-v2`，新能力另在 hello 精確宣告 `cityWatchVersion: frontier-social-watch-v1` 與 `cityReplayVersion: frontier-city-replay-v1`。watch 快照也帶 `watchVersion` 精確驗證。客戶端遇到沒有宣告能力的舊 v2，停用對應按鈕並提示更新後端；第一次尚未握手時，可按觀戰先確認能力，未宣告就不送 watch。

## 匿名回放

每場開始建立新的記憶體錄製器，以真權威車位每 200ms 保存畫格，記錄已發生的接觸、逮捕、換段、斷線／續接、加入／離開、天候、返回集合區及結束事件。回放不重新跑物理，不重算分數。匿名 archive 只輸出 actor 編號及席位，不輸出暱稱、玩家 ID、房間碼、runId 或續接 token。

房間未結束時，即使知道錄製 key 也不能取得回放。結束後，房內車手與觀眾可按「取得匿名回放」，透過 `{type:'city-replay-chunk',key,offset}` 逐塊拉取，每塊最多 24 KiB。服務嚴格驗證目前房間、結束狀態、key、offset 與精確欄位，傳送緩衝過高時拒絕。描述資料位於 room／welcome／watch 訊息外層，不擴充既有 driver Room 欄位。

共用下載器最多同時一個傳輸，後續塊有 25ms 間隔，保留既有 90 訊息／秒限制。每片閒置 15 秒、總期限 60 秒；換場、離房、錯誤、斷線或按取消都清理未完成資料。一般訊息上限仍為 32 KiB，僅 `city-replay-part` 接受最多 64 KiB 的 JSON 包裝，再由共用 helper 精確檢查 24 KiB text 與連續 offset。

取得後只放在記憶體，可按「下載匿名JSON」保存，或按「播放匿名回放」。播放先離房還車、隱藏來源面板，再交給 `o.replay(archive)` 真城市播放器；不新增本機戰績分類或自動寫入存檔。錄製最多保留前 12 分鐘、16 個匿名 actor、512 個事件及 8 MiB 文字，容量或事件截短會標示。

主要 DOM：`#social-watch`、`#social-follow`、`#social-watch-note`、`#social-replay-download`、`#social-replay-cancel`、`#social-replay-play`、`#social-replay-export`、`#social-replay-status`。

## 驗證與界線

專用 `node tools/dev-tests/frontier-social-watch-node.mjs` 使用真 loopback、真服務與真客戶端，驗證容量、管理隔離、單車資料、5 秒延遲、原席保留、舊能力拒絕、finished 權限、匿名下載、取消、換場與長檔。結束採明示真服務停頓時間 fixture，不直接注入 phase、pose 或分數；長場採真權威車物理與確定時間推進，下載的速率視窗改用真實 elapsed 時間。

首輪回放整合 **17 PASS／1 FAIL** 揭露取消後快速重取同 key 的晚到舊片競態，原報告保留 `frontier-social-watch-replay-before-result.json`。共用下載器修正後原 18 案全 PASS；只消費與先前已驗證同 key／offset／總長度／原文完全相同的重複片，不接受內容不同或未預期的未來 offset。

新增長檔測試首輪 **18 PASS／1 FAIL** 是測試凍結的模擬時鐘使 90 訊息／秒變成整段傳輸總上限，原報告保留 `frontier-social-watch-long-clock-before-result.json`；改為真下載期間的實際 elapsed 視窗，不改產品上限。最終專用 **19 PASS／0 FAIL**，來源／測試原文雜湊及清理均通過。長檔實測四車 **3,587 畫格、3,010,839 字元、123 塊** 完整下載，總長 728,100ms、保留 719,983.33ms 並明確截短，仍維持已連線。

之後核對 duty 長檔失敗時，發現這支 social 長檔 fixture 雖已讓速率時鐘前進，仍同樣漏掉正式服務持續執行的權威 tick。回放片與 pong 不刷新房間快照 watchdog；若下載超過原有 3.5 秒快照期限，客戶端會正確停止連線。這是獨立於先前「速率時鐘凍結」的 fixture 問題；本次沒有將 social 未觀察到的失敗寫成已發生，也不推定 CPU 負載。

長檔 fixture 現在於下載期間維持正式 `/city-social` 相同的60Hz `service.tick()`，在 `finally` 清除並還原原模擬時鐘，不修改任何產品、速率上限、片間隔或 watchdog。補後重跑 **19 PASS／0 FAIL、exit 0**，來源／腳本雜湊不變且清理完成；同一123塊完成期間權威 tick 157次。收據為 `frontier-social-watch-node-result.json`／`frontier-social-watch-authority-tick-log.txt`；最終整合序列另由 root 重跑。

既有社交服務 19 案、房主管理 19 案、社交 client 6 案均已於本項新產品重跑通過。TypeScript 已通過。真城市模型可見性、鏡頭、直橫版面、播放器與存檔隔離由主代理整合瀏覽器驗證；Node 不能證明畫面。實體手機、外網真人、長時間 GPU／耗電與免費主機容量尚未驗證。本代理未執行 CDP、整體 build、commit 或 push。
