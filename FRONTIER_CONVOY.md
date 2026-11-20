# Frontier 第 7 項：車隊巡遊

作者：Rex <game88521@gmail.com>。

這是沿真實單行道路完成多站任務的 2～4 人合作模式。它沿用 social 權威 FreeCar／Collider、好友識別、獨立觀眾、匿名回放及有界續接，不增加正式圈速、單人錢包或成就。沒有 commit、push 或部署。

## 正式規則

- 三條固定路線：南城倉庫 3 站、北城大道 4 站、城市 5 站；全程分別約 4.9、9.1、8.4 公里，最多 30 分鐘。
- 每腿由 `WorkshopRoads.route` 重建真實有向路網。地面站點使用地面節點，保留路徑高程；目標是該站附近真路網末點，站名保留原合作站名稱。
- 每位車手須依序通過每 30 公尺的順序門：行進線段距門不超過 10 公尺、路層差小於 1.8 公尺。不能只停到終點跳過道路。
- 所有順序門通過後，在目標 12 公尺內、同層、時速不高於 7.2，連續停留兩秒。已停妥者離圈、加速或斷線就重新計時；全隊有效成員同時停妥才推進下一站。
- 友車穿透。只有起跑／回大廳需要的正常排車；進站與換腿不會傳送車輛、改 epoch 或上報客戶端位置。
- 途中不開放新車手加入／換車／復位／房主管理。原席位可在固定 15 秒期限內續接，接回後須確認操控。
- 斷線保留期間全隊等候，退出或超過保留期者不計個人完成；若有效名單不足兩人即明示中斷。三人以上可在退出者排除後由至少兩人完成剩餘站點。
- `complete`、`timeout`、`left`、`server-stall` 分開呈現。賽後保留當場名單與完成事實到再開一輪，席位保留期不能改寫誰曾完成。

## 介面與協定

- 選單有獨立「車隊巡遊任務」入口。建房可選三條路線；房間顯示逐站清單、共同完成數、每車順序門／停妥秒數、斷線與退出狀態。
- HUD 顯示目前站與共同進度；3D 黃色圈標示本站。`navInfo()` 提供目前真路徑、高程及自車下個順序門／停靠點；main 負責接至既有小地圖。
- `CONVOY_VERSION = frontier-convoy-v1`。hello／診斷公開 `convoyVersion` 能力；只有對應服務才能建立／加入／續接巡遊，缺能力的舊服務仍可使用原有三模式。
- 建房：`{type:'create',v:SOCIAL_VERSION,mode:'convoy',convoyVersion:CONVOY_VERSION,convoyRoute:'south-loop'|'north-loop'|'city-loop',name,vehicle,weather}`。加入與續接同樣帶 `convoyVersion`。
- 只有 convoy 模式的 `SocialRoom` 多出嚴格解析的 `convoy`。原 cruise／chase／tandem 房間形狀不變。巡遊觀眾採合作規則即時跟車，只收到一輛車位置及無座標名單，沒有其他車雷達。
- 戰績沿用最近 20 場既有分類，多保存路線 ID、共同完成／總站數、參與及完成數；舊三模式原文相容。完整備份仍為原有 27 類，席位 token／玩家 ID／房碼不寫入戰績。
- Docker 已加入新權威 helper 與共用 schema。

## 本機證據

- 純模型／戰績／損壞保護／跨頁競態／quota／完整備份往返：`frontier-convoy-models-node.mjs`，10 PASS／0 FAIL。
- 舊回歸：social 19、client 6、房主管理 19、續接 15、觀戰／回放 19、備份 7、診斷 11，合計 96 PASS／0 FAIL。`tsc --noEmit` PASS。
- 真路網／FreeCar 原型：南線 3 站 746.9 秒、城市 5 站 1279.8 秒，均零牆撞。修正後北線 4 站 1373.083 秒，有兩次約 2.07／2.08 m/s 輕微擦牆，沒有卡死。原型不宣稱已通過真網路或真人測試；正式 WS 報告另列。
- 真整合服務 WebSocket 三條路線都完成：南線 715.933 秒／860 次嚴格快照檢查／最大 17,468 bytes；北線 1,316.033 秒／1,580 次／19,453 bytes；城市線 1,227.233 秒／1,473 次／22,439 bytes。三線每一站都有等待隊友，全程只送操控、未寫入 pose／門序，最大 1/60 秒位移約 0.142 公尺，沒有進站傳送。時間為權威模擬時間，不是牆鐘網路延遲。
- 正式真整合服務驗證：`frontier-convoy-service-node.mjs` 最終 14 PASS／0 FAIL，exit 0，來源／腳本 hashes 不變、HTTP／WS／席位清理完整。主結果 `frontier-convoy-service-node-result.json`，完整證據位於 `frontier-convoy-service-evidence-1795185641697/`。另含能力／白名單、2～4人／權限、偽造位置與跳站拒絕、斷線／真續接／逾時退出、同層與兩秒停妥負例；只有明示的負例測試使用 pose／門序 fixture，三條完整路線沒有。
- 真匿名回放逐塊下載：南線 93 塊，含倒數全長未超過 12 分鐘，`truncated:false`；北線 90 塊與城市線 94 塊，`truncated:true`。三線賽後斷線超過 15 秒，完成名單仍保持一致。服務測試曾 13 PASS／1 FAIL：錯在測試於 leave ACK 後、下一個權威 tick 前就斷言結束，保留 `frontier-convoy-service-before-tick-result.json`；改等 34ms 後整套 14 PASS。
- 原北線 `0 → 3` 的真路網中心線穿過護欄，實際未完成。保留 `frontier-convoy-bot-north-before-result.json` 與 `frontier-convoy-bot-research-north-loop-debug-result.json`，正式北線改為 `0 → 5 → 3 → 2 → 0`，未更改牆體／車輛物理／固定回歸基準。
- 模型測試初次 9 PASS／1 FAIL 是測試負例共用路線物件而汙染後續 fixture；保留 `frontier-convoy-models-fixture-before-result.json`。各 fixture 改為深拷貝後 10 PASS，產品規則未為此放寬。
- 尚待 root：main 導航／query 接線、建置、瀏覽器與固定三回歸。未測真人平衡、外網穩定或手機實機。

正常任務推進不會傳送。既有 social 的越界／非有限值保護仍會把非巡航車手列為離席失格再安全放回起點；該分支不能推進巡遊或獲得完成，並非救援／重試捷徑。

可重用真道路 bot：`tools/dev-tests/frontier-convoy-bot.mjs` 的 `new ConvoyRoadBot({speed,delay}).input(car,leg,nextGate,elapsedMs)` 只回傳操控，不改車、順序門或分數；其 2.7 公尺軸距參數適用本次巡遊轎車，不代表長平板車同樣可通過。

## 最終統一回歸

2026-11-21 本輪build **caeeecc35bef**已完成34套Node／服務、14套瀏覽器與固定三基準，詳見 [FRONTIER_VALIDATION.md](./FRONTIER_VALIDATION.md)／JSON。本段是最後封版狀態；上文各次build、待root與before FAIL保留開發當時事實，未改寫原始證據。PASS只涵蓋本機實作與驗證；真機／外網／完整真人駕駛限制依統一報告，沒有commit、push或部署。
