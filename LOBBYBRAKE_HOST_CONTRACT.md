# 大廳房主管理契約

本輪保留 wire protocol v2 與 `classic-multitrack-collisions-v3`。只新增大廳移除車手、手動交棒及其能力資訊，未更動車輛物理、起跑／計圈規則或原有亂數呼叫。

## 能力與大廳世代

新伺服器在每份 `RoomSnapshot` 提供：

```ts
hostManagement?: { lobbyRevision: number }
```

物件存在才代表支援兩種管理操作。舊伺服器完全省略時，新前端隱藏管理按鈕，仍使用原建立／加入／準備／開始／再戰。舊前端忽略新物件，能繼續解析新伺服器房間。

`lobbyRevision` 是從 1 起的安全整數。換圖、回大廳、成功管理、房主自動移交或續接造成房主改變時遞增；一般準備狀態與相同地圖的重複選取不更換世代。這個數字不改變 `trackRevision` 或 `matchId` 的既有語意。

## 管理操作

```ts
{
  type: 'kick-player' | 'transfer-host';
  targetPlayerId: string;
  roomCode: string;
  expectedLobbyRevision: number;
}
```

伺服器依序檢查目前房主、階段為 `lobby`、房碼／大廳世代、有效目標。目標必須是目前房間的其他玩家，不能操作自己。交棒對象另須已連線；移除允許處理暫時離線的玩家。

| 條件 | 錯誤代碼 |
|---|---|
| 未加入房間 | `NOT_IN_ROOM` |
| 不是目前房主 | `HOST_ONLY` |
| 倒數、比賽或結果階段 | `INVALID_PHASE` |
| 房碼不同，或世代省略／非安全整數／不符合目前值 | `STALE_LOBBY` |
| 本人、不存在／格式錯誤目標，或交棒對象離線 | `INVALID_TARGET` |

拒絕不改房間狀態。成功交棒立即更新 `hostId`，原房主失去管理與起跑權；保留全部玩家的載入／準備狀態。成功管理後廣播最新房間與世代，不必重新開房。

前端確認操作後仍應重讀房碼、世代、房主與階段；舊確認框不應向新房或新一場送出操作。伺服器也會再次檢查，避免跨房、換圖、再戰或房主交接後的晚到命令。

## 移除通知與續接撤銷

被移除玩家仍連線時，伺服器先刪除房間中的玩家、將 token 設為 `null` 並將 socket 與房間脫離，再傳送：

```ts
{
  type: 'left';
  reason: 'kicked';
  roomCode: string;
  message: '房主已將你移出房間；可重新輸入房碼加入。';
}
```

接著以 code 1000 正常關閉被移除者的 socket。新前端應清除該房續接憑證、停止自動重連，顯示通知；處理這個通知時不向舊房補送 `leave`。附加欄位只用在這種通知，原來 `{ type: 'left' }` 仍然有效，包含舊伺服器、換 socket 與清房等既有流程。

離線時無法即時通知。每個房間保留最近 64 個被移除 playerId，不保存其 token；該身分之後嘗試 `resume` 會收到 `REMOVED_BY_HOST` 與相同文字，沿用既有續接失敗流程清掉憑證。超過保留上限的更早身分仍因已不存在而收到 `INVALID_SESSION`，不能恢復。此記錄只在伺服器記憶體，未放入快照。

移除不是封鎖。玩家之後可手動輸入房碼 `join`，若房間仍在大廳且有空位，會取得新的 playerId 與 token；原身分及 token 永遠不能恢復。

## 本機證據

`node --experimental-vm-modules tools/dev-tests/lobbybrake-host.mjs` 使用真 loopback WebSocket、真 `RoomService` 與隔離舊版 client，結果存於 `tools/dev-tests/lobbybrake-host-result.json`。

18 案覆蓋舊版不支援的對照、新舊 v2 相容、權限／目標／世代拒絕、交棒與起跑、在線／離線移除、舊 token 撤銷與手動重入、跨房／換圖／再戰、倒數／賽中／結果禁用、自動選主與續接、記憶體上限及核心五檔不變。沒有連外、操作玩家 storage、開瀏覽器或宣稱已完成手機／外網驗收；完整 build、固定三回歸與前端驗證另行統整。
