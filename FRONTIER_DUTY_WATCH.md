# Frontier 第 3 項：合作救援觀戰與匿名回放

作者：Rex <game88521@gmail.com>。承接 Expedition 與 Frontier 第 1、2 項，未提交、未 push、未部署。

## 功能與權限

- 原六碼救援房可另容納四位觀眾，不占兩位隊員席；觀眾仍受服務總連線與每位址上限約束。
- 觀眾跟隨同一輛權威平板車，顯示檢查點、停穩、警示、定位、絞盤阻擋與側偏、固定、返程完整度及卸載。觀眾離開或掉線不改準備、房主、revision、runId、車速或勤務。
- 服務端明確拒絕觀眾操控、作業、準備、起跑、取消、重開與冒用隊員席位。觀眾沒有隊員 token，也不寫隊員成績或覆寫原 session 私人席位。
- 最後隊員離開或掉線保留期屆滿會結束觀戰、清房；一般隊員掉線保留原有 15 秒安全暫停及手動續接規則。
- `/city-duty` 保留既有 `city-duty-v1`，以 hello `features.cityWatch=1`、`features.cityReplay=1` 與精確 `features.cityReplayVersion` 宣告擴充。舊服務未宣告即禁用並顯示更新提示，可按「重新檢查觀戰／回放服務」重查。

## 回放資料與生命週期

- 每次勤務起跑建立新的共用 `CityReplayRecorder`，只取服務端權威車況與作業狀態，不信任客戶端座標或成績。
- 200ms 一個車況樣本，最多 12 分鐘、3602 個 frame、512 個事件及 8 Mi 字元 JSON。超過區間會標示 `truncated`，不宣稱完整全場。資料僅放 RAM，不寫伺服器磁碟。
- 包含一輛匿名 `rescue` 平板車、事故車姿態、loaded、完整度、operation、dwell、next、winch along/lateral/blocked，以及階段、接受的操作、接觸、斷線、續接與結束事件。
- 封存 JSON 不含暱稱、玩家 id、房碼、runId、session token 或 socket。匿名 actor 僅保留固定 slot；勤務結果保存仍只由真正隊員執行。
- 賽後只有目前房間的隊員與觀眾可拉取，每塊 24 Ki 字元；檢查精確欄位、key、對齊 offset、容量及 256 KiB backpressure。沒有整包廣播或自動重試。
- 共用下載 helper 逐片校驗、後續片間隔 25ms、15 秒 idle／60 秒總期限，取消、換場、離房、錯誤或掉線都清除未完成資料；舊片不會混入新場次。Duty client 額外拒絕不屬於 `source:duty/mode:rescue` 的回放。
- 可下載匿名 JSON，或先離房、還原借用車況與關閉原面板，再進入共用城市 3D 回放播放器。下載內容不自動寫入 storage。

## 接線與驗證

`ExpeditionDutyOptions.replay?(archive: CityReplayArchive)` 交由 main 串接共用播放器。UI IDs：`expedition-duty-watch`、`expedition-duty-watch-count`、`expedition-duty-follow`、`expedition-duty-replay-download`、`expedition-duty-replay-play`、`expedition-duty-replay-cancel`、`expedition-duty-check-service`。

```powershell
node tools/dev-tests/frontier-duty-watch-node.mjs
node tools/dev-tests/frontier-duty-replay-node.mjs
node tools/dev-tests/expedition-duty-node.mjs
node tools/dev-tests/expedition-server-node.mjs
```

回放 Node 最新 **7／7 PASS**，來源與腳本執行期間未改動；真完整勤務 fixture 有 93 frames、25 events、2 塊／47,394 bytes，八階段與絞盤、loaded、事故車、接觸及斷線續接俱全。另以真產品 client／loopback WS 拉取 12 分鐘／3601 frames／92 塊，原 80 訊息／秒限制下下載成功，沒有重試。

曾有一輪六案全通過，但 root 同時更新共用 helper，來源 hash 稽核失敗；原始報告保存在 `tools/dev-tests/frontier-duty-replay-node-source-race-before.json`，凍結來源後上列七案完整重跑通過。

最終整合兩輪長下載曾為 **6 PASS／1 FAIL**，原始失敗保留於 `frontier-duty-replay-parallel-capacity-result.json` 與 `frontier-duty-replay-parallel-final-1795189581505-result.json`。唯讀核對確定舊長檔 fixture 只建立 WS 與回放收發，下載期間沒有正式服務持續執行的權威 tick；回放片／pong 刻意不刷新房間快照的 `lastInbound`，超過原有 4 秒 watchdog 就會正確停止觀戰並取消下載。原先單跑 2832ms 通過只代表該次在期限前完成，不能排除 fixture 缺陷；沒有把事件延後推定為 CPU 負載。

長檔測試已補正式 `/city-duty` 相同的 30Hz `service.tick()`，並於 `finally` 清除 timer；不修改產品、watchdog、80 訊息／秒、25ms 片間隔或下載期限。補後 **7 PASS／0 FAIL**，來源／腳本雜湊不變且清理完成；92 塊下載 2936ms、真權威 tick 72 次。收據為 `frontier-duty-replay-node-result.json` 與 `frontier-duty-replay-authority-tick-log.txt`，最終整合序列另由 root 重跑。

本文件的 Node 勤務閉環使用明示停靠／檢查點 fixture；contact 路徑使用真 `FreeCar.update` 後的受控 impact 結果。這不代表真人駛完全路線或真人撞擊體感。瀏覽器三 context、3D 播放與手機版面由 root 統一整合驗證，本代理沒有操作 CDP 或產品 build。手機實機、兩台裝置、公開跨網與免費主機負載尚未驗證。
