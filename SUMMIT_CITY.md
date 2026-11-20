# Summit 城市分工交接（#2／#3／#10／#11）

本檔對應 `TAIPEI_NEXT_OPTIONS_AFTER_NEXUS_2026-11-18.md` 固定編號。原始基準為完整 Nexus build `64bc8f19a76a`，本分工只在 `taipei-gp-summit-city` 隔離副本修改；未修改原專案、commit、push、部署或連正式站。整合版仍由 root 統一驗證與交付。

## 已實作

### #2 合作調度

- 真 `BigMap` 道路背景，標示自己、隊友、載貨目的地、預約赴倉庫方向、集合點與姓名。虛線明示僅方向，實際駕駛導航仍走真路網。七站選單亦可用鍵盤操作。
- server 裁定待領貨單預約，每人一張、每張一人，最長120秒，可自行取消／改約；他人無法取消或搶領預約貨物。本人取貨即清預約。斷線、離房、返回倉庫立即釋放預約／標記。
- 預約不取得貨單所有權；已取貨物的斷線保留30秒規則不變。
- 集合標記七站白名單，每人一點、兩秒冷卻、30秒過期；request sequence 防重送。
- 合作協定 **`COOP_VERSION = 2`**，前後端需共同更新。root 整合 `server/index.mjs` 時必須讓 health 的 `coop.version` 引用 `COOP_VERSION`，不要保留舊寫死的1。本分工未改該共用入口。

### #3 導航偏好

- 手動導航提供原版、最短里程、少轉彎、優先避高架／隧道；真路網預覽列里程與估計分鐘，按「採用」才改目前偏好。不寫入主存檔。
- 獨立有向圖與前一條邊狀態，轉彎偏好按每彎200公尺成本計；避高架採25倍偏好成本，必要道路仍可達。保留單行與節點路層，沒有跨層直線捷徑。
- **`Router.route()` 原函式本體不變**，計程車、貨運原呼叫與計酬規則保留。預設 `navigationPreference = 'legacy'`。
- ETA 依約8.3m/s與轉彎估計，無車流預測；少轉彎屬成本偏好，並非數學上只最少轉彎而完全忽略繞路長度。

### #10 長軸公車勤務

- 真城市「信義—基隆—市民勤務線」，固定三個到站順序後回勤務站；實際道路長度 **6,188.3795m**、估計 **886秒（14分46秒）**。時間為7.5m/s加站停估計，實際依玩家駕駛而定。
- 可駕11.5m車身、6.1m軸距、五圓碰撞、長軸轉向／慣量／路面取樣，獨立公車模型與可動前後門。
- 順序18m路徑檢核；站點5m內、同層差小於1m、方向誤差小於0.35rad、速度小於0.3m/s並停穩1.5秒才可開門；至少5秒才可關門。開門鎖車，不會以持續煞車導致倒車。
- 準點與平順／碰撞評分，最後關門僅結算一次；扶正／大位移／不連續時間判失敗。

### #11 平板道路救援

- 真城市空載赴信安街救援點、固定故障車、載運回信義勤務站；總長 **2,595.2239m**、估計325秒。故障車位置對齊平台，載車後真模型固定在平台上，沒有假拖索。
- 同層2.5m內、方向誤差小於0.18rad、停穩1.5秒才可裝／卸；四秒操作期間鎖車，離開位置即取消。載運急煞／撞擊扣完整度，耗盡失敗。

兩種勤務均採封路單人練習，隱藏並跳過背景車流與行人物理，保留真城市路面／建築碰撞；不是有乘客實體AI／城市交通模擬的公車系統。勤務不改正式PB、計酬、錢包、探索、車損與一般統計；停圖／暫停／背景分頁不扣勤務時間。進入前保存原車性能／尺寸／位置，還車恢復，長軸模型與故障車 geometry/material 釋放。

## 存檔與生命週期

- 勤務獨立 key：`taipei-gp-summit-duty-v1`，最多30筆。`parseDutyRecords` 白名單校驗；資料壞損時保留原儲存值，不自動覆蓋。
- 勤務頁有明確 JSON 匯出／匯入取代；格式 `{v:1,type:'taipei-duty-records',records:[...]}`，50KB上限，錯格式／重複id／非法分數拒絕；匯入讀檔期間若切換模式則失效。root 若提供統一完整備份需再納入此 key。
- `BigMap.dispose()` 新增 AbortController 解除五個 canvas listeners、清空離屏與目標 canvas；合作離房／卸載與導航卸載呼叫。root 工坊如持有 BigMap，也可於其 dispose 呼叫，避免 DOM listener closure 保留路網底圖。
- 勤務模型僅接班成功後建立，非主畫面初始建立；離開逐一 dispose。沒有修改固定 GP 核心的亂數與期望。

## 驗證

本分工最後本機 build **`9d939621e1f3`**（整合後 hash 會變），`npm.cmd run build` 通過。既有 Vite 500KB chunk 與 native config 警告仍由 root 的 #1 分包統一處理。

| 測試 | 結果 | 實際證明 |
|---|---:|---|
| `summit-coop-server.mjs` | 13 PASS | 真 HTTP／WS，預約競爭、授權取消、取貨互斥、TTL／斷線、舊所有權、集合限頻、序號、schema |
| `summit-city-models.mjs` | 13 PASS | 真 TS、預設FreeCar對 before 6,000格逐幀完全一致、原Router六組完全一致、偏好／單行／路層／可達性、勤務狀態／備份 |
| `summit-city-browser.mjs` | 7 PASS | 真Chrome／真城市／真WS、390px觸控44px、公交KeyW短程4.249m、平板模型、導航四偏好、預約／ping、停圖扣時0、還車／離房釋放 |
| `nexus-coop-server.mjs` | 19 PASS | 舊合作回歸；只將上限4人測試的兩個 join `v:1` 改用 `COOP_VERSION`，原斷言均保留 |
| `nexus-coop-browser.mjs` | 9 PASS | 舊合作城市UI／取貨／導引／普通駕駛回歸 |
| `nexus-workshop-models.mjs` | 19 PASS | 舊工坊模型回歸 |
| `next6-city-main.mjs` | 12 PASS | 真 main 提取函式之既有街賽／結果／事件回歸 |
| `nexus-city-visibility.mjs` | 6 PASS | 夜間車流車身／影子／車燈一起隱藏／恢復 |

新 browser 結果 `tools/dev-tests/summit-city-browser-result.json`；截圖與原始報告位於 `summit-city-browser-evidence-1794980285845/`。0外網請求、0頁面例外、測試期間來源與腳本hash不變、cleanup PASS。調度 BigMap 真 DOM listener **5→0**，離房 canvas 寬 **0**。已目視檢查勤務手機表單、救援3D、調度手機圖與導航預覽截圖。

真物理完整勤務採**明示直線fixture**：公車299.048m（三站）／7,595格／63.283秒，開關門六次、0碰撞；平板199.042m／4,781格／39.842秒，完整裝卸與載運、0碰撞。兩者都由真 FreeCar 加速／煞停及真 Collider 驅動，未把傳送冒充駕駛。另有錯向／錯層／速度／傳送／門時間／完整度／重複結算邊界fixture。

仍未驗：整條6.19km公車與2.60km救援路線真人駕駛／長時間平衡、真手機、真手把、外網多人、免費主機負載。UI使用桌機模擬尺寸，不宣稱真機FPS。三個固定GP基準由 root 整合後統一執行，這份分工不宣稱已跑過整合版。

## root 整合檔案

共用修改：`src/main.ts`（需與lazy facade／split screen人工合併）、`src/router.ts`、`src/freecar.ts`、`src/bigmap.ts`、`shared/nexus-coop.ts`、`server/nexus-coop-service.mjs`、`src/nexus-coop-client.ts`、`src/nexus-coop-ui.ts`、`src/nexus-coop.css`。

新增產品檔：`src/summit-coop-dispatch.ts`、`src/summit-navigation.ts`、`src/summit-navigation-ui.ts`、`src/summit-city-duty.ts`、`src/summit-duty-vehicle.ts`、`src/summit-city-ui.ts`、`src/summit-city.css`。

新增三支 `summit-*-*.mjs` 驗證與 result JSON、上列 `nexus-coop-server.mjs` 版本參數修正；工坊／舊街賽原測試邏輯未改。`tools/wire-summit-city.mjs`、`tools/finalize-summit-test-ui.mjs` 是本次隔離工作輔助，不需放進遊戲交付；`summit-city-inspect.mjs` 與結果為可選路線量測工具。沒有新增 npm 依賴、沒有改 Docker／server入口，後者由 root 統一接線。
