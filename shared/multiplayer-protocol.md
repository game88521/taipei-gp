# 私人賽道競速通訊協定 v2

型別定義以 `multiplayer-protocol.ts` 為準。傳輸是 `/ws` 上的 UTF-8 JSON WebSocket；正式部署使用 WSS。最多四名玩家，支援玩家車輛碰撞，沒有公開配對、聊天或 AI。賽道為台北加全部 23 張 GP 地圖，所有多人地圖均保留原有經典操控，圈數 1／3／5。伺服器執行真實 `Car.update` 物理，客戶端只送方向與煞車，不能上報位置、碰撞結果、圈數、圈速或完賽。

## 相容性與身分

`create`、`join`、`resume` 都必須有：

```json
{"version":2,"physics":"classic-multitrack-collisions-v3","catalogStamp":"catalog-v2:<本次建置的SHA256>"}
```

任一欄不符回覆 `INCOMPATIBLE_VERSION`，v1 及舊 `classic-multitrack-v2` 不能混場。`catalogStamp` 由建置工具綁定台北／23 份 GP JSON 的完整內容、metadata／傾角、建圖配方及經典物理來源；client 與 server 共用 `multiplayer-catalog.json`。房間另有 `trackId`、`trackStamp`、`trackRevision`，不能再以單一台北 stamp 作全域身分。不能以同一網址或 SW 已接手推定玩家版本相同。

名稱長度 1～16 字，拒絕控制字元與 HTML 特殊字元。房間碼是六字 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` 安全亂數。房間碼只協助朋友尋找房間，沒有登入帳號或私密身分驗證功能。

`playerId` 與 32-byte 安全亂數 `resumeToken` 在加入時由伺服器簽發；不使用玩家存檔 UUID 驗證身分。Token 只送給該玩家的 `welcome`，不出現在 room、snapshot、health 或日誌。每個 player session 同時只准一個 socket；有效 token 重連會替換原 socket。

## 客戶端訊息

以下省略前三種訊息必填的相容性欄位。`create`、`join`、`resume` 可帶長度不超過 80 的字串 `requestId`，伺服器在相對應 `welcome` 或 `error` 原樣回顯。

| type | 其他欄位 | 行為 |
|---|---|---|
| `create` | `name`, `laps: 1 \| 3 \| 5`, 可選 `trackId` | 建立房間並加入，自己是房主；預設台北 |
| `join` | `code`, `name` | 僅可加入大廳，最多四名 |
| `resume` | `code`, `playerId`, `token` | 在原 session 的重連期限內恢復 |
| `select-track` | `trackId`, `expectedRevision` | 僅房主、大廳、目前 revision 可切圖；同圖為 no-op |
| `track-loaded` | `trackId`, `trackStamp`, `trackRevision` | 三欄均等於房間選擇才標為已載入；重連後需重送 |
| `ready` | `ready: boolean`, `trackRevision`, `trackStamp` | 僅大廳、同圖且已載入才能準備 |
| `start` | `trackRevision` | 房主發起；至少二人，全員已連線、載入且準備 |
| `input` | `matchId`, `trackRevision`, `seq`, `steer`, `brake` | 當前地圖及賽事，整數序號遞增；方向 [-1,1]，煞車 boolean |
| `reset` | 無 | 結果頁房主開下一場，回大廳並清準備／比賽資料 |
| `leave` | 無 | 主動離開並撤銷 token；賽中為 DNF |
| `ping` | `sentAt: number` | 回顯時間及伺服器 epoch 毫秒，供時鐘偏移估計 |

`matchId` 每次開始都產生新 UUID。前一場或舊地圖 revision 的 input 會被拒絕；非遞增序號會被忽略。伺服器不接受 NaN／Infinity／座標或客戶端完賽指令。客戶端每秒最多建議 30 次 input，server 對每個 socket 有每秒 60 次、burst 120 的總訊息限制。

不同圖成功切換後 revision 加一，所有玩家的車況、圈數、輸入／確認序號、成績、ready、loaded 與比賽時鐘均重置。無效圖、舊 revision、非房主或賽中切圖均拒絕且不改房間。每個房間擁有獨立 track arrays；快取不交給車輛修改，不呼叫全域 `setRealPerf`。

## 伺服器訊息

| type | 欄位 |
|---|---|
| `welcome` | `playerId`, `resumeToken`, `room`，及選擇性的 `requestId` |
| `room` | `room`，加入／準備／階段／連線變化時即時送出 |
| `snapshot` | `room`，每秒約 20 次 |
| `pong` | `sentAt`, `serverTime` |
| `error` | `code`, `message`，及選擇性的 `requestId` |
| `left` | 無；離開、房間清除或 session 被有效重連替換 |

Room 必含 `code`, `hostId`, `phase`, `matchId`, `startAt`, `laps`, `serverTime`, `trackLength`, `version`, `physics`, `catalogStamp`, `trackId`, `trackStamp`, `trackRevision`, `players`。`phase` 是 `lobby / countdown / racing / results`。大廳的 `matchId`、`startAt` 為 null；開始後保留同一 `startAt` epoch 毫秒直到重開。所有時間來自伺服器，無需相信客戶端時鐘。

每名 player 含 `id`, `name`, `color`, `ready`, `loaded`, `connected`, `car`, `ackSeq`, `completedLaps`, `progress`, `finishMs`, `dnf`, `rank`。`car` 永遠是完整 `CarState`，不限速的 `speedCap` 以 null 表示。`progress` 是自起跑的淨向前公尺數、最小顯示 0；`finishMs` 為 server 裁定的經過毫秒，未完賽為 null。`players` 依完賽時間、未完賽距離與 DNF 排序；完全同時以固定起跑 slot 決定穩定順序。

## 比賽生命週期

- 房主 `start` 成功後倒數三秒，車輛同時解鎖。所有玩家在同一縱向起點、不同橫向位置，起跑車身不重疊；倒數期間不解碰撞。
- 比賽中全車完成步進後，依固定 slot 順序解車身碰撞、追撞傳速及側擦分離，再依最終位置計進度。只包含同房、已連線且載入完成、未完賽及非 DNF 車；橋上橋下依高度分離。客戶端沒有碰撞回報訊息。
- 伺服器固定 60Hz 真物理步進，沿賽道依序通過 1/3、2/3、終點才計圈；逆行不會增圈。完賽時間以權威步內過線比例內插，不能藉較快回報搶名次。
- 超過 700ms 沒收到新 input，方向回正並自動煞車。倒數中斷線會取消本次倒數並清全員準備。
- 賽中斷線不暫停其他人，最多保留十秒重連；逾期撤銷 token，未完賽者 DNF。房主斷線由仍連線者接任，物理與時間仍由伺服器維持。
- 第一名完賽後最多六十秒，其餘未完賽 DNF；整場最多十分鐘。全部已完賽或 DNF 可提前顯示結果。
- 伺服器單次停頓超過五秒會中止該場並把未完賽者列 DNF，避免無限追趕或悄悄改變比賽速度。
- `reset` 移除已斷線玩家，再清圈數／序號／車況並回大廳；保留地圖、revision 與在線玩家 loaded，只清 ready。倒數取消也保留在線玩家 loaded。disconnect／resume 則清該玩家 loaded 與 ready，車況仍依原重連規則保留；重新載入確認後才能傳駕駛輸入。

## 錯誤與資源上限

常用錯誤碼：`INCOMPATIBLE_VERSION`, `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_STARTED`, `ALREADY_JOINED`, `INVALID_SESSION`, `SESSION_EXPIRED`, `HOST_ONLY`, `NOT_READY`, `INVALID_PHASE`, `STALE_MATCH`, `STALE_TRACK`, `INVALID_TRACK`, `TRACK_UNAVAILABLE`, `INVALID_NAME`, `BAD_MESSAGE`, `RATE_LIMIT`, `SERVER_FULL`。重連收到 session／房間失效錯誤後，客戶端應清除舊 session 並讓玩家重新加入。

預設最多 50 房、256 sockets、同一實體來源 IP 16 sockets；每個訊息上限 4096 bytes，不使用壓縮。超大、binary、持續無效 JSON、限流或過慢的 socket 會關閉。每五秒 WebSocket ping，未回應的下一輪終止；這與應用層 ping 不同。

所有人離線六十秒後回收房間，大廳／結果三十分鐘無操作回收。資料只在單一 Node 程序記憶體；重新部署或程序重啟會終止房間。任何對戰結果都不寫入單人錢包、賽季、PB 或線上計時榜。
