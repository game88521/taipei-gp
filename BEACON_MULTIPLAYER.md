# 四人長場與原席續接穩定度

作者：Rex <game88521@gmail.com>

本輪對應建議第 4 項，只處理既有多人競速的穩定度，沒有增加人數上限或改賽車物理。只測本機 loopback；本文件不代表 commit、push、部署或公開主機容量已驗證。

## 原席重載後換棒被忽略

耐久接力中，過早點換棒也會消耗該連線的操作序號。原本服務端續接會重設一般接力、維修、VSC 的操作序號，卻保留 Meridian 換棒序號。若舊連線已送到 50，新載入頁面的序號從 1 起，即使位置、時間、車手與世代都合法，換棒仍會被當作舊訊息忽略。

`server/room-service.mjs` 的原席認證成功後，現在同樣重設 `meridianSeq=-1`。退休 socket 仍先與原席脫離，駕駛世代及合法停靠／時間／距離檢查繼續生效；不放寬續接期限或讓舊 socket 重新控制。

修前對照：`tools/dev-tests/beacon-multiplayer-before-evidence-1795414310640-022074/report.json`。對照明示設定合法維修區位置與賽時計時，直接驗真 RoomService 的原席認證及換棒，沒有等待真人駕駛。原腳本副本一併保存，避免之後測試修正使歷史 script hash 失去對照。

## 自動驗證

```powershell
node --experimental-transform-types tools/dev-tests/beacon-multiplayer-node.mjs --core
node --expose-gc --experimental-transform-types tools/dev-tests/beacon-multiplayer-node.mjs --soak
node --expose-gc --experimental-transform-types tools/dev-tests/beacon-multiplayer-long-soak.mjs
```

`--core` 最新 4／4 PASS，證據為 `tools/dev-tests/beacon-multiplayer-node-evidence-1795414590377-5aeb0e/report.json`：

- 原席重載後序號 1 可完成合法換棒，退休 socket 不再能操作。
- 四名真 WebSocket 玩家、真 Car／Track，完整推進 607.5 秒 authority 時間：兩隊各三次交棒、一次原席短續接，雙隊正常完賽。模擬約 36450 個 60Hz 步驟；11431 筆延後控制、713 筆省略控制，排程佇列最多 3 筆、測試端訊息保留最多 32 筆。明示使用六個交棒維修區位置與兩個最後接近終點位置 fixture；最後跨線仍由真 Car 與權威判定完成。
- 四名玩家大廳換圖 40 次，320 個過期載圖／準備訊息被拒絕；連線維持四條、房間一間，track cache 最多 24 張，不超過目錄。
- 控制停止超過 700ms 後安全減速，主動煞車可停車；慢 socket 超過既有 256KiB 背壓上限會關閉並清理。

延後與省略控制是在送進 WebSocket 前的應用排程，不是公網 TCP 掉包實驗。十分鐘 authority 快轉不算十分鐘真人牆鐘；換圖 Node 案也不代表瀏覽器 GPU 資源清理已驗證。

`--soak` 是另外一套實際牆鐘 120 秒、四名真 WebSocket／真 Car 的短程負載，最新 **1／1 PASS**。實際經過 121.023 秒、authority 121.065 秒，四人各完成一圈且仍在比賽；送出 10152 筆控制、略過 846 筆，包含兩秒背景停控與一次短續接。控制訊息在進入 WebSocket 前延後 0～230ms；測試端只保留最近 32 筆訊息，排程最多 16 筆、socket 緩衝觀測最大 0 bytes，30 秒後各次 GC 後 heap 的高低區間為 4915096 bytes（約 4.69 MiB），不宣稱這等於伺服器本體的記憶體占用或長期穩定界線。關閉後要求房間、client 與 WebSocket 全部歸零。證據：`tools/dev-tests/beacon-multiplayer-soak-evidence-1795414622553-479b07/report.json`。此短測不能替代實體手機、免費主機四人長場或外網真人驗收。

既有回歸由 `node tools/dev-tests/beacon-multiplayer-regressions.mjs` 使用原測試執行：`meridian-racing-node` **11／11 PASS**、`multiplayer-server-regression` **14／14 PASS**，合計 25 案。完整 stdout／stderr 與原結果保存於 `tools/dev-tests/beacon-multiplayer-regressions-evidence-1795414836836-2b1fc5`。最終狀態見 `beacon-multiplayer-regressions-result.json`；兩個套件包裝狀態不再當作額外產品個案加總。產品來源與測試腳本 hash 稽核通過。

## 保留的開發失敗與限制

首輪 core 的 2 PASS／2 FAIL 保存於 `beacon-multiplayer-node-evidence-1795414347678-dab160`。換圖測試誤用 `expectedTrackRevision`，產品契約是 `expectedRevision`；停控測試則把前 700ms 仍正常加速區間也算入減速比較。兩處修正的是測試契約與量測區間，沒有提高服務限流或改停控保護。首輪耐久跑至 720 秒正常超時 DNF；後續明示加入最終接近終點 fixture，另驗雙隊正常完賽，不改寫原始收據。

中間一次 core 4 PASS 的腳本亦封存；最終統計只計當步 active driver 的固定步距離，避免把隊友終局進度鏡像計成行駛。所有原始 FAIL 與中間 PASS 都留在各自時間戳目錄，最新結果不覆蓋它們。

## 十分鐘真牆鐘耐久補驗

獨立 `beacon-multiplayer-long-soak.mjs` 沿用短測的 loopback WebSocket／Car 與有界訊息保留方式，沒有改動既有腳本、產品或來源時間。最新 **1／1 PASS**：實際牆鐘 **600.200 秒**、authority **600.252 秒**，採正式 600 秒 Meridian 耐久接力，四個參賽席、同時兩輛當棒車；四位參賽者都累積約 299～300 秒實際駕駛棒次。

每 30 秒記錄連線、房間、GC 後 heap、控制排程與兩隊棒次。兩隊各三次交棒，共使用 **六個明示維修區位置 fixture**；交棒所需時間與已行駛距離取實際累積，沒有快轉 authority、設定距離或終點位置 fixture。兩次原席續接中斷分別約 **773／758ms**，退休 socket 已關閉且續接後 Meridian 序號重設為 -1；另有兩段約三秒的背景停控。

共送出 **24838** 筆控制、略過 **2069** 筆，排程最多 **12** 筆，測試端訊息環最多 **32** 筆，客戶端 socket 傳送緩衝觀測最大 **0 bytes**。第 90 秒起各次 GC 後 heap 高低區間 **5302136 bytes（約 5.06 MiB）**；這是整個本機測試程序在本次有界區間的觀測，不代表沒有長期洩漏或免費主機容量保證。結尾兩隊各行進六圈／五圈，四席仍連線且無 DNF；當時仍在等待耐久時間到後的下一次終點通過，因此 **不算正常完賽證據**。正常雙隊完賽仍由前述明示 authority／終點 fixture 的 core 案單獨覆蓋。

產品來源與測試腳本 hash 在測試前後一致。關閉後本次 client、房間、WebSocket、控制排程皆為 0，所有測試端 socket 已關閉。證據與當次原腳本：`tools/dev-tests/beacon-multiplayer-long-soak-evidence-1795415326500-7ee264/`；最新收據為 `tools/dev-tests/beacon-multiplayer-long-soak-result.json`。當次腳本 SHA-256：`5e762a98e60574e54ed923bc0c967aaa460498003a0011077d66e905a8bad811`。

這裡沒有實體手機、瀏覽器 GPU、跨網真人、Render／Vercel、免費主機承載量、十幾分鐘完整真人正常完賽或多小時連賽證據。最終建置、瀏覽器換圖與固定三基準由本輪總驗收另列。
