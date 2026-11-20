# 第 6 項：回放接觸事實分析

署名：Rex <game88521@gmail.com>。純分析核心：`shared/frontier-incidents.ts`。播放器與 JSON 下載由 `src/nexus-replay-ui.ts` 接線；真服務事件與瀏覽器證據另列，不以純幾何 fixture 代替。

## 提供的資訊

`listReplayIncidents(replay)` 只列 `collision`／`wall`，`eventIndex` 保留原 `replay.events` 下標，不因篩選而重新編號。`analyzeReplayIncident(replay, eventIndex)` 接受已通過原 `parseMultiplayerReplay` 的 schema 1～6 回放；非整數、負數、越界、非接觸事件或無事件的 schema 1 回傳 null，不拋穿整個回放頁。

每個事件固定查看 **前 3 秒、近事件、後 3 秒** 三點。直接從原始權威 frame 選最近樣本，平手選較早者，沒有呼叫 `replayFrameAt` 或使用插值畫面當作事實。每點明列 targetAt、實際 sampleAt 與有符號 offsetMs。時間目標不 clamp；若前三秒早於錄製起點，不能把第零秒冒充完整前三秒。

每車只列原始 x／z／heading、signedSpeedMps 與有符號 speedKph。雙車相對資料來自**同一個 frame**，包括平面距離、相對 actor0 的 forward／right 投影，以及朝向最短弧差。actor0 只是事件原始順序的參照，不代表先後、主動撞擊者或責任。h=0 朝 +z、h=π/2 朝 +x；右側相對軸也隨參照車朝向旋轉。

護牆事件只列其一位 actor，不尋找附近其他車當成對手。缺少 actor、actor 不符或護牆多出 actor 都明確標資料不足／異常，不補猜任何車手。

## 資料不足

名義錄製間隔為 200ms；不是逐個物理 step 的接觸紀錄。最近樣本相差 **超過 200ms** 時，仍列候選 sampleAt／offset，但不輸出該點 pose 或相對向量。目標越過錄製範圍時，sampleAt／offset 皆為 null，不輸出 pose。

連續原始 frame 相差 **超過 400ms**，且跨過事件前後三秒範圍時，列出 gap 起點／終點／長度並標示不完整。即使三個目標點都有近樣本，視窗中其他位置的 gap 也不能隱藏。恰好 200ms／400ms 不當作超限。gap 內若仍有足夠近的真樣本，只呈現該原始時刻的事實並標 partial，不補齊中間軌跡。

來源 truncated 會同時保留在 source 與 issues；即使局部三點齊全，也不宣稱完整。超出尾端則額外標 recording-end，超出起點標 recording-start。

既有 schema 1～6 沒有高度、網路連線狀態、油門／煞車輸入、接觸法線或真正接觸物理 step。輸出 `unknown` 的六項永遠是 `unknown`。特別是 `ReplayPose[13]` 代表 arena active，不能拿來推斷 connected；不動、DNF 或保留的 pose 也不能用來猜斷線。

事件 detail 僅作原文顯示／保存，不抽取「強度」數字、不判定肇責、不自動新增罰秒。輸出沒有責任或處罰欄位，固定 disclaimer 說明用途與限制。

## 容量與隔離

`IncidentAnalysis` v1 只輸出 public source metadata、單一原事件、最多兩位 actor、三個點、最多 16 個 gap、有界 issues、unknown 及固定 disclaimer。每個點最多兩車，沒有把整場 frames、原房間、輸入、續接 token 或私席放進事實 JSON。名義 JSON 上限為 `INCIDENT_MAX_JSON_BYTES = 16,384` bytes；原回放仍遵守既有 512 events／3,602 frames 上限。

list、event、actors、point、relative 及 gap 都是新資料，不共享來源可變陣列／物件。分析不改回放 schema、事件文字、賽果、罰秒、模擬、播放器時間或存檔。也沒有新 HTTP／WebSocket 請求或隨機呼叫。

## 驗證

執行 `node tools/dev-tests/frontier-incidents-node.mjs`，專用 **19 PASS／0 FAIL**；來源／腳本雜湊在測試期間穩定，外部請求 0。所有 schema 1～6 fixture 先通過原本 strict replay parser。

固定幾何 oracle 驗證旋轉 90 度的 3-4-5 距離（forward=4、right=-3、distance=5），以及 heading 跨 ±π 的 0.1 rad 短弧；不是在測試內複寫公式再自證。非對稱速度／位置案例確認兩車採同 frame，且前中後三點不混用時間。其他覆蓋 nearest tie、200／201ms、400／401／402ms、視窗中段 gap、護牆一車、缺 actor、兩端不足、截短、detail 不推責、inactive 不猜斷線、非法索引、非有限 pose、深副本及有界 JSON。

純 fixture 容量案例使用 512 個事件與 3,601 個 frame，事實 JSON 為 **2,358 UTF-8 bytes**。這是資料容量與算法驗證，不是外網真人、200ms 之外接觸重建或肇責準確率證據。

整合 build `a99b616876a8`；`frontier-incidents-service-node.mjs` **6 PASS**，各自以真房規產生 schema2～6，真WS分塊下載與匿名actor對應／不改權威成績皆驗證。近重疊與外牆起始位置是明示fixture，接觸、事件、錄製及下載均走產品；12秒後DNF關閉短錄製，不是人類完整比賽。legacy schema1明示衍生並經原strict parser。

`frontier-incidents-browser.mjs` **8 PASS**：真原生file匯入及WebGL播放器、原始三點、護牆單車、片段自停、原生Blob下載、三手機尺寸44px／可達、關閉清理與schema1無事件fallback。原生下載逐字解析等於瀏覽器Blob；原始數值／metadata精確比對Node，衍生三角函數幾何以1e-10容差處理Chrome/Node最後小數位差，不改產品數字取整。來源／腳本hash穩定、零外網／例外、cleanup完成；失敗fixture及runtime最後位數對照保存在各次evidence。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
