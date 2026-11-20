# 第 9 項：多人定速拉力

作者：Rex <game88521@gmail.com>。本玩法已在 `taipei-gp-frontier-work` 完成整合與針對性本機驗證；未修改原專案、未 commit、push 或部署。root 正以 build `caeeecc35bef` 執行最後驗證序列，整批交付結果以該輪 final validation 為準。

## 契約與裁定

- `shared/frontier-rally.ts`：`frontier-rally-v1`，`RallyRoom`、`RallyPlayer`、`RallyTiming`、嚴格`parseRallyRoom`及四點`rallyTiming`。
- `server/frontier-rally-service.mjs`：`FrontierRallyService`沿用`SummitCityRaceService`的權威FreeCar固定60Hz模擬，但獨立protocol、room、commands與裁定。只接受操控，拒絕位置、過門、完賽與成績封包。房間2～4人，預設最多2房／24條連線。
- 真路線：`COOP_STATIONS[0]`至`[2]`的ground nearest主路網節點，`WorkshopRoads.route`按單行方向與路層建路。服務與前端都重建並逐JSON比對路線。所有車同一個起點、相同sedan晴天；因友車穿透，不使用會造成不公平的前後排起跑距離。靜態建築仍由FreeCar collider處理。
- 房主建房選28／36／42km/h，之後全員鎖相同平均速度。速限固定50km/h。全路每30公尺順序門，必須正向、離中心10m內、路層差1.5m內；四個計時點在四分之一／二分之一／四分之三／終點。不能只到四點、倒車通關或傳送脫困。
- 理想到達`dueMs=round(distance/(average/3.6)*1000)`；實際到達由權威步內過門比例算出並四捨五入到毫秒。四點`abs(actualMs-dueMs)`相加。超速積分為`max(0,km/h-50)*seconds*200`毫秒，60km/h維持1秒加2000ms。兩類罰分分別四捨五入到毫秒後相加，總罰分低者勝，同分同名次（1／1／3），DNF無名次。完賽後不再增加分項。
- 倒數3秒、最長600秒；選單與短斷線不停止賽時計時。斷線15秒私席逾時DNF，主動離房立即DNF。模擬超過1秒停頓（含倒數跨起跑的停頓）整場取消，包含先完賽者都沒有有效名次。
- 原席nonce／old-new token冪等grant，不因welcome遺失重rotate、不延原期限、不雙綁；換頁可持有效current token換新key。續接後服務端與client都要求確認，client收到精確ACK前不解除gate；ACK遺失只能手動再按確認，不自動重送操控。回大廳不清除其他未確認私席的原期限。
- 能力明示`watch:false,replay:false`；本獨立玩法沒有開放觀眾或回放，不能以其他模式的API繞入。初次進房失敗、主動離房不觸發auto。auto重用第4項`CityAutoResume`（3次／15秒／4秒單次／背景不新attempt），快照停更3.5秒時中止並續接；pong不能刷新權威快照時戳。

## 前端與儲存

`mountFrontierRally(hooks)`採城市競速介面並支援本輪非同步借車保護：scene/host/isCity/car/city/prepare/canEnter/open/close/enter(definition,route,isCurrent)/leave/input/collider/visible/release/focusDriving/notify/weather/setWeather。enter可回boolean／void或其Promise；await後再次檢查isCurrent，晚到結果不能奪取操控。回傳`client,prediction,open(),close(),leave(),active,busy,opened,vehicleId,navInfo(),frame(now,dt),dispose()`。`navInfo`為`{path,ys,next:[x,z]|null}`；`vehicleId`借車期間固定sedan。

UI提供獨立入口、目標均速、房碼邀請`?rally=CODE`、四點目標表、全員時差／超速／總罰及並列名次、展開逐點明細、原生結果JSON下載與明確保存、最近20場、續接確認。自身使用現有`VoyagerCityPrediction`；自建名為`frontier-rally-own-car`的sedan模型，好友車與近距名字只讀快照。自車／好友sedan的geometry與material都是各次build新建，離房清理；共用blobTexture不dispose。失焦／背景立即釋放控制，dispose清事件與自有3D資源。前端開panel不暫停權威賽事。

- `src/frontier-rally-client.ts`：`FrontierRallyClient`、`rallyEndpoint(config,location)`轉`/city-rally`，私席只存sessionStorage `taipei-gp-frontier-rally-seat-v1`，包含續接nonce供welcome遺失後重新整理復原；**排除備份**。
- `src/frontier-rally-history.ts`：`FRONTIER_RALLY_RESULTS_KEY='taipei-gp-frontier-rally-results-v1'`；`parseRallyResults({v:1,records})`、`FrontierRallyResults`。最多20場／100000 UTF8 bytes，純結果不含房碼、playerId、token、endpoint、pose。手動保存、完整驗分、深拷貝、損壞保留原文、跨頁原文CAS、quota與readback衝突明示；不宣稱跨頁原子交易。
- 沒有修改原單人`?regularity=1`或`expedition-duty-rally.ts`，兩份結果key獨立。

## 已完成的接線

1. `server/index.mjs` 已建立 `FrontierRallyService`、共用城市 world、註冊 `/city-rally`，接上既有 Origin／總連線上限、固定 tick、heartbeat、close 清理，以及 health 的 `cityRally`／`capacity.rallyRooms`。
2. `server/Dockerfile` 已 COPY 本玩法的 service／shared 檔。依實際 COPY 集合建立的隔離 Windows Node 24 staging 已真啟動，五案皆通過，包含本玩法的城市預熱、health／diagnostics 版本與 `/city-rally` hello；報告 `tools/dev-tests/frontier-docker-smoke-evidence-1795188545626/result.json`，當時 build `864be4d1d7b8`。這不是 Docker／Alpine image build 或 Linux 實機驗證。
3. 前後端 diagnostics 已加入 `rallyVersion` 與 `/city-rally`，核對獨立版本、hello／pong，保留原五欄 protocol。
4. `src/main.ts` 已接 `mountFrontierRally`、非同步借車／還車 adapter、互斥與一般單人玩法 gate、導航／minimap、固定 sedan／晴天、render frame、Esc、切換玩法離房、pagehide 與 `__gp.frontierRally`。`expeditionOwned/Busy` 接管期間隱藏原車，普通 FreeCar 不重複推進，prediction 只在 rally.frame 跑；離房還車、還導航及原天候，不累加單人成績。`?rally=CODE` 已接城市入口，原 `?regularity=1` 保留。
5. 玩法目錄已納入 `btn-frontier-rally` 入口與可收藏／最近玩法。
6. 備份白名單與 validators 已納入 100000 UTF8 bytes 的公開結果鍵，嚴格驗證結果；私席、token、nonce 不進備份，保留舊備份相容。

## 已驗與待驗

- 完整真道路補證：`node tools/dev-tests/frontier-rally-road-node.mjs` 為3 PASS／0 FAIL、exit 0，來源／腳本hashes不變且清理完整；報告 `tools/dev-tests/frontier-rally-road-node-result.json`，獨立證據 `frontier-rally-road-evidence-1795187448673/`。28／36／42km/h三種目標均速，兩車都從服務正常同點起跑，實際沿2369.536875公尺真路網、依序通過全部79個正向同層順序門與4個計時點，分別318.216667／250.733333／217.166667秒內自然完場。三案皆零靜態牆撞、零超速罰分、零起跑後`place`，最大單步位移0.193687公尺，strict parser分別320／252／219次；兩車因相同操控而同分並列第一。
- 上述三案只經真`FrontierRallyService.receive(input)`與`tick`推進，使用真正FreeCar與完整城市Collider；沒有寫入pose、門序、進度、成績、phase、simAt或任何起終期限，且驗證正式route／definition／timing與revision未變。控制器只讀引導路徑將末端切線延20公尺，讓車正常正向開過最後一門，正式路線沒有改動。**此補證以EventEmitter代替socket，屬完整道路與權威裁定可行性，沒有使用WebSocket；不代表真人準時技巧、外網延遲、免費主機容量或手機實機驗證。**獨立 Node 套件另含真正 loopback WS client 短程操控／續接證據，兩種範圍分開計算。
- `node tools/dev-tests/frontier-rally-node.mjs` 最近針對性驗證 **17 PASS／0 FAIL**，報告 `tools/dev-tests/frontier-rally-node-result.json`，執行時間 2026-11-20 15:08:52～15:09:01 UTC；來源／腳本 hash 不變、cleanup 通過。包含倒數跨起跑 stall、結果儲存不可用及真正 loopback WS 輸入／續接。較早 16 PASS 證據 `frontier-rally-node-evidence-1795185448424/result.json` 亦保留；最新狀態仍以 root 的 final validation 為準。
- 真瀏覽器針對性驗證 **9 PASS／0 FAIL**，當時 build `4705777caa51`，報告 `tools/dev-tests/frontier-rally-browser-evidence-1795187824153/result.json`。覆蓋雙人真入口／建加入、固定晴天、`/city-rally` 真診斷、三種尺寸、同步起跑與鍵盤短程操控、不重複推進 main FreeCar、四點分項與同分結果、原生下載、還車／導航及原存檔保護。四點結算採明示順序過門 fixture；完整路線自然完賽由前述三案 Node 證據另證，不混稱真人全程駕駛。
- TypeScript 已通過；本輪最後建置與整批驗證由 root 序列執行，較早各項結果不代表最新 build 全部完成。
- 自審修正：再戰revision gate；回大廳不得重設其他玩家原續席deadline；倒數跨過起跑停頓也要明確server-stall。
- 失敗對照保留：第一版Node12PASS／1FAIL，原因是測試在service.close後讀取已清空c.player計算返回值；改先保存movementM後，第二輪13PASS，再擴充兩案15PASS。每次evidence獨立保留，不覆寫失敗收據。
- root 最後驗證序列執行中，等待本輪完整 build／browser／基準及備份相容的彙整結果；不以舊 build 的針對性 PASS 取代最後報告。沒有真手機、跨網路或真人完整路線長測證據，這些範圍不列 PASS。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
