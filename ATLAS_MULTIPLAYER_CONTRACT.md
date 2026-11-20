# Atlas 城市協定補充

署名：Rex <game88521@gmail.com>

本文件只描述本輪城市配送／競速增量；整合版還須參照 Atlas 賽道對戰與平台文件。前後端需同步更新。

## 合作配送 `/coop` v3

- 握手 `v:3`，仍必須符合 `COOP_CITY_STAMP`。v2 握手拒絕。
- 建房可傳 `mode:'direct'|'relay'`，預設 direct。一般配送六個目的地；relay 排除市民大道中繼站後剩五個目的地。同房所有玩家共用房規。
- `input` 僅接受 `type/code/runId/seq/steer/throttle/brake/handbrake/active`。seq 為正整數且單調增加，綁目前房間及 run。steer 在 [-1,1]、其餘控制為布林；未知欄位、位置／速度、過期 run 及重複 seq 拒絕。最多 12 筆等待佇列；客戶端 30Hz，連線頻率上限 90 筆／秒。
- 伺服器 30Hz 模擬，700ms 未更新輸入或 active=false 採阻尼停車；不把倒車煞車當 idle。取送／中繼均由真車位置、同路層、速度 <=1m/s、停穩 >=1200ms 裁定。
- 玩家快照新增 `ack` 與 `physics:{vx,vz,w,vy,steer,pitch,roll}`，pose 是伺服器車況。`position` 永遠拒絕，不供舊版測試或續接使用。
- 續接輪替 token，解綁舊 socket、重設輸入佇列與 received=ack。客戶端依 welcome ack 接號，不沿用未確認舊輸入。伺服器席位保留 30 秒；客戶端 28 秒重試窗口與各次連線／入房等待共用原期限。取送命令不自動重送。
- session key 改為 `taipei-gp-city-coop-seat-v3`，不可匯出席位 token 至存檔備份／分享連結。

relay 貨物欄位：

| 欄位 | 語義 |
|---|---|
| `leg` | `direct`／`to-relay`／`to-destination` |
| `relayFrom` | 已完成中繼時記錄原貨主 id；其餘為 null |
| `offer` | `{to,expiresAt}` 或 null，邀請 10 秒有效 |

新命令為 `offer-handoff {cargoId,to}`、`accept-handoff {cargoId}`、`cancel-handoff {cargoId}`。不同玩家、在線空車、同層停穩才可邀請或接受；確認時計算條件並原子轉移，只有接貨者能確認。未交接不能送達終點。離房、退回或 30 秒續接逾期清邀請並重設整條貨物接力；同輪送達次數不因重送命令增加。

歷史結果仍存 `taipei-gp-city-coop-results-v1`，新可選欄位 `total:5|6`、`mode:'direct'|'relay'`。舊結果缺欄位時解讀為 6/direct，保留原紀錄與獨立分數；不寫單人錢包／正式 PB。

## 城市競速 `/city-race` v2

- 版本為 `city-race-v2`，只接受 `definition.v===1` 的 NG1；NG2 明確拒絕。
- 建房 `collisions:boolean` 預設 false；非布林拒絕，加入者不得改房規。房間完整／增量快照含 collisions，玩家含 `ghostUntil`、`contactCount`。
- 輸入新增可選 `active:boolean`，失焦／面板停止驅動。仍綁 `matchId/revision` 與單調 seq。
- 碰撞採多圓接觸、真車質量反作用與角速度，同層差 <=1.6m；只有在線未完賽且非保護車參與。起跑保護 1.5 秒；低速持續接觸 4 秒後保護 3 秒。
- `recover` 綁當前 matchId/revision，速度低於 2m/s、10 秒冷卻。回上一個已通過 gate 後方 3m，保護 3 秒，next 不增加。
- 伺服器原席保留期仍 15 秒；客戶端以首次 close 起 14.5 秒重試，顯示原倒數，可取消並離房，無限重連不延長期限。版本、路線或續接拒絕停止自動重試。welcome 的 ack 決定新輸入序號。
- session key 改為 `taipei-gp-city-race-seat-v2`。使用者主動離房只刪本功能自己的 seat key，不清其他模式或存檔。

兩項城市服務共用一份真城市 world/Collider 與 `FreeCar` 物理 bundle；原賽道 `server/physics.mjs` 及四個保護核心檔沒有修改。真外網／手機／免費主機負載尚未驗證；不能從本機數字宣稱免費部署容量。
