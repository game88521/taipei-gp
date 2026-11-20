# Frontier 第 8 項：移動王冠

作者：Rex <game88521@gmail.com>。

這是 2～4 人、同款轎車的三分鐘碰撞持冠模式。沿用 social 權威 FreeCar／Collider、朋友識別、獨立觀眾、匿名回放與有界續接，不增加單人錢包、正式圈速或成就。尚未 commit、push 或部署。

## 正式規則

- 全員準備後由房主開始，倒數三秒，再進行完整 180 秒；初始王冠依當場 slot 順序逐輪輪替。
- 持冠者每個 1/60 秒權威步進累積有效持冠時間。結果公開至 0.1 秒，最高公開秒數相同者共同得冠。
- 使用真實 `streetContact` 接觸對轉移王冠；候選依 slot 穩定排序，同一權威步進最多轉移一次。起始、轉移與重新發還後皆有三秒護冠。
- 活動區為 station 0 附近、半徑 220 公尺的地面圓域，同層高度差須小於 1.8 公尺。出界或不同層立即停分，連續五秒未回來即離席失格。
- 斷線保留 15 秒，斷線期間停分。退出或保留期耗盡時，若仍有至少兩名有效車手，王冠發還最低有效 slot；另記 `crown-return`，不算碰撞轉移。有效名單不足兩人即以 `left` 結束，沒有冠軍。
- 正常完成、離席與超過一秒的 `server-stall` 分別呈現；只有 `complete` 提供 `winnerPoints`。賽後名單與當場結果保留到再開一輪，離房或續接期限不能改寫當場結果。
- 未授權位置、分數、持冠者與碰撞訊息不進入權威計分。平常仍由玩家只送操控，服務持有座標與碰撞結果。

## 介面、隱私與協定

- `CROWN_VERSION = frontier-crown-v1`，能力探測、create／join／resume 必須帶對應版本；舊 social 模式維持既有形狀與規則。
- 房間與 HUD 顯示持冠者、個人秒數、剩餘時間、護冠與出界倒數。邀請網址同時帶 `social` 與 `socialMode`，開啟邀請會選到正確玩法。
- 王冠對手名字、雷達與皇冠只在 80 公尺內且同層顯示；自車可見自己的王冠。
- 競技觀眾固定跟車，延遲五秒。`watch.crown` 僅含 holder slot 與護冠期限，取自同一延遲畫格，不增加其他車輛座標。
- live 與 replay 使用自有 Three 皇冠幾何，獨立 dispose，不釋放共用車輛資源。live 皇冠位於 `expedition-social-players` 下；場景中 inactive replay 也有同名模型，測試須從正確群組查找。
- 匿名回放新增 `crown-start`、`crown-transfer`、`crown-return` 權威事件；嚴格檢查模式、來源與 actor 數量，`cityReplayCrownAt()` 依事件重現匿名持冠 actor。
- 戰績沿既有 social 分類保存 `{durationMs,transfers,winnerPoints}`，保留 20 場與舊四模式相容。完整備份目前共 31 類；王冠沒有新增席位 token、玩家 ID、房碼或獨立儲存類別。
- root 負責 main query、diagnostics 與 Docker 接線；本文件只記錄第 8 項權威服務、client、模型與測試證據。

## 本機驗證

- `frontier-crown-service-node.mjs`：15 PASS／0 FAIL，exit 0、來源與腳本 hashes 不變、HTTP／WS／席位清理完整。主報告 `tools/dev-tests/frontier-crown-service-node-result.json`，完整證據 `frontier-crown-service-evidence-1795187181076/`。
- 其中完整 180 秒使用真整合服務 WebSocket、正常三車排位與真 FreeCar；第三席直線追撞，全程只送 input，未注入 pose、門序、分數或 phase。第一次真轉移為 4166.666666627862 毫秒，最終公開秒數 `[4.2,0,175.8]`，`winnerPoints:175.8`；216 次嚴格 parser 檢查、最大 room envelope 1961 bytes、最大單步位移 0.05691354384756905 公尺。時間為權威模擬時間，不代表外網延遲或真人平衡。
- 同一案例逐塊下載 25 塊匿名回放、902 frames，通過身分隱私與王冠事件重現；賽後離房與超過 grace 後，當場名單仍可解析。
- 同步多車接觸 tie-break、護冠、同層與出界等負例使用明示 pose fixture；這些案例只證明權威規則，不宣稱真人對戰證據。
- `frontier-crown-models-node.mjs`：10 PASS／0 FAIL，涵蓋嚴格 summary／history parser、共同得冠與中斷標籤、20 場上限、損壞原文保留、跨頁競態、quota、完整備份往返、80 公尺同層雷達、真 Three dispose／depthTest 與真 WS 回放事件。
- 微調後舊回歸共 96 PASS／0 FAIL：social 19、client 6、房主管理 19、續接 15、觀戰／回放 19、備份 7、診斷 11。`tsc --noEmit` PASS。
- 備份測試原先硬寫 27 類，在其他項目新增分類後為 6 PASS／1 FAIL（31 !== 27），保留 `expedition-backup-before-frontier-count-result.json`；測試改讀 `ATLAS_BACKUP_SLOTS.length`，仍檢查所有合法舊 prefix 與混合世代拒絕，未放寬產品 validator。

## 真缺陷對照與保留證據

- 原 crown 完成判斷使用 `now >= endsAt`，單 tick 最多 12 步時，末段有 700 毫秒 backlog 會在只累積 179.60000000003507 秒時結束。`frontier-crown-service-before-backlog-result.json` 保留 14 PASS／1 FAIL。
- 僅 crown 改以 `r.simAt >= r.endsAt - .001` 完成，先排空可接受 backlog，再結束；超過一秒仍走既有 stall 中斷，其他模式完成時序未改。新案例實際累積完整 180 秒，整套 15 PASS。`frontier-crown-service-before-backlog-case-result.json` 保留新增該案例前的 14 PASS 歷史報告。
- 首輪服務測試 13 PASS／1 FAIL 是雙車 pursuit bot 繞圈未撞上；保留 `frontier-crown-service-before-driver-result.json`，測試改為正常三車排位直線追撞後通過，沒有改產品碰撞或計分。
- 模型測試首輪 9 PASS／1 FAIL 是 loader 把 Three 載成 CJS，出現 `THREE.Group is not a constructor`；保留 `frontier-crown-models-before-loader-result.json`。測試改載真 ESM 後 10 PASS，產品未為此放寬。
- root 的瀏覽器驗證另行記錄；此文件不宣稱已完成外網雙人、四人真人平衡或手機實機測試。

## 事件容量滿額的回放完整性修正

- 真 recorder／schema 最小 fixture 證實舊缺陷：512 筆事件用滿後，1200 毫秒的新王冠轉移被拒絕，但仍發布錄到 1800 毫秒的 10 frames，後半 `cityReplayCrownAt()` 錯誤沿用 actor 0。保留 `frontier-city-replay-capacity-before-result.json`（0 PASS／1 FAIL）與 `frontier-city-replay-capacity-evidence-1795187861734/`。
- `CityReplayRecorder.event()` 在第一筆無法保存的合法事件時停止錄製，只保留嚴格早於該時刻的完整 frames／events 前綴。即使該步先 sample 或先有其他已接受事件，同一時刻也會一併回收；尚未 append 的 latest 同步回退，finish 不會把缺事件的後段重新補回。既有前段事件不被優先刪除，不補造冠主；真正經過時間保留於 durationMs，truncated 明示截斷。若連第一個完整 frame 都無法保留，回放不會被標為 ready。
- 不修改 schema、512 容量、車輛物理、遊戲持冠與分數；其他城市玩法共用同樣的完整前綴規則。只是在無法保證回放事件完整時提早截斷回放，當場對戰繼續。
- `frontier-city-replay-capacity-node.mjs`：8 PASS／0 FAIL，exit 0、來源／腳本 hashes 不變。證據 `frontier-city-replay-capacity-evidence-1795187893819/`，涵蓋真 recorder→嚴格 parser／decode、同 step 順序、latest 尾段、截斷後拒絕新事件、恰好 512 仍可完整、起始就缺事件不發布、原前綴保留與舊四玩法。這些是明示容量 fixtures，不冒稱真人密集碰撞或 WS／GPU 證據。
- 修正後重跑：city replay 19、social watch 19、duty replay 7、duty watch 6、replay download 17、crown service 15、crown models 10，全 PASS；crown service 包含原完整 180 秒真 WS 操控奪冠與逐塊回放。
- 原 city replay 測試把 512＋5 筆全部排在 frame 0 同一時刻，採新完整前綴規則後正確不發布該 frame，因此初輪 18 PASS／1 FAIL 保留於 `frontier-city-replay-event-cap-before-result.json`。測試維持 512 筆容量與匿名斷言，改在後時刻溢出，另驗 frames 停在遺失事件之前；新容量測試保留「起始同時刻溢出則不 ready」的嚴格斷言。
- 六套驗證同時執行時，duty replay 長下載曾 6 PASS／1 FAIL，錯誤為連線已停止而取消下載；保留 `frontier-duty-replay-parallel-capacity-result.json`。當時產品與腳本未改，單獨重跑為 7 PASS、92 塊 2832 毫秒；該 PASS 不能排除長檔 fixture 缺陷。最終整合再次 6 PASS／1 FAIL 後，已確證 fixture 缺少正常權威 tick，超過4秒未收到房間快照會觸發既有 watchdog；測試補上正式30Hz tick 與 finally 清理，產品不改。完整原因、保留失敗與新收據見 [FRONTIER_DUTY_WATCH.md](./FRONTIER_DUTY_WATCH.md)；未將原失敗改記 PASS，也不把根因推定為 CPU 負載。

## 最終序列驗證的測試清理競態

- 最終序列一輪 crown service 為 14 PASS／1 FAIL，原始收據與 log 保留在 `frontier-crown-service-final-before-cleanup-result.json`／`frontier-crown-service-final-before-cleanup-log.txt`。失敗 stack 在下一個測例開始前的 `clean()`：`rooms.size` 仍為 1；該次完整 180 秒測例尚未執行，沒有產生 controls-only drive 檔。
- 原清理只等 client 端關閉與固定 3 毫秒，再把權威時鐘前推 15001 毫秒；這不能保證 server 的 close／drop callback 已處理。若 server 晚一輪才 drop，`disconnectedAt` 會落在前推後的新 now，房間正確地仍有新起算的既有 15 秒保留期。這是測試清理次序不足，不是對戰 grace 規則需要改動。
- `frontier-crown-cleanup-node.mjs --repro` 使用真 loopback WS、產品 client 與明示「延後 server drop」fixture，確定重現 0 PASS／1 FAIL：前推15001毫秒後 `clients:0`、`rooms:1`、`disconnectedAt === now === 2015001`。保留 `frontier-crown-cleanup-before-result.json` 與 `frontier-crown-cleanup-evidence-1795189244024/`。這個 fixture 證明可重現的次序問題，沒有把原始事件迴圈延後的原因推定為 CPU 負載。
- 測試新增 `frontier-server-close-barrier.mjs`：有界等待真 `service.clients.size === 0`，之後才前推原有15001毫秒並檢查房間清空；沒有加固定睡眠、延長遊戲期限、強制刪房或修改任何產品。
- 同一真 WS 舊／新次序對照為 2 PASS／0 FAIL，證據 `frontier-crown-cleanup-evidence-1795189286444/`；新次序清到 `rooms:0,clients:0`。原 crown service 重跑為 15 PASS／0 FAIL、exit 0，來源／腳本 hashes 不變且清理完整，證據 `frontier-crown-service-evidence-1795189296795/`；完整180秒仍為 `[4.2,0,175.8]`、216次嚴格快照檢查與25塊匿名回放。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
